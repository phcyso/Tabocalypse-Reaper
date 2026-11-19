# Design & Research Notes (historical)

Design log from the initial build (v0.4.x). Kept for context on *why* the
extension is shaped the way it is; the shipped behaviour is documented in the
root [README](../README.md) and [AGENT.md](../AGENT.md).

## Approach validation & assumptions
- **Shallow hierarchy (Host → Cluster) is faster** than deep trees for scanning/closing; aligns with Sidebery/Tab Manager patterns. (Refs below)
- **Cluster keys**: first path segment; GitHub = org/repo; AWS = first segment. Good balance of meaning vs. complexity.
- **Counts**: bottom‑up unique IDs; cluster = length; host = union of clusters.
- **Favicons**: enable via CSP `img-src https: data: moz-extension:`; significantly improves scan speed.
- **Theme adaptation**: try `browser.theme.getCurrent()`; fallback `prefers-color-scheme`.
- **Bulk close**: single `tabs.remove([...])` per group.

## Branding
**Name**: Tabocalypse Reaper  
**Tagline**: End your tab chaos with one clean sweep.  
Logo: `src/logo.svg` (purple gradient, skull+scythe); PNG icons in `src/icons/`.

## Store listing (draft)
**Short** — Reap your tab chaos. Group by site and path, preview, and close whole clusters in one click.  
**Long** — Groups tabs by **host → cluster** (special GitHub/AWS handling). Shows favicons for quick scanning, accurate counts, purple theme that adapts to your browser. Reap entire groups or pick individual tabs. Works across windows. Options: filter, exclude pinned.

**Permissions** — `tabs` (enumerate/close tabs), `storage` (persist options), `theme` (adapt to browser theme).

## References
- Tree Style Tab: AMO listing — shows deep hierarchical approach. https://addons.mozilla.org/en-US/firefox/addon/tree-style-tab/
- Sidebery: AMO listing — two‑tier, configurable panels. https://addons.mozilla.org/en-US/firefox/addon/sidebery/
- Tab Manager Plus: Chrome Web Store — flat list with favicons, quick actions. https://chromewebstore.google.com/detail/tab-manager-plus-for-chro/cnkdjjdmfiffagllbiiilooaoofcoeff
- MDN `theme.getCurrent()` — theme adaptation. https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/theme/getCurrent
- MDN `tabs.remove()` — close multiple tabs via array. https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/remove
- MDN `img-src` — CSP directive for favicons. https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/img-src
