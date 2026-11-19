# SOUL.md — what Tabocalypse Reaper is, at heart

Every repo has a README (what it does) and an AGENT.md (how to work on it).
This is the third thing: what it *is*. Read it before you add, change, or
"improve" anything. If a change can't be reconciled with this file, the
change is wrong — not this file.

## The one-breath pitch

Tabocalypse Reaper is a tool for **letting go of tabs**. Not organizing
them, not hoarding them better, not "managing" them — closing them, in
bulk, safely, grouped the way humans actually think about their tabs:
*all my GitHub stuff*, *that meeting pile*, *the 40 AWS docs I will never
read again*. End your tab chaos with one clean sweep.

## Beliefs

### 1. Closing is the product
Every feature must make release easier — faster to decide, safer to
execute. Features that encourage keeping tabs forever (read-later queues,
permanent sessions, save-everything) are someone else's product. Undo
exists so a sweep can be brave, not so hoarding can be careful.

### 2. The reaper is polite
Destruction is the job, so legibility is the safety. You can't bulk-close
what you can't see: scope counts on every Reap, pinned tabs marked at host
*and* cluster level, confirmations sized to the blast radius, defaults that
protect. State you can't see isn't safety.

### 3. Scan, don't study
The popup is a triage blade, not a dashboard. Shallow hierarchy
(Host → Cluster, that's it), sub-second renders at ~100 tabs, compact rows
when crowded, cards when not. If "is this usable?" costs eleven screens of
scroll, the UI failed. That failure has a name here: **the monster-50
lesson**. It was measured, not guessed — 7016px of scroll in a 640px view —
and it changed the design. Keep measuring.

### 4. Mirror the mind, not the metadata
People think in sites and tasks ("my GitHub tabs"), not timestamps or
keyword soup. Cluster Host → Cluster, with smarts where URLs deserve it
(org/repo, AWS service). Everything else is noise.

### 5. Boring technology, sharp edge
Manifest v2, vanilla TypeScript, template cloning, no framework, no build
drama. The complexity budget is spent on the model and the tests, not on
machinery. Any new permission needs a justification you'd say out loud to
a friend.

### 6. The browser is a collaborator
Use what Firefox already knows: theme colors (mapped to CSS vars),
favicons, pinned semantics, `lastAccessed`. Don't fight the platform and
don't fake it. If the browser can tell us, we don't re-implement it.

### 7. The view must be true
Tabs change while you look away. A stale list is a trap, so staleness is
*announced* — loudly — never silent. Never let a user act confidently on
outdated state.

## What this is not

- Not a session manager or a bookmarking service.
- Not a tab suspender / memory optimizer.
- Not a vertical-tabs tree (Firefox already has one).
- Not a dashboard. The popup stays a popup.

## Taste (what good looks like here)

- **Theme-proof.** Dark, purple (the brand), and light. If it reads in one
  theme it must read in all — 4.5:1 contrast or it doesn't ship. The popup
  must hold its figure on white pages, dark pages, and purple chrome.
- **Scale is a dial.** 3 tabs and 100 tabs should both feel natural;
  density adapts, lists fade where they cut instead of amputating rows.
- **Destructive affordances confess.** What they'll close, how many, and
  who survives (📌). Disabled buttons explain themselves.
- **Playful name, serious behavior.** The reaper may smile in copy; it may
  never gamble with tabs.

## How we work

- **Pure core, thin DOM.** Model and URL logic live in `model/` and
  `utils/`, unit-tested with vitest. DOM wiring stays dumb.
- **We shoot, we don't argue.** UI debates end with a screenshot.
  Scenarios are data (`docker/scenarios/*.json`); one command regenerates
  the suite; DOM assertions decide pass/fail; a vision subagent reviews
  what the pixels actually say. Before/after pairs beat opinions.
- **Honest docs.** Usability findings say the unflattering thing ("usable
  but scroll-bound", "the guard looks scarier than the reaping"). A doc
  that only praises is a bug.
- **Real Firefox, real fixtures.** Headed containers, filler pages with
  real titles and favicons, render timing measured. A jsdom pass is not
  evidence of UX.
- **Everything regenerable.** An artifact nobody can rebuild with one
  documented command is a liability, not an asset.

## Non-negotiables

1. Pinned tabs are sacred by default; only an explicit, single, visible
   action may close one.
2. No bulk action without its scope shown first.
3. No new permission without a spoken-aloud justification.
4. The popup stays shallow and instant. A feature that needs depth needs a
   better shape, not more popup.
5. Confirmations default to *not* destroying.

## If you are an agent (or a human in a hurry)

Read `AGENT.md` for mechanics and `docs/` for investigations. Don't commit
unless asked; don't reformat; keep findings honest; when you spot drift
from this file, flag it in your report instead of quietly conforming.
The soul of this place is that the truth about the UI is always on disk —
in pixels, reproducible.
