# Folio — spike

**Standard CSS in, pages out. No layout engine shipped.**

A working spike of the paged.js replacement proposed for Gutterpress: two thin
programs around Chromium's *native* fragmentation instead of a JavaScript
pagination engine.

- **viewer** (`src/viewer/`) — a browser document that lets Chromium fragment
  content into pages on screen with multicol, then decorates the result with
  page sheets, the 16 margin boxes, running strings and cross-references.
  27 KB minified / 10 KB gzipped, zero runtime dependencies.
- **compiler** (`src/compiler/`) — a Bun CLI that drives the *system* Chromium
  over raw CDP, fills the spec gaps Chromium hasn't shipped by synthesizing
  standard CSS, and post-processes the PDF (boxes, crop marks, signatures).
- **shared** (`src/shared/`) — `gcpm-extract` (the only code that reads CSS, and
  it never rewrites the author's files), `synthesis` (every rule that *decides*
  something, shared by both renderers), the content-value evaluator, the CDP
  client and the PDF reader.

Everything here is verified against a real browser by the spikes in `spikes/`.

## Status (2026-08-06)

**The engine question is settled in Folio's favor; the next work is
integration, not pagination.** The final field-guide A/B (COMPARISON.md) shows
the two engines agree to 1.3% in pages with glyph-identical type once the
confounds are shimmed away, Folio is the more standards-faithful renderer
(mirrored binding gutters that Paged.js drops; type at the size the CSS
declares), and the numbers reproduce exactly on `release/0.10.0`. Two known
Folio gaps remain (front-matter folio restart; export is 2 print passes), both
with identified mechanisms. **Start at [`MIGRATION.md`](./MIGRATION.md)** — it
records the ratified decisions (notably: the A/B `zoom` shim is never shipped;
CSS tokens get retuned instead), the ordered plan, and every measurement
pitfall this spike paid for.

## The documentation

Read in this order depending on what you need.

| Document | What it is |
| --- | --- |
| [`ENGINE.md`](./ENGINE.md) | **What Chromium actually does** with CSS Paged Media — every claim measured, not read off a compatibility table. The durable part: useful to anyone building on the native print path, Folio or not. |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | **The design rules and the bug that taught each one.** Why synthesis lives in one shared module, why measurement must be invisible, why generated CSS is emitted fully resolved. |
| [`RESULTS.md`](./RESULTS.md) | The M0 verdict on the original proposal, spike by spike, with the findings that amend it. |
| [`COMPARISON.md`](./COMPARISON.md) | Head-to-head against the current Paged.js pipeline on the same book. |
| [`DIFFERENCES.md`](./DIFFERENCES.md) | The exhaustive artifact diff, the full defect ledger (fixed / deleted / inherent), and the three previously-untested areas. |
| [`MIGRATION.md`](./MIGRATION.md) | **The adoption plan — start here to pick up the work.** Ratified decisions (no zoom in production, reflow accepted, fixtures over the field guide), the four regardless-of-Folio fixes, the integration spike, the two open gaps, and the pitfall list. |

The two rules worth knowing before touching the code, both learned the hard way:

1. **Every synthesis decision is one shared pure function** — there is no
   compiler-side copy and viewer-side copy to keep in sync, because a twin
   silently rots the moment one side changes (`ARCHITECTURE.md` §1).
2. **`CSS.supports` is not a feature detector here.** The engine reports
   `target-counter()` as supported while rendering nothing. Render-probe
   (`ENGINE.md` §2). This is also why Folio pins its engine rather than
   feature-detecting: the failure had no error and no detectable signal.

## Run it

