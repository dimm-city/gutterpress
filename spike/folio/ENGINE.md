# What Chromium actually does with CSS Paged Media

Every row here was **measured**, not read from a spec or a compatibility table,
and each names the spike that re-measures it on every run. If you are building
anything on Chromium's print path, this is the ground truth to build against.

**Folio is pinned to Chrome 151** (`REQUIRED_MILESTONE` in
`src/shared/cdp.ts`; launching an older engine throws). Everything below is a
property of *that engine*, not of "Chromium" in general — §2 is a worked example
of a milestone bump silently disabling a shim with no error anywhere, which is
why the version is pinned and why these facts are re-measured rather than
remembered.

Measured on Chrome **151.0.7922.75**. Re-run with `bun run spikes`
(15 spikes, 212 checks, ~19 s).

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

On the pinned engine, all three of these are true at once:

| | Chrome 151 |
| --- | --- |
| `CSS.supports('content','target-counter(…)')` | **`true`** |
| Declaration retained in CSSOM | **yes** |
| Actually renders | **no** — computes to `none` |

The browser *claims* support, *keeps* the declaration, and *renders nothing*.
Two consequences, both load-bearing:

1. **`CSS.supports` is not a usable feature detector for these.** A shim gated on
   it would switch itself off and silently drop every cross-reference. The only
   honest detector is a render probe: set the property on a probe element and
   read back `getComputedStyle(el, '::after').content`. `s0` does exactly this,
   and asserts both halves — that it does not render, *and* that it falsely
   claims support.
2. **A surviving declaration wins the cascade.** The author's
   `a.xref::after` (specificity 0,1,1) outranks a generated
   `[data-folio-after]::after` (0,1,0), so the author's *empty* value wins and
   the shim's text never appears. A generated override must out-specify the
   author's own rule — see [`ARCHITECTURE.md`](./ARCHITECTURE.md) §4.

**Why the engine is pinned.** Chrome 141 did *not* parse `target-counter()`; it
dropped the declaration, so any override of Folio's won by default. The 151
change flipped that with no error, no console warning, and no failing feature
check — output silently went from `"See target (p. 2)"` to `"See target"`. That
is the whole argument for `REQUIRED_MILESTONE`: an engine upgrade can disable a
shim in either direction, by implementing a feature *or* by half-implementing
it, and a shim cannot defend itself by asking whether the feature exists. Treat
a milestone bump as a code change: raise the pin deliberately, re-run the
spikes, and read every changed measurement as a finding.

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

**Not the same bug as the shipped Paged.js pipeline's gutter defect.** The
current `packages/cli` pipeline shows the identical *symptom* (mirrored gutters
collapsing to one margin) for a completely different, Paged.js-native reason:
its `@page` declaration walker takes a longhand `margin-*` value's first AST
node without checking its type, so a `var(--custom-prop, fallback)` value (a
`Function` node, no `.value`) is silently dropped rather than resolved or
fallback-substituted — the page falls through to the *unmirrored* base `@page`
margin instead. Root-caused with fixtures and vendored-source line references
in [`MIGRATION.md`](./MIGRATION.md)'s Step 1 section. Do not conflate the two:
Folio's is a cross-stylesheet cascade-order bug (fixed by flat resolution,
above); Paged.js's is a parser gap on `var()` inside `@page` (inherent to the
polyfill, not fixed — see that section for why).

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
- **Which boundaries flip is a property of the engine version** — a second
  reason the version is pinned. The generated corpus sits at 330/331 blocks on
  151, the one divergence being an adjacent-page move. Assert the property that
  is actually true (page counts exact, disagreement only ever adjacent, ≤1 %),
  not an exact match that will rot on the next bump.

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

### But a full-bleed page IS achievable with margins — paint the margin boxes

The clipping rule above says content cannot reach the page edge. It does **not**
say the *page* cannot be covered, because margin boxes paint in their own bands
and there are sixteen of them. Painting all 16 plus the content area covers the
whole page, and the margin boxes remain available for running heads at the same
time. Measured on a 6×9in page with 0.5in margins: ink box `0,0 → 215,323` on a
216×324 raster — **edge to edge** — while `@top-center` still carried a correct
per-page string (`CH-ONE`/`CH-TWO`/`CH-THREE` via a counter-style map).

A **tiled texture** stays continuous across the seventeen painting areas if each
box's `background-position` is offset by its own page coordinates
(`background-position: -Xpt -Ypt`). Verified with a 16px checker at 72dpi: no
visible discontinuity at any box boundary. Those offsets are pure page geometry,
so a compiler can emit them — this is the same class of synthesis Tier 2 already
does for bleed.

