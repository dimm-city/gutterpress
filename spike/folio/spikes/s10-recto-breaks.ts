/**
 * S10 — recto/verso forced breaks and `@page :blank`.
 *
 * Found by comparing against the current Paged.js pipeline, not by the
 * proposal: §4 lists `break-before/after` as "native", and the page SELECTORS
 * `:left`/`:right` are (S0). But the BREAK VALUES `right`/`left`/`recto`/
 * `verso` — "start this chapter on a right-hand page", which every printed book
 * relies on — are treated by Chromium as a plain page break. Paged.js
 * implements them, so a straight swap would regress real books.
 *
 * The spike measures the gap, then verifies a compiler-side synthesis: insert
 * a zero-height spacer that forces the extra break and carries a generated
 * page name copying the author's `@page :blank` rules.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "../src/compiler/build.ts";
import { launchChromium, type Browser, type Session } from "../src/shared/cdp.ts";
import { Spike, writeArtifact, OUT_DIR } from "./harness.ts";
import { pdfText } from "./probe.ts";

const POLYFILL = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "packages",
  "cli",
  "src",
  "assets",
  "vendor",
  "paged.polyfill.js",
);

const BASE_CSS = `
@page { size: 6in 9in; margin: 1in;
  @top-center { content: "HEAD"; } @bottom-center { content: counter(page); } }
@page :blank { @top-center { content: none; } @bottom-center { content: none; } }
html { font: 11pt/1.4 'DejaVu Serif', serif } body { margin: 0 }
h1 { break-before: right; }
`;

const BODY = `<main><p>ONE</p><h1 id="c2">CHAPTERTWO</h1><p>TWO</p>
<h1 id="c3">CHAPTERTHREE</h1><p>THREE</p></main>`;

const doc = (extraCss = "", body = BODY) =>
  `<!doctype html><meta charset="utf-8"><style>${BASE_CSS}${extraCss}</style>${body}`;

async function printPages(page: Session, html: string, name: string) {
  await page.setContent(html);
  await page.waitForReady();
  const p = join(OUT_DIR, name);
  writeArtifact(p, await page.printToPDF());
  const t = pdfText(p);
  const pageOf = (needle: string) =>
    t.pages.findIndex((pg) => pg.text.includes(needle)) + 1;
  return {
    count: t.pageCount,
    c2: pageOf("CHAPTERTWO"),
    c3: pageOf("CHAPTERTHREE"),
    blanks: t.pages.filter((pg) => !pg.text.trim()).length,
    texts: t.pages.map((pg) => pg.text.replace(/\s+/g, " ").trim().slice(0, 24)),
  };
}

export async function run(browser: Browser) {
  const s = new Spike("s10-recto-breaks", "recto/verso forced breaks + @page :blank");
  const page = await browser.newPage();

  // ---- 1. what Chromium actually does -----------------------------------
  const native = await printPages(page, doc(), "s10-native.pdf");
  s.data.native = native;
  s.check(
    "Chromium does NOT honor `break-before: right` (no blank page inserted)",
    native.c2 % 2 === 0 || native.blanks === 0,
    `CH2 landed on p${native.c2} (${native.c2 % 2 ? "recto" : "verso"}), ${native.count} pages, ${native.blanks} blank`,
  );
  for (const value of ["left", "recto", "verso"] as const) {
    const r = await printPages(
      page,
      doc(`h1 { break-before: ${value}; }`),
      `s10-native-${value}.pdf`,
    );
    s.check(
      `…same for \`break-before: ${value}\``,
      r.count === native.count,
      `${r.count} pages, CH2 on p${r.c2}`,
    );
  }

  // ---- 2. what Paged.js does (the behaviour a swap would regress) --------
  const polyfill = readFileSync(POLYFILL, "utf8");
  await page.setContent(doc());
  await page.waitForReady();
  await page.evaluate(`window.__pagedSource = ${JSON.stringify(polyfill)};`);
  const paged = await page.evaluate<any>(`(async () => {
    const done = new Promise((r) => { window.PagedConfig = { after: () => r() }; });
    const s = document.createElement('script');
    s.textContent = window.__pagedSource;
    document.head.appendChild(s);
    await done;
    const pages = [...document.querySelectorAll('.pagedjs_page')]
      .map((x) => x.textContent.replace(/\\s+/g, ' ').trim().slice(0, 24));
    return { count: pages.length, pages,
             c2: pages.findIndex((p) => p.includes('CHAPTERTWO')) + 1,
             c3: pages.findIndex((p) => p.includes('CHAPTERTHREE')) + 1 };
  })()`);
  s.data.pagedjs = paged;
  s.check(
    "Paged.js DOES honor it (blank versos inserted, chapters on rectos)",
    paged.c2 % 2 === 1 && paged.c3 % 2 === 1 && paged.count > native.count,
    `${paged.count} pages, CH2 on p${paged.c2}, CH3 on p${paged.c3}`,
  );

  // ---- 3. Folio's synthesis: spacer + generated blank page --------------
  // What the compiler would emit: a zero-height spacer forcing the extra
  // break, on a generated page name that copies the author's `:blank` rules.
  const synthesized = await printPages(
    page,
    doc(
      `@page folio--blank { @top-center { content: none; } @bottom-center { content: none; } }
       .folio-recto-spacer { break-before: page; break-after: page; height: 0; page: folio--blank; }`,
      `<main><p>ONE</p>
       <div class="folio-recto-spacer" aria-hidden="true"></div><h1 id="c2">CHAPTERTWO</h1><p>TWO</p>
       <div class="folio-recto-spacer" aria-hidden="true"></div><h1 id="c3">CHAPTERTHREE</h1><p>THREE</p></main>`,
    ),
    "s10-synthesized.pdf",
  );
  s.data.synthesized = synthesized;
  s.check(
    "synthesis puts both chapters on a recto",
    synthesized.c2 % 2 === 1 && synthesized.c3 % 2 === 1,
    `CH2 on p${synthesized.c2}, CH3 on p${synthesized.c3}`,
  );
  s.check(
    "synthesis matches Paged.js page-for-page",
    synthesized.count === paged.count &&
      synthesized.c2 === paged.c2 &&
      synthesized.c3 === paged.c3,
    `folio ${synthesized.count}pp vs paged.js ${paged.count}pp`,
  );
  s.check(
    "the inserted pages are genuinely blank (no head, no folio)",
    synthesized.blanks === 2,
    `${synthesized.blanks} blank pages: ${JSON.stringify(synthesized.texts)}`,
  );

  // ---- 4. `@page :blank` itself ------------------------------------------
  const unstyled = await printPages(
    page,
    doc(`.folio-recto-spacer { break-before: page; break-after: page; height: 0; }`,
      `<main><p>ONE</p><div class="folio-recto-spacer"></div><h1 id="c2">CHAPTERTWO</h1><p>TWO</p>
       <h1 id="c3">CHAPTERTHREE</h1><p>THREE</p></main>`),
    "s10-unstyled-blank.pdf",
  );
  s.check(
    "`@page :blank` does NOT style a content-free page (generated name required)",
    unstyled.blanks === 0,
    `${unstyled.blanks} pages matched :blank; the empty page still carries "${unstyled.texts[1]}"`,
  );

  // ---- 5. the compiler does it, end to end ------------------------------
  const bookPath = join(OUT_DIR, "s10-book.html");
  writeFileSync(
    bookPath,
    doc(
      "",
      `<main><p>Front matter.</p>
       <h1>CHAPTERTWO</h1>${Array.from({ length: 12 }, (_, i) => `<p>Two body ${i}. Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor.</p>`).join("")}
       <h1>CHAPTERTHREE</h1>${Array.from({ length: 12 }, (_, i) => `<p>Three body ${i}. Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor.</p>`).join("")}
       </main>`,
    ).replace("h1 { break-before: right; }", "h1 { break-before: right; string-set: t content(); }"),
  );
  const built = await build({ input: bookPath, browser });
  writeArtifact(join(OUT_DIR, "s10-compiled.pdf"), built.bytes);
  const compiled = pdfText(join(OUT_DIR, "s10-compiled.pdf"));
  const pageOfText = (needle: string) =>
    compiled.pages.findIndex((pg) => pg.text.includes(needle)) + 1;
  const c2 = pageOfText("CHAPTERTWO");
  const c3 = pageOfText("CHAPTERTHREE");
  const blanks = compiled.pages.filter((pg) => !pg.text.trim()).length;
  s.data.compiled = { pages: compiled.pageCount, c2, c3, blanks, passes: built.passes };
  s.check(
    "`folio build` starts both chapters on a recto",
    c2 % 2 === 1 && c3 % 2 === 1,
    `CH2 on p${c2}, CH3 on p${c3} of ${compiled.pageCount}`,
  );
  s.check(
    "the blank pages it inserts carry the author's `@page :blank` rules",
    blanks >= 1,
    `${blanks} genuinely blank page(s) (no running head, no folio)`,
  );
  s.check(
    "and it converges",
    built.converged,
    `${built.passes} passes, converged=${built.converged}`,
  );

  s.note(
    "Not in the proposal's §4 table: `break-before: right|left|recto|verso` is a plain page " +
      "break in Chromium and `@page :blank` never matches. Both are shimmable — a spacer on a " +
      "generated blank page name reproduces Paged.js exactly — but the compiler must do it, and " +
      "the placement depends on measurement, so it belongs in the Tier 3 fixpoint.",
  );

  await page.close();
  return s.finish();
}

if (import.meta.main) {
  const b = await launchChromium();
  try {
    const r = await run(b);
    process.exitCode = r.verdict === "FAIL" ? 1 : 0;
  } finally {
    await b.close();
  }
}
