# @dimm-city/print-md

Command-line interface for print-md — markdown to print-ready PDF.

The CLI is for power users who want to script builds, run in CI, batch-process projects, or work outside the desktop app. If you just want to write a book and export a PDF, use the [desktop app](../../README.md#get-the-desktop-app) instead.

## Install

### Standalone binary (no Node, no Bun required)

Download for your platform from the [latest release](https://github.com/dimm-city/print-md/releases/latest):

| Platform | Binary |
|---|---|
| Linux x64 | `print-md-cli-linux-x64` |
| Linux ARM64 | `print-md-cli-linux-arm64` |
| macOS Apple Silicon | `print-md-cli-macos-arm64` |
| macOS Intel | `print-md-cli-macos-x64` |
| Windows x64 | `print-md-cli-windows-x64.exe` |

Move the binary somewhere on your `PATH`, mark it executable (`chmod +x`), and you're done.

### From npm

```sh
npm install -g @dimm-city/print-md
```

This installs the CLI for `node`-based projects. Same surface area as the binary.

### From source (development only)

```sh
git clone https://github.com/dimm-city/print-md.git
cd print-md
bun install
bun packages/cli/src/cli.ts --help
```

## System requirements

The CLI needs a Chromium-based browser for PDF generation, and a few external tools for PDF post-processing and validation depending on which features you use. See [`docs/system-dependencies.md`](../../docs/system-dependencies.md) for the full per-feature requirements matrix.

The short version: you almost certainly want **Ghostscript** installed for PDF output, and **Chrome** / **Chromium** / **Edge** for the actual render.

## Quick start

```sh
# Build a PDF from a project directory
print-md build ./my-book

# Live preview server (Paged.js + websocket-driven full-reload on file change)
print-md preview ./my-book

# Custom output path
print-md build ./my-book --out dist/my-book.pdf

# Print-ready PDF/X (CMYK + ICC profile, validation enabled)
print-md build ./my-book --format pdfx --icc path/to/profile.icc

# HTML output (a self-contained directory with book.html + assets)
print-md build ./my-book --format html --out dist/my-book/
```

## Project layout

A print-md project is a directory. The CLI doesn't impose much structure; the most common shape is:

```
my-book/
├─ manifest.yaml      ← optional but recommended; metadata + config
├─ chapter-01.md      ← markdown files, processed in alphabetical order
├─ chapter-02.md         (or in the order listed in manifest.yaml#source.files)
├─ css/               ← your stylesheets
│  └─ print.css
├─ fonts/             ← font files referenced from CSS @font-face
└─ images/            ← images referenced from markdown or CSS
```

See [docs/getting-started.md](../../docs/getting-started.md) for a full first-project walkthrough and [examples/](../../examples/) for working starters.

## Manifest

`manifest.yaml` is where you control everything that isn't authored in markdown — book title, the page-size preset, custom styles, plugin loading, validation rules, PDF/X configuration. The schema lives in [`docs/schema-autocomplete.md`](../../docs/schema-autocomplete.md) for YAML autocomplete in editors.

Minimal example:

```yaml
title: "My Book"
authors:
  - "Your Name Here"

# Pick a page-size preset or supply page.width / page.height yourself
preset: dtrpg

styles:
  - css/print.css

source:
  files:
    - chapter-01.md
    - chapter-02.md
```

The full configuration cascade is `CLI flags > manifest.yaml > preset defaults`. See [docs/user-guide.md](../../docs/user-guide.md#configuration) for the comprehensive reference.

## Commands

### `print-md build`

Build a PDF (default) or HTML output. Pipeline: `lint → validate:pre → convert → assets → build → validate:post`.

```sh
print-md build [input-dir] [options]

  --format          pdf | pdfx | html       (default: pdf)
  --out             Output file or directory
  --title           Override manifest title
  --skip-lint       Skip the stylelint pass
  --skip-pre-validate
  --skip-post-validate
  --strip-annotations    PDF/X only: flatten form annotations (default: true)
  --icc <path>           PDF/X only: ICC profile for CMYK conversion
  --pdfx-flavor    x1a | x3                  (default: x3)
```

### `print-md preview`

Start a live preview server. Serves `book.html` and triggers full-reload via WebSocket when files change.

```sh
print-md preview [input-dir] [options]

  --port <n>        Bind port               (default: 3579)
  --host <h>        Bind host               (default: 127.0.0.1)
  --no-watch        Skip file watcher
  --open            Open default browser    (default: false)
```

Preview itself uses no external tools — pure JS rendering. Paged.js runs in your browser when you open the URL.

### `print-md lint`

Run stylelint with print-md's built-in print-safety plugin against the project's CSS files.

```sh
print-md lint [input-dir] [--files <glob>]
```

Common print-unsafe patterns the plugin flags: remote `url(...)` references in CSS, paged.js-crashing `:is()`-with-sibling selectors, properties with no print equivalent.

### `print-md validate`

Run the validation pipeline (pre-build source checks and/or post-build PDF checks). Tools that aren't installed are skipped with a warning — they don't fail the run. See [`docs/validation.md`](../../docs/validation.md) for the full check list and [`docs/system-dependencies.md`](../../docs/system-dependencies.md) for which external tools each check needs.

```sh
print-md validate [input-dir] [options]

  --phase <p>       pre | post | all         (default: all)
  --category <c>    source | asset | pdf | heuristic
  --only <ids>      Comma-separated check IDs
  --skip <ids>      Comma-separated check IDs
  --format          text | json               (default: text)
```

## Plugins

print-md uses [markdown-it](https://github.com/markdown-it/markdown-it) under the hood, so any plugin that follows the `(md, options) => void` signature works out of the box. Load them in `manifest.yaml`:

```yaml
plugins:
  # npm package
  - markdown-it-attrs
  # local file
  - ./plugins/my-custom-plugin.js
  # with options
  - name: markdown-it-footnote
    options:
      includeSubsections: false
  # explicit priority (lower runs first)
  - name: markdown-it-anchor
    priority: 10
```

See [`docs/plugins.md`](../../docs/plugins.md) for authoring custom plugins.

## CI / scripting

The standalone binary is the easiest way — drop it in a GitHub Actions step and you're done:

```yaml
- name: Build PDF
  run: |
    curl -L -o print-md \
      https://github.com/dimm-city/print-md/releases/latest/download/print-md-cli-linux-x64
    chmod +x print-md
    sudo apt-get install -y google-chrome-stable ghostscript
    ./print-md build ./my-book --out dist/my-book.pdf
```

The binary is self-contained except for the system tools described in [`docs/system-dependencies.md`](../../docs/system-dependencies.md). On a runner with Chrome and Ghostscript present, you don't need a separate Node or Bun install.

## Troubleshooting

- **`spawn gs ENOENT`** — Ghostscript not installed. Plain `--format pdf` keeps working (only loses the `/Creator` metadata stamp). PDF/X builds genuinely need it. See [system-dependencies.md](../../docs/system-dependencies.md).
- **`No Chrome or Chromium binary found`** — install Chrome/Chromium/Edge, or set `CHROMIUM_PATH=/path/to/chrome` in your environment.
- **`Tool "X" not found — skipping`** during validate — that's the graceful path; the check requires `X` and isn't available. Install the tool or accept the skip.
- **All validate checks skipped on Windows** — was a bug pre-0.1.7 (used `which`, which isn't on stock Windows); fixed to use `where.exe`.

## Development

This package is part of the [print-md monorepo](../../README.md). The CLI itself is a thin shell over [`@dimm-city/print-md-lib`](../lib/) — almost all logic lives there.

```sh
# From repo root
bun install

# Run CLI from source
bun packages/cli/src/cli.ts build ./examples/dc-design-guide

# Build the standalone binary for the current platform
bun --cwd packages/cli scripts/compile.ts bun-linux-x64 ./dist/print-md-cli-linux-x64

# Build the npm tarball
bun --cwd packages/cli scripts/build-npm.ts
```

See [`CONTRIBUTING.md`](../../CONTRIBUTING.md) for the contributor workflow and [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) for the architectural rules of this package (no bundlers at runtime, lazy-loaded heavy deps, etc).

## License

[MPL-2.0](../../LICENSE)
