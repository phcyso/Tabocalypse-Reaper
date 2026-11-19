# Tabocalypse Reaper – Agent Quick Guide

Purpose: Firefox WebExtension (manifest v2) that groups open tabs Host → Cluster for fast bulk closing and navigation. Source now lives in `src/` with modular TypeScript (`browser/`, `dom/`, `model/`, `theme/`, `utils/`) and `popup.ts` orchestrating them. Compile to `dist/` with `npm run prepare` before handing the directory to `web-ext`.

## Core Cycle
`queryOpenTabs()` → `buildTabModel()` → `renderTree()`; user actions call `refresh()` (re-runs cycle). Keep this flow typed—prefer explicit interfaces over `any` so the compiler guards the model invariants.

## Function Contracts
- `queryOpenTabs()`: returns light array of tab objects (id, url, title, pinned, windowId, favIconUrl, lastAccessed, active).
- `queryFocusedWindowId()`: window the popup is docked to (windows.getLastFocused, with active-tab fallback) — drives the W-chips.
- `buildTabModel(tabs, { excludePinned, filter })`: builds root node with `children` (Map host→node), each host node has cluster nodes; computes counts and ID sets. Cluster tabs carry windowId/lastAccessed/active for the chips, staleness and duplicate logic.
- `renderTree(root, { sortMode, onRefresh, focusedWindowId, multiWindow, now, ... })`: clones templates (`#hostTemplate`, `#clusterTemplate`, `#tabTemplate`, `#soloTemplate`), sorts (count, alpha, or stale — always tie-broken by name), wires handlers (twisty, reap, reap-stale, close-dups, tab activate).
- `refresh()`: reads UI state (checkboxes, search, sort), calls above; also passes focusedWindowId/multiWindow/now into the render context.

## Data Model Shape
Node: `{ name, kind: 'root'|'host'|'cluster', children: Map, tabs: [], ids: Set, count }`.
Host count = unique tab IDs across its clusters. Cluster count = `tabs.length`.

## Clustering Rules (`deriveClusterKey`)
- GitHub: `github.com/org/repo/...` → key=`org/repo`.
- AWS: domains containing `aws.amazon.com` or `docs.aws.amazon.com` → key= first path segment.
- Generic: key= first path segment or `/` if none.

## URL Normalization (`normalizeUrl`)
- Strip tracking params: keys matching /(utm_|fbclid|gclid|yclid|mc_cid|mc_eid|ref)/i.
- Remove trailing slashes.
- Rebuild search string; fallback to original if parse fails.

## Rendering & Performance Patterns
- Use `<template>` cloning; avoid `innerHTML` mass string ops.
- Shallow hierarchy (Host → Cluster only) to keep DOM light.
- Bulk close via `browser.tabs.remove([...ids])`. Confirm if ≥10 (`CONFIRM_THRESHOLD`) using the in-popup themed modal (`showConfirmDialog` in `dom/render.ts`) — NOT native `confirm()`; it previews the affected tab titles. Single-tab ✕ closes **optimistically** (row removed instantly, `onRefresh` resyncs on API failure). Scroll bottom fade is the static `.treeFade` overlay — never put `mask-image` on the scrolling `.tree` (ghost-arc artifact).
- Sort hosts/clusters by count (default) or alpha; tabs inside cluster sorted by title.

## Icon Logic
- **Host icons**: Display favicon from first available tab in the host (searches through clusters until a favicon is found). Falls back to a letter-avatar tile (first letter of the host in a deterministic hue from `utils/avatar.ts`) when no favicon resolves.
- **Cluster icons**: Display favicon from first tab in the cluster. Same letter-avatar fallback, seeded by the host name.
- **Tab icons**: Display individual tab favicon, same fallback. Already implemented via `.ico` class.
- All icons use `.ico` class for consistent styling (14-16px, rounded corners); the fallback lives in the sibling `.icoFallback` span (toggled by `applyFavicon` in `dom/render.ts`) so favicons and avatars never fight for the same element.

## Theme Adaptation
`applyThemeFromBrowser()` maps `theme.colors` into CSS vars (`--card`, `--text`, `--bg`, `--accent`, etc.). Fallback: native `prefers-color-scheme` defined in `popup.css`.

