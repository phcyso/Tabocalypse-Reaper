#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
// --- Usability audit (2026-10-26) -------------------------------------------------
// The audit only APPENDS extra fixture outputs below; the default fixture above is
// untouched. Audit fixtures: popup-harness-audit-weird.html (edge-case tab set,
// >150 tabs for scale) and popup-harness-audit-empty.html (zero non-excluded tabs).
// The stub also honours ?filter=&sort=&excludePinned=&audit=1 to simulate typing
// (no ydotool on this machine) and adds on-page filter buttons when audit=1.

const auditTabs = [
  // — scheme / URL edge cases —
  { id: 9001, url: "file:///tmp/reaper-readme.md", title: "README (file://)", pinned: false, windowId: 1, favIconUrl: "" },
  { id: 9002, url: "data:text/html,<h1>hello</h1>", title: "data URL tab", pinned: false, windowId: 1, favIconUrl: "" },
  { id: 9003, url: "about:blank", title: "about:blank", pinned: false, windowId: 1, favIconUrl: "" },
  { id: 9004, url: "about:newtab", title: "New Tab", pinned: false, windowId: 1, favIconUrl: "" },
  { id: 9005, url: "moz-extension://fake-uuid/popup.html", title: "extension page", pinned: false, windowId: 1, favIconUrl: "" },
  { id: 9006, url: "chrome://settings", title: "Settings", pinned: false, windowId: 1, favIconUrl: "" },
  // — host / title text edge cases —
  { id: 9010, url: `https://${"x".repeat(200)}.com/page`, title: "Extremely long host name (200 chars)", pinned: false, windowId: 1, favIconUrl: "" },
  { id: 9011, url: "https://github.com/nihongo/docs", title: "日本語のタイトル — テストページの表示確認", pinned: false, windowId: 1, favIconUrl: "" },
  { id: 9012, url: "https://example.org/arabic", title: "اختبار الصفحة من اليمين إلى اليسار", pinned: false, windowId: 1, favIconUrl: "" },
  { id: 9013, url: "https://duckduckgo.com/?q=emoji", title: "🔥🚀💯 Emoji Party 🎉 (200 chars: " + "🎉".repeat(100) + ")", pinned: false, windowId: 1, favIconUrl: "" },
  { id: 9014, url: "https://example.com/empty-title", title: "", pinned: false, windowId: 1, favIconUrl: "" },
  { id: 9015, url: "https://example.com/very-long-title-" + "suffix/".repeat(10), title: "A very long tab title that keeps going and going and going and going and going and going and going and going until it must truncate somewhere around here", pinned: false, windowId: 1, favIconUrl: "" },
  // — GitHub clustering variants —
  { id: 9020, url: "https://github.com/phcyso", title: "phcyso · GitHub (org root, no repo)", pinned: false, windowId: 1, favIconUrl: "" },
  { id: 9021, url: "https://github.com/phcyso/Tabocalypse-Reaper", title: "GitHub - phcyso/Tabocalypse-Reaper", pinned: false, windowId: 1, favIconUrl: "" },
  { id: 9022, url: "https://github.com/phcyso/Tabocalypse-Reaper/pull/1#discussion_r123", title: "PR #1 discussion", pinned: false, windowId: 1, favIconUrl: "" },
  { id: 9023, url: "https://github.com/phcyso/Tabocalypse-Reaper/issues/42", title: "Issue #42", pinned: false, windowId: 1, favIconUrl: "" },
  { id: 9024, url: "https://raw.githubusercontent.com/phcyso/Tabocalypse-Reaper/main/README.md", title: "README.md (raw)", pinned: false, windowId: 1, favIconUrl: "" },
  { id: 9025, url: "https://gist.github.com/someuser/abc123def", title: "A gist", pinned: false, windowId: 1, favIconUrl: "" },
  { id: 9026, url: "https://notgithub.com/org/repo/tree/main", title: "endsWith('github.com') probe", pinned: false, windowId: 1, favIconUrl: "" },
  // — AWS variants —
  { id: 9030, url: "https://aws.amazon.com/", title: "AWS Cloud Services", pinned: false, windowId: 1, favIconUrl: "" },
  { id: 9031, url: "https://console.aws.amazon.com/eks/home", title: "EKS console", pinned: false, windowId: 1, favIconUrl: "" },
  { id: 9032, url: "https://console.aws.amazon.com/cloudwatch/home", title: "CloudWatch console", pinned: false, windowId: 1, favIconUrl: "" },
  { id: 9033, url: "https://docs.aws.amazon.com/eks/latest/userguide/what-is.html", title: "What is Amazon EKS?", pinned: false, windowId: 1, favIconUrl: "" },
  { id: 9034, url: "https://docs.aws.amazon.com/lambda/latest/dg/welcome.html", title: "Lambda developer guide", pinned: false, windowId: 1, favIconUrl: "" },
  // — confirm-threshold boundary shapes —
  ...Array.from({ length: 9 }, (_, i) => ({ id: 9100 + i, url: `https://nine.example.com/a/${i + 1}`, title: `Nine host tab ${i + 1}`, pinned: false, windowId: 1, favIconUrl: "" })),
  ...Array.from({ length: 10 }, (_, i) => ({ id: 9200 + i, url: `https://ten.example.com/b/${i + 1}`, title: `Ten host tab ${i + 1}`, pinned: false, windowId: 1, favIconUrl: "" })),
  // — multi-window merge probe (same hosts, two windowIds) —
  { id: 9300, url: "https://duckduckgo.com/?q=window-one", title: "DDG search (window 1)", pinned: false, windowId: 1, favIconUrl: "" },
  { id: 9301, url: "https://duckduckgo.com/?q=window-two", title: "DDG search (window 2)", pinned: false, windowId: 2, favIconUrl: "" },
  { id: 9302, url: "https://github.com/octocat/Spoon-Knife", title: "GitHub Spoon-Knife (window 2)", pinned: false, windowId: 2, favIconUrl: "" },
  // — single-tab host (auto-expand empty-ish state) —
  { id: 9400, url: "https://lonely.example.org/only", title: "Single tab on this host", pinned: false, windowId: 1, favIconUrl: "" },
  // — pinned tabs (visible only when Exclude pinned unchecked) —
  { id: 9500, url: "https://mail.example.com/inbox", title: "Webmail (pinned)", pinned: true, windowId: 1, favIconUrl: "" },
  { id: 9501, url: "https://calendar.example.com/", title: "Calendar (pinned)", pinned: true, windowId: 1, favIconUrl: "" },
  // — single cluster with 12 tabs (cluster-level threshold) —
  ...Array.from({ length: 12 }, (_, i) => ({ id: 9600 + i, url: `https://bulk.example.com/item/${i + 1}`, title: `Bulk item ${i + 1}`, pinned: false, windowId: 1, favIconUrl: "" })),
  // — scale filler (total > 150 tabs) —
  ...Array.from({ length: 40 }, (_, i) => ({ id: 9700 + i, url: `https://filler${i}.example.com/page/${i}`, title: `Filler ${i}`, pinned: false, windowId: 1, favIconUrl: "" })),
  ...Array.from({ length: 60 }, (_, i) => ({ id: 9800 + i, url: `https://busyhost.example.com/item/${i}`, title: `Busy host item ${i}`, pinned: false, windowId: 1, favIconUrl: "" }))
];

