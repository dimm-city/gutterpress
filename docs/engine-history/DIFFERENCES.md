# Output differences: current Gutterpress (Paged.js) vs Folio — full inventory

> The defect ledger and the measurements behind it. The rules that came out of
> these defects live in [`ARCHITECTURE.md`](./ARCHITECTURE.md); the browser
> behaviour they are built on lives in [`ENGINE.md`](./ENGINE.md).

Second pass, triggered by the cover looking narrow in the first screenshot. It
was narrow, and it was a Folio bug (D1).

Method: `compare/diff-report.ts` aligns the two PDFs **by content** (Needleman-
Wunsch over per-page word overlap) before comparing anything, so a single
inserted page doesn't make every later page look different. It then diffs the
whole-document word multiset (content loss), per-page ink bounding boxes
(geometry), margin-box text (running heads and folios), and structure
(outline / dests / links / fonts / tags).

```bash
bun compare/run.ts                                       # the head-to-head
bun compare/diff-report.ts <a.pdf> <b.pdf> [labA] [labB] # this inventory
```

**Third data point added this pass:** the same `book.html` printed by plain
Chromium with no Folio involvement at all. That separates "the two engines
disagree" from "Folio does something wrong".

> **Folio reproduces plain Chromium exactly: 61/61 pages matched, 0 unmatched,
> 0 weak matches, and the only text difference is the running heads Folio
> synthesizes** (`string()` is unimplemented, so native prints no head at all).
> Every remaining difference below is therefore either a Chromium↔Paged.js
> engine difference or something Folio *adds*.

---

## Part 1 — differences between the two outputs

### Same in both (verified, not assumed)

| | result |
| --- | --- |
| content | 0 words present in one PDF and missing from the other, beyond running heads and the 3 extra folios |
| running heads + folios | **identical on all 61 aligned pages** (0 chrome differences) |
| fonts | identical set of 10 embedded subsets |
| links / named destinations | 11 / 10 in both |
| tagged PDF | both tagged (`StructTreeRoot` present) |
| page size | 612×792 pt in both, every page |
| `break-inside: avoid` | 0/25 marked blocks split, in both |
| cover, TOC, chapter openers | visually identical (after D1 was fixed) |

### D-list: what actually differs

| # | difference | cause | who's "right" |
| --- | --- | --- | --- |
| **D1** | **Cover was inset 54 pt left / 72 pt right instead of full-bleed** (ink box `[54,0,539,791]` vs `[0,0,611,791]`) | **Folio bug** — `resolvePage` merged all `@page` declarations and *then* applied `margin` followed by `margin-*`, so `@page :right { margin-left: .75in }` overrode `@page cover { margin: 0 }` from a stronger rule | Paged.js. **Fixed** this pass + 3 regression tests |
| **D2** | 64 pages vs 61 | typesetting density: Paged.js leaves a median 110 pt unused at the foot of a page, native leaves 60 pt. Paged.js's extra pages are 30, 34 and 52 | neither is wrong; native packs tighter to the same rules |
| **D3** | TOC heading alone on p2 in Folio; heading + body together in Paged.js | `#ch-toc h1 { page: toc }` — a page-name change at a nested box. Chromium forces a break there, Paged.js applies the name to the containing block | Chromium follows the spec. **Migration impact:** this theme wants `page: toc` on `#ch-toc`, not on its `h1` |
| **D4** | PDF outline: 0 entries vs 155 | the current pipeline's `page.pdf()` never asks for one. Printing the *Paged.js* DOM with `generateDocumentOutline` also yields 155 — this is not a Paged.js limitation | Folio. One-line fix available in `pagination.ts` today |
| **D5** | 594 KB vs 996 KB | Folio's PDF carries the outline and is re-saved by pdf-lib without object streams | acceptable; worth revisiting (`useObjectStreams`) |
| **D6** | metadata `Creator`/`Producer` = "Folio (spike)" | Folio's postprocess stamps them unconditionally, clobbering `gutterpress` / `Skia/PDF` | Gutterpress. Folio should preserve unless told otherwise |
| **D7** | `--format` broken across a line in Folio p55 (`-` / `-format`) | downstream of D2/D3 page shift — different line start, so the inline `<code>` wraps between the hyphens. Both engines can do this | neither; the theme should set `word-break`/`hyphens` on inline code |
| **D8** | ink width on 2 aligned pages (p2, p48↔p46) | consequences of D3 and D2 — different content on those pages, not different rendering | n/a |