## Module Layout
- `browser/tabs.ts`: WebExtension tab queries and mutations (incl. `queryFocusedWindowId`, `reopenTab` for undo).
- `browser/storage.ts`: session-storage bridge (`uiPrefs`, undoable `lastSweep`).
- `dom/query.ts`: element lookup helpers (`requireElement`, `requireDescendant`).
- `dom/render.ts`: DOM templating and event wiring. Takes a `RenderContext` so other callers/tests can reuse the renderer.
- `dom/reapUndo.ts`: undo toast + sweep persistence glue (review F1).
- `model/`: node types, builders, clustering, duplicate detection, and pure helpers (see `utils/url.ts`, `utils/age.ts`, `utils/avatar.ts`).
- `theme/applyTheme.ts`: theme bridge.
- `shared/constants.ts`: shared numeric/string constants (confirm threshold, stale threshold, auto-collapse host count, undo toast lifetime).

Keep new code close to the relevant module; prefer pure helpers in `model/` and `utils/` so they can be unit-tested.

## Filtering
Search box matches lowercased concatenation: `host pathname title`. Schemes excluded: `about:`, `moz-extension:`, `chrome:`. Additionally, **host-less URLs** are skipped after parsing (`file:`, `data:`, `view-source:`, `javascript:`, `blob:` all parse with `host === ""`) so an unnamed host card can never be created (audit F-4). Optional pinned exclusion toggle.

## UX Conventions
Twisty buttons toggle bodies (`▸` / `▾`). "Reap" buttons trigger bulk close; single tab close uses `✕` button; clicking title focuses tab via `browser.tabs.update(id,{active:true})` instead of navigation. **Pinned tabs** (audit F-5): rows carry a 📌 glyph; host/cluster bulk Reap **excludes pinned IDs** — if every tab in the group is pinned its Reap is disabled with the reason in its tooltip ("All pinned — nothing to reap"); a partial reap (pinned tabs survive) triggers a full refresh instead of incremental card removal. Groups containing pinned tabs show a "📌 N" chip and their Reap tooltip reads "Closes N · pinned survive". Per-tab `✕` still closes pinned tabs (explicit single action). **UI state** (audit F-11): `{sort, excludePinned}` persist for the browsing session via `browser.storage.session` (key `uiPrefs`) and are restored in `init()` before the first refresh; the filter text is intentionally session-only — it is never persisted.

**Compact list (review A1)**: hosts with exactly one tab render as a single row (favicon + host + title + ✕, `#soloTemplate`) with no card chrome; multi-tab hosts keep cards, collapsed by default; when more than `AUTO_COLLAPSE_HOST_COUNT` (20) hosts are visible on open, everything auto-collapses.

**Undo (review F1)**: every bulk reap (host Reap, cluster Reap, Reap stale, Close dups) stores its sweep `{url, title, pinned, windowId}[]` in `browser.storage.session` (key `lastSweep`, via `dom/reapUndo.ts`) and shows a "Reaped N · Undo" toast that auto-dismisses after `UNDO_TOAST_MS` (8 s). Undo recreates tabs with `browser.tabs.create` — best-effort: same window and pin state are restored, original positions are not recoverable. Reopening the popup with a stored sweep resurrects the toast. Single-tab `✕` is NOT a reap: no sweep, no toast.

**Staleness (review F3)**: tab rows carry relative age chips ("3m"/"3h"/"2d", hidden under a minute — `utils/age.ts`); "Sort: Recently stale first" orders stalest-first with an A→Z tie-break; hosts with stale unpinned tabs get a "Reap stale" button (`STALE_MS`, 24 h default) that closes only tabs older than the threshold, pinned rules identical to Reap.

**Duplicates (review F8)**: rows sharing a normalized URL (`normalizeUrl`) get "×N" chips; hosts with closable duplicates get a "Close dups" button that keeps the active (else most recently accessed) copy and closes the rest — pinned copies always survive (`model/duplicates.ts`).

**Window awareness (review F2)**: when tabs span multiple windows, rows from non-focused windows carry "W2"-style chips and host headers show a "⧉ N" chip when the host spans windows.

**Stale-order pill (review A9)**: tabs changing while the popup is open (tabs.onUpdated/onRemoved/onCreated) or after an incremental reap surface the accent-tinted "Sort outdated — Refresh" pill; any full refresh clears it.

**Keyboard (review A10)**: `/` focuses the filter from anywhere in the popup; the filter placeholder advertises it; sort options are labeled "Sort: Most tabs" / "Sort: A–Z" / "Sort: Recently stale first".

