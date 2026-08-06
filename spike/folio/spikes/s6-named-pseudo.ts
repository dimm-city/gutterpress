/**
 * S6 (§11.6) — do named page + pseudo-page combinators (`@page chapter:first`,
 * `@page chapter:left`) actually apply in Chromium's print path?
 *
 * Tier 2 leans on generated named pages; if combinators don't apply, the
 * compiler has to expand them into equivalent supported rules.
 */
import { join } from "node:path";
import { launchChromium, type Browser } from "../../../packages/cli/src/engine/shared/cdp.ts";
import { inspectPdf, PT_PER_IN as IN } from "../../../packages/cli/src/engine/shared/pdf-inspect.ts";
import { Spike, writeArtifact, OUT_DIR } from "./harness.ts";
import { pdfText } from "./probe.ts";

const filler = (n: number) =>
  Array.from(
    { length: n },
    (_, i) =>
      `<p>Body ${i + 1}. Aenean lacinia bibendum nulla sed consectetur donec ullamcorper nulla non metus auctor fringilla nullam quis risus eget urna mollis ornare.</p>`,
  ).join("");

export async function run(browser: Browser) {
  const s = new Spike("s6-named-pseudo", "named page + pseudo-page combinators in print (§11.6)");
  const page = await browser.newPage();

  const html = `<!doctype html><meta charset="utf-8"><style>
@page { size: 6in 9in; margin: 1in; @top-center { content: "DEFAULT"; } }
@page chapter { @top-center { content: "CHAPTER"; } }
@page chapter:first { margin-top: 2.5in; @top-center { content: "CHAPTEROPENER"; } }
@page chapter:left  { @bottom-left  { content: "CVERSO"; } }
@page chapter:right { @bottom-right { content: "CRECTO"; } }
@page cover { size: 8in 8in; margin: 0; @top-center { content: "COVERBOX"; } }
html { font: 11pt/1.4 'DejaVu Serif', serif; } body { margin: 0 }
section.cover { page: cover; }
section.chapter { page: chapter; }
</style>
<main>
  <section class="cover"><h1>COVERPAGE</h1></section>
  <section class="chapter">${filler(24)}</section>
</main>`;

  await page.setContent(html);
  await page.waitForReady();
  const bytes = await page.printToPDF();
  const p = join(OUT_DIR, "s6-named-pseudo.pdf");
  writeArtifact(p, bytes);
  const facts = await inspectPdf(bytes);
  const t = pdfText(p);
  s.data.pageTexts = t.pages.map((x) => x.text.replace(/\s+/g, " ").slice(0, 60));

  const chapterPages = t.pages.filter((x) => /CHAPTER|CVERSO|CRECTO/.test(x.text));
  s.check(
    "named page applies to a whole run",
    chapterPages.length >= 2,
    `${chapterPages.length} pages carry chapter margin boxes`,
  );

  // ---- `:first` semantics --------------------------------------------
  // `:first` matches the first page of the DOCUMENT, not the first page of a
  // named-page run. With a cover page ahead of it, `@page chapter:first` can
  // never match — so a "chapter opener" page template is NOT expressible in
  // standard Paged Media for any chapter after the first.
  const openerWithCover = t.pages.findIndex((x) => x.text.includes("CHAPTEROPENER"));
  s.check(
    "`@page chapter:first` does NOT match the run's first page (document-first only)",
    openerWithCover === -1,
    openerWithCover === -1 ? "never matched, as the spec requires" : `matched page ${openerWithCover + 1}`,
  );

  const noCover = html
    .replace('<section class="cover"><h1>COVERPAGE</h1></section>', "")
    .replace("section.cover { page: cover; }", "");
  await page.setContent(noCover);
  await page.waitForReady();
  const p2 = join(OUT_DIR, "s6-nocover.pdf");
  writeArtifact(p2, await page.printToPDF());
  const t2 = pdfText(p2);
  const opener = t2.pages.findIndex((x) => x.text.includes("CHAPTEROPENER"));
  s.check(
    "`@page chapter:first` DOES match when the run starts on document page 1",
    opener === 0,
    opener === -1 ? "never matched" : `matched page ${opener + 1}`,
  );
  s.check(
    "…and does not leak to later pages of the run",
    t2.pages.filter((x) => x.text.includes("CHAPTEROPENER")).length === 1,
    "",
  );

  // measure BODY ink only: margin-box content is centred inside the margin
  // band, so it sits above the content box and would mask the geometry change
  const bodyTop = (pageIndex: number) =>
    Math.min(...t2.pages[pageIndex].words.filter((w) => /Body|Aenean/.test(w.text)).map((w) => w.y0));
  const openerTop = bodyTop(opener);
  const nextTop = bodyTop(opener + 1);
  s.check(
    "pseudo-page geometry override honored (margin-top, not just content)",
    openerTop > 2.4 * IN && nextTop < 1.3 * IN,
    `opener first ink y=${openerTop.toFixed(1)}pt, next page y=${nextTop.toFixed(1)}pt`,
  );

  s.check(
    "named page still carries its own size",
    Math.abs(facts.boxes[0].media[2] - 8 * IN) < 0.6,
    `cover page width ${facts.boxes[0].media[2]}pt`,
  );

  s.note(
    "Chromium resolves name+pseudo combinators natively (no Tier 2 expansion needed) " +
      "and honors per-page geometry overrides in print.",
  );
  s.note(
    "BUT `:first` means first page of the DOCUMENT. A per-chapter opener template is not " +
      "expressible in standard Paged Media at all — not a viewer limitation, an engine/spec one. " +
      "Presets must steer chapter openers to the content-padding pattern (e.g. `h1 { padding-top: … }`), " +
      "which both renderers reproduce exactly.",
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
