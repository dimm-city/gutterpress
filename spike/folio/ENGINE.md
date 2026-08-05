# What Chromium actually does with CSS Paged Media

Every row here was **measured**, not read from a spec or a compatibility table,
and each names the spike that re-measures it on every run. If you are building
anything on Chromium's print path, this is the ground truth to build against —
and the parts that changed between Chrome 141 and 151 are the reason it is
re-measured rather than remembered.

Measured on Chromium **141.0.7390.37** and Chrome **151.0.7922.75**.
Re-run everything with `bun run spikes` (15 spikes, 211 checks, ~18 s).

---

## 1. What works natively — the whole premise

These need no shim. A document using only these compiles in one print pass
(`s0`, 29 checks).

| Feature | Measured |
| --- | --- |
| `@page { size }` via `preferCSSPageSize` | 6×9in → MediaBox exactly 432×648pt |
| `@page { margin }` | changes fragmentation (0.5in → 4pp, 2in → 15pp on the same content); ink starts inside the declared box |
| Named pages (`page: name`) | carry their own geometry and force a break between names (8in cover → 6in body in one document) |
| All 16 margin boxes | every one renders; ink sits in the margin band (y=29pt inside a 72pt margin) |
| `counter(page)` / `counter(pages)` | correct on every page |
| `:first` / `:left` / `:right` | all match, and combine with names (`@page chapter:left`) |
| `break-before/after: page`, `break-inside: avoid` | honored (0/25 marked blocks split) |
| `widows` / `orphans` | honored, and identically in multicol |
| Tagged PDF, document outline, embedded font subsets | all emitted by `Page.printToPDF` |
| `@counter-style { system: fixed; symbols: … }` in a margin box | works, including `&`, em-dashes and non-ASCII (`s3`) |

**Multicol and print share the same LayoutNG fragmentation engine.** This is the
load-bearing fact behind on-screen pagination: fragmenting content into columns
of the page's content-box size puts the same content on the same pages as
printing does — 331/331 blocks across five documents (`s1`).

---

## 2. What is missing, and what it costs

| Feature | Status | Consequence |
| --- | --- | --- |
| `string-set` / `string()` | not implemented | running heads need synthesis |
| `leader()` | not implemented | dot leaders need a measured fill |
| `bleed` / `marks` descriptors | dropped by the parser | page geometry must be transformed |
| `break-before: right\|left\|recto\|verso` | **treated as a plain page break** | chapters do not start on a recto; no blank page is inserted (`s10`) |
| `@page :blank` | **never matches** | synthesized blanks need a generated page name to be styled |
| `@page :nth(n)` | not parsed | — |
| `float: footnote` | not implemented | footnotes are a v1 non-goal |
| `position: running()` / `content: element()` | not implemented | `string-set` covers the common cases |

### `target-counter()` / `target-text()` — and why `CSS.supports` cannot be trusted

This one changed under us, and the way it changed is the important part.

| | Chrome 141 | Chrome 151 |
| --- | --- | --- |
| `CSS.supports('content','target-counter(…)')` | `false` | **`true`** |
| Declaration retained in CSSOM | no — dropped | **yes** |
| Actually renders | no | **no** — computes to `none` |

So on 151 the browser *claims* support, *keeps* the declaration, and *renders
nothing*. Two consequences, both of which bit us:

1. **`CSS.supports` is not a usable feature detector for these.** A shim gated on
   it would have switched itself off on 151 and silently dropped every
   cross-reference. The only honest detector is a render probe: set the property
   on a probe element and read back `getComputedStyle(el, '::after').content`.
   `s0` does exactly this.
2. **A surviving declaration wins the cascade.** The author's
   `a.xref::after` (specificity 0,1,1) outranks a generated
   `[data-folio-after]::after` (0,1,0), so the author's *empty* value won and
   the shim's text never appeared. A generated override must out-specify the
   author's own rule — see [`ARCHITECTURE.md`](./ARCHITECTURE.md) §4.

The general lesson: **a browser upgrade can silently disable a shim without any
error, in either direction** — by implementing a feature, or by half-implementing
it. Pin the version, and keep a parity harness in CI that renders rather than
introspects.