## Extension Specifics
Manifest v2 uses `browser_action`. Permissions: `tabs`, `storage` (session: UI prefs + last reap for Undo), `theme`. CSP in `src/popup.html` allows favicons `img-src 'self' https: data: moz-extension:`.

## Source + Build Layout
- Author changes inside `src/`; `dist/` is disposable output and should stay untracked.
- `npm run prepare` = clean (`rimraf dist/`) + TypeScript build + static asset copy. `npm run build` wraps that and calls `web-ext build --source-dir dist`.
- `npm run dev` runs the TypeScript compiler and asset copier in watch mode alongside `web-ext run --source-dir dist`.

## Testing & Verification
- `npm run test`: Vitest unit tests under `tests/` (cover URL helpers and the tab model).
- `npm run lint`: runs `typecheck`, `test`, rebuilds `dist/`, then executes `web-ext lint`.
- `npm run typecheck`: quick TypeScript validation without rebuilding output.
- `npm run verify:popup`: rebuilds `dist/`, regenerates the popup harness fixture, and runs the Vitest suite—use this before capturing new UI screenshots.

## Visual Regression Workflow
- After every UI-facing change, capture fresh screenshots. Playwright MCP server for harness captures; for real-Firefox verification (primary on this machine) use `grim` window captures per `docs/e2e-firefox-testing.md` §6. Computer-use tool screenshots are ephemeral (conversation-only) — persist anything you need to cite with `grim`.
- Canonical marketing/docs shots (`docs/img/`) regenerate via `npm run screens` — headless Firefox + WebDriver BiDi over the harness fixtures, no interaction needed (see `scripts/capture-screens.mjs`).
- Store captures inside `test-screenshots/` using descriptive names that reflect the feature or regression scenario (e.g., `<FEATURE_NAME>-condensed-view-<TIME>.png`, `<FEATURE-NAME>-cluster-toggle-regression-<TIME>.png`). Don’t overwrite previous captures—pick a unique name per change so prior history stays intact.
- Playwright saves screenshots to a process-private temp directory (e.g., `/var/.../playwright-mcp-output/...`). Copy or move the capture into `test-screenshots/` immediately—don’t expect reviewers to access the temp path.
- Treat these captures as living documentation—update them alongside DOM/CSS adjustments so reviewers can compare diffs and ensure the popup still renders as expected.
- See `docs/playwright-harness.md` for the end-to-end Playwright MCP workflow, including harness regeneration and scenario setup tips.
- For full end-to-end testing in a **real Firefox** (temp profile via `web-ext run`, driven with the Pi computer-use desktop tools), follow `docs/e2e-firefox-testing.md`. Do not use Chrome/CDP-based browser tools (e.g. agent-browser) for this extension—they cannot load Firefox add-ons.

## Scratch space (never committed)

`scratch/` is a gitignored workspace for **transient task artifacts**: audit
findings, agent hand-off briefs, working notes, throwaway repro scripts, and
scratch fixtures. Nothing in it is ever committed — durable knowledge belongs in
AGENT.md, `docs/`, or the README once it has proven useful.

- Name files descriptively with a date prefix, e.g.
  `scratch/2026-11-09-usability-findings.md` or `scratch/2026-11-09-audit-brief.md`.
- Folder exists only after first use (`mkdir -p scratch`); don't track a placeholder.
- Captures you intend to cite as evidence go to `test-screenshots/` (also
  gitignored); pure throwaway output can live in `scratch/`.
- Audit reports and hand-off briefs MUST live here, not in `docs/` — `docs/` is
  for durable documentation only.

## Local Run
Load temporary add-on: Firefox → `about:debugging#/runtime/this-firefox` → "Load Temporary Add-on…" → select `dist/manifest.json` after running `npm run prepare`.

## Safe Changes Guidelines
Preserve node shape; update counts after modifying clustering or filters. For new clustering, adjust only `deriveClusterKey()`. Keep bulk operations array-based. Wrap tab ops in try/catch (already pattern).

## Common Pitfalls
- Forgetting to recompute counts when altering `buildTabModel` logic.
- Deep nesting (avoid adding another layer; impacts performance & UI).
- Breaking CSP if adding external assets (update meta tag if needed).
- Using Chrome MV3 fields (`action`)—stay MV2 for Firefox.

(End)
