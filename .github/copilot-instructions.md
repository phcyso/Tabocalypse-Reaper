# Tabocalypse Reaper — AI Contributor Guide

Firefox WebExtension (Manifest v2) that groups tabs by **host → cluster** and
reaps them in bulk, with an undo toast. This file is a **router**: it tells you
where things live and which commands to run. The deep references are
[AGENT.md](AGENT.md) (architecture, contracts, conventions — read before
changing the model or renderer) and [SOUL.md](SOUL.md) (product principles and
taste — read before adding features).

## Source layout

- `src/` — all extension source, TypeScript, organized by feature area:
  - `model/` — pure tab model: host → cluster grouping, URL normalization,
    age chips, duplicate detection (no DOM, no `browser.*` calls).
  - `dom/` — renderer + undo toast; template-based, incremental re-render.
  - `browser/` — `browser.*` API bridges (tabs, storage, theme).
  - `theme/` — browser-theme → CSS custom properties.
  - `utils/` — URL helpers, debounce, natural compare.
  - `popup.ts` — entry point: wire handlers, refresh cycle.
  - `popup.html` / `popup.css` / `manifest.json` / `icons/` — static assets.
- `tests/` — Vitest unit tests; `tests/fixtures/` are **generated** popup
  harness pages (do not edit by hand).
- `scripts/` — build/copy tooling, harness fixture generator, screenshot
  capture.
- `dist/` — generated output of `npm run prepare`. Never edit; never commit.
- `docker/` — headed Firefox validation + marketing screenshot pipeline
  (runs in a container; the host has no Firefox).
- `website/` — GitHub Pages site, deployed by CI.

## Build & verify

```bash
npm run prepare      # clean + typecheck-build + copy assets → dist/
npm run test         # Vitest unit suite
npm run lint         # typecheck + tests + prepare + web-ext lint
npm run build        # prepare + web-ext build → web-ext-artifacts/*.zip
npm run verify:popup # prepare + regenerate harness fixtures + tests
npm run screens      # verify:popup + canonical screenshots → docs/img/
```

`npm run dev` live-reloads (TS watch + web-ext run, needs Firefox).

## Popup testing without an extension build

`npm run verify:popup` regenerates `tests/fixtures/popup-harness-*.html` from
`scripts/build-popup-harness.mjs` — self-contained pages that stub
`window.browser` and seed tabs, so the real `dist/popup.js` renders in any
browser. Query params simulate UI state: `?theme=dark|light`, `?filter=…`,
`?sort=…`, `?excludePinned=0`, `?expand=hosts|all`, `&audit=1`. Headed
end-to-end validation (real Firefox, popup over real chrome, confirm dialog,
undo toast) runs in the Docker pipeline — see `docker/README.md` and
`docs/e2e-firefox-testing.md`.

## Ground rules

- Versions are bumped **manually** in `src/manifest.json` + `package.json`
  before tagging `v*`; CI releases from tags.
- Permissions are exactly `tabs`, `storage`, `theme` — `storage.session` holds
  UI prefs and the last reap (for Undo). No new permissions without a strong
  reason; the extension collects no data.
- Keep the model pure: no `browser.*` or DOM access in `src/model/`.
- After UI changes: `npm run lint` green, and regenerate fixtures/screens if
  the visuals changed.
