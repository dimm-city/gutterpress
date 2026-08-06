# Migration fixture set (MIGRATION.md Step 3)

Eight small, purpose-built fixtures (plus a 9th, 3b, added for P1a) plus one
combined "kitchen sink" book,
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
bun run runner.ts --kitchen-sink   # 9 fixtures + the combined book
```

`fixtures/99-kitchen-sink.ts` is a **generator**, not a static file — after
editing it, regenerate with `bun run fixtures/99-kitchen-sink.ts`.

## The fixtures

| # | file | proves | traces to |
| - | --- | --- | --- |
| 1 | `01-filter-clip-path.html` | the two-layer `filter:drop-shadow()` + `clip-path` shadow pattern rasterizes its subtree (text becomes a picture) while plain vector text stays extractable | ENGINE.md §10 |
| 2 | `02-fullbleed-running-heads.html` | full-bleed page background (tiled texture, via the margin-box painting technique) survives on a CONTINUATION page with no heading of its own, and the running head tracks the CURRENT chapter, not a stale one | ENGINE.md §5 |
| 3 | `03-mirrored-binding.html` | named page + `:left`/`:right` binding-gutter mirroring survives to the PDF, in the correct DIRECTION (recto's left inset is the declared outer value, verso's the declared inner/binding value) — the A1 defect fixture, literal-length case | MIGRATION.md Step 1 ("Mirrored binding gutters"), ENGINE.md §3 |
| 3b | `03b-mirrored-binding-var.html` | the same binding-gutter defect, but with the binding side declared as `var(--binding-margin, X)` — the case that actually reproduces MIGRATION.md's root-caused Paged.js defect (literal lengths already work; `var()` is silently dropped) | MIGRATION.md "Mirrored binding gutters — root cause" |
| 4 | `04-folio-restart.html` | front-matter (roman) → body (arabic-from-1) folio restart | ENGINE.md §8, MIGRATION.md "Current state of the two known Folio gaps" #1 |
| 5 | `05-margin-box-furniture.html` | a margin-box "chip" (background + border + `width:fit-content` + `counter(page)`) renders AND is positioned where a margin box actually lives — below the content box, in the right half of the page (an OUTPUT observation from the PDF, not a lint on the fixture's own source; see "Assertion could not observe engine behaviour" below) | ENGINE.md §8 |
| 6 | `06-xref-toc.html` | a TOC with `leader(dotted) target-counter(...)` and inline cross-references resolve to the page the target actually printed on (Tier 3) | ENGINE.md §2, ARCHITECTURE.md §10 |
| 7 | `07-multicol-break-avoid.html` | `columns:2` + `break-inside:avoid` cards never split across a page | MIGRATION.md Step 3 item 7 |
| 8 | `08-recto-verso-blank.html` | `break-before:right` forces chapters onto a recto (odd) page with a genuinely blank, unstyled verso inserted (`@page :blank`) | ENGINE.md §2/§7, `spikes/s10-recto-breaks.ts` |
| — | `99-kitchen-sink.ts` | all eight combined at realistic scale (~30pp), for build-time measurement only — separated so CI can skip it | — |

Trim size is 5in×7.5in (not the book examples' 6in×9in) purely to keep each
fixture small and fast; nothing about the constructs depends on page size.

## Results (this machine, poppler backend, Chrome 151.0.7922.75)

| fixture | folio pages | folio time | folio assert | paged.js pages | paged.js time | paged.js assert |
| --- | --- | --- | --- | --- | --- | --- |
| 01-filter-clip-path | 1 | 0.42s | PASS | 1 | 1.65s | PASS |
| 02-fullbleed-running-heads | 4 | 0.23s | PASS | 4 | 1.09s | PASS |
| 03-mirrored-binding | 5 | 0.12s | PASS | 5 | 1.16s | PASS |
| 03b-mirrored-binding-var | 5 | 0.24s | PASS | 5 | 1.23s | PASS (fixed by page-var-resolve.ts) |
| 04-folio-restart | 6 | 0.28s | PASS | 6 | 1.10s | **FAIL** |
| 05-margin-box-furniture | 3 | 0.13s | PASS | 3 | 1.08s | PASS |
| 06-xref-toc | 4 | 0.22s | PASS | 4 | 1.08s | PASS |
| 07-multicol-break-avoid | 6 | 0.13s | PASS | 12 | 1.08s | PASS |
| 08-recto-verso-blank | 5 | 0.29s | PASS | 3 | 1.07s | **FAIL** |
| 99-kitchen-sink | 29 (tier 3, 2 passes) | 0.72s | — | 27 | 1.41s | — |

Three fixtures diverge (04, 07, 08), each with a documented, MEASURED reason
below — not a guess. 03b diverged until `packages/cli`'s page-var-resolve.ts
fixed the shipped pipeline (see its section). Fixture 07's divergence was
introduced by an independent-verification fix (its assertion originally could
not fail, see "Assertion could not fail" below) and is a genuine PASS/PASS
page-count gap, not an assertion failure like 04/08.

## Divergences, with the documented reason MIGRATION.md's success criteria ask for

### Fixture 3b — binding margin via var(): NOW PASSES ON BOTH ENGINES (fixed)

> **RESOLVED (2026-08-06):** `packages/cli/src/lib/page-var-resolve.ts` now
> substitutes `:root`/`html` custom-property values into `@page` declarations
> before the HTML reaches Paged.js (`patchHtmlStringForPagedjs` applies it),
> so the polyfill only ever sees literal lengths — which it handles
> correctly. Measured: Paged.js moved from 54.0pt (`dropped`) to 90.0pt
> (`correct`), identical to Folio; 03b was removed from KNOWN_DIVERGENCES.
> The polyfill itself is unchanged (still unforked); the analysis below is
> kept as the record of the underlying Paged.js defect the resolver works
> around.

This is the fixture that covers the ACTUAL A1 defect (P1a). Fixture 3 uses
only literal lengths on the binding side — the case MIGRATION.md's own
root-cause investigation already found Paged.js handles correctly (measured:
36pt/72pt end-to-end, exact). Fixture 3 alone never exercises the bug.

Fixture 3b declares the binding side as `margin-left: var(--binding-margin,
1in)` with `--binding-margin: 1.25in` on `:root`. Measured:

- **Folio: 90.0pt** — the declared value (`correct`). Folio's compiler
  resolves the custom property like any other CSS engine does.
- **Paged.js: 54.0pt** — the BASE `@page` margin (`dropped`), not even the
  var()'s own fallback text (`72.0pt`, which would be `fallback`). This is
  exactly MIGRATION.md's root-caused mechanism: the vendored polyfill's
  `@page` margin-* AST walker takes the first CSS value node without
  checking its type, sees a `Function` node for `var()` (not a `Dimension`),
  and `addMarginVars()`'s `typeof margin[m].value !== "undefined"` guard
  then drops the declaration outright — the page falls through to the base
  `@page` rule instead of resolving, or even falling back on, the
  custom property.

Net: this is a real, measured Paged.js defect in its own vendored `@page`
parser — not a `packages/cli` driving-code defect (per MIGRATION.md, out of
scope to patch here) — and now has a fixture that actually proves it, rather
than one (fixture 3) that only proves the easy, already-working case.

### Fixture 4 — folio restart: Folio (synthesized, tier 3) PASSES; Paged.js FAILS

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
  "Current state" note).

  **F6 correction (measured twice, plain Chromium print with no Folio at
  all):** pairing the reset with a page-name change does **NOT** restart the
  counter natively either — this exact document, printed straight, reads
  `i, ii, iii, 4, 5, 6`, the reset still ignored. An earlier draft of this
  section, and this fixture's own `04-folio-restart.html` comment, both
  claimed the pairing "DOES restart natively" — that claim is **FALSE**,
  contradicted by the very next paragraph's own tier-3 finding, and has been
  corrected in both places. Folio's PDF reads `i, ii, iii, 1, 2, 3` correctly
  only because it goes through the compiler's synthesis path (below), not
  because native Chromium print restarts on this construction.

  **Correction to an earlier draft of this section** (independent
  re-measurement, ARCHITECTURE.md §7): this fixture is **NOT** Tier 1 / "no
  synthesis at all" as previously stated here. Directly instrumenting
  `build()` on this exact fixture (`bun run` a one-off script logging
  `r.tier`/`r.passes`) measures `tier: 3, passes: 1` — `model.counterResets.length
  > 0` alone forces `needsMeasure = true` in `src/compiler/build.ts` (the
  `needsMeasure` disjunction includes `model.counterResets.length > 0`
  unconditionally), which routes the document through the exact
  measure→synthesize→fixpoint loop C1's `pageCounterValues`/`counterStyleCss`
  machinery lives in — it converges in a single measurement pass, but it is
  real synthesis, not a plain unsynthesized print. Folio's PDF reads
  `i, ii, iii, 1, 2, 3` correctly on all six pages **because** that Tier-3
  path works, not because it was skipped.
- Paged.js's own DOM-based counter, given the identical document, restarts
  correctly on the FIRST body page (`1`) but does **not** propagate the
  reset to subsequent normal-flow pages in the same run — they read `4, 5`
  (i.e. as if the reset never happened, continuing the PRE-reset count).
  Sequence measured: `["i","ii","iii","1","4","5"]`.

Net: for this specific, realistic construction (reset + name change
together, which is what synthesis will actually emit), Folio's Tier-3
synthesis handles it correctly and Paged.js's "for free" claim is the one
that doesn't hold up past the first page. The narrower ENGINE.md §8 claim
(reset alone, no name change) still holds — verified above.

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

### Fixture 7 — multi-column `break-inside: avoid`: both PASS, but Folio 6pp vs Paged.js 12pp

Both engines correctly keep every card intact (0 splits across a page
boundary, all 12 cards measured on both engines) — the fixture's actual
subject, `break-inside: avoid`, is honored by both. But the identical
document lays out completely differently:

- **Folio/native: 2 cards per page** — one per column, both columns used
  (probe per-page distribution: `p1: [01, 02] … p6: [11, 12]`). Note plain
  `pdftotext` (any mode) extracts only the FIRST column's card per page —
  a poppler reading-order quirk, not content loss; the bbox-word probe
  (`pdfprobe-poppler.py`) recovers all 12.
- **Paged.js: 1 card per page** — the SECOND COLUMN IS NEVER FILLED
  (`p1: [01] … p12: [12]`).

Root-caused by measurement (2026-08-06):

| variant | Paged.js pages | conclusion |
| --- | --- | --- |
| as-is | 12 | baseline |
| drop `column-fill: auto` | 12 | column-fill is NOT the trigger |
| drop `break-inside: avoid` | 7 | **avoid is the trigger** (columns fill again, cards split) |
| short cards (2 fit per column) | 2 | columns work when no break-avoidance move is needed |
| **RAW polyfill, no `BREAK_INSIDE_HANDLER`** | **12, 1 card/page** | **NOT our handler** — measured, not just source-read |

Mechanism: when a `break-inside: avoid` card cannot share a column with its
neighbor, Paged.js's own break-avoidance moves the break to a new PAGE
instead of the next COLUMN, abandoning column 2 for the rest of the run —
so a run of tall avoid-cards degenerates to one card per page. Confirmed
Paged.js-internal by driving the raw vendored polyfill with no injected
handler at all (same 12pp/1-per-page result). Native Chromium's LayoutNG
(and therefore Folio) moves the same break to the next column. A real,
measured engine defect on Paged.js's side — 2x the paper for this layout —
not a `packages/cli` defect; nothing to fix on our side of the seam.

## Assertion could not fail — found and fixed (ARCHITECTURE.md §8)

**Fixture 7's original assertion could never fail.** The original 12 cards
were only 3 short `<p>` lines each; three cards packed per column with room
to spare (~222pt of content in a ~439pt column), so removing `break-inside:
avoid` from `.card` never produced a split — verified by mutating the ORIGINAL
fixture (deleting the `break-inside: avoid` declaration) and re-running:
Folio and Paged.js both still reported `0 split across a page boundary`,
i.e. the assertion passed on a document that should have failed it. Fixed by
padding each card with enough filler text to remove the slack (each card now
straddles a column boundary when `break-inside: avoid` is absent) and
switching `main`'s `columns` to `column-fill: auto` (sequential fill —
deterministic, and what a real book wants; verified this was not itself the
fix, see fixture 7's divergence note above). This also incidentally fixed a
**second**, previously-documented defect: Folio's PDF text extraction was
dropping the last character of ~half the `...TOP`/`...BOT` sentinel tokens
at column-wrap points (`SENTINELCARD04TOP` → `SENTINELCARD04TO`), silently
under-measuring the fixture (6/12 cards instead of 12/12). Renaming the
tokens to end in a disposable buffer character (`...TOPZ`/`...BOTZ` instead
of `...TOP`/`...BOT`) means the ONE character poppler drops is now the
throwaway `Z`, not a character the assertion's `.includes("...TOP")` /
`.includes("...BOT")` substring check needs — now measures 12/12 on both
engines, every run.

## Proof that each assertion can fail (ARCHITECTURE.md §8, P1b)

**This is a re-runnable, in-repo proof, not a one-time claim.**
`bun run runner.ts --prove-falsifiable` applies one defined, targeted
mutation per fixture (`MUTATIONS` in `runner.ts`), rebuilds through BOTH
engines, asserts the run FAILS, then restores the fixture and verifies it is
byte-identical to before the mutation — throwing if a mutation's anchor text
has drifted (so a stale mutation can't silently no-op) or if the restore
isn't exact. It exits 1 if any mutation fails to flip its assertion, so this
doubles as a permanent regression check against the "assertion could not
fail" failure mode (see below) creeping back in. Previously this only
existed for fixtures 3/4/7/8 as hand-copied transcripts, and for 1/2/5/6 as a
throwaway, uncommitted harness that nothing re-ran. All 9 fixtures (the 8
plus 3b) are covered now.

Full transcript, copy-pasted from an actual run (not edited, not simulated):

```
== --prove-falsifiable: mutate -> confirm FAIL on both engines -> restore ==

