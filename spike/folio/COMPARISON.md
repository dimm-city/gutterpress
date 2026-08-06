# Current Gutterpress (Paged.js) vs the Folio spike — same book, both engines

> [!WARNING]
> **CORRECTION (2026-08-06): the type-scale conclusion in this file is
> refuted.** This document attributes the field guide's 1.364× type-size gap to
> Paged.js scaling the book up. Independent re-measurement proved the opposite:
> Paged.js applies **no scale** (it renders identically to script-stripped
> plain Chromium on the full field-guide stylesheet), and the smaller type on
> the plain/Folio legs is **Chromium print shrink-to-fit compressing those
> renders** — the un-paginated document lays out ~960px wide against ~705pt
> printable, and Folio's own PDF build is compressed **identically** (probe:
> 58.45pt on both legs vs 79.73pt uncompressed control). So "Folio typesets at
> the 12pt the CSS declares" is **wrong on this book**: 13.38pt is the
> compressed size, and Paged.js's 18.25pt is the *uncompressed* rendering.
> The pagination-agreement, gutter-fidelity, drift-profile and `filter:`
> findings below are unaffected. Authoritative account: `ENGINE.md` §9
> ("What the 1.364× actually is") and `MIGRATION.md` Step 1/Step 2.
> Sections below are left as written; read them against this correction.

Reproduce with:

```bash
bun spike/folio/compare/run.ts                                   # the user guide
bun spike/folio/compare/run.ts examples/gutterwire-zine          # any project
```

