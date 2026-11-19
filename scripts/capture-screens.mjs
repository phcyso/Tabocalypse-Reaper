#!/usr/bin/env node
// Deterministic UI screenshot pipeline: renders the popup-harness fixtures in a
// headless Firefox driven over WebDriver BiDi (built into Firefox; Node 22+ has
// fetch + WebSocket, so no dependencies) and saves shots to docs/img/.
//
//   npm run screens        (runs verify:popup first, then this script)
//
// Re-run after every major version and before AMO submissions. Shots that need a
// live browser (popup over real chrome, the confirm dialog, multi-window) are NOT
// scriptable — see scratch/*-screenshots-brief.md for the interactive checklist.

import { spawn } from "node:child_process";
import { mkdtempSync, existsSync, statSync, writeFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "..");
const FIXTURES = resolve(ROOT, "tests", "fixtures");
const OUT_DIR = resolve(ROOT, "docs", "img");
const FIREFOX = process.env.FIREFOX_BIN ?? "firefox";
const BIDI_PORT = Number(process.env.BIDI_PORT ?? 9223);

// name → [fixture, query, width, height]. The viewport is set via BiDi per shot.
const SHOTS = [
  { name: "popup-overview-light", fixture: "popup-harness-showcase.html", query: "?theme=light", size: [580, 760] },
  { name: "popup-expanded-light", fixture: "popup-harness-showcase.html", query: "?theme=light&expand=hosts", size: [580, 900] },
  { name: "popup-overview-dark", fixture: "popup-harness-showcase.html", query: "?theme=dark", size: [580, 760] },
  { name: "popup-filtered-light", fixture: "popup-harness-showcase.html", query: "?theme=light&filter=github", size: [580, 560] },
  { name: "popup-empty-pinned-light", fixture: "popup-harness-audit-empty.html", query: "?theme=light", size: [580, 420] },
  { name: "popup-pinned-visible-light", fixture: "popup-harness-audit-empty.html", query: "?theme=light&excludePinned=0", size: [580, 460] },
  { name: "popup-scale-audit-light", fixture: "popup-harness-audit-weird.html", query: "?theme=light", size: [580, 900] }
];

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

class BiDi {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined && this.pending.has(message.id)) {
        const { resolve: resolvePromise, reject: rejectPromise } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) {
          rejectPromise(new Error(`${message.error}: ${message.message ?? ""}`));
        } else {
          resolvePromise(message.result);
        }
      }
    });
  }

  call(method, params = {}) {
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolvePromise, rejectPromise) => {
      this.pending.set(id, { resolve: resolvePromise, reject: rejectPromise });
      this.ws.send(payload);
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          rejectPromise(new Error(`BiDi timeout: ${method}`));
        }
      }, 30_000);
    });
  }
}

async function connectBiDi(port, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/session`);
      await new Promise((resolvePromise, rejectPromise) => {
        ws.addEventListener("open", resolvePromise, { once: true });
        ws.addEventListener("error", rejectPromise, { once: true });
        setTimeout(() => rejectPromise(new Error("ws open timeout")), 2000);
      });
      return new BiDi(ws);
    } catch {
      await sleep(400);
    }
  }
  throw new Error(`WebDriver BiDi endpoint never became ready on port ${port}`);
}

async function main() {
  if (!existsSync(join(ROOT, "dist", "popup.js")) || !SHOTS.every((shot) => existsSync(join(FIXTURES, shot.fixture)))) {
    console.error("dist/ or fixtures missing — run `npm run verify:popup` first.");
    process.exit(1);
  }

  mkdir(OUT_DIR, { recursive: true });
  const profile = mkdtempSync(join(tmpdir(), "reaper-shots-"));

  const firefox = spawn(
    FIREFOX,
    ["--headless", "--no-remote", "--profile", profile, "--remote-debugging-port", String(BIDI_PORT), "about:blank"],
    { stdio: "ignore" }
  );

  let bidi;
  try {
    bidi = await connectBiDi(BIDI_PORT);
    await bidi.call("session.new", { capabilities: { alwaysMatch: { acceptInsecureCerts: true } } });
    let context = (await bidi.call("browsingContext.getTree", {})).contexts[0]?.context;
    if (!context) {
      await bidi.call("browsingContext.create", { type: "tab" });
      context = (await bidi.call("browsingContext.getTree", {})).contexts[0]?.context;
    }

    const results = [];
    for (const shot of SHOTS) {
      const out = join(OUT_DIR, `${shot.name}.png`);
      const url = pathToFileURL(join(FIXTURES, shot.fixture)).href + shot.query;
      const [w, h] = shot.size;

      await bidi.call("browsingContext.setViewport", {
        context,
        viewport: { width: w, height: h },
        devicePixelRatio: 1
      });
      await bidi.call("browsingContext.navigate", { context, url, wait: "complete" });
      // Wait for the fixture's settle marker (theme injected, expanders clicked),
      // then for popup.js's async render to fill #stats.
      await bidi.call(
        "script.evaluate",
        {
          expression:
            "(async () => {" +
            "  const end = performance.now() + 8000;" +
            "  while (performance.now() < end) {" +
            "    if (window.__shotReady === true && (document.querySelector('#stats')?.textContent ?? '').trim().length > 0) return true;" +
            "    await new Promise((r) => setTimeout(r, 50));" +
            "  }" +
            "  return false;" +
            "})()",
          target: { context },
          awaitPromise: true
        }
      );
      // The fixture applies ?filter= at load+80ms and the popup debounces input
      // refreshes by 140ms — give that (re)render time to land before capturing,
      // otherwise filtered shots show the pre-filter list.
      await sleep(450);
      const data = await bidi.call("browsingContext.captureScreenshot", { context });
      const buffer = Buffer.from(data.data, "base64");
      writeFileSync(out, buffer);
      const bytes = statSync(out).size;
      results.push({ name: shot.name, file: out, bytes, dims: pngDims(buffer), hash: createHash("sha256").update(buffer).digest("hex").slice(0, 8) });
    }

    console.log(`\n${results.length} shots saved to ${OUT_DIR}:`);
    for (const r of results) {
      console.log(`  ${r.name}.png  ${r.dims.w}x${r.dims.h}  ${(r.bytes / 1024).toFixed(0)} KiB  #${r.hash}`);
    }
    console.log(
      "\nInteractive shots NOT covered by this script (capture in a real browser per\n" +
        "scratch/*-screenshots-brief.md): confirm dialog, popup over real Firefox chrome,\n" +
        "multi-window raise, theme runs via --pref."
    );
  } finally {
    firefox.kill();
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

function pngDims(buffer) {
  // PNG IHDR: width at byte offset 16, height at 20 (big-endian).
  return {
    w: ((buffer[16] << 24) | (buffer[17] << 16) | (buffer[18] << 8) | buffer[19]) >>> 0,
    h: ((buffer[20] << 24) | (buffer[21] << 16) | (buffer[22] << 8) | buffer[23]) >>> 0
  };
}

main();
