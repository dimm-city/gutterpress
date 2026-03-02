# Validation Guide

print-md includes a comprehensive validation system that checks your project for print-readiness across four categories: source files, assets, rendered PDFs, and heuristic quality proxies.

## Overview

The validation system runs checks at two phases of the pipeline:

- **Pre-build** — Source, asset, and some heuristic checks run before PDF generation
- **Post-build** — PDF structural, print compliance, and quality checks run after PDF generation

When using the `run` pipeline, validation is automatically integrated:

```
lint → validate:pre-build → convert → assets → build → validate:post-build
```

The validation phase is determined implicitly by which input flags you provide:
- Use `--pdf` alone for post-build checks
- Use `--input` alone for pre-build checks
- Use both `--pdf` and `--input` to run all checks
- Optionally use `--phase` to override and run checks for a specific phase only

## Automatic Tool Detection

Before running any checks, the validate command probes the system for required external tools (e.g. `qpdf`, `pdfinfo`, `identify`). If a tool is missing, print-md warns you which checks will be skipped:

```
warn  Tool "qpdf" not found — skipping: pdf.structure.qpdf, pdf.print.ink-coverage, pdf.nav.bookmarks, ...
warn  Tool "identify" not found — skipping: asset.image.resolution, asset.image.color-space, asset.image.alpha-channel
```

Checks that don't need the missing tool continue to run normally. This means you can use validation immediately without installing every system dependency — you'll get results for whatever tools you do have, and clear guidance on what you're missing.

**Suppressed warnings**: If a check is explicitly disabled (via `validate.checks` in the manifest, or by setting a source tool to `false`), no warning is shown for its missing tool. For example, if your manifest has:

```yaml
validate:
  checks:
    pdf.structure.qpdf: false    # Disabled — no warning about missing qpdf
  source:
    htmlhint: false              # Disabled — no warning about missing htmlhint
```

Then `qpdf` and `htmlhint` will not appear in the missing-tool warnings even if they aren't installed.

## CLI Usage

### Validate a PDF (post-build checks)

```bash
# Validate an existing PDF for print compliance
print-md validate --pdf dist/book.pdf

# With a manifest for project-specific settings
print-md validate --pdf dist/book.pdf --manifest ./manifest.yaml

# Lock deterministic DTRPG thresholds/check set
print-md validate --pdf dist/book.pdf --profile dtrpg
```

### Preflight report command

```bash
# Runs post-build checks and writes deterministic JSON + markdown reports
print-md preflight --pdf dist/book.pdf --profile dtrpg

# Custom report destination/base filename
print-md preflight --pdf dist/book.pdf --report-dir .reviews --name release-preflight
```

### Validate source files (pre-build checks)

```bash
# Run source and asset checks on your project
print-md validate --input ./my-book
```

### Run all checks

```bash
# Both pre-build and post-build
print-md validate --input ./my-book --pdf dist/book.pdf
```

### Filtering checks

```bash
# Only PDF checks
print-md validate --pdf dist/book.pdf --category pdf

# Only source and asset checks
print-md validate --input ./my-book --category source,asset

# Run a single specific check
print-md validate --pdf dist/book.pdf --only pdf.print.page-size

# Run check groups with wildcard selectors
print-md validate --input ./my-book --only source.links.*,source.accessibility.*

# Run all checks except specific ones
print-md validate --pdf dist/book.pdf --skip pdf.nav.cross-refs,pdf.nav.page-labels

# Only pre-build phase (overrides implicit phase detection)
print-md validate --input ./my-book --phase pre-build
```

### Output formats

```bash
# Default human-readable output
print-md validate --pdf dist/book.pdf

# JSON output for CI/tooling
print-md validate --pdf dist/book.pdf --format json
```

### In the pipeline

```bash
# Full pipeline with validation at both phases
print-md run --input ./my-book --pdfx x1a

# Skip pre-build validation
print-md run --input ./my-book --pdfx x1a --skip-pre-validate

# Skip post-build validation
print-md run --input ./my-book --pdfx x1a --skip-validate
```

## CLI Arguments

| Argument | Type | Description |
|----------|------|-------------|
| `--pdf` | string | Path to PDF file (enables post-build checks) |
| `--input` | string | Source directory (enables pre-build checks) |
| `--manifest` | string | Path to manifest.yaml |
| `--category` | string | Comma-separated: `source`, `pdf`, `asset`, `heuristic` |
| `--only` | string | Run only these check IDs/selectors (comma-separated, supports `*`) |
| `--skip` | string | Skip these check IDs/selectors (comma-separated, supports `*`) |
| `--format` | string | Output: `text` (default) or `json` |
| `--phase` | string | Optional: `pre-build` or `post-build` (overrides implicit phase detection) |
| `--profile` | string | Optional profile lock. `dtrpg` enforces strict PDF/X checks + TAC defaults |