### Not observable in this book, but found while probing (see Part 2, F1)

Recto/verso forced breaks and `@page :blank`. This theme uses
`break-before: page`, so the head-to-head could not show it; a book that starts
chapters on right-hand pages would regress badly on a straight swap.

---

## Part 2 — defects and risks in Folio to investigate

Ordered by how much damage they'd do in production.

### F1 — `break-before: right|left|recto|verso` is a plain page break in Chromium (spike `s10`) — **FIXED**

Chromium ignores the recto/verso semantics: with `h1 { break-before: right }`,
chapters land wherever they fall (3 pages, CH2 on a verso). Paged.js implements
it correctly (5 pages, blank versos inserted, both chapters on rectos). "Chapters
start on a right-hand page" is table stakes for print books, so this is a
functional regression a swap would introduce.

Also: **`@page :blank` never matches** — Chromium doesn't apply it even to a
page containing only an empty spacer.

Both are now shimmed in the compiler, and s10 checks the whole chain: the
engine gap, what Paged.js does, the synthesis in isolation (matches Paged.js
page-for-page), and `folio build` end to end (both chapters on a recto, the
inserted page genuinely blank, converged in 2 passes).

How it works: `break-before: right|recto|left|verso` declarations are collected
by `gcpm-extract`, their elements instrumented and measured (the existing
`/Dests` channel), then the **whole spacer set is computed analytically from one
clean measurement** — walk the sites in document order carrying a running count
of blanks inserted so far, because each blank shifts every later page by exactly
one and changes no content. Toggling them one pass at a time oscillates instead:
the spacer fixes the parity, the next pass sees it fixed and removes it. Each
spacer carries `page: folio--blank`, a generated name holding the author's
resolved `@page :blank` declarations, emitted last so the cross-stylesheet
cascade (F10) can't override it.

### F2 — the page-renaming machinery — **DELETED**

It was never a Paged.js carry-over. It existed for one reason: `string-set` /
`string()` is unimplemented in Chromium, so a margin box that should read
"Chapter 3" has no way to say so in CSS. Giving each chapter its own generated
`@page chapter--N { @top-right { content: "…" } }` and moving that run's boxes
onto it was one way to express "this page's header differs from that page's".

It was also the single most defect-prone thing in the compiler: four bugs on
first contact with a real theme (dropped non-string rules, lost cascade fights,
inverted page-selector specificity, no string carry-over).

**A/B measured on the user guide, same input, both strategies:**

| | page renaming | counter-style map |
| --- | --- | --- |
| pages | 61 | 61 (61/61 content-aligned, **0 geometry differences**) |
| generated CSS | 64.5 KB | **4.7 KB** |
| print passes | 1 | 2 |
| build time | 0.9 s | 2.2 s |
| author's `@page` rules | rewritten into generated names | **untouched** |

The only content difference was one running head, and there the counter-style
output is the more correct one: renaming was extending the `toc` template past
the page the author named. So renaming buys one print pass and costs a
reimplementation of the `@page` cascade — deleted (−342 lines across the
compiler; `discoverRuns`, `applyPageNames`, the generated templates and the
literal-substitution path are all gone).

Running heads now come from the same `@counter-style { system: fixed; symbols: … }`
map that Tier 3 already used for page-granular strings (verified in s3): one
symbol per page, consumed as `counter(page, folio-<name>)`. Tier 2 is now only
bleed/marks geometry.

### F3 — two implementations of "which page does this element belong to" — **resolved by deletion**

