# System Setup {#ch-system}

<div class="lede">Print-md does almost everything in-process. It needs only a Chromium-based browser to render PDFs, plus — for the optional PDF/X (CMYK) pre-print pipeline — Ghostscript and qpdf. This chapter explains what each tool is for, how to install it, and how the Docker image gives you the whole pipeline with nothing to install.</div>

## Quick Reference

@section

| Tool | Used for | When you need it |
|------|----------|------------------|
| Chrome / Chromium | Renders your HTML + Paged.js layout into a PDF | **Always** (every PDF) |
| Ghostscript (`gs`) | Converts the RGB PDF to **CMYK PDF/X** with an ICC output intent; per-page ink-coverage check | Only for `--format pdfx` |
| `qpdf` | Strips disallowed annotations for PDF/X; validates the PDF/X OutputIntent + metadata | Only for `--format pdfx` |

@end-section

> **Why so few tools?** Page size, fonts, images/DPI, bookmarks, links, page
> labels, text density, structure, image color/alpha, and markdown/HTML/CSS
> linting all run **in-process** — no Poppler, ImageMagick, `markdownlint-cli2`,
> `htmlhint`, or stylelint to install (see ADR 0002). A plain RGB `build` needs
> only a browser; Ghostscript and qpdf exist solely to enable PDF/X checks and
> conversion.

## Easiest path: Docker (the whole PDF/X pipeline, nothing to install)

If you want a complete, validated, print-ready **PDF/X** without installing
Ghostscript/qpdf/Chromium yourself, use the container — it bundles all three:

```bash
# One-off: build a print-ready PDF/X from a project in the current folder
docker run --rm -u "$(id -u):$(id -g)" -v "$PWD:/work" \
    ghcr.io/dimm-city/print-md \
    build my-book --out dist/my-book.pdf --format pdfx
```

This is also the recommended way to run the full pipeline in CI. See the
[Docker guide](../../docs/docker.md) for the convenience alias, output
ownership, and CI examples. The rest of this chapter covers installing the
tools directly on your machine instead.

## Install the tools on your machine

### macOS

```bash
# Required — any one of these works
brew install --cask chromium
brew install --cask google-chrome
brew install chromium

# Recommended (needed for PDF/X)
brew install ghostscript

# Only for PDF/X (annotation stripping + PDF/X validation)
brew install qpdf

```

### Windows

