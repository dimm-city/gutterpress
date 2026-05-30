# Running print-md in Docker

The `print-md` container ships the CLI **and every system dependency** the
`lint → build → validate` pipeline needs to produce a validated, print-ready
PDF — Chromium, Ghostscript, qpdf, Poppler, ImageMagick, base fonts, and the
`htmlhint` / `markdownlint-cli2` source linters. Nothing to install on the host
except Docker.

## Get the image

```sh
# Pull the published image…
docker pull ghcr.io/dimm-city/print-md:latest

# …or build it from this repo
docker build -t print-md .
```

## Run

The image's entrypoint **is** the `print-md` binary, so everything after the
image name is forwarded straight to the CLI. Mount your project at `/work`
(the container's working directory); relative `--out` paths resolve there and
outputs land back on the host.

```sh
# Show CLI help
docker run --rm ghcr.io/dimm-city/print-md --help

# Build a PDF from a project folder in the current directory
docker run --rm -v "$PWD:/work" ghcr.io/dimm-city/print-md \
    build my-book --out dist/my-book.pdf

# Full pipeline → print-ready PDF/X (CMYK + ICC + post-build validation)
docker run --rm -v "$PWD:/work" ghcr.io/dimm-city/print-md \
    build my-book --out dist/my-book.pdf --format pdfx

# Lint only
docker run --rm -v "$PWD:/work" ghcr.io/dimm-city/print-md lint my-book

# Validate an already-built PDF
docker run --rm -v "$PWD:/work" ghcr.io/dimm-city/print-md \
    validate dist/my-book.pdf
```

### Keep output files owned by you

By default the container runs as root, so files it writes to the mounted
directory are root-owned on the host. Pass your own uid/gid to avoid that:

```sh
docker run --rm -u "$(id -u):$(id -g)" -v "$PWD:/work" ghcr.io/dimm-city/print-md \
    build my-book --out dist/my-book.pdf --format pdfx
```

(`HOME=/tmp` is baked into the image so tools that need a writable home still
work under an arbitrary uid.)

### A convenience alias

```sh
alias print-md='docker run --rm -u "$(id -u):$(id -g)" -v "$PWD:/work" ghcr.io/dimm-city/print-md'
# then just:
print-md build my-book --out dist/my-book.pdf --format pdfx
```

## How it renders

Headless Chromium can't use its sandbox inside a container, so the image sets
`PRINTMD_CHROMIUM_ARGS="--no-sandbox --disable-dev-shm-usage --disable-gpu"` and
`CHROMIUM_PATH=/usr/bin/chromium`. Override either with `-e` if you need to:

```sh
docker run --rm -e PRINTMD_CHROMIUM_ARGS="--no-sandbox --disable-dev-shm-usage" \
    -v "$PWD:/work" ghcr.io/dimm-city/print-md build my-book --out dist/book.pdf
```

If you hit Chromium crashes on very large books, give the container more shared
memory: `--shm-size=1g` (this lets you drop `--disable-dev-shm-usage`).

## CI usage

The image is ideal for CI — no per-runner tool installation:

```yaml
build-pdf:
  runs-on: ubuntu-latest
  container: ghcr.io/dimm-city/print-md:latest
  steps:
    - uses: actions/checkout@v4
    - run: print-md build my-book --out dist/my-book.pdf --format pdfx
    - uses: actions/upload-artifact@v4
      with: { name: book, path: dist/my-book.pdf }
```

## What's inside

| Dependency | Provides |
|---|---|
| print-md CLI (Node bundle) | the CLI (lint/build/validate) |
| Chromium | Paged.js PDF rendering |
| Ghostscript | PDF/X CMYK conversion, `/Creator` stamp, ink-coverage checks |
| qpdf | PDF/X annotation stripping + structural validation |
| Poppler (`pdfinfo`/`pdffonts`/`pdfimages`/`pdftotext`) | bleed, page-size, font-embedding, image checks |
| ImageMagick (`identify`) | image alpha / color-space / resolution checks |
| `htmlhint`, `markdownlint-cli2` | source lint |
| `fonts-liberation`, `fonts-dejavu-core`, fontconfig | base fonts (your project fonts come from the mount) |