The compiler's copy went away with the renaming (F2); only the viewer's
`pageNameOf` remains, and it is the only consumer.

### F4 — `string()` position keywords — **FIXED, one shared implementation**

`stringValueAt()` in `src/shared/synthesis.ts` implements all four GCPM
position keywords (`first`/`start`/`last`/`first-except`); the viewer evaluates
it live and the compiler samples it per page into one `@counter-style` map per
(name, which) pair actually consumed. Spike s11 verifies `first-except` (empty
head on the opener) and `last` in the printed PDF.

### F12/F15 — `leader()` — **IMPLEMENTED (measured glue fill)**

`leader(".")` now fills: generated content carries a private-use marker; the
renderer measures the line's free space under print geometry (the compiler
constrains the body to the page content width so wrapping matches; the viewer's
strips already are that width), gets the glue width from canvas `measureText`,
and replaces the marker with `floor(gap/glue) − 1` repetitions — one short so a
rounding error can never wrap the line. Measured in print: page numbers land
4–6.5 pt from the content edge (≈1 glue width) on straight, wrapped and
near-full lines; idempotent across passes. Spike s11 locks it in.

### F13 — `target-text()` was unimplemented in the compiler — **FIXED**

`target-text(attr(href url))` rendered as an empty string in print while the
viewer resolved it. The agent now returns the text of every measured target
alongside the page map, so both renderers produce the same string.

### F14 — twins eliminated: one shared policy module — **RESOLVED STRUCTURALLY**

The concern "every compiler-side synthesis needs a viewer-side twin, or the
parity claim quietly rots" is now closed by construction, not discipline:
`src/shared/synthesis.ts` holds every DECISION as a pure function —
`planRectoBlanks` (blank-page placement), `stringValueAt`/`stringSymbols`
(running-string semantics), `leaderFillCount` + the marker protocol,
`isRectoVersoBreak`/`wantsRecto`. The renderers differ only in how they measure
(client rects vs the PDF's `/Dests`) and how they apply (DOM writes vs the
agent); neither contains policy. 16 unit tests cover the module directly.

### F14b — the viewer did not reproduce the blank pages F1 adds — **FIXED**

Implementing recto/verso breaks in the compiler (F1) immediately created a new
viewer/print divergence: the PDF gained blank pages the screen did not, so page
numbers drifted for exactly the books F1 was meant to fix (measured: viewer 5
pages, chapters on 2 and 4; print 6 pages, chapters on 3 and 5). The viewer now
inserts the same blanks, by the same analytic rule, and matches print again
(6 pages, chapters on 3 and 5).

Worth noting as a pattern: **every compiler-side synthesis needs a viewer-side
twin**, or the parity claim quietly rots. The same is true of the header
compensation (which does have one) and would be true of any future shim.

### F5 — synthesis must never move content — **now asserted**

`s8` prints the same document with plain Chromium (no Folio) and requires the
compiled page count to match. With renaming gone the risk mostly evaporates —
nothing is renamed, so nothing can introduce a page-name change — but the check
stays as the guard for future synthesis.

### F10 — Chromium does not apply `@page` selector specificity ACROSS stylesheets — **new, worked around**

Within one stylesheet, Chromium ranks page selectors correctly: `@page :left`
beats `@page`, a named page beats both, regardless of source order (measured).
Put the same rules in **two separate `<style>` elements** and that stops being
true — a plain `@page { @top-center { … } }` in the later sheet overrides
`@page :left { @top-center { content: none } }` in the earlier one, and the
running head is drawn twice.

That matters for any tool that injects generated `@page` CSS, which is exactly
what Folio does. The workaround is to depend on it as little as possible: every
generated page context is emitted with its **fully resolved** content, including
the suppressions, so nothing has to win a cross-sheet cascade. Worth reporting
upstream.

### F11 — instrumentation was visible to the author's CSS — **FIXED at the root**

