# Playwright MCP Pop-up Harness Guide

This note captures the workflow that worked well in November 2025 for validating the Firefox popup via the Playwright MCP bridge. Keep it handy whenever you need fresh UI captures or want to tweak the local harness.

---

## 1. Rebuild & Test Before Capturing

Always make sure the built artifacts and tests are green _before_ opening Playwright. The helper script chains the necessary steps:

```bash
npm run verify:popup
```

This runs `npm run prepare`, regenerates the popup harness fixture, and executes the Vitest suite so `dist/` and `tests/fixtures/popup-harness.html` are up to date.

## 2. Regenerate the Harness Fixture (if needed)

`npm run verify:popup` already runs the harness build, but you can invoke it manually when experimenting:

```bash
node scripts/build-popup-harness.mjs
```

The script copies the bundled assets, patches CSP for inline data, and writes `tests/fixtures/popup-harness.html`. It relies on the tab definitions inside `scripts/build-popup-harness.mjs`.

### Adding Custom Tab Setups

Edit the `tabs` array at the top of `scripts/build-popup-harness.mjs`. Each entry is a minimal browser tab stub:

```js
const tabs = [
  {
    id: 101,
    url: "https://example.com/guides/onboarding",
    title: "Example – Onboarding Guide",
    pinned: false,
    windowId: 2,
    favIconUrl: ""
  },
  {
    id: 102,
    url: "https://docs.example.com/api?ref=playwright",
    title: "Example API Docs",
    pinned: false,
    windowId: 2,
    favIconUrl: ""
  },
  // Add more stubs to model multi-host or multi-cluster scenarios
];
```

Tips:

- **Multiple hosts:** use different domains (`example.com`, `docs.example.com`) to exercise host grouping and collapse logic.
- **Multiple clusters per host:** differentiate the first path segment (`/guides/...`, `/docs/...`) or leverage special clustering rules (e.g., GitHub repos).
- **Single-tab clusters:** include hosts with only one tab to confirm the compact solo-row behavior (rendered via `#soloTemplate` — one row, no twisty); go past 20 hosts (`AUTO_COLLAPSE_HOST_COUNT`) to verify big sessions auto-collapse.
- **Pinned tabs:** toggle the `pinned` flag to verify filter handling.

After editing, re-run `node scripts/build-popup-harness.mjs` (or `npm run verify:popup`) so the fixture picks up the new state.

### Audit additions (2026-10-26)

The build script now emits two extra fixtures (the default one is untouched) and the
stub honours URL params on any fixture:

- `tests/fixtures/popup-harness-audit-weird.html` — 161-tab edge-case set: 200-char
  host, CJK/RTL/emoji/empty titles, `file:`/`data:`/`about:`/`moz-extension:`/`chrome:`
  schemes, GitHub variants (org root, PR fragment, raw, gist, `notgithub.com` probe),
  AWS apex/console/docs, 9- and 10-tab threshold shapes, a 12-tab single cluster,
  pinned tabs, two `windowId`s, plus filler to exercise scale.
- `tests/fixtures/popup-harness-audit-empty.html` — pinned tabs only (zero
  non-excluded ⇒ empty state).
- URL params: `?filter=<text>&sort=count|alpha&excludePinned=0|1` are applied as if
  typed at load; `&audit=1` adds on-page buttons that set the filter programmatically
  (`filter: github`, `filter: (`, `filter: *`, `clear filter`, …) — useful when no
  keyboard input is available.

### Opening fixtures without Playwright

The fixtures are plain `file://` pages — seed one directly in the isolated real-Firefox
instance alongside the extension:

```bash
web-ext run --source-dir dist ... --url file://$PWD/tests/fixtures/popup-harness.html
```

The stub provides `browser.*`, so no extension loading is involved for the fixture tab,
and `confirm()` dialogs work there (threshold flows are testable harness-side too).
Caveat: fixture edits require a page reload (F5). Without a keyboard, prefer URL params
(applied at load), put all scenarios in one fixture, or relaunch `web-ext run` with the
updated fixture as a seed.

## 3. Launch Playwright MCP

1. `mcp.playwright.browser_navigate` to `file://.../tests/fixtures/popup-harness.html`
2. Optionally interact (expand hosts, change sort) using MCP click commands.
3. `mcp.playwright.browser_take_screenshot` with `fullPage: true` and `scale: "css"` for consistent output.

Example sequence:

```jsonc
// Navigate
{ "url": "file:///path/to/Tabocalypse-Reaper/tests/fixtures/popup-harness.html" }

// Capture
{
  "fullPage": true,
  "type": "png",
  "scale": "css"
}
```

## 4. Store Screenshots

- Save captures under `test-screenshots/`.
- Use descriptive filenames with the date and scenario, e.g.:

  ```
  test-screenshots/popup-harness-2025-11-01.png
  test-screenshots/popup-harness-multi-cluster-2025-11-01.png
  ```

- Add new files to Git so reviewers can diff UI changes alongside code.

## 5. When to Regenerate

| Situation | Action |
|-----------|--------|
| DOM/CSS changes to popup | `npm run verify:popup`, rebuild harness, capture new screenshots |
| Harness data changes | Update `tabs` array, rebuild harness, capture new screenshots |
| Failing tests or lint | Fix failures _before_ trusting screenshots |

Following this routine keeps the MCP captures trustworthy and reproducible. Refer back to this doc whenever you need to adjust the popup harness scenarios or refresh the UI imagery.
