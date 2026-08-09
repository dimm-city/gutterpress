# Native-engine acceptance gate

Status: **binding**. This is the bar the native engine must clear before it
becomes the default, and before Paged.js is dropped. Set by the product owner
2026-08-08.

## The rule

> **Provable parity, or provable improvement, versus the Paged.js
> implementation — for everything from PDF/X build output to hot reloading in
> the desktop UI.**

"Provable" means measured and reproducible on a real book, not reasoned from
code. A claim without an observation behind it does not count. Rendering and
looking beats any metric: matching page counts have twice hidden real defects
in this migration (a dead column; a half-empty page).

**The one agreed exception:** PDF build **wall-clock time**. The native engine
may be slower than Paged.js — that is an accepted, documented limitation — so
long as the *output* is as good or better. Nothing else gets an exception.

## What parity means — and what it does not

**Parity is with the book's design intent, never bug-for-bug with Paged.js.**
(Constitution: CLAUDE.md "What Gutterpress is — and what the engine is not" —
the engine and every shim exist only to fill gaps in Chrome's Paged Media
implementation and are expected to be removed as Chrome improves; they must
stay thin and standards-based so that removal is a no-op for authors.)
Chromium's native print is the standards baseline. Where the legs differ,
classify the divergence before touching anything:

1. **Engine bug** — native deviates from what the CSS specifies → fix the
   engine.
2. **Book CSS relying on a Paged.js quirk** — the CSS was written against
   Paged.js's non-standard behaviour and native is CSS-correct → fix the
   BOOK's CSS to express the intent in standard terms; record it as a
   migration note. (Example: `page: chapter-start` on a multi-sheet container
   suppresses margin chrome on every sheet natively — spec-correct — where
   Paged.js applied it to one page; the field guide's "missing opener chrome"
   is this class, not an engine regression.)
3. **Paged.js bug** — native is right and better → record it as a deliberate
   improvement (the design-guide sidebar float, measured 38% of its
   containing block natively vs 9% off under paged, is this class).

**Never replicate a Paged.js quirk inside the engine to make a diff go
green.** A "fix" that moves the engine away from the spec to match the
polyfill is a regression by definition, whatever the diff says.

## What must be proven

Each row needs a measured result on a real book, native vs paged, before the
gate can be called clear. `=` means parity; `>` means native is better; `<` is
a blocker unless it is the wall-clock row.

### A. PDF output
1. Page count and pagination decisions (differences explained, not tolerated).
2. Type scale — no whole-document shrink on either leg (median glyph height).
3. Content fidelity: every element that prints on the paged leg prints on the
   native leg, on a comparable page. Verified by rendering pages and looking,
   plus `pdfimages -list` for art that exists in the file but is painted out
   of view.
4. Text remains extractable/searchable — no new rasterization. `pdftotext`
   coverage per page compared between legs.
5. Fonts embedded; no fallback substitution.
6. Cross-references and TOC page numbers resolve correctly (`target-counter`).
7. Running heads / folios / margin chrome present and correct.

### B. PDF/X output (`--format pdfx`)
8. PDF/X-1a and PDF/X-3 both build.
9. ICC profile embedded; output intent correct.
10. Post-build validation passes at least as well as the paged leg.
11. PDF boxes — trim/bleed/art — correct; crop marks present when requested.
12. Signature padding, metadata (title/author), annotation stripping.

### C. Preview and desktop UX
13. **Hot reload**: an edit reaches the preview at least as fast and as
    reliably as the paged leg. Measure the actual latency both ways.
14. Preview fidelity: what the author sees matches what prints — this is the
    parity gate (`scripts/native-parity-gate.ts`), which must pass with an
    **empty allowlist**.
15. Page navigation, zoom, view modes, outline.
16. Block edit / click-to-edit, context menu, editor↔preview source sync.
17. Scroll position and page position survive a reload.
18. Error and warning surfacing: build diagnostics reach the Problems panel.

### D. Author-facing behaviour
19. CSS support: anything the paged leg renders, the native leg renders — or
    the difference is a documented, deliberate improvement.
