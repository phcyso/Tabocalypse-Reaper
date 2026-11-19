#!/usr/bin/env python3
"""Marketing screenshot runner for Tabocalypse Reaper.

Runs INSIDE the agent container. For each (scenario, theme) pair it:
  1. builds a throwaway Firefox profile: unsigned-add-on prefs, the built
     extension (permanent install from the bind-mounted dist/) and — for the
     `purple` theme — a generated static theme add-on (fully offline);
  2. launches firefox-esr on the Xvfb display with -marionette and seed URLs;
  3. attaches geckodriver via --connect-existing (full Marionette powers:
     chrome context, frame scripts into the remote popup browser);
  4. performs scenario actions (windows/pins/filter/reap/sort) through the
     REAL code paths, opening the popup via the real Unified Extensions UI;
  5. captures X11 root screenshots at each state (chrome + popup visible —
     WebDriver screenshots cannot capture browser chrome) plus a tight crop
     of the popup window found via xwininfo;
  6. asserts popup DOM per state and writes a JSON manifest.

Usage (from repo root inside the agent container):
    python3 docker/shoot.py --scenario all --theme all
    python3 docker/shoot.py --scenario monster-50 --theme dark
"""
import argparse
import json
import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.firefox.options import Options

REPO = Path("/repo")
DIST = REPO / "dist"
SCEN_DIR = REPO / "docker" / "scenarios"
DEFAULT_OUT = REPO / "artifacts" / "marketing"
EXT_ID = "tabocalypse-reaper@phcyso.com"
SANITIZED = EXT_ID.replace("@", "_").replace(".", "_")
BAP_ID = f"{SANITIZED}-BAP"
GECKO_PORT = 7777
SCREEN = (1920, 1080)
WIN_GEOM = (1904, 1024, 8, 48)

PURPLE_MANIFEST = {
    "manifest_version": 2,
    "name": "Reaper Purple (test)",
    "version": "1.0.0",
    "browser_specific_settings": {"gecko": {"id": "purple-theme@tabocalypse.local"}},
    "theme": {"colors": {
        "frame": "#43298F", "accentcolor": "#7C4DFF", "toolbar": "#4B2FA8",
        "bookmark_text": "#F0EAFF", "toolbar_field": "#3A2380",
        "toolbar_field_text": "#F0EAFF", "tab_background_text": "#CFC3F5",
        "tab_selected": "#F4F0FF", "tab_text": "#2E1B66", "icons": "#D8CCFF",
        "popup": "#2E1B66", "popup_text": "#EFE9FF", "popup_border": "#7C4DFF",
        "sidebar": "#3A2380", "sidebar_text": "#EFE9FF"}},
}

# NB: values must be real JSON booleans/numbers — a quoted "false" is a STRING
# pref for Firefox and xpinstall.signatures.required=false-as-string is ignored,
# which silently blocks unsigned add-on loading.
USER_PREFS = [
    ("xpinstall.signatures.required", False),
    ("extensions.autoDisableScopes", 0),
    ("browser.shell.checkDefaultBrowser", False),
    ("browser.aboutwelcome.enabled", False),
    ("datareporting.policy.dataSubmissionEnabled", False),
    ("toolkit.telemetry.reportingpolicy.firstRun", False),
    ("browser.tabs.unloadOnLowMemory", False),
    ("browser.startup.page", 0),
    ("browser.remotecontrol.enabled", False),
]

DARK_PREFS = [("layout.css.prefers-color-scheme.content-override", 0)]

# --------------------------------------------------------------------------
# URL generators (referenced from scenario JSON via "gen": {"kind": ...})
# --------------------------------------------------------------------------

TEST_HOSTS = {
    "news": ["brightlantern", "thedailypixel", "courierjournal", "morningwire",
             "gazettehub", "eveningecho", "pressdesk", "newswire"],
    "docs": ["mdn-notes", "pydocportal", "devdocsdaily", "apidocs", "wikiguide",
             "handbookly", "readthedocsy", "manpages"],
    "shopping": ["cartmart", "thriftlane", "gizmodrop", "dealbay", "shopwave",
                 "basketbarn", "luxelane"],
    "social": ["chirpbird", "friendverse", "photogram", "linknest", "vibely",
               "gramwise", "trendly"],
    "dev": ["gitforge", "pipelinenine", "bugtrackr", "codepad", "stackzone",
            "buildbotic", "linterly"],
    "mail": ["pigeonpost", "inboxzero"],
    "cloud": ["cloudops", "k8sboard", "serveryard", "deployowl", "vaulthive"],
    "media": ["streamly", "podhaven", "clipwave", "vinyltap"],
}

SLUGS = ["article/2026/why-tabs-eat-ram", "guides/getting-started",
         "pricing", "api/v2/reference", "post/weekly-digest-42",
         "product/new-arrivals", "community/t/switching-browsers",
         "docs/installation", "blog/case-study", "search?q=focus+mode",
         "settings/privacy", "inbox/starred", "lists/weekend-reads",
         "dashboard", "help/faq", "u/janedoe/projects"]


