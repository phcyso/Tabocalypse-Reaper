#!/usr/bin/env python3
"""Produce AMO-ready 1280x800 (1.6:1) marketing images from artifacts/marketing.

AMO listing screenshots: PNG/JPEG, recommended 1280x800 (largest size the
listing displays); other sizes should keep a 1.6:1 ratio.

  * full-window shots (1920x1080) -> centre-crop to 1.6:1 -> 1280x800
    (`*-full-amo.png`)
  * popup crops (582px wide) -> centred on a branded purple gradient canvas
    with a soft drop shadow (`*-popup-amo.png`)

Run inside the agent container: python3 docker/make-amo.py
"""
import subprocess
from pathlib import Path

SRC = Path("/repo/artifacts/marketing")
OUT = SRC / "amo"
W, H = 1280, 800


def run(cmd):
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(f"{cmd[0]} failed: {r.stderr.decode()[:300]}")


def full_to_amo(src, dst):
    """1920x1080 full frame -> scale to 1280 wide (1280x720), paste centred on
    a branded gradient canvas at 1280x800 (AMO's 1.6:1). Zero clipping: the
    whole window + popup stay in frame; bands read as intentional branding."""
    tmp = "/tmp/_scaled.png"
    run(["convert", str(src), "-resize", "1280x720!", tmp])
    run(["convert", "-size", f"{W}x{H}", "gradient:rgb(46,27,102)-rgb(124,77,255)", str(dst)])
    y = (H - 720) // 2
    run(["composite", "-geometry", f"+0+{y}", tmp, str(dst), str(dst)])



def crop_to_amo(src, dst):
    # popup on branded gradient canvas, centred, soft shadow
    shadowed = "/tmp/_shadowed.png"
    run(["convert", str(src),
         "(", "+clone", "-background", "black", "-shadow", "55x14+8+10", ")",
         "+swap", "-background", "none", "-layers", "merge", "+repage",
         shadowed])
    # NB: IM treats arguments starting with "#" as comments — use rgb() colors
    run(["convert", "-size", f"{W}x{H}",
         "gradient:rgb(46,27,102)-rgb(124,77,255)",
         str(dst)])
    geom = f"+{(W - 582) // 2}+{max(20, (H - 620) // 2)}"
    run(["composite", "-geometry", geom, shadowed, str(dst), str(dst)])


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    n_full = n_popup = 0
    for full in sorted(SRC.glob("*-*.png")):
        if full.stem.endswith(("-crop",)):
            continue
        if any(full.name.startswith(k) for k in
               ("agent-", "selenium-", "smoke-", "debug-", "monster-50-dark-expanded")):
            continue
        full_to_amo(full, OUT / f"{full.stem}-full-amo.png")
        n_full += 1
    for crop in sorted(SRC.glob("*-crop.png")):
        crop_to_amo(crop, OUT / f"{crop.stem.replace('-crop', '')}-popup-amo.png")
        n_popup += 1
    print(f"AMO outputs: {n_full} full + {n_popup} popup -> {OUT}")


if __name__ == "__main__":
    main()
