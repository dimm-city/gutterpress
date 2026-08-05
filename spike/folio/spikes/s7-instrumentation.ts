/**
 * S7 — a spike the work itself demanded (not in §11): Tier 3 must instrument
 * the document to learn page numbers (S4 proved /Dests only carries ids that
 * something links to). Which form of instrumentation link is BOTH visible to
 * the PDF writer AND layout-neutral?
 *
 * If no form is layout-neutral, Tier 3's measurement perturbs the very layout
 * it measures and the fixpoint loop gets much harder to trust.
 */
import { join } from "node:path";
import { launchChromium, type Browser } from "../src/shared/cdp.ts";
import { inspectPdf } from "../src/shared/pdf-inspect.ts";
import { Spike, writeArtifact, OUT_DIR } from "./harness.ts";

const N = 12;

const body = () =>
  Array.from({ length: N }, (_, i) =>
    [
      `<h2 id="t${i + 1}">TARGET${i + 1}</h2>`,
      ...Array.from(
        { length: 4 },
        (_, j) =>
          `<p>Body ${i}.${j} Aenean lacinia bibendum nulla sed consectetur donec ullamcorper nulla non metus auctor fringilla nullam quis risus eget urna.</p>`,
      ),
    ].join("\n"),
  ).join("\n");

const VARIANTS: Record<string, (ids: string[]) => string> = {
  "display:none": (ids) =>
    `<div style="display:none">${ids.map((id) => `<a href="#${id}">.</a>`).join("")}</div>`,
  "visibility:hidden": (ids) =>
    `<div style="visibility:hidden;position:absolute">${ids.map((id) => `<a href="#${id}">.</a>`).join("")}</div>`,
  "zero-size absolute": (ids) =>
    `<div style="position:absolute;top:0;left:0;width:0;height:0;overflow:hidden">${ids
      .map((id) => `<a href="#${id}" style="display:block;width:0;height:0;overflow:hidden">.</a>`)
      .join("")}</div>`,
  "in-place zero-size anchors": (ids) =>
    ids.map((id) => `<!--${id}-->`).join(""), // placeholder, replaced below
};

export async function run(browser: Browser) {
  const s = new Spike("s7-instrumentation", "layout-neutral instrumentation for Tier 3 measurement");
  const page = await browser.newPage();
  const ids = Array.from({ length: N }, (_, i) => `t${i + 1}`);

  const shell = (extra: string, inline = false) => `<!doctype html><meta charset="utf-8"><style>
@page { size: 6in 9in; margin: 1in; @bottom-center { content: counter(page); } }
html { font: 11pt/1.4 'DejaVu Serif', serif; } body { margin: 0 }
h2 { margin: 14pt 0 6pt; font-size: 13pt; } p { margin: 0 0 8pt; }
</style>
<main>${inline ? body().replace(/<h2 id="(t\d+)">/g, '<a href="#$1" style="float:left;width:0;height:0;overflow:hidden;font-size:0"></a><h2 id="$1">') : body()}
${extra}</main>`;

  // baseline: no instrumentation at all
  await page.setContent(shell(""));
  await page.waitForReady();
  const basePdf = await page.printToPDF();
  const base = await inspectPdf(basePdf);
  writeArtifact(join(OUT_DIR, "s7-baseline.pdf"), basePdf);
  s.data.basePages = base.pageCount;
  s.note(`baseline: ${base.pageCount} pages, ${Object.keys(base.namedDests).length} named dests`);

  const results: Record<string, { pages: number; dests: number }> = {};
  for (const [label, build] of Object.entries(VARIANTS)) {
    const inline = label === "in-place zero-size anchors";
    await page.setContent(shell(inline ? "" : build(ids), inline));
    await page.waitForReady();
    const bytes = await page.printToPDF();
    writeArtifact(join(OUT_DIR, `s7-${label.replace(/\W+/g, "-")}.pdf`), bytes);
    const facts = await inspectPdf(bytes);
    const dests = ids.filter((id) => facts.namedDests[id] !== undefined).length;
    results[label] = { pages: facts.pageCount, dests };
    s.check(
      `[${label}] measures every element (${dests}/${N}) without changing layout (${facts.pageCount}pp)`,
      dests === N && facts.pageCount === base.pageCount,
      `${dests}/${N} ids resolved, ${facts.pageCount}pp vs baseline ${base.pageCount}pp`,
    );
  }
  s.data.results = results;

  const usable = Object.entries(results).filter(
    ([, r]) => r.dests === N && r.pages === base.pageCount,
  );
  s.check(
    "at least one layout-neutral instrumentation form exists",
    usable.length > 0,
    usable.map(([k]) => k).join(", ") || "none",
  );
  s.note(
    "Tier 3 uses the first usable form; a form that emits no dests means Chromium " +
      "skipped the link annotation entirely (not painted => not written).",
  );

  await page.close();
  return s.finish(usable.length ? "PASS" : "FAIL");
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
