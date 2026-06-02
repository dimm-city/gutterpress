# System Setup {#ch-system}

<div class="lede">Print-md uses external tools for PDF generation and validation. This chapter lists every tool, explains what each one does, and provides per-platform install commands.</div>

## Quick Reference

@section

| Tool | Required for | Tier |
|------|-------------|------|
| Chrome / Chromium | **All PDF output** | Required |
| Ghostscript (`gs`) | PDF/X generation + ink-coverage validation | Recommended |
| `qpdf` | PDF/X generation + PDF/X validation | Recommended (PDF/X only) |
| `identify` (ImageMagick) | Asset validation | Optional |

@end-section

> **PDF validation is built in.** Page size, fonts, images/DPI, bookmarks,
> links, page labels, text density, and structural parsing now run in-process
> via a bundled PDF.js engine — **no Poppler (`pdfinfo`/`pdffonts`/`pdfimages`/
> `pdftotext`) install is required.** Only PDF/X-specific validation still uses
> `qpdf`, which you already need to *produce* PDF/X.
>
> Markdown and HTML source linting are **built in** too — no `markdownlint-cli2`
> or `htmlhint` install is required. See [Source linting — built in](#source-linting-built-in).

## Per-Platform Install

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

# Only for asset (image) validation
brew install imagemagick
```

### Windows

Install Chrome or Chromium from the official websites. For Ghostscript and other tools, use [winget](https://learn.microsoft.com/en-us/windows/package-manager/winget/) or [Chocolatey](https://chocolatey.org/):

```bash
winget install Ghostscript.Ghostscript
winget install qpdf.qpdf  # PDF/X only
# ImageMagick: https://imagemagick.org/script/download.php#windows
```

> **Windows note:** Print-md uses `where` instead of `which` to probe for tools. If you have `busybox` or other POSIX emulators installed, ensure `where` is the one on `PATH`.

### Linux (Debian/Ubuntu)

```bash
# Required — any one works
sudo apt install chromium-browser
sudo apt install google-chrome-stable
# or use puppeteer's bundled Chromium (no manual install needed)

# Recommended
sudo apt install ghostscript

# Only for PDF/X (annotation stripping + PDF/X validation)
sudo apt install qpdf

# Only for asset (image) validation
sudo apt install imagemagick
```

### Linux (Fedora/RHEL)

```bash
sudo dnf install chromium ghostscript qpdf ImageMagick
```

## Tool Details

### Chrome / Chromium — required for PDF

Print-md uses Puppeteer to drive Chromium for PDF rendering. If no browser is found, you will see:

```
error: No Chrome or Chromium binary found.
```

**Resolution options** (in priority order):

1. Install Chrome or Chromium system-wide
2. Set `CHROME_PATH` or `PUPPETEER_EXECUTABLE_PATH` to the binary location
3. Let puppeteer-core download its bundled Chromium (`PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false`)

### Ghostscript — recommended for PDF/X

Used for CMYK conversion, ICC profiles, TAC validation, and PDF/X-1a compliance. Required if building with `--format pdfx`.

```
error: spawn gs ENOENT
```

**Fix:** Install Ghostscript and ensure `gs` is on `PATH`.

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

### ImageMagick `identify` — asset validation only

Used by asset checks to read image resolution and color profile. Without it, those checks are skipped.

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

### `stylelint` — bundled

Bundled with print-md for CSS linting (`print-md lint`). No installation required.

## Configuration

### Environment variables

| Variable | Effect |
|----------|--------|
| `CHROME_PATH` | Override browser binary location |
| `PUPPETEER_EXECUTABLE_PATH` | Alternative browser override |
| `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD` | Set to `false` to allow puppeteer to download Chromium |
| `GS_PATH` | Override Ghostscript binary location |

### Manifest tool paths

```yaml
tools:
  chromePath: "/usr/bin/google-chrome"
  ghostscriptPath: "/usr/local/bin/gs"
```

## Troubleshooting

### `spawn gs ENOENT`

Ghostscript is not installed or not on `PATH`. Install it and verify:

```bash
gs --version
```

### `No Chrome or Chromium binary found`

No browser was found. Install Chrome, set `CHROME_PATH`, or allow puppeteer to download Chromium.

### `spawn qpdf ENOENT` during PDF/X build

`qpdf` is not installed. Required for `--format pdfx`. Install it from your package manager.

### Some validation checks reported as "skipped"

General PDF and source checks run in-process and never skip. Only the
PDF/X checks (need `qpdf`), ink-coverage (needs `gs`), and image asset checks
(need `identify`) can be skipped — install the relevant tool to enable them.

### A specific check still fails after installing its tool

Restart the terminal to pick up the updated `PATH`. If the tool is in a non-standard location, set the corresponding environment variable.

## Roadmap

### Shipped

- Chrome / Chromium PDF rendering via puppeteer-core
- Ghostscript PDF/X conversion
- qpdf annotation stripping + PDF/X validation
- In-process PDF validation via bundled PDF.js (replaced Poppler)
- In-process markdown/HTML linting (replaced markdownlint-cli2/htmlhint)
- ImageMagick asset checks

### Planned (Tier 2)

- Native PDF font subsetting (reduce file size without Ghostscript)
- Integrated image optimization pass

### Future / situational (Tier 3)

- ICC profile embedding for specific print vendors
- Automated ink coverage correction
