#!/usr/bin/env python3
"""End-to-end Selenium validation of Tabocalypse Reaper in a real Firefox.

Runs inside the agent container against the selenium/standalone-firefox compose
service (SELENIUM_URL, default http://selenium:4444/wd/hub). The repo is
bind-mounted at /repo in BOTH containers, so install_addon() points straight at
/repo/dist (dev path — the extension is never baked into any image; `docker cp`
to the selenium container is the fallback when a mount isn't available:
    docker cp dist/ <selenium-container>:/tmp/dist   &&   DIST_PATH=/tmp/dist).

Firefox specifics discovered while building this (2026-11, Firefox 153 ESR):
  * webdriver.Remote lacks install_addon/set_context — the moz endpoints are
    registered manually into the executor command map (geckodriver serves them
    regardless).
  * Chrome context needs MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1 in the selenium
    container (set via compose).
  * policy.baseURL for a temp-installed *directory* add-on is the file: path;
    the real moz-extension:// URL comes from policy.getURL('popup.html').
  * Temporary add-ons get no navbar toolbar node (CustomizableUI placement
    doesn't materialise a DOM node); the real clickable button is the item in
    the Unified Extensions panel (id <sanitized-id>-BAP). Clicking it opens
    the real browser-action popup in #customizationui-widget-panel.
  * The popup <browser> is out-of-process: contentDocument is null from
    chrome JS. DOM access goes through messageManager.loadFrameScript.

Steps (each prints PASS/FAIL):
  1. connect to WebDriver, install /repo/dist as a temporary add-on
  2. open seed tabs (example.com paths -> one host, multiple clusters)
  3. chrome context: resolve the moz-extension:// popup URL via
     WebExtensionPolicy, register the widget with CustomizableUI (best effort)
  4. click through the REAL UI: Unified Extensions button -> extension item ->
     browser-action popup opens in #customizationui-widget-panel
  5. screenshot with the popup open -> artifacts/
  6. frame-script into the popup: assert host cards, badges, Reap buttons
  7. click Reap on the example.com group inside the real popup, verify the
     tabs really closed via gBrowser.tabs.length
"""
import os
import sys
import time

from selenium import webdriver
from selenium.webdriver.firefox.options import Options

SELENIUM_URL = os.environ.get("SELENIUM_URL", "http://selenium:4444/wd/hub")
DIST_PATH = os.environ.get("DIST_PATH", "/repo/dist")
ARTIFACTS = os.environ.get("ARTIFACTS_DIR", "/repo/artifacts")
EXT_ID = "tabocalypse-reaper@phcyso.com"
SANITIZED = EXT_ID.replace("@", "_").replace(".", "_")  # tabocalypse-reaper_phcyso_com
BAP_ID = f"{SANITIZED}-BAP"  # Unified Extensions action button
UE_BUTTON = "unified-extensions-button"

# NOTE: the example.org tab keeps the window alive when the example.com group
# is reaped — reaping the window's only tabs closes the window and kills the
# browser (and the WebDriver session with it).
SEED_URLS = [
    "https://example.org/keeper",
    "https://example.com/alpha/one",
    "https://example.com/alpha/two",
    "https://example.com/beta/three",
    "https://example.com/",
]

RESULTS = []


def step(name, fn):
    try:
        detail = fn()
        RESULTS.append((name, "PASS", detail))
        print(f"PASS  {name}" + (f"  ({detail})" if detail else ""), flush=True)
        return True
    except Exception as exc:  # noqa: BLE001
        RESULTS.append((name, "FAIL", str(exc)))
        print(f"FAIL  {name}: {exc}", flush=True)
        return False


