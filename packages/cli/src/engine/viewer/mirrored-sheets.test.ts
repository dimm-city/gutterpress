/**
 * Mirrored margins in the REAL viewer: each page's text sits where its own
 * `@page :left` / `:right` margins put it on the sheet drawn for that page.
 *
 * `mirrored-margins.test.ts` pins the column WIDTH (what pagination depends on).
 * That left a verso's text at the recto's margin on its sheet — `dx` too far
 * right (12px on the dc-op-manual field guide). The text cannot move per page (one multicol
 * per run), so the verso's PAPER does (decorate.ts, `versoShift`). These cases
 * measure the result in Chromium, on `fixtures/mirrored-sheets.html`:
 *
 *  - a verso's content box relative to its sheet is the `:left` margins, a
 *    recto's the `:right` ones, in single and in two-up view;
 *  - margin boxes (drawn per sheet) stay aligned with the text;
 *  - two-up still pairs (verso, recto) with the sheet gap between FACING
 *    sheets, and moves no page break;
 *  - a book without mirrored margins is placed exactly as before.
 */
import { serveDir } from "./test-support/serve-dir.ts";
import { test, expect, afterAll } from "bun:test";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import { resolveChromiumExecutable } from "../../lib/chromium.ts";
import { getAssetPath } from "../../lib/embedded-assets.ts";
import { closeBrowser, getBrowser } from "./test-support/browser.ts";
import { MARKER_CSS } from "../../lib/markdown/markers.js";
import { GUTTERPRESS_CSS } from "../../lib/markdown/gutterpress-css.ts";

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const RENDER_TEST_TIMEOUT_MS = 60_000;

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;

afterAll(async () => {
  await closeBrowser();
});

const MIRRORED = await fsp.readFile(path.join(FIXTURES_DIR, "mirrored-sheets.html"), "utf8");
/** The same book with the `:left` / `:right` rules dropped (each is one line). */
const UNMIRRORED = MIRRORED.replace(/^\s*@page :(left|right).*\n/gm, "");