## Manifest Configuration

Add a `validate` section to your `manifest.yaml` to configure checks:

```yaml
validate:
  enabled: true  # Set false to disable all validation

  # Per-check overrides
  checks:
    pdf.structure.qpdf: false                    # Disable a specific check
    heuristic.whitespace.text-density:
      severity: info                             # Downgrade severity

  # Source validation — delegates to existing linting tools
  source:
    markdownlint: ".markdownlint.yaml"           # Path to config, or false to disable
    htmlhint: ".htmlhintrc"                      # Path to config, or false to disable
    stylelint: ".stylelintrc.json"               # Path to config, or false to disable
    allowedCallouts:                             # Print-md-specific container types
      - sidebar
      - ability
      - specialty
      - container
      - aug

  # Asset validation
  assets:
    maxImageSize: 10000000                       # 10MB max per image
    minImageDpi: 300                             # Minimum DPI for print
    allowedColorSpaces: ["CMYK", "Grayscale"]    # Allowed color spaces
    allowAlpha: false                            # Disallow alpha channels
    approvedFontFiles: ["fonts/**/*.{woff2,otf}"] # Glob patterns
    requireFontLicense: false                    # Check for LICENSE files

  # PDF/print production checks
  pdf:
    requireBookmarks: false
    requireTocLinks: false
    minImageResolution: 300                      # DPI in rendered PDF
    forbidTransparency: true
    requireBleed: false
    bleedSize: 9                                 # Points (0.125in)

  # Heuristic quality checks
  heuristics:
    maxDecorativeLayers: 5                       # Images per page
    textDensityRange:
      min: 200                                   # Min chars/page
      max: 5000                                  # Max chars/page
    maxParagraphsPerSection: 10
```

## Check Categories

### Source Checks (pre-build)

Source checks validate your markdown, HTML, and CSS files by delegating to established linting tools. This means you configure rules using each tool's native config format.

| Check ID | Tool | What it checks |
|----------|------|----------------|
| `source.markdownlint` | markdownlint-cli2 | Heading hierarchy, line length, formatting, etc. |
| `source.htmlhint` | htmlhint | HTML validity, inline styles, tag correctness |
| `source.stylelint` | stylelint | CSS rule violations, forbidden properties |
| `source.callout-validation` | (built-in) | Container types vs `allowedCallouts` list |
| `source.links.local-refs` | (built-in) | Local markdown links/image refs exist |
| `source.accessibility.alt-text` | (built-in) | Image markdown has non-empty alt text |
| `source.accessibility.heading-order` | (built-in) | Heading levels do not jump (e.g. H1 -> H3) |

**Tool config files**: Instead of defining rules in the manifest, point to each tool's native config file:

```yaml
validate:
  source:
    markdownlint: ".markdownlint.yaml"  # Standard markdownlint config
    htmlhint: ".htmlhintrc"             # Standard htmlhint config
```

Setting a tool to `false` disables it entirely. Setting to `null` (or omitting) enables auto-detection of config files in the project root.

Wildcard selectors in `--only/--skip` match full check IDs. For example: `source.accessibility.*` or `source.links.*`.