def gen_monster():
    """50+ tabs across 50+ unique hosts (plus a few real brand hosts)."""
    urls = []
    cats = list(TEST_HOSTS.keys())
    i = 0
    for cat, hosts in TEST_HOSTS.items():
        for h in hosts:
            for suffix in ["", ".com", ".org"][:1]:
                host = f"{h}.{suffix or 'test'}" if False else f"{h}.test"
                slug = SLUGS[i % len(SLUGS)]
                url = f"http://{host}/{slug}"
                if i % 5 == 0:
                    url += f"?utm_source=newsletter&utm_campaign=nov{i}"
                if i % 7 == 0:
                    url += f"&ref=social#{i}"
                urls.append(url)
                i += 1
    # a few real, fast, recognizable hosts for brand realism
    urls += [
        "https://github.com/phcyso/Tabocalypse-Reaper",
        "https://news.ycombinator.com/news",
        "https://en.wikipedia.org/wiki/Tabbed_interface",
        "https://docs.aws.amazon.com/eks/latest/userguide/what-is.html",
    ]
    return urls


def gen_github():
    repos = [
        "phcyso/Tabocalypse-Reaper", "phcyso/Tabocalypse-Reaper/pull/12",
        "phcyso/Tabocalypse-Reaper/issues/7", "octocat/Spoon-Knife",
        "torvalds/linux", "torvalds/linux/blob/master/Makefile",
        "vercel/next.js", "vercel/next.js/pull/60000",
        "microsoft/vscode", "microsoft/vscode/issues/190000",
        "microsoft/TypeScript", "rust-lang/rust",
        "rust-lang/rust-clippy", "python/cpython",
        "kubernetes/kubernetes", "kubernetes/kubernetes/pull/110000",
        "ansible/ansible", "hashicorp/terraform",
        "hashicorp/vault", "prometheus/prometheus",
        "grafana/grafana", "neovim/neovim",
        "tmux/tmux", "firecracker-microvm/firecracker",
        "hashicorp/packer",
    ]
    return [f"https://github.com/{r}" for r in repos]


def gen_aws():
    """AWS docs deep-dive + product pages. console.aws.amazon.com redirects to
    signin.aws.amazon.com when unauthenticated (tab URL mutates, cluster story
    breaks) — so we showcase docs.aws.amazon.com (clusters by service) and
    aws.amazon.com product pages instead, which load cleanly."""
    urls = []
    docs = {
        "ecs": ["latest/developerguide/what-is-ecs.html",
                "latest/developerguide/getting-set-up.html",
                "latest/developerguide/clusters.html"],
        "lambda": ["latest/dg/welcome.html", "latest/dg/lambda-invocations.html",
                   "latest/dg/getting-started.html"],
        "s3": ["latest/userguide/Welcome.html", "latest/userguide/CreatingBucket.html"],
        "iam": ["latest/userguide/introduction.html", "latest/userguide/id_roles.html"],
        "eks": ["latest/userguide/what-is.html"],
        "rds": ["latest/UserGuide/Welcome.html"],
    }
    for svc, paths in docs.items():
        for p in paths:
            urls.append(f"https://docs.aws.amazon.com/{svc}/{p}")
    for prod in ["ecs/", "lambda/", "s3/", "rds/aurora/", "about-aws/"]:
        urls.append(f"https://aws.amazon.com/{prod}")
    return urls


def gen_doom():
    """~100 tabs with a few huge host groups."""
    urls = ["https://example.com/doom-start"]  # clean visible page
    urls += [f"http://meetings-conglomerate.test/p{i:02d}".replace(" ", "-")
             for i in range(30)]
    urls += [f"http://newsfirehose.test/story/{i}" for i in range(15)]
    urls += [f"http://ticketsmith.test/event/{i}" for i in range(12)]
    urls += [f"http://codepad.test/gist/{i:03d}" for i in range(18)]
    urls += [f"http://{h}.test/{SLUGS[i % len(SLUGS)]}"
             for i, h in enumerate(
                 ["docuverse", "recipebox", "trailmaps", "auroraforecast",
                  "vinylcrate", "boardgamearena", "plantparent", "starcatalog",
                  "quotevault", "mapmyrun", "petforum", "gardenlog",
                  "cyclinglog", "teaatlas", "pixelforge", "moonthemes",
                  "bookbridge", "craftcorner", "skypatterns", "tideclock",
                  "lanterndb", "mossgarden", "ravenpost"])]
    return urls


def gen_pinned():
    urls = ["https://example.com/pinned-demo"]
    pinned = ["http://pigeonpost.test/inbox/starred",
              "http://calendarhub.test/today",
              "http://notesmith.test/scratchpad"]
    normal = [f"http://{h}.test/{s}" for h, s in [
        ("newsfeed", "top-stories"), ("gadgetguru", "reviews/2026"),
        ("reciperack", "dinner/30-min"), ("weatherbee", "forecast/weekend"),
        ("funnyorboot", "videos/top"), ("studyhall", "flashcards"),
        ("runtracker", "routes/city"), ("booknook", "lists/to-read")]]
    return ["https://example.com/pinned-demo"] + normal + pinned, pinned


def gen_filterdemo():
    urls = []
    for h in ["awsconsolemirror", "newsy", "githublike", "shoply", "blogland",
              "podhaven", "recipehub", "gamehive", "fittrack", "traveldesk",
              "financewise", "artfolio"]:
        urls.append(f"http://{h}.test/{SLUGS[len(urls) % len(SLUGS)]}")
    urls += ["https://aws.amazon.com/cli/", "https://docs.aws.amazon.com/cli/latest/reference/index.html",
             "https://github.com/phcyso/Tabocalypse-Reaper"]
    return urls


