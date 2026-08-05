# Folio M0 spike — results

**Verdict: the proposal holds.** Every load-bearing claim was verified against a
real browser, two of them only after the spike found and fixed a genuine
divergence. Six findings amend the proposal; none of them is existential, and
one of them (F1) makes Tier 3 materially simpler than proposed.

- Runtime: Chromium **141.0.7390.37** headless (proposal floor: 131), Bun 1.3.11
- Suite: `bun run spikes` — **10/10 spikes, 117 checks, ~32 s wall clock**
- Evidence regenerated on every run into `out/results.json` / `out/results.md`;
  PDFs, generated CSS and fixtures land in `out/` too.

| spike | proposal ref | what it proves | verdict |
| --- | --- | --- | --- |
| s0 | §4 | Chromium's native Paged Media baseline is real | PASS 29/29 |
| s1 | §11.1 | multicol ↔ print break parity (**the load-bearing one**) | PASS 19/19 |
| s2 | §11.2 | CSSOM exposure of `@page` internals | PASS 9/9 |
| s3 | §11.3 | `@counter-style` fixed maps inside margin boxes | PASS 7/7 |
| s4 | §11.4 | anchor → page fidelity of Chromium's PDF metadata | PASS 6/6 |
| s5 | §11.5 | `<thead>` repetition: per page vs per column | PASS 8/8 |
| s6 | §11.6 | named page + pseudo-page combinators | PASS 6/6 |
| s7 | new | layout-neutral instrumentation for Tier 3 | PASS 5/5 |
| s8 | §8, M1/M3 | compiler: tiers 1–3, bleed/marks, boxes, signatures | PASS 19/19 |
| s9 | §2, §10 | DX and performance claims | PASS 9/9 |

---

## 1. The premise (§4) — verified, not assumed

Every "native" row of the proposal's table was asserted against the browser
rather than against documentation (s0):

- `@page size` honored via `preferCSSPageSize` (6×9in → MediaBox 432×648pt exactly)
- `@page margin` changes fragmentation (0.5in → 4pp, 2in → 15pp on the same content)
  and ink starts inside the declared margin box
- named pages carry their own geometry and force breaks between names
  (8in cover page → 6in body page, in one document)
- **all 16 margin boxes render**, `counter(page)`/`counter(pages)` are correct on
  every page, and margin-box ink sits in the margin band (y=29pt inside a 72pt margin)
- `:first` / `:left` / `:right` all match; `break-before: page`, `widows`,
  `orphans` behave
- tagged PDF, document outline and embedded font subsets come out of
  `Page.printToPDF`

And the gaps are still gaps, so the shims are still needed:
`CSS.supports('string-set')` false, `target-counter()` false, `bleed`/`marks`
dropped by the parser, `float: footnote` false, `@page :nth()` unparsed.

## 2. The load-bearing claim (§11.1) — holds

Method: every block in a generated book carries a visible token, so the *same*
element can be located in the PDF (by text, via an independent PyMuPDF reader)
and in the DOM (by client rects). The two vectors are diffed element by element
— no screenshots, no eyeballing.

**331/331 blocks on the same page across 5 documents, with exact page counts**
(19pp, 17pp, 21pp, 17pp named-pages, 15pp dense). Decoration is provably
layout-neutral: 0 blocks move when the decoration layer is added.

That result took two fixes, both found by the spike (F3, F4 below). Before them
the same corpus scored 282/331.

At **208 pages** parity is no longer exact: one boundary event, 30 % into the
book, leaves the viewer one page longer (209 vs 208). It was traced to a break
that fits with ~0.1 px to spare, where the two fragmentation contexts round the
other way; it is *not* a construct class — tables, `break-after: avoid`, margin
truncation at fragmentainer boundaries and orphans/widows were each swept
across page positions and agree exactly (36/36, 40/40, 28/28 configurations).
The compiler is unaffected: the PDF is ground truth. The viewer's page *numbers*
after such an event are off by one.