class Fx:
    """webdriver.Remote + the Firefox-specific moz endpoints."""

    def __init__(self, driver):
        self.d = driver
        cmds = driver.command_executor._commands
        cmds["SET_CONTEXT"] = ("POST", "/session/$sessionId/moz/context")
        cmds["INSTALL_ADDON"] = ("POST", "/session/$sessionId/moz/addon/install")

    def chrome_js(self, script):
        self.d.execute("SET_CONTEXT", {"context": "chrome"})
        try:
            return self.d.execute_script(script)
        finally:
            self.d.execute("SET_CONTEXT", {"context": "content"})

    def chrome_async(self, script, *args):
        self.d.execute("SET_CONTEXT", {"context": "chrome"})
        try:
            return self.d.execute_async_script(script, *args)
        finally:
            self.d.execute("SET_CONTEXT", {"context": "content"})

    def install_addon(self, path, temporary=True):
        return self.d.execute("INSTALL_ADDON", {"path": path, "temporary": temporary})

    def popup_eval(self, frame_js, timeout=12):
        """Run `frame_js` inside the OPEN popup's content process (the popup
        <browser> is remote; cross-process DOM access needs a frame script).
        `frame_js` must call sendAsyncMessage('reaper/result', data)."""
        return self.chrome_async(
            """
            const cb = arguments[arguments.length - 1];
            const timeoutMs = arguments[0];
            const frameJs = arguments[1];
            const panel = [...document.querySelectorAll('panel')]
                .find(p => p.state === 'open' && p.querySelector('browser'));
            if (!panel) { cb({error: 'no open popup panel'}); return; }
            const b = panel.querySelector('browser');
            let mm;
            try { mm = b.messageManager; } catch (e) { cb({error: String(e)}); return; }
            const to = setTimeout(
                () => cb({error: 'timeout waiting for popup frame result'}), timeoutMs);
            mm.addMessageListener('reaper/result', function onMsg(msg) {
                clearTimeout(to);
                mm.removeMessageListener('reaper/result', onMsg);
                cb(msg.data);
            });
            mm.loadFrameScript('data:,' + encodeURIComponent(frameJs), false);
            """,
            timeout * 1000,
            frame_js,
        )


def tab_count(fx) -> int:
    n = fx.chrome_js(
        "const win = Services.wm.getMostRecentBrowserWindow();"
        "return win ? win.gBrowser.tabs.length : -1;"
    )
    return int(n)


def main() -> int:
    opts = Options()
    driver = webdriver.Remote(command_executor=SELENIUM_URL, options=opts)
    driver.set_page_load_timeout(60)
    driver.set_script_timeout(30)
    fx = Fx(driver)
    try:
        return run(driver, fx)
    finally:
        print("\n== summary ==", flush=True)
        for name, status, _detail in RESULTS:
            print(f"{status}  {name}")
        try:
            driver.quit()
        except Exception:  # noqa: BLE001 — session may already be gone
            pass