GENERATORS = {
    "monster": gen_monster,
    "github": gen_github,
    "aws": gen_aws,
    "doom": gen_doom,
    "pinned": gen_pinned,
    "filterdemo": gen_filterdemo,
}


def scenario_urls(scen):
    gen = scen.get("gen")
    if gen:
        kind = gen["kind"]
        if kind == "pinned":
            urls, pinned = gen_pinned()
            return urls, pinned
        return GENERATORS[kind](), []
    urls, pinned = scen.get("urls", []), []
    return urls, pinned


# --------------------------------------------------------------------------
# Firefox / geckodriver lifecycle
# --------------------------------------------------------------------------

def build_profile(theme):
    prof = Path("/tmp") / f"reaper-shoot-{theme}-{os.getpid()}"
    shutil.rmtree(prof, ignore_errors=True)
    (prof / "extensions").mkdir(parents=True)
    prefs = list(USER_PREFS)
    if theme == "dark":
        prefs += DARK_PREFS + [("extensions.activeThemeID", "firefox-compact-dark@mozilla.org")]
    elif theme == "purple":
        prefs += [("extensions.activeThemeID", "purple-theme@tabocalypse.local")]
        theme_dir = prof / "extensions" / "purple-theme@tabocalypse.local"
        theme_dir.mkdir()
        (theme_dir / "manifest.json").write_text(json.dumps(PURPLE_MANIFEST, indent=2))
    lines = [f'user_pref("{k}", {json.dumps(v)});' for k, v in prefs]
    (prof / "user.js").write_text("\n".join(lines) + "\n")
    shutil.copytree(DIST, prof / "extensions" / EXT_ID)
    return prof


def launch_firefox(prof, urls):
    env = dict(os.environ, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS="1")
    cmd = ["firefox-esr", "--no-remote", "-profile", str(prof), "-marionette",
           "--width", str(WIN_GEOM[0]), "--height", str(WIN_GEOM[1])] + urls
    ff = subprocess.Popen(cmd, env=env, stdout=subprocess.DEVNULL,
                          stderr=subprocess.DEVNULL)
    wid = wait_for_window()
    subprocess.run(["xdotool", "windowactivate", "--sync", wid], check=False)
    subprocess.run(["xdotool", "windowsize", wid, str(WIN_GEOM[0]), str(WIN_GEOM[1])], check=False)
    subprocess.run(["xdotool", "windowmove", wid, str(WIN_GEOM[2]), str(WIN_GEOM[3])], check=False)
    time.sleep(0.8)
    return ff, wid


def wait_for_window():
    deadline = time.time() + 45
    while time.time() < deadline:
        out = subprocess.run(["xdotool", "search", "--class", "firefox"],
                             capture_output=True, text=True).stdout.split()
        for wid in reversed(out or []):
            geo = subprocess.run(["xdotool", "getwindowgeometry", "--shell", wid],
                                 capture_output=True, text=True).stdout
            vals = dict(line.split("=", 1) for line in geo.strip().splitlines() if "=" in line)
            if int(vals.get("HEIGHT", 0)) > 300:
                return wid
        time.sleep(1)
    raise RuntimeError("firefox window never appeared")


def launch_geckodriver():
    gd = subprocess.Popen(
        ["geckodriver", "--connect-existing", "--marionette-port", "2828",
         "--port", str(GECKO_PORT)],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.2)
    return gd


def connect():
    driver = webdriver.Remote(command_executor=f"http://localhost:{GECKO_PORT}",
                              options=Options())
    driver.set_script_timeout(30)
    cmds = driver.command_executor._commands
    cmds["SET_CONTEXT"] = ("POST", "/session/$sessionId/moz/context")
    return driver


class Chrome:
    """Marionette chrome-context helpers."""

    def __init__(self, driver):
        self.d = driver

    def js(self, script):
        self.d.execute("SET_CONTEXT", {"context": "chrome"})
        try:
            return self.d.execute_script(script)
        finally:
            self.d.execute("SET_CONTEXT", {"context": "content"})

    def js_async(self, script, *args):
        self.d.execute("SET_CONTEXT", {"context": "chrome"})
        try:
            return self.d.execute_async_script(script, *args)
        finally:
            self.d.execute("SET_CONTEXT", {"context": "content"})

    def popup_eval(self, frame_js, timeout_ms=10000):
        """Run a frame script inside the open popup (remote browser)."""
        return self.js_async("""
            const cb = arguments[arguments.length - 1];
            const panel = [...document.querySelectorAll('panel')]
                .find(p => p.state === 'open' && p.querySelector('browser'));
            if (!panel) { cb({error: 'no open popup panel'}); return; }
            const b = panel.querySelector('browser');
            let mm;
            try { mm = b.messageManager; } catch (e) { cb({error: String(e)}); return; }
            const to = setTimeout(
                () => cb({error: 'timeout waiting for popup result'}), arguments[0]);
            mm.addMessageListener('reaper/result', function onMsg(m) {
                clearTimeout(to); mm.removeMessageListener('reaper/result', onMsg); cb(m.data);
            });
            mm.loadFrameScript('data:,' + encodeURIComponent(arguments[1]), false);
        """, timeout_ms, frame_js)


