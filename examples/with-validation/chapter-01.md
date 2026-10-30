# Introduction

Welcome to the validation example. This project demonstrates how Gutterpress checks your work for print-readiness.

## Getting Started

Gutterpress validation runs automatically during the build pipeline, or you can invoke it directly:

```bash
# Validate source files (pre-build)
gutterpress validate --input .

# Validate a built PDF (post-build)
gutterpress validate --pdf dist/validation-example/validation-example-pdf.pdf

# Full validated PDF/X pipeline (validates at both phases)
gutterpress build . --format pdfx
```

## How Validation Works

The validation system checks four categories:

1. **Source checks** run markdownlint and htmlhint against your markdown and generated HTML.
2. **Asset checks** verify the size and transparency of the images the book uses, and its fonts, before the build.
3. **PDF checks** inspect the generated PDF for structural integrity, page dimensions, color compliance, and font embedding.
4. **Heuristic checks** flag potential quality issues like sparse pages or excessive decoration.

## Configuration

The `checks` map in `manifest.yaml` sets each check's level by its ID: `off`,
`on`, `info`, `warn` or `error`. The markdownlint and htmlhint checks read
their own config files (`.markdownlint.yaml`, `.htmlhintrc`) from the book's
folder or a folder above it. The thresholds the checks measure against (image
size, DPI, ink coverage, text density) come from the preset and the publish
target; a book overrides one as an option in that check's entry, as this
example's manifest does for the largest image file.

> **Tip:** Run `gutterpress validate --format json` to get machine-readable output for CI pipelines.

## Filtering Checks

Target specific categories or individual checks:

```bash
# Only PDF checks
gutterpress validate --pdf dist/validation-example/validation-example-pdf.pdf --category pdf

# Only a single check
gutterpress validate --pdf dist/validation-example/validation-example-pdf.pdf --only pdf.print.page-size

# Skip specific checks
gutterpress validate --input . --skip source.stylelint
```

> **Note:** Almost all validation runs in-process --- no tools to install. Only the PDF/X
> checks need `qpdf` and ink-coverage needs Ghostscript (`gs`); install those, or
> use the Docker image, only when producing PDF/X.
