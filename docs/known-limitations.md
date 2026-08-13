# Known limitations

Things Gutterpress cannot do because the **browser** cannot do them.

Gutterpress prints through Chromium. Where Chromium's implementation of CSS
Paged Media has a gap, that gap is ours too — and per this project's
constitution we do **not** paper over it with a corrective shim:

> **Chrome wins once it ships.** When Chrome implements a Paged Media feature,
> we drop our shim and match Chrome's behavior even where it is imperfect —
> print output IS Chrome's output, and preview↔PDF divergence is the worst
> failure this project can produce. File upstream Chromium bugs; do not
> maintain corrective shims.

Each entry below therefore records the same four things: what breaks, **how it
fails**, what to write instead, and the **removal trigger** — the condition
under which the workaround should be deleted.

What makes these three dangerous is that every one of them fails **silently**.
There is no error, no warning, and a valid-looking PDF. Treat "the CSS is
correct but nothing painted" as a signal to check this page.

---

## 1. A gradient in `@page { background }` paints nothing

**Tracking:** [#149](https://github.com/dimm-city/gutterpress/issues/149) ·
Chromium 148 and 151

A `@page` background paints the full sheet when its value is a solid colour or
a `url()` image, but a **gradient-only** value paints nothing at all. This is an
inconsistency inside Chromium's own paged-background painting, not something
author CSS can correct.

```css
/* ✗ paints NOTHING — no error, sheet stays white */
@page { background: linear-gradient(180deg, #2d6cdf, #1e8a4c); }

/* ✓ paints the full sheet, margins included */
@page { background: #2d6cdf; }
@page { background: url("tile.png") repeat; background-size: 8px 8px; }
```

**Write instead:** a solid colour, or a `url()` image of the gradient. If the
gradient must stay live CSS, put it on `html`/`body` rather than `@page` —
gradients paint normally there.

**Also note:** a *relative* `url()` in `@page { background }` does not load when
the document is opened over `file://`. That is a separate, unrelated failure
with an identical white-page symptom. Use a `data:` URI or serve over HTTP when
testing, or you will misdiagnose a working background as this bug.

**Removal trigger:** Chromium paints gradient `@page` backgrounds. Re-test with
the runnable repro in #149.

---

## 2. `box-shadow` and `transform` are dropped in `@page` margin boxes

**Tracking:** [#150](https://github.com/dimm-city/gutterpress/issues/150) ·
Chromium 148

Inside a margin box (`@top-center`, `@bottom-right`, …) Chromium silently drops
`box-shadow` and `transform`. This is **not** "margin boxes ignore styling" —
`border`, `background`, `padding`, and even gradient backgrounds all paint
correctly on the same element. Only those two properties vanish.

```css
@page {
  @bottom-right {
    content: "STICKER";
    background: #ffd700;
    border: 3px solid #c00;      /* ✓ paints */
    box-shadow: 6px 6px 0 #c00;  /* ✗ dropped, silently */
    transform: rotate(-8deg);    /* ✗ dropped, silently */
  }
}
```

The box renders flat and axis-aligned, exactly as if both declarations were
absent.

**Write instead:** fake the offset shadow with a second `border` or an inset
`background` layer, and bake any rotation into an image. If the decoration is
genuinely important, place it in the document flow — an absolutely-positioned
element inside a `.page` — where both properties work normally.

**Removal trigger:** Chromium honours `box-shadow`/`transform` in margin boxes.

---

## 3. Large raster images in `@page { background }` are dropped

**Tracking:** [#152](https://github.com/dimm-city/gutterpress/issues/152) ·
found during the 0.10.0 migration

A `url()` image in `@page { background }` is dropped once the **source image's
pixel dimensions** get large enough. The page then shows only the background
*colour*. The same image paints fine from `html { background }`.

Measured bounds: **450×582 paints; 638×825 and up are dropped.** A 2550×3300
tile produced a flat, textureless wall on all 292 pages of a real book.

The trigger is source pixel dimensions — not `var()` resolution, not URL
rewriting, not `background-size`, not `background-blend-mode`, and not
shorthand-vs-longhand spelling. Ruling those out matters, because each looks
like a plausible cause and none of them is.

**Write instead:** resample the tile to its display resolution. At a 1.5in tile
width, 450px is exactly 300dpi — so this costs no print quality. Ship the
downscaled asset and comment the source with the issue number so the swap is
reversible.

**Removal trigger:** Chromium paints full-resolution rasters in `@page`
backgrounds. Re-test at production size, never with a small test tile.

> **Testing note that cost us a full book build:** preflight verification with a
> 16×16 test tile *passed*. Any fixture that claims to verify
> `@page { background }` support must use a **production-sized** asset, or it
> verifies nothing.

---

## Reporting a new one

If you find print output that contradicts the CSS Paged Media spec:

1. Reduce it to a minimal `@page` fixture and confirm it against a
   known-good control (the working variant of the same property).
2. Open an issue here with the fixture, the Chromium version, and the measured
   pixel evidence — label it `upstream`.
3. A maintainer with a crbug.com account files it against Chromium. The issue
   here stays open as the citable reference and the removal trigger.

Do not fix it in a shim. See
[`CLAUDE.md`](../CLAUDE.md) — "What Gutterpress is — and what the engine is not".
