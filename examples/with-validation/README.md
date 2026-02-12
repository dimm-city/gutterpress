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

## Automatic Tool Detection

Before running checks, print-md probes for required external tools. If any are
missing you'll see warnings like:

```
warn  Tool "qpdf" not found — skipping: pdf.print.ink-coverage, pdf.nav.bookmarks, ...
warn  Tool "identify" not found — skipping: asset.image.resolution, asset.image.color-space, asset.image.alpha-channel
```

Checks that don't need the missing tool still run normally.

**Suppressed warnings:** Because this example disables `pdf.structure.qpdf` in
the manifest, you will **not** see a warning about `qpdf` for that check — even
if `qpdf` isn't installed. Warnings only appear for checks that would have run
but can't.

## System Dependencies

You don't need every tool installed to use validation — missing tools are
detected automatically and their checks are skipped with a clear warning. Install
the ones you need:

**Source checks:**

- `markdownlint-cli2` — `npm install -g markdownlint-cli2`
- `htmlhint` — `npm install -g htmlhint`
- `stylelint` — `npm install -g stylelint`

**PDF checks:**

- `qpdf` — `apt install qpdf` or `brew install qpdf`
- `pdfinfo`, `pdffonts`, `pdfimages`, `pdftotext` — `apt install poppler-utils` or `brew install poppler`
- `gs` (Ghostscript) — `apt install ghostscript` or `brew install ghostscript`

**Asset checks:**

- `identify` (ImageMagick) — `apt install imagemagick` or `brew install imagemagick`
- `gs` (Ghostscript) — shared with PDF checks above