The input is **not** hand-written for either engine: `compare/stage-book.ts`
calls the shipped Gutterpress library (`loadManifestWithPath` → `resolveConfig`
→ `renderChaptersToFile`) to produce the exact pre-pagination `book.html` that
the current build hands to Paged.js, and Folio compiles that same file. Both
engines also run in the same headless Chrome (151, Folio's pinned engine).

Subject: `examples/gutterpress-user-guide` — ~2,100 lines of markdown, 10
chapters, a cover, a TOC, named pages (`cover`/`toc`/`chapter`), mirrored
`:left`/`:right` margins, `string-set` running heads, tables, code blocks,
`break-inside: avoid` sections. 120 KB of staged HTML.

---

## Headline

| | current (Paged.js) | Folio spike |
| --- | --- | --- |
| build a 60-page book | **4.8–6.9 s** | **2.2 s cold, 1.8 s warm** |
| paginate in the browser | **1.16 s** | **0.11 s** (0.04 s on hot reload) |
| engine shipped to the page | **901 KB** `paged.polyfill.js` | **23 KB** (9 KB gzipped) |
| DOM after pagination | 1,645 → **6,070 nodes (3.7×)** | 1,645 → **1,880 nodes (1.14×)** |
| pages for this book | 64 | 61 |
| median unused space per page | **110 pt (1.5 in)** | **60 pt** |
| PDF outline (bookmarks) | **0 entries** | **155 entries** |
| engine-specific CSS the author must write | `--pagedjs-margin-*`, `.pagedjs_sheet` | none |

Cover, TOC and every chapter-opener page come out **visually identical**
(`/tmp/cmp/sbs-*.png`, and `compare/out/page-*.png` contact sheets).

---

## A. Compile

```
gutterpress: 5.30s → gutterpress-user-guide-pdf.pdf (594 KB), 64 pages
folio:       2.24s cold / 1.77s warm → folio.pdf (593 KB), 61 pages, tier 3
```

(Tier 3 costs exactly 2 prints: measurement is neutral — elements are measured
through their own ids or injected zero-size anchors — so the measured document
IS the shipped document and no clean-up reprint exists. The PDF is also now
SMALLER than the current pipeline's despite carrying the 155-entry outline:
object streams + preserved metadata, see DIFFERENCES.md F6.)

Both produce 612×792 pt pages, the same 10 named destinations and 11 link
annotations. Two differences worth naming:

- **Speed.** Folio is ~1.9× faster cold and ~2.5× faster warm. It never loads a
  pagination engine, never rebuilds the DOM, and prints once.
- **PDF outline.** The current build's PDF has no bookmarks; Folio's has 155.
  This is **not** a Paged.js limitation — printing the Paged.js-rebuilt DOM with
  `generateTaggedPDF` + `generateDocumentOutline` also yields 155 entries
  (measured). The current pipeline's `page.pdf()` call in
  `packages/cli/src/lib/pagination.ts` simply doesn't ask for them. That's a
  one-line improvement available today, independent of this spike.
- **File size.** 593 KB vs 594 KB — effectively identical, with Folio's
  carrying the outline and tags.

## B. In-browser pagination (the preview loop)

Same document, same browser, both measured from "engine starts" to "pagination
finished":

```
paged.js: 64 pages in 1.16 s   engine payload 901 KB   DOM 1,645 → 6,070 nodes
folio:    65 pages in 0.11 s   engine payload  23 KB   DOM 1,645 → 1,880 nodes
          hot-reload update 0.04 s
```

**~10× faster, ~39× smaller, and the author's DOM survives.** Paged.js clones
content into `.pagedjs_page` scaffolding — which is why the current preview
needs the `data-ref` de-duplication pass, the `break-inside` handler, and the
"unterminated string custom property" repair (the build logs
`Closed 256 unterminated Paged.js string custom properties before serialization`
on this very book). Folio adds one wrapper per run plus an absolutely-positioned
decoration layer; the paragraphs the author wrote are still the paragraphs in
the DOM.

## C. Visual

61 pages compared at 72 dpi: mean difference 11 % of pixels, 4 pages
byte-identical after rasterisation. The cover, the TOC and every chapter opener
match exactly; the difference is concentrated where the two engines *break*
differently (below), which shifts content and scores as a whole-page difference.

## D. `break-inside: avoid`

25 blocks in this book carry it (`.section`, `figure`, `.callout`, …).
**Neither engine split any of them** (0/25 each). Paged.js has no native
support — the current pipeline polyfills it with a `Paged.Handler` that watches
`data-break-inside="avoid"`; Chromium implements it in C++.

## E. Typesetting density — why 61 pages instead of 64

| | median unused at the foot of a page | pages leaving > 1 in empty |
| --- | --- | --- |
| Paged.js | 110 pt | 37 / 64 |
| Folio (native) | 60 pt | 30 / 61 |

Paged.js habitually stops early: on page 29 it leaves the bottom third blank and
pushes a heading + code block to the next page, where Chromium fills the page
and continues the block. Over 60 pages that is three extra sheets — real money
in POD. Neither is "wrong" (both honor the avoid rules), but the native engine
packs to the same rules more tightly.

---

## What this comparison found in the spike (all fixed here)

Running real theme CSS through Folio surfaced three genuine Tier 2 bugs that the
generated fixtures never would have:

1. **Generated page templates dropped the author's non-string rules.** Tier 2
   copied only the `@page` rules that contained a `string()`, so
   `@page cover { margin: 0; @top-*: content none }` vanished when the run was
   renamed and the cover came out with body margins, a running head and a folio.
   Now every author rule for the page name comes along.
2. **The rename fought the cascade.** `[data-folio-run] { page: … }` lost to
   `#ch-toc h1 { page: toc }`, stranding elements on the old name — which reads
   as a spurious page break. Generated names are now applied as **inline
   styles**, which no author selector can outrank.
3. **Copying rules verbatim inverted page-selector specificity.** An unnamed
   `@page :left` copied into `@page chapter--3:left` outranked the named
   `@page chapter--3` it was supposed to lose to, putting folios back on the
   cover. Tier 2 now resolves the cascade itself (the same resolver the viewer
   uses) and emits one flat block per pseudo-variant.
4. **Running strings must carry across runs.** GCPM `string()` persists until
   reassigned, so a chapter's *body* run (which sets nothing) still heads with
   the chapter title. Tier 2 threads the values through the runs in document
   order.

After those fixes: cover, TOC, running heads, folios and chapter openers all
match the current output, and chapters 01–04 land on identical pages (4, 11, 21,
28) before the density difference starts to accumulate.

It also corrected a finding in `RESULTS.md`: `h1 { page: chapter }` is a
deliberate **chapter-opener** idiom, and Chromium and Paged.js treat it
identically (opener page gets the template, body returns to the default page).
What it does not do is put the whole chapter on that template — the viewer now
says exactly that instead of calling it a mistake.

## Follow-up pass

[`DIFFERENCES.md`](./DIFFERENCES.md) is the exhaustive artifact diff: every
difference between the two PDFs, content-aligned so a single inserted page
doesn't smear across the rest of the book, plus a third baseline (plain Chromium
printing the same HTML with no Folio at all). Headlines from it:

