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
| 08-08 | **A.3 image objects (field guide)** | 3,067 | 579 | **<** | `pdfimages -list`; brick bitmap re-emitted per page instead of a shared XObject |
| 08-08 | C.14 preview↔print parity | 0 divergences, 5 fixtures | n/a | > | `native-parity-gate.ts`, **empty allowlist** |
| 08-08 | **C.15 page navigation** | **saturates at p14 of 34** | works | **<** | live preview drive; `scrollToCurrentPage` assumes a vertical stack, viewer lays out a 2-D grid |
| 08-08 | C.15 view modes (single/two-up) | no-op | works | **<** | deliberately retired as broken; paged retains it |
| 08-08 | C.16 outline / source sync / context menu | 64 entries, correct pages | works | = | live drive: `getOutline`, `getVisibleSource`, `getContextTargetAt`, `getRectsFor` |
| 08-08 | **C.16 block identity (`ref`)** | **always null** | `data-ref` minted | **<** | `data-ref` is produced only by the polyfill; `{chapter,range}` fallback still works |
| 08-08 | E.22 html export (design guide) | 53pp, folios + running heads | DOM snapshot | = | served + driven headless; 53 sheets, 40+ margin boxes with real content |
| 08-08 | E.23 standalone drop-in | 2pp render fully | n/a | > | hand-authored Paged Media + one script; no Paged.js equivalent |
| 08-08 | F.24 bundle freshness | byte-identical rebuild | n/a | = | `--force` rebuild left `git status` empty |
| 08-08 | **F.25 desktop export w/o system Chromium** | **fails** | works (Electron Chromium) | **<** | native ignores the injected `pdfRenderer`; contradicts ADR 0002 |
| 08-08 | 26. build wall-clock (design guide 53pp) | 1,975 ms | 3,534 ms | > | clean back-to-back; native 1.8x faster |
| 08-08 | 26. build wall-clock (field guide 302pp) | ~13 min | ~4 min | accepted | agreed exception; paged measured under load so its true time is lower |

### Open blockers (verdict `<`)

1. **Desktop PDF export requires a system Chromium** under native — biggest blocker, contradicts ADR 0002.
2. **Preview page navigation saturates** — 20 of 34 pages unreachable from the toolbar at a 1400px viewport.
3. **Chapter-opener pages lose their running head and folio chips.**
4. **Right floats drop full-width** on the field guide's opener aside.
5. **Image XObjects duplicated ~5x** — check with the print vendor before a DTRPG upload.
6. **`ref` block identity is always null** — latent; the `{chapter,range}` fallback carries today.
7. **View modes are a no-op**; the PWA is still hard-wired to Paged.js; `iframe-styles.ts` still ships.

### Scope caveat on the parity gate

`native-parity-gate.ts` compares **native-print vs native-viewer** — it proves the preview does not lie about the PDF. It does **not** compare native vs Paged.js; that is what this table is for.
