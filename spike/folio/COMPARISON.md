# Current Gutterpress (Paged.js) vs the Folio spike — same book, both engines

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

**This is the migration risk, and it is not a Folio defect.** The field guide is
typeset at ~136 % of what its stylesheet specifies, so its `pt` values do not
mean what they say. Adopting Folio would reflow the entire book to 200 pages at
genuinely-12 pt type. Whether the fix is to re-tune the tokens (≈16.4 pt to
preserve today's appearance) or to accept the smaller type is an editorial
decision, not a technical one — but it must be made deliberately, and it is
invisible until something renders the CSS faithfully. The scale originates in
Paged.js's layout, not in the book: no `.pagedjs_*` rule sets `font-size`,
`zoom`, `transform` or `scale`, and Gutterpress prints with explicit
`width`/`height` from the sheet's computed style rather than `preferCSSPageSize`
(`packages/cli/src/lib/pagination.ts`).

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
# 3. full harness against the ORIGINAL for the Gutterpress leg,
#    then Folio against the shimmed copy:
bun compare/run.ts <field-guide-dir>                # gutterpress + unshimmed folio
FOLIO_INPUT=/tmp/cmp-fg/staged/book.shimmed.html    # (wire-up below)
```

The harness does not yet accept a substitute Folio input — that is the first
item below.

### What to test next, in order

1. **Wire the shimmed input into `compare/run.ts`** (an env var or flag that
   substitutes Folio's input file) and run the full A/B. Success metric:
   anchor-line tracking (the 599-anchor method used to find the 1.5× ratio)
   shows page drift collapsing from 1.50× toward 1.0; report residual
   same-page / ±1-page percentages.
2. **Chip fidelity.** Rotation and box-shadow in margin boxes: minimal probes,
   then either use them or record them as engine limits and accept square
   chips. Compare chip crops at 100dpi against the Paged.js render.
3. **Brick seam check at print resolution.** One 300dpi crop across a
   margin-box/content boundary. If seams show, emit per-box
   `background-position` offsets (geometry is known; the checker probe proved
   alignment works).
4. **Named-page parity.** The field guide's `chapter-start`/`full`/`clean`/
   `citizen-file` pages under Folio: verify each gets its geometry and
   suppressions on the same content as Paged.js. This is where the remaining
   page-boundary drift will concentrate.
5. **Front-matter folio numbering.** The book restarts page counters at the
   first body chapter via a counter reset on `.page-chapter-start` — a
   Paged.js-DOM-dependent mechanism. Determine what Folio's counter model
   needs (likely nothing: real `counter-reset` on a content element works in
   native print — probe it).
6. **Only then** judge output quality side by side (density, breaks, chip
   look), because until 1–5 the two engines are not rendering the same book.

### Open questions this A/B cannot answer

- Whether to keep the 1.5× appearance (re-tune tokens) or the authored 12pt
  (accept reflow) — editorial, decided by looking at both.
- Tier-3 build cost on this book (2 × ~200 s). A/B correctness first; the
  optimistic single-pass design is a separate work item.