- Folio reproduces plain Chromium **61/61 pages**, adding only the running heads
  it synthesizes — so every remaining difference is Chromium↔Paged.js, not Folio.
- The cover in the first screenshot really was narrow: a margin shorthand vs
  longhand cascade bug in `resolvePage` insets full-bleed covers. Fixed, with
  regression tests.
- `break-before: right|recto` is a plain page break in Chromium and
  `@page :blank` never matches — Paged.js implements both. Highest-risk gap for
  a swap; shim verified in spike `s10`, not yet implemented.

## Caveats

- One example project. The zine example (1 page) also matches; the design-guide
  examples have not been run.
- No Ghostscript in this environment, so the PDF/X stage of the current pipeline
  was not exercised on either side.
- Folio consumed Gutterpress's *rendered HTML*. The markdown pipeline, plugins,
  manifest, linting and validation are untouched by this comparison — they sit
  above the render stage that Folio would replace.
- The theme's `.full-bleed` helper reads `--pagedjs-margin-left/right`. It is
  unused in this book, but it is engine-coupled CSS: under Folio those variables
  are undefined and the helper falls back to `0px`. A native replacement would
  be a plain negative margin.

---

## Second subject: the DC Field Guide (art-heavy, 7 CSS layers)

Run on `dc-op-manual/field-guide` — ~1.9 MB of staged HTML, 1.2 MB of CSS across
seven layers, a custom markdown-it plugin, 102 MB of art. An order of magnitude
harder than the user guide, and it produced findings the user guide could not.

| | current (Paged.js) | Folio |
| --- | --- | --- |
| build | **260 s** | **404 s** |
| pages | 296 printed / 302 PDF | 200 printed / 201 PDF |
| PDF | 167 MB | 144 MB |
| body type as rendered | **~16.4 pt** | **12.0 pt** |

### The type is 1.36× larger under Paged.js — verified three ways

The book's CSS authors body text as `--fs-body: 12pt`, declared exactly once and
at top level (not inside `@media print`). Measuring the *same words* on the
*same content* in three renderings of the *same* `book.html`:

| word | plain Chromium | Folio | Gutterpress |
| --- | --- | --- | --- |
| chapters | 13.38 pt | **13.38 pt** | 18.25 pt |
| origins, | 12.82 pt | **12.82 pt** | 17.49 pt |

Folio matches bare Chromium **to the decimal**; Paged.js is a constant
**1.364×** on every word measured. Both PDFs are the same physical page
(621×810 pt) with the same text column (516 vs 522 pt), so this is not a layout
difference — it is a uniform scale applied to the type.

That single factor explains the whole page-count gap: same column, larger
glyphs → fewer characters per line → 296 pages where the CSS as written yields
200. Anchor tracking through the book shows the drift accumulating smoothly to a
stable 1.50× page ratio by mid-book, not jumping at any one construct.

**~~This is the migration risk, and it is not a Folio defect.~~ REFUTED — the
causality here is backwards (see the correction banner at the top).** The
paragraph as originally written claimed the field guide is typeset at ~136% of
its stylesheet and that "the scale originates in Paged.js's layout." Measured
false: Paged.js renders the full field-guide stylesheet identically to plain
Chromium with scripts stripped (18.252pt both ways) — it applies no scale. The
plain and Folio legs are the ones that deviate, compressed by Chromium print
shrink-to-fit because the un-paginated document overflows the printable width
(~960px vs ~705pt; injected-probe ratio exactly 1/1.364). Folio's 200-page /
"genuinely-12pt" render is a *compressed* render, not a faithful one. The real
migration risk is therefore different: the book's over-wide content (a
`dc-op-manual` CSS issue) must be fixed before ANY engine's un-shimmed render
of it means anything. Full account: `ENGINE.md` §9.

### Folio is 1.6× SLOWER here, and the reason is structural

Not a regression — an inversion. Tier 3 costs **two full print passes**; a
single print of this book measures 197 s, and 2 × 197 ≈ the 404 s observed
(`warm` is no faster than `cold`, confirming browser startup is noise at this
scale). On the 60-page user guide, printing is cheap and Folio's win came from
replacing Paged.js's JS pagination (1.16 s → 0.11 s). Here rasterisation
dominates at ~1 s/page — driven by the 1.2 MB of CSS, not the art (hiding every
image changed the PDF from 41.5 MB to 12.6 MB and the time not at all) — and
Folio pays it twice while Gutterpress pays it once.