This matters because it removes what looked like a hard either/or: a design
wanting a full-bleed page background *and* CSS running heads on every page can
have both. What you cannot do is get there with `@page { margin: 0 }`, because
that deletes the margin boxes the heads live in — and a positioned element is no
substitute: fixed-position elements DO repeat on every page, but `counter(page)`
resolves to `0` outside a margin box, so they cannot know which page they are on.

### Bleed art in the CONTENT flow still only works on zero-margin pages

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

Paged.js reaches this more easily — it builds `.page` divs, so "bleed" is just an
element in a div and no page box is involved. But per the section above, the
margin-box route gets a real page box to full coverage too, so this is a
difference in how much the compiler must synthesize, not in what is achievable.

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

## 8. Margin boxes can carry real component styling

Beyond text, a margin box renders: `background` (color and image, with
`background-blend-mode`), solid **and** dashed `border`, `width: fit-content`,
font/letter-spacing/text-transform, and `counter(page)` — probed together as a
styled "chip" in `@bottom-left`/`@bottom-right`. This is enough to reproduce a
poster-style folio chip without any DOM element.

**Measured NOT supported in margin boxes:** `transform: rotate()` and
`box-shadow`. Probed with deliberately unmissable values (`rotate(-12deg)`,
`box-shadow: 6px 6px 0 #c00`): the chip renders axis-aligned with no shadow.
A design that relies on rotated or shadowed margin-box furniture cannot get it
from a margin box — it needs an in-flow element, which then cannot know its
page number (§9).

### Page-counter restart does NOT work from the content flow

`counter-reset: page 1` on a normal element does **not** restart `counter(page)`
in native print — measured: the element sits on page 3 and the margin box still
reads `3`, not `1`. Front-matter → body folio renumbering (roman then arabic
from 1) is therefore **not** expressible in the author's content, and a
compiler must synthesize it. Folio's counter-style map does exactly this: the
symbol list is per-page and arbitrary, so `i, ii, iii, 1, 2, 3…` is just a
different symbol list. Paged.js gets it "for free" only because its page
counter lives in the DOM.

**Built** (`src/shared/synthesis.ts`'s `pageCounterValues`, MIGRATION.md gap
#1). `gcpm-extract.ts` records every `counter-reset: page N` declaration
(`GcpmModel.counterResets`); the compiler measures which page each one's
element lands on (`agent.ts`'s `counterResetSites`, same `/Dests` measurement
channel as every other Tier 3 site) and `pageCounterValues` replays the
restart as a plain per-page number list — analytic, one pass, the same trick
`planRectoBlanks` uses for blanks. `counterStyleCss` (`build.ts`) then rewrites
every `counter(page[, style])` found in ANY page context into
`counter(page, folio-page--<style>)`, one generated `@counter-style` per
distinct style keyword actually used (`lower-roman`, plain decimal, …) — so
front matter and body can display the SAME restarted number sequence in
different symbols without the compiler ever having to know which named
context is "active" on which page (Chromium's own cascade still does that
part). The viewer applies the identical `pageCounterValues` output by
overriding the `page` field it feeds `evaluate()` — no CSS synthesis needed
screen-side, since the number substitution can happen directly in JS.

**The interaction that actually broke first**: a recto/verso blank page
inserted before the restart. The blank spacer is a DOM sibling of the element
it precedes, so on screen it falls inside THAT element's named-page run (front
matter or body) — but the compiler gives every blank its own isolated context
(`page: folio--blank`, resolved with no name and only the `blank` pseudo). The
viewer used to have no equivalent: a blank landing right before a restart
picked up the WRONG run's format (`counter(page)` decimal instead of the
unnamed context's `counter(page, lower-roman)`), which is invisible unless the
two contexts actually format differently — exactly this feature. Fixed by
`fragment.ts`'s `blankPageIndices()`, which locates each inserted blank by its
OWN fragment position (not `strip.page`) so `decorate.ts`'s `pageContext` can
resolve it the same isolated way the compiler does.

