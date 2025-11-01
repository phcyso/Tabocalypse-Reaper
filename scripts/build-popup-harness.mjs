#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

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
let html = await readFile(popupHtmlPath, "utf8");

const distBase = pathToFileURL(distRoot + "/").href;
const patchAsset = (name) => `${distBase}${name}`;

html = html
  .replace("default-src 'self';", "default-src 'self' 'unsafe-inline';")
  .replace('href="popup.css"', `href="${patchAsset("popup.css")}"`)
  .replace('src="logo.svg"', `src="${patchAsset("logo.svg")}"`);

const tabsJson = JSON.stringify(tabs).replace(/</g, "\\u003c");
const stubScript = `<script>
  const __tabs = ${tabsJson};
  window.browser = {
    tabs: {
      async query() { return JSON.parse(JSON.stringify(__tabs)); },
      async remove(ids) { console.info("stub remove", ids); },
      async update(id, info) { console.info("stub update", id, info); }
    },
    theme: {
      async getCurrent() { return {}; }
    }
  };
</script>`;

html = html.replace(
  '<script type="module" src="popup.js"></script>',
  `${stubScript}<script type="module" src="${patchAsset("popup.js")}"></script>`
);

const outputPath = resolve(projectRoot, "tests/fixtures/popup-harness.html");
await writeFile(outputPath, html);
