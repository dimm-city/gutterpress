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

## 3. A `@page { background }` image is dropped unless referenced elsewhere

**Tracking:** [#152](https://github.com/dimm-city/gutterpress/issues/152) ·
found during the 0.10.0 migration · **re-diagnosed 2026-08-24**

A `url()` image in `@page { background }` is not painted when the `@page` rule
is the document's **only** reference to it. The page shows the background
*colour* alone. Add any second reference — a `<link rel="preload" as="image">`,
an `html { background }`, or even a 1×1 invisible `<img>` — and it paints.

The image **is** fetched either way (confirmed in an HTTP access log on the
failing run), so this is a paint/invalidation problem, not a loading one, and
no amount of waiting fixes it: `--virtual-time-budget` at 30s and 60s both
still produce a flat page.

Measured on Chrome 151.0.7922.75, left-margin strip std-dev, same artwork at
three sizes:

| tile source size | second reference present | `@page` alone |
|---|---|---|
| 450 × 582 | paints (18.63) | dropped (0.00) |
| 638 × 825 | paints (18.63) | dropped (0.00) |
| 2550 × 3300 | paints (18.50) | dropped (0.00) |

**Write instead:** reference the image a second time. One
`<link rel="preload" as="image" href="…">` in `<head>` is enough, and it is
cheaper than shipping a downscaled duplicate of the asset.

**Removal trigger:** Chromium paints a `@page { background: url() }` image
with no other reference to it. Test with the `@page` rule as the **only**
reference.

> **Testing note that cost us a full book build, and then a wrong diagnosis:**
> this entry previously said the trigger was the image's pixel dimensions
> (450×582 paints, 638×825 and up dropped) and told you to re-test "at
> production size, never with a small test tile." Both halves were wrong — the
> big tile paints and the small one does not, given the same number of
> references. Every fixture that "verified" `@page { background }` happened to
> reference the image elsewhere on the page, so all of them passed regardless
> of the bug. A fixture is only testing this if the `@page` rule is the sole
> reference.

---

## Reporting a new one

If you find print output that contradicts the CSS Paged Media spec:

1. Reduce it to a minimal `@page` fixture and confirm it against a
   known-good control (the working variant of the same property).
2. Open an issue here with the fixture, the Chromium version, and the measured
   pixel evidence — label it `upstream`.
3. A maintainer with a Google account files it against Chromium — steps in
   [`filing-upstream-chromium-bugs.md`](./filing-upstream-chromium-bugs.md).
   The issue here stays open as the citable reference and the removal trigger.

Do not fix it in a shim. See
[`CLAUDE.md`](../CLAUDE.md) — "What Gutterpress is — and what the engine is not".
