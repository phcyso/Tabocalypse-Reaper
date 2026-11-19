# E2E Testing in Real Firefox via Desktop Computer-Use Tools

Companion to `docs/playwright-harness.md`. That doc's harness layer is faster for UI
iteration; this workflow drives a **real Firefox** with the extension installed, to catch
what the harness can't: manifest loading, permission behavior, real `browser.tabs`
mutations, the ≥10 confirm threshold, and multi-window behavior.

Verified working 2026-10-26 on Omarchy (Hyprland) with `web-ext` 9.x. Re-verified the
same day during the usability audit, including the `wtype` keyboard workflow, caret-
browsing scrolling, `--pref` theme runs, and multi-window testing.

> Do **not** use agent-browser or any Chrome/CDP-based tooling for this — it launches
> Chromium and cannot load Firefox extensions.

---

## 1. Prerequisites

- `npm run prepare` has produced a fresh `dist/` (run `npm run verify:popup` to also get green tests first).
- Pi computer-use tools enabled:
  `computer_use_linux_tools` with `["screenshot","list_windows","click","press_key","type_text","scroll","resize_window","activate_window","get_app_state","focused_window"]`.
- `grim` (present on Omarchy) for saving captures into `test-screenshots/`.

### Step 0: probe input capabilities — they decide your whole strategy

```bash
command -v wtype ydotool ydotoold; ls /usr/lib/xdg-desktop-portal/portals
```

- **`wtype` is installed on this machine and works.** It types into the *focused*
  Wayland window via the virtual-keyboard protocol — no daemon, no root. This unlocks
  the filter box, URL-bar navigation, keyboard shortcuts, and scrolling. Prefer it over
  the Pi `press_key`/`type_text` tools.
- Those Pi tools (`press_key`/`type_text`/`scroll`) fail here: the remote-desktop portal
  has no RemoteDesktop interface on this box. Don't retry them; pointer `click` works
  because it goes through uinput directly.
- `get_app_state` returns no AT-SPI tree — no element-index clicks; use screenshot
  coordinates.

`wtype` recipes (the target window must be focused: click the field first,
`sleep 0.3`, then type — otherwise a focus race eats the input):

```bash
wtype "aws"                                 # literal text into the focused field
wtype -M ctrl -k a -m ctrl -k BackSpace     # select-all + delete
wtype -k Next                               # PageDown — keysym name, NOT "PageDown"
wtype -k F7                                 # caret browsing (confirm via click)
```

Scrolling without a wheel: toggle caret browsing (`wtype -k F7` → click **Yes** → click
inside the scrollable text → `wtype -k Next` / `-k End`). Works even inside
non-focusable `<div>`s like the popup's `.tree`.

## 2. Launch an isolated instance

`web-ext run` creates a **throwaway temp profile** — your real Firefox profile is never
touched. Seed the tab chaos you want to test via repeated `--url` flags:

```bash
cd ~/dev/Tabocalypse-Reaper
nohup npx web-ext run --source-dir dist --no-reload --no-input \
  --url "https://github.com/phcyso/Tabocalypse-Reaper" \
  --url "https://github.com/octocat/Spoon-Knife" \
  --url "https://docs.aws.amazon.com/eks/latest/userguide/what-is.html" \
  --url "https://duckduckgo.com/?q=typescript+cli" \
  --url "https://duckduckgo.com/?q=mise+en+place" \
  > /tmp/web-ext-run.log 2>&1 &
sleep 12   # Firefox + install take a few seconds
```

Flags that matter:

