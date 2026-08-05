# Folio — spike

**Standard CSS in, pages out. No layout engine shipped.**

A working spike of the paged.js replacement proposed for Gutterpress: two thin
programs around Chromium's *native* fragmentation instead of a JavaScript
pagination engine.

- **viewer** (`src/viewer/`) — a browser document that lets Chromium fragment
  content into pages on screen with multicol, then decorates the result with
  page sheets, the 16 margin boxes, running strings and cross-references.
  23 KB minified / 9 KB gzipped, zero runtime dependencies.
- **compiler** (`src/compiler/`) — a Bun CLI that drives the *system* Chromium
  over raw CDP, fills the spec gaps Chromium hasn't shipped by synthesizing
  standard CSS, and post-processes the PDF (boxes, crop marks, signatures).
- **shared** (`src/shared/`) — `gcpm-extract` (the only code that reads CSS, and
  it never rewrites the author's files), the content-value evaluator, the CDP
  client and the PDF reader.

Everything here is verified against a real Chromium by the spikes in `spikes/`.
Results and the verdict on the proposal: [`RESULTS.md`](./RESULTS.md).

## Run it

```bash
bun install
bun run spikes            # all 10 spikes against a real Chromium (~35s)
bun spikes/run-all.ts s1  # just one
bun test                  # unit tests for the shared modules
bunx tsc --noEmit -p tsconfig.json
```

The spikes need a Chromium binary. Resolution order: `$FOLIO_CHROMIUM`,
`$PUPPETEER_EXECUTABLE_PATH`, `/opt/pw-browsers/chromium`, `/usr/bin/chromium`,
`/usr/bin/chromium-browser`, `/usr/bin/google-chrome`.
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
spikes/          s0…s9, the harness, and the PyMuPDF probe
fixtures/        deterministic book generator (tokenised so pages can be diffed)
out/             artifacts: PDFs, generated CSS, results.json, results.md
```
