# Changelog

All notable changes to Tabocalypse Reaper are documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/); dates are UTC.

## [Unreleased]

### Added
- **Window-scoped by default** with an "All windows" toolbar toggle
  (session-persisted): the popup now counts and reaps only the tabs of the
  window it was opened from, matching common expectations; the toggle
  restores the legacy cross-window view (W2/⧉N chips only render there). A
  scoped-and-empty popup now explains how many tabs live in other windows.
- **Firefox container support** (contextual identities, `contextualIdentities`
  permission — silent): rows carry colored container-name chips (default
  container never shows one); a "Sort: By container" view groups tabs by
  container (default-container tabs under "(no container)"); container cards
  carry the container's color; duplicate copies in *different* containers are
  protected from "Close duplicates" and flagged informationally; Undo reopens
  closed tabs back into their container.
- **Firefox tab-group support** (tabGroups API, FF 139+, silently
  feature-detected — the `tabGroups` manifest permission requires Firefox 139,
  which is now the `strict_min_version` floor): rows carry colored group-name chips;
  a new "Sort: By tab group" view groups tabs by their Firefox tab group
  (ungrouped tabs collect under "(no group)"); duplicate copies that live in
  *different* groups are protected from "Close duplicates" (cross-group
  duplicates are intentional organization) and get an informational chip; the
  confirm modal warns when a reap would close a tab group's last member
  (Firefox deletes the group); Undo puts reopened tabs back into their groups
  when those groups still exist. Group ids are never persisted — Firefox
  reassigns them on session restore.
- **Themed in-popup confirm modal** for every bulk reap (host / cluster / stale /
  duplicates) once the ≥10 `CONFIRM_THRESHOLD` is exceeded: shows the exact scope
  ("Reap N tabs under *host*?"), a pinned-survive note when relevant, and a
  preview list of the affected tab titles (first 8 + "… and N more") with
  Cancel / **Reap N** actions. Replaces the native `confirm()` alert, which gave
  no context about what was being closed. Enter confirms, Escape or clicking
  outside cancels; the popup list is dimmed behind the dialog. (`dom/render.ts`,
  `popup.css`)
- **Docker-based headed-testing and marketing screenshot suite** (`docker/`):
  - `docker/Dockerfile` + `docker-compose.yml` — agent image (firefox-esr +
    Xvfb + openbox + xdotool + ImageMagick + web-ext + python3-selenium) and a
    pulled `selenium/standalone-firefox` service; the extension always arrives
    via bind-mounted `dist/` as a temporary/per-profile add-on, never baked in.
  - `docker/test-selenium.py` — 10-step WebDriver validation (temporary add-on
    install → chrome-context setup → real Unified-Extensions popup → DOM
    assertions → reap verified against `gBrowser.tabs.length`).
  - `docker/shoot.py` + `docker/scenarios/*.json` — data-driven themed
    screenshot scenarios (50+ monster, GitHub power user, AWS chaos, doom pile,
    pinned tabs, cross-window, filter) in Firefox dark/purple/light, with a
    generated purple static theme; writes full-frame + pixel-exact popup crops
    + JSON manifests.
  - `docker/make-amo.py` — AMO-ready 1280×800 (1.6:1) composites.
  - `docker/click`, `docker/screenshot` — thin exec wrappers for agents.
- Docs: headed-testing investigation and the marketing scenario catalog
  (scenario list, AMO screenshot requirements with sources, usability
  findings) — planning notes, kept uncommitted in `scratch/`.
- `CHANGELOG.md` (this file).

### Changed
- **`strict_min_version` raised 115.0 → 139.0**: the `tabGroups`
  manifest permission is only recognized from Firefox 139, so installs on
  115–138 failed outright with an unknown-permission error. Firefox 139+
  (June 2025+) is now the install floor.
- CI: PR/main builds upload the unsigned extension zip as a workflow
  artifact with a **2-day retention** (was 30) and also run on direct
  `main` pushes, so dev builds are always downloadable from the Actions
  run page. PRs additionally get the download link commented.
- **Single-tab closes are optimistic** (per-tab ✕ inside clusters and compact
  single-tab-host rows): the row and its counts update instantly on click
  instead of waiting for the `tabs.remove` roundtrip + rebuild — no more laggy
  feel with 100+ tabs. A failed close triggers a full refresh to resync.
  (`dom/render.ts`)
- `AGENT.md`: rendering/UX conventions updated for the modal, optimistic
  closes and the fade overlay.

### Fixed
- **Scroll-to-bottom visual glitch at 100+ tabs** ("second curved background"):
  the `mask-image` bottom fade on the scrolling `.tree` repainted against the
  scrolling content, showing ghost rounded-corner arcs and a stray body
  backdrop band under the list. The tree now flex-fills the panel (no fixed
  `max-height`, body is a flex column with `overflow:hidden`) and the fade is a
  static `.treeFade` overlay outside the scroller. Verified in-container at 99
  tabs. (`popup.css`, `popup.html`)
