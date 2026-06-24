# syntax=docker/dockerfile:1
# =============================================================================
# print-md CLI container
#
# A self-contained image with EVERYTHING the lint → build → validate pipeline
# needs to turn a markdown project into a validated, print-ready PDF — including
# the full PDF/X (CMYK) pre-print path:
#   - the print-md CLI (Node bundle: src + @dimm-city/print-md compiled in)
#   - Chromium            (PDF rendering via Paged.js — REQUIRED for any PDF)
#   - Ghostscript         (PDF/X CMYK conversion + ink-coverage validation)
#   - qpdf                (PDF/X annotation stripping + OutputIntent validation)
#   - base fonts + fontconfig
#
# All other validation (page size, fonts, images/DPI, bookmarks, links, text,
# markdown/HTML/CSS lint, image color/alpha) runs IN-PROCESS in the bundle, so
# Poppler, ImageMagick, htmlhint, markdownlint-cli2, and stylelint are no longer
# installed (see ADR 0002). The remaining three tools exist only to enable the
# optional PDF/X pre-print pipeline; a plain RGB `build` needs only Chromium.
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
# Standard build: emits dist/cli.js (the bin) + dist/index.js (lib) with runtime
# deps kept external (`--packages=external`), installed in the runtime stage.
RUN cd packages/cli && bun run build

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

# Install the package's runtime deps. dist/ is built with `--packages=external`,
# so all `dependencies` (markdown-it*, pagedjs, puppeteer-core, isomorphic-git,
# markdownlint, postcss, …) are resolved here from a synthesized minimal
# package.json (just `name`/`version`/`dependencies`, dropping devDependencies).
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
# tools that want a writable home working under `-u <uid>:<gid>`.
ENV CHROMIUM_PATH=/usr/bin/chromium \
    PRINTMD_CHROMIUM_ARGS="--no-sandbox --disable-dev-shm-usage --disable-gpu" \
    HOME=/tmp

# Projects are mounted here; relative --out paths resolve against it.
WORKDIR /work

# tini reaps the Chromium child processes print-md spawns (no zombie PIDs).
ENTRYPOINT ["/usr/bin/tini", "--", "print-md"]
CMD ["--help"]