**A second, compiler-only instance of the same class of bug (found by review,
now fixed)**: `build.ts` built the `folio--blank` named page's CSS separately
from `counterStyleCss`, copying the author's `@page :blank` declarations
VERBATIM instead of through the `counter(page)`->`@counter-style` rewrite. A
blank inserted for a recto/verso break AFTER the restart is already in effect
(not just the "before the restart" case above) printed the raw PHYSICAL page
number — the viewer, which always went through the shared `pageCounterValues`
path, showed the correct restarted folio, so print and viewer disagreed on the
one page in the book that is hardest to spot (it carries no other content).
`counterStyleCss` now owns the `folio--blank` block too (a `hasBlank`
parameter), through the exact same `rewrite` closure every other page context
uses — one function, verified with an independent reader (`pdftotext`): a
fixture with 3pp roman front matter, a restart, and a SECOND forced-recto
break inside the already-restarted body prints the inserted blank as the next
number in the restarted sequence (`…1, 2[blank], 3…`), not the physical page.

**`target-counter()` also has to cross the restart.** A cross-reference
pointing at a page whose folio was restarted used to resolve `target-counter()`
to the MEASURED (physical) page number, while the target page's own margin box
printed the restarted folio — `(p. 7)` pointing at a page that itself prints
folio `4`. Fixed the same way: `synthesis.ts` exports `restartedPageValues`
(resolves `resetSites` against a measured id->page map into the same array
`pageCounterValues` produces) and `toFolioPage` (looks up one physical page in
that array, identity when there is no restart). Both `build.ts`'s
`applySynthesis` (the `targetPage` callback fed to `evaluate()`) and
`decorate.ts`'s `buildMaps` (the `api.targets` map, now built AFTER the
restart's `pageNumbers` so it can convert through them) call the same two
functions — the page a `target-counter()` reference reports can no longer
disagree with the page it points at.

## 9. `body { zoom }` under print — and what Paged.js's scale actually is

Two measured facts about `zoom` in the print path:

- **`zoom` dilutes by exactly the glyph-box factor.** `body{zoom:1.364}`
  produced a 1.24× glyph scale, `body{zoom:1.5}` produced 1.364× — both
  consistent with `effective = zoom / 1.1`. Do not compute a zoom factor from
  target glyph sizes without accounting for this.
- **Paged.js's type scale on a pt-authored book is byte-for-byte `zoom: 1.5`.**
  On the field guide, plain Chromium + `body{zoom:1.5}` matched the Paged.js
  PDF on **921/921 words within ±0.15pt**. Its output is exactly equivalent to
  a 1.5 zoom — which is also the observed page-count ratio (296/200 ≈ 1.5).
  This makes `zoom: 1.5` the correct temporary shim for A/B tests that must
  reproduce Paged.js boundaries, and it quantifies the reflow a faithful
  engine causes.

### RETRACTED: the `@font-face` rule ORDER mechanism (A3, first attempt)

> [!WARNING]
> **Everything in this subsection is WRONG and is kept only so the mistake is
> not made twice.** It was refuted by independent re-measurement on 2026-08-06
> (see "What the 1.364× actually is" below). Do not build on it, and do not
> re-derive it — the ablation table measures a *font substitution*, not a scale.
>
> Two errors compounded. (1) The fixtures that "pass" at 13.289pt and "fail" at
> 18.252pt are not rendering at different scales; they are rendering in
> **different fonts** — `pdffonts` reports `LiberationSerif` on the 13.289
> variants and `TitilliumWeb-Regular` on the 18.252 ones, and forcing
> `font-family: serif` on the *failing* fixture returns it to 13.289pt to three
> decimals. The CSS delta between the bisect pair that "flips" is
> `body{font-family:var(--font-body)}` — the rule that first applies Titillium
> Web — not an `@font-face` reordering. Glyph bounding boxes differ between
> typefaces at the same type size; the PDF text-state size is `Tf 16` (12pt) in
> **every** variant in the table.
> (2) The conclusion "Paged.js inflates" does not survive its own discriminating
> experiment: the full field-guide stylesheet (all 7,143 lines, faces-first as
> authored) rendered through the shipped Paged.js path and rendered by plain
> Chromium 151 with every `<script>` stripped produce the **identical**
> 18.252pt / 44.400pt. **Paged.js applies no scale.**

### What the 1.364× actually is — and why it is now an OPEN question

The 1.364× *is* real on the field guide, and it is uniform in both axes on the
same word in the same font: Gutterpress `18.252pt × 41.508`, plain Chromium on
the same staged `book.html` `13.381pt × 30.430` (18.252/13.381 = 1.3641;
41.508/30.430 = 1.3640). A uniform geometric scale of the whole render.

