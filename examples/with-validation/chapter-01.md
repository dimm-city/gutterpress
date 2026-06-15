# Introduction

Welcome to the validation example. This project demonstrates how print-md checks your work for print-readiness.

## Getting Started

Print-md validation runs automatically during the build pipeline, or you can invoke it directly:

```bash
# Validate source files (pre-build)
print-md validate --input .

# Validate a built PDF (post-build)
print-md validate --pdf dist/book.pdf

# Full validated PDF/X pipeline (validates at both phases)
print-md build . --format pdfx
```

## How Validation Works

The validation system checks four categories:

1. **Source checks** run markdownlint, htmlhint, and callout validation against your markdown and generated HTML.
2. **Asset checks** verify image sizes, DPI, color spaces, and font references before the build.
3. **PDF checks** inspect the generated PDF for structural integrity, page dimensions, color compliance, and font embedding.
4. **Heuristic checks** flag potential quality issues like sparse pages or excessive decoration.

> [!note]
> Callouts like this one must appear in the `allowedCallouts` list in your manifest. This project allows `sidebar`, `note`, `warning`, and `tip`.

## Configuration

All validation settings live in the `validate` section of `manifest.yaml`. You can:

- Disable individual checks by ID
- Override severity levels (error, warning, info)
- Point to external linter configs (markdownlint, htmlhint)
- Set thresholds for image size, DPI, text density, and more

> [!tip]
> Run `print-md validate --format json` to get machine-readable output for CI pipelines.

## Filtering Checks

Target specific categories or individual checks:

```bash
# Only PDF checks
print-md validate --pdf dist/book.pdf --category pdf

# Only a single check
print-md validate --pdf dist/book.pdf --only pdf.print.page-size

# Skip specific checks
print-md validate --input . --skip source.stylelint
```

> [!note]
> Almost all validation runs in-process — no tools to install. Only the PDF/X
> checks need `qpdf` and ink-coverage needs Ghostscript (`gs`); install those, or
> use the Docker image, only when producing PDF/X.
