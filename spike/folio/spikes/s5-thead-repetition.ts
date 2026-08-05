/**
 * S5 (§11.5) — `<thead>` repetition: per page in print, per column on screen?
 *
 * Not cosmetic: a repeated header consumes height on the continuation
 * fragment, so if the renderers disagree, every table that spans a break
 * shifts the content after it. S1's single divergence traced back here.
 *
 * The spike measures the raw engine behaviour, shows the resulting drift, and
 * then verifies Folio's compensation (a cloned header row reserving the same
 * height, iterated to a fixed point) removes it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { launchChromium, type Browser, type Session } from "../src/shared/cdp.ts";
import { Spike, writeArtifact, OUT_DIR } from "./harness.ts";
import { pdfText } from "./probe.ts";

const VIEWER = readFileSync(join(import.meta.dir, "..", "dist", "folio.js"), "utf8");

const html = (rows: number, foot = false) => `<!doctype html><meta charset="utf-8">
<style>
@page { size: 6in 9in; margin: 0.75in; }
html { font: 11pt/20px 'DejaVu Serif', serif; }
body, p { margin: 0 }
table { width: 100%; border-collapse: collapse; }
th, td { border: 0.5pt solid #666; padding: 3pt 5pt; }
</style>
<main>
<p>FILL</p>
<table><thead><tr><th>HEADCELL</th><th>N</th></tr></thead>${
  foot ? "<tfoot><tr><td>FOOTCELL</td><td>-</td></tr></tfoot>" : ""
}<tbody>
${Array.from({ length: rows }, (_, i) => `<tr><td>R${String(i + 1).padStart(3, "0")}</td><td>${i + 1}</td></tr>`).join("")}
</tbody></table>
<p>TAIL</p>
</main>`;

async function viewerRows(page: Session, doc: string, compensate: boolean) {
  await page.setContent(doc);
  await page.evaluate(`window.__FOLIO_MANUAL__ = true;`);
  await page.evaluate(VIEWER);
  await page.waitForReady();
  return page.evaluate<any>(`(async () => {
    const api = await window.Folio.fragmentDocument({ compensateHeaders: ${compensate} });
    const strip = api.strips[0];
    const stride = window.Folio.strideOf(strip.el);
    const left = strip.el.getBoundingClientRect().left - strip.el.scrollLeft;
    const colOf = (r) => Math.floor((r.left - left + 1) / stride);
    const perCol = {};
    for (const tr of document.querySelectorAll('tbody tr:not(.folio-thead-shim)')) {
      const c = colOf(tr.getClientRects()[0]); perCol[c] = (perCol[c] || 0) + 1;
    }
    const headCols = {};
    for (const r of document.querySelector('thead').getClientRects())
      if (r.height > 1) headCols[colOf(r)] = 1;
    for (const shim of document.querySelectorAll('tr.folio-thead-shim'))
      headCols[colOf(shim.getClientRects()[0])] = 1;
    return { pages: api.totalPages, perCol, headCols: Object.keys(headCols).length,
             tail: api.pageOf(document.querySelectorAll('p')[1]) + 1,
             warnings: api.warnings };
  })()`);
}

export async function run(browser: Browser) {
  const s = new Spike("s5-thead-repetition", "<thead> repetition: print pages vs screen columns (§11.5)");
  const page = await browser.newPage();
  const doc = html(120);

  // ---- print truth -------------------------------------------------------
  await page.setContent(doc);
  await page.waitForReady();
  const p = join(OUT_DIR, "s5-table.pdf");
  writeArtifact(p, await page.printToPDF());
  const t = pdfText(p);
  const printHeads = t.pages.map((pg) => (pg.text.match(/HEADCELL/g) ?? []).length);
  const printRows = t.pages.map((pg) => (pg.text.match(/R\d{3}/g) ?? []).length);
  const printTail = t.pages.findIndex((pg) => pg.text.includes("TAIL")) + 1;

  s.check(
    "print repeats <thead> on every page the table spans",
    printHeads.every((n) => n === 1),
    `heads per page: ${JSON.stringify(printHeads)}`,
  );

  // ---- raw engine behaviour on screen ------------------------------------
  const raw = await viewerRows(page, doc, false);
  s.check(
    "multicol does NOT repeat <thead> per column (engine fact, not a Folio bug)",
    raw.headCols === 1,
    `header drawn in ${raw.headCols} of ${raw.pages} columns`,
  );
  const rawRows = Object.values(raw.perCol) as number[];
  const rawDrift = rawRows.some((n, i) => n !== printRows[i]);
  s.check(
    "…and that DOES shift rows per page without compensation",
    rawDrift,
    `print ${JSON.stringify(printRows)} vs screen ${JSON.stringify(rawRows)}`,
  );

  // ---- Folio's compensation ---------------------------------------------
  const fixed = await viewerRows(page, doc, true);
  const fixedRows = Object.values(fixed.perCol) as number[];
  s.check(
    "compensation restores rows-per-page parity",
    JSON.stringify(fixedRows) === JSON.stringify(printRows),
    `print ${JSON.stringify(printRows)} vs screen ${JSON.stringify(fixedRows)}`,
  );
  s.check(
    "compensation restores page count parity",
    fixed.pages === t.pageCount,
    `print ${t.pageCount}pp, screen ${fixed.pages}pp (uncompensated ${raw.pages}pp)`,
  );
  s.check(
    "content after the table lands on the same page",
    fixed.tail === printTail,
    `print p${printTail}, screen p${fixed.tail} (uncompensated p${raw.tail})`,
  );
  s.check(
    "header is visible on every continuation page (cloned, not a blank gap)",
    fixed.headCols === fixed.pages,
    `header drawn in ${fixed.headCols} of ${fixed.pages} columns`,
  );

  // ---- tfoot: documented limit ------------------------------------------
  const footDoc = html(120, true);
  await page.setContent(footDoc);
  await page.waitForReady();
  const fp = join(OUT_DIR, "s5-table-foot.pdf");
  writeArtifact(fp, await page.printToPDF());
  const ft = pdfText(fp);
  const printFeet = ft.pages.map((pg) => (pg.text.match(/FOOTCELL/g) ?? []).length);
  const footView = await viewerRows(page, footDoc, true);
  s.check(
    "<tfoot> divergence is reported as a warning rather than silently wrong",
    footView.warnings.some((w: string) => /tfoot/.test(w)),
    JSON.stringify(footView.warnings),
  );
  s.note(
    `print repeats <tfoot> per page (${JSON.stringify(printFeet)}); the screen preview does not reserve it — ` +
      `documented screen-mode limit, surfaced in designer mode.`,
  );
  s.data = { printHeads, printRows, printFeet, raw, fixed, footView };

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
