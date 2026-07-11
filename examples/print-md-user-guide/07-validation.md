# Validation & Best Practices {#ch-validation}

<div class="lede">Print-md's validation system checks your project for print compliance at two points in the pipeline — before the PDF build and after. This chapter covers the 31 built-in checks, CLI usage, and production workflow recommendations.</div>

## Validation Overview

The validation system runs checks at two phases:

- **Pre-build** — Source, asset, and some heuristic checks run before PDF generation
- **Post-build** — PDF structural, print compliance, and quality checks run after PDF generation

When using `print-md build --format pdf` or `--format pdfx`, validation is automatically integrated into the pipeline:

```
lint → validate:pre-build → convert → assets → build → validate:post-build
```

## CLI Usage

### Validate a PDF

```bash
# Validate an existing PDF for print compliance
print-md validate --pdf dist/book.pdf

# With a manifest for project-specific settings
print-md validate --pdf dist/book.pdf --manifest ./manifest.yaml

# Lock deterministic DTRPG thresholds
print-md validate --pdf dist/book.pdf --profile dtrpg
```

### Preflight report

```bash
# Run post-build checks and write JSON + markdown reports
print-md preflight --pdf dist/book.pdf --profile dtrpg

# Custom report location
print-md preflight --pdf dist/book.pdf --report-dir .reviews --name release-preflight
```

### Validate source files

```bash
# Run source and asset checks on your project
print-md validate --input ./my-book

# Both pre-build and post-build checks together
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

# Run a group with wildcard selectors
print-md validate --input ./my-book --only source.links.*

# Skip specific checks
print-md validate --pdf dist/book.pdf --skip pdf.nav.cross-refs

# JSON output for CI
print-md validate --pdf dist/book.pdf --format json
```

## CLI Arguments

@section

| Argument | Description |
|----------|-------------|
| `--pdf` | Path to PDF file (enables post-build checks) |
| `--input` | Source directory (enables pre-build checks) |
| `--manifest` | Path to `manifest.yaml` |
| `--category` | Comma-separated: `source`, `pdf`, `asset`, `heuristic` |
| `--only` | Run only these check IDs (comma-separated, supports `*`) |
| `--skip` | Skip these check IDs |
| `--format` | Output format: `text` (default) or `json` |
| `--phase` | Override phase: `pre-build` or `post-build` |
| `--profile` | `dtrpg` for deterministic print-on-demand thresholds |

@end-section

## Check Categories

### Source checks (pre-build)

Run on markdown source files and assets before the PDF is generated. Catch authoring errors early.

Examples: broken internal links, missing alt text, oversized source images, markdown lint errors.

### PDF checks (post-build)

Run on the generated PDF. Verify structural correctness and print compliance.

Examples: page size matches manifest, fonts are embedded, metadata is present, PDF/X compliance.

### Asset checks (pre-build)

Run on image and font files in the `assets` directory.

Examples: image resolution below 300 DPI, unsupported color profiles, missing font files.

### Heuristic checks (post-build)

Quality proxies that catch common issues not detectable from structure alone.

Examples: ink coverage estimates, page count anomalies, unexpected blank pages.

## Manifest Configuration

Add a `validate` section to enable/disable which checks run. Check
*thresholds* (like the ink-coverage limit below) are configured under their
own top-level manifest keys, not under `validate:`:

```yaml
validate:
  # Disable specific checks
  checks:
    pdf.structure.qpdf: false
    source.accessibility.alt-text: false

  # Disable built-in source linting (markdown / HTML) if not needed
  source:
    htmlhint: false
    markdownlint: false

# Ink-coverage / TAC threshold — this is a TOP-LEVEL manifest key, not
# nested under `validate:`. There is no `validate.thresholds` key; unknown
# keys are silently ignored, so a threshold nested under `validate:` has no
# effect at all.
ink:
  maxTac: 240        # max total area coverage %, default 240
  tacTolerance: 0.5  # allowed overage before a page is flagged, default 0.5
```

## Automatic Tool Detection

Most checks run in-process and never need an external tool. Only a few still
probe for a system tool and warn if it is missing:

```
warn  Tool "qpdf" not found — skipping: pdf.print.pdfx-markers, pdf.print.pdfx-metadata
warn  Tool "gs" not found — skipping: pdf.print.ink-coverage, asset.image.tac-raster
```

Everything else — page size, fonts, images/DPI, bookmarks, links, page labels,
text density, color space, alpha, markdown/HTML linting — runs with no system
dependency, so you can validate immediately on any machine.

## File Organization Best Practices

### Recommended project structure

```
my-book/
├── manifest.yaml
├── 00-frontmatter/
│   ├── title.md
│   ├── credits.md
│   └── toc.md
├── 01-introduction.md
├── 02-chapter-one.md
├── 99-backmatter/
│   └── appendix.md
├── assets/
│   ├── images/
│   ├── fonts/
│   └── diagrams/
└── styles/
    ├── variables.css
    └── custom.css
```

### Naming conventions

**Files:** Number for explicit ordering (`01-intro.md`), descriptive names, all lowercase with hyphens.

**Images:** Include chapter prefix (`ch03-combat-example.png`), version suffix when needed (`map-v2.png`).

## Production Workflow

### 1. Write and preview

```bash
print-md preview ./my-book
```

Keep the preview open in Chrome and edit source files. The browser reloads automatically on save.

### 2. Validate source

```bash
print-md validate --input ./my-book
```

Fix any pre-build issues — missing alt text, broken links, oversized assets — before building.

### 3. Build and validate PDF

```bash
print-md build ./my-book --format pdfx
```

This runs the full pipeline including both pre-build and post-build validation.

### 4. Preflight for submission

```bash
print-md preflight --pdf dist/my-book.pdf --profile dtrpg
```

Generates deterministic JSON and markdown reports suitable for archival or submission evidence.

## Testing Checklist

@section

Before final print submission:

- [ ] All images are at least 300 DPI
- [ ] All fonts embed correctly in the PDF
- [ ] Page size matches the printer's required trim size
- [ ] Bleed extends 0.125in beyond the trim edge on full-bleed pages
- [ ] No unexpected blank pages
- [ ] Running headers are correct on all pages
- [ ] Page numbers start at the right page and run correctly
- [ ] Validate passes with `--profile dtrpg` (or your target platform's equivalent)

@end-section

## Common Issues

### Blank pages

Caused by excess `@page` markers. Audit your source files for unnecessary page breaks — bare `@page` between short adjacent sections is the most common culprit.

### Page break issues

- Don't force breaks unnecessarily
- Don't use `<br>` tags for vertical spacing
- Don't rely on specific pagination — let flow happen naturally and use `@section` to prevent unwanted breaks

### Font issues

- Ensure font files are included in the `source.assets` list in `manifest.yaml`
- Test on a clean machine to catch fonts that only happen to be installed locally

### Color shift

Test the CMYK conversion before submitting to a printer. Adjust RGB values if colors look wrong in the converted output.