The measured direction is the opposite of what this document previously
claimed: **Chromium's print shrink-to-fit is compressing the PLAIN render, not
Paged.js inflating the paginated one.** The un-paginated document lays out
~960px wide (one 1020px `h1`) against ~705pt of printable width, so Chromium
scales the whole page down to fit. Probe evidence: a `96px` serif probe
injected at the top of the real staged body prints **58.453pt**; the same probe
on a control page with identical `@page` geometry where nothing is over-wide
prints **79.734pt**. 58.453 / 79.734 = 0.733 = **1 / 1.364**.

**This is the gate for Step 2 and it is not closed.** If the plain-Chromium
13.38pt baseline is shrink-to-fit-compressed, then the same question must be
asked of Folio's leg before any type token is retuned, and — if Folio's numbers
were taken from a compressed render — `COMPARISON.md`'s "Folio typesets at the
size the CSS declares" conclusion inverts. Nobody has measured that yet. Do not
retune a token until it is measured. The historical (refuted) reasoning follows.

### The mechanism: `@font-face` rule ORDER, not a scale property (A3 finding — REFUTED, see above)

Instrumented in `packages/cli`: `pagination.ts` sets a plain 1920×1080
viewport (irrelevant to print — `page.pdf()` prints at the explicit
`width`/`height` read from the `.pagedjs_page` computed style, not the
viewport), never sets `deviceScaleFactor`, and injects no CSS of its own
(`pagedjs.ts` only adds the polyfill `<script>` + break-inside handler — see
`ARCHITECTURE.md`/A1 above). Confirmed by measurement, not reasoning: a
single-paragraph fixture with a literal `font-size:12pt` and no custom fonts,
run through the exact shipped `renderHtmlToPdf()`, printed at **13.406pt**
glyph height for "the"-class words at 12pt on a plain sans-serif — i.e. no
scale at all through the real pipeline on ordinary content. The inflation only
appears with the field guide's actual CSS, and is fully reproducible from a
single, isolated variable:

**Trigger: whether the stylesheet's `@font-face` rule(s) for the font actually
applied to body text appear BEFORE or AFTER the rest of the stylesheet
(specifically, before the `:root` custom-property block).** Verified with
ten+ fixtures built from the field guide's real, unmodified `@font-face`
blocks (6 weight/style variants of `'Titillium Web'`, read only from a local,
already-staged copy — not modified), run through the identical
`renderHtmlToPdf()` call each time, varying only the ORDER of CSS text handed
in:

| fixture | `@font-face` position | measured "chapters" glyph height |
| --- | --- | --- |
| body text in `sans-serif` (no custom font at all) | — | 13.406pt (baseline) |
| all 6 `Titillium Web` faces, placed AFTER `:root`+rest of the CSS | after | 13.289pt (correct) |
| the SAME 6 faces, in their ORIGINAL file position (BEFORE `:root`) | before | **18.252pt** |
| the SAME 6 faces moved to the very top of the stylesheet | before | **18.252pt** |
| a single unrelated dummy rule (`.foo{color:red}`) placed first, no `@font-face`, `sans-serif` body | before, but not a font rule | 13.406pt (correct — rules out "anything-first") |
| only 1 of the 6 `Titillium Web` faces (400 normal) | before | 13.289pt (correct — rules out "any @font-face before") |
| only 2 of the 6 (400 + 700, both `normal` style) | before | 13.289pt (correct) |
| all 6 `Titillium Web` faces alone (no other font families) | after (moved) | 13.289pt (correct) |

The real field guide's `@font-face` blocks are authored first in its CSS
(`css/dc-tokens.css`'s "WEBFONTS (local)" section, before `:root`), which is
exactly the failing arrangement — this is not a contrived ordering, it is the
book's actual authoring convention. Both **plain Chromium** (no Paged.js:
`page.pdf({ preferCSSPageSize: true })` on the untouched real staged
`book.html`, faces-first as authored) and the real shipped Gutterpress PDF's
Table-of-Contents page were measured directly for cross-check: plain Chromium
13.381pt / 12.82pt for "chapters"/"origins,"; the actual production PDF
18.252pt for "chapters" on the same content — reproducing COMPARISON.md's
13.38→18.25 (1.364×) finding exactly, and confirming plain Chromium is
unaffected by the ordering that breaks Paged.js.