> **Amendment to §7's fidelity stance:** "near-print fidelity" should be stated
> as *exact at chapter scale, ≤1 page drift per ~200 pages*. For a viewer whose
> job is reading and iteration that is fine; for a printed TOC it is not, which
> is why cross-references are compiled from the PDF's own metadata (§8 Tier 3)
> and never from the viewer's page map.

## 3. Findings that amend the proposal

### F1 — Tier 3's measurement channel is simpler than proposed (s4, s7)

The proposal expects to "inject zero-size internal anchors … harvest the
document outline (heading → page) and link annotations (anchor → page)".
Reality is better: Chromium emits a **`/Dests` name tree keyed by the element's
`id`**, and it resolves 14/14 ids to the page the target actually printed on.
No rect ordering, no outline-title matching, no text heuristics.

Two constraints, both measured:

1. Only ids that something *links to* appear in `/Dests` — so Tier 3 must still
   instrument what it measures.
2. Instrumentation is free: links inside a `display:none` container still
   produce the destinations, and the page count is unchanged (s7 checked four
   forms; all four are layout-neutral). **Tier 3's measurement provably cannot
   perturb the layout it measures** — the fixpoint loop only has to converge on
   injected *content*.

Measured: cross-references reach a fixpoint in **2 passes**, and the resulting
page map matches where every target actually printed.

### F2 — the proposal's own §6 example does the wrong thing (s1, s6)

```css
h1 { page: chapter; string-set: chapter-title content(); }   /* §6 as written */
```

In print this puts the **heading alone on a `chapter` page** and breaks straight
back to the default page for the body — so the running header appears on one
page per chapter, and the book grows a page per chapter. Verified: 19pp with
`page:` on `h1` vs 17pp with `page:` on the container, and the PDF's first page
contains nothing but the heading.

The correct authoring is `section { page: chapter }`. The viewer now detects the
descendant form and reports it with the fix instead of silently diverging, and
the fixtures/README use the container form. **§6 and the `@folio/paper` presets
must be corrected.**

### F3 — `<thead>` repeats per print page but not per multicol column (s5)

Chromium repeats `<thead>` (and `<tfoot>`) on every *page* a table spans, and on
no *column* at all. The repeated header consumes height, so uncompensated the
screen fits more rows per page than print — measured as
`[23,23,23,23,23,5]` in print vs `[23,24,24,24,24,1]` on screen, and it was the
single divergence in the first S1 run.

The viewer now **clones the header into the continuation fragment** (so the
reader sees what print draws) and reserves exactly its height, iterating to a
fixed point. After compensation rows-per-page match print exactly, and the block
after the table lands on the same page.

Additionally: print never strands a repeated header — a header fragment must be
followed by at least one row, or the whole table moves on. Multicol will happily
park a lone header at the bottom of a column, so the viewer pushes the table
instead. This was the cause of the remaining `dense` divergences.

`<tfoot>` is not compensated (print reserves it at the *end* of each fragment,
which a single in-flow shim cannot model); it is reported as a warning rather
than silently wrong.

### F4 — measurement must read the page a block's *first line* lands on

A block whose box starts at the very bottom of a page but whose first line falls
on the next one is reported differently by a box-based reader and a text-based
one. The viewer exposes both `pageOf` (box) and `pageRangeOf` (span); the parity
harness uses first-line semantics on both sides.

### F5 — `:first` cannot express a chapter opener (s6)

`@page chapter:first` combines correctly *and* honors geometry overrides
(`margin-top: 2.5in` → body ink at 192pt instead of 73pt) — but `:first` means
the first page of the **document**, not of the run. With a cover page ahead of
it, `@page chapter:first` never matches.

So a per-chapter opener template is not expressible in standard Paged Media at
all — this is an engine/spec limit, **not** a viewer limitation as §7 implies.
Presets should steer chapter openers to the content-padding pattern
(`h1 { padding-top: … }`), which both renderers reproduce exactly.

### F6 — CSSOM is not enough, exactly as §11.2's fallback assumed (s2)