---

## 3. The cascade rules that are not what you expect

### `@page` selector specificity is not applied across stylesheets

Within one stylesheet Chromium ranks page selectors correctly: `@page :left`
beats `@page`, a named page beats both, regardless of source order (measured
four ways). Split the same rules into **two `<style>` elements** and that stops
being true — a plain `@page { @top-center { … } }` in the later sheet overrides
`@page :left { @top-center { content: none } }` in the earlier one.

This matters for any tool that injects generated `@page` CSS, which is exactly
what a shim does. It caused two separate production-shaped bugs here: duplicated
running heads, and mirrored gutters collapsing to a single margin on every page.
The fix is to never depend on the cross-sheet cascade — resolve every page
context and emit it flat (`ARCHITECTURE.md` §3).

### Shorthand and longhand must be resolved in cascade order

`@page cover { margin: 0 }` must beat `@page :right { margin-left: .75in }`
because a named page outranks a pseudo-page. Merging all declarations and *then*
applying `margin` followed by `margin-*` inverts that — the weaker rule's
longhand wins, and a full-bleed cover gets inset by three-quarters of an inch.
Accumulate margins rule by rule, in cascade order, shorthand and longhands
interleaved exactly as written.

---

## 4. Fragmentation details that differ between print and multicol

These are the places where "same engine" stops being enough, and a screen
preview has to compensate.

| Behaviour | Print | Multicol | Compensation |
| --- | --- | --- | --- |
| `<thead>` | repeated on every page the table spans | rendered once | clone the header into each continuation fragment (`s5`) |
| `<tfoot>` | repeated at the bottom of every fragment | rendered once, at the end | reserve the space with a bottom-filling foot clone per column (`s5`) |
| Header with no rows after it | never stranded — the whole table moves on | happily parks a lone header at a column bottom | push the table |
| Overheight images | **split across pages** | fragment across columns (verified equivalent) | none needed; the compiler warns |
| Knife-edge boundaries | — | — | **not compensable**, see below |

### Knife-edge boundaries are inherent

At boundaries decided by a fraction of a pixel, page fragmentation and multicol
can round differently. Measured at the diverging boundary: print keeps a line
with **1.17 pt (1.56 px)** of slack. It is not a container-geometry bug — the
strip height is exactly the print content height, and snapping to the 1/64 px
LayoutUnit grid changes nothing. It is not fixable by an epsilon: `+0.5 px`
removed 77 % of drift events on a 6×9in book and exactly matched its page count,
but did nothing for an A4/mm book (78 → 73 events). The bias is not constant.

Two practical consequences:

- **Fractional page metrics make it worse** — the same content produced 35 drift
  events at 6×9in and 78 at 210×297mm. Presets should prefer pt/px-clean sizes.
- **The browser version changes which boundaries flip.** A corpus that was
  331/331 on Chrome 141 is 330/331 on 151 — one block moves to the *adjacent*
  page. Assert the property that is actually true (page counts exact,
  disagreement only ever adjacent, ≤1 %), not an exact match that will rot.

The posture that follows: **the PDF is ground truth.** Printed page numbers must
come from compiler measurement, never from the screen preview's page map.

---

## 5. Painting: content is clipped to the content box

**Nothing paints outside the page's content box.** Measured with a 6×9in page
and 1in margins — the content box is 72…360pt:

| Technique | Red ink reached |
| --- | --- |
| `position: fixed; inset: 0` | x ∈ [72, 359] |
| `position: absolute` with negative inset | x ∈ [72, 359] |
| element with negative margins | x ∈ [72, 359] |
| `body { background }` | x ∈ [72, 359] |
| `html { background }` | x ∈ [72, 359] |
| `@page { @top-center { background } }` | y ∈ [0, 71] — margin boxes *can* paint in their own band |

`html { background }` clipping is a **spec deviation**: per CSS Paged Media the
root element's background propagates to the canvas and should cover the whole
page box, margins included.

### Therefore: bleed art only works on zero-margin pages