The measurement pass no longer touches author-visible attributes at all.
Elements with their own ids are measured through them; elements without get a
zero-size `<folio-anchor id=…>` injected as first child (custom tag,
absolutely positioned). Verified against hostile CSS (`h2[id]
{ counter-increment }`, `::before` counters, `a[href]::after`): 12/12
page-accurate `/Dests`, page count and every counter identical to a folio-free
print. Because measurement is now provably neutral, the old de-instrument +
final-reprint pass is DELETED — the compiler measures exactly the document it
ships, and a Tier 3 build costs 2 prints instead of 4 (user guide: 3.1 s →
1.8 s warm). s11 asserts neutrality against a plain-Chromium baseline on every
run. Residual risk, documented: a `parent > :first-child` author rule could
observe the injected child; elements with author ids (the common case —
markdown renderers id their headings) never get an anchor.

### F6 — metadata clobbering (D6) and object streams (D5) — **FIXED**

Measured: `useObjectStreams: true` is 41 % smaller AND 2.5× faster to save
(979 KB/225 ms → 579 KB/89 ms), identical structure to both pdf-lib and PyMuPDF
readers. The clobbering was pdf-lib's `load()` default (`updateMetadata: true`
stamps pdf-lib as Producer); postprocess now loads with `updateMetadata: false`
and only writes fields the caller provided. Output: 593 KB with Chromium's own
`Skia/PDF` Producer preserved — smaller than the current pipeline's 594 KB while
carrying the 155-entry outline.

### F7 — viewer drift at scale — **root-caused; inherent; documented**

Measured precisely: at the diverging boundary print keeps a line with 1.17 pt
(1.56 px) of slack; boundaries decided by <2 px can round either way between
page fragmentation and multicol. Not a container-geometry bug (strip height is
exactly the print content height; snapping to the 1/64 px LayoutUnit grid
changes nothing). Not fixable by an epsilon: +0.5 px removed 77 % of drift
events on the 6×9 book and exactly matched its page count, but did nothing for
an A4/mm book (78 → 73 events) — the bias is not constant. Fractional page
metrics make it worse (35 events → 78 on the same content), so presets should
prefer pt/px-clean sizes. Posture unchanged and now evidence-backed: the PDF is
ground truth, printed page numbers always come from compiler measurement, and
the viewer's fidelity statement is "exact at chapter scale, knife-edge
boundaries may differ at 100+ pages".

### F8 — `<tfoot>` reservation on screen — **IMPLEMENTED**

Print reserves the repeated footer at the bottom of every fragment; the viewer
now does the equivalent: the first row intruding into the bottom `footH`
reserve of each column gets a foot-clone shim that FILLS the space from the
last kept row to the column bottom (content pinned to the bottom edge, where
print draws it). Claims are sticky across passes — a fix removes the symptom it
was derived from, so re-deriving would oscillate. Verified: rows-per-page match
print exactly for 1-row and 2-row footers, with the repeated `<thead>` active
at the same time (s5).

### F9 — density difference is a *behaviour* change, not a defect, but it is visible

Folio produces a 61-page book where the current pipeline produces 64. Anyone
migrating a book with a fixed page budget (POD signatures, printed TOCs) needs
to re-check it. Worth a `--pad-to-signature` reminder in the migration notes;
`folio build --signature N` already exists.

---

## Status after this pass

| | |
| --- | --- |
| **fixed** | D1 cover full-bleed · F1 recto/verso + `:blank` · F4 `string(which)` · F5 asserted · F6/D5/D6 postprocess · F8 `<tfoot>` · F11 neutral measurement (reprint deleted) · F12/F15 leaders · F13 `target-text()` · F14 shared policy module · F16 `@media print` on screen |
| **deleted** | F2 (page renaming), F3 (duplicate run detection), the de-instrument reprint |
| **worked around** | F10 (cross-stylesheet `@page` cascade — generated contexts emitted fully resolved) |
| **inherent, documented** | F7 (viewer drift at knife-edge boundaries, ≈1 event/60 pp worst case; PDF is ground truth) |
| **migration considerations** | F9/D2 (denser output: 61 vs 64 pages), D3 (nested `page:` breaks per spec) |
| **now tested** | PDF/X hand-off (s12) · POD bleed/marks geometry (s13) · image-heavy books (s14) — see below |

