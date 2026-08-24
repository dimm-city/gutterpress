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
verified on Chrome 151.0.7922.75, 2026-08-24

A gradient in `@page { background }` is discarded. A solid colour in the same
place paints the whole sheet. This covers `linear-gradient`, `radial-gradient`
and `repeating-linear-gradient` alike.

Differential rendering against a page with **no** `@page` background — a mean
absolute pixel difference of `0.000` means the declaration changed nothing:

| `@page { background: … }` | diff | Result |
|---|---|---|
| `#2d6cdf` (solid) | 152.866 | paints the full sheet |
| `linear-gradient(…)` | **0.000** | paints nothing |
| `radial-gradient(…)` | **0.000** | paints nothing |
| `repeating-linear-gradient(…)` | **0.000** | paints nothing |

Gradients are not broken in print generally — only as the `@page` box's own
background. The same gradient on `html` renders (82.880), and a gradient as a
**margin box** background renders (6.15).

**Write instead:** a solid colour on `@page`, or put the gradient on `html`
when it only needs to cover the content area rather than the sheet.

**Removal trigger:** a gradient in `@page { background }` produces a non-zero
diff against the same page with the declaration removed.

---

## 2. Margin boxes drop stacking-context and outside-the-box properties

**Tracking:** [#150](https://github.com/dimm-city/gutterpress/issues/150) ·
verified on Chrome 151.0.7922.75, 2026-08-24

A page margin box (`@top-center`, `@bottom-right`, …) silently discards every
property that would establish a stacking context or paint outside its border
box. Everything else on the same box is honoured — this is not "margin boxes
ignore styling".

| Dropped (diff `0.0000`) | Honoured |
|---|---|
| `box-shadow` | `text-shadow` (0.1164) |
| `transform` — `rotate`, `scale`, `translate` | `border-radius` (0.3152) |
| `opacity` | `background: linear/radial-gradient` (6.15 / 6.21) |
| `outline` | `writing-mode` (0.3648), `padding`, `border`, `font-size`, `color`, `letter-spacing`, `text-transform`, `visibility` |
| `filter`, `mix-blend-mode` | |

`text-shadow` beside `box-shadow` is the clearest pair: both are shadows, and
the one that paints outside the box is the one discarded.

**Write instead:** keep margin-box decoration inside the box — borders,
border-radius, background gradients and `text-shadow` all work. A rotated or
drop-shadowed "sticker" in a margin box cannot be done; put it in the page
content flow instead.

**Removal trigger:** adding `box-shadow` or `transform` to a margin box
produces a non-zero diff against the same page without it.

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
