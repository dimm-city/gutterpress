# Validation & Best Practices {#ch-validation}

@section .lede

Gutterpress's validation system checks your project for print compliance at two points in the pipeline — before the PDF build and after. This chapter covers the 34 built-in checks, CLI usage, and production workflow recommendations.

@end-section

## Validation Overview

The validation system runs checks at two phases:

- **Pre-build** — Source, asset, and some heuristic checks run before PDF generation
- **Post-build** — PDF structural, print compliance, and quality checks run after PDF generation

When using `gutterpress build`, validation is automatically integrated into the
pipeline:

```
lint → validate:pre-build → convert → assets → build → validate:post-build
```

The final `validate:post-build` phase runs for `--format pdfx` only — a plain
`--format pdf` build stops after the build step. Everything before it runs for
both formats.

## Publish Targets

Where you *publish* is a separate decision from how your book is *designed*
(the `preset:` — see Chapter 1). A **target** is a destination's validation
policy: what its platform demands of the finished PDF. Targets never change
how the book renders — only what the validator checks.

- `dtrpg` — DriveThruRPG print-on-demand: PDF/X markers and metadata,
  CMYK/Grayscale art, the 240% ink limit, embedded fonts.
- `itch` — itch.io digital release: a well-formed PDF with embedded fonts;
  print-only rules (PDF/X, ink limits, CMYK-only art) don't apply.

List them in your manifest to validate every destination in one run:

```yaml
targets:
  - dtrpg
  - itch
```

The report labels each destination's findings (`[dtrpg]`, `[itch]`), so one
source can be checked for print and digital at the same time. Projects
created with `gutterpress new` or the desktop app always carry an explicit
`targets:` list — you choose the destinations at creation time (and can
uncheck them all, recorded as `targets: []`). In the desktop app you can
change them whenever you like under **Project settings → Details →
Publish targets**. In a hand-written manifest
with no `targets:` line, the preset's default applies (the `dtrpg` preset
validates for DriveThruRPG; `book` and `custom` validate for no
destination). An explicit empty list (`targets: []`) opts out entirely.
Your own manifest settings always win over a target's policy — a target
only fills in what you haven't set.

The `dtrpg` target's checks need qpdf and Ghostscript installed (Chapter
7). With the target selected but the tools missing, validation reports the
required checks as errors rather than silently skipping them — that's
deliberate: "validated for DriveThruRPG" must mean the checks actually ran.
If you're not ready to install them, set `targets: []` until you are. The
`itch` target needs no external tools.

## CLI Usage

### Validate a PDF

```bash
# Validate an existing PDF for print compliance
gutterpress validate --pdf dist/my-book/my-book-pdf.pdf

# With a manifest for project-specific settings
gutterpress validate --pdf dist/my-book/my-book-pdf.pdf --manifest ./manifest.yaml

# Validate against a specific publish target's requirements
gutterpress validate --pdf dist/my-book/my-book-pdf.pdf --target dtrpg

# One source, two destinations: check DriveThruRPG print AND itch.io digital
gutterpress validate --pdf dist/my-book/my-book-pdf.pdf --target dtrpg,itch
```

### Preflight report

```bash
# Run post-build checks and write JSON + markdown reports
gutterpress preflight --pdf dist/my-book/my-book-pdf.pdf --target dtrpg

# Custom report location
gutterpress preflight --pdf dist/my-book/my-book-pdf.pdf --report-dir .reviews --name release-preflight
```

### Validate source files

```bash
# Run source and asset checks on your project
gutterpress validate --input ./my-book

# Both pre-build and post-build checks together
gutterpress validate --input ./my-book --pdf dist/my-book/my-book-pdf.pdf
```

### Filtering checks

```bash
# Only PDF checks
gutterpress validate --pdf dist/my-book/my-book-pdf.pdf --category pdf

# Only source and asset checks
gutterpress validate --input ./my-book --category source,asset

# Run a single specific check
gutterpress validate --pdf dist/my-book/my-book-pdf.pdf --only pdf.print.page-size

# Run a group with wildcard selectors
gutterpress validate --input ./my-book --only source.links.*

# Skip specific checks
gutterpress validate --pdf dist/my-book/my-book-pdf.pdf --skip pdf.nav.cross-refs

# JSON output for CI
gutterpress validate --pdf dist/my-book/my-book-pdf.pdf --format json
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
| `--target` | Publish targets to validate against (comma-separated: `dtrpg`, `itch`), overriding the manifest's `targets:` |

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
gutterpress preview ./my-book
```

Keep the preview open in Chrome and edit source files. The browser reloads automatically on save.

### 2. Validate source

```bash
gutterpress validate --input ./my-book
```

Fix any pre-build issues — missing alt text, broken links, oversized assets — before building.

### 3. Build and validate PDF

```bash
gutterpress build ./my-book --format pdfx
```

This runs the full pipeline including both pre-build and post-build validation.

### 4. Preflight for submission

```bash
gutterpress preflight --pdf dist/my-book/my-book-pdfx.pdf --target dtrpg
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
- [ ] Validate passes for every destination you publish to (`--target dtrpg,itch`, or your manifest's `targets:` list)

@end-section

## Common Issues

### Blank pages

Caused by excess `@page` markers. Audit your source files for unnecessary page breaks — bare `@page` between short adjacent sections is the most common culprit.

### Page break issues

- Don't force breaks unnecessarily
- Don't use `<br>` tags for vertical spacing
- Don't rely on specific pagination — let flow happen naturally and use `@section` to prevent unwanted breaks

### Font issues

- A missing font is a build error naming the file — check the `url(...)` path
  in your CSS is correct and relative to that CSS file
- Test on a clean machine to catch fonts that only happen to be installed locally

### Color shift

Test the CMYK conversion before submitting to a printer. Adjust RGB values if colors look wrong in the converted output.