**System dependencies**: `markdownlint-cli2`, `htmlhint`, and `stylelint` must be installed (globally or project-local) for their respective checks to run. Missing tools are detected automatically and their checks are skipped with a warning (see [Automatic Tool Detection](#automatic-tool-detection)).

### PDF Checks (post-build)

PDF checks inspect the generated PDF for print production compliance.

| Check ID | What it checks |
|----------|----------------|
| `pdf.structure.qpdf` | PDF structural integrity via qpdf |
| `pdf.print.page-size` | Page dimensions match config |
| `pdf.print.pdfx-markers` | GTS_PDFX / OutputIntent presence |
| `pdf.print.color-spaces` | No forbidden color spaces (RGB, Lab, etc.) |
| `pdf.print.embedded-fonts` | All fonts embedded |
| `pdf.print.ink-coverage` | Total area coverage (TAC) within limits |
| `pdf.print.rasterized-pages` | Detects unintentionally rasterized pages |
| `pdf.print.image-resolution` | Image DPI meets minimum |
| `pdf.print.transparency` | Transparency markers in PDF |
| `pdf.print.bleed` | MediaBox vs TrimBox bleed area |
| `pdf.print.pdfx-metadata` | XMP metadata and output intent |
| `pdf.nav.bookmarks` | PDF outline (bookmarks) tree |
| `pdf.nav.toc-links` | Link annotations on TOC pages |
| `pdf.nav.cross-refs` | Internal link annotation count |
| `pdf.nav.page-labels` | PDF page label numbering |

**System dependencies** (missing tools are detected automatically — see [Automatic Tool Detection](#automatic-tool-detection)):

| Tool | Checks that require it | Install |
|------|----------------------|---------|
| `qpdf` | qpdf structure, ink-coverage, bookmarks, toc-links, cross-refs, page-labels, pdfx-metadata, placement-variance | `apt install qpdf` or `brew install qpdf` |
| `pdfinfo` | page-size, rasterized-pages, bleed, text-density | `apt install poppler-utils` or `brew install poppler` |
| `pdffonts` | embedded-fonts | (included in poppler-utils) |
| `pdfimages` | rasterized-pages, image-resolution, layer-count | (included in poppler-utils) |
| `pdftotext` | rasterized-pages, text-density | (included in poppler-utils) |
| `strings` | ink-coverage | (usually pre-installed) |
| `grep` | pdfx-markers, color-spaces, transparency | (usually pre-installed) |

### Asset Checks (pre-build)

Asset checks validate source images and fonts before they enter the build.

| Check ID | What it checks |
|----------|----------------|
| `asset.image.file-size` | Image files under size limit |
| `asset.image.resolution` | Source image DPI meets minimum |
| `asset.image.color-space` | Image color space in allowed list |
| `asset.image.alpha-channel` | No alpha channels (for print) |
| `asset.image.tac-raster` | Per-image ink coverage via Ghostscript |
| `asset.font.approved-files` | Fonts match approved file patterns |
| `asset.font.missing-refs` | CSS @font-face src files exist on disk |
| `asset.font.license` | License files present in font directories |

### Asset-Only Audit Command

Use `audit` when you want just asset checks without running full source/PDF validation:

```bash
# Audit one asset directory
print-md audit ./images

# JSON output with selectors
print-md audit ./images --format json --only asset.image.*
```

**System dependencies** (missing tools are detected automatically — see [Automatic Tool Detection](#automatic-tool-detection)):

| Tool | Checks that require it | Install |
|------|----------------------|---------|
| `identify` (ImageMagick) | image resolution, color-space, alpha-channel | `apt install imagemagick` or `brew install imagemagick` |
| `gs` (Ghostscript) | image TAC | `apt install ghostscript` or `brew install ghostscript` |

### Heuristic Checks (post-build)

Heuristic checks provide quality signals about content density and layout.

| Check ID | What it checks |
|----------|----------------|
| `heuristic.whitespace.text-density` | Characters per page within range |
| `heuristic.chunking.section-density` | Paragraphs per section |
| `heuristic.decoration.layer-count` | Image objects per page |
| `heuristic.layout.placement-variance` | Text position consistency |

## DTRPG Preset Defaults

When using the `dtrpg` preset (the default), the following validation defaults apply:

- **Source**: Auto-detect tool configs, allowed callouts: sidebar, ability, specialty, container, aug
- **Assets**: 10MB max image size, 300 DPI minimum, CMYK/Grayscale only, no alpha
- **PDF**: 300 DPI minimum resolution, transparency forbidden, no bleed requirement
- **Heuristics**: 5 max decorative layers, 200-5000 chars/page, 10 paragraphs/section

## JSON Output Format

With `--format json`, the output is structured as:

```json
{
  "results": [
    {
      "checkId": "pdf.print.page-size",
      "severity": "error",
      "message": "Page size mismatch: expected ~621x810 pts, got 612x792 pts.",
      "file": "/path/to/book.pdf"
    }
  ],
  "summary": {
    "total": 15,
    "errors": 1,
    "warnings": 2,
    "infos": 0,
    "passed": 12
  },
  "passed": [
    "pdf.structure.qpdf",
    "pdf.print.pdfx-markers"
  ]
}
```

## Extending with Custom Checks

The check system uses a self-registering pattern. Each check module calls `registerCheck()` at import time. To add a custom check:

```typescript
import { registerCheck } from "../checks/registry";
import type { Check, CheckContext, CheckResult } from "../checks/types";

const myCheck: Check = {
  id: "custom.my-check",
  name: "My Custom Check",
  description: "Validates something project-specific",
  category: "source",
  phase: "pre-build",
  // Declare external tools your check needs (optional).
  // If listed, the tool-check step will verify they are installed
  // and skip your check with a warning if they are missing.
  requiredTools: ["my-cli-tool"],
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    // Your validation logic here
    return [];
  },
};

registerCheck(myCheck);
```

If your check doesn't need any external CLI tools (e.g. it only reads files or uses built-in Node/Bun APIs), omit `requiredTools` entirely.