const emptyNonExcludedTabs = [
  { id: 9900, url: "https://pinned-one.example.com/", title: "Pinned one", pinned: true, windowId: 1, favIconUrl: "" },
  { id: 9901, url: "https://pinned-two.example.com/", title: "Pinned two", pinned: true, windowId: 1, favIconUrl: "" }
];

const tabs = [
  { id: 1, url: "https://duckduckgo.com/?q=typescript", title: "typescript cli at DuckDuckGo", pinned: false, windowId: 1, favIconUrl: "" },
  { id: 2, url: "https://duckduckgo.com/?q=Noraly%20Schoenmaker", title: "Noraly Schoenmaker at DuckDuckGo", pinned: false, windowId: 1, favIconUrl: "" },
  { id: 3, url: "https://chatgpt.com/", title: "ChatGPT", pinned: false, windowId: 1, favIconUrl: "" },
  { id: 4, url: "https://www.reddit.com/r/typescript/comments/xyz", title: "reddit tab", pinned: false, windowId: 1, favIconUrl: "" },
  { id: 5, url: "https://k3s.io/docs", title: "k3s docs", pinned: false, windowId: 1, favIconUrl: "" },
  { id: 6, url: "https://safetyculture.com/", title: "SafetyCulture", pinned: false, windowId: 1, favIconUrl: "" },
  { id: 7, url: "https://duckduckgo.com/?q=extra+search", title: "Additional DuckDuckGo Search", pinned: false, windowId: 1, favIconUrl: "" },
  { id: 8, url: "https://duckduckgo.com/?q=search+two", title: "Second Duck Search", pinned: false, windowId: 1, favIconUrl: "" }
];

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const distRoot = resolve(projectRoot, "dist");

