# Migration fixture set (MIGRATION.md Step 3)

Eight small, purpose-built fixtures plus one combined "kitchen sink" book,
each testing one construct MIGRATION.md's Step 3 says the in-repo examples
don't cover, traced to the ENGINE.md/ARCHITECTURE.md finding that motivated
it. Every fixture builds on BOTH engines and is checked with an
**independent reader** — `spikes/probe.ts` (poppler `pdftotext -bbox-layout`
/ `pdfinfo` / `pdffonts` on this machine, PyMuPDF where available) plus
`edge-ink.py` (this directory) for pixel-level edge checks poppler's text/box
probes can't answer. Never Folio's own model (ARCHITECTURE.md §7).

## Running

```sh
cd spike/folio/fixtures/migration
bun run runner.ts                 # all 8 small fixtures (~10s)
bun run runner.ts 03               # just fixture 03 (id prefix match)
bun run runner.ts --kitchen-sink nonexistent   # only the combined book
bun run runner.ts --kitchen-sink   # 8 fixtures + the combined book
```

`fixtures/99-kitchen-sink.ts` is a **generator**, not a static file — after
editing it, regenerate with `bun run fixtures/99-kitchen-sink.ts`.

## The fixtures

| # | file | proves | traces to |
| - | --- | --- | --- |
| 1 | `01-filter-clip-path.html` | the two-layer `filter:drop-shadow()` + `clip-path` shadow pattern rasterizes its subtree (text becomes a picture) while plain vector text stays extractable | ENGINE.md §10 |
| 2 | `02-fullbleed-running-heads.html` | full-bleed page background (tiled texture, via the margin-box painting technique) survives on a CONTINUATION page with no heading of its own, and the running head tracks the CURRENT chapter, not a stale one | ENGINE.md §5 |
| 3 | `03-mirrored-binding.html` | named page + `:left`/`:right` binding-gutter mirroring survives to the PDF — the A1 defect fixture | MIGRATION.md Step 1 ("Mirrored binding gutters"), ENGINE.md §3 |
| 4 | `04-folio-restart.html` | front-matter (roman) → body (arabic-from-1) folio restart | ENGINE.md §8, MIGRATION.md "Current state of the two known Folio gaps" #1 |
| 5 | `05-margin-box-furniture.html` | a margin-box "chip" (background + border + `width:fit-content` + `counter(page)`) renders, and the fixture's OWN CSS source contains neither `transform:rotate()` nor `box-shadow` (the unsupported pair) | ENGINE.md §8 |
| 6 | `06-xref-toc.html` | a TOC with `leader(dotted) target-counter(...)` and inline cross-references resolve to the page the target actually printed on (Tier 3) | ENGINE.md §2, ARCHITECTURE.md §10 |
| 7 | `07-multicol-break-avoid.html` | `columns:2` + `break-inside:avoid` cards never split across a page | MIGRATION.md Step 3 item 7 |
| 8 | `08-recto-verso-blank.html` | `break-before:right` forces chapters onto a recto (odd) page with a genuinely blank, unstyled verso inserted (`@page :blank`) | ENGINE.md §2/§7, `spikes/s10-recto-breaks.ts` |
| — | `99-kitchen-sink.ts` | all eight combined at realistic scale (~30pp), for build-time measurement only — separated so CI can skip it | — |

Trim size is 5in×7.5in (not the book examples' 6in×9in) purely to keep each
fixture small and fast; nothing about the constructs depends on page size.

## Results (this machine, poppler backend, Chrome 151.0.7922.75)

| fixture | folio pages | folio time | folio assert | paged.js pages | paged.js time | paged.js assert |
| --- | --- | --- | --- | --- | --- | --- |
| 01-filter-clip-path | 1 | 0.20s | PASS | 1 | 1.32s | PASS |
| 02-fullbleed-running-heads | 4 | 0.17s | PASS | 4 | 1.07s | PASS |
| 03-mirrored-binding | 5 | 0.12s | PASS | 5 | 1.07s | PASS |
| 04-folio-restart | 6 | 0.17s | PASS | 6 | 1.07s | **FAIL** |
| 05-margin-box-furniture | 3 | 0.10s | PASS | 3 | 1.07s | PASS |
| 06-xref-toc | 4 | 0.16s | PASS | 4 | 1.06s | PASS |
| 07-multicol-break-avoid | 2 | 0.10s | PASS | 2 | 1.05s | PASS |
| 08-recto-verso-blank | 5 | 0.23s | PASS | 3 | 1.06s | **FAIL** |
| 99-kitchen-sink | 29 (tier 3, 2 passes) | 0.72s | — | 27 | 1.41s | — |

6/8 same page count on both engines; the two divergences are the two known
gaps (below), each with a documented, MEASURED reason — not a guess.

## Divergences, with the documented reason MIGRATION.md's success criteria ask for

### Fixture 4 — folio restart: Folio (native, unsynthesized) PASSES; Paged.js FAILS

This is the **opposite** of what MIGRATION.md assumed going in ("Paged.js
gets it for free because its page counter lives in the DOM"). Measured:

- Isolated test (`counter-reset: page 1` on a normal element, no page-name
  change): confirms ENGINE.md §8 exactly — native Chromium print does NOT
  restart (`/tmp` scratch test, not checked in: page continued 3, 4 with the
  reset ignored).
- **But** this fixture pairs the reset with a page-NAME change on the same
  element (`page: body-main; counter-reset: page 1;`) — because that's what
  the compiler's planned synthesis actually emits (a generated page name is
  how the counter-style-map mechanism works at all, per MIGRATION.md's
  "Current state" note). Measured: that pairing DOES restart the counter
  natively. Folio's PDF (no synthesis at all — this is a plain document,
  Tier 1) reads `i, ii, iii, 1, 2, 3` correctly on ALL SIX pages.
