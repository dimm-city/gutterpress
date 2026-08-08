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
| 2026-08-08 | A.1 page count (field guide, 300pp) | 302pp | 303pp | = | both legs rebuilt from identical content; 1pp fragmentation difference |
| 2026-08-08 | A.2 type scale (field guide) | 18.252pt | 18.252pt | = | `pdftotext -bbox` median glyph height, pages 12/25/240/290 both legs |
| 2026-08-08 | C.14 preview↔print parity | 42pp print vs 59pp viewer (design-guide) | n/a | < | `scripts/native-parity-gate.ts`; descendant `page:` over-applied to whole run; fix in progress |
| 2026-08-08 | E.22 html export | paginated artifact ships | Paged.js DOM snapshot | pending | native path landed; needs measured comparison |
