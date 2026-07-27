# Validation Example

Demonstrates print-md's validation system with all four check categories configured.

## What's Included

| File | Purpose |
|------|---------|
| `manifest.yaml` | Full `validate` section with all options annotated |
| `.markdownlint.yaml` | Markdownlint config for source checks |
| `.htmlhintrc` | HTMLHint config for source checks |
| `chapter-01.md` | Clean markdown (should pass all checks) |
| `chapter-02.md` | Print production checks reference (page size, color, fonts, ink coverage) |

## Running Validation

```bash
# Pre-build checks (source + asset)
print-md validate --input .

# Post-build checks (requires a built PDF)
print-md validate --pdf dist/validation-example/validation-example-pdf.pdf

# All checks together
print-md validate --input . --pdf dist/validation-example/validation-example-pdf.pdf

# Full validated PDF/X pipeline (includes validation at both phases)
print-md build . --format pdfx

# JSON output for CI
print-md validate --input . --format json
```

## Filtering

```bash
# By category
print-md validate --input . --category source
print-md validate --pdf dist/validation-example/validation-example-pdf.pdf --category pdf,heuristic

# By check ID
print-md validate --input . --only source.markdownlint
print-md validate --pdf dist/validation-example/validation-example-pdf.pdf --skip pdf.structure.qpdf

# By phase
print-md validate --input . --phase pre-build
```

## What to Expect

Running source validation on this example will:

1. **Pass** markdownlint checks (both chapters follow the `.markdownlint.yaml` rules)
2. **Skip** `pdf.structure.qpdf` (disabled in manifest via `checks` override)
3. **Downgrade** text-density warnings to `info` severity (configured in manifest)

## Automatic Tool Detection

Almost every check runs in-process and needs no system tool. Only the PDF/X
checks (need `qpdf`) and ink-coverage (needs `gs`) probe for a tool, and warn if
it's missing:

```
warn  Tool "gs" not found — skipping: pdf.print.ink-coverage
warn  Tool "qpdf" not found — skipping: pdf.print.pdfx-markers, pdf.print.pdfx-metadata
```

Checks that don't need the missing tool still run normally.

**Suppressed warnings:** Because this example disables `pdf.structure.qpdf` in
the manifest, you won't see a warning about that check. (Note `pdf.structure.qpdf`
no longer uses qpdf — it's an in-process parse check now.)

## System Dependencies

Source linting, page/font/image validation, and color/alpha checks are **all
built in** — no tools to install. The only optional system tools are for the
**PDF/X (CMYK) pre-print pipeline**:

- `gs` (Ghostscript) — CMYK conversion + ink-coverage — `apt install ghostscript` or `brew install ghostscript`
- `qpdf` — PDF/X annotation stripping + OutputIntent validation — `apt install qpdf` or `brew install qpdf`

Or skip installing anything and run the full PDF/X pipeline via the
[Docker image](../../docs/docker.md). Rendering any PDF also needs a
Chromium-based browser (see [System Setup](../print-md-user-guide/08-system-setup.md)).
