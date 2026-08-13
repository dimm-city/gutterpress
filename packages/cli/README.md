# Gutterpress

Command-line interface for Gutterpress — markdown to print-ready PDF.

The CLI is for power users who want to script builds, run in CI, batch-process projects, or work outside the desktop app. If you just want to write a book and export a PDF, use the [desktop app](https://github.com/dimm-city/gutterpress#get-the-desktop-app) instead.

## Install

### Standalone binary (no Node, no Bun required)

Download for your platform from the [latest release](https://github.com/dimm-city/gutterpress/releases/latest):

| Platform | Binary |
|---|---|
| Linux x64 | `gutterpress-linux-x64` |
| Linux ARM64 | `gutterpress-linux-arm64` |
| macOS Apple Silicon | `gutterpress-macos-arm64` |
| macOS Intel | `gutterpress-macos-x64` |
| Windows x64 | `gutterpress-windows-x64.exe` |

Move the binary somewhere on your `PATH`, mark it executable (`chmod +x`), and you're done.

Every new GitHub release includes `SHA256SUMS.txt`. Verify the hash for your
download before running it, especially when bypassing Gatekeeper or
SmartScreen. See the [installation guide](../../docs/installing.md) for
commands and the complete supported-platform matrix.

### From Homebrew (macOS and Linux)

```sh
brew tap dimm-city/gutterpress https://github.com/dimm-city/gutterpress.git
brew install dimm-city/gutterpress/gutterpress
```

### From Scoop (Windows x64)

```powershell
scoop bucket add gutterpress https://github.com/dimm-city/gutterpress.git
scoop install gutterpress/gutterpress
```

### From npm

```sh
npm install -g gutterpress
```

Node.js 22 or newer is required for the npm install.

Installing with an npm git URL is intentionally unsupported. This repository
is a Bun monorepo, its generated `dist/` is not committed, and the repository
root is not the published CLI package. Use one of the installs above, or clone
the repository and run `bun install` when contributing to Gutterpress itself.

## System requirements

The CLI needs a Chromium-based browser for PDF generation, and a few external tools for PDF post-processing and validation depending on which features you use. See [User Guide: Chapter 7 — System Setup](https://github.com/dimm-city/gutterpress/blob/main/examples/gutterpress-user-guide/07-system-setup.md) for the full per-feature requirements matrix.

The short version: CLI PDF rendering needs a Chromium-based browser. Optional
PDF/X output additionally needs **Ghostscript** and **qpdf**; the desktop app
uses its bundled browser for standard PDF export.

## Quick start

```sh
# Scaffold a new project (manifest + starter chapter + stylesheet)
  gutterpress new "My First Book" --preset dtrpg

# Build a PDF from a project directory
  gutterpress build ./my-book

# Live native-engine preview (incremental Markdown updates over WebSocket)
  gutterpress preview ./my-book

# Custom output path
  gutterpress build ./my-book --out dist/my-book.pdf

# Print-ready PDF/X (CMYK + ICC profile, validation enabled)
  gutterpress build ./my-book --format pdfx --icc path/to/profile.icc

# HTML output (a self-contained directory with book.html + assets)
  gutterpress build ./my-book --format html --out dist/my-book/
```

## Project layout

A Gutterpress project is a directory. The CLI doesn't impose much structure; the most common shape is:

```
my-book/
├─ manifest.yaml      ← optional but recommended; metadata + config
├─ chapter-01.md      ← markdown files, processed in alphabetical order
├─ chapter-02.md         (or in the order listed in manifest.yaml#source.files)
├─ css/               ← your stylesheets
│  └─ print.css
└─ images/            ← images referenced from markdown or CSS
```

The CLI discovers assets from what the book actually references — there is no
directory list to keep in sync. Fonts are no exception: a font can live
anywhere in the project; `@font-face { src: url(...) }` in your CSS resolves
relative to that CSS file, wherever it is, and the build embeds it
automatically. Images referenced from markdown or HTML must live inside the
project folder (they keep their own relative path in the output); images
referenced only from CSS may live anywhere the CSS can reach.

See [User Guide: Chapter 1 — Getting Started](https://github.com/dimm-city/gutterpress/blob/main/examples/gutterpress-user-guide/01-getting-started.md) for a full first-project walkthrough and [examples/](https://github.com/dimm-city/gutterpress/tree/main/examples) for working starters.

## Manifest

`manifest.yaml` is where you control everything that isn't authored in markdown — book title, the page-size preset, custom styles, plugin loading, validation rules, PDF/X configuration. It is the only recognized project manifest filename. The schema lives in [`docs/schema-autocomplete.md`](https://github.com/dimm-city/gutterpress/blob/main/docs/schema-autocomplete.md) for YAML autocomplete in editors.

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

The full configuration cascade is `CLI flags > manifest.yaml > preset defaults`. See the [configuration reference](https://github.com/dimm-city/gutterpress/blob/main/examples/gutterpress-user-guide/01-getting-started.md#manifest-configuration) for details.

## Commands

Gutterpress has 11 subcommands. `new`, `preview`, `build`, and `publish` are the
primary author commands; `lint`, `validate`, `audit`, and `preflight` are
CI / advanced checks; `repair` is the version-history escape hatch; and
`doctor` reports system readiness. `plugin` manages project plugins. Every
command also accepts `--help` for the authoritative, always-current flag list
(`gutterpress <command> --help`) — this section is regenerated from the same
source.

### `gutterpress new`

Scaffold a new project from an embedded starter template — the fastest way to start writing (see [Quick start](#quick-start)). Every new book picks the vendor preset it's designed for: `dtrpg` (DriveThruRPG print-on-demand), `book` (neutral 6x9in trade book), or `custom` (you supply the trim size in points).

```sh
gutterpress new <name> --preset <id> [options]

  --preset <id>            Vendor preset the book is designed for: dtrpg, book, custom (required)
  --author <name>          Author name to record in the project
  --dir <path>             Parent directory to create the project in (default: current directory)
  --folder <name>          Folder name to create (default: a slug of the project name)
  --template <id>          Starter template: book, zine, technical (default: book)
  --targets <ids>          Publish targets recorded in the manifest (comma-separated: dtrpg, itch; or "none") — default: the preset's
  --page-width <pt>        Trim width in points, 72pt = 1in (required with --preset custom; optional override otherwise)
  --page-height <pt>       Trim height in points, 72pt = 1in (required with --preset custom; optional override otherwise)
  --page-tolerance <pt>    Allowed trim deviation when validating a built PDF (default: 0.5)
  --git                    Initialise local version history (default: true; use --no-git to skip)
  --no-git
```

### `gutterpress preview`

Live HTML preview server by default. A single Markdown edit is rendered and
spliced as one chapter over WebSocket; CSS, manifest, multi-file, deletion, and
other structural changes reload the full document. This path is pure JS and
needs no external tools. Pass `--format pdf` or `--format pdfx` for a one-shot
build-and-open instead. `--manifest` applies only to those one-shot PDF/PDF-X
modes; live HTML preview discovers the project manifest from its input
directory.

```sh
gutterpress preview [input-dir] [options]

  --format <fmt>          html (default, live HMR) | pdf | pdfx
  --port <n>              Bind port                     (default: 3579, html only)
  --host <h>              Bind host                     (default: 127.0.0.1). Pass 0.0.0.0 to expose on the LAN.
  --no-watch              Disable file watching (html only)
  --open                  Automatically open browser (default: true; use --no-open to skip)
  --no-open
  --verbose               Enable verbose output
  --debug                 Debug mode (preserve temporary files)
  --out <dir>             Output directory                              (pdf|pdfx only)
  --pdfx-flavor <flavor>  PDF/X flavor: x1a | x3                        (pdfx only)
  --icc <path>            Path to ICC profile (required for --format pdfx)
  --manifest <path>       Path to manifest.yaml                          (pdf|pdfx only)
  --strip-annotations     Strip PDF annotations for PDF/X compliance    (pdfx only)
  --skip-lint             Skip CSS linting                              (pdf|pdfx only)
  --skip-pre-validate     Skip pre-build validation                     (pdf|pdfx only)
  --skip-post-validate    Skip post-build PDF/X validation              (pdfx only)
  --engine <name>         native (default) | paged (deprecated)   [overrides the manifest's engine: field; applies to the live preview AND --format pdf|pdfx]
```

### `gutterpress build`

Build a PDF (default) or HTML output. Pipeline: `lint → validate:pre → convert → assets → build → validate:post`.

```sh
gutterpress build [input-dir] [options]

  --format <fmt>          pdf | pdfx | html       (default: pdf)
  --out <path>            Output file or directory. For pdf|pdfx, --out may also be a .pdf file path.
  --title <title>         Override manifest title
  --pdfx-flavor <flavor>  PDF/X flavor: x1a | x3   (--format pdfx only)
  --icc <path>            Path to ICC profile (required for --format pdfx)
  --manifest <path>       Path to manifest.yaml
  --strip-annotations     Strip PDF annotations for PDF/X compliance
  --skip-lint             Skip the CSS print-safety pass (default: lint runs for pdf/pdfx)
  --skip-pre-validate     Skip pre-build validation
  --skip-post-validate    Skip post-build PDF/X validation
  --engine <name>         native (default) | paged (deprecated)   [overrides the manifest's engine: field; native = the Gutterpress engine, native Chromium pagination]
```

### `gutterpress publish`

Push a built PDF/HTML artifact to a publishing platform (itch.io, DriveThruRPG, Amazon KDP, Azure Static Web Apps, Shopify), headlessly and CI-safely. Credentials live in a 0600 user-config store (never in the project); provider env vars override it for CI.

```sh
gutterpress publish [project] [options]

  --provider <id>     itch | drivethrurpg | kdp | azure-swa | shopify
  --list               List providers and connection status
  --connect            Store an API key for --provider (from --token, the provider's env var, or piped stdin)
  --disconnect         Forget the stored key for --provider
  --account <label>    Named-credential label for --connect/--disconnect (keep several accounts per provider); omit for the default
  --token <key>        API key for --connect (prefer stdin/env var to keep it out of shell history)
  --file <path>        Artifact to publish (PDF path, or HTML export dir). Default: the manifest's output location
  --manifest <path>    Path to manifest.yaml
  --dry-run            Preflight only; don't contact the platform
  --json               Machine-readable JSON output (CI)
  --open               Open the result page / guided upload page in the browser
```

```sh
# List providers and connection status
gutterpress publish --list

# Store an API key for itch.io, then publish
gutterpress publish --provider itch --connect
gutterpress publish --provider itch ./my-book
```

### `gutterpress lint`

Run Gutterpress's PostCSS-based print-safety checks, including remote URLs,
rasterizing effects, and source-level page-containment risks, against the
project's CSS files.

```sh
gutterpress lint [files] [options]

  --manifest <path>    Path to manifest.yaml
```

`files` is a positional: either a project directory containing `manifest.yaml` (its configured stylesheets are linted), or a glob pattern for CSS files to lint directly. There is no `--files` flag — pass the directory/glob as the positional.

Common findings include remote `url(...)` references, effects that rasterize
print text, and declarations on core page wrappers that could clip or trap
out-of-flow art. The source-level containment check is an early signal; the
build-time `engine.layer.trapped` diagnostic inspects the authoritative live
ancestor chain.

### `gutterpress validate`

Run the validation pipeline (pre-build source checks and/or post-build PDF checks). Tools that aren't installed are skipped with a warning — they don't fail the run. See [User Guide: Chapter 6 — Validation](https://github.com/dimm-city/gutterpress/blob/main/examples/gutterpress-user-guide/06-validation.md) for the full check list and [User Guide: Chapter 7 — System Setup](https://github.com/dimm-city/gutterpress/blob/main/examples/gutterpress-user-guide/07-system-setup.md) for which external tools each check needs.

The positional directory and `--pdf`/`--input` are independent: the positional (or `--input`) sets the pre-build source directory, `--pdf` separately points at a built PDF for post-build checks. `--input` overrides the positional if both are given.

```sh
gutterpress validate [dir] [options]

  --pdf <path>         Path to the PDF file to validate (post-build checks)
  --input <dir>        Source directory for pre-build checks (overrides the positional directory)
  --manifest <path>    Path to manifest.yaml
  --category <c>       Comma-separated categories: source, pdf, asset, heuristic
  --only <ids>         Run only these check IDs/selectors (comma-separated)
  --skip <ids>         Skip these check IDs/selectors (comma-separated)
  --format <fmt>       text (default) | json
  --phase <p>          pre | post | all | pre-build | post-build   (default: all)
  --target <t>         Publish targets to validate against (comma-separated, e.g. dtrpg,itch), overriding the manifest's `targets:`
```

### `gutterpress audit`

Run asset-only validation checks (image DPI/format/color-space, print-readiness) without the rest of the validation pipeline.

```sh
gutterpress audit [dir] [options]

  --input <dir>        Asset directory (overrides the positional directory)
  --manifest <path>    Path to manifest.yaml
  --only <ids>         Run only these check IDs/selectors (comma-separated)
  --skip <ids>         Skip these check IDs/selectors (comma-separated)
  --format <fmt>       text (default) | json
```

### `gutterpress preflight`

Run a deterministic print preflight against an already-built PDF and write a GO/FIX/NO-GO report (JSON + Markdown) — the automatable gate for CI before handing a PDF to a printer.

```sh
gutterpress preflight [dir] --pdf <path> [options]

  --pdf <path>              Path to the PDF file to preflight   (required)
  --input <dir>             Optional source directory for pre-build checks (overrides the positional directory)
  --manifest <path>         Path to manifest.yaml
  --target <t>              Publish targets to preflight against (comma-separated, e.g. dtrpg,itch), overriding the manifest's `targets:`
  --report-dir <dir>        Output directory for preflight reports (default: alongside the PDF)
  --name <name>             Base filename for report outputs
```

Exits 1 when the computed status is `NO-GO` (errors, or a required check skipped/failed).

### `gutterpress repair`

Diagnose and repair the project's version history — no git knowledge (and no system git) required. Detects the states that block syncing (an update that didn't finish, a leftover lock from a crash, a damaged or missing history) and applies the same safe repair the desktop app offers: a safety-copy zip is saved first, and nothing changes without your confirmation.

```sh
gutterpress repair [dir]

  --check     Diagnose only — never change anything (exit 1 when repair is needed)
  --yes       Approve the repair without prompting
  --force     Repair even if the Gutterpress app appears to have this project open
```

### `gutterpress doctor`

Report the Gutterpress version, platform and config paths, and whether each external tool is available. Missing tools include the features that use them and platform-specific installation guidance.

```sh
gutterpress doctor
```

### `gutterpress plugin`

Manage project markdown-it plugins.

```sh
gutterpress plugin

  --help    Show plugin subcommands
```

#### `gutterpress plugin add`

Download a markdown-it package and its runtime dependencies directly from npm,
verify their registry hashes, vendor the complete graph into the project, and
pin the exact root version. This does not invoke npm, Bun, Node.js tooling, or
package install scripts.

```sh
gutterpress plugin add markdown-it-highlightjs ./my-book
gutterpress plugin add markdown-it-highlightjs@4.3.0 ./my-book
gutterpress plugin add markdown-it-emoji@3.0.0 ./my-book --export full
```

## Exit codes

Every command follows the same exit-code contract, so CI can branch on the result without parsing output:

| Code | Meaning |
|---|---|
| `0` | Clean — no findings, nothing to fix. |
| `1` | Findings — the command ran fine but reported findings/validation failures (`lint` CSS errors, `validate`/`preflight`/`audit` findings, a `build` quality-gate rejection). |
| `2` | Usage — the invocation itself was wrong: a bad flag, positional argument, preset, or value. |
| `3` | Pipeline — the build/render/export pipeline itself failed for a reason unrelated to usage or findings (I/O error, missing tool, renderer crash). |

This applies uniformly across `build`, `preview`, `lint`, `validate`, `preflight`, `audit`, `repair`, `publish`, `plugin`, `new`, and `doctor`.

## Plugins

Gutterpress uses [markdown-it](https://github.com/markdown-it/markdown-it) under the hood, so pure-JavaScript plugins that follow the `(md, options) => void` signature work without a Gutterpress-specific API. Load them in `manifest.yaml`:

```yaml
plugins:
  # npm package installed by `gutterpress plugin add markdown-it-highlightjs`
  - name: markdown-it-highlightjs
    version: 4.3.0
  # package whose plugin function is a named export
  - name: markdown-it-emoji
    version: 3.0.0
    export: full
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

Pinned npm packages and their runtime dependencies live under `plugins/npm/`,
with a receipt that records the exact graph and hashes the complete tree. They
travel with the project and builds never fetch from the registry. Install/build
scripts, native addon compilation, bundled `node_modules`, and non-registry
dependency selectors are intentionally unsupported. Only install packages you
trust: plugins run unsandboxed with the process's full filesystem and network
privileges.

Use the manifest `export` field, or `plugin add --export <name>`, for packages
that expose a named plugin function instead of a default export.

See [User Guide: Chapter 5 — Plugins](https://github.com/dimm-city/gutterpress/blob/main/examples/gutterpress-user-guide/05-plugins.md) for authoring custom plugins.

## CI / scripting

The standalone binary is the easiest way — drop it in a GitHub Actions step and you're done:

```yaml
- name: Build PDF
  run: |
    curl -L -o gutterpress \
      https://github.com/dimm-city/gutterpress/releases/latest/download/gutterpress-linux-x64
    chmod +x gutterpress
    sudo apt-get install -y google-chrome-stable ghostscript
    ./gutterpress build ./my-book --out dist/my-book.pdf
```

The binary is self-contained except for the system tools described in [User Guide: Chapter 7 — System Setup](https://github.com/dimm-city/gutterpress/blob/main/examples/gutterpress-user-guide/07-system-setup.md). On a runner with Chrome and Ghostscript present, you don't need a separate Node or Bun install.

## Troubleshooting

- **`Ghostscript executable not found`** — Ghostscript is required only for PDF/X and ink-coverage checks. Standard Windows installs are auto-detected; for a non-standard install, set `GHOSTSCRIPT_PATH` to the full path of `gs`, `gswin64c.exe`, or `gswin32c.exe`. See [User Guide: Chapter 7 — System Setup](https://github.com/dimm-city/gutterpress/blob/main/examples/gutterpress-user-guide/07-system-setup.md).
- **`No Chrome or Chromium binary found`** — install a Chromium-based browser or set `CHROMIUM_PATH=/path/to/chrome`. The desktop app includes its own browser and needs no separate browser install.
- **`Tool "X" not found — skipping`** during validate — that's the graceful path; the check requires `X` and isn't available. Install the tool or accept the skip.
- **All validate checks skipped on Windows** — was a bug pre-0.1.7 (used `which`, which isn't on stock Windows); fixed to use `where.exe`.

## Links

- [GitHub repository](https://github.com/dimm-city/gutterpress)
- [Report an issue](https://github.com/dimm-city/gutterpress/issues)
- [Full user guide](https://github.com/dimm-city/gutterpress/tree/main/examples/gutterpress-user-guide)
- [Desktop app](https://github.com/dimm-city/gutterpress/releases/latest)

## License

[MPL-2.0](https://github.com/dimm-city/gutterpress/blob/main/LICENSE)