Install Chrome or Chromium from the official websites. For Ghostscript and other tools, use [winget](https://learn.microsoft.com/en-us/windows/package-manager/winget/) or [Chocolatey](https://chocolatey.org/):

```bash
winget install Ghostscript.Ghostscript
winget install qpdf.qpdf  # PDF/X only
```

> **Windows note:** Print-md uses `where` instead of `which` to probe for tools. If you have `busybox` or other POSIX emulators installed, ensure `where` is the one on `PATH`.

### Linux (Debian/Ubuntu)

```bash
# Required — any one works
sudo apt install chromium-browser
sudo apt install google-chrome-stable

# Recommended
sudo apt install ghostscript

# Only for PDF/X (annotation stripping + PDF/X validation)
sudo apt install qpdf

```

### Linux (Fedora/RHEL)

```bash
sudo dnf install chromium ghostscript qpdf
```

## Tool Details

### Chrome / Chromium — required for PDF

Print-md uses `puppeteer-core` (not full `puppeteer`) to drive Chromium for PDF
rendering. **`puppeteer-core` never downloads or bundles a browser** — it only
ever drives one already on your machine. If no browser is found, you will see:

```
No Chrome / Chromium / Edge binary found. print-md needs a Chromium-based
browser to render PDFs.
```

**Resolution order** (print-md checks these in sequence — first match wins):

1. The `CHROMIUM_PATH` or `PUPPETEER_EXECUTABLE_PATH` environment variable (either works; `CHROMIUM_PATH` is checked first)
2. Standard install locations for Chrome, Chromium, Edge, and Brave on your OS (the paths installed by the commands above)
3. A `PATH` probe (`which` / `where.exe`) for Chrome, Chromium, Edge, Brave, Vivaldi, Opera, and their platform-specific variants

**Fix:** install Chrome, Chromium, Edge, Brave, Vivaldi, or Opera normally, or
set `CHROMIUM_PATH=/path/to/your/browser` if it's in a non-standard location.
The print-md desktop app includes its own browser and needs no separate browser
installation.

### Ghostscript — recommended for PDF/X

Used for CMYK conversion, ICC profiles, TAC validation, and PDF/X-1a compliance. Required if building with `--format pdfx`.

Print-md checks `GHOSTSCRIPT_PATH` first, then the command names available on
`PATH` (`gs` on macOS/Linux; `gswin64c`, `gswin32c`, or `gs` on Windows).
On Windows it also detects versioned installs under the conventional
`Program Files\gs\gs*\bin` directories, so the standard installer works
without a hand-made `gs` alias.

**Fix:** Install Ghostscript normally, or set `GHOSTSCRIPT_PATH` to its
command-line executable when it lives in a non-standard location.

### qpdf — PDF/X only

Required for the `stripAnnotations` step in the PDF/X pipeline, and for the
PDF/X-specific validation checks (`pdf.print.pdfx-markers`,
`pdf.print.pdfx-metadata`). Not needed for standard PDF output or for general
PDF validation — those now use the bundled PDF.js engine.

```
warn: Tool "qpdf" not found — skipping: pdf.print.pdfx-markers, pdf.print.pdfx-metadata
```

This is a warning, not an error — the build succeeds, but those PDF/X checks are skipped.

### PDF validation — built in (no Poppler)

Page size, bleed boxes, embedded fonts, image resolution/DPI, bookmarks, TOC
links, cross-references, page labels, rasterized-page detection, text density,
layout variance, and structural parsing all run **in-process** via a bundled
PDF.js engine (the `unpdf` package). **Poppler (`pdfinfo`, `pdffonts`,
`pdfimages`, `pdftotext`) is no longer used or required.** These checks run
everywhere, including from the standalone binary, with zero system tools.

> Fidelity note: structural validation is a "does it parse cleanly" gate rather
> than a deep `qpdf --check`, and image DPI is derived from the rendered placed
> size (best-effort). See ADR 0002 for details.

### Image asset checks — built in (no ImageMagick)

Image resolution (DPI), color space, and alpha-channel checks read PNG/JPEG/TIFF
headers **in-process** — **ImageMagick (`identify`) is no longer used or
required.** These run everywhere, including from the standalone binary.

### Source linting — built in {#source-linting-built-in}

Markdown linting (`source.markdownlint`) and HTML linting (`source.htmlhint`)
run **in-process** using the bundled `markdownlint` and `htmlhint` libraries.
No `markdownlint-cli2` or `htmlhint` CLI install is required — these checks run
everywhere, including from the standalone binary. Disable either in the manifest
if not needed, or point them at a config file:

```yaml
validate:
  source:
    markdownlint: false          # or ".markdownlint.yaml" to use a config
    htmlhint: false              # or ".htmlhintrc"
```

Markdown linting auto-detects `.markdownlint.{yaml,yml,json,jsonc}` (and the
`.markdownlint-cli2.{yaml,jsonc}` variants) in the source directory; HTML
linting auto-detects `.htmlhintrc`.

### CSS print-safety linting — built in (no stylelint)

`print-md lint` checks CSS for print-safety issues (remote URLs, rasterizing
effects, Paged.js crash-prone selectors) using print-md's own postcss-based
checks. **stylelint is not used or required** — it can't be bundled into the
`bun build --compile` binary, so these checks run in-process everywhere,
including from the standalone binary.

## Configuration

### Environment variables

| Variable | Effect |
|----------|--------|
| `CHROMIUM_PATH` | Override browser binary location (checked first) |
| `PUPPETEER_EXECUTABLE_PATH` | Alternative browser override (same priority as `CHROMIUM_PATH`) |
| `GHOSTSCRIPT_PATH` | Override Ghostscript command-line executable location (checked first) |
| `PRINT_MD_CONFIG_DIR` | Override the CLI config and credential directory |

`qpdf` has no path-override environment variable; add a non-standard install
to `PATH`.

The CLI config directory is `%APPDATA%\print-md` on Windows and
`$XDG_CONFIG_HOME/print-md` (or `~/.config/print-md`) on macOS and Linux.
Diagnostics report this existing location; print-md does not move credentials
when reporting it.

### Manifest tool paths

There is no manifest key for overriding tool binary paths — no `tools:`
block, no `chromePath`/`ghostscriptPath` options. Use the environment
variables above (Chromium and Ghostscript) or `PATH` instead.

## Troubleshooting

### `Ghostscript executable not found`

Ghostscript was not found in the locations above. Install it, set
`GHOSTSCRIPT_PATH`, or verify the command is on `PATH`:

```bash
gs --version
```

### `No Chrome / Chromium / Edge binary found`

No browser was found. Install Chrome, Chromium, Edge, Brave, Vivaldi, or Opera, or set
`CHROMIUM_PATH` (or `PUPPETEER_EXECUTABLE_PATH`) to an existing binary.
puppeteer-core cannot download one for you — see "Chrome / Chromium —
required for PDF" above. Alternatively, use the desktop app, which includes
its own browser.

### `spawn qpdf ENOENT` during PDF/X build

`qpdf` is not installed. Required for `--format pdfx`. Install it from your package manager.

### Some validation checks reported as "skipped"

General PDF, source, and image-asset checks run in-process and never skip. Only
the PDF/X checks (need `qpdf`) and ink-coverage (needs `gs`) can be skipped —
install the relevant tool to enable them.

### A specific check still fails after installing its tool

Restart the terminal to pick up the updated `PATH`. If the tool is in a
non-standard location, set `CHROMIUM_PATH` (Chromium), set `GHOSTSCRIPT_PATH`
(Ghostscript), or add qpdf to `PATH`.

## Roadmap

### Shipped

- Chrome / Chromium PDF rendering via puppeteer-core
- Ghostscript PDF/X conversion
- qpdf annotation stripping + PDF/X validation
- In-process PDF validation via bundled PDF.js (replaced Poppler)
- In-process markdown/HTML linting (replaced markdownlint-cli2/htmlhint)
- In-process image asset checks (replaced ImageMagick identify)

### Planned (Tier 2)

- Native PDF font subsetting (reduce file size without Ghostscript)
- Integrated image optimization pass

### Future / situational (Tier 3)

- ICC profile embedding for specific print vendors
- Automated ink coverage correction
