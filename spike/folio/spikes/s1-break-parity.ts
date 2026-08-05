/**
 * S1 (§11.1) — THE load-bearing spike: does on-screen multicol fragmentation
 * put the same content on the same pages as Chromium's print path?
 *
 * Method: every block in the fixture carries a visible token. The print run
 * yields token -> page from the PDF's own text; the viewer run yields
 * token -> page from client rects. The two vectors are diffed element by
 * element. No screenshots, no eyeballing.
 *
 * Go/no-go for the viewer's fidelity claim. Fallback if it fails: demote the
 * viewer to "draft" and make the PDF proof the primary preview.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { launchChromium, type Browser, type Session } from "../src/shared/cdp.ts";
import { bookHtml } from "../fixtures/make-book.ts";
import { Spike, writeArtifact, OUT_DIR } from "./harness.ts";
import { pdfText } from "./probe.ts";

const VIEWER = readFileSync(join(import.meta.dir, "..", "dist", "folio.js"), "utf8");

/** token -> 1-based page, read out of the printed PDF's own text. */
function printMap(pdfPath: string): Map<string, number> {
  const t = pdfText(pdfPath);
  const map = new Map<string, number>();
  for (const page of t.pages) {
    for (const m of page.text.matchAll(/§?P(\d{3})/g)) {
      const tok = `P${m[1]}`;
      if (!map.has(tok)) map.set(tok, page.page + 1);
    }
  }
  return map;
}

/** token -> 1-based page, read out of the viewer's fragmented columns. */
async function viewerMap(
  page: Session,
  html: string,
  opts: { decorate: boolean },
): Promise<{ map: Map<string, number>; pages: number; ms: number; warnings: string[] }> {
  await page.setContent(html);
  await page.evaluate(`window.__FOLIO_MANUAL__ = true;`);
  await page.evaluate(VIEWER);
  await page.waitForReady();
  const res = await page.evaluate<any>(`(async () => {
    const t0 = performance.now();
    const api = ${opts.decorate ? "await window.Folio.mount({})" : "await window.Folio.fragmentDocument({})"};
    const ms = performance.now() - t0;
    const out = {};
    // one batched pass over the tokenised blocks
    for (const el of document.querySelectorAll('[id]')) {
      const m = /§?P(\\d{3})/.exec(el.textContent || '');
      if (!m) continue;
      const p = api.pageOf(el);
      const tok = 'P' + m[1];
      if (out[tok] === undefined) out[tok] = p + 1;
    }
    // headings carry their own tokens too
    return {
      map: out,
      pages: api.totalPages,
      ms,
      strips: api.strips.length,
      warnings: api.decoration ? api.decoration.warnings : [],
    };
  })()`);
  return {
    map: new Map(Object.entries(res.map) as Array<[string, number]>),
    pages: res.pages,
    ms: res.ms,
    warnings: res.warnings ?? [],
  };
}

export async function run(browser: Browser) {
  const s = new Spike("s1-break-parity", "multicol ↔ print break parity (§11.1)");
  const page = await browser.newPage();

  // A corpus, not one lucky document: several seeds, plus the named-page and
  // cross-reference variants.
  const corpus = [
    { label: "seed-7", opts: { seed: 7, chapters: 3, blocksPerChapter: 22 } },
    { label: "seed-13", opts: { seed: 13, chapters: 2, blocksPerChapter: 30 } },
    { label: "seed-29", opts: { seed: 29, chapters: 4, blocksPerChapter: 18 } },
    { label: "named-pages", opts: { seed: 7, chapters: 3, blocksPerChapter: 20, namedPages: true } },
    { label: "dense", opts: { seed: 101, chapters: 1, blocksPerChapter: 60 } },
  ];

  let totalBlocks = 0;
  let totalAgree = 0;
  const perDoc: any[] = [];
  let slowest = 0;

  for (const { label, opts } of corpus) {
    const html = bookHtml({ stress: true, ...opts });
    writeArtifact(join(OUT_DIR, `s1-${label}.html`), html);

    await page.setContent(html);
    await page.waitForReady();
    const pdfPath = join(OUT_DIR, `s1-${label}.pdf`);
    writeArtifact(pdfPath, await page.printToPDF());
    const print = printMap(pdfPath);
    const printPages = pdfText(pdfPath).pageCount;

    const screen = await viewerMap(page, html, { decorate: false });
    const decorated = await viewerMap(page, html, { decorate: true });

    const tokens = [...print.keys()].sort();
    const diffs: Array<{ token: string; print: number; screen: number }> = [];
    let missing = 0;
    for (const tok of tokens) {
      const v = screen.map.get(tok);
      if (v === undefined) { missing++; continue; }
      if (print.get(tok) !== v) diffs.push({ token: tok, print: print.get(tok)!, screen: v });
    }
    const measured = tokens.length - missing;
    totalBlocks += measured;
    totalAgree += measured - diffs.length;
    slowest = Math.max(slowest, decorated.ms);

    let decorationDrift = 0;
    for (const [tok, v] of screen.map) if (decorated.map.get(tok) !== v) decorationDrift++;

    perDoc.push({
      label, printPages, viewerPages: screen.pages, measured,
      diffs, missing, decorationDrift, layoutMs: Number(decorated.ms.toFixed(1)),
    });

    s.check(
      `[${label}] page count matches`,
      printPages === screen.pages,
      `print ${printPages}pp, viewer ${screen.pages}pp`,
    );
    s.check(
      `[${label}] every block on the same page`,
      diffs.length === 0 && missing === 0,
      `${measured - diffs.length}/${measured} agree` +
        (diffs.length ? ` — ${JSON.stringify(diffs.slice(0, 4))}` : "") +
        (missing ? `, ${missing} not located` : ""),
    );
    s.check(
      `[${label}] decoration does not perturb fragmentation`,
      decorationDrift === 0 && decorated.pages === screen.pages,
      `${decorationDrift} blocks moved`,
    );
  }

  s.data.perDoc = perDoc;
  s.data.agreementPct = Number(((totalAgree / totalBlocks) * 100).toFixed(2));
  s.check(
    "corpus-wide break parity",
    totalAgree === totalBlocks,
    `${totalAgree}/${totalBlocks} blocks (${((totalAgree / totalBlocks) * 100).toFixed(2)}%) across ${corpus.length} documents`,
  );
  s.check(
    "viewer layout under 100ms for a whole book",
    slowest < 100,
    `slowest document ${slowest.toFixed(1)}ms`,
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