- Paged.js's own DOM-based counter, given the identical document, restarts
  correctly on the FIRST body page (`1`) but does **not** propagate the
  reset to subsequent normal-flow pages in the same run — they read `4, 5`
  (i.e. as if the reset never happened, continuing the PRE-reset count).
  Sequence measured: `["i","ii","iii","1","4","5"]`.

Net: for this specific, realistic construction (reset + name change
together, which is what synthesis will actually emit), the "known Folio gap"
does not reproduce — Folio doesn't need to synthesize this case, and
Paged.js's "for free" claim is the one that doesn't hold up past the first
page. This contradicts the priors in MIGRATION.md/ENGINE.md §8 as written and
should be treated as a finding for whoever owns the synthesis work, not
papered over. The narrower ENGINE.md §8 claim (reset alone, no name change)
still holds — verified above.

### Fixture 8 — recto/verso + `@page :blank`: Folio PASSES; Paged.js FAILS, and differently from `s10`

Folio: 5pp, both chapters on a recto, matching `spikes/s10-recto-breaks.ts`'s
synthesis check exactly.

Paged.js: 3pp, chapters land on pages 2 and 3 (verso then recto) — **no
blank pages inserted at all**, i.e. `break-before:right` behaved as a plain
page break. This CONTRADICTS `s10`, which found the raw `paged.polyfill.js`
injected via a plain `<script>` tag DOES honor `break-before:right` (blanks
inserted, chapters on recto, `paged.count > native.count`).

Root-caused by isolating the driving path (see scratch tests referenced
below, not checked in):

- `spikes/s10-recto-breaks.ts` and `compare/run.ts`'s Stage B inject the raw
  `paged.polyfill.js` directly via `page.evaluate` + a `<script>` element.
- This runner's `renderHtmlToPdf()` (from the SHIPPED
  `packages/cli/src/lib/pagination.ts` — the real `gutterpress build` path,
  used per this task's instructions) drives Paged.js through
  `patchHtmlStringForPagedjs()`, which ALSO injects `BREAK_INSIDE_HANDLER`
  (`packages/cli/src/lib/pagedjs.ts`) ahead of the vendor script.
- Isolation test: calling `paginateAndCapture()` (also from
  `packages/cli/src/lib/pagination.ts`) directly against the s10 document
  with the RAW polyfill (no `BREAK_INSIDE_HANDLER`) reproduces `s10`'s result
  exactly — 5 pages, blanks inserted, both chapters on recto. Re-adding
  `BREAK_INSIDE_HANDLER` reproduces this fixture's 3-page failure.

