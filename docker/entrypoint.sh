#!/usr/bin/env bash
# Container entrypoint: bring up the virtual display stack, then exec CMD.
# Screen size comes from SCREEN_GEOMETRY (default 1920x1080x24 — generous so
# store-listing screenshots are crisp).
set -e

Xvfb "${DISPLAY:-:99}" -screen 0 "${SCREEN_GEOMETRY:-1920x1080x24}" -nolisten tcp &
XVFB_PID=$!

# Wait for the X socket (max ~5s)
for _ in $(seq 1 50); do
  xdpyinfo -display "${DISPLAY:-:99}" >/dev/null 2>&1 && break
  sleep 0.1
done
if ! xdpyinfo -display "${DISPLAY:-:99}" >/dev/null 2>&1; then
  echo "entrypoint: Xvfb failed to start" >&2
  exit 1
fi

# Session bus (AT-SPI/DBus clients) + minimal WM so Firefox windows activate.
if command -v dbus-launch >/dev/null 2>&1; then
  eval "$(dbus-launch --sh-syntax)" || true
  export DBUS_SESSION_BUS_ADDRESS
fi
openbox &

# Reap zombies so long-lived `sleep infinity` containers stay clean.
cleanup() { kill "$XVFB_PID" 2>/dev/null || true; }
trap cleanup EXIT

exec "$@"