def scrub_remote_control(ch: Chrome):
    """Marionette sets remotecontrol=true on the chrome root: Firefox then
    hatches the URL bar red and shows the robot icon. Great for honesty, bad
    for marketing shots — remove the attribute and hide the indicator."""
    ch.js("""
        const html = document.documentElement;
        for (const a of [...html.getAttributeNames()])
            if (/remotecontrol|marionette|automation/i.test(a)) html.removeAttribute(a);
        const ub = document.getElementById('urlbar');
        if (ub) for (const a of [...ub.getAttributeNames()])
            if (/remote/i.test(a)) ub.removeAttribute(a);
        for (const el of document.querySelectorAll('#navigator-toolbox *')) {
            const id = (el.id || '').toLowerCase();
            if (id.includes('remote-control') || id.includes('remotecontrol')) {
                el.hidden = true; el.style.display = 'none';
            }
            if (el.classList && el.classList.contains('urlbar-background')) {
                el.style.backgroundImage = 'none';
            }
        }
        return true;
    """)


def open_popup(ch: Chrome):
    """Open the browser-action popup through the REAL UI. Returns render ms."""
    t0 = time.time()
    ch.js("""
        const btn = document.getElementById('unified-extensions-button');
        if (!btn) throw new Error('no unified-extensions-button');
        btn.click();
    """)
    deadline = time.time() + 6
    while time.time() < deadline:
        if ch.js(f"return !!document.getElementById('{BAP_ID}');"):
            break
        time.sleep(0.15)
    ch.js(f"""
        const item = document.getElementById('{BAP_ID}');
        if (!item) throw new Error('BAP item missing');
        try {{ item.doCommand(); }} catch (e) {{ item.click(); }}
    """)
    deadline = time.time() + 10
    while time.time() < deadline:
        if ch.js("""
            const p = document.getElementById('customizationui-widget-panel');
            return p && p.state === 'open' && !!p.querySelector('browser');
        """):
            break
        time.sleep(0.1)
    # wait until the popup actually rendered its stats line
    deadline = time.time() + 8
    while time.time() < deadline:
        info = ch.popup_eval("""
            (function () {
                const doc = content.document;
                sendAsyncMessage('reaper/result', {
                    stats: (doc.getElementById('stats') || {}).textContent || '',
                });
            })();
        """, 4000)
        if info and not info.get("error") and info.get("stats", "").strip():
            return round((time.time() - t0) * 1000), info["stats"].strip()
        time.sleep(0.1)
    raise RuntimeError("popup never rendered stats")


def close_popup(ch: Chrome):
    ch.js("""
        const p = document.getElementById('customizationui-widget-panel');
        if (p && p.state === 'open') p.hidePopup();
    """)
    time.sleep(0.4)


def wait_render_settled(ch: Chrome, timeout=8.0):
    """Wait until the popup has rows in the DOM AND every favicon <img> has
    settled (loaded or failed), then give the compositor a beat. Purely a
    capture-sync helper: X11 grabs can otherwise fire between the DOM update
    and the paint (empty-tree crops, collapsed-card crops, missing favicons)."""
    deadline = time.time() + timeout
    info = None
    while time.time() < deadline:
        info = ch.popup_eval("""
            (function () {
                const doc = content.document;
                const imgs = [...doc.images];
                sendAsyncMessage('reaper/result', {
                    rows: doc.querySelectorAll('.hostCard, .soloRow').length,
                    imgsTotal: imgs.length,
                    imgsPending: imgs.filter(i => !i.complete).length,
                });
            })();
        """, 4000)
        if (info and not info.get("error")
                and info.get("rows", 0) > 0
                and info.get("imgsPending", 1) == 0):
            break
        time.sleep(0.25)
    time.sleep(0.4)  # compositor settle before the X11 grab
    return info


# --------------------------------------------------------------------------
# X11 capture
# --------------------------------------------------------------------------

def shot(path, crop=None):
    subprocess.run(["import", "-window", "root", str(path)], check=True)
    if crop:
        subprocess.run(["convert", str(path), "-crop", crop, "+repage", str(path) + ".crop.png"],
                       check=True)
    return path


def get_popup_rect(ch):
    """Exact visible popup bounds in screen px via chrome-JS rect math
    (getBoundingClientRect + chrome viewport origin). Fallback: xwininfo."""
    r = ch.js("""
        const p = document.getElementById('customizationui-widget-panel');
        if (!p || p.state !== 'open') return null;
        const rc = p.getBoundingClientRect();
        const bw = window.outerWidth - window.innerWidth;
        const bh = window.outerHeight - window.innerHeight;
        return JSON.stringify({
            x: rc.x + window.screenX + bw / 2,
            y: rc.y + window.screenY + bh - bw / 2,
            w: rc.width, h: rc.height, dpr: window.devicePixelRatio});
    """)
    if r:
        d = json.loads(r)
        if d["dpr"] != 1:
            d = {k: v * d["dpr"] for k, v in d.items() if k != "dpr"} | {"dpr": d["dpr"]}
        pad = 0  # exact panel rect: pad>0 lets background bleed into crops
        return (round(d["x"]), round(d["y"]), round(d["w"]), round(d["h"]))
    xw = find_popup_xwindow()  # "WxH+X+Y"
    if not xw:
        return None
    w, hxy = xw.split("x")
    h, x, y = hxy.split("+")
    return (int(x), int(y), int(w), int(h))


