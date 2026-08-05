/**
 * Deterministic test book generator.
 *
 * Every block carries a visible token (`§P007`) so the SAME element can be
 * located in the PDF (by text) and in the DOM (by id) — that is what makes the
 * multicol↔print parity diff in S1 an objective measurement rather than a
 * screenshot vibe check.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** mulberry32 — deterministic, tiny. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS =
  `gutter press folio signature quire recto verso colophon imposition kerning ligature
   ascender descender baseline leading widow orphan galley codex vellum quarto octavo
   marginalia rubric incipit explicit catchword deckle foxing forme chase quoin furniture
   platen tympan frisket dandy roll watermark chapbook broadside ephemera` .split(/\s+/);

export interface BookOptions {
  seed?: number;
  chapters?: number;
  blocksPerChapter?: number;
  /** include the constructs that stress fragmentation */
  stress?: boolean;
  /** use named pages (`page: chapter`) — exercises multi-strip layout */
  namedPages?: boolean;
  /** include cross-references (Tier 3) */
  xrefs?: boolean;
}

export function bookCss(opts: BookOptions = {}): string {
  return `
@page {
  size: 6in 9in;
  bleed: 0.125in;
  marks: crop;
  margin: 0.75in 0.625in 0.75in 0.625in;
  @bottom-center { content: counter(page); font-size: 9pt; }
}
@page :first { @bottom-center { content: ""; } }

html { font: 11pt/1.45 'DejaVu Serif', Georgia, serif; }
body { margin: 0; }
main { margin: 0; }

h1 {
  font-size: 20pt;
  line-height: 1.2;
  margin: 0 0 18pt;
  break-before: page;
  break-after: avoid;
  string-set: chapter-title content();
}
h2 {
  font-size: 13pt;
  margin: 16pt 0 6pt;
  break-after: avoid;
  string-set: section-title content();
}
p { margin: 0 0 8pt; widows: 2; orphans: 2; text-align: justify; }
ul, ol { margin: 0 0 8pt 1.2em; padding: 0; }
li { margin: 0 0 3pt; }
blockquote {
  margin: 10pt 1.2em;
  padding-left: 8pt;
  border-left: 2pt solid #999;
  font-style: italic;
}
figure { margin: 12pt 0; break-inside: avoid; }
figure img { display: block; width: 100%; height: auto; }
figcaption { font-size: 9pt; margin-top: 4pt; }
table { width: 100%; border-collapse: collapse; margin: 10pt 0; font-size: 10pt; }
th, td { border: 0.5pt solid #666; padding: 3pt 5pt; text-align: left; }
.callout {
  break-inside: avoid;
  border: 1pt solid #333;
  padding: 8pt;
  margin: 10pt 0;
  background: #f2f2f2;
}
${opts.namedPages ? `section { page: chapter; }
@page chapter { @top-right { content: string(chapter-title); font-size: 8pt; } }\n` : ""}
${opts.xrefs ? `a.xref { text-decoration: none; color: inherit; }
a.xref::after { content: " (p. " target-counter(attr(href url), page) ")"; }\n` : ""}`;
}

const SVG = (n: number, h: number) =>
  `data:image/svg+xml;utf8,` +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 ${h}" width="400" height="${h}">` +
      `<rect width="400" height="${h}" fill="hsl(${(n * 47) % 360} 40% 78%)"/>` +
      `<text x="200" y="${h / 2}" font-size="28" text-anchor="middle" fill="#222">FIG ${n}</text></svg>`,
  );

export function bookHtml(opts: BookOptions = {}): string {
  const {
    seed = 7,
    chapters = 3,
    blocksPerChapter = 22,
    stress = true,
    xrefs = false,
  } = opts;
  const rand = rng(seed);
  const sentence = (n: number) =>
    Array.from({ length: n }, () => WORDS[Math.floor(rand() * WORDS.length)])
      .join(" ")
      .replace(/^./, (c) => c.toUpperCase()) + ".";

  let token = 0;
  const tok = () => `§P${String(++token).padStart(3, "0")}`;
  const body: string[] = [];
  const xrefTargets: string[] = [];

  for (let c = 1; c <= chapters; c++) {
    const parts: string[] = [];
    const chapterId = `ch${c}`;
    parts.push(
      `<h1 id="${chapterId}">${tok()} Chapter ${c}: ${sentence(3).replace(".", "")}</h1>`,
    );
    xrefTargets.push(chapterId);
    for (let b = 0; b < blocksPerChapter; b++) {
      const t = tok();
      const id = `b${c}-${b}`;
      const kind = stress ? rand() : 0.5;
      if (b % 7 === 3) {
        parts.push(`<h2 id="${id}">${t} ${sentence(4).replace(".", "")}</h2>`);
        xrefTargets.push(id);
      } else if (kind > 0.92) {
        parts.push(
          `<figure id="${id}"><img src="${SVG(b, 120 + Math.floor(rand() * 160))}" alt=""><figcaption>${t} ${sentence(6)}</figcaption></figure>`,
        );
      } else if (kind > 0.86) {
        parts.push(
          `<div class="callout" id="${id}"><strong>${t}</strong> ${sentence(28)}</div>`,
        );
      } else if (kind > 0.8) {
        parts.push(
          `<table id="${id}"><thead><tr><th>${t}</th><th>Value</th></tr></thead><tbody>` +
            Array.from(
              { length: 6 + Math.floor(rand() * 10) },
              (_, i) => `<tr><td>${sentence(2)}</td><td>${i + 1}</td></tr>`,
            ).join("") +
            `</tbody></table>`,
        );
      } else if (kind > 0.72) {
        parts.push(
          `<blockquote id="${id}"><p>${t} ${sentence(24)}</p></blockquote>`,
        );
      } else if (kind > 0.64) {
        parts.push(
          `<ul id="${id}">` +
            `<li>${t} ${sentence(9)}</li>` +
            Array.from({ length: 3 + Math.floor(rand() * 4) }, () => `<li>${sentence(9)}</li>`).join("") +
            `</ul>`,
        );
      } else {
        const len = 26 + Math.floor(rand() * 60);
        const ref =
          xrefs && xrefTargets.length > 1 && b % 5 === 2
            ? ` See <a class="xref" href="#${xrefTargets[Math.floor(rand() * (xrefTargets.length - 1))]}">that section</a>.`
            : "";
        parts.push(`<p id="${id}">${t} ${sentence(len)}${ref}</p>`);
      }
    }
    body.push(`<section>${parts.join("\n")}</section>`);
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Folio spike book</title>
<style>${bookCss(opts)}</style>
</head>
<body>
<main>
${body.join("\n")}
</main>
</body>
</html>`;
}

if (import.meta.main) {
  const dir = import.meta.dir;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "book.html"), bookHtml({ xrefs: false }));
  writeFileSync(join(dir, "book-xrefs.html"), bookHtml({ xrefs: true, chapters: 2 }));
  writeFileSync(
    join(dir, "book-named.html"),
    bookHtml({ namedPages: true, chapters: 3 }),
  );
  console.log("wrote fixtures/book.html, book-xrefs.html, book-named.html");
}
