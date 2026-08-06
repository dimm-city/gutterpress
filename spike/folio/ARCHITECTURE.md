# Design rules, and the bug that taught each one

Folio's shape is not a matter of taste — nearly every structural decision here
was forced by a defect that shipped first. This file records the rule, the bug
behind it, and the check that keeps it from coming back, so the next person does
not have to rediscover them.

Engine facts these rules are built on: [`ENGINE.md`](./ENGINE.md).

---

## 1. Every synthesis decision lives in ONE shared function

`src/shared/synthesis.ts` holds every rule that *decides* something: where blank
pages go (`planRectoBlanks`), what a running string reads on a given page
(`stringValueAt` / `stringSymbols`), how far a leader fills
(`leaderFillCount`), which generated CSS out-specifies the author
(`generatedContentCss`). They are pure functions with direct unit tests.

The compiler and the viewer differ **only** in how they measure — the PDF's
`/Dests` versus client rects — and how they apply. Neither contains policy.

**The bug.** Recto/verso blank pages were implemented in the compiler. The
viewer didn't get them, so the moment the fix landed, the preview and the PDF
disagreed by a page for exactly the books the fix was for (viewer 5pp with
chapters on 2 and 4; print 6pp with chapters on 3 and 5). Fixing it as a second
implementation would have created a *twin* — two copies of one rule, drifting
apart on the next change. The observation that named the rule:

> Every compiler-side synthesis needs a viewer-side twin, or the parity claim
> quietly rots.

The resolution is not discipline about twins; it is not having twins. There is
one function, called from two places.

**What keeps it honest.** `s1` diffs viewer against print block by block; the
shared module has 20 unit tests.

---

## 2. Measurement must be invisible to the author's CSS

Elements are measured through ids the author already wrote, or through a
zero-size `<folio-anchor>` injected as a first child. Nothing the author can
select is ever mutated.

**The bug.** Measurement used to assign `id` attributes to author elements. Ids
are not inert: `h1[id] { counter-increment: chapter }` is real theme CSS, so
instrumenting the document renumbered every chapter — openers read `03`, `04`
instead of `01`, `02`. The first fix was to strip the ids and print again,
hoping the clean document paginated identically to the measured one. That is a
hope, not a guarantee, and it cost a whole print pass.

Making measurement genuinely neutral deleted both the hope and the pass: Tier 3
now costs 2 prints instead of 4 (61-page book: 3.1 s → 1.8 s warm), and the
document that was measured **is** the document that ships.

**What keeps it honest.** `s11` prints the same file with plain Chromium and
requires byte-identical hostile-CSS output and page count.

**Residual risk, accepted and written down:** a `parent > :first-child` rule
could observe the injected child. Elements with author ids — the common case,
since markdown renderers id their headings — never get an anchor.

---

## 3. Generated CSS is emitted fully resolved, per context

For every page context (name × pseudo-variant), resolve what the author's
cascade produces and emit that as one flat block — including the suppressions
(`content: none`).

**The bug, three times.** Chromium does not apply `@page` selector specificity
across stylesheets ([`ENGINE.md`](./ENGINE.md) §3), so a generated unnamed
`@page` block silently beats the author's `:left`/`:right` and named rules:

1. Running heads drew **twice** — once from the generated unnamed rule, once
   from the generated pseudo rule the author's `content: none` should have
   suppressed.
2. A generated block that skipped "contexts needing no rewrite" let the unnamed
   rule leak onto the cover and the TOC, putting a running head on both.
3. Bleed geometry emitted one unnamed `@page { margin-* }`, which beat the
   author's `:left`/`:right` gutters — **every page of a bound book collapsed to
   the same margin** (measured all-45pt instead of 63/45 alternating). Any book
   with bleed *and* gutters mirrored the wrong way and was unprintable.

Each was the same root cause found in a different emitter. The rule is now
applied uniformly: `counterStyleCss` and the bleed geometry both loop over
`pseudoVariants(model)` and emit resolved blocks.

**What keeps it honest.** `s13` measures margins by page parity through the real
build; `s11` checks the cover and TOC carry no head.

---

## 4. A generated override must out-specify the author's own rule

`generatedContentCss()` reuses the author's selector and adds Folio's attribute:
`a.xref::after` → `a.xref[data-folio-after]::after` (0,2,1 beats 0,1,1).

**The bug.** The shim used a bare `[data-folio-after]::after` (0,1,0). That was
safe only because the engine of the day *dropped* the author's unsupported
declaration entirely. When Chromium started parsing `target-counter()` while
still computing it to `none`, the author's declaration survived, outranked the
override, and every cross-reference and dot leader silently vanished — output
went from `"See target (p. 2) and its name [TARGETHEADING]."` to `"See target
and its name."` with no error anywhere.

Never rely on "the browser will drop the thing I'm replacing." This is also the
bug that bought the engine pin ([`ENGINE.md`](./ENGINE.md) §2): the failure was
invisible to every form of feature detection, so the defence is a fixed engine
plus a harness that renders.

**What keeps it honest.** `s0` render-probes instead of trusting `CSS.supports`;
`s11` asserts the rendered reference text.

---

## 5. Compute the whole answer analytically; don't iterate toward it

Blank-page placement walks the sites once in document order, carrying a running
count of blanks inserted so far, because a blank shifts every later page by
exactly one and changes no content.

