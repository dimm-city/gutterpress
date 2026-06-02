# System Setup {#ch-system}

<div class="lede">Print-md uses external tools for PDF generation and validation. This chapter lists every tool, explains what each one does, and provides per-platform install commands.</div>

## Quick Reference

@section

| Tool | Required for | Tier |
|------|-------------|------|
| Chrome / Chromium | **All PDF output** | Required |
| Ghostscript (`gs`) | PDF/X generation | Recommended |
| `qpdf` | PDF/X + some validation | Recommended |
| `pdfinfo`, `pdffonts`, `pdfimages`, `pdftotext` | Validation only | Optional |
| `identify` (ImageMagick) | Asset validation | Optional |

@end-section

> Markdown and HTML source linting are **built in** — no `markdownlint-cli2` or
> `htmlhint` install is required. See [Source linting — built in](#source-linting-built-in).

## Per-Platform Install

### macOS

```bash
# Required — any one of these works
brew install --cask chromium
brew install --cask google-chrome
brew install chromium

# Recommended (needed for PDF/X)
brew install ghostscript

# Only for PDF/X with stripAnnotations
brew install qpdf

# Only for validation
brew install poppler imagemagick
```

### Windows

Install Chrome or Chromium from the official websites. For Ghostscript and other tools, use [winget](https://learn.microsoft.com/en-us/windows/package-manager/winget/) or [Chocolatey](https://chocolatey.org/):

```bash
winget install Ghostscript.Ghostscript
winget install qpdf.qpdf
# Poppler: download from https://github.com/oschwartz10612/poppler-windows
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

# Only if building PDF/X with stripAnnotations
sudo apt install qpdf

# Only if running validation
sudo apt install poppler-utils imagemagick
```

### Linux (Fedora/RHEL)

```bash
sudo dnf install chromium ghostscript qpdf poppler-utils ImageMagick
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

### qpdf — PDF/X and some validation

Required for the `stripAnnotations` step in the PDF/X pipeline, and for `pdf.structure.qpdf` validation checks. Not needed for standard PDF output.

```
warn: spawn qpdf ENOENT — skipping: pdf.structure.qpdf, pdf.print.ink-coverage, ...
```

This is a warning, not an error — the build succeeds, but those checks are skipped.

### Poppler tools — validation only

`pdfinfo`, `pdffonts`, `pdfimages`, `pdftotext` are used by post-build PDF checks. Without them, those checks are skipped with a warning.

```
warn: Tool "pdfinfo" not found — skipping: pdf.nav.page-labels, pdf.metadata.title, ...
```

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

### All validation checks reported as "skipped"

External validation tools are all missing. Install at least `poppler-utils` and `qpdf` to enable the most important PDF checks.

### A specific check still fails after installing its tool

Restart the terminal to pick up the updated `PATH`. If the tool is in a non-standard location, set the corresponding environment variable.

## Roadmap

### Shipped

- Chrome / Chromium PDF rendering via puppeteer-core
- Ghostscript PDF/X conversion
- qpdf annotation stripping
- Poppler validation checks
- ImageMagick asset checks

### Planned (Tier 2)

- Native PDF font subsetting (reduce file size without Ghostscript)
- Integrated image optimization pass

### Future / situational (Tier 3)

- ICC profile embedding for specific print vendors
- Automated ink coverage correction