### F15 — leaders have no implementation at all — **open**

See F12: `leader()` now renders as nothing rather than garbage, but a TOC that
relies on dot leaders will print without them. This is the last GCPM construct
in the proposal's scope with no story.

### F16 — unexercised surface — **MEASURED, one gap fixed**

- **Author multi-column blocks** (`columns: 2` nested inside the viewer's own
  multicol): 30/30 tokens on the same page as print, page counts equal. Works.
- **`@page` inside `@media print`**: prints correctly, but the browser does not
  apply print-media rules on screen (`break-before` computes to `auto`), so the
  preview was missing print-only styling. Fixed: the viewer re-injects
  `@media print` block bodies as screen rules via the existing scanner.
- **Recto spacers inside named-page runs** (`section { page: chapter }` with
  different chapter margins): chapters land on rectos, inserted pages genuinely
  blank, converges. Works.

Still unexercised: `bleed`/`marks` against a real POD acceptance, the
Ghostscript/PDF-X hand-off (no `gs` here), image-heavy books.

The compile path costs one more print pass than before (0.9 s → 2.2–3.2 s warm
on a 61-page book, against 5.5–6.8 s for the current pipeline) and 342 fewer
lines of compiler.

## What I'd do next, in order

1. Finish `string()` position keywords in the compiler (F4) — the viewer already
   has them — and decide what `leader()` should do (F15).
2. Fix the small stuff: metadata preservation, object streams (D5/D6).
3. Run `compare/run.ts` against a book that actually uses recto starts and
   `@page :blank` end to end — s10 covers the mechanism, but no real project in
   this repo exercises it.
4. Report F10 upstream, and keep the resolved-context emission either way.


---

## Part 3 — the three previously-untested areas (real print toolchain)

Run on a machine with Ghostscript 10.06, poppler, Chrome 151 and a FOGRA39L
CMYK profile. Three subagents tested in parallel; every finding below was
re-verified independently before acting on it.

### Ghostscript / PDF-X hand-off — **works** (spike `s12`)

The real `convertToPdfxCmyk` from `packages/cli/src/lib/ghostscript.ts`, run
against a Folio-built PDF with the FOGRA39L profile: 24 checks pass.
`/GTS_PDFXVersion (PDF/X-1:2001)`, `/GTS_PDFXConformance (PDF/X-1a:2001)`,
`/Trapped /False`, a resolving `/OutputIntent` → `/DestOutputProfile`. Page
geometry identical before/after (MediaBox/TrimBox/BleedBox ±0pt on every page
checked), `pdftotext` output byte-identical, 47 RGB fill ops → 0 `/DeviceRGB`
and 34 CMYK ops, all fonts embedded, no transparency. Both x1a and x3 flavors.
Failure modes are loud: a missing or malformed ICC makes gs throw and no file
is written.

Operational note, not a Folio defect: Ghostscript rejects `/Link` annotations
under `-dPDFX`, so `qpdf`'s `stripAnnotations` is a hard requirement for any
document with cross-references — already asserted by `build-preflight.ts`.
**Folio's own measurement adds no annotations**: verified that instrumentation
emits `/Dests` but ZERO `/Link` and ZERO `/Annots`, because the source links are
`display:none` and never painted.

### POD bleed/marks geometry — **two real bugs, both fixed** (spike `s13`)

Correct across 6×9, 8.5×11, 5.5×8.5, A5 and 7×10 at 0 / 0.125in / 3mm bleed:
TrimBox exactly the authored trim and centred in MediaBox on all four sides;
BleedBox = trim + 2×bleed; mm→pt exact (3mm → 8.504pt); 8 crop marks, 18pt
long, offset 9pt from the trim corner, entirely outside BleedBox; signature
padding blank with identical boxes; worst live-matter clearance 0.314in
(> the 0.25in industry minimum).