def run(driver, fx) -> int:
    os.makedirs(ARTIFACTS, exist_ok=True)
    driver.get("about:blank")

    # 1. install add-on (temporary, unsigned directory — bind-mounted dev path)
    if not step("install_addon(dist, temporary=True)",
                lambda: str(fx.install_addon(DIST_PATH, temporary=True))):
        return 1

    # 2. seed tabs in the initial window
    def seed():
        driver.get(SEED_URLS[0])
        for url in SEED_URLS[1:]:
            driver.switch_to.new_window("tab")
            driver.get(url)
        return (f"{len(SEED_URLS) - 1} example.com tabs "
                f"+ 1 example.org keeper tab")
    step("seed tabs", seed)

    # 3. chrome context: resolve moz-extension URL + CustomizableUI (best effort)
    def resolve():
        popup_url = fx.chrome_js(
            f"const p = WebExtensionPolicy.getByID('{EXT_ID}');"
            "if (!p) throw new Error('extension policy not found');"
            "return p.getURL('popup.html');"
        )
        assert popup_url and popup_url.startswith("moz-extension://"), (
            f"bad popup url {popup_url!r}")
        # Register/pin with CustomizableUI. Temp add-ons live in the Unified
        # Extensions panel; this placement doesn't hurt and would matter for a
        # permanently-installed extension.
        pinned = fx.chrome_js(
            f"""
            const id = '{EXT_ID}-browser-action';
            if (CustomizableUI.getWidgetIdsInArea('nav-bar').includes(id)) return 'already';
            try {{
                CustomizableUI.addWidgetToArea(id, CustomizableUI.AREA_NAVBAR);
                return 'placed';
            }} catch (e) {{ return 'not-placed: ' + e; }}
            """
        )
        return f"{popup_url} ({pinned})"
    if not step("chrome context: resolve URL + CustomizableUI placement", resolve):
        return 1

    tabs_before = tab_count(fx)
    step("count tabs before reap", lambda: f"{tabs_before} tabs")

    # 4. click through the REAL UI: UE button -> extension item -> popup opens
    def click_real_button():
        fx.chrome_js(
            f"""
            const btn = document.getElementById('{UE_BUTTON}');
            if (!btn) throw new Error('no {UE_BUTTON}');
            btn.click();
            """
        )
        deadline = time.time() + 5
        bap = None
        while time.time() < deadline:
            bap = fx.chrome_js(
                f"""
                const p = document.getElementById('unified-extensions-panel');
                if (!p || p.state !== 'open') return null;
                const item = document.getElementById('{BAP_ID}');
                return item || null;
                """
            )
            if bap:
                break
            time.sleep(0.25)
        assert bap, "Unified Extensions panel never showed our item"
        fx.chrome_js(
            f"""
            const item = document.getElementById('{BAP_ID}');
            try {{ item.doCommand(); }} catch (e) {{ item.click(); }}
            """
        )
        # wait for the popup panel: open + contains a <browser>
        deadline = time.time() + 10
        while time.time() < deadline:
            st = fx.chrome_js("""
                const panel = document.getElementById('customizationui-widget-panel');
                if (!panel || panel.state !== 'open') return null;
                return panel.querySelector('browser') ? panel.id : null;
            """)
            if st:
                return f"popup panel '{st}' is open"
            time.sleep(0.25)
        raise AssertionError("popup panel never opened")
    if not step("click real toolbar UI (Unified Extensions -> item)", click_real_button):
        return 1

    # 5. screenshot with the popup open (chrome-context capture of the window)
    def shot():
        path = os.path.join(ARTIFACTS, "selenium-popup-open.png")
        driver.execute("SET_CONTEXT", {"context": "chrome"})
        try:
            png = driver.get_screenshot_as_png()
        finally:
            driver.execute("SET_CONTEXT", {"context": "content"})
        with open(path, "wb") as fh:
            fh.write(png)
        size = os.path.getsize(path)
        assert size > 20_000, f"suspiciously small screenshot ({size} B)"
        return f"{path} ({size} B)"
    step("screenshot popup open", shot)

    # 6. frame-script into the popup: assert grouped-tab structure
    def assert_popup():
        info = fx.popup_eval(
            """
            const t0 = Date.now();
            (function poll() {
                const doc = content.document;
                const hosts = [...doc.querySelectorAll('.hostCard')];
                if (hosts.length === 0 && Date.now() - t0 < 9000) {
                    setTimeout(poll, 250); return;
                }
                sendAsyncMessage('reaper/result', {
                    href: content.location.href,
                    hostCount: hosts.length,
                    hostNames: hosts.map(
                        h => (h.querySelector('.hostName') || {}).textContent),
                    badges: hosts.map(
                        h => (h.querySelector('.badge') || {}).textContent),
                    reapButtons: doc.querySelectorAll('.reapButton').length,
                    stats: (doc.getElementById('stats') || {}).textContent,
                });
            })();
            """
        )
        assert not info.get("error"), info.get("error")
        assert "popup.html" in info["href"], f"popup url {info['href']!r}"
        assert info["hostCount"] >= 1, f"no host cards: {info}"
        assert info["reapButtons"] >= 1, f"no Reap buttons: {info}"
        joined = " ".join(str(h) for h in info["hostNames"])
        assert "example.com" in joined, f"no example.com host: {joined!r}"
        return (f"{info['hostCount']} host(s) {info['hostNames']} "
                f"badges={info['badges']} reaps={info['reapButtons']} "
                f"stats={info['stats']!r}")
    if not step("assert popup DOM (hosts/badges/Reap)", assert_popup):
        return 1

    # 7. reap the example.com group via the real popup, verify tabs closed
    def reap():
        info = fx.popup_eval(
            """
            (function () {
            const doc = content.document;
            const target = [...doc.querySelectorAll('.hostCard')].find(h =>
                ((h.querySelector('.hostName') || {}).textContent || '')
                    .includes('example.com'));
            if (!target) { sendAsyncMessage('reaper/result',
                {error: 'example.com host card not found'}); return; }
            const btn = target.querySelector('.reapButton');
            if (!btn || btn.disabled) { sendAsyncMessage('reaper/result',
                {error: 'Reap button missing/disabled'}); return; }
            btn.click();
            sendAsyncMessage('reaper/result', {reaped: true});
            })();
            """
        )
        assert not info.get("error"), info.get("error")
        assert info.get("reaped")
        time.sleep(2.0)  # let tabs.remove settle
        return "Reap clicked inside real popup"
    if not step("click Reap on example.com group", reap):
        return 1

    def tabs_after():
        reaped = len([u for u in SEED_URLS if "//example.com/" in u])
        n = tab_count(fx)
        assert n <= tabs_before - reaped, (
            f"tabs {tabs_before} -> {n}, expected <= {tabs_before - reaped}")
        return f"{tabs_before} -> {n} tabs ({reaped} reaped)"
    step("verify tabs actually closed", tabs_after)

    def shot2():
        path = os.path.join(ARTIFACTS, "selenium-after-reap.png")
        driver.execute("SET_CONTEXT", {"context": "chrome"})
        try:
            png = driver.get_screenshot_as_png()
        finally:
            driver.execute("SET_CONTEXT", {"context": "content"})
        with open(path, "wb") as fh:
            fh.write(png)
        return path
    step("screenshot after reap", shot2)

    return 1 if any(r[1] == "FAIL" for r in RESULTS) else 0


if __name__ == "__main__":
    sys.exit(main())
