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

# Finding #47: freeze the runtime stage's dependency versions to what
# bun.lock actually resolved for THIS build, instead of leaving them as
# caret ranges for `npm install` to re-resolve fresh in stage 2. `bun
# install --frozen-lockfile` above already resolved every dependency exactly
# per bun.lock; read those resolved versions straight out of the installed
# node_modules (no bun.lock parsing needed) and emit a pinned package.json
# for the runtime stage to COPY in. Two builds of the same git tag now
# install byte-identical dependency versions.
RUN <<'DOCKER_EOF'
set -eu
cat <<'JS_EOF' > /tmp/pin-runtime-deps.mjs
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const pkg = JSON.parse(readFileSync("packages/cli/package.json", "utf8"));
// Resolve each dep the way Node would from packages/cli: a workspace install
// may keep a package's direct deps NESTED under packages/cli/node_modules, or
// HOIST them to the repo-root node_modules (bun chooses per-dep, and the choice
// can shift between bun versions). Check the nested path first (it wins at
// runtime when present), then fall back to the hoisted root — so the pin never
// ENOENTs on a hoisted dep. Fail loudly if a declared dep is installed nowhere.
const searchRoots = ["packages/cli/node_modules", "node_modules"];
const pinned = {};
for (const dep of Object.keys(pkg.dependencies)) {
  const depPkgPath = searchRoots
    .map((root) => join(root, dep, "package.json"))
    .find((p) => existsSync(p));
  if (!depPkgPath) {
    throw new Error(
      `Cannot pin "${dep}": no installed package.json under ${searchRoots.join(" or ")}`,
    );
  }
  pinned[dep] = JSON.parse(readFileSync(depPkgPath, "utf8")).version;
}
writeFileSync(
  "runtime-package.json",
  JSON.stringify(
    { name: pkg.name, version: pkg.version, private: true, type: "module", dependencies: pinned },
    null,
    2,
  ) + "\n",
);
JS_EOF
bun /tmp/pin-runtime-deps.mjs
rm /tmp/pin-runtime-deps.mjs
DOCKER_EOF

# ── Stage 2: runtime with all OS + lint dependencies ─────────────────────────
# node:20-bookworm-slim gives us Node on Debian 12, whose apt has a real
# `chromium` package (Ubuntu's is a snap, which doesn't work in containers).
FROM node:22-bookworm-slim AS runtime

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
# so all `dependencies` (markdown-it*, puppeteer-core, isomorphic-git,
# markdownlint, postcss, …) are resolved here from the pinned minimal
# package.json the builder stage emitted (name/version/dependencies, exact
# versions from bun.lock — see finding #47 — dropping devDependencies).
COPY --from=builder /src/runtime-package.json ./package.json
RUN npm install --omit=optional --no-package-lock --no-audit --no-fund \
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