**Bug 1 — mirrored gutters were destroyed whenever bleed was active.** `synthesize()`
resolved margins once with no pseudo context and emitted a single unnamed
`@page { margin-* }`. Because Chromium ignores page-selector specificity across
stylesheets (F10), that generated rule beat the author's `@page :left`/`:right`
on every page: measured all-45pt margins instead of 63/45 alternating — any
bound book with bleed *and* gutters mirrors wrong and is unprintable. Fixed by
emitting one resolved block per page context, the same shape `counterStyleCss`
already used. Verified: verso 45pt, recto 81pt, correctly alternating.

**Bug 2 — Folio's own transform made bleed art impossible.** Measured engine
limit first: Chromium clips page content to the CONTENT BOX. Nothing paints
outside it — not `position:fixed`, not a negative margin, not even
`html { background }` (a spec deviation: per CSS Paged Media the root background
should fill the page box). Ink stops at 80.6pt on a page whose bleed edge is at
18pt. **But with `margin: 0` the content box IS the page, and art reaches every
edge** (measured `0,0,449,665` on a 450×666pt media).

Folio was inflating *every* margin by bleed+slug — including an authored `0`.
So `@page cover { margin: 0 }` plus `bleed: 0.125in` produced a 27pt white
border exactly where the author asked for full-bleed art: Folio turned a
working full-bleed cover into a broken one. Fixed in `bleedMargin()` — a zero
authored margin stays at slug only, so the content box is exactly the bleed box
and art fills it with the crop marks still clear.

The residual limit is the engine's, and is now stated rather than implied:
**bleed art is only possible on zero-margin pages.** Presets must put covers and
full-page plates on their own `@page name { margin: 0 }` and inset live matter
with padding.

### Image-heavy books — **fidelity is solid; diagnostics were missing** (spike `s14`)

Fidelity and postprocess safety are clean: 10 rasters embed at their exact
source resolution (300 DPI source → 300 DPI, 600 → 600, 72 → 72, ±2 DPI by
poppler); the pdf-lib re-save leaves all 11 image rows byte-identical
(size/encoding/colorspace), PNG alpha survives as a soft mask, JPEG stays JPEG.
Performance is linear: 10/50/150 deduped images → 169/215/399ms; distinct
images ≈33KB and ≈23ms each; viewer 0.22–0.76 ms/page, better than the
text-only baseline.

The gap was diagnostics, and it is now closed: a **print-quality audit** runs
against the settled layout and reports content taller than the page content box
(where screen and print genuinely diverge, because print splits an image across
pages) and any raster below the 300 DPI print bar (`--dpi-floor`, 0 disables).
On the image fixture it flags the 9in image on a 7.5in content box and two
under-resolution rasters — including a 200 DPI one the original report missed.

One caveat on the reported "viewer clips overheight images" divergence: it did
not reproduce in nine isolated configurations (bare image and figure-wrapped,
with and without `break-inside: avoid`, at four fill offsets) — the figure
fragments across two columns in the viewer just as it splits across two pages in
print. The observed divergence is adjacent-page, i.e. the documented F7
knife-edge class, in a document that also contains an overheight element. `s14`
now asserts what `s1` does: page counts exact, disagreement only ever adjacent,
and the overheight element must have been flagged by the audit.

### Also found: the engine upgrade that bought the version pin

Not one of the three areas. Moving to a newer browser silently broke
cross-references and leaders — see the F-list entry for `generatedContentCss`.
The short version: `CSS.supports()` reports `target-counter()` as supported
while it computes to `none`, so the author's surviving declaration
out-specified Folio's override and the text vanished with no error.

Two things came out of it. **`CSS.supports` is not a usable feature detector for
the GCPM shims** — s0 render-probes instead. And **Folio now pins its engine**
(`REQUIRED_MILESTONE = 151`, enforced at launch) rather than supporting a range,
because this class of break is undetectable from inside the page. See
[`ENGINE.md`](./ENGINE.md) §2.