def crop_geometry(rect):
    x, y, w, h = rect
    return f"{w}x{h}+{x}+{y}"


def detect_panel_rect(full_png):
    """Pixel-exact popup bounds from a full screenshot: the panel's 1px border
    is the strongest sustained vertical/horizontal edge in the top-right
    region (layout rects proved unreliable — panel shadow/re-anchor races).
    Returns (x, y, w, h) including the border line, or None."""
    import re as _re
    # search window: popup anchors top-right, <=620px wide, <=860px tall
    X0, Y0, W, H = 1130, 120, 790, 860
    raw = subprocess.run(
        ["convert", str(full_png), "-crop", f"{W}x{H}+{X0}+{Y0}", "+repage",
         "-depth", "8", "rgb:-"], capture_output=True).stdout
    if len(raw) < W * H * 3:
        return None
    px = lambda x, y: raw[(y * W + x) * 3:(y * W + x) * 3 + 3]

    # vertical edges: sum |col[x] - col[x-1]| over y (sampled every 2px)
    def vdiff(x):
        s = 0
        for y in range(0, H - 1, 2):
            a, b = px(x, y), px(x - 1, y)
            s += abs(a[0] - b[0]) + abs(a[1] - b[1]) + abs(a[2] - b[2])
        return s

    def hdiff(y):
        s = 0
        for x in range(0, W - 1, 2):
            a, b = px(x, y), px(x, y - 1)
            s += abs(a[0] - b[0]) + abs(a[1] - b[1]) + abs(a[2] - b[2])
        return s

    # panel borders sit inside these bands (window-relative); top starts at 2
    # to skip the search-window boundary artifact, right starts past the left
    # border (the left border line dominates any overlapping band)
    left = max(range(60, 320), key=vdiff)
    right = max(range(left + 240, W - 60), key=vdiff)
    top = max(range(2, 80), key=hdiff)
    bottom = max(range(top + 150, H - 60), key=hdiff)
    if right - left < 350 or bottom - top < 150:
        return None
    pad = 1  # include the border line itself
    return (X0 + left - pad, Y0 + top - pad,
            right - left + 1 + 2 * pad, bottom - top + 1 + 2 * pad)


def find_popup_xwindow():
    """Locate the override-redirect X window of the open popup via xwininfo.

    Output format (this xwininfo build): `0x400001 (has no name): ()  578x353+1338+152  +1338+152`
    — geometry as WxH+X+Y, first occurrence relative to parent (root children:
    absolute), second absolute.
    """
    import re
    out = subprocess.run(["xwininfo", "-root", "-tree"],
                         capture_output=True, text=True).stdout
    cands = []
    for line in out.splitlines():
        m = re.search(r"(\d+)x(\d+)([+-]\d+)([+-]\d+)", line)
        if not m:
            continue
        w, h, x, y = int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4))
        if 350 <= w <= 900 and 200 <= h <= 1000 and x > SCREEN[0] * 0.5 and 0 < y < 300:
            cands.append((w, h, x, y))
    if cands:
        w, h, x, y = max(cands, key=lambda c: c[0] * c[1])
        pad = 14
        return f"{w + 2 * pad}x{h + 2 * pad}+{max(0, x - pad)}+{max(0, y - pad)}"
    return None


# --------------------------------------------------------------------------
# Scenario actions (real code paths)
# --------------------------------------------------------------------------

def act_filter(ch, params):
    text = params["text"]
    info = ch.popup_eval(f"""
        (function () {{
            const doc = content.document;
            const input = doc.getElementById('search');
            if (!input) {{ sendAsyncMessage('reaper/result', {{error: 'no search input'}}); return; }}
            input.focus();
            input.value = '{text}';
            input.dispatchEvent(new Event('input', {{bubbles: true}}));
            sendAsyncMessage('reaper/result', {{filter: input.value,
                stats: (doc.getElementById('stats') || {{}}).textContent.trim()}});
        }})();
    """)
    time.sleep(0.5)  # debounce (utils/debounce) before re-render settles
    info2 = ch.popup_eval("""
        (function () {
            const doc = content.document;
            sendAsyncMessage('reaper/result', {
                stats: (doc.getElementById('stats') || {}).textContent.trim(),
            });
        })();
    """)
    info2["filter"] = text
    return info2


def act_expand_host(ch, params):
    host = params["host"]
    info = ch.popup_eval(f"""
        (function () {{
            const doc = content.document;
            const card = [...doc.querySelectorAll('.hostCard')].find(c =>
                ((c.querySelector('.hostName') || {{}}).textContent || '').includes('{host}'));
            if (!card) {{ sendAsyncMessage('reaper/result', {{error: 'host not found: {host}'}}); return; }}
            card.querySelector('.hostHeader').click();
            sendAsyncMessage('reaper/result', {{expanded: '{host}',
                expandedAttr: card.querySelector('.hostHeader').getAttribute('aria-expanded')}});
        }})();
    """)
    return info


def act_sort(ch, params):
    mode = params.get("mode", "alpha")
    info = ch.popup_eval(f"""
        (function () {{
            const doc = content.document;
            const sel = doc.getElementById('sort');
            if (!sel) {{ sendAsyncMessage('reaper/result', {{error: 'no sort select'}}); return; }}
            sel.value = '{mode}';
            sel.dispatchEvent(new Event('change', {{bubbles: true}}));
            sendAsyncMessage('reaper/result', {{sort: '{mode}',
                stats: (doc.getElementById('stats') || {{}}).textContent}});
        }})();
    """)
    return info


