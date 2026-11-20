# Docker setup — local dev + store screenshots (headed Firefox testing)

Companion to the headed-testing investigation note (kept uncommitted in
`scratch/`). Two
containers, one repo bind-mount, **no baked extension anywhere** — the dev
bind-mount of `dist/` is the only delivery path:

| Service | Image | Purpose |
|---|---|---|
| `agent` | built from `docker/Dockerfile` (Debian + firefox-esr + Xvfb + openbox + xdotool + ImageMagick + Node from `.nvmrc` + web-ext + python3-selenium + emoji/CJK fonts) | manual/agent clicking, store-quality screenshots |
| `selenium` | `selenium/standalone-firefox:latest` (pulled, never rebuilt), profile `selenium` | scripted WebDriver validation on port **4444** (noVNC live view on **7900**) |

Both run headed Firefox on a virtual display at **1920x1080x24** with
`shm_size: 2g`. Screenshots and logs land in `artifacts/` on the host (mounted
at `/repo/artifacts` in both containers).

Validated end-to-end 2026-11-18 — see "What was validated" below.

## One-time setup

From the repo root:

```bash
docker compose -f docker/docker-compose.yml up -d --build agent
docker compose -f docker/docker-compose.yml --profile selenium up -d selenium   # pulls ~3.1GB

# build dist/ INSIDE the container (host stays clean — no host npm install)
docker compose -f docker/docker-compose.yml exec agent bash -lc "npm ci && npm run prepare"
```

## Route A — scripted Selenium validation (deterministic, ~7s)

```bash
docker compose -f docker/docker-compose.yml exec \
  -e SELENIUM_URL=http://selenium:4444/wd/hub agent \
  python3 docker/test-selenium.py
```

Prints PASS/FAIL per step: install `dist/` as a temporary add-on, seed tabs,
resolve the `moz-extension://` URL via `WebExtensionPolicy`, click the **real**
toolbar UI (Unified Extensions → extension item → popup opens in
`customizationui-widget-panel`), assert the popup DOM (hosts/badges/Reap
buttons), click Reap inside the real popup, and verify via `gBrowser.tabs.length`
that tabs actually closed. Writes `artifacts/selenium-popup-open.png` and
`artifacts/selenium-after-reap.png`.

Fallback when a mount isn't available:
`docker cp dist/ <selenium-container>:/tmp/dist` then run with
`DIST_PATH=/tmp/dist`.

Note: WebDriver screenshots capture only the page viewport, **not** browser
chrome — visual popup evidence comes from Route B.

Firefox gotchas baked into the script (details in its docstring):
- `webdriver.Remote` lacks `install_addon`/`set_context` — the script registers
  the `moz/*` endpoints itself;
- chrome context needs `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1` (set in compose);
- `policy.baseURL` is the `file:` dir for temp directory installs — use
  `policy.getURL("popup.html")` for the real `moz-extension://` URL;
- the popup `<browser>` is out-of-process (`contentDocument` is null) — DOM
  access goes through `messageManager.loadFrameScript` (frame scripts must not
  use top-level `return` — SyntaxError);
- don't reap the window's *only* tabs: the window (and WebDriver session) dies.

## Route B — agent clicking (vision-driven)

Launch a real Firefox with the extension + seeded tabs inside the agent
container (detached):

```bash
docker compose -f docker/docker-compose.yml exec -d agent bash -lc '
  cd /repo && web-ext run --source-dir dist --no-reload --no-input \
    --url https://example.com/alpha/one \
    --url https://example.com/alpha/two \
    --url https://example.com/beta/three \
    --url https://example.org/keeper \
    > /repo/artifacts/web-ext-run.log 2>&1'
# wait for the window, then normalize geometry (openbox doesn't maximize):
docker compose -f docker/docker-compose.yml exec agent bash -lc '
  WID=$(xdotool search --class firefox | sort -n | tail -1)   # skip the 10x10 placeholder
  xdotool windowactivate --sync $WID windowsize $WID 1904 1024 windowmove $WID 8 48
  xdotool getwindowgeometry --shell $WID'
```

Then drive it from the host with the thin wrappers:

```bash
./docker/screenshot agent-01-initial.png   # passive — never steals focus
./docker/click 1853 131                    # xdotool mousemove --sync + click
```

**Validated click path** (1920x1080 screen, window at ~(10,88) 1904x1024,
firefox-esr 153 — re-derive after changing geometry; a vision subagent reading
the last screenshot is the reliable way to get coordinates):

| Step | Where | Coordinate |
|---|---|---|
| 1 | Unified Extensions (puzzle) button | `(1853, 131)` |
| 2 | Tabocalypse Reaper item's action icon in the UE panel | `(1513, 226)` |
| 3 | Popup is open (anchored top-right, ~578x353) | — |
| 4 | example.com twisty ▸ / Reap button inside popup | `(1322, 324)` / `(1816, 324)` |

Gotcha: the robot head + striped URL bar is Firefox's *remote-control*
indicator (web-ext enables remote debugging) — not the extension button.

Because screenshots are passive X11 clients and xdotool targets Firefox
directly, **bash calls between clicks do not dismiss the popup** — the key
advantage over the Wayland workflow in `docs/e2e-firefox-testing.md` §4.

### Screenshot QC without human eyes

- Pixel stats: `compare -metric RMSE before.png after.png null:` (a panel
  opening shows up clearly), `convert img -crop WxH+X+Y +repage -resize 1x1 txt:`
  for region colors.
- Stronger: a vision-capable subagent reads the artifact and
  reports panel state, contents, coordinates, tofu/ artifacts.
- Strongest for logic: Marionette DOM assertions (Route A).

### Store-style crop

```bash
docker compose -f docker/docker-compose.yml exec agent bash -lc '
  convert /repo/artifacts/agent-03-popup-open.png -crop 600x380+1285+145 +repage \
          /repo/artifacts/agent-04-popup-crop.png'
```


## Marketing screenshot suite

`docker/shoot.py` + `docker/scenarios/*.json` (scenario catalog + usability
findings in the marketing note under `scratch/`):
data-driven themed scenario shots via the same profile/marionette stack, plus
`docker/make-amo.py` for AMO-ready 1280x800 composites. Outputs land in
`artifacts/marketing/`. `docker/test-selenium.py` remains the CI validation
(unaffected).

```bash
docker compose -f docker/docker-compose.yml exec -d agent bash -lc \
  'cd /repo && python3 docker/shoot.py --scenario all --theme all'
docker compose -f docker/docker-compose.yml exec -T agent python3 docker/make-amo.py
```

## Teardown

```bash
docker compose -f docker/docker-compose.yml exec agent bash -lc \
  'pkill -f firefox-esr; pkill -f "web-ex[t]"'
docker compose -f docker/docker-compose.yml --profile selenium down
```

## What was validated (2026-11-18)

- Route A: 10/10 steps PASS (~7s), including real-popup DOM asserts and a reap
  verified against `gBrowser.tabs.length` (5 → 1 tabs).
- Route B: web-ext run in-container, popup opened via two real clicks,
  expanded, and a reap executed purely via pixel clicks (4 → 1 tabs; popup
  refreshed to "1 tab matched"). All captures in `artifacts/agent-0*.png`,
  verified by vision subagents (popup fully visible, no tofu, correct badges).

## Scope

Local dev + screenshot production only. No release-style image with a
COPY-baked extension exists by design; CI/release packaging stays with
`web-ext build`.