`CSSPageRule` *does* expose margin at-rules as `CSSMarginRule` children, and
`chapter:first` round-trips through `selectorText`. But every construct Folio has
to shim is invisible: `bleed`, `marks`, `string-set` and `target-counter()`
content are all dropped. `gcpm-extract` keeps its text path as primary and
recovers all four (unit-tested, 16 tests).

## 4. The compiler (s8) — M1 and M3 behaviours verified

- **Tier routing works**: a plain document takes Tier 1 (one pass, no
  synthesis); a chaptered one takes Tier 2 (still one pass); only
  `target-counter()`/page-granular strings pull in Tier 3. A `string-set`
  nobody reads must not drag a document into measurement — that bug was found
  and fixed here.
- **Running heads**: each chapter gets a generated `@page chapter--N` whose
  margin-box content is the literal heading text. Verified per-chapter, not
  global (4 pages head "Chapter 3", none of them mentioning "Chapter 1").
- **Bleed / marks / boxes**: MediaBox = trim + 2×bleed + 2×slug
  (486×702pt for 6×9in + 0.125in + 0.25in), BleedBox and TrimBox exact, crop
  marks drawn (8 strokes, all outside the bleed box).
- **Nothing drifts**: with bleed and slug added, body ink and the folio both sit
  at the *same* offset from the trim edge as in a no-bleed build (21.83pt and
  625.37pt, matched to <1pt).
- **Signature padding**: 12 → 16 pages for `--signature 8`.
- **Tier 3**: converges in 2 passes; no unresolved `(p. ?)` references; every
  rendered reference points inside the document and at the page where the target
  actually printed.
- **`@counter-style` maps work** (s3): per-page generated strings render
  correctly, including `&`, `—` and non-ASCII. Pages beyond the symbol list fall
  back to the decimal counter, so Tier 3 emits one symbol per page.

## 5. DX and performance (s9) — measured, with one claim adjusted

| claim (§2/§10) | measured |
| --- | --- |
| viewer ≈10 KB, zero runtime deps | **23 KB minified, 9.0 KB gzipped**, 0 runtime deps |
| viewer update < 100 ms on a full book | **~25 ms at chapter/book scale (15–21pp)**; **215–254 ms for 209 pages** (~1.0–1.2 ms/page) |
| warm proof for a 200-page book < 2 s | **1.9–2.5 s for 208 pages** (cold, incl. browser launch: 3.2–4.5 s) |
| dev server: hot reload + warm proof | verified end to end (WS reload on file change; `/proof.pdf` served from a warm Chromium) |

The `<100 ms on a full book` claim does not hold at 200 pages; it holds
comfortably at chapter scale. Of the 215 ms, native fragmentation is ~0.5 ms/page
and the rest is Folio's own work — most of which was recovered during the spike
by batching reads and writes in the header compensation (114 ms → 42 ms on a
112-page book). §2 should say **"instant per chapter, ~0.2 s for a 200-page
book"**.

The warm-proof claim is met within run-to-run variance; `folio dev` reuses one
warm browser across edits, which is what makes it possible.

## 6. What this spike does not answer

- `float: footnote` (a v1 non-goal) — untouched.
- Real-content validation: fixtures are generated, not a real Dimm City chapter.
  The parity harness takes any HTML, so pointing it at real content is the next
  step and the right gate before M2.
- Cross-platform Chromium: one Linux build, one version. The proposal's
  version-pin + parity-in-CI mitigation is exactly right, and this suite is
  already the CI job (32 s).
- The PDF/X hand-off: the compiler's output contract (RGB, correct boxes,
  embedded fonts) is verified, but the Ghostscript stage was not exercised — no
  `gs` in this environment.

## 7. Recommended next steps

1. Correct §6 of the proposal and the presets per **F2** and **F5**.
2. Adopt the `/Dests` measurement channel from **F1** — it removes the annotation
   rect-ordering machinery from the Tier 3 design.
3. Run the parity harness against a real Dimm City chapter before committing to
   M2's fidelity claims; keep drift-per-100-pages as the metric.
4. Wire `bun run spikes` into CI against a pinned Chromium and against latest, as
   the upstream-regression alarm §9 asks for.