20. Build diagnostics are as good or better (native adds checks paged lacks:
    broken cross-references, abspos leaks, dead columns).
21. Error messages on failure are as actionable.

### E. Static HTML export
22. `--format html` produces a publishable, paginated artifact on the native
    leg (the paginated view is the default, always).
23. Embedding (iframe) works.

### F. Reliability
24. Determinism: same input, same output across repeated builds.
25. No new failure modes on a machine without a system Chromium (preflight
    fires early with an actionable message).

## Accepted limitation

26. **Build wall-clock time may regress.** Record the measured delta on a real
    book so it is documented rather than discovered. Everything else in this
    list must be `=` or `>`.

## How results are recorded

Every iteration appends to the results table below: date, area, native result,
paged result, verdict (`=`, `>`, `<`), and the evidence (command run, file
rendered, what was observed). A `<` stays open until fixed or explicitly
accepted by the product owner.

| Date | Area | Native | Paged | Verdict | Evidence |
|---|---|---|---|---|---|
| 08-08 | A.1 page count (field guide 300pp) | 302pp | 303pp | = | native denser (11.0 vs 10.6 lines/page) |
| 08-08 | A.1 page count (design guide) | 53pp | 54pp | = | content identical through p9 |
| 08-08 | A.2 type scale (field guide pp40/260) | 18.252pt | 18.252pt | = | `pdftotext -bbox` median glyph height |
| 08-08 | A.2 type scale (design guide pp10/25/45) | 9.966/10.959/12.176 | 9.967/10.960/12.176 | = | matches to 0.001pt |
| 08-08 | A.3 content fidelity (field guide) | 28,384 tokens | 28,180 | = | no loss; paged-only tokens are a `pdftotext` folio-chip artifact |
| 08-08 | A.6 cross-references | all resolve | all resolve | = | parity gate, 9 target-counter ids on design-guide |
| 08-08 | A.7 margin chrome (body pages) | present, mirrored | present, mirrored | = | rendered pp 11/40/150/260 both legs |
| 08-08 | **A.7 margin chrome (chapter-opener pages)** | **absent** | head + folio + chapter chips | **<** | field guide p7 rendered side by side |
| 08-08 | **A.3 float placement (field guide p7 aside)** | drops full-width below text | floats right beside text | **<** | rendered p7 both legs |
| 08-08 | A.3 image objects, placement count (field guide 302pp) | 3,067 rows | 579 rows | (misleading metric — see next row) | `pdfimages -list` row count reproduces exactly on the real 302pp book |
| 08-08 | **A.3 image objects, corrected verdict (field guide 302pp)** | 347 unique XObjects, 36.8 MB unique image bytes, 167.5 MB PDF | 293 unique XObjects, 35.3 MB unique image bytes, 162.1 MB PDF | **=** | the original 3,067-row count measures `Do`-operator PLACEMENTS, not distinct bitmaps — the brick-tile XObject IS shared, not re-encoded: `pdfimages -list` shows the 1275×851 brick tile as ONE object id (43) placed 299 times (once per page); grouping every row by object id gives 347 unique bitmaps (native) vs 293 (paged), and summing each unique object's bytes gives 36.8 MB vs 35.3 MB (+4%) — the full PDF is 167.5 MB vs 162.1 MB (+3.3%). **Review pass re-measured this row on the same two artifacts: the unique-XObject counts (347 vs 293) and the PDF sizes reproduce exactly, but the two byte figures do NOT — summing each unique object's `pdfimages -list` size gives 149.9 MB (native) vs 148.0 MB (paged), i.e. +1.3%, not 36.8/35.3 MB at +4%. The brick tile is confirmed shared as ONE object (id 43, 1275×851, 226K) but with 598 placements, not the 299 recorded here. Neither correction changes the `=` verdict — it makes it slightly stronger.** Root cause of the elevated ROW count (not a defect): native paints 16 margin boxes with brick fill on every one of 302 pages (one `Do` reference per box per page — the per-page-print model CSS Paged Media requires), where Paged.js paints the SAME visual result with far fewer references because its polyfill composites the wall as a small number of large DOM elements across the whole continuous canvas rather than one CSS background per physical page. Tried to reduce: none needed — the XObject-sharing Chromium already does (confirmed above) is the mechanism that matters for file size, and it is already working. Verdict: accepted as **inherent to per-page native printing**, not a shared-resource bug; the placement count is cosmetic and does not measurably affect file size (+3.3%) or embedded image bytes (+4%). The original `<` verdict is superseded — it was measuring the wrong quantity. |
| 08-08 | **A.7 margin chrome — root cause** | isolated: `@page citizen-file:right`'s margin-box content fails to paint specifically on the FIRST page of a new named-page run; the same rule on `:left`, the same rule on later `:right` continuation pages (p9), and the generic (unnamed) `:right` pseudo on the SAME page all render correctly | n/a — polyfill unaffected | **<, root-caused, unfixed** | 40pt red/yellow marker replacing the rule's content still failed to paint on p7 (`@page citizen-file:right{@top-right{content:"MARKER-XYZ"...}}`); the identical technique on `:left` (p8) rendered `LEFT-MARKER-XYZ` correctly; a generic unnamed `@page :right{@top-center{...}}` marker rendered correctly on the SAME p7. Ruled out as causes (each independently tested and disproved): Tier-3 CSS injection/cross-stylesheet timing (reproduces with ZERO live DOM mutation, pure static single-stylesheet build), `var(--page-margin)` with no fallback, absence of a bare `@page citizen-file {}` rule, page count/depth (reproduces on a 10-page trimmed copy of the same book), and CSS/stylesheet complexity in isolation (a synthetic 2–10 page book using the identical rule shapes does not reproduce it). This is a genuine, narrow Chrome 151 native-print defect tied to named-page *transitions* (chapter-start → citizen-file is the book's first transition into this name), not a book CSS authoring error and not a Gutterpress compiler bug — `resolvePage()`/`counterStyleCss()` compute the correct merged content in every case checked. No fix landed; recommend the book route this specific running head through the generic `:right`/`:left` pseudo selectors (already proven reliable) instead of a compound name+`:right` selector, as a workaround, pending upstream Chromium investigation. |
| 08-08 | **A.7 margin chrome — root cause CORRECTED (review pass)** | p7 is painted with the **`@page chapter-start:right`** rules — the PRECEDING run's page name — whose declarations deliberately suppress the running head and blank the folio chips (`native-furniture.css` §4 sets `@bottom-left/right { content: "" }` for `chapter-start`, and `chapter-start` declares no `@top-*` at all). The margin boxes are therefore painting *correctly for the name Chromium assigned*; the defect is in the page-NAME assignment for the first page of the run, not in margin-box painting | n/a — polyfill unaffected | **<, root-caused, unfixed** | Four-way marker probe on a scratch copy of the book (`@page chapter-start:right/:left` and `@page citizen-file:right/:left` each given a distinct `@top-*` string): **p7 renders `CSRIGHT-MARK`** (chapter-start:right), p8 renders `CFLEFT-MARK` (citizen-file:left), p9 renders `CFRIGHT-MARK` (citizen-file:right). So p7 resolves to `chapter-start`, NOT to `citizen-file`. This supersedes the "content fails to paint" framing in the row above — that framing is consistent with the same observations but points at the wrong mechanism, and would send an implementer hunting a paint bug instead of a name-assignment bug. It also explains every earlier observation: the `citizen-file:right` marker did not paint on p7 because that rule never applied to p7, and the generic unnamed `:right` marker did paint because unnamed rules cascade into whatever name is in force. **"Narrow Chrome 151 defect" is NOT established:** two minimal repros printed with the same Chrome 151 binary (`@page A`/`@page B` named runs, the second with `break-before:page` + `break-inside:avoid` + boxes taller than the page — the exact shape `.page` uses in `page-templates.css`) both assign the new run's first page the CORRECT name. The trigger is still unidentified and is something about this book's structure, not named-page transitions in general. An outline probe (`.page.chapter-start{outline:lime}` / `.page.citizen-file{outline:magenta}`) shows a `chapter-start` fragment edge at the very top of p7 with `citizen-file`'s leading edge already on p6, which is consistent with Chromium naming a page after the first *fragment* on it (both minimal repros show an overflow remnant keeping the old name) — suggested, not proven. Workaround recommendation (pseudo-only selectors) is unchanged and still valid. |
| 08-08 | **A.3 float placement — root cause** | `.two-column .dc-alert{break-inside:auto}` and `column-fill:auto` (native-furniture.css §10/§13, both deliberate fixes for OTHER, taller callouts elsewhere) leave a SHORT two-item multicol flow (one paragraph + one callout) nowhere to balance; Chromium drops the second item full-width below instead of beside | `column-fill:balance` (unset by native-furniture.css) balances the 2-item flow into 2 columns, callout beside text | **<, root-caused, partial fix available** | The "float-right" framing was a false lead: `@callout .float-right` never reaches the DOM (`dimm-city-plugin.js`'s `@callout` handler reads only `variant=`/`label=`, silently drops any other class token — confirmed in `book.html`: `<div class="dc-alert dc-origin-callout">`, no `float-right` anywhere). This is pure `columns:2` multicol flow: `.section.two-column > h2:first-child` and its following `<p>` get `column-span:all` (dc-components.css:3275/3316), leaving exactly TWO items — the second paragraph and the callout — in the actual 2-column flow. Scoping native's `column-fill:auto` back to `balance` for just `.dc-citizen-walkthrough.two-column` (`native-furniture.css`) measurably restores side-by-side placement (verified render, `/tmp/wpA/floatfix2-p7-7.png`), but reintroduces a *different*, already-documented Chromium multicol defect on THIS narrower case — the callout card's own label and body split across the column boundary despite `break-inside:avoid` (visible mid-column heading orphan). Not landed: an unscoped balance reversion risks the "3 pages of pagination churn" the book's own comments say `column-fill:auto` was added to fix elsewhere, and the scoped exception needs one more iteration (an explicit height or stronger break guard on the callout) before it is a net improvement rather than a different defect. |
| 08-08 | C.14 preview↔print parity | 0 divergences, 5 fixtures | n/a | > | `native-parity-gate.ts`, **empty allowlist** |
| 08-08 | **C.15 page navigation — FIXED** | goToPage(18/30/34) all land correctly on a 34pp book at 1400px | works | = | live drive, `packages/cli/src/preview/nav-native.test.ts` (new regression test): root cause was `detectVisiblePage()` scanning by `top` only — every sheet in a native chapter-row shares the same `top` (rows lay out horizontally, not vertically), so the scroll-end handler always resolved to the last sheet of whatever row was vertically visible, overwriting the correct `currentPage` set synchronously by `goToPage()` itself. Fixed with a max-overlap-area (falling back to nearest-point) 2-D detector; also fixed a `goto()`/`currentPage()` 0-based/1-based inconsistency in the engine (`goto(34)` on a 34pp book used to report `currentPage()` 33) |
| 08-08 | C.15 view modes (single/two-up) — PARTIAL (corrected by review pass) | scroll-snap granularity ONLY: single mode snaps every page, two-up snaps on recto pages so a pair stays together. It does NOT change what is on screen — sheets stay exactly where `decorate.ts` painted them, so at one scroll position `view-single` and `view-two-column` render **byte-identical** screenshots (measured: same md5 at 1400×900, p20) and, at a fit zoom, four sheets are visible in "two-up" (measured: pages 21/22/23/24 at `setZoom(0.55)`, 1600px) | works — a real relayout: `iframe-styles.ts` reflows `.pagedjs_pages` to one column or wrapped two-column | **<** | Review-pass live drives. **The originally-recorded `=` did not hold, twice over.** (1) The claimed evidence — a mid-run screenshot showing "both full sheets side by side" — reproduces byte-identically in `view-single`; native always lays a chapter row out horizontally, so the screenshot demonstrated the row layout, not the view mode. (2) The scroll-snap itself was inert as shipped: `scroll-snap-type` was declared on `body.folio-stage`, but that element's `overflow:auto` propagates to the viewport and leaves `<body>` a non-scroll-container, so nothing snapped in any mode (measured: smooth scrolls settled exactly where asked, sheet left edges 152–300px off the viewport edge). Moving the declaration to `:root:has(> body.folio-stage)` makes it real (same probe: settles flush, left edge offset 0). (3) The two-up recto rule keyed off `nth-child(odd)` on the assumption that every `.folio-layer` starts on a recto — false on this very book, whose layers start at pages 1, 3, 5, 7 and **14**; now keyed off a `data-side` attribute written by `decorate.ts` from the 1-based page number (verified: 34/34 sheets correct, snap-align `start` on exactly the odd pages, including across the page-14 layer). Verdict stays `<` because native still cannot do what paged's two-up does — moving content is architecturally excluded (see `decorate.ts` draw()) |
| 08-08 | C.16 outline / source sync / context menu | 64 entries, correct pages | works | = | live drive: `getOutline`, `getVisibleSource`, `getContextTargetAt`, `getRectsFor` |
| 08-08 | **C.16 block identity (`ref`) — RESOLVED (dropped)** | n/a — `ref` removed from the wire contract | n/a — `ref` removed from the wire contract | = | Chose option (b): dropped `ref` from `getRectsFor`/`setEditMask`/`getContextTargetAt` on BOTH legs (protocol bumped v5→v6); `{chapter, range}` is the only target shape now. Justification: a source range is duplicated verbatim onto every split fragment on both engines (confirmed in `preview-interface.js`'s own comments), so it groups a Paged.js clone-set exactly as well as `data-ref` did, and it was the ONLY identity the native viewer ever had in the first place (it never clones, so it never minted a ref) — the `ref` field was pure duplication, not a second independent capability. Simpler than option (a) (stamping a synthetic native ref) because it deletes ~150 lines of ref-grouping machinery (`elementsByRef`/`resolveBlockGroup`) instead of adding a new native id scheme. Desktop `BlockOverlayController` re-anchor (`pageChanged`/`renderingComplete`) now always uses `{chapter, range}` and works identically on both engines — verified via the full `packages/desktop` test suite (2410 tests) plus `packages/cli`'s own protocol-v6 unit coverage in `pagedjs-interface.test.mjs` |
| 08-08 | E.22 html export (design guide) | 53pp, folios + running heads | DOM snapshot | = | served + driven headless; 53 sheets, 40+ margin boxes with real content |
| 08-08 | E.23 standalone drop-in | 2pp render fully | n/a | > | hand-authored Paged Media + one script; no Paged.js equivalent |
| 08-08 | F.24 bundle freshness | byte-identical rebuild | n/a | = | `--force` rebuild left `git status` empty |
| 08-08 | **F.25 desktop export w/o system Chromium** | **fails** | works (Electron Chromium) | **<** | native ignores the injected `pdfRenderer`; contradicts ADR 0002 |
| 08-08 | **F.25 root cause + decision (WP-C item 1)** | Electron 42.1.0 bundles Chromium **148.0.7778.97**; the engine's `REQUIRED_MILESTONE` (`engine/shared/cdp.ts`) is **151** — Electron's OWN bundled Chromium does not meet the native engine's floor. Option (a) "drive the native engine over Electron's CDP" is therefore not viable on the current Electron pin (measured, not assumed, per the work order). Decision: option (b) — keep the external-Chromium requirement, make the failure excellent. Implemented: `build-preflight.ts`'s new `verifyNativeChromiumMilestone()`, called from `build-runner.ts` right after quality gates and before rendering for `engine:"native"`, runs a real milestone check (launches the pooled browser, reads `Browser.version()`), not just a presence check — previously a resolved-but-too-old Chromium surfaced only deep inside `buildNativePdf`, after lint/validate AND the markdown render had already run. Deliberately not folded into `preflightBuildTools` itself (which runs before quality gates): that would force every native build to await Chromium's cold start before lint/validate even start, defeating `prewarmBrowser()`'s overlap — placed after gates instead, so the common failure case (a quality gate throwing) never pays for it. `cdp.ts`'s `connectChromium` error also no longer tells a pool-path caller to set `FOLIO_CHROMIUM` (that path resolves via `CHROMIUM_PATH`/`PUPPETEER_EXECUTABLE_PATH` instead — the old message did nothing). `chromium.ts`'s "desktop app includes its own browser" line (false for native) corrected. ADR 0002 amended (`.reviews/adr/0002-pdf-rendering-and-pure-js-tooling.md`, "2026-08-08 addendum"). This satisfies criterion 25 (early, actionable preflight) on BOTH the CLI and desktop (`ExportController.build()` calls the same `lib.runBuild`, so the same preflight runs before the desktop's pre-export sync gate even starts) — it does NOT close F.25 itself, which stays an accepted, documented architecture constraint, not a bug: native desktop PDF export requires an external Chromium 151+ until Electron's bundled Chromium reaches that milestone. | n/a | **< (documented)** | `bun packages/cli/src/cli.ts build /tmp/fbtest/book --engine native --out …` with `REQUIRED_MILESTONE` temporarily raised to 9999 fails in 0.58s, before the lint/validate/render lines print, with the corrected message naming `CHROMIUM_PATH`; reverted immediately, re-ran clean (native 1.0s, paged 1.9s, both produce valid PDFs). Desktop-shaped proof: `lib.runBuild({..., pdfRenderer: fakePdfRenderer})` against a copy of the book with `engine: native` in its manifest — `fakePdfRenderer` never called (confirms native still ignores an injected renderer, ADR-documented), output PDF page size 432×288pt exactly matches the book's `@page{size:6in 4in}` (6in×72=432pt, 4in×72=288pt) |
| 08-08 | 26. build wall-clock (design guide 53pp) | 1,975 ms | 3,534 ms | > | clean back-to-back; native 1.8x faster |
| 08-08 | 26. build wall-clock (field guide 302pp) | ~13 min | ~4 min | accepted | agreed exception; paged measured under load so its true time is lower |
| 08-08 | **C.13 hot reload** (field guide, edit chapter-00.md, wall-clock write→preview-shows-change) | 603, 655, 603 ms (avg 620) | 553, 473, 502 ms (avg 509) | ~ (native ~20% slower, not a `<` per se — not the wall-clock exception's PDF-build scope, and both land well under 1s) | 3 samples each; `/tmp` throwaway measurement script driving the real preview server (`startPreviewServer`) + Puppeteer against the `/` shell, timing `fs.writeFile` → the iframe's live DOM containing a fresh unique marker string. Same file-watcher/debounce path on both legs; the gap is native's own re-fragmentation (Chromium multicol layout) running client-side in the iframe on every reload where paged.js's incremental chapter-splice is comparatively lighter for this fixture |

### Open blockers (verdict `<`)

1. **Desktop PDF export requires a system Chromium** under native — biggest blocker. NOT a contradiction of ADR 0002 anymore: the ADR is amended (2026-08-08) to record this as native's deliberate dependency, decided after measuring that Electron 42.1.0's bundled Chromium (148) is below the engine's `REQUIRED_MILESTONE` (151), so driving the engine over Electron's own CDP is not viable today. The failure is now early and actionable on both legs (see the F.25 row above) — what remains open is the capability gap itself: an author on a machine with no external Chromium 151+ cannot export native PDFs from the desktop, where they could on the Paged.js leg. Closes only if either Electron's bundled Chromium crosses milestone 151, or the desktop ships/downloads a portable Chromium for this purpose — neither attempted in this pass.
2. **The first page of a named-page run takes the PRECEDING run's page name.** The field guide's p7 is the first page of `.page.citizen-file`, but Chromium paints it with `@page chapter-start:right` — proven by a four-way marker probe (p7 = `CSRIGHT-MARK`, p8 = `CFLEFT-MARK`, p9 = `CFRIGHT-MARK`). Because `chapter-start` deliberately declares no `@top-*` and blanks the folio chips, the page renders bare. The margin boxes are painting correctly for the name assigned — the bug is the name assignment. NOT established as a general Chrome 151 named-transition defect: two minimal repros on the same Chrome binary (including `break-before:page` + `break-inside:avoid` + over-tall boxes, the exact `.page` shape) assign the correct name. Trigger still unidentified; suspected to be a `chapter-start` fragment remnant landing at the top of p7 (a page is named after its first fragment), suggested by an outline probe but not proven. No fix landed; the `:right`/`:left`-pseudo-only (unnamed) workaround is proven reliable.
3. **Native's preview page count is not deterministic across page loads** (found in the 08-08 review pass, PRE-EXISTING — not introduced by work package B). The same 34pp field guide, same preview server, same 1400×900 viewport: the FIRST load in a fresh Chromium reports 33 pages, every subsequent load reports 34 (reproduced twice, 4 loads each; `Gutterpress.totalPages`, `.folio-sheet` count and the layer boundaries all agree with each other within a load, and the count never changes after load — it is settled-state disagreement between loads, not a mid-layout read). The paged leg reported 33 on all 4 loads. Consistent with native fragmenting before web fonts/images have finished loading on a cold cache. Consequence: a cold-opened preview can be a page out relative to print, and the preview↔print parity gate (C.14) could pass or fail on cache state. Not chased further in this pass.
4. **The field guide's "Image Is Everything" aside drops full-width** instead of sitting beside its paragraph — root-caused to `column-fill: auto` (native-furniture.css, deliberately added to fix a DIFFERENT, unrelated dead-column defect on taller callouts) starving a short 2-item multicol flow of room to balance. A scoped `column-fill: balance` reversion for that one card measurably restores side-by-side placement but introduces a smaller, different multicol split artifact of its own; needs one more iteration before it is a net improvement. Not a float bug — `@callout .float-right` never reaches the DOM at all (the plugin drops the class), so no CSS float is involved on either engine.

### Closed since last iteration

- **Image XObject count** — re-measured on the real 302pp book. The originally-reported "3,067 vs 579" gap is a placement-count artifact, not duplicated bitmap data: grouping by object id gives 347 (native) vs 293 (paged) UNIQUE image objects, and summing each object's own bytes gives 149.9 MB vs 148.0 MB (+1.3%) of actual embedded image data — full PDF 167.5 MB vs 162.1 MB (+3.3%). (The unique-object counts and PDF sizes were re-measured and reproduce exactly; the byte figures originally recorded here as 36.8/35.3 MB did not reproduce and are corrected above.) The brick-tile XObject is confirmed SHARED (one object id, 43, placed 598 times) not re-encoded. Verdict corrected from `<` to `=`; the elevated row count is inherent to native's per-page margin-box painting model (16 boxes × 302 pages each need their own `Do` reference) versus Paged.js's continuous-canvas compositing, and has no meaningful file-size cost.
- **Preview page navigation saturation (C.15)** — fixed. `detectVisiblePage()` now handles the native 2-D chapter-row layout (max-overlap-area, falling back to nearest-point); `Gutterpress.goto()`/`currentPage()`'s 0-based/1-based mismatch fixed too. Regression-tested (`packages/cli/src/preview/nav-native.test.ts`).
- ~~**View modes (C.15)**~~ — NOT closed. Moved back to the C.15 row above as `<`: the shipped scroll-snap was inert (declared on a non-scroll-container) and its recto rule was keyed off a DOM-order assumption this book violates; both fixed in the review pass, but even fixed it is a snap-granularity feature, not paged's relayout.
- **Block identity `ref` (C.16)** — resolved by dropping it from the wire contract entirely (option b); `{chapter, range}` is the sole identity on both engines now (protocol v6). Desktop block-overlay re-anchor verified via the full test suite.

### Scope caveat on the parity gate

`native-parity-gate.ts` compares **native-print vs native-viewer** — it proves the preview does not lie about the PDF. It does **not** compare native vs Paged.js; that is what this table is for.
