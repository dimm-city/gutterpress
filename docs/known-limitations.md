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

What makes these three dangerous is that every one of them fails **silently**
in Chromium. There is no error and the PDF looks valid. Gutterpress therefore
reports each of them itself — §1 and §2 from the CSS as you type it
(`printsafe/no-risky-print-effects`), §3 from the built document
(`engine.page-background.unreferenced`) — so "the CSS is correct but nothing
painted" reaches you as a warning rather than as a blank page in print. §3 is
also the one the build now works around on your behalf; see there.

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
| `rotate`, `scale`, `translate` (the individual properties) | `background: linear/radial-gradient` (6.15 / 6.21) |
| `opacity` | `writing-mode` (0.3648), `padding`, `border`, `font-size`, `color`, `letter-spacing`, `text-transform`, `visibility` |
| `outline`, and `outline-style`/`-width`/`-color`/`-offset` | |
| `filter`, `backdrop-filter`, `mix-blend-mode` | |
| `clip-path`, `perspective` | |

`text-shadow` beside `box-shadow` is the clearest pair: both are shadows, and
the one that paints outside the box is the one discarded.

A caution for anyone re-running this: a margin box is centred in its slot, so
**symmetric** `padding` moves nothing and measures `0.000` even though padding
is honoured. `padding-left: 60px` on the same box measures 0.2927. Vary the
axis you are testing, or the harness will report a false drop.

**Write instead:** keep margin-box decoration inside the box — borders,
border-radius, background gradients and `text-shadow` all work. A rotated or
drop-shadowed "sticker" in a margin box cannot be done; put it in the page
content flow instead.

**Removal trigger:** adding `box-shadow` or `transform` to a margin box
produces a non-zero diff against the same page without it.

---

## 3. An `@page` image is dropped unless referenced elsewhere

**Tracking:** [#152](https://github.com/dimm-city/gutterpress/issues/152) ·
found during the 0.10.0 migration · **re-diagnosed 2026-08-24**

A `url()` image referenced only from inside an `@page` rule is not painted.
The page shows the background *colour* alone (the colour paints at full
strength — 129.5258 with and without the dropped `url()`).

**Gutterpress handles this for you, and you do not write anything.** Every
image your project stylesheets reference is staged and declared with one
`<link rel="preload" as="image">` in the built `<head>`, which is the second
reference Chromium needs. You cannot add that `<link>` yourself — the `<head>`
is generated and the manifest has no key for injecting into it — which is
exactly why the build does it.

Three scope facts, all measured on Chrome 151.0.7922.75, all load-bearing for
what Gutterpress does about it:

- **A second reference must be an unconsumed preload — an `<img>` is not one.**
  A `<link rel="preload" as="image">` restores the background (89.3574) and an
  `html { background }` for the same URL does too (89.3574). An `<img src>`
  does **not**: through Gutterpress's print path it scores 0.0000, and a
  preload *plus* an `<img>` also scores 0.0000, because the `<img>` matched the
  preload and consumed it. This is why the build gives every CSS image a
  content-addressed URL — so nothing in your document can name it, and nothing
  can consume its preload.
- **A `data:` URI is immune** (89.3574 with no second reference at all), which
  is why the original diagnosis looked like it was about image size: the build
  used to inline images under 512 KB, so only bigger ones could reach the bug.
  There is no such threshold now; every CSS image is a file, and every one is
  preloaded.
- **It is the whole `@page` rule, not just the page box.** A margin box's own
  `background-image: url()` is dropped the same way when nothing else
  references it (0.0000 alone, 8.0345 with a `<link rel="preload">`; a
  gradient on the same box is the control at 16.8009). One preload covers a
  page box and every margin box that shares the URL.

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

**Write instead:** nothing, for the ordinary case. Reference the image from one
of your project stylesheets with a local `url()` and the build covers it. The
shapes it cannot cover, and which `engine.page-background.unreferenced` still
reports: a remote `url(https://…)` in `@page` (never staged, so never
preloaded) and an image that reaches the document from CSS your stylesheets do
not contain.

**Removal trigger:** Chromium paints a `@page { background: url() }` image
with no other reference to it. Test with the `@page` rule as the **only**
reference. This is executable and it runs in the suite —
`packages/cli/src/engine/compiler/page-background-chromium-bug.canary.test.ts`
asserts the bug is still present, and goes red the day it is fixed.

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
