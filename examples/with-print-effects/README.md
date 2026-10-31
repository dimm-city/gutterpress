# Print Effects Example

One transparency effect per page, built as PDF/X-1a with
`pdfx.transparency: preserve-text` to show that the text on those pages stays
live.

PDF/X-1a and X-3 are PDF 1.3, which has no transparency. A soft `rgba()` shadow,
an alpha-channel PNG, `opacity` or a blend mode makes Ghostscript flatten the
whole page into one bitmap, losing its fonts and searchable text (the default,
`pdfx.transparency: flatten-page`). With `preserve-text`, Gutterpress flattens
only the **artwork** of those pages to a 300 DPI image and draws the **text**
back on top as live text. Pages without transparency are not touched.

## What's Included

- `manifest.yaml` — the `dtrpg` preset, one stylesheet, `pdfx.transparency: preserve-text`
  and `checks: { asset.image.alpha-channel: off }` (the cutout PNG has an alpha channel)
- `effects.md` — five pages:
  1. a soft, blurred `rgba()` box-shadow card over a brick wall
  2. a `clip-path` polygon card whose shape-following shadow is a clipped
     `::before` layer with a translucent fill
  3. an alpha-channel cutout image pinned beside the text with `.gp-pin`
  4. a translucent `rgba()` panel behind text
  5. a control page with no transparency (left as ordinary vector)
- `styles/main.css` — standard CSS only
- `assets/wall.png` (opaque, tiled) and `assets/cutout.png` (RGBA, soft edge)

## Build

```bash
gutterpress build examples/with-print-effects --format pdfx
```

The build warns which pages it flattened (1 to 4 here). dtrpg pads the book to a
multiple of 4 pages with blank pages after the content.

## Verify

```bash
pdf=examples/with-print-effects/dist/print-effects-example/print-effects-example-pdfx.pdf
pdftotext -f 1 -l 5 "$pdf" -     # every content page has its words
pdffonts "$pdf"                  # all fonts embedded ("emb" = yes)
pdfimages -list "$pdf"           # one 300 DPI image on each of pages 1-4, none on 5
```

Text on pages 1 to 4 is selectable, and black text is on the black plate alone
(`pdfx.blackText: k-only`, the `dtrpg` default).

## Known limits

- On a flattened page the rules, backgrounds and shapes are part of the 300 DPI
  picture, not vectors.
- Text is always the top layer. If another element is painted over text, the
  text shows through it in the PDF/X file.
- A page whose text has its own transparency (a translucent glyph colour,
  `opacity` or a blend mode on a text block) is not split: it falls back to
  Ghostscript's whole-page flattening and loses its live text. None of the
  pages here do that.
- Keep CSS `filter` off text-bearing elements: Chromium rasterizes those into
  the PDF itself.
- `repeating-linear-gradient()` and `conic-gradient()` are a separate
  Ghostscript gap and are avoided here.