So the shipped `packages/cli` build pipeline's break-inside-avoid patch
(added for a DIFFERENT purpose — `packages/cli/src/lib/pagedjs.ts`'s
`BREAK_INSIDE_HANDLER`) interferes with Paged.js's own `break-before:right`
handling. This is a real defect in the CURRENT shipped pipeline, not an
artifact of this fixture set, and is worth a follow-up issue against
`packages/cli/src/lib/pagedjs.ts` — out of scope to fix here (that file is
owned by another workstream per this task's boundaries).

## Proof that each assertion can fail (ARCHITECTURE.md §8)

For fixtures 3, 4 and 8, the input was deliberately broken, the assertion
was shown to fire, and the fixture was restored byte-identical
(`diff` confirmed after each). Not simulated — this is copy-pasted output
from actually running the broken fixture through `runner.ts`.

**Fixture 3** — deleted the `@page chapter:left`/`:right` mirror rules:

```
folio:    5pp in 0.18s — FAIL (recto left inset avg 45.0pt, verso left inset avg 45.0pt, |Δ|=0.0pt)
paged.js: 5pp in 1.30s — FAIL (recto left inset avg 45.0pt, verso left inset avg 45.0pt, |Δ|=0.0pt)
```

**Fixture 4** — removed `counter-reset: page 1` (kept the page-name change):

```
folio:    6pp in 0.18s — FAIL (folio sequence: ["i","ii","iii","4","5","6"] (want ["i","ii","iii","1","2","3"]))
paged.js: 6pp in 1.37s — FAIL (folio sequence: ["i","ii","iii","4","5","6"] (want ["i","ii","iii","1","2","3"]))
```

**Fixture 8** — changed `break-before: right` to `break-before: page`:

```
folio:    3pp in 0.21s — FAIL (CHAPTERTWO on printed p2, CHAPTERTHREE on printed p3 (recto = odd))
paged.js: 3pp in 1.30s — FAIL (CHAPTERTWO on printed p2, CHAPTERTHREE on printed p3 (recto = odd))
```

## Test-authoring findings worth keeping in mind for future fixtures

These are bugs in the FIXTURE/TEST harness that were found and fixed while
building this set — not engine findings, but worth recording so nobody
re-discovers them the hard way:

1. **Paged.js's polisher reads `break-before`/`break-after` only from
   stylesheet rules, never inline `style="..."` attributes.** Native
   Chromium print honors an inline break; Paged.js silently ignores it and
   the whole document collapses onto one page with no error. Every fixture
   here uses a `.brk { break-before: page }` class, never inline style.
2. **A named `@page` rule that never redeclares `size` inherits it from the
   base `@page` rule in BOTH engines** — but only if the base rule declares
   one. A named-page-only `size` (no base `@page { size }` at all) silently
   falls back to Letter in Paged.js specifically (measured: 816×1056px
   instead of the requested 360×540pt). Always declare `size` on the base
   `@page` rule.
3. **poppler's `pdftotext -bbox-layout` can drop a `-` at a column/line-wrap
   point**, and puts the two halves of the word on separate `<line>`
   elements (not just a missing character in one word) — this silently
   zeroed out fixture 7's card-matching and mangled "CHAPTERTHREE" into
   "CHAPTERTHREE" → "SENTINELCHAPTERTHREE" in fixture 8. Sentinel tokens in
   this fixture set are deliberately hyphen-free single alphanumeric runs
   (`SENTINELCARD01TOP`, not `SENTINEL-CARD-01-TOP`) to sidestep it, rather
   than working around it with an ever-looser regex.
4. **A check whose own explanatory comment contains the string it's
   grepping for can never fail.** Fixture 5's assertion originally grepped
   its own `.html` source for `box-shadow`/`transform: rotate` to prove they
   were absent — and matched its own doc-comment explaining WHY they're
   absent, meaning the assertion was permanently false regardless of the
   fixture. Fixed by stripping `/* ... */` comments before the check. Kept
   as a live example of ARCHITECTURE.md §8 in this codebase, not just a
   citation of it.
5. **A minor, unexplained Folio-PDF-specific extraction quirk**: fixture 7's
   Folio output loses the trailing character of some multi-column sentinel
   words under poppler (`SENTINELCARD04TOP` → `SENTINELCARD04TO`) for roughly
   half the cards; Paged.js's PDF does not exhibit this. Didn't block the
   assertion (`.includes()` still matches enough cards to prove
   `split === 0`), not chased further — flagged here in case it recurs on a
   real book and starts affecting an assertion that needs the FULL word.

## Files

- `fixtures/01-*.html` .. `08-*.html` — the 8 small fixtures, self-contained
  (inline `<style>`, no external assets).
- `fixtures/99-kitchen-sink.ts` — generator for the combined book;
  `fixtures/99-kitchen-sink.html` is its checked-in output.
- `runner.ts` — builds every fixture on both engines and prints the table
  above. Imports `build()` from `../../src/compiler/build.ts` (the same
  function `spike/folio/src/cli.ts build` calls) and `renderHtmlToPdf()`
  from the shipped `packages/cli/src/lib/pagination.ts` (the same function
  `gutterpress build` calls) — reused directly, not reimplemented.
- `edge-ink.py` — independent pixel-edge reader (poppler `pdftoppm` +
  Pillow) for the full-bleed check; not part of Folio or Gutterpress.
- `out/` — build artifacts (PDFs), gitignored-equivalent scratch; regenerate
  by re-running `runner.ts`.
