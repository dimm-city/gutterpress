# Output differences: current Gutterpress (Paged.js) vs Folio — full inventory

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

### F4 — `string()` position keywords are only half implemented

The viewer implements `first` / `start` / `last` / `first-except`; the
compiler's Tier 2 carries one literal per run and ignores the keyword entirely.
A document using `string(chapter-title, last)` gets different text on screen and
in print.

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

### F11 — instrumentation was visible to the author's CSS — **FIXED**

The measurement pass assigns `id` attributes to the elements it measures. Ids
are not inert: the user-guide theme has `h1[id] { counter-increment: chapter }`,
so measuring the document renumbered every chapter (openers read `03`, `04`
instead of `01`, `02`).

The compiler now removes every id it assigned (and the hidden link container)
before the final print, and compares the page count before and after removal —
if instrumentation moved anything, that is a warning, not a silent difference.
S7's "layout-neutral instrumentation" claim covered page counts, not selector
matching; this is the gap it missed.

### F6 — metadata clobbering (D6) and `useObjectStreams: false` (D5)

Small, contained: the postprocess should preserve an existing Creator/Producer
and re-enable object streams unless a downstream tool needs them off.

### F7 — one drift event per ~200 pages in the viewer (open from `RESULTS.md`)

Unchanged by this pass. Screen-only; the PDF is ground truth.

### F8 — `<tfoot>` reservation on screen (open, documented limit)

The viewer compensates repeated `<thead>` but not `<tfoot>`; it warns instead.

### F9 — density difference is a *behaviour* change, not a defect, but it is visible

Folio produces a 61-page book where the current pipeline produces 64. Anyone
migrating a book with a fixed page budget (POD signatures, printed TOCs) needs
to re-check it. Worth a `--pad-to-signature` reminder in the migration notes;
`folio build --signature N` already exists.

---

## Status after this pass

| | |
| --- | --- |
| **fixed** | D1 (cover full-bleed), F1 (recto/verso + `@page :blank`), F11 (instrumentation ids), F5 (now asserted) |
| **deleted** | F2 (page renaming), F3 (duplicate run detection) |
| **worked around** | F10 (cross-stylesheet `@page` cascade) |
| **open** | F4 (`string()` keywords in the compiler), F6 (metadata/object streams), F7 (viewer drift at ~200pp), F8 (`<tfoot>`), F9 (density is a migration consideration) |

The compile path costs one more print pass than before (0.9 s → 2.2 s warm on a
61-page book, against 5.5 s for the current pipeline) and 342 fewer lines of
compiler.

## What I'd do next, in order

1. Finish `string()` position keywords in the compiler (F4) — the viewer already
   has them.
2. Fix the small stuff: metadata preservation, object streams (D5/D6).
3. Run `compare/run.ts` against a book that actually uses recto starts and
   `@page :blank` end to end — s10 covers the mechanism, but no real project in
   this repo exercises it.
4. Report F10 upstream, and keep the resolved-context emission either way.