const popupHtmlPath = resolve(distRoot, "popup.html");
const htmlTemplate = await readFile(popupHtmlPath, "utf8");
const popupCss = await readFile(resolve(distRoot, "popup.css"), "utf8");

// Extract the light (:root) and dark (prefers-color-scheme) palettes straight from
// the built popup.css so the harness theme override can never drift from the real
// stylesheet.
function extractPalette(css, variant) {
  const block =
    variant === "dark"
      ? css.match(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\{([^}]*)\}/)
      : css.match(/:root\{([^}]*)\}/);
  const vars = {};
  for (const declaration of block?.[1]?.split(";") ?? []) {
    const [rawName, ...rest] = declaration.split(":");
    const name = rawName?.trim();
    if (name?.startsWith("--") && rest.length > 0) {
      vars[name] = rest.join(":").trim();
    }
  }
  return vars;
}

const themePalettes = {
  light: extractPalette(popupCss, "light"),
  dark: extractPalette(popupCss, "dark"),
};

const distBase = "../../dist/";
const patchAsset = (name) => `${distBase}${name}`;

function buildHtml(tabs) {
  let html = htmlTemplate
    .replace("default-src 'self';", "default-src 'self' 'unsafe-inline';")
    .replace('href="popup.css"', `href="${patchAsset("popup.css")}"`)
    .replace('src="logo.svg"', `src="${patchAsset("logo.svg")}"`);

  const tabsJson = JSON.stringify(tabs).replace(/</g, "\\u003c");
  // Stub surface covers everything popup.js touches: tabs query/create/mutate,
  // tab-change listeners (A9), focused window (F2 chips), storage.session
  // (uiPrefs + undo sweep) and the theme bridge.
  const stubScript = `<script>
  const __tabs = ${tabsJson};
  const __noopListener = { addListener() {}, removeListener() {} };
  const __sessionStore = {};
  window.browser = {
    tabs: {
      async query() { return JSON.parse(JSON.stringify(__tabs)); },
      async remove(ids) { console.info("stub remove", ids); },
      async update(id, info) { console.info("stub update", id, info); },
      async create(info) { console.info("stub create", info); return { id: -1 }; },
      onUpdated: __noopListener,
      onRemoved: __noopListener,
      onCreated: __noopListener
    },
    windows: {
      async getLastFocused() { return { id: 1 }; }
    },
    storage: {
      session: {
        async get(key) { return key in __sessionStore ? { [key]: __sessionStore[key] } : {}; },
        async set(obj) { Object.assign(__sessionStore, obj); },
        async remove(key) { delete __sessionStore[key]; }
      }
    },
    theme: {
      async getCurrent() { return {}; }
    }
  };
</script>`;

  // Audit-only helpers: apply ?filter/&sort/&excludePinned as if typed, and (with
  // &audit=1) provide on-page buttons that set the filter box programmatically.
  // Needed because this machine has no ydotool/keyboard input.
  const auditScript = `<script>
  window.addEventListener("load", () => setTimeout(() => {
    const params = new URLSearchParams(location.search);
    const search = document.getElementById("search");
    const setFilter = (value) => { search.value = value; search.dispatchEvent(new Event("input", { bubbles: true })); };
    if (params.has("filter")) setFilter(params.get("filter"));
    if (params.has("sort")) { const s = document.getElementById("sort"); s.value = params.get("sort"); s.dispatchEvent(new Event("change", { bubbles: true })); }
    if (params.has("excludePinned")) { const c = document.getElementById("excludePinned"); c.checked = params.get("excludePinned") !== "0"; c.dispatchEvent(new Event("change", { bubbles: true })); }
    if (params.get("audit") === "1") {
      const bar = document.createElement("div");
      bar.style.cssText = "position:fixed;bottom:0;left:0;right:0;background:#000c;padding:6px;display:flex;gap:8px;z-index:99";
      const mk = (label, fn) => { const b = document.createElement("button"); b.textContent = label; b.onclick = fn; bar.append(b); };
      mk("filter: github", () => setFilter("github"));
      mk("filter: (", () => setFilter("("));
      mk("filter: *", () => setFilter("*"));
      mk("filter: eks", () => setFilter("eks"));
      mk("clear filter", () => setFilter(""));
      document.body.append(bar);
    }
  }, 80));
</script>`;

  // Presentation helpers: ?theme=dark|light overrides the CSS palette (sourced from
  // popup.css at build time), ?expand=hosts|all clicks twisties open after render.
  // Sets window.__shotReady once settled — scripts/capture-screens.mjs polls for it
  // before capturing (headless screenshots otherwise fire before async renders).
  // NOTE: no nested template literals here — this block is itself a template literal.
  const presentationScript = `<script>
  const __themePalettes = ${JSON.stringify(themePalettes)};
  window.addEventListener("load", () => setTimeout(() => {
    const params = new URLSearchParams(location.search);
    const theme = params.get("theme");
    if (theme === "dark" || theme === "light") {
      const vars = __themePalettes[theme];
      if (vars && Object.keys(vars).length > 0) {
        const style = document.createElement("style");
        const decls = Object.entries(vars).map((entry) => entry[0] + ":" + entry[1]).join(";");
        style.textContent = ":root{" + decls + ";color-scheme:" + theme + "}";
        document.head.append(style);
      }
    }
    const expand = params.get("expand");
    if (expand === "hosts" || expand === "all") {
      document.querySelectorAll(".hostHeader").forEach((header) => {
        if (header.getAttribute("aria-expanded") === "false") header.click();
      });
    }
    if (expand === "all") {
      setTimeout(() => {
        document.querySelectorAll(".clusterHeader").forEach((header) => {
          if (!header.classList.contains("clusterHeaderHidden") && header.getAttribute("aria-expanded") === "false") header.click();
        });
        window.__shotReady = true;
      }, 120);
    } else {
      window.__shotReady = true;
    }
  }, 120));
  </script>`;

  return html.replace(
    '<script type="module" src="popup.js"></script>',
    `${stubScript}${auditScript}${presentationScript}<script type="module" src="${patchAsset("popup.js")}"></script>`
  );
}