With `@page { margin: 0 }` the content box *is* the page, and art reaches every
edge — measured `0,0 → 449,665` on a 450×666pt media box.

This dictates how a bleed transform must work. Inflating margins by
`bleed + slug` keeps text correctly positioned relative to trim, but it also
guarantees the content box never reaches the bleed area. Inflating an **authored
zero** is actively wrong: it puts a white border exactly where the author asked
for full-bleed art. The rule that falls out:

```
emitted_margin = authored === 0 ? slug : authored + bleed + slug
```

A zero-margin page then has a content box exactly equal to the bleed box: art
fills it, crop marks stay clear. Everything else keeps trim-relative positioning.
Covers and full-page plates belong on their own `@page name { margin: 0 }`, with
live matter inset by padding.

This is also the one place the Paged.js approach is structurally more capable:
it builds `.page` divs in the DOM, so "bleed" is just an element inside a div and
no page box is involved.

---

## 6. The measurement channel

How to learn which page an element landed on, without a layout engine of your
own (`s4`, `s7`):

- Chromium emits a **`/Dests` name tree keyed by the element's `id`** — 14/14
  ids resolved to the page the target actually printed on.
- Only ids that something **links to** appear. Measurement must therefore
  instrument what it measures.
- Instrumentation is free: links inside a `display: none` container still
  produce the destinations, and the page count is unchanged (four forms tested,
  all layout-neutral).
- Those hidden links produce **no `/Link` annotations at all** — verified
  `/Annots` count of zero. This matters because Ghostscript rejects `/Link`
  annotations under `-dPDFX`.
- An `id` is **not inert**, though: `h1[id] { counter-increment: chapter }` is
  real theme CSS, and assigning ids renumbered every chapter. Measure through
  ids the author already wrote, or inject a zero-size custom element to carry
  the id (`ARCHITECTURE.md` §2).

The document outline is a second channel (heading → page, 14/14 correct), but
`/Dests` is keyed and needs no title matching.

---

## 7. Other page-level semantics worth knowing

- **`:first` means the first page of the DOCUMENT**, not the first page of a
  named-page run. With a cover ahead of it, `@page chapter:first` never matches.
  A per-chapter opener template is therefore not expressible in standard Paged
  Media at all — this is an engine/spec limit, not a preview limitation. Use the
  content-padding pattern instead (`s6`).
- **`page:` on a descendant is a chapter-*opener* idiom, not a chapter
  template.** `h1 { page: chapter }` gives the heading's own page that template
  and breaks straight back to the default page. Both Chromium and Paged.js agree
  on this. If the whole chapter should carry the template, put `page:` on the
  container.
- **`@media print` rules do not apply on screen** — `break-before` computes to
  `auto` until print emulation is on, which a plain document cannot switch on. A
  preview that must render the print stylesheet has to re-inject those bodies as
  screen rules.
- **Nested multicol is fine.** An author's `columns: 2` block inside a
  screen-preview multicol strip fragments identically to print (30/30 tokens).

---

## 8. PDF/X hand-off

Ghostscript 10.06 converting a Chromium-printed PDF to PDF/X-1a with a real
FOGRA39L profile (`s12`, 25 checks):

- Page geometry survives the round-trip **exactly** — MediaBox/TrimBox/BleedBox
  ±0 pt on every page — and `pdftotext` output is byte-identical.
- 47 RGB fill operators → 0 `/DeviceRGB`, 34 CMYK operators. Fonts stay
  embedded; no transparency.
- Failure modes are loud: a missing or malformed ICC makes gs throw, and no
  output file is written. There is no silent non-conformant PDF.
- **`/Link` annotations are rejected under `-dPDFX`**, so `qpdf`'s
  annotation-stripping stage is a hard requirement for any document with
  cross-references.

Raster fidelity through a pdf-lib re-save (`s14`): images embed at their exact
source resolution (300→300, 600→600, 72→72 DPI, ±2), every image row is
byte-identical before and after, PNG alpha survives as a soft mask, and JPEG
stays JPEG rather than being re-decoded. Saving **with** object streams is 41 %
smaller and 2.5× faster than without, and reads identically in pdf-lib and
poppler.
