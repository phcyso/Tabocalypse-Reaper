# Tabocalypse Reaper – Agent Quick Guide

Purpose: Firefox WebExtension (manifest v2) that groups open tabs Host → Cluster for fast bulk closing and navigation. Single‑file logic (`popup.js`). No build step.

## Core Cycle
`pullTabs()` → `buildModel()` → `render()`; user actions call `refresh()` (re-runs cycle).

## Function Contracts
- `pullTabs()`: returns light array of tab objects (id, url, title, pinned, windowId, favIconUrl).
- `buildModel(tabs, { excludePinned, normalize, filter })`: builds root node with `children` (Map host→node), each host node has cluster nodes; computes counts and ID sets.
- `render(root)`: clones templates (`#hostTemplate`, `#clusterTemplate`, `#tabTemplate`), sorts (count or alpha), wires handlers (twisty, reap, tab activate).
- `refresh()`: reads UI state (checkboxes, search, sort), calls above.

## Data Model Shape
Node: `{ name, kind: 'root'|'host'|'cluster', children: Map, tabs: [], ids: Set, count }`.
Host count = unique tab IDs across its clusters. Cluster count = `tabs.length`.

## Clustering Rules (`clusterFor`) 
- GitHub: `github.com/org/repo/...` → key=`org/repo`.
- AWS: domains containing `aws.amazon.com` or `docs.aws.amazon.com` → key= first path segment.
- Generic: key= first path segment or `/` if none.

## URL Normalization (`normalizeURL`)
- Strip tracking params: keys matching /(utm_|fbclid|gclid|yclid|mc_cid|mc_eid|ref)/i.
- Remove trailing slashes.
- Rebuild search string; fallback to original if parse fails.

## Rendering & Performance Patterns
- Use `<template>` cloning; avoid `innerHTML` mass string ops.
- Shallow hierarchy (Host → Cluster only) to keep DOM light.
- Bulk close via `browser.tabs.remove([...ids])` (host or cluster). Confirm if ≥10 (`CONFIRM_THRESHOLD`).
- Sort hosts/clusters by count (default) or alpha; tabs inside cluster sorted by title.

## Theme Adaptation
`applyThemeFromBrowser()` maps `theme.colors` into CSS vars (`--card`, `--text`, `--bg`, `--accent`, etc.). Fallback: native `prefers-color-scheme` defined in `popup.css`.

## Filtering
Search box matches lowercased concatenation: `host pathname title`. Schemes excluded: `about:`, `moz-extension:`, `chrome:`. Optional pinned exclusion and normalization toggles.

## UX Conventions
Twisty buttons toggle bodies (`▸` / `▾`). "Reap" buttons trigger bulk close; single tab close uses `✕` button; clicking title focuses tab via `browser.tabs.update(id,{active:true})` instead of navigation.

## Extension Specifics
Manifest v2 uses `browser_action`. Permissions: `tabs`, `storage` (future), `theme`. CSP in `popup.html` allows favicons `img-src 'self' https: data: moz-extension:`.

## Local Run
Load temporary add-on: Firefox → `about:debugging#/runtime/this-firefox` → "Load Temporary Add-on…" → select `manifest.json`.

## Safe Changes Guidelines
Preserve node shape; update counts after modifying clustering or filters. For new clustering, adjust only `clusterFor()`. Keep bulk operations array-based. Wrap tab ops in try/catch (already pattern).

## Common Pitfalls
- Forgetting to recompute counts when altering buildModel logic.
- Deep nesting (avoid adding another layer; impacts performance & UI).
- Breaking CSP if adding external assets (update meta tag if needed).
- Using Chrome MV3 fields (`action`)—stay MV2 for Firefox.

(End)