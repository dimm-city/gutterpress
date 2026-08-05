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

### F1 — `break-before: right|left|recto|verso` is a plain page break in Chromium (spike `s10`) — **highest risk, not fixed**

Chromium ignores the recto/verso semantics: with `h1 { break-before: right }`,
chapters land wherever they fall (3 pages, CH2 on a verso). Paged.js implements
it correctly (5 pages, blank versos inserted, both chapters on rectos). "Chapters
start on a right-hand page" is table stakes for print books, so this is a
functional regression a swap would introduce.

Also: **`@page :blank` never matches** — Chromium doesn't apply it even to a
page containing only an empty spacer.

Both are shimmable, and s10 verifies the shim: a zero-height spacer with
`break-before/after: page` carrying a generated page name that copies the
author's `:blank` rules reproduces **Paged.js page-for-page**, with genuinely
blank blanks. It needs measurement (which page did the element land on), so it
belongs in the Tier 3 fixpoint. Not implemented yet.

### F2 — the Tier 2 page-renaming machinery is the fragile part of the compiler

Four separate bugs, all found on first contact with a real theme, all fixed:
generated templates dropped the author's non-string `@page` rules; the rename
lost cascade fights and stranded elements (now applied as inline styles);
copying rules verbatim inverted page-selector specificity; running strings
weren't carried across runs. That is a lot of defects in one mechanism.

Worth investigating whether the rename can be **deleted** rather than hardened:
if Chromium ever ships `string-set`, all of it goes away. An interim option is
to reduce it to "one generated page per (page name × run) with a fully resolved
flat declaration block", which is roughly where it landed anyway.

Unverified pieces of it: `@page :blank` variants are emitted but never match
(F1); `:first` combined with a generated name is untested on real content;
`@page` rules inside `@media print` are extracted but the rename path hasn't
been exercised with them.

### F3 — two implementations of "which page does this element belong to"

The viewer (`fragment.ts` `pageNameOf`) matches self-then-descendant; the
compiler (`agent.ts` `pageOf`) matches self-only with a specificity comparison
and reports descendants separately. They already disagree by construction, and
they are the input to both renderers' run splitting. Should be one shared
function with one test suite.

### F4 — `string()` position keywords are only half implemented

The viewer implements `first` / `start` / `last` / `first-except`; the
compiler's Tier 2 carries one literal per run and ignores the keyword entirely.
A document using `string(chapter-title, last)` gets different text on screen and
in print.

### F5 — Tier 2 renames runs onto generated page names, which is a break risk

Every run with a running string gets a *named* page where the author had the
default page. Named-page changes force breaks, so this is only safe because runs
are split exactly at forced breaks. That invariant lives in `agent.ts` and is
not asserted anywhere. Evidence it currently holds: Folio's page count equals
plain Chromium's (61 = 61) on the user guide. It should be a check in `s8`:
Tier 2 must never change the page count relative to Tier 1.

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

## What I'd do next, in order

1. Implement the F1 shim in the compiler (spacer + generated blank page name) —
   it is the one difference that breaks real books, and s10 already proves the
   mechanism.
2. Add the F5 invariant check to `s8` (Tier 2 must not change page count).
3. Unify the run-detection code (F3) and finish `string()` keywords (F4).
4. Fix the small stuff: metadata, object streams (D5/D6).
5. Re-run `compare/run.ts` against a book that uses recto starts and
   `@page :blank` — the user guide does not exercise either.