**Folio's advantage does not shrink as documents get heavier; it inverts.**
Any future work on Tier 3 cost should target the second pass, since on
print-dominated books that pass *is* the build.

### Three bugs this subject exposed

1. **`printToPDF` hung on large books.** `ReturnAsBase64` returns the whole PDF
   in ONE CDP message: a 141 MB book arrives as a ~188 MB base64 string to be
   buffered and `JSON.parse`d at once. Measured: streaming 203 s end-to-end,
   base64 still not returned after 600 s — with no progress and no error, so it
   reads as a hang. Now `ReturnAsStream` (generate 197 s + drain 5.5 s); the
   transfer was never the expensive part. Verified byte-identical output.
2. **The harness staged `book.html` with no assets.** Folio built the entire
   book with zero art, and *every aggregate metric looked like a real engine
   difference* — 184 vs 301 pages, 3.9× file size, Folio showing more words,
   Gutterpress showing 168 near-blank pages. Rendering one page refuted all of
   it. `stage-book.ts` now mirrors the shipped asset step (49 assets, 102 MB).
3. **Text-extraction metrics are unusable on this book.** Card text uses Type 3
   fonts (`AAAAAA+Lixdu`) that `pdftotext` cannot recover, in BOTH PDFs — so
   word counts and "near-blank page" counts are measuring the font, not the
   layout. Use glyph bounding boxes (`pdftotext -bbox`) and rasters instead.

Content bugs found in the book itself (unchanged; run used a corrected copy):
four broken image references, three of them path typos —
`images/chapter-02/cybersurgeon.png`, `./images/chapter-03/etherlock.png`,
`images/chapter-01/proxy.jpg`. These hard-fail the build today.

---

## A/B plan: field guide on Folio without touching the field guide

Status: **shim built and smoke-tested; full A/B not yet run.** Everything below
was probed against real Chromium 151 before being written down.

### Why a shim at all

The field guide styles Paged.js's DOM directly — 11 rules across three
concerns, inventoried from the staged CSS:

1. `.pagedjs_sheet` — the brick sheet background (image, `1.5in auto` tile,
   `multiply` blend)
2. `.pagedjs_margin-bottom-* .pagedjs_margin-content` — poster-chip styling of
   the footer boxes, with `:left/:right` variants (rotated, bordered,
   shadowed)
3. suppression of those chips on `front-matter`/`chapter-start`/`full`/
   `clean`/`:blank` pages

Everything else in the book's page model is already standard `@page` CSS
(named pages, `:left/:right` mirroring, margin-box content) that Folio
consumes as-is. Under Folio the 11 rules are dead — no `.pagedjs_*` elements
exist — which is why the first comparison run produced pages with no
furniture. The shim replaces exactly those 11 rules with standard-CSS
equivalents, appended to a **copy** of the staged book; the field-guide repo
is never modified.

Separately, Paged.js typesets the book at a scale its stylesheet does not ask
for. To compare page boundaries like-for-like, the shim also reproduces that
scale — temporarily, by declared intent.

### The two shims (`compare/fg-shim.css`, applied by `compare/apply-shim.ts`)

**Scale shim — one line, empirically exact.** `body { zoom: 1.5 }` under
plain Chromium print matches the Paged.js PDF glyph-for-glyph: **921/921
words within ±0.15pt**. (Note `zoom` dilutes: 1.5 zoom → 1.364× glyphs; the
naive 1.364 zoom lands at 1.24× and matches nothing. See ENGINE.md §9.) For
A/B runs this makes the type identical; for migration it is deleted and the
decision becomes editorial: keep 12pt as authored (book → ~200pp) or re-tune
tokens to ~16.4pt (book stays ~296pp).

**Furniture shim.** Probed primitive by primitive:

| `.pagedjs_*` rule | standard-CSS replacement | probe result |
| --- | --- | --- |
| sheet brick background | paint all 16 margin boxes + a `body::before` fixed layer | edge-to-edge ink measured; brick seams invisible without offsets; a checker tile probe proved per-box `background-position` offsets align seams exactly if ever needed |
| footer chips | `@bottom-left/right { background, border, width: fit-content, counter(page) }` | renders: backgrounds, solid+dashed borders, counters, placement. **`transform: rotate()` did not apply; `box-shadow` unconfirmed** |
| chip suppression | `@page front-matter { @bottom-* { content: none } }` etc. | standard CSS, Folio consumes directly |
| `C.N` chapter strings | none needed — the book's own `string-set` rules are standard; Folio Tier 3 synthesizes them | verified working in Folio on the user guide |