def act_toggle_pinned(ch, params):
    exclude = "1" if params.get("exclude", True) else "0"
    info = ch.popup_eval(f"""
        (function () {{
            const doc = content.document;
            const cb = doc.getElementById('excludePinned');
            if (!cb) {{ sendAsyncMessage('reaper/result', {{error: 'no excludePinned checkbox'}}); return; }}
            cb.checked = ('{exclude}' === '1');
            cb.dispatchEvent(new Event('change', {{bubbles: true}}));
            sendAsyncMessage('reaper/result', {{excludePinned: cb.checked}});
        }})();
    """)
    time.sleep(0.8)  # let the refresh settle
    after = ch.popup_eval("""
        (function () {
            const doc = content.document;
            sendAsyncMessage('reaper/result', {
                stats: (doc.getElementById('stats') || {}).textContent.trim(),
                pinnedRows: doc.querySelectorAll('.pinnedTab').length,
            });
        })();
    """)
    info.update(after)
    return info


def act_reap_host(ch, params):
    """Click Reap on a host card. If the group is >= CONFIRM_THRESHOLD tabs the
    in-popup window.confirm dialog appears — the caller captures it, then uses
    confirm_dialog_action() to accept/cancel."""
    host = params["host"]
    info = ch.popup_eval(f"""
        (function () {{
            const doc = content.document;
            const card = [...doc.querySelectorAll('.hostCard')].find(c =>
                ((c.querySelector('.hostName') || {{}}).textContent || '').includes('{host}'));
            if (!card) {{ sendAsyncMessage('reaper/result', {{error: 'host not found: {host}'}}); return; }}
            const btn = card.querySelector('.reapButton');
            if (!btn || btn.disabled) {{ sendAsyncMessage('reaper/result', {{error: 'reap disabled for {host}'}}); return; }}
            btn.click();
            sendAsyncMessage('reaper/result', {{reapClicked: '{host}',
                badge: (card.querySelector('.badge') || {{}}).textContent}});
        }})();
    """)
    return info


def confirm_dialog_action(ch, accept=True):
    """Accept/dismiss the in-popup confirm modal. Primary path: click the
    modal button via the popup DOM (works without X keyboard focus). Fallback:
    the modal also handles Enter (accept) / Escape (cancel) for real users."""
    selector = ".confirmOk" if accept else ".confirmCancel"
    res = ch.popup_eval(f"""
        (function () {{
            const doc = content.document;
            const btn = doc.querySelector('{selector}');
            if (!btn) {{ sendAsyncMessage('reaper/result',
                {{error: 'modal button {selector} not found'}}); return; }}
            btn.click();
            sendAsyncMessage('reaper/result', {{clicked: '{selector}'}});
        }})();
    """)
    if res.get("error"):
        key = "Return" if accept else "Escape"
        subprocess.run(["xdotool", "key", "--clearmodifiers", key], check=False)
        res["fallbackKey"] = key
    time.sleep(1.2)
    return res


def act_tab_count(ch):
    n = ch.js(
        "const w = Services.wm.getMostRecentBrowserWindow();"
        "return w ? w.gBrowser.tabs.length : -1;")
    return int(n)


def age_tabs(ch, max_hours=30):
    """Spread tab last-access times across all windows so age chips, the stale
    sort and 'Reap stale' buttons have real data to render (marketing only; the
    extension itself only reads lastAccessed). The WebExtension-facing
    Tab.lastAccessed is a getter without a setter — writes must go to the
    _lastAccessed backing property. Ages cycle 1h..max_hours so a believable
    mix of fresh/stale rows shows. Best-effort: ignores failures."""
    return ch.js(f"""
        const wins = [...Services.wm.getEnumerator('navigator:browser')];
        const now = Date.now();
        let i = 0;
        for (const w of wins) {{
            if (!w.gBrowser) continue;
            for (const t of w.gBrowser.tabs) {{
                try {{
                    const hours = 1 + ((i * 3) % {max_hours});
                    if ('_lastAccessed' in t) t._lastAccessed = now - 3600000 * hours;
                    else t.lastAccessed = now - 3600000 * hours;
                }} catch (e) {{}}
                i++;
            }}
        }}
        return i;
    """)


# --------------------------------------------------------------------------
# Scenario execution
# --------------------------------------------------------------------------

