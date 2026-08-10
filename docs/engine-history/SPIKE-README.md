# Folio — spike

**Standard CSS in, pages out. No layout engine shipped.**

> Engine source promoted 2026-08-06 to `packages/cli/src/engine/` — per the
> ratified naming decision, "Folio" is retired as a project name and is now
> **the Gutterpress engine**, core to Gutterpress rendering rather than a
> separate package. This directory remains the spike/verification harness
> (`spikes/`, `fixtures/`, `compare/`) that exercises it; see
> `src/README.md` for exactly what moved where.

A working spike of the paged.js replacement proposed for Gutterpress: two thin
programs around Chromium's *native* fragmentation instead of a JavaScript
pagination engine.

- **viewer** (`packages/cli/src/engine/viewer/`) — a browser document that lets
  Chromium fragment content into pages on screen with multicol, then decorates
  the result with page sheets, the 16 margin boxes, running strings and
  cross-references. 27 KB minified / 10 KB gzipped, zero runtime dependencies.
- **compiler** (`packages/cli/src/engine/compiler/`) — a Bun CLI that drives
  the *system* Chromium over raw CDP, fills the spec gaps Chromium hasn't
  shipped by synthesizing standard CSS, and post-processes the PDF (boxes,
  crop marks, signatures).
- **shared** (`packages/cli/src/engine/shared/`) — `gcpm-extract` (the only
  code that reads CSS, and it never rewrites the author's files), `synthesis`
  (every rule that *decides* something, shared by both renderers), the
  content-value evaluator, the CDP client and the PDF reader.

Everything here is verified against a real browser by the spikes in `spikes/`.

## Status (2026-08-06)

**The engine question is settled in Folio's favor; the next work is
integration, not pagination.** The field guide's over-wide layout that used to
require an A/B scale shim is fixed upstream (`dc-op-manual` `fc12278`); the
honest, shim-free A/B (COMPARISON.md "HONEST A/B REPORT") shows the two
engines agree to 2% in pages with byte-identical type, both now mirror binding
gutters and both now restart front-matter folio numbering. **Start at
[`MIGRATION.md`](./MIGRATION.md)** — it records the ratified decisions
(notably: no production stylesheet ships `body { zoom }` — moot now that the
confound is fixed upstream, but still the rule), the ordered plan, and every
measurement pitfall this spike paid for.

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
bunx tsc --noEmit -p tsconfig.json

# the engine's own unit tests now live with its source, in packages/cli:
(cd ../../packages/cli && bun test src/engine)

# Honest A/B against a Paged.js-coupled book, no shim needed (COMPARISON.md
# "HONEST A/B REPORT" has the full recipe — stage once, build both engines
# from the same book.html, read back with ab-report.py):
bun compare/stage-book.ts <project> <outdir>
python3 compare/ab-report.py <gp.pdf> <folio.pdf>     # poppler-only readback

# compare/apply-shim.ts still exists for furniture-only comparisons (the
# field guide styles Paged.js's DOM directly for its brick sheet/chips —
# fg-shim.css has standard-CSS equivalents), but is no longer part of the
# default recipe now that the scale confound is fixed upstream.
```

On big books, expect the Gutterpress leg to take ~4.5 min and each Folio print
pass ~3.5 min; stage B (Paged.js in-browser) has never completed on a 300-page
book — kill the run after the compile legs and use `ab-report.py`.

The spikes need a **Chrome/Chromium 151 or newer** binary — Folio is pinned to
151 (`REQUIRED_MILESTONE` in `packages/cli/src/engine/shared/cdp.ts`) and refuses to launch an older
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

# compile to PDF (tier is chosen automatically) — the standalone dev CLI now
# lives at packages/cli/src/engine/dev-cli.ts (promoted with the rest of the
# engine); `spikes/bundles.ts` rebuilds this dir's own dist/ copy on demand.
DEV_CLI=../../packages/cli/src/engine/dev-cli.ts
bun $DEV_CLI build fixtures/book-named.html -o out/book.pdf \
    --signature 4 --emit-css --title "A Book"

# live preview: static serve + hot reload + /proof.pdf off a warm Chromium
bun $DEV_CLI dev fixtures/book-named.html --port 4321

# static, embeddable viewer bundle (the embed contract is an iframe)
bun $DEV_CLI export fixtures/book-named.html -o dist/viewer
```

The viewer bundles are built with (this repo's own copy, via `spikes/bundles.ts`;
`packages/cli` ships its OWN prebuilt/embedded copy — see
`packages/cli/scripts/build-engine-bundles.mjs`):

```bash
ENGINE=../../packages/cli/src/engine
bun build $ENGINE/viewer/global.ts   --target=browser --format=iife --outfile=dist/folio.js
bun build $ENGINE/viewer/global.ts   --target=browser --format=iife --minify --outfile=dist/folio.min.js
bun build $ENGINE/compiler/agent.ts  --target=browser --format=iife --outfile=dist/folio-agent.js
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
packages/cli/src/engine/shared/    gcpm-extract, content-value, cdp, pdf-inspect (+ unit tests)
packages/cli/src/engine/viewer/    fragment (strips + page map), decorate, viewer.css, entries
packages/cli/src/engine/compiler/  tier2 (synthesis), build (tiers 1–3 + fixpoint), postprocess, agent
packages/cli/src/engine/dev-cli.ts standalone dev CLI: build | dev | export
src/                                (this dir) empty — see src/README.md
spikes/          s0…s14, the harness, and the PDF probes (PyMuPDF + poppler)
compare/         head-to-head vs the current Paged.js pipeline (same input)
fixtures/        deterministic book generator (tokenised so pages can be diffed)
out/             artifacts: PDFs, generated CSS, results.json, results.md
```