Smoke test: shimmed book printed by plain Chromium shows the brick sheet edge
to edge, a styled folio chip, and Paged.js-scale type. Content still lands on
different pages than Gutterpress — that remaining delta is precisely what the
full A/B measures.

### How to run the A/B

```bash
# 1. stage (assets included), from spike/folio/
bun compare/stage-book.ts <field-guide-dir> /tmp/cmp-fg/staged
# 2. shim a copy (writes book.shimmed.html next to book.html)
bun compare/apply-shim.ts /tmp/cmp-fg/staged/book.html
# 3. Gutterpress builds the ORIGINAL project; Folio builds the shimmed copy:
FOLIO_CMP_DIR=/tmp/cmp-fg \
FOLIO_INPUT=/tmp/cmp-fg/staged/book.shimmed.html \
  bun compare/run.ts <field-guide-dir>
# 4. independent readback (poppler only — Folio never grades itself):
python3 compare/ab-report.py <gutterpress.pdf> /tmp/cmp-fg/folio.pdf
```

### The test list, with outcomes (all five completed 2026-08-05)

1. ~~Wire the shimmed input into `compare/run.ts`~~ **done** — `FOLIO_INPUT`
   env var; Gutterpress always builds the original project. Result: drift
   collapsed 1.50× → **1.013×** (see FINAL A/B REPORT below).
2. ~~Chip fidelity~~ **done** — `transform: rotate()` and `box-shadow` are NOT
   supported in margin boxes (probed with unmissable values). Recorded as
   engine limits in [`ENGINE.md`](./ENGINE.md) §8; chips ship square.
3. ~~Brick seam at 300 dpi~~ **done** — seamless across the margin-box/content
   boundary; no per-box `background-position` offsets needed.
4. ~~Named-page parity~~ **done** — mirrored binding gutters verified exact
   under Folio (55/46 pt) and ABSENT under Paged.js (52/53 pt); residual page
   drift is a handful of constant-offset runs, not scattered disagreement.
5. ~~Front-matter folio numbering~~ **done, gap confirmed** —
   `counter-reset: page` does NOT work in native print (`ENGINE.md` §8);
   Folio must synthesize the restart via its counter-style map. **This is the
   one open functional gap.**

### Open questions this A/B cannot answer

- Whether to keep the 1.5× appearance (re-tune tokens) or the authored 12pt
  (accept reflow) — editorial, decided by looking at both.
- Tier-3 build cost on this book (2 × ~200 s). A/B correctness first; the
  optimistic single-pass design is a separate work item.

---

# FINAL A/B REPORT — field guide, shimmed

Both engines on the same staged book with the same assets; Gutterpress on the
original, Folio on the shimmed copy (`FOLIO_INPUT=book.shimmed.html`). All
numbers read back out of the two PDFs with poppler — Folio never grades its own
homework. Regenerate with `python3 compare/ab-report.py <gp.pdf> <folio.pdf>`.

## Headline

| | Gutterpress (Paged.js) | Folio |
| --- | --- | --- |
| pages | **301** | **297** (−1.3%) |
| build | **263 s** | **806 s cold / 815 s warm** |
| PDF | 171.6 MB | 176.9 MB |
| page size | 621.12 × 810 pt | 621 × 810 pt |
| type scale | — | **identical** (4496/4501 words within ±1.2%) |
| mirrored binding gutters | **NO** | **YES** |
| front-matter folio restart | **YES** | **NO** |

**The shim worked.** Page-count divergence collapsed from **1.50× to 1.013×**,
and type is now glyph-identical (median ratio 1.0000). What remains is a real
engine comparison rather than an artefact of scale and dead CSS.

## Pagination agreement

1,477 shared anchor lines. The per-anchor page delta is **not** noise — it
collapses into a handful of long constant runs:

| delta | Gutterpress pages | anchors |
| --- | --- | --- |
| 0 | 1–7 | 70 |
| +1 | 8–10 | 45 |
| +2 | 11–43 | ~390 |
| −4 | 173–301 | ~890 |

A constant delta over hundreds of pages means the two engines are **breaking
identically** and are merely offset — the disagreement is a small number of
discrete page insertions, not a systematic density difference. Only 4.7% of
anchors sit on the *same* page, but that number is misleading in isolation: it
is one offset applied to a long run, not 1,400 independent disagreements.