// --- Screenshot showcase (marketing/docs shots) ---------------------------------
// Curated, photogenic tab set for scripts/capture-screens.mjs (and any manual
// capture run). Data-URI SVG favicons render deterministically offline — real
// network favicons would make screenshots non-reproducible.
const icon = (letter, bg) =>
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="${bg}"/><text x="8" y="12" font-family="sans-serif" font-size="10" font-weight="700" fill="#fff" text-anchor="middle">${letter}</text></svg>`
  );

const showcaseTabs = [
  { id: 7001, url: "https://github.com/phcyso/Tabocalypse-Reaper", title: "GitHub - phcyso/Tabocalypse-Reaper: End your tab chaos", pinned: false, windowId: 1, favIconUrl: icon("G", "#24292f") },
  { id: 7002, url: "https://github.com/phcyso/Tabocalypse-Reaper/pull/37", title: "Add session restore support by phcyso · Pull Request #37", pinned: false, windowId: 1, favIconUrl: icon("G", "#24292f") },
  { id: 7003, url: "https://github.com/phcyso/Tabocalypse-Reaper/issues/42", title: "Favicon flicker on refresh · Issue #42", pinned: false, windowId: 1, favIconUrl: icon("G", "#24292f") },
  { id: 7004, url: "https://github.com/octocat/Spoon-Knife", title: "GitHub - octocat/Spoon-Knife: The repo everyone forks", pinned: false, windowId: 1, favIconUrl: icon("G", "#24292f") },
  { id: 7005, url: "https://github.com/octocat/Spoon-Knife/blob/main/README.md", title: "Spoon-Knife docs: fork a sample repo", pinned: false, windowId: 1, favIconUrl: icon("G", "#24292f") },
  { id: 7010, url: "https://docs.aws.amazon.com/eks/latest/userguide/what-is.html", title: "What is Amazon EKS? - Amazon EKS", pinned: false, windowId: 1, favIconUrl: icon("A", "#ff9900") },
  { id: 7011, url: "https://docs.aws.amazon.com/lambda/latest/dg/welcome.html", title: "Lambda developer guide - AWS", pinned: false, windowId: 1, favIconUrl: icon("A", "#ff9900") },
  { id: 7012, url: "https://console.aws.amazon.com/eks/home", title: "Amazon EKS console", pinned: false, windowId: 1, favIconUrl: icon("A", "#ff9900") },
  { id: 7013, url: "https://console.aws.amazon.com/cloudwatch/home", title: "CloudWatch console", pinned: false, windowId: 1, favIconUrl: icon("A", "#ff9900") },
  { id: 7020, url: "https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions", title: "WebExtensions - Mozilla | MDN", pinned: false, windowId: 1, favIconUrl: icon("M", "#1b1b1b") },
  { id: 7021, url: "https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/update", title: "tabs.update() - MDN", pinned: false, windowId: 2, favIconUrl: icon("M", "#1b1b1b") },
  { id: 7030, url: "https://news.ycombinator.com/news", title: "Hacker News", pinned: false, windowId: 2, favIconUrl: icon("Y", "#ff6600") },
  { id: 7031, url: "https://example.com/blog/2026-review", title: "Year in review: shipping a Firefox extension", pinned: false, windowId: 2, favIconUrl: icon("B", "#7c3aed") },
  { id: 7032, url: "https://example.com/blog/reaper-build", title: "How I built a tab reaper", pinned: false, windowId: 2, favIconUrl: icon("B", "#7c3aed") },
  { id: 7040, url: "https://mail.example.com/inbox", title: "Inbox (3) - Mail", pinned: true, windowId: 1, favIconUrl: icon("@", "#0369a1") },
  { id: 7041, url: "https://calendar.example.com/week", title: "Week 45 - Calendar", pinned: true, windowId: 1, favIconUrl: icon("C", "#dc2626") }
];

await writeFile(
  resolve(projectRoot, "tests/fixtures/popup-harness.html"),
  buildHtml(tabs)
);
await writeFile(
  resolve(projectRoot, "tests/fixtures/popup-harness-showcase.html"),
  buildHtml(showcaseTabs)
);
await writeFile(
  resolve(projectRoot, "tests/fixtures/popup-harness-audit-weird.html"),
  buildHtml(auditTabs)
);
await writeFile(
  resolve(projectRoot, "tests/fixtures/popup-harness-audit-empty.html"),
  buildHtml(emptyNonExcludedTabs)
);
