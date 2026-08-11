# Tools

Standalone utilities for print production tasks that fall outside the `gutterpress` CLI. These are transformation, authoring, and debugging helpers — not validation checks (those live in `src/checks/`).

## validate-images.py

Deep per-pixel TAC (Total Area Coverage) analysis for source images. Converts each image to CMYK via an ICC profile using LittleCMS, then computes max TAC, p99 TAC, and percentage of pixels over a threshold. Outputs CSV and JSON reports.

**When to use:** You need a detailed ink-coverage audit with exact ICC profile conversion — more granular than the `asset.image.tac-raster` check which uses Ghostscript.

**Requires:** Python 3, Pillow, numpy

```bash
pip install pillow numpy
python3 tools/validate-images.py ./images --icc profiles/CGATS21_CRPC1.icc
python3 tools/validate-images.py ./images --icc profiles/CGATS21_CRPC1.icc --threshold 300 --method exact
```

## convert-to-cmyk.sh

Batch-converts images from RGB to CMYK using ImageMagick with optional ICC profile support. Supports recursive directory scanning, format conversion, dry-run mode, and skip-if-up-to-date.

**When to use:** Your source images are RGB and your print vendor requires CMYK. Run this before building to convert your asset images.

**Requires:** ImageMagick (`convert` or `magick`)

```bash
./tools/convert-to-cmyk.sh ./images
./tools/convert-to-cmyk.sh ./images ./output -p /path/to/profile.icc -q 90
./tools/convert-to-cmyk.sh ./images -r -f tif --verbose
./tools/convert-to-cmyk.sh ./images --dry-run
```

## alpha-to-polygon.py

Converts a PNG image's alpha channel into a CSS `polygon()` string for `shape-outside`. Uses row-scan silhouette extraction and Ramer-Douglas-Peucker simplification to produce a compact polygon.

**When to use:** You want a hand-tuned or simplified wrap polygon instead of the image's raw alpha silhouette. NOTE: the historical reason for this tool — "`shape-outside: url(...)` causes Chromium/Paged.js to rasterize entire pages" — was a Paged.js-era failure and does NOT reproduce on the native engine (measured 2026-08-11, Chromium 141: a shaped page prints as a ~13 KB vector PDF with fully extractable text; `paged-css-image-shape.test.ts` guards this). For the common case, authors should just use the core `.gp-shape` class; reach for a polygon only when the alpha silhouette itself is unsatisfying (noisy alpha, deliberate looser wrap).

**Requires:** Python 3, Pillow, numpy

```bash
pip install pillow numpy
python3 tools/alpha-to-polygon.py image.png
python3 tools/alpha-to-polygon.py image.png --points 32 --margin 2 --format css-property
python3 tools/alpha-to-polygon.py image.png --format json
```

## set-boxes.py

Sets TrimBox, BleedBox, and MediaBox on every page of a PDF. Chromium doesn't reliably produce these boxes, but some print vendors (e.g. DTRPG) may require them.

**When to use:** Your vendor requires TrimBox/BleedBox metadata and the `pdf.print.bleed` validation check is reporting missing boxes. Run this after `gutterpress build`.

**Requires:** Python 3, pikepdf

```bash
pip install pikepdf
python3 tools/set-boxes.py --in dist/book.pdf --out dist/book-boxed.pdf --bleed 0.125
```

## debug-manifest.ts

Dumps the raw manifest and fully resolved config for a project directory. Useful for diagnosing config resolution issues (preset defaults, merge order, missing fields).

**When to use:** Your build is picking up unexpected config values and you want to see exactly what `resolveConfig()` produces.

```bash
bun tools/debug-manifest.ts .
bun tools/debug-manifest.ts ./my-book
bun tools/debug-manifest.ts ./my-book/manifest.yaml
```
