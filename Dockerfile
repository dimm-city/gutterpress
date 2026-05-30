# syntax=docker/dockerfile:1
# =============================================================================
# print-md CLI container
#
# A self-contained image with EVERYTHING the lint → build → validate pipeline
# needs to turn a markdown project into a validated, print-ready PDF:
#   - the print-md CLI (Node bundle: src + @dimm-city/print-md-lib compiled in)
#   - Chromium            (PDF rendering via Paged.js)
#   - Ghostscript         (PDF/X CMYK conversion)
#   - qpdf                (PDF/X annotation stripping + structural validation)
#   - Poppler utils       (pdfinfo/pdffonts/pdfimages/pdftotext validation)
#   - ImageMagick         (image validation)
#   - htmlhint + markdownlint-cli2 (source lint; Node CLIs)
#   - base fonts + fontconfig
#
# We ship the Node bundle (not the bun --compile standalone binary) so the
# lint step's stylelint can resolve its config/plugins (stylelint-config-
# standard, css-tree data files) from a real node_modules — those dynamic
# resolutions don't survive --compile.
#
# Usage (entrypoint forwards all args to print-md):
#   docker run --rm -v "$PWD:/work" ghcr.io/dimm-city/print-md \
#       run my-book --out dist/my-book.pdf --format pdfx
#
# Mount your project at /work; outputs land back on the host. Pass
# `-u "$(id -u):$(id -g)"` so generated files are owned by you, not root.
# =============================================================================

# ── Stage 1: build the Node CLI bundle ───────────────────────────────────────
FROM oven/bun:1 AS builder

# The builder only needs the CLI + lib graph to bundle; skip heavy optionals.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    PUPPETEER_SKIP_DOWNLOAD=1 \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1

WORKDIR /src
COPY . .

RUN bun install --frozen-lockfile
# Bundles src/cli.ts + the (private, workspace) lib into packages/cli/dist/cli.js
# (+ the lib's embedded assets), keeping the npm runtime deps external (installed
# in the runtime stage). (cd + `bun run`; `bun --cwd <dir> run` mis-parses in Bun.)
RUN cd packages/cli && bun run build:npm

# ── Stage 2: runtime with all OS + lint dependencies ─────────────────────────
# node:20-bookworm-slim gives us Node on Debian 12, whose apt has a real
# `chromium` package (Ubuntu's is a snap, which doesn't work in containers).
FROM node:20-bookworm-slim AS runtime

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        chromium \
        ghostscript \
        qpdf \
        poppler-utils \
        imagemagick \
        fonts-liberation \
        fonts-dejavu-core \
        fontconfig \
        ca-certificates \
        tini; \
    apt-get clean; \
    rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=1 \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1

WORKDIR /app

# Install ONLY the CLI's production runtime deps (the externals the bundle
# expects: puppeteer-core, stylelint(+config), css-tree, markdown-it*, chokidar,
# htmlhint, markdownlint-cli2, …). We synthesize a minimal package.json with
# just `dependencies` — the original's devDependencies carry the workspace:*
# lib (already bundled into dist/cli.js), which npm can't parse, and the
# typescript peer isn't needed at runtime.
COPY --from=builder /src/packages/cli/package.json ./cli-package.json
RUN node -e "const p=require('./cli-package.json'); require('fs').writeFileSync('./package.json', JSON.stringify({name:p.name,version:p.version,private:true,type:'module',dependencies:p.dependencies},null,2))" \
    && rm cli-package.json \
    && npm install --omit=optional --no-package-lock --no-audit --no-fund \
    && npm cache clean --force
COPY --from=builder /src/packages/cli/dist ./dist

# A `print-md` command on PATH so the image works both as `docker run`
# (entrypoint) and as a CI `container:` (where the entrypoint is bypassed and
# steps invoke `print-md` directly).
RUN printf '#!/bin/sh\nexec node /app/dist/cli.js "$@"\n' > /usr/local/bin/print-md \
    && chmod +x /usr/local/bin/print-md \
    && print-md --help >/dev/null

# Point print-md at the apt Chromium and give headless Chromium the flags it
# needs inside a container (no user namespace / small /dev/shm). HOME=/tmp keeps
# tools that want a writable home working under `-u <uid>:<gid>`. node_modules/
# .bin on PATH lets the lint step exec htmlhint / markdownlint-cli2.
ENV CHROMIUM_PATH=/usr/bin/chromium \
    PRINTMD_CHROMIUM_ARGS="--no-sandbox --disable-dev-shm-usage --disable-gpu" \
    HOME=/tmp \
    PATH="/app/node_modules/.bin:${PATH}"

# Projects are mounted here; relative --out paths resolve against it.
WORKDIR /work

# tini reaps the Chromium child processes print-md spawns (no zombie PIDs).
ENTRYPOINT ["/usr/bin/tini", "--", "print-md"]
CMD ["--help"]
