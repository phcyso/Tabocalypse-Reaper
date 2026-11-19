# Contributing to Tabocalypse Reaper

Thanks for helping reap the tabocalypse! This guide covers the basics;
[AGENT.md](AGENT.md) is the canonical architecture + conventions document —
please read it before your first change.

## Setup

```bash
npm install
npm run verify:popup   # green build + harness fixtures + full test suite
```

Requires Node (see `.nvmrc`) and Firefox for `npm run dev` / end-to-end runs.

## Ground rules

- **Manifest v2, Firefox-first.** `browser_action`, no Chrome MV3 fields.
  Minimum supported Firefox is declared in `src/manifest.json`
  (`strict_min_version`) — don't use APIs newer than that without bumping it
  and guarding (see `src/browser/storage.ts` for the pattern).
- **Shallow model.** Root → Host → Cluster, no deeper. Node shapes and count
  semantics (`ids` sets, union counting) are contracts — see AGENT.md.
- **Pure helpers in `src/model/` and `src/utils/`** so they stay unit-testable.
  Renderer wiring lives in `src/dom/render.ts`.
- **Template cloning, no `innerHTML` mass-ops.** CSP is strict; don't add
  remote assets.
- **Wrap tab operations in try/catch** and drive UI updates through the
  existing `onRefresh`/incremental-removal patterns.
- **Every UI-facing change**: run `npm run verify:popup`, and capture a
  screenshot into `test-screenshots/` with a descriptive, unique name
  (real-Firefox workflow: [docs/e2e-firefox-testing.md](docs/e2e-firefox-testing.md)).

## Tests

`npm run test` runs the Vitest suite (jsdom for renderer tests). New pure
helpers should land with tests in `tests/`; renderer behaviour is tested by
rendering into jsdom and asserting DOM + counts.

## Commits

One logical change per commit, imperative subject, e.g.
`fix(f-2): resolve cluster ancestor before detaching tab row`. CI runs
`npm run lint` on every PR and on merges to `main` (which also auto-bumps the
patch version — don't bump patch yourself).

## Where to look first

- [AGENT.md](AGENT.md) — architecture, contracts, pitfalls
- [docs/DESIGN.md](docs/DESIGN.md) — why the model is shaped this way
- [docs/e2e-firefox-testing.md](docs/e2e-firefox-testing.md) and
  [docs/playwright-harness.md](docs/playwright-harness.md) — how the extension is
  tested in a real browser and via the popup harness