-- 01-filter-clip-path — remove the filter + clip-path pair from .card
   folio:    FAIL (expected) — plain text extractable=true, filtered text absent (rasterized)=false
   paged.js: FAIL (expected) — plain text extractable=true, filtered text absent (rasterized)=false
   restored byte-identical: true

-- 02-fullbleed-running-heads — remove string-set from the chapter h1
   folio:    FAIL (expected) — continuation page (p2) carries "Chapter One"=false, chapter-two page head not stale=true; edge ink {...}
   paged.js: FAIL (expected) — continuation page (p2) carries "Chapter One"=false, chapter-two page head not stale=true; edge ink {...}
   restored byte-identical: true

-- 03-mirrored-binding — delete the @page chapter:left/:right mirror rules
   folio:    FAIL (expected) — recto left inset avg 45.0pt (want 45pt, outer), verso left inset avg 45.0pt (want 63pt, inner/binding)
   paged.js: FAIL (expected) — recto left inset avg 45.0pt (want 45pt, outer), verso left inset avg 45.0pt (want 63pt, inner/binding)
   restored byte-identical: true

-- 03b-mirrored-binding-var — replace the var()-declared binding margin with the outer literal (no binding offset at all)
   folio:    FAIL (expected) — left inset avg 45.0pt -> unknown (correct=90pt, fallback=72pt, dropped=54pt)
   paged.js: FAIL (expected) — left inset avg 45.0pt -> unknown (correct=90pt, fallback=72pt, dropped=54pt)
   restored byte-identical: true

-- 04-folio-restart — remove counter-reset: page 1 (keep the page-name change)
   folio:    FAIL (expected) — folio sequence: ["i","ii","iii","4","5","6"] (want ["i","ii","iii","1","2","3"])
   paged.js: FAIL (expected) — folio sequence: ["i","ii","iii","4","5","6"] (want ["i","ii","iii","1","2","3"])
   restored byte-identical: true

-- 05-margin-box-furniture — replace the chip's counter(page) with a fixed literal
   folio:    FAIL (expected) — chip folio per page=false, chip positioned in bottom-right margin box (below y=486.0pt, right of x=180.0pt) on every page=true
   paged.js: FAIL (expected) — chip folio per page=false, chip positioned in bottom-right margin box (below y=486.0pt, right of x=180.0pt) on every page=true
   restored byte-identical: true

-- 06-xref-toc — point the ch1 hrefs at a nonexistent id
   folio:    FAIL (expected) — refs found=[4], ch1 on p2, ch3 on p4
   paged.js: FAIL (expected) — refs found=[4,0], ch1 on p2, ch3 on p4
   restored byte-identical: true

-- 07-multicol-break-avoid — remove break-inside: avoid from .card
   folio:    FAIL (expected) — 12 cards measured, 5 split across a page boundary
   paged.js: FAIL (expected) — 12 cards measured, 5 split across a page boundary
   restored byte-identical: true