**The bug.** The first implementation toggled spacers one measurement pass at a
time. It never converged: the spacer fixes the parity, the next pass observes it
fixed and removes it, forever. Symptoms were a build that hit its pass limit and
a chapter that landed on a verso anyway.

The same trap appears wherever a fix removes the symptom it was derived from.
Where the answer genuinely cannot be computed in one shot — table header and
footer reservation — the state is made **sticky** instead: claims only ever grow,
and the loop ends when a pass adds nothing new.

**What keeps it honest.** `s10` requires convergence and page-for-page equality
with Paged.js; `s5` requires rows-per-page to match print exactly.

---

## 6. Prefer deleting a shim to hardening it

Running heads used to work by renaming pages: each chapter run got a generated
`@page chapter--N` carrying literal text, and its boxes were moved onto it.

That mechanism produced **four separate bugs on first contact with a real
theme** — dropped non-string rules, lost cascade fights, inverted page-selector
specificity, no string carry-over — because it forced the compiler to
re-implement `@page` cascade semantics.

The alternative was measured rather than argued: same input, both strategies.

| | page renaming | counter-style map |
| --- | --- | --- |
| pages | 61 | 61 (61/61 content-aligned, 0 geometry differences) |
| generated CSS | 64.5 KB | **4.7 KB** |
| print passes | 1 | 2 |
| author's `@page` rules | rewritten into generated names | **untouched** |

The one content difference favoured the new path — renaming had been extending
the `toc` template past the page the author named. Renaming bought one print
pass and cost a reimplementation of the cascade. **Deleted: −342 lines.**

The general form: when a shim is the buggiest thing you own, price the
alternative before hardening it.

---

## 7. Verify with an independent reader, never the tool's own model

Every spike asserts against a PDF reader Folio does not share code with —
PyMuPDF where available, poppler otherwise (`spikes/pdfprobe*.py`, selected
automatically by `probe.ts`; both expose the same CLI and JSON shapes, so the
spikes never learn which answered). Folio only ever *writes* PDFs, with pdf-lib.

This is what makes findings falsifiable rather than self-confirming: when the
tool's model and the reader disagree, the reader wins.

The same principle applies to sub-agent reports and to your own earlier
conclusions. Of three agent reports in this project, **two contained a
conclusion that did not survive independent re-measurement**: a "viewer clips
overheight images" rule that failed to reproduce in nine isolated
configurations, and a check that passed while its own detail read "Folio does
not warn about it."

---

## 8. A test must be able to fail

Two anti-patterns cost real time here:

- **A check that asserts its own setup.** `"72 DPI source image is flagged as
  sub-print-quality"` passed by asserting the *fixture* was 72 DPI, while its
  detail string said Folio did not warn. It could never fail. It now asserts the
  audit actually fires.
- **A test loosened to go green.** When an engine bump moved one block to an
  adjacent page, the temptation was to relax the assertion. What went in instead
  is the property that is *actually* true and still catches regressions: page
  counts exact, disagreement only ever adjacent-page, ≤1 % of blocks. A
  non-adjacent move, a cluster, or a page-count change still fails.
- **A check that hedged across engines.** `"target-counter() content is either
  dropped or retained"` was hard-coded to `true` so it would pass on both
  versions in play. Pinning the engine let it become the real assertion —
  *retained*, therefore the override must out-specify the author — which now
  fails if a future engine changes its mind.

The rule: when a test fails, first establish whether the code or the test is
wrong. Both happened repeatedly here, and the difference is only ever settled by
measurement.

---

## 9. Real content finds what generated fixtures cannot

The generated corpus was green at 331/331 blocks. The first real theme
(`examples/gutterpress-user-guide`) immediately produced four Tier 2 bugs, and
the first real POD geometry test produced two more — including one where Folio
turned a working full-bleed cover into a broken one.

Generated fixtures test the shapes you thought of. `compare/run.ts` therefore
stages the **actual** pre-pagination `book.html` that Gutterpress hands to
Paged.js — neither engine gets a hand-tuned document — and
`compare/diff-report.ts` aligns the two PDFs **by content** (Needleman-Wunsch
over per-page word overlap) before diffing, so one inserted page doesn't smear
across the whole book.

Add a third baseline whenever you can: the same file printed by plain Chromium
with no Folio at all. That is what separates "the two engines disagree" from
"Folio does something wrong" — and it is how we know Folio reproduces native
Chromium 61/61 pages, adding only the running heads it synthesizes.

---

## 10. State the limits you cannot fix

Three things Folio cannot do, written down rather than left to be discovered:

- **Bleed art in the content flow only works on zero-margin pages** — Chromium
  clips content to the content box ([`ENGINE.md`](./ENGINE.md) §5). Note the
  bound is narrower than it first looks: a full-bleed *page* is achievable WITH
  margins by painting the 16 margin boxes, which also keeps running heads
  available. This entry used to claim the two were mutually exclusive; measuring
  it disproved that (`ENGINE.md` §5).
- **Knife-edge boundaries can differ between preview and print** — inherent, not
  fixable by an epsilon, worse with fractional page metrics. The PDF is ground
  truth; printed page numbers always come from compiler measurement.
- **A per-chapter opener template is not expressible** in standard Paged Media,
  because `:first` means the document's first page.

A limit that is measured, bounded and documented is a design constraint. The
same limit undocumented is a bug report waiting to be filed by a customer.
