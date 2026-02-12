# Validation Example

Demonstrates print-md's validation system with all four check categories configured.

## What's Included

| File | Purpose |
|------|---------|
| `manifest.yaml` | Full `validate` section with all options annotated |
| `.markdownlint.yaml` | Markdownlint config for source checks |
| `.htmlhintrc` | HTMLHint config for source checks |
| `chapter-01.md` | Clean markdown (should pass all checks) |
| `chapter-02.md` | Contains a `sidebar` callout not in `allowedCallouts` (demonstrates a flagged issue) |

## Running Validation

```bash
# Pre-build checks (source + asset)
print-md validate --input .

# Post-build checks (requires a built PDF)
print-md validate --pdf dist/book.pdf

# All checks together
print-md validate --input . --pdf dist/book.pdf

# Full pipeline (includes validation at both phases)
print-md run --input .

# JSON output for CI
print-md validate --input . --format json
```

## Filtering

```bash
# By category
print-md validate --input . --category source
print-md validate --pdf dist/book.pdf --category pdf,heuristic

# By check ID
print-md validate --input . --only source.callout-validation
print-md validate --pdf dist/book.pdf --skip pdf.structure.qpdf

# By phase
print-md validate --input . --phase pre-build
```

## What to Expect

Running source validation on this example will:

1. **Pass** markdownlint checks (both chapters follow the `.markdownlint.yaml` rules)
2. **Flag** `chapter-02.md` for using a `sidebar` callout that isn't in the `allowedCallouts` list
3. **Skip** `pdf.structure.qpdf` (disabled in manifest via `checks` override)
4. **Downgrade** text-density warnings to `info` severity (configured in manifest)

## System Dependencies

Source checks require these tools installed:

- `markdownlint-cli2` — `npm install -g markdownlint-cli2`
- `htmlhint` — `npm install -g htmlhint`

PDF checks require:

- `qpdf`, `pdfinfo`, `pdffonts`, `pdfimages`, `pdftotext` (poppler-utils)
- `gs` (Ghostscript)

Asset checks require:

- `identify` (ImageMagick)
