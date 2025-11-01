# Tabocalypse Reaper – Agent Quick Guide

Purpose: Firefox WebExtension (manifest v2) that groups open tabs Host → Cluster for fast bulk closing and navigation. Source now lives in `src/` with modular TypeScript (`browser/`, `dom/`, `model/`, `theme/`, `utils/`) and `popup.ts` orchestrating them. Compile to `dist/` with `npm run prepare` before handing the directory to `web-ext`.

## Core Cycle
`queryOpenTabs()` → `buildTabModel()` → `renderTree()`; user actions call `refresh()` (re-runs cycle). Keep this flow typed—prefer explicit interfaces over `any` so the compiler guards the model invariants.

## Function Contracts
- `queryOpenTabs()`: returns light array of tab objects (id, url, title, pinned, windowId, favIconUrl).
- `buildTabModel(tabs, { excludePinned, normalize, filter })`: builds root node with `children` (Map host→node), each host node has cluster nodes; computes counts and ID sets.
- `renderTree(root, { sortMode, onRefresh })`: clones templates (`#hostTemplate`, `#clusterTemplate`, `#tabTemplate`), sorts (count or alpha), wires handlers (twisty, reap, tab activate).
- `refresh()`: reads UI state (checkboxes, search, sort), calls above.

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
- Bulk close via `browser.tabs.remove([...ids])` (host or cluster). Confirm if ≥10 (`CONFIRM_THRESHOLD`).
- Sort hosts/clusters by count (default) or alpha; tabs inside cluster sorted by title.

## Icon Logic
- **Host icons**: Display favicon from first available tab in the host (searches through clusters until a favicon is found). Falls back to empty/placeholder if no favicon available.
- **Cluster icons**: Display favicon from first tab in the cluster. Falls back to empty/placeholder if no favicon available.
- **Tab icons**: Display individual tab favicon. Already implemented via `.ico` class.
- All icons use `.ico` class for consistent styling (14-16px, rounded corners, background fallback).

## Theme Adaptation
`applyThemeFromBrowser()` maps `theme.colors` into CSS vars (`--card`, `--text`, `--bg`, `--accent`, etc.). Fallback: native `prefers-color-scheme` defined in `popup.css`.

## Module Layout
- `browser/tabs.ts`: WebExtension tab queries and mutations.
- `dom/query.ts`: element lookup helpers (`requireElement`, `requireDescendant`).
- `dom/render.ts`: DOM templating and event wiring. Takes a `RenderContext` so other callers/tests can reuse the renderer.
- `model/`: node types, builders, clustering, and pure helpers (see `utils/url.ts`).
- `theme/applyTheme.ts`: theme bridge.
- `shared/constants.ts`: shared numeric/string constants (e.g., confirm threshold).

Keep new code close to the relevant module; prefer pure helpers in `model/` and `utils/` so they can be unit-tested.

## Filtering
Search box matches lowercased concatenation: `host pathname title`. Schemes excluded: `about:`, `moz-extension:`, `chrome:`. Optional pinned exclusion and normalization toggles.

## UX Conventions
Twisty buttons toggle bodies (`▸` / `▾`). "Reap" buttons trigger bulk close; single tab close uses `✕` button; clicking title focuses tab via `browser.tabs.update(id,{active:true})` instead of navigation.

## Extension Specifics
Manifest v2 uses `browser_action`. Permissions: `tabs`, `storage` (future), `theme`. CSP in `src/popup.html` allows favicons `img-src 'self' https: data: moz-extension:`.

## Source + Build Layout
- Author changes inside `src/`; `dist/` is disposable output and should stay untracked.
- `npm run prepare` = clean (`rimraf dist/`) + TypeScript build + static asset copy. `npm run build` wraps that and calls `web-ext build --source-dir dist`.
- `npm run dev` runs the TypeScript compiler and asset copier in watch mode alongside `web-ext run --source-dir dist`.

## Testing & Verification
- `npm run test`: Vitest unit tests under `tests/` (cover URL helpers and the tab model).
- `npm run lint`: runs `typecheck`, `test`, rebuilds `dist/`, then executes `web-ext lint`.
- `npm run typecheck`: quick TypeScript validation without rebuilding output.

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