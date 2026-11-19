# Changelog

All notable changes to Tabocalypse Reaper are documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/); dates are UTC.

## [Unreleased]

### Added
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
- Docs: `docs/headed-testing-investigation.md` (headed-testing approaches,
  comparison, recommendation) and `docs/marketing-scenarios.md` (scenario
  catalog, AMO screenshot requirements with sources, usability findings).
- `CHANGELOG.md` (this file).

### Changed
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
