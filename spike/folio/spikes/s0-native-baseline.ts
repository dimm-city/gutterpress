/**
 * S0 — Native baseline probe (§4 of the proposal).
 *
 * Every row of the "what Chromium already does" table is asserted against the
 * real browser. The proposal's entire premise ("ship no layout engine") is
 * false if these rows are false, so this runs first and everything else is
 * downstream of it.
 */
import { join } from "node:path";
import { launchChromium, type Browser } from "../src/shared/cdp.ts";
import { inspectPdf, PT_PER_IN } from "../src/shared/pdf-inspect.ts";
import { Spike, writeArtifact, OUT_DIR } from "./harness.ts";
import { pdfText, pdfInfo } from "./probe.ts";

const IN = PT_PER_IN;

const doc = (head: string, body: string) => `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;padding:0;font-family:'DejaVu Serif',serif;}
  ${head}
</style>${body}`;

const filler = (n: number, tag = "p") =>
  Array.from(
    { length: n },
    (_, i) =>
      `<${tag}>Paragraph ${i + 1}. Aenean lacinia bibendum nulla sed consectetur. Donec ullamcorper nulla non metus auctor fringilla. Nullam quis risus eget urna mollis ornare vel eu leo. Cras mattis consectetur purus sit amet fermentum.</${tag}>`,
  ).join("\n");