async function withBook<T>(html: string, run: (url: string) => Promise<T>): Promise<T> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "gutterpress-mirrored-sheets-"));
  try {
    await fsp.writeFile(path.join(dir, "book.html"), html, "utf8");
    await fsp.copyFile(
      await getAssetPath("engine/gutterpress-viewer.js"),
      path.join(dir, "gutterpress-viewer.js"),
    );
    const { url, close } = await serveDir(dir, "book.html");
    try {
      return await run(url);
    } finally {
      await close();
    }
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

/** Open a book wide enough that the fit-to-width zoom never applies (rects stay unscaled). */
async function open(url: string) {
  const page = await (await getBrowser()).newPage();
  await page.setViewport({ width: 1600, height: 1200 });
  await page.goto(url);
  await page.waitForFunction("window.Gutterpress?.totalPages > 0");
  return page;
}

/** In-page measurement, shared by every case: where each paragraph, margin box and sheet is. */
function measureBook() {
  const sheet = (n: number) => document.querySelector<HTMLElement>(`.gp-sheet[data-page="${n}"]`)!;
  const round = (v: number) => Math.round(v * 10) / 10;
  const pages = [1, 2, 3, 4, 5, 6].map((n) => {
    const s = sheet(n);
    const sr = s.getBoundingClientRect();
    const r = document.getElementById(`t${n}`)!.getBoundingClientRect();
    const head = s.querySelector<HTMLElement>('.gp-marginbox[data-box="top-left"]');
    return {
      page: n,
      side: s.dataset.side,
      text: { x: round(r.left - sr.left), y: round(r.top - sr.top) },
      head: head ? { x: round(parseFloat(head.style.left)), text: head.textContent } : null,
      sheetLeft: round(sr.left),
      sheetRight: round(sr.right),
      sheetTop: round(sr.top),
    };
  });
  return {
    pages,
    pageOf: Array.from({ length: 6 }, (_, i) => (window as any).Gutterpress.pageOf(document.getElementById(`t${i + 1}`))),
    total: (window as any).Gutterpress.totalPages as number,
  };
}

testIf(
  "a verso's text sits at the :left margins on its sheet and a recto's at the :right ones, with its margin box",
  async () => {
    await withBook(MIRRORED, async (url) => {
      const page = await open(url);
      try {
        const m = await page.evaluate(measureBook);
        expect(m.total).toBe(6);
        expect(m.pageOf).toEqual([0, 1, 2, 3, 4, 5]);
        for (const p of m.pages) {
          const recto = p.page % 2 === 1;
          expect(p.side).toBe(recto ? "recto" : "verso");
          // content box vs its sheet: recto L50, verso L30; both top 40
          expect(p.text).toEqual({ x: recto ? 50 : 30, y: 40 });
          // …and the margin box is painted on that same left edge, as in print
          expect(p.head).toEqual({ x: recto ? 50 : 30, text: recto ? "recto head" : "verso head" });
        }
        // the paper moved, not the text: versos sit 20px (50 - 30) right of rectos
        const lefts = m.pages.map((p) => p.sheetLeft);
        expect(lefts.filter((_, i) => i % 2 === 0)).toEqual(Array(3).fill(lefts[0]));
        expect(lefts.filter((_, i) => i % 2 === 1)).toEqual(Array(3).fill(lefts[0]! + 20));
        // the strip's pitch carries the shift so facing sheets keep their gap
        expect(
          await page.evaluate(() =>
            document.querySelector<HTMLElement>(".gp-strip")!.style.getPropertyValue("--gp-verso-shift"),
          ),
        ).toBe("20px");
      } finally {
        await page.close();
      }
    });
  },
  RENDER_TEST_TIMEOUT_MS,
);

testIf(
  "two-up view still pairs (verso, recto), keeps the sheet gap between FACING sheets, and moves no page",
  async () => {
    await withBook(MIRRORED, async (url) => {
      const page = await open(url);
      try {
        const single = await page.evaluate(measureBook);
        const supported = await page.evaluate(
          () => CSS.supports("column-wrap", "wrap") && CSS.supports("column-height", "100px"),
        );
        // not vacuous: this must have measured the wrapped layout
        expect(supported).toBe(true);
        await page.evaluate(() => (window as any).Gutterpress.setSpread(true));
        const spread = await page.evaluate(measureBook);

        // no page break moved, the text is still on its own margins
        expect(spread.total).toBe(single.total);
        expect(spread.pageOf).toEqual(single.pageOf);
        for (const p of spread.pages) expect(p.text).toEqual({ x: p.page % 2 === 1 ? 50 : 30, y: 40 });

        // rows: the cover alone on the right, then (verso, recto) pairs
        const rows = new Map<number, typeof spread.pages>();
        for (const p of spread.pages) rows.set(p.sheetTop, [...(rows.get(p.sheetTop) ?? []), p]);
        const ordered = [...rows.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([, ps]) => ps.sort((a, b) => a.sheetLeft - b.sheetLeft));
        expect(ordered.map((r) => r.map((p) => p.page))).toEqual([[1], [2, 3], [4, 5], [6]]);
        for (const row of ordered.filter((r) => r.length === 2)) {
          expect(row[0]!.side).toBe("verso");
          expect(row[1]!.side).toBe("recto");
          // the gap between facing sheets is the sheet gap (24px): the slide of
          // the verso is made up in the pitch, never taken out of the gap
          expect(row[1]!.sheetLeft - row[0]!.sheetRight).toBeCloseTo(24, 1);
        }
        // the lone recto keeps the right-hand slot of its row, where a pair's recto sits
        expect(ordered[0]![0]!.sheetLeft).toBeCloseTo(ordered[1]![1]!.sheetLeft, 1);
      } finally {
        await page.close();
      }
    });
  },
  RENDER_TEST_TIMEOUT_MS,
);

/**
 * The same book with pages 3-4 on a named page whose margins are symmetric (40
 * all round: the same 320px content box, so a run of its own with NO shift):
 * three runs, each opening on a recto and so composed with the verso that ends
 * the one before it — shift 20, then 0, then 20 again.
 */
const CHAINED = MIRRORED.replace(
  "body { margin: 0; }",
  "@page plate { margin: 40px; }\n      #t3, #t4 { page: plate; }\n      body { margin: 0; }",
);

testIf(
  "runs with different shifts still compose into facing pairs at the sheet gap, down a chain of runs",
  async () => {
    await withBook(CHAINED, async (url) => {
      const page = await open(url);
      try {
        const single = await page.evaluate(measureBook);
        // text on its page's own margins, in the shifted runs and the unshifted one
        expect(single.pages.map((p) => p.text.x)).toEqual([50, 30, 40, 40, 50, 30]);
        expect(single.pages.map((p) => p.sheetLeft - single.pages[0]!.sheetLeft)).toEqual([0, 20, 0, 0, 0, 20]);

        await page.evaluate(() => (window as any).Gutterpress.setSpread(true));
        const spread = await page.evaluate(measureBook);
        expect(spread.pageOf).toEqual(single.pageOf);
        expect(spread.pages.map((p) => p.text.x)).toEqual([50, 30, 40, 40, 50, 30]);

        const rows = new Map<number, typeof spread.pages>();
        for (const p of spread.pages) rows.set(p.sheetTop, [...(rows.get(p.sheetTop) ?? []), p]);
        const ordered = [...rows.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([, ps]) => ps.sort((a, b) => a.sheetLeft - b.sheetLeft));
        // composed across the run boundaries, the cover and the last verso alone
        expect(ordered.map((r) => r.map((p) => p.page))).toEqual([[1], [2, 3], [4, 5], [6]]);
        for (const row of ordered.filter((r) => r.length === 2)) {
          expect(row[1]!.sheetLeft - row[0]!.sheetRight).toBeCloseTo(24, 1);
        }
      } finally {
        await page.close();
      }
    });
  },
  RENDER_TEST_TIMEOUT_MS,
);

testIf(
  "edge-pinned art keeps the paper's edge, and the text its own margins",
  async () => {
    const source = await fsp.readFile(path.join(FIXTURES_DIR, "mirrored-flush.html"), "utf8");
    const html = source.replace("</style>", `</style>\n<style>${MARKER_CSS}\n${GUTTERPRESS_CSS}</style>`);
    await withBook(html, async (url) => {
      const page = await open(url);
      try {
        const m = await page.evaluate(() => {
          const round = (v: number) => Math.round(v * 10) / 10;
          const sheet = (n: number) => document.querySelector<HTMLElement>(`.gp-sheet[data-page="${n}"]`)!;
          const at = (id: string, n: number) => {
            const s = sheet(n).getBoundingClientRect();
            const r = document.getElementById(id)!.getBoundingClientRect();
            return {
              left: round(r.left - s.left),
              fromRight: round(s.right - r.right),
              fromBottom: round(s.bottom - r.bottom),
            };
          };
          return {
            total: (window as any).Gutterpress.totalPages as number,
            a1: at("a1", 1),
            a2: at("a2", 2),
            a4: at("a4", 4),
            t2: at("t2", 2),
            t4: at("t4", 4),
          };
        });
        expect(m.total).toBe(4);
        // a bottom-flush foot rests on the paper on a recto and on a verso alike…
        expect(m.a1.fromBottom).toBeLessThan(2);
        expect(m.a2.fromBottom).toBeLessThan(2);
        // …while the verso's text sits on its own left margin (30), the recto's on 50
        expect(m.t2.left).toBe(30);
        // a side flush reaches the paper too, and the verso's text still keeps
        // its own margin: the pin root's padding gives it the author's box back
        expect(m.a4.fromRight).toBeLessThan(2);
        expect(m.t4.left).toBe(30);
      } finally {
        await page.close();
      }
    });
  },
  RENDER_TEST_TIMEOUT_MS,
);

testIf(
  "a book without mirrored margins is placed exactly as before: no shift, no extra pitch",
  async () => {
    await withBook(UNMIRRORED, async (url) => {
      const page = await open(url);
      try {
        const m = await page.evaluate(measureBook);
        for (const p of m.pages) {
          expect(p.text).toEqual({ x: 40, y: 40 });
          expect(p.head).toBeNull(); // the margin boxes lived in the dropped rules
        }
        // every sheet at one left; nothing slid
        expect(new Set(m.pages.map((p) => p.sheetLeft)).size).toBe(1);
        const strip = await page.evaluate(() => {
          const el = document.querySelector<HTMLElement>(".gp-strip")!;
          return {
            shift: el.style.getPropertyValue("--gp-verso-shift"),
            // margins 40 + 40 and the 24px sheet gap, as the pitch has always been
            columnGap: getComputedStyle(el).columnGap,
            run: document.querySelector<HTMLElement>(".gp-run")!.style.marginLeft,
          };
        });
        expect(strip).toEqual({ shift: "", columnGap: "104px", run: "" });

        await page.evaluate(() => (window as any).Gutterpress.setSpread(true));
        const spread = await page.evaluate(measureBook);
        // (verso, recto) pairs are the sheet gap apart and the pair's two
        // sheets share one top, as before
        const byTop = new Map<number, typeof spread.pages>();
        for (const p of spread.pages) byTop.set(p.sheetTop, [...(byTop.get(p.sheetTop) ?? []), p]);
        for (const row of byTop.values()) {
          if (row.length !== 2) continue;
          row.sort((a, b) => a.sheetLeft - b.sheetLeft);
          expect(row[1]!.sheetLeft - row[0]!.sheetRight).toBeCloseTo(24, 1);
        }
      } finally {
        await page.close();
      }
    });
  },
  RENDER_TEST_TIMEOUT_MS,
);
