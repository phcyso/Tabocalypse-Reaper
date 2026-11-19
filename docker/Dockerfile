# Tabocalypse Reaper — local dev / store-screenshot image (NOT a release image).
#
# One image for both workflows:
#   * agent clicking: Xvfb + openbox + xdotool + ImageMagick against a real
#     firefox-esr launched by `web-ext run` (bind-mounted dist/, temp add-on).
#   * scripted checks: python3 + selenium bindings (talks to the
#     selenium/standalone-firefox compose service, or a local geckodriver).
#
# The extension is NEVER baked in — dist/ is bind-mounted at runtime and loaded
# as a temporary add-on. Keep it that way.
#
# Base: official Node image pinned to .nvmrc (Node 26) so `npm ci` / web-ext work.
FROM node:26-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    DISPLAY=:99 \
    SCREEN_GEOMETRY=1920x1080x24

# Display stack + browser + input/screenshot tools + fonts.
# fonts-noto-color-emoji / fonts-noto-cjk: fixture tab titles include emoji and
# CJK — without them store screenshots show black tofu glyphs.
RUN apt-get update && apt-get install -y --no-install-recommends \
      firefox-esr \
      xvfb \
      openbox \
      xdotool \
      x11-utils \
      imagemagick \
      scrot \
      dbus-x11 \
      fonts-liberation \
      fonts-dejavu-core \
      fonts-noto-color-emoji \
      fonts-noto-cjk \
      procps \
      curl \
      ca-certificates \
      python3 \
      python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Selenium python bindings (for docker/test-selenium.py) — installed in-image.
RUN pip3 install --no-cache-dir --break-system-packages selenium==4.27.1

# geckodriver for `--connect-existing` against a manually launched
# firefox -marionette (see docker/shoot.py).
RUN curl -fsSL "https://github.com/mozilla/geckodriver/releases/download/v0.37.1/geckodriver-v0.37.1-linux64.tar.gz" \
      -o /tmp/geckodriver.tar.gz \
    && tar -xzf /tmp/geckodriver.tar.gz -C /usr/local/bin geckodriver \
    && rm /tmp/geckodriver.tar.gz && chmod +x /usr/local/bin/geckodriver \
    && geckodriver --version

# web-ext available globally (per repo AGENT.md workflow).
RUN npm install -g web-ext@10.8.0

# Non-root user: the node base image already ships `node` (uid 1000), which
# matches the typical host uid so bind-mounted artifacts/ writes are owned by
# the invoking user; Firefox also behaves better as non-root.
RUN mkdir -p /home/node/.cache && chown -R node:node /home/node

COPY --chown=node:node docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

USER node
WORKDIR /repo

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["sleep", "infinity"]