**What this rules out and what remains open.** It is not `packages/cli`
driving code (the ONLY variable across the passing/failing fixtures above is
the CSS text order — `pagination.ts`/`pagedjs.ts` are byte-identical in every
run). It is not the font being embedded, not `font-display: swap` (ablated:
still inflates with `font-display: auto`), not having multiple weight/style
variants of one family (2 and 6 variants both pass when placed after `:root`;
both fail when placed before), and not "any rule before `:root`" (an unrelated
dummy rule first does not trigger it — it is specific to `@font-face` rules
that are actually in use). No dedicated `@font-face`/`FontFace` **Handler**
class exists in the vendored polyfill (`paged.polyfill.js`'s `Handler`
subclasses are `AtPage`, `Breaks`, `Splits`, `Counters`, `Lists`,
`PositionFixed`, `PageCounterIncrement`, `NthOfType`, `Following`,
`Footnotes`, `RunningHeaders`, `StringSets`, `TargetCounters`, `TargetText`,
`WhiteSpaceFilter`, `CommentsFilter`, `ScriptsFilter`,
`UndisplayedFilter` — none font-specific), so the trigger is not an explicit
font-processing pass; it is some order-sensitive side effect of Paged.js's own
CSS-rule walk (shared with `AtPage`'s `@page`-context extraction, which also
walks the whole stylesheet by rule position — see §3's unrelated but
same-shaped "cross-stylesheet order" cascade bug) that a large `@font-face`
`src: url(data:...)` payload sitting before the rest of the sheet appears to
perturb. The exact internal function was not isolated further within this
task's budget — the trigger condition above is precise and reproducible
(10 fixtures, single-variable ablation each time), which is enough to place
the fault definitively inside Paged.js and out of `packages/cli`, but not
enough to name the exact line the way A1's mirrored-gutter root cause was
named. Not fixed, for the same reason as A1: forking the vendored polyfill is
out of scope, and the book's own `@font-face`-before-`:root` authoring
convention is unlikely to be worth changing for an engine being retired.

## 10. `filter:` rasterizes the subtree at 300 DPI — the dominant print cost

This is the single most expensive thing measured in this project, and it is a
property of Chromium's PDF output, not of any tool wrapping it.

**What it does.** A minimal A/B — two identical documents, one with
`filter: drop-shadow(...)` on a card:

| | no filter | with `drop-shadow` |
| --- | --- | --- |
| sentinel strings extractable | 2 | **0** |
| fonts in the PDF | 1 CID TrueType | **none at all** |
| embedded images | 0 | **4** (300 DPI, with soft masks) |
| file size | 8,988 B | **37,435 B** (4.2×) |

There is no vector filter primitive in PDF, so Chromium **rasterizes the entire
filtered subtree into a bitmap** and embeds it — at 300 DPI, so print quality is
preserved. The text inside a filtered element is no longer text; it is a picture
of text.

**Why it dominates the clock.** Instead of emitting a few hundred bytes of
vector glyph references, the engine renders each filtered subtree to a 300 DPI
raster, per element, per page, then compresses it. Measured on the field guide
(60 pages): **57.0 s with filters, 6.2 s without — 9.2×.** For comparison, over
the same 60 pages `box-shadow` costs nothing (57.0 s) and `background-image`
costs nothing (56.9 s); hiding every `<img>` changes the PDF from 41.5 MB to
12.6 MB and the time not at all. **`filter:` is ~90 % of print time and nothing
else is close.**

**Three consequences beyond speed**, all confirmed on the real book (page 100
carries a 2199×1517 @300 DPI image plus a `Type 3` font where a text card is
authored):

1. **Text in filtered elements is not selectable, searchable, or accessible.**
   This is why `pdftotext` recovers almost nothing from the card chapters of
   *either* engine's PDF — the earlier "168 near-blank pages" reading was this,
   not a layout fault.
2. **File size inflates** — vector text replaced by 300 DPI bitmaps.
3. **It costs both engines equally.** Paged.js and Folio print through the same
   Chromium, so this expense is already in the current pipeline's build time.

**The mitigation is authorial, not architectural:** `box-shadow` is free and
stays vector. `filter: drop-shadow()` is only required when the shadow must
follow a `clip-path` silhouette rather than the border box. Restricting
`filter` to the elements that genuinely need the silhouette — and using
`box-shadow` elsewhere — is the largest single build-time win available, and it
restores text extraction for the affected content.

Do **not** try to reclaim this by disabling `filter` for a measurement pass:
`filter` creates a containing block, so removing it moves layout (measured: 26 %
of words shift). `filter: opacity(1)` preserves the containing block but still
rasterizes (measured: text stopped extracting), so it is not a shortcut either.

## 11. PDF/X hand-off

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
