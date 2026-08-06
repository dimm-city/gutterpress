/**
 * Kitchen-sink book: all 8 migration constructs combined in one document at
 * realistic scale, for realistic build-time measurement. Deliberately
 * separate from the 8 small fixtures (each of those builds in seconds) so CI
 * can skip this one — see `runner.ts`'s `--kitchen-sink` flag.
 *
 * Not a new construct: every technique here is lifted from fixtures 01-08,
 * just repeated and scaled up. Page names are namespaced per section so the
 * combined stylesheet doesn't collide.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const TILE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAEUlEQVR42mNk+M9QzzBIAAgAAf8L/ZO0YXcAAAAASUVORK5CYII=";

const FILLER = (n: number, label: string) =>
  Array.from(
    { length: n },
    (_, i) =>
      `<p>${label}-${i + 1} Gutter press folio signature quire recto verso colophon imposition kerning ligature ascender descender baseline leading widow orphan galley codex vellum quarto octavo marginalia rubric.</p>`,
  ).join("\n");

export function kitchenSinkHtml(): string {
  const css = `
@page { size: 5in 7.5in; margin: 0.75in; @bottom-center { content: counter(page); font-size: 9pt; } }
html { font: 10.5pt/1.4 'DejaVu Serif', Georgia, serif; }
body { margin: 0; }
p { margin: 0 0 7pt; }
h1 { font-size: 15pt; break-before: page; margin: 0 0 8pt; }

/* --- 01 filter + clip-path --- */
.card {
  width: 2.8in; height: 1in; margin: 0 0 12pt; background: #ddc9a3;
  clip-path: polygon(4% 0, 96% 0, 100% 30%, 100% 100%, 0 100%, 0 30%);
  filter: drop-shadow(3pt 3pt 0 #7a6a4a); padding: 8pt; box-sizing: border-box;
}

/* --- 02 full-bleed + running heads --- */
@page fb {
  size: 5in 7.5in; margin: 0.6in;
  background: #f2e9d8 url(${TILE}) repeat; background-position: 0 0;
  @top-center { content: string(fb-title); font-size: 9pt; background: #f2e9d8 url(${TILE}) repeat; background-position: 0 -0.6in; }
  @bottom-center { content: counter(page); font-size: 9pt; background: #f2e9d8 url(${TILE}) repeat; background-position: -0.6in -6.9in; }
  @top-left{background:#f2e9d8;} @top-right{background:#f2e9d8;}
  @bottom-left{background:#f2e9d8;} @bottom-right{background:#f2e9d8;}
  @left-top{background:#f2e9d8;} @left-middle{background:#f2e9d8;} @left-bottom{background:#f2e9d8;}
  @right-top{background:#f2e9d8;} @right-middle{background:#f2e9d8;} @right-bottom{background:#f2e9d8;}
}
.fb-section { page: fb; background: #f2e9d8; }
.fb-section h1 { string-set: fb-title content(); }

/* --- 03 mirrored binding --- */
@page bind {
  size: 5in 7.5in; margin-top: 0.75in; margin-bottom: 0.75in;
  margin-left: 0.625in; margin-right: 0.875in;
  @bottom-center { content: counter(page); font-size: 9pt; }
}
@page bind:left  { margin-left: 0.875in; margin-right: 0.625in; }
@page bind:right { margin-left: 0.625in; margin-right: 0.875in; }
.bind-section { page: bind; }

/* --- 04 folio restart --- */
@page front { @bottom-center { content: counter(page, lower-roman); font-size: 9pt; } }
@page body-main { @bottom-center { content: counter(page); font-size: 9pt; } }
.front { page: front; }
.page-chapter-start { page: body-main; counter-reset: page 1; }

/* --- 05 margin-box furniture --- */
@page chip {
  @bottom-right {
    content: "CH." counter(page); background: #2b2b2b; color: #fff;
    border: 1pt dashed #999; width: fit-content; padding: 2pt 8pt;
    font: 8pt/1 'DejaVu Sans Mono', monospace; letter-spacing: 0.5pt; text-transform: uppercase;
  }
}
.chip-section { page: chip; }

/* --- 06 xref + toc --- */
nav.toc ol { list-style: none; margin: 0; padding: 0; }
nav.toc li::after { content: leader(dotted) target-counter(attr(href), page); }
a.xref::after { content: " (p. " target-counter(attr(href), page) ")"; }

/* --- 07 multicol break-avoid --- */
.multicol { columns: 2; column-gap: 0.3in; }
.multicol .mc-card { break-inside: avoid; margin: 0 0 8pt; padding: 5pt; border: 0.75pt solid #888; }

/* --- 08 recto/verso + blank --- */
h1.chapter-start { break-before: right; }
@page :blank { @top-center { content: none; } @bottom-center { content: none; } }

/* CSS class, not inline style="" — Paged.js's polisher reads break-before
   only from stylesheet rules (measured building fixture 03: an inline break
   is silently ignored by Paged.js, honored by native Chromium print). */
.brk { break-before: page; }
`;

  const cards = Array.from(
    { length: 8 },
    (_, i) => `<div class="card"><p>SENTINEL-KS-CARD-${i + 1} filtered card</p></div>`,
  ).join("\n");

  const fbChapters = Array.from(
    { length: 3 },
    (_, i) =>
      `<section class="fb-section brk"><h1>KS Full-bleed Chapter ${i + 1}</h1>${FILLER(4, `SENTINEL-KS-FB${i + 1}`)}</section>`,
  ).join("\n");

  const bindPages = Array.from(
    { length: 6 },
    (_, i) =>
      `<section class="bind-section brk">${FILLER(3, `SENTINEL-KS-BIND${i + 1}`)}</section>`,
  ).join("\n");

  const chipPages = Array.from(
    { length: 4 },
    (_, i) =>
      `<section class="chip-section brk">${FILLER(3, `SENTINEL-KS-CHIP${i + 1}`)}</section>`,
  ).join("\n");

  const mcCards = Array.from(
    { length: 16 },
    (_, i) =>
      `<div class="mc-card"><p>SENTINEL-KS-MC${String(i + 1).padStart(2, "0")}-TOP</p><p>SENTINEL-KS-MC${String(i + 1).padStart(2, "0")}-BOT</p></div>`,
  ).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Kitchen sink — Folio migration fixtures combined</title>
<style>${css}</style>
</head>
<body>
<main>

<section>
  <h1>Section 1 — filter + clip-path</h1>
  ${cards}
</section>

${fbChapters}

${bindPages}

<section class="front brk"><p>SENTINEL-KS-FRONT-i title page</p></section>
<section class="front brk"><p>SENTINEL-KS-FRONT-ii copyright</p></section>
<section class="page-chapter-start brk">
  <h1>KS Body Chapter One</h1>
  ${FILLER(4, "SENTINEL-KS-BODY1")}
</section>
<section class="brk">${FILLER(4, "SENTINEL-KS-BODY2")}</section>

${chipPages}

<section class="brk">
  <h1>Contents</h1>
  <nav class="toc"><ol>
    <li><a href="#ks-ch-a">KS Chapter A</a></li>
    <li><a href="#ks-ch-b">KS Chapter B</a></li>
  </ol></nav>
</section>
<section class="brk">
  <h1 id="ks-ch-a">KS Chapter A</h1>
  <p>SENTINEL-KS-XR-A see also <a class="xref" href="#ks-ch-b">Chapter B</a>.</p>
  ${FILLER(3, "SENTINEL-KS-XRFILL-A")}
</section>
<section class="brk">
  <h1 id="ks-ch-b">KS Chapter B</h1>
  <p>SENTINEL-KS-XR-B refers back to <a class="xref" href="#ks-ch-a">Chapter A</a>.</p>
  ${FILLER(3, "SENTINEL-KS-XRFILL-B")}
</section>

<section class="brk">
  <h1>Section 7 — multicol break-avoid</h1>
  <div class="multicol">${mcCards}</div>
</section>

<section class="brk">
  <p>SENTINEL-KS-RV-FRONT front matter before recto/verso chapters</p>
  <h1 class="chapter-start" id="ks-c2">SENTINELKSCHAPTERTWO</h1>
  ${FILLER(3, "SENTINEL-KS-RV2")}
  <h1 class="chapter-start" id="ks-c3">SENTINELKSCHAPTERTHREE</h1>
  ${FILLER(3, "SENTINEL-KS-RV3")}
</section>

</main>
</body>
</html>`;
}

if (import.meta.main) {
  const out = join(import.meta.dir, "99-kitchen-sink.html");
  writeFileSync(out, kitchenSinkHtml());
  console.log(`wrote ${out}`);
}