-- 08-recto-verso-blank — change break-before: right to break-before: page
   folio:    FAIL (expected) — CHAPTERTWO on printed p2, CHAPTERTHREE on printed p3 (recto = odd)
   paged.js: FAIL (expected) — CHAPTERTWO on printed p2, CHAPTERTHREE on printed p3 (recto = odd)
   restored byte-identical: true

All mutations correctly flipped their assertion to FAIL.
```

Notes on two entries: fixture 5's mutation makes `chipOk` (per-page `CH.N`
text) fail while the NEW positional check still passes on the fixed literal
`"CH.1"` (it's still a furniture chip, just always reading `1` — the
positional check was never the thing this particular mutation was meant to
exercise, `chipOk` is), and fixture 6's post-mutation `refs found` differs
between engines (`[4]` vs `[4,0]`) because Folio and Paged.js disagree on
what an unresolvable `target-counter()` renders as — irrelevant to the
proof, since `refsCorrect` fails either way.

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
   grepping for can never fail — and stripping the comment doesn't fix the
   deeper problem.** Fixture 5's assertion originally grepped its own
   `.html` source for `box-shadow`/`transform: rotate` to prove they were
   absent — and matched its own doc-comment explaining WHY they're absent,
   meaning the assertion was permanently false regardless of the fixture.
   Stripping `/* ... */` comments before the check (an earlier fix) solved
   THAT bug, but left a bigger one standing (F5, this round): grepping the
   fixture's OWN checked-in source is a lint on a static file, not an
   observation of what either engine rendered — it produces the identical
   verdict for Folio and Paged.js no matter what either engine actually did,
   so it can never catch a real engine regression either. Replaced with an
   output-observed check: read the chip's own text bounding box back out of
   the PDF (poppler bbox-layout) and assert it lands OUTSIDE the content
   box, in the page's right half — i.e. actually rendered as a positioned
   margin box, not floated body content. `transform: rotate()`/`box-shadow`
   themselves have no output-observable "absence" signature worth asserting
   (there is no PDF feature that proves a CSS property was never applied),
   so that half of the old check is dropped rather than kept as
   unfalsifiable theater. Kept as a live example of ARCHITECTURE.md §8 in
   this codebase, not just a citation of it.
5. **poppler drops the LAST character of a word sitting at a column-wrap
   edge, not a buffer character** — this was originally logged here as "a
   minor, unexplained Folio-PDF-specific extraction quirk" that "didn't block
   the assertion." Independent re-measurement (ARCHITECTURE.md §7) found it
   silently zeroed the assertion's coverage from 12/12 cards to 6/12 rather
   than being harmless, and traced the mechanism: whichever character
   actually falls last gets dropped, so a sentinel ending in a meaningful
   letter (`...TOP`, `...BOT`) loses that letter and fails `.includes()`.
   Fixed (not just flagged) by renaming the tokens to end in a disposable
   buffer character (`...TOPZ`/`...BOTZ`) — poppler now drops the throwaway
   `Z`, and the assertion's substring check against `...TOP`/`...BOT` matches
   every time. Worth this pattern for any future sentinel token that must
   survive a column/line-wrap edge.

## Files

- `fixtures/01-*.html` .. `08-*.html`, plus `03b-mirrored-binding-var.html` —
  the 9 small fixtures, self-contained (inline `<style>`, no external assets).
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