def run_scenario(scen, theme, out_dir):
    name = scen["name"]
    urls, pin_hosts = scenario_urls(scen)
    n_win = scen.get("windows", 1)
    if n_win > 1:
        split = max(1, len(urls) // n_win)
        cli_urls = urls[:split]
        extra_urls = urls[split:]
    else:
        cli_urls, extra_urls = urls, []
    first, rest = cli_urls[0], cli_urls[1:]

    def log(msg):
        print(f"[{name}/{theme}] {msg}", flush=True)

    prof = build_profile(theme)
    # clear stale artifacts from previous runs of this scenario+theme
    for stale in out_dir.glob(f"{name}-{theme}-*"):
        stale.unlink()
    ff, wid = launch_firefox(prof, [first] + rest)
    gd = None
    driver = None
    manifest = {"scenario": name, "theme": theme, "title": scen.get("title", name),
                "tabsSeeded": len(urls), "windows": n_win, "states": [], "asserts": {}, "notes": []}
    try:
        gd = launch_geckodriver()
        driver = connect()
        ch = Chrome(driver)
        scrub_remote_control(ch)

        # let background tabs navigate before shaping
        time.sleep(min(10.0, 2.0 + len(urls) * 0.08))

        # post-startup shaping
        if pin_hosts:
            for h in pin_hosts:
                for attempt in range(5):
                    pinned = ch.js(f"""
                        const w = Services.wm.getMostRecentBrowserWindow();
                        const g = w.gBrowser;
                        let n = 0;
                        for (const tab of g.tabs) {{
                            if ((tab.linkedBrowser.currentURI || {{}}).spec &&
                                tab.linkedBrowser.currentURI.spec.includes('{h}')) {{
                                g.pinTab(tab); n++;
                            }}
                        }}
                        return n;
                    """)
                    if pinned:
                        break
                    time.sleep(1.0)
            total_pinned = ch.js(
                "const w = Services.wm.getMostRecentBrowserWindow();"
                "return w.gBrowser.visibleTabs"
                " ? [...w.gBrowser.visibleTabs].filter(t => t.pinned).length"
                " : -1;")
            manifest["notes"].append(f"pinned {total_pinned} tabs")
            time.sleep(0.5)
        for wi in range(1, n_win):
            wurls = extra_urls or ["https://example.com/extra"]
            ch.js(f"""
                const arg = Cc["@mozilla.org/supports-string;1"]
                    .createInstance(Ci.nsISupportsString);
                arg.data = '{wurls[0]}';
                Services.ww.openWindow(null, 'chrome://browser/content/browser.xhtml',
                    '_blank', 'chrome,all,height=700,width=1000', arg);
                return true;
            """)
            time.sleep(1.0)
            for u in wurls[1:]:
                ch.js(f"""
                    const wins = Services.wm.getEnumerator('navigator:browser');
                    let target = null;
                    while (wins.hasMoreElements()) target = wins.getNext();
                    if (!target) throw new Error('no browser window found');
                    const uri = Services.io.newURI('{u}');
                    const principal = Services.scriptSecurityManager
                        .createContentPrincipal(uri, {{}});
                    target.gBrowser.addTab('{u}', {{triggeringPrincipal: principal}});
                    return target.gBrowser.tabs.length;
                """)
                time.sleep(0.2)
            subprocess.run(["xdotool", "windowactivate", "--sync", wid], check=False)
            time.sleep(0.5)
        # Spread lastAccessed so age chips / Reap stale have real data (shots only)
        aged = age_tabs(ch)
        manifest["notes"].append(f"aged lastAccessed on {aged} tabs")
        render_ms, stats = open_popup(ch)
        manifest["renderMs"] = render_ms
        manifest["statsAtOpen"] = stats
        log(f"popup open, rendered in {render_ms}ms, stats={stats!r}")

        # exact popup rect once open (crop source)
        rect = get_popup_rect(ch)
        crop = crop_geometry(rect) if rect else None
        if crop:
            manifest["notes"].append(f"popup crop geometry {crop}")

        def capture(state_name, asserts=None):
            nonlocal crop
            wait_render_settled(ch)
            base = out_dir / f"{name}-{theme}-{state_name}.png"
            subprocess.run(["import", "-window", "root", str(base)], check=True)
            # rect-math gives exact x/y/w; h carries a 4px bottom shadow margin
            # inside the layout rect, so trim it to land on the border row.
            r = get_popup_rect(ch)
            if r:
                crop = crop_geometry((r[0], r[1], r[2], r[3] - 4))
            else:
                r2 = detect_panel_rect(base)
                crop = crop_geometry(r2) if r2 else crop
            subprocess.run(["convert", str(base), "-crop", crop, "+repage",
                            str(base.with_name(f"{base.stem}-crop.png"))], check=True)
            state = {"state": state_name, "file": str(base.relative_to(REPO)),
                     "cropFile": str(base.with_name(f"{base.stem}-crop.png").relative_to(REPO)) if (rect or crop) else None,
                     "cropGeometry": crop, "tabs": act_tab_count(ch)}
            if asserts:
                dom = popup_asserts(ch)
                state["dom"] = dom
                state["asserts"] = asserts
                state["assertResults"] = evaluate_asserts(dom, asserts)
            manifest["states"].append(state)
            log(f"captured {state_name} (tabs={state['tabs']}, dom={dom.get('hostCount') if asserts else 'n/a'})")
            return state

        def popup_asserts(ch):
            return ch.popup_eval("""
                (function () {
                    const doc = content.document;
                    const tree = doc.querySelector('.tree');
                    const cards = [...doc.querySelectorAll('.hostCard')];
                    const solo = [...doc.querySelectorAll('.soloRow')];
                    const toast = doc.getElementById('toast');
                    sendAsyncMessage('reaper/result', {
                        href: content.location.href,
                        stats: (doc.getElementById('stats') || {}).textContent.trim(),
                        hostCount: cards.length + solo.length,
                        hostCards: cards.length,
                        soloRows: solo.length,
                        firstHosts: [...cards, ...solo].slice(0, 4).map(
                            c => (c.querySelector('.hostName, .soloHost') || {}).textContent),
                        badges: cards.slice(0, 6).map(
                            c => (c.querySelector('.badge') || {}).textContent),
                        reapButtons: doc.querySelectorAll('.reapButton').length,
                        staleButtons: [...doc.querySelectorAll('.staleButton')].filter(b => !b.hidden).length,
                        dupButtons: [...doc.querySelectorAll('.dupButton')].filter(b => !b.hidden).length,
                        ageChips: [...doc.querySelectorAll('.ageChip')].filter(c => !c.hidden).length,
                        winChips: [...doc.querySelectorAll('.winChip')].filter(c => !c.hidden).length,
                        undoToast: !!(toast && !toast.hidden),
                        pinnedRows: doc.querySelectorAll('.pinnedTab').length,
                        pinGlyphs: (doc.body.textContent.match(/\ud83d\udccc/g) || []).length,
                        treeScrollHeight: tree ? tree.scrollHeight : -1,
                        treeClientHeight: tree ? tree.clientHeight : -1,
                        filterValue: (doc.getElementById('search') || {}).value || '',
                        dialogVisible: !!doc.querySelector('dialog, .dialogBox'),
                        hasHScroll: tree ? tree.scrollWidth > tree.clientWidth : false,
                    });
                })();
            """)

        def evaluate_asserts(dom, wants):
            results = {}
            for key, want in wants.items():
                base_key = key[:-3] if key.endswith("Min") else key
                got = dom.get(base_key)
                if callable(want):
                    results[key] = bool(want(got))
                elif isinstance(want, str):
                    results[key] = want in str(got or "")
                elif key.endswith("Min") and isinstance(want, (int, float)):
                    results[key] = got is not None and got >= want
                else:
                    results[key] = got == want
            return results

        # initial capture
        asserts = scen.get("asserts", {})
        capture(scen.get("initialShot", "open"), asserts)

        # actions from the scenario file
        for i, act in enumerate(scen.get("actions", [])):
            kind = act.get("action")
            shot_name = act.get("shot")
            res = None
            if kind == "filter":
                res = act_filter(ch, act)
            elif kind == "expand-host":
                res = act_expand_host(ch, act)
            elif kind == "sort":
                res = act_sort(ch, act)
            elif kind == "toggle-pinned":
                res = act_toggle_pinned(ch, act)
            elif kind == "reap-host":
                res = act_reap_host(ch, act)
                if act.get("confirm"):
                    time.sleep(0.9)  # let the tab-modal dialog appear
                    capture(act.get("confirmShot", "confirm-dialog"))
                    res["confirmAction"] = confirm_dialog_action(
                        ch, accept=act.get("accept", True))
                    time.sleep(1.0)  # let the sweep + refresh settle
            elif kind == "wait":
                time.sleep(act.get("seconds", 1))
                res = {"waited": act.get("seconds", 1)}
            elif kind == "close-popup":
                close_popup(ch)
                res = {"closed": True}
            else:
                res = {"skipped": kind}
            if shot_name:
                capture(shot_name, act.get("asserts"))
            if res:
                manifest["states"][-1]["actionResult"] = res

        manifest["ok"] = all(
            all(st.get("assertResults", {}).values())
            for st in manifest["states"] if st.get("assertResults"))
        return manifest
    finally:
        for proc in (driver,):
            if proc:
                try:
                    proc.quit()
                except Exception:
                    pass
        if gd:
            gd.terminate()
        ff.terminate()
        time.sleep(0.8)
        try:
            ff.kill()
        except Exception:
            pass
        subprocess.run(["pkill", "-f", "firefox-esr"], capture_output=True)
        shutil.rmtree(prof, ignore_errors=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenario", default="all")
    ap.add_argument("--theme", default="all",
                    help="light | dark | purple | all (default: each scenario's own list)")
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    args = ap.parse_args()

    scen_files = sorted(SCEN_DIR.glob("*.json"))
    scenarios = [json.loads(p.read_text()) for p in scen_files]
    if args.scenario != "all":
        scenarios = [s for s in scenarios if s["name"] == args.scenario]
    if not scenarios:
        print("no matching scenarios", file=sys.stderr)
        return 2

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    server = subprocess.Popen(
        [sys.executable, str(REPO / "docker" / "filler_server.py")],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.5)

    overall_ok = True
    manifests = []
    for scen in scenarios:
        themes = scen.get("themes", ["dark", "purple"])
        if args.theme != "all":
            themes = [t for t in themes if t == args.theme]
        for theme in themes:
            try:
                m = run_scenario(scen, theme, out_dir)
            except Exception as exc:  # noqa: BLE001
                import traceback
                traceback.print_exc()
                m = {"scenario": scen["name"], "theme": theme,
                     "error": f"{type(exc).__name__}: {exc}", "ok": False}
            manifests.append(m)
            (out_dir / f"{scen['name']}-{theme}-manifest.json").write_text(
                json.dumps(m, indent=1))
            print(f"== {scen['name']}/{theme}: {'OK' if m.get('ok') else 'FAILED'}", flush=True)
            overall_ok = overall_ok and bool(m.get("ok"))
    (out_dir / "index.json").write_text(json.dumps(manifests, indent=1))
    server.terminate()
    return 0 if overall_ok else 1


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, lambda *a: sys.exit(1))
    sys.exit(main())
