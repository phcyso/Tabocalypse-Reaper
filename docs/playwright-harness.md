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
- **Single-tab clusters:** include hosts with only one tab to confirm the “auto-expand single tab” behavior.
- **Pinned tabs:** toggle the `pinned` flag to verify filter handling.

After editing, re-run `node scripts/build-popup-harness.mjs` (or `npm run verify:popup`) so the fixture picks up the new state.

## 3. Launch Playwright MCP

1. `mcp.playwright.browser_navigate` to `file://.../tests/fixtures/popup-harness.html`
2. Optionally interact (expand hosts, change sort) using MCP click commands.
3. `mcp.playwright.browser_take_screenshot` with `fullPage: true` and `scale: "css"` for consistent output.

Example sequence:

```jsonc
// Navigate
{ "url": "file:///Users/kim/dev/Tabocalypse-Reaper/tests/fixtures/popup-harness.html" }

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
