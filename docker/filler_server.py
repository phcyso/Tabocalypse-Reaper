#!/usr/bin/env python3
"""Tiny local web server for marketing-shoot filler pages.

Every seeded .test hostname resolves to 127.0.0.1 (compose extra_hosts) and
this server (port 80, unprivileged via net.ipv4.ip_unprivileged_port_start
sysctl) answers ANY request with a plausible branded page: title = host + path
nicely formatted, gradient header, body text, plus a purple favicon. Without
it, seeded tabs would all show Firefox's "Problem loading page" and tab strip
screenshots would look broken.
"""
import socketserver
import html
from http.server import BaseHTTPRequestHandler

def _png(rgba_rows):
    """Minimal valid PNG encoder (no deps) — guarantees the favicon decodes."""
    import struct, zlib

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", 16, 16, 8, 6, 0, 0, 0)
    raw = b"".join(b"\x00" + row for row in rgba_rows)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def _favicon():
    # 16x16 solid reaper purple with a lighter center square
    purple, light = (103, 58, 183, 255), (209, 196, 255, 255)
    rows = []
    for y in range(16):
        row = []
        for x in range(16):
            row.append(light if 4 <= x < 12 and 4 <= y < 12 else purple)
        rows.append(b"".join(bytes(px) for px in row))
    return _png(rows)


FAVICON_PNG = _favicon()


def page(host, path):
    pretty = path.strip("/").replace("/", " — ") or "home"
    return f"""<!doctype html>
<html><head><meta charset="utf-8">
<title>{html.escape(host)} — {html.escape(pretty)}</title>
<link rel="icon" href="/favicon.ico">
<style>
  body {{ margin:0; font-family: system-ui, sans-serif; color:#1b1b23;
         background:#f6f4fb; }}
  header {{ background:linear-gradient(120deg,#43298f,#7c4dff); color:#fff;
            padding:28px 40px; }}
  header h1 {{ margin:0; font-size:28px; }}
  main {{ padding:32px 40px; max-width:720px; }}
  .card {{ background:#fff; border-radius:12px; padding:20px 24px;
           box-shadow:0 2px 10px rgba(40,20,90,.08); margin-bottom:16px; }}
  code {{ background:#efeaff; padding:2px 6px; border-radius:6px; }}
</style></head>
<body>
<header><h1>{html.escape(host)}</h1></header>
<main>
  <div class="card"><h2>{html.escape(pretty)}</h2>
  <p>Demonstration filler page served locally for tab-management screenshots.
  Everything you see is generated on the fly from the URL.</p></div>
  <div class="card"><p>Host: <code>{html.escape(host)}</code> ·
  Path: <code>{html.escape(path)}</code></p></div>
</main></body></html>"""


class H(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/favicon"):
            return self._send(200, FAVICON_PNG, "image/png")
        host = (self.headers.get("Host") or "localhost").split(":")[0]
        return self._send(200, page(host, self.path).encode(), "text/html")

    do_POST = do_GET
    do_HEAD = do_GET

    def log_message(self, *a):  # silence
        pass


class S(socketserver.ThreadingMixIn, socketserver.TCPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    S(("0.0.0.0", 80), H).serve_forever()