```bash
bun install
bun run spikes            # all 15 spikes against a real browser (~19s, 217 checks)
bun run compare           # current Gutterpress vs this spike, same book
bun compare/diff-report.ts a.pdf b.pdf   # content-aligned artifact diff
bun spikes/run-all.ts s1  # just one
bun test                  # unit tests for the shared modules
bunx tsc --noEmit -p tsconfig.json

# Shimmed A/B against a Paged.js-coupled book (full recipe: COMPARISON.md):
bun compare/apply-shim.ts <staged>/book.html          # writes book.shimmed.html
FOLIO_INPUT=<staged>/book.shimmed.html bun compare/run.ts <project>
python3 compare/ab-report.py <gp.pdf> <folio.pdf>     # poppler-only readback
```

On big books, expect the Gutterpress leg to take ~4.5 min and each Folio print
pass ~3.5 min; stage B (Paged.js in-browser) has never completed on a 300-page
book — kill the run after the compile legs and use `ab-report.py`.

The spikes need a **Chrome/Chromium 151 or newer** binary — Folio is pinned to
151 (`REQUIRED_MILESTONE` in `src/shared/cdp.ts`) and refuses to launch an older
one rather than paginate differently without saying so. Resolution order:
`$FOLIO_CHROMIUM`, `$PUPPETEER_EXECUTABLE_PATH`, `/opt/pw-browsers/chromium`,
`/usr/bin/chromium`, `/usr/bin/chromium-browser`, `/usr/bin/google-chrome`.

PDF verification uses an independent reader — PyMuPDF if importable, poppler
(`pdftotext`/`pdfinfo`/`pdffonts`/`pdftoppm`) otherwise; `probe.ts` picks one
automatically. The PDF/X spike (`s12`) needs `ghostscript` and skips cleanly
without it; `s13` renders with poppler and needs `PIL`.
`spikes/pdfprobe.py` (PyMuPDF) is the independent PDF reader used to check
Chromium's output — verification only, never part of the runtime.

## Use it

```bash
bun fixtures/make-book.ts                     # generate the test book

# compile to PDF (tier is chosen automatically)
bun src/cli.ts build fixtures/book-named.html -o out/book.pdf \
    --signature 4 --emit-css --title "A Book"

# live preview: static serve + hot reload + /proof.pdf off a warm Chromium
bun src/cli.ts dev fixtures/book-named.html --port 4321

# static, embeddable viewer bundle (the embed contract is an iframe)
bun src/cli.ts export fixtures/book-named.html -o dist/viewer
```

The viewer bundles are built with:

```bash
bun build src/viewer/global.ts   --target=browser --format=iife --outfile=dist/folio.js
bun build src/viewer/global.ts   --target=browser --format=iife --minify --outfile=dist/folio.min.js
bun build src/compiler/agent.ts  --target=browser --format=iife --outfile=dist/folio-agent.js
```

## What the author writes

Only standard W3C Paged Media / GCPM — the syntax documented on MDN:

```css
@page {
  size: 6in 9in;
  bleed: 0.125in;                /* Chromium ignores; the compiler honors it */
  marks: crop;
  margin: 0.75in 0.625in;
  @bottom-center { content: counter(page); font-size: 9pt; }
}
section { page: chapter; }        /* NOT `h1` — see RESULTS.md, finding F2 */
h1 { break-before: page; string-set: chapter-title content(); }
@page chapter { @top-right { content: string(chapter-title); } }
a.xref::after { content: " (p. " target-counter(attr(href url), page) ")"; }
```

No `.page` divs, no manual `padding: margin + bleed` maths, no per-page
`page-break-after`. Content flows; geometry lives in `@page`.

## Layout of the spike

```
src/shared/      gcpm-extract, content-value, cdp, pdf-inspect   (+ unit tests)
src/viewer/      fragment (strips + page map), decorate, viewer.css, entries
src/compiler/    tier2 (synthesis), build (tiers 1–3 + fixpoint), postprocess, agent
src/cli.ts       folio build | dev | export
spikes/          s0…s14, the harness, and the PDF probes (PyMuPDF + poppler)
compare/         head-to-head vs the current Paged.js pipeline (same input)
fixtures/        deterministic book generator (tokenised so pages can be diffed)
out/             artifacts: PDFs, generated CSS, results.json, results.md
```