export async function run(browser: Browser) {
  const s = new Spike("s0-native-baseline", "Chromium native Paged Media baseline (§4)");
  s.data.chromium = browser.version;
  s.check(
    "Chromium >= 131 (margin boxes)",
    browser.milestone >= 131,
    `${browser.version} (milestone ${browser.milestone})`,
  );

  const page = await browser.newPage();

  // ---- 1. @page size + preferCSSPageSize --------------------------------
  {
    await page.setContent(
      doc(`@page { size: 6in 9in; margin: 0.75in 0.5in; }`, `<main>${filler(30)}</main>`),
    );
    await page.waitForReady();
    const pdf = await page.printToPDF();
    const f = await inspectPdf(pdf);
    writeArtifact(join(OUT_DIR, "s0-size.pdf"), pdf);
    s.near("@page size honored (width pt)", f.boxes[0].media[2], 6 * IN, 0.6);
    s.near("@page size honored (height pt)", f.boxes[0].media[3], 9 * IN, 0.6);
    s.check("content flowed to multiple pages", f.pageCount > 1, `${f.pageCount} pages`);
    s.data.sizePageCount = f.pageCount;
  }

  // ---- 2. @page margin actually applied ---------------------------------
  {
    const mk = (margin: string) =>
      doc(
        `@page { size: 6in 9in; margin: ${margin}; } p{margin:0 0 6pt; font-size:11pt;}`,
        `<main>${filler(40)}</main>`,
      );
    await page.setContent(mk("0.5in"));
    await page.waitForReady();
    const tight = await inspectPdf(await page.printToPDF());
    await page.setContent(mk("2in"));
    await page.waitForReady();
    const wide = await inspectPdf(await page.printToPDF());
    s.check(
      "margins change fragmentation",
      wide.pageCount > tight.pageCount,
      `0.5in => ${tight.pageCount}pp, 2in => ${wide.pageCount}pp`,
    );

    // and the ink actually sits inside the declared margin box
    const p = join(OUT_DIR, "s0-margin.pdf");
    writeArtifact(p, await page.printToPDF());
    const t = pdfText(p);
    const minX = Math.min(...t.pages[0].words.map((w) => w.x0));
    const minY = Math.min(...t.pages[0].words.map((w) => w.y0));
    s.check(
      "text starts inside 2in margin box",
      minX >= 2 * IN - 2 && minY >= 2 * IN - 6,
      `first ink at x=${minX.toFixed(1)}pt y=${minY.toFixed(1)}pt (margin ${2 * IN}pt)`,
    );
  }

  // ---- 3. named pages: geometry + forced breaks -------------------------
  {
    await page.setContent(
      doc(
        `@page { size: 6in 9in; margin: 0.5in; }
         @page cover { size: 8in 8in; margin: 0; }
         section.cover { page: cover; }
         section.body { page: body; }`,
        `<section class="cover"><h1>Cover</h1></section>
         <section class="body">${filler(10)}</section>`,
      ),
    );
    await page.waitForReady();
    const f = await inspectPdf(await page.printToPDF());
    s.near("named page geometry (page 1 = 8in)", f.boxes[0].media[2], 8 * IN, 0.6);
    s.near("default geometry resumes (page 2 = 6in)", f.boxes[1]?.media[2] ?? 0, 6 * IN, 0.6);
    s.check(
      "named-page change forces a break",
      f.pageCount >= 2,
      `${f.pageCount} pages`,
    );
  }

  // ---- 4. margin boxes + counter(page)/counter(pages) -------------------
  {
    const p = join(OUT_DIR, "s0-marginboxes.pdf");
    await page.setContent(
      doc(
        `@page {
           size: 6in 9in; margin: 1in;
           @top-left      { content: "TL"; }
           @top-center    { content: "TC"; }
           @top-right     { content: "TR"; }
           @bottom-left   { content: "BL"; }
           @bottom-center { content: counter(page) " of " counter(pages); }
           @bottom-right  { content: "BR"; }
           @left-middle   { content: "LM"; }
           @right-middle  { content: "RM"; }
         }`,
        `<main>${filler(24)}</main>`,
      ),
    );
    await page.waitForReady();
    writeArtifact(p, await page.printToPDF());
    const t = pdfText(p);
    const p1 = t.pages[0].text;
    for (const box of ["TL", "TC", "TR", "BL", "BR", "LM", "RM"]) {
      s.check(`margin box ${box} rendered`, p1.includes(box), "");
    }
    const total = t.pageCount;
    s.check(
      "counter(page)/counter(pages) correct",
      t.pages.every((pg, i) => pg.text.includes(`${i + 1} of ${total}`)),
      `expected "N of ${total}" on all ${total} pages`,
    );
    // margin-box ink must sit OUTSIDE the content box (i.e. in the margin)
    const tc = t.pages[0].words.find((w) => w.text === "TC");
    s.check(
      "margin-box ink sits in the page margin",
      !!tc && tc.y0 < 1 * IN,
      tc ? `@top-center at y=${tc.y0.toFixed(1)}pt (margin ${IN}pt)` : "not found",
    );
  }

  // ---- 5. :first / :left / :right ---------------------------------------
  {
    const p = join(OUT_DIR, "s0-pseudo.pdf");
    await page.setContent(
      doc(
        `@page { size: 6in 9in; margin: 1in; @top-center { content: "DEFAULT"; } }
         @page :first { @top-center { content: "FIRSTPAGE"; } }
         @page :left  { @top-left  { content: "VERSO"; } }
         @page :right { @top-right { content: "RECTO"; } }`,
        `<main>${filler(30)}</main>`,
      ),
    );
    await page.waitForReady();
    writeArtifact(p, await page.printToPDF());
    const t = pdfText(p);
    s.check(":first matched", t.pages[0].text.includes("FIRSTPAGE"), "");
    s.check(
      ":right matched on odd pages",
      t.pages.filter((_, i) => i % 2 === 0).every((pg) => pg.text.includes("RECTO")),
      "",
    );
    s.check(
      ":left matched on even pages",
      t.pages.filter((_, i) => i % 2 === 1).every((pg) => pg.text.includes("VERSO")),
      "",
    );
  }

  // ---- 6. break-* / widows / orphans ------------------------------------
  {
    const p = join(OUT_DIR, "s0-breaks.pdf");
    await page.setContent(
      doc(
        `@page { size: 6in 9in; margin: 1in; }
         h1 { break-before: page; }
         .keep { break-inside: avoid; }
         p { widows: 3; orphans: 3; }`,
        `<h1>ALPHA</h1>${filler(6)}<h1>BETA</h1>${filler(6)}<h1>GAMMA</h1>${filler(6)}`,
      ),
    );
    await page.waitForReady();
    writeArtifact(p, await page.printToPDF());
    const t = pdfText(p);
    const alpha = t.pages.findIndex((pg) => pg.text.includes("ALPHA"));
    const beta = t.pages.findIndex((pg) => pg.text.includes("BETA"));
    const gamma = t.pages.findIndex((pg) => pg.text.includes("GAMMA"));
    s.check(
      "break-before:page starts each heading on its own page",
      alpha === 0 && beta > alpha && gamma > beta,
      `ALPHA p${alpha + 1}, BETA p${beta + 1}, GAMMA p${gamma + 1}`,
    );
    s.check(
      "headings are alone at top of their page",
      t.pages[beta].words.filter((w) => w.text === "BETA").length === 1 &&
        Math.min(...t.pages[beta].words.map((w) => w.y0)) < 1.4 * IN,
      "",
    );
  }

  // ---- 7. what Chromium does NOT implement (must stay shim-worthy) ------
  {
    const support = await page.evaluate<Record<string, boolean>>(`(() => ({
      stringSet: CSS.supports('string-set', 'x content()'),
      bleedDescriptor: (() => {
        const ss = new CSSStyleSheet();
        ss.replaceSync('@page { bleed: 0.125in; marks: crop; }');
        return /bleed/.test(ss.cssRules[0].cssText);
      })(),
      targetCounter: CSS.supports('content', 'target-counter(attr(href url), page)'),
      // CSS.supports lies for these: Chrome 151 PARSES target-counter() and
      // reports support, then computes the whole content value to none.
      // The only honest detector is a render probe.
      targetCounterRenders: (() => {
        const probe = document.createElement('div');
        probe.innerHTML = '<a id="folio-probe-t" href="#folio-probe-t">x</a>';
        const style = document.createElement('style');
        style.textContent = '#folio-probe-t::after { content: target-counter(attr(href url), page); }';
        document.head.appendChild(style);
        document.body.appendChild(probe);
        const computed = getComputedStyle(probe.firstElementChild, '::after').content;
        probe.remove(); style.remove();
        return computed !== 'none' && computed !== '';
      })(),
      floatFootnote: CSS.supports('float', 'footnote'),
      nthPage: (() => {
        try { const ss = new CSSStyleSheet(); ss.replaceSync('@page :nth(2) { margin: 0 }');
              return ss.cssRules.length > 0; } catch { return false; }
      })(),
      counterStyleInMargin: CSS.supports('content', 'counter(page, decimal)'),
    }))()`);
    s.data.unsupported = support;
    s.check(
      "string-set still unimplemented (Tier 2/3 shim required)",
      !support.stringSet,
      `CSS.supports(string-set) = ${support.stringSet}`,
    );
    s.check(
      "bleed/marks descriptors still dropped (compiler transform required)",
      !support.bleedDescriptor,
      `CSSOM retains bleed = ${support.bleedDescriptor}`,
    );
    // The requirement is that Tier 3 is still REQUIRED, i.e. the browser does
    // not actually RENDER a cross-reference. Whether it parses the syntax is
    // irrelevant — and since Chrome 151 parses it while computing the value to
    // `none`, a parse-level check would have quietly declared victory and
    // (had the shim been feature-gated on it) disabled a shim still needed.
    s.check(
      "target-counter() still does not RENDER (Tier 3 required)",
      !support.targetCounterRenders,
      `CSS.supports says ${support.targetCounter}; computed ::after content ` +
        `${support.targetCounterRenders ? "renders" : "is none"}`,
    );
    if (support.targetCounter && !support.targetCounterRenders)
      s.note(
        "CSS.supports('content','target-counter(…)') is TRUE on this build but the value computes " +
          "to none, so nothing renders. Feature-detecting the GCPM shims with CSS.supports would " +
          "silently disable a shim that is still needed. Worse, the author's declaration now " +
          "SURVIVES the cascade and outranks a bare `[data-folio-after]::after` override — which " +
          "is why generatedContentCss() reuses the author's own selector.",
      );
    s.note(
      `float:footnote=${support.floatFootnote}, @page :nth()=${support.nthPage} (both v1 non-goals / fallbacks)`,
    );
  }

  // ---- 8. tagged PDF + outline ------------------------------------------
  {
    const p = join(OUT_DIR, "s0-tagged.pdf");
    await page.setContent(
      doc(
        `@page { size: 6in 9in; margin: 1in; } h1 { break-before: page; }`,
        `<h1>Chapter One</h1>${filler(8)}<h1>Chapter Two</h1>${filler(8)}`,
      ),
    );
    await page.waitForReady();
    const bytes = await page.printToPDF();
    writeArtifact(p, bytes);
    const f = await inspectPdf(bytes);
    const info = pdfInfo(p);
    s.check(
      "document outline emitted (heading -> page)",
      f.outline.length >= 2,
      JSON.stringify(f.outline),
    );
    s.check("PDF is tagged", info.isTagged !== false, `MarkInfo present=${info.isTagged}`);
    s.check("fonts embedded", info.fonts.length > 0, info.fonts.join(", "));
    s.data.outline = f.outline;
  }

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