**Where the offsets come from:**

- **Front matter (pp. 1–11):** Folio runs +2. Gutterpress inserts a blank at
  page 42 that Folio does not (`gp [6, 42, 215, 219, 302]` vs
  `folio [6, 211, 215, 298]`).
- **The card chapter (pp. 44–172):** Folio uses **5 fewer pages** across the
  band (Gutterpress spans pp. 43→173 = 130 pages; Folio 44→169 = 125). This is
  the documented density difference — native fragmentation packs to the same
  `break-inside` rules more tightly. It cannot be localised further by text
  because this band is the Type-3-font card content that `pdftotext` cannot
  recover from **either** PDF.

## Two correctness differences, in opposite directions

**Folio is right: mirrored binding gutters.** The book declares
`@page :left/:right` with `--binding-margin: 0.75in` against a 0.625in outer
edge. Folio applies it exactly — text left edge 55 pt recto vs 46 pt verso, a
9 pt (0.125 in) offset matching the declaration. Gutterpress applies **none**
(52/53 pt either way). Checked against *printed* page parity as well as PDF
parity, because Gutterpress's folio numbering is offset by 5 — the naive
measurement would have been an artefact.

This matters for POD: without the mirror, inner margins are ~0.125 in short on
every other page and text creeps toward the gutter.

**Gutterpress is right: front-matter folio restart.** Gutterpress restarts the
page counter after the front matter (PDF page 7 prints as "2"). Folio's printed
folios are the raw PDF index throughout (page 8 prints "8"). Root cause
measured: `counter-reset: page` on a content element **does not** restart
`counter(page)` in native print (ENGINE.md §8) — Paged.js gets this free
because its counter lives in the DOM. Folio *can* do it — its counter-style map
is an arbitrary per-page symbol list, so `i, ii, 1, 2, 3…` is just a different
list — but it does not today. **This is the one open functional gap.**

## Speed

Folio is **3.1× slower** here (806 s vs 263 s), worse than the 1.6× measured
pre-shim because the shim makes Folio paginate the same ~300-page book instead
of a denser 200-page one. The cause is unchanged and structural: Tier 3 costs
two full print passes, and printing this book is ~1 s/page — of which **~90% is
`filter:`** (measured: 57.0 s → 6.2 s for 60 pages with filters off). Warm is no
faster than cold (815 vs 806 s), confirming browser startup is noise.

Note this cost is shared: the same `filter:` expense is in Gutterpress's 263 s.
Folio simply pays the print twice.

## Not measured

- **Stage B (in-browser pagination).** Paged.js did not finish paginating this
  book in >2 h in an earlier run; this run was stopped before stage B rather
  than repeat that. Folio's viewer paginates the user guide in 0.11 s, but no
  comparable number exists for this book.
- **PDF outline counts** — both PDFs use object streams, so the raw-byte probe
  used here returns 0 for both and proves nothing either way.
- **Visual quality side by side** at print resolution.

## Verdict on the A/B question

With the confounds removed, **the two engines agree on pagination**: same page
count to 1.3%, identical type, and long runs of constant offset rather than
scattered disagreement. Folio is more faithful to the stylesheet on binding
gutters (Paged.js drops `var()` `@page` margins). ~~and the 12 pt the CSS
actually declares~~ — **that half is refuted**: Folio's smaller type on this
book is Chromium shrink-to-fit compression, not fidelity (see the correction
banner and `ENGINE.md` §9). Folio is slower by a factor that is understood and
attributable to one design decision.

The remaining decisions — **since resolved; the authoritative record is
[`MIGRATION.md`](./MIGRATION.md) "Decisions already made"**:

1. **Type size** — DECIDED: the zoom is never shipped; CSS tokens are retuned
   from a proof at true size and the reflow is accepted (Decisions #1–2).
2. **Folio numbering** — Folio must synthesize the front-matter restart. Known
   mechanism, not yet built (MIGRATION.md "Current state of the two known
   Folio gaps").
3. **Build time** — predict-then-verify is the sketched fix; export-only cost
   (`ARCHITECTURE.md` §10).

---

## Why the field guide is slow to print (both engines)

The build cost is not pagination and not the art — it is `filter:`.

Measured over 60 pages of the real book: **57.0 s with filters, 6.2 s without
(9.2×)**. Over the same pages `box-shadow` costs nothing (57.0 s),
`background-image` costs nothing (56.9 s), and hiding every `<img>` changes the
PDF from 41.5 MB to 12.6 MB while leaving the time unchanged. `filter:` is
**~90 % of print time and nothing else is close.**

**Mechanism** (minimal A/B, one card with and without `drop-shadow`): PDF has no
vector filter primitive, so Chromium rasterizes the whole filtered subtree to a
**300 DPI bitmap**. Text inside becomes a picture of text — fonts vanish from
the PDF entirely (1 CID TrueType → none), images appear (0 → 4), size grows
4.2×. Full detail in [`ENGINE.md`](./ENGINE.md) §10.

**This resolves an earlier mystery.** The "168 near-blank pages" and the Type 3
fonts seen in both PDFs were never a layout fault — the card chapters' text is
rasterized, so `pdftotext` cannot read it. Page 100 of the Gutterpress PDF
carries a 2199×1517 @300 DPI image exactly where a text card is authored.

**Three consequences for the book as shipped today** (Paged.js, not Folio —
this is current-pipeline behaviour):

1. Card text is **not selectable, searchable or accessible** in the released PDF.
2. File size is inflated by bitmaps standing in for vector text.
3. Every build pays the rasterization, on both engines.

**Mitigation is authorial.** `box-shadow` is free and stays vector.
`filter: drop-shadow()` is only needed when the shadow must follow a `clip-path`
silhouette instead of the border box. Restricting `filter` to the elements that
truly need it is the largest single build-time win available *and* restores text
extraction. Note the design guide's own comment already documents the
filter+clip-path pairing as deliberate — so this is a scoping exercise, not a
blanket removal.

Do not try to reclaim it with a cheap measurement pass: removing `filter` moves
layout (it creates a containing block — 26 % of words shift), and
`filter: opacity(1)` keeps the containing block but still rasterizes.

## Where Folio's build time actually lands

Folio's 806 s is **two** prints of a ~300-page book whose print cost is
dominated by the above. The second print is not overhead — it is the only print
containing the running heads and cross-references (see
[`ARCHITECTURE.md`](./ARCHITECTURE.md) §10). **And it is export-only:** the
viewer never prints, so the editing loop is unaffected. The available
optimization is predict-then-verify (one print in the good case), not deleting a
pass.

---

## Re-verified on `release/0.10.0`

`release/0.10.0` merged into the spike branch (clean, no conflicts) and the
whole A/B re-run against the 0.10.0 implementation.

**Every number reproduced exactly.**

| | 0.9.0-alpha.2 | 0.10.0-alpha.1 |
| --- | --- | --- |
| Gutterpress pages | 301 | **301** |
| Gutterpress PDF | 171,580,552 B | **171,580,552 B** |
| Folio pages | 297 | **297** |
| Folio PDF | 176,948,509 B | **176,948,509 B** |
| type scale match | 4496/4501 (99.9%) | **4496/4501 (99.9%)** |
| median glyph ratio | 1.0000 | **1.0000** |
| page ratio | 1.013 | **1.013** |
| drift profile | 0, +1, +2 … −4 | **identical** |
| mirrored gutters | folio YES / gp NO | **unchanged** |
| folio numbering | gp restarts / folio doesn't | **unchanged** |

Extracted text is **byte-identical** across versions for *both* engines; only
the PDF creation date differs. Gutterpress build 263 s → 274 s (run-to-run
variance, same machine). Folio's 15 spikes (212 checks), 50 unit tests and
typecheck all pass unchanged on 0.10.0.

**Why nothing moved, verified rather than assumed.** 0.10.0 changes
`markdown-it-paged.js` (+83 lines) and `renderer.ts` (+14), which do alter the
staged HTML — it grows 1,863 KB → 1,960 KB. But the additions are
`data-source-range` / `data-source-line` attributes for the inline editor
(3,425 occurrences), **no CSS selects on them**, and stripping those attributes
makes the two staged files **byte-identical** (0 diff lines). Inert additions,
inert result — which is the outcome to want, but worth confirming given that
"inert" attributes are exactly the trap documented in
[`ARCHITECTURE.md`](./ARCHITECTURE.md) §2, where adding `id`s renumbered every
chapter.

The one thing this run did not capture: Folio's cold/warm timings on 0.10.0
(the run was stopped before the timing line printed, to avoid stage B which has
never completed on this book). The artifact is byte-for-byte the same size and
the same page count, so the work performed was the same.