| Flag | Why |
|---|---|
| `--no-reload` | Stops web-ext watching files — no surprise reloads mid-test. Omit when actively iterating on `dist/`. |
| `--no-input` | Non-interactive (won't prompt if ports/profiles are busy). |
| `--url` (repeatable) | Seeds tabs at startup; far faster than opening tabs by hand without a keyboard. |
| *(none)* | A new temp profile is used each run — perfect isolation. |

**Gotcha:** do not pass `--args -width 1400 -height 900` to size the window — yargs eats
the `-h` inside `-height` and web-ext just prints its help and exits. Resize the window
after launch with the `resize_window` tool instead.

To test the **≥10-tab confirm threshold**, seed 12+ same-host URLs, e.g.
`for i in $(seq 1 12); do URLS="$URLS --url https://example.com/page/$i"; done`.

**Gotcha (shell quoting):** when accumulating `--url`s in a variable, never embed
quotes inside the loop — `URLS="$URLS --url 'https://…'"` passes literal `'` to
Firefox, which opens it as an unparseable URL / error page and pollutes your tab set.
Keep URLs bare; quote only whole assignments.

**Theme variants (verified working):** pass Firefox prefs with `--pref name=value`:

```bash
npx web-ext run --source-dir dist --no-reload --no-input \
  --pref extensions.activeThemeID=firefox-compact-light@mozilla.org \
  --url https://example.com ...
```

Extension popups follow the **browser chrome** scheme, not the content override — to
test popup theming, switch `extensions.activeThemeID`
(`firefox-compact-dark@mozilla.org` / `firefox-compact-light@mozilla.org`); flipping
`layout.css.prefers-color-scheme.content-override` changes web pages but not the popup.

**Harness without Playwright:** the popup-harness fixture is a plain `file://` page —
seed it as a regular tab in the same isolated instance
(`--url file://…/tests/fixtures/popup-harness.html`). It runs on the `browser.*` stub
(no extension needed) and `confirm()` dialogs work there too. See
`docs/playwright-harness.md` for the URL-parameter and audit-fixture additions.

### Multi-window testing (no keyboard needed)

`--url` seeds only ever open one window. To get real second windows, seed a local
"launcher" page whose buttons call `window.open` with size features (a user-gesture
click bypasses the popup blocker):

```html
<button onclick="window.open('https://example.com/d/1','w2','width=800,height=600')">open window</button>
```

Seed the launcher as one of the `--url`s, click its button — that's window #2.
Gotchas:

- **All Firefox windows share ONE pid** (single process). Once several windows exist,
  `pid`-targeted clicks/screenshots are ambiguous — pass `window_id` from
  `list_windows` instead.
- Compact windows (single tab, no tab strip) hide or move the extensions/puzzle button,
  so the popup can't be opened from them reliably — open the popup in the main window.
  The popup shows **all** windows' tabs no matter which window it was opened from.

## 3. Identify YOUR instance (critical)

The user's own Firefox may be running alongside yours. After launching:

1. `computer_use_linux_list_windows` — find windows with `app_id: firefox`.
2. Pick the one whose title matches your seeded pages (e.g. "Example Domain — Mozilla
   Firefox"). Note its `pid`. All subsequent clicks pass `pid: <that pid>`.
   (With multiple windows — see §2 — switch to `window_id` targeting: all Firefox
   windows share one pid, so `pid` is ambiguous.)
3. `activate_window` with that pid to raise it.

**Never** kill or interact with a Firefox pid you didn't just launch. When cleaning up,
kill the exact pid you identified — not `pkill firefox`.

## 4. Open the popup

The toolbar button isn't pinned by default for temporary add-ons, so go through the
extensions panel (coordinates below are for the default ~1270px-wide window; the puzzle
icon is anchored top-right so they are stable across widths):

1. **Click the puzzle icon**: capture-pixel `(2461, 100)`.
2. Screenshot → panel lists "Extensions" with **Tabocalypse Reaper**. Click the entry
   (≈ capture-pixel `(2043, 240)`).
3. Screenshot → the popup renders the host tree.

### The coordinate system (important)

Screenshots come back **scaled** (e.g. a 2554-px-wide window is previewed at 1920 px,
`scale: 0.7518`), but click `x/y` are in **raw window ("capture") pixels**
(`coordinate_width`/`coordinate_height` in the metadata). Convert:

```
capture_px = preview_px / scale        # or preview_px * (coordinate_width / preview_width)
```

Always pass `relative: true` with `pid` (or `window_id` in multi-window setups). Clicks
that use stale coordinates are the #1 failure mode — **re-screenshot after every
re-render** (expanding a host shifts everything below it) and recompute before the next
click.

Three more rules learned the hard way:

- **The scale differs per screenshot.** It depends on the `max_width`/`max_height` you
  request for that capture (values from 0.62 to 0.75 were seen in one session). Convert
  with the *current response's* `scale`/`coordinate_width` — never reuse a factor from
  an earlier screenshot.
- **Running any bash command blurs Firefox and dismisses the popup** — `grim`,
  `hyprctl`, `vitest`, anything. Structure popup flows as chained computer-use calls
  only (use `click` with `screenshot_after` to observe), run `grim` only where losing
  the popup is acceptable, and re-open the popup (steps 1–3) after any shell command.
- Screenshot between the puzzle-icon click and the entry click: chaining both blindly
  once hit the panel mid-animation and the popup never opened.

## 5. Interact and assert

Everything below has been verified end-to-end:

| Action | How | Expected result |
|---|---|---|
| Model correctness | Read popup screenshot | "N tabs matched"; hosts show favicon + count badge; GitHub tabs cluster by `org/repo`; AWS by first path segment; hosts with a single tab render as compact solo rows (no twisty); sessions over 20 hosts auto-collapse |
| Expand host | Click the `▸` twisty | Shows cluster rows (`org/repo` for GitHub), each with its own Reap |
| Reap a host < 10 tabs | Click host-row **Reap** | Tabs close immediately (verify the tab strip shrinks); popup refreshes; host disappears when emptied |
| Reap ≥ 10 tabs | Seed 12, click **Reap** | In-popup dialog "Reap N tabs under `<host>`?" with Cancel/OK |
| Cancel path | Click **Cancel** | Dialog closes; tab count unchanged |
| Confirm path | Re-click Reap, click **OK** | All N tabs close. If they were the window's only tabs the **window closes** — that's Firefox, not a bug; treat "window gone" as a pass |

Sanity-check side effects against the **tab strip in the same screenshot** (tab count /
titles), not only against the popup's own counters. At 40+ tabs the strip becomes
unreadable slivers — assert against the popup's "N tabs matched" and host badges (they
stayed arithmetically correct through every incremental reap in the 2026-10-26 audit)
and keep a running expected-counts table per step; it's the cheapest way to notice
drift.

## 6. Save captures (repo convention)

`AGENT.md` requires captures in `test-screenshots/` with descriptive, unique names.
The computer-use screenshots live only in the conversation — persist the important ones
with `grim` from bash:

```bash
# whole output
grim -o eDP-1 test-screenshots/e2e-popup-initial-$(date +%Y%m%d-%H%M%S).png

# focused window region (Hyprland) — note x between width and height; grim rejects a comma
geom=$(hyprctl -j activewindow | jq -r '"\(.at[0]),\(.at[1]) \(.size[0])x\(.size[1])"')
grim -g "$geom" test-screenshots/e2e-popup-window-$(date +%Y%m%d-%H%M%S).png

Coordinate systems: `hyprctl` reports LOGICAL px (monitor scale is 1.6 on eDP-1, so
logical 1600x1000) while `list_windows`/screenshot metadata report PHYSICAL px
(2560x1600). `grim -g` accepts the logical values from hyprctl as-is — don't mix the
systems. Remember: running grim blurs Firefox and dismisses an open popup (see §4);
capture, then re-open the popup.
```

Capture *before* teardown — once the last tab is reaped the window is gone.

## 7. Teardown

```bash
kill <firefox-pid-of-your-instance>    # from list_windows in step 3
pkill -f "web-ex[t]"                   # web-ext watcher, bracket trick avoids self-match
```

The temp profile is discarded automatically. The `web-ex[t]` bracket trick only helps
if the string `web-ext run` appears **nowhere else in your command line** — it does not
protect a combined teardown+relaunch one-liner (the relaunch string itself matches and
kills your own shell, exit 143, while the launch never happens). Always run teardown
and relaunch as two separate bash calls.

## 8. Gotcha quick reference

| Symptom | Cause / fix |
|---|---|
| web-ext prints help and exits | `--args -height ...` — `-h` triggers yargs help. Drop `--args`; resize via tool. |
| `press_key` errors "ydotool executable was not found" | No ydotool on this box. Use pointer clicks only. |
| `get_app_state` returns no tree | AT-SPI disabled; don't rely on accessibility, use screenshots. |
| Click did nothing / wrong thing | Stale coordinate after a re-render, or forgot preview→capture scaling. Re-screenshot, recompute, `relative: true`. |
| Old instance still running after "kill" | `pkill -f` self-matched your shell. Kill the exact Firefox pid from `list_windows`. |
| Reaped everything and the window disappeared | Expected when the reaped host was the window's only content. |
| Seeded GitHub URLs show 404 | Temp profile isn't logged in; private repos 404. Clustering still works — fine for most tests. |
| Popup vanished mid-flow | A bash command ran between steps — any shell call blurs Firefox. Re-open the popup; keep flows bash-free (see §4). |
| `wtype` input never arrived | Focus race — click the field, `sleep 0.3`, then type; verify focus with `focused_window`. |
| `wtype -k PageDown` → "Unknown key" | Use keysym names: `Next`/`Prior`/`End`/`Home`, not "PageDown"/"PageUp". |
| Can't scroll the popup tree | No wheel via the portal. Caret browsing: `wtype -k F7` → click **Yes** → click inside the tree → `wtype -k Next`. |
| grim fails "invalid geometry" | `jq` format had a comma between width and height; grim needs `WxH` (see §6). |
| Clicks land on the wrong window after opening a 2nd/3rd window | All Firefox windows share one pid — target by `window_id`. |
| Extensions-panel entry click does nothing | Panel mid-animation or focus lost between clicks; screenshot between the puzzle click and the entry click. |
| `resize_window` errors "backend hyprland cannot resize" | Expected — unsupported by this backend. Windows open at ~2554x1594 anyway. |

## 9. Minimal test checklist

0. Probe input capabilities (§1) — know whether you have `wtype` keyboard before planning.
1. `npm run verify:popup` green → launch instance with mixed-host seeded tabs.
2. Identify window by title/pid; activate; open extensions panel; open popup.
3. Assert counts, host grouping, GitHub/AWS clustering keys, compact single-tab solo rows.
4. Expand a host; assert cluster layout and per-cluster Reap buttons.
5. Reap a small host → tab strip count drops, popup refreshes.
6. Reap a 12-tab host → dialog appears; Cancel preserves; OK closes all.
7. Save `grim` captures to `test-screenshots/`; teardown by pid.
