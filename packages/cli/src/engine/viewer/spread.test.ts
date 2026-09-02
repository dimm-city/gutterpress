import { serveDir } from "./test-support/serve-dir.ts";
import { test, expect, afterAll } from "bun:test";
import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import { resolveChromiumExecutable } from "../../lib/chromium.ts";
import { getAssetPath } from "../../lib/embedded-assets.ts";
import { closeBrowser, getBrowser } from "../../lib/browser-pool.ts";

/**
 * Two-up/spread view mode (`applySpreadMode`) must RE-PRESENT the pages the
 * fragmenter already decided, never re-decide them — the tooling-tier rule.
 *
 * THE BUG THIS EXISTS FOR: the first cross-run pairing implementation was
 * measured by reading `.gp-sheet` rectangles only. That proved the sheet
 * CHROME was grouped and sided correctly and said nothing about where
 * Chromium actually put the author's CONTENT — and the content was
 * elsewhere: `rowStrideOf()` derived the wrapped-row pitch from
 * `--gp-page-h` when multicol lays a row out at `column-height`
 * (= `--gp-content-h`) + `row-gap`, so every row after the first drifted
 * one page-margin further from its sheet. On the design guide that put 82 of
 * 363 probe elements fully outside the sheet drawn for their own page — the
 * same "chrome moved, content stayed" failure the retired chrome-only two-up
 * was rejected for, reintroduced on the row axis.
 *
 * So this test asserts the two things a sheet-only check cannot see:
 *
 *   (1) every authored element's painted rect lies INSIDE the sheet drawn
 *       for the page single-mode `pageOf()` (the parity-gated answer)
 *       assigns it to; and
 *   (2) `pageOf()` returns the identical page for every element in spread
 *       mode as in single mode — a view mode may not move a page boundary.
 *
 * plus the pairing property the original work added: every 2-sheet row is a
 * consecutive (verso, recto) pair, and no row holds more than 2.
 */

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const RENDER_TEST_TIMEOUT_MS = 60_000;

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;
if (!chromium) {
  // eslint-disable-next-line no-console
  console.warn(
    "[spread.test] No Chromium resolved via resolveChromiumExecutable() — skipping. Install Chrome/Chromium or set CHROMIUM_PATH to run it."
  );
}

afterAll(async () => {
  await closeBrowser();
});


interface SpreadReport {
  supported: boolean;
  wrapped: boolean;
  totalPages: number;
  sheetGap: number;
  singleVerticalGaps: number[];
  spreadVerticalGaps: number[];
  spreadHorizontalGaps: number[];
  probes: number;
  pageOfMismatches: Array<{ id: string; single: number; spread: number }>;
  outside: Array<{ id: string; page: number; rect: number[]; sheet: number[] }>;
  rows: Array<{ top: number; sheets: Array<{ page: number; side: string }> }>;
  singleRows: Array<{ top: number; sheets: Array<{ page: number; side: string }> }>;
  singleSheetLefts: number[];
  overlapHit: {
    coveredPage: number;
    hitId: string | null;
    hitIsChrome: boolean;
    hitPage: number | null;
  } | null;
}

/**
 * Both fixtures assert the identical contract. The second exists because the
 * first could not fail the way real books do: `spread-rows.html` has no forced
 * `break-before` on the leading element of an EVEN-offset strip — the strips
 * that receive `applySpreadMode`'s `.gp-wrap-spacer` — while core's MARKER_CSS
 * gives EVERY marker book exactly that via `.page { break-before: page }`.
 * That combination is what disarms the spacer (CSS-break-3 forced-break
 * combining), and its absence here is why this suite stayed green while the
 * field guide rendered every page one slot off its own sheet in 0.10.2. One
 * CSS rule is the whole difference — see the fixture's header.
 */
const SPREAD_FIXTURES = [
  {
    fixture: "spread-rows.html",
    title: "spread mode re-presents pages without moving content out of its own sheet",
  },
  {
    fixture: "spread-rows-leading-break.html",
    title:
      "…and still does with a forced break-before on the first strip element (every marker book has one)",
  },
];

for (const { fixture, title } of SPREAD_FIXTURES) {
testIf(
  title,
  async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "gutterpress-spread-test-"));
    try {
      await fsp.copyFile(
        path.join(FIXTURES_DIR, fixture),
        path.join(dir, fixture)
      );
      await fsp.copyFile(
        await getAssetPath("engine/gutterpress-viewer.js"),
        path.join(dir, "gutterpress-viewer.js")
      );
      const { url, close } = await serveDir(dir, fixture);
      try {
        const browser = await getBrowser(RENDER_TEST_TIMEOUT_MS);
        const page = await browser.newPage();
        let report: SpreadReport;
        try {
          // Wide enough that `fitZoom()` never kicks in — a shrunk stage
          // would make every rectangle below a scaled number and hide a real
          // misalignment behind rounding.
          await page.setViewport({ width: 1600, height: 1200 });
          await page.goto(url, { waitUntil: "networkidle0" });
          await page.waitForFunction("window.Gutterpress && window.Gutterpress.totalPages > 0");

          report = await page.evaluate(() => {
            const gp = (window as any).Gutterpress;
            const probeEls = Array.from(
              document.querySelectorAll<HTMLElement>(".gp-strip p, .gp-strip h1")
            );
            const single = probeEls.map((el) => gp.pageOf(el));

            const collectRows = () => {
              const m = new Map<number, Array<{ page: number; side: string; l: number; r: number; b: number }>>();
              for (const sh of Array.from(
                document.querySelectorAll<HTMLElement>(".gp-sheet"),
              )) {
                const r = sh.getBoundingClientRect();
                const top = Math.round(r.top);
                if (!m.has(top)) m.set(top, []);
                m.get(top)!.push({
                  page: Number(sh.dataset.page),
                  side: sh.dataset.side ?? "",
                  l: r.left,
                  r: r.right,
                  b: r.bottom,
                });
              }
              return [...m.entries()]
                .sort((a, b) => a[0] - b[0])
                .map(([top, v]) => ({
                  top,
                  sheets: v.sort((a, b) => a.l - b.l),
                }));
            };
            const singleGeometry = collectRows();
            const singleRows = singleGeometry.map((row) => ({
              top: row.top,
              sheets: row.sheets.map(({ page, side }) => ({ page, side })),
            }));
            const singleSheetLefts = singleGeometry.flatMap((row) =>
              row.sheets.map((sheet) => Math.round(sheet.l)),
            );
            const singleVerticalGaps = singleGeometry.slice(1).map((row, i) =>
              Math.round(row.top - Math.max(...singleGeometry[i]!.sheets.map((sheet) => sheet.b))),
            );
            gp.setSpread(true);

            const spread = probeEls.map((el) => gp.pageOf(el));
            const pageOfMismatches: SpreadReport["pageOfMismatches"] = [];
            probeEls.forEach((el, i) => {
              if (single[i] !== spread[i])
                pageOfMismatches.push({ id: el.id, single: single[i]!, spread: spread[i]! });
            });

            const sheetByPage: Record<
              number,
              { l: number; t: number; r: number; b: number; side: string }
            > = {};
            const rowMap = new Map<number, Array<{ page: number; side: string; l: number }>>();
            for (const sh of Array.from(
              document.querySelectorAll<HTMLElement>(".gp-sheet")
            )) {
              const r = sh.getBoundingClientRect();
              const p = Number(sh.dataset.page) - 1;
              const side = sh.dataset.side ?? "";
              sheetByPage[p] = { l: r.left, t: r.top, r: r.right, b: r.bottom, side };
              const top = Math.round(r.top);
              if (!rowMap.has(top)) rowMap.set(top, []);
              rowMap.get(top)!.push({ page: p + 1, side, l: r.left });
            }

            const outside: SpreadReport["outside"] = [];
            probeEls.forEach((el, i) => {
              const sh = sheetByPage[single[i]!];
              if (!sh) return;
              const r = el.getClientRects()[0] ?? el.getBoundingClientRect();
              if (!r || (r.width === 0 && r.height === 0)) return;
              const ok =
                r.left >= sh.l - 2 &&
                r.right <= sh.r + 2 &&
                r.top >= sh.t - 2 &&
                r.bottom <= sh.b + 2;
              if (!ok)
                outside.push({
                  id: el.id,
                  page: single[i]! + 1,
                  rect: [r.left, r.top, r.right, r.bottom].map(Math.round),
                  sheet: [sh.l, sh.t, sh.r, sh.b].map(Math.round),
                });
            });

            const rows = [...rowMap.entries()]
              .sort((a, b) => a[0] - b[0])
              .map(([top, v]) => ({
                top,
                sheets: v.sort((a, b) => a.l - b.l).map(({ page, side }) => ({ page, side })),
              }));

            const spreadGeometry = collectRows();
            const spreadVerticalGaps = spreadGeometry.slice(1).map((row, i) =>
              Math.round(row.top - Math.max(...spreadGeometry[i]!.sheets.map((sheet) => sheet.b))),
            );
            const spreadHorizontalGaps = spreadGeometry.flatMap((row) =>
              row.sheets.slice(1).map((sheet, i) => Math.round(sheet.l - row.sheets[i]!.r)),
            );

            // HIT-TRANSPARENCY over the cross-run overlap (viewer.css's
            // `.gp-run { pointer-events: none }` + `.gp-strip > * { auto }`):
            // a recto-starting run's box blankets the previous run's last row
            // (the margin pull asserted below), and used to WIN
            // elementFromPoint over the covered page — its empty
            // `.gp-wrap-spacer` slot let the page paint through while
            // swallowing every click/right-click/selection on it. Probe a
            // content element on the covered page: the hit must resolve
            // inside that page's own content (pageOf agrees), never a
            // `.gp-strip`/`.gp-run` chrome box. (This fixture has no author
            // `.page` wrappers — page identity comes from `pageOf()`, the
            // parity-gated answer.) NOTE: this probe scrolls, so it runs
            // after every geometry read above.
            const overlapHit = (() => {
              for (const spacer of Array.from(
                document.querySelectorAll<HTMLElement>(".gp-strip > .gp-wrap-spacer"),
              )) {
                const run = spacer.parentElement?.closest(".gp-run");
                const prevRun = run?.previousElementSibling;
                if (!(prevRun instanceof HTMLElement) || !prevRun.classList.contains("gp-run"))
                  continue; // the book's own first page also gets a spacer — no covered row there
                let coveredPage = -1;
                for (const sh of Array.from(prevRun.querySelectorAll<HTMLElement>(".gp-sheet"))) {
                  coveredPage = Math.max(coveredPage, Number(sh.dataset.page) - 1);
                }
                const probe = probeEls.find((el) => gp.pageOf(el) === coveredPage);
                if (!probe) continue;
                probe.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
                const r = probe.getClientRects()[0] ?? probe.getBoundingClientRect();
                const hit = document.elementFromPoint(
                  (r.left + r.right) / 2,
                  (r.top + r.bottom) / 2,
                );
                const hitEl = hit instanceof HTMLElement ? hit : null;
                return {
                  coveredPage: coveredPage + 1,
                  hitId: hitEl ? hitEl.id || hitEl.tagName.toLowerCase() : null,
                  hitIsChrome: !!hitEl &&
                    ["gp-run", "gp-strip", "gp-wrap-spacer", "gp-layer", "gp-sheet"].some((c) =>
                      hitEl.classList.contains(c),
                    ),
                  hitPage: hitEl?.closest(".gp-strip") ? gp.pageOf(hitEl) + 1 : null,
                };
              }
              return null;
            })();

            return {
              supported:
                CSS.supports("column-wrap", "wrap") && CSS.supports("column-height", "100px"),
              wrapped: !!document.querySelector('.gp-strip[data-wrap="on"]'),
              totalPages: gp.totalPages,
              sheetGap: Math.round(parseFloat(
                getComputedStyle(document.querySelector<HTMLElement>(".gp-strip")!).getPropertyValue("--gp-sheet-gap"),
              )),
              singleVerticalGaps,
              spreadVerticalGaps,
              spreadHorizontalGaps,
              probes: probeEls.length,
              pageOfMismatches,
              outside,
              rows,
              singleRows,
              singleSheetLefts,
              overlapHit,
            } as SpreadReport;
          });
        } finally {
          await page.close();
        }

        // The fixture is only meaningful if the browser under test actually
        // has column-wrap; otherwise this run measured the single-row
        // fallback and must say so instead of passing vacuously.
        expect(report.supported).toBe(true);
        expect(report.wrapped).toBe(true);
        // Long enough to wrap into several rows — a 2-page book would pass a
        // broken row pitch trivially.
        expect(report.totalPages).toBeGreaterThanOrEqual(6);
        expect(report.probes).toBeGreaterThan(10);

        // SINGLE MODE is a 1-column wrap: one page per row, top to bottom,
        // in book order — one continuous vertical column of pages, which is
        // what a page-at-a-time reader expects. The regression this guards
        // (reported against 0.10.0-alpha.1): with no wrap applied at all,
        // each named-page RUN laid its pages out in one long HORIZONTAL row
        // and the runs stacked vertically, so a book with many runs showed
        // its pages ragged-wrapped into rows of varying length. Note the
        // fixture must have several runs for this to have teeth — a
        // single-run book stacks correctly either way.
        expect(report.singleRows.map((r) => r.sheets.length > 1)).not.toContain(true);
        expect(report.singleRows.flatMap((r) => r.sheets.map((s) => s.page))).toEqual(
          Array.from({ length: report.totalPages }, (_, i) => i + 1),
        );
        expect(report.singleVerticalGaps.length).toBeGreaterThan(1);
        expect(report.singleVerticalGaps).toEqual(
          report.singleVerticalGaps.map(() => report.sheetGap),
        );
        // Screen-viewer paper is a stable navigation surface: mirrored and
        // named-page margins may not make sheets wobble horizontally. Native
        // multicol has one fixed content-column origin, so page-specific
        // margin fidelity remains the PDF's contract; moving paper chrome
        // around that fixed origin made the real field guide stagger by 24px.
        expect(Math.max(...report.singleSheetLefts) - Math.min(...report.singleSheetLefts)).toBeLessThanOrEqual(1);

        // (2) a view mode may not move a page boundary.
        expect(report.pageOfMismatches).toEqual([]);
        // (1) …and may not leave content outside the sheet drawn for it.
        expect(report.outside).toEqual([]);

        // pairing: no row holds >2 sheets; any 2-sheet row is a consecutive
        // (verso, recto) pair; any solo sheet is on its correct side.
        const badRows = report.rows.filter((row) => {
          if (row.sheets.length > 2) return true;
          if (row.sheets.length === 2) {
            const [a, b] = row.sheets;
            return !(a!.side === "verso" && b!.side === "recto" && b!.page === a!.page + 1);
          }
          return false;
        });
        expect(badRows).toEqual([]);
        expect(report.rows[0]!.sheets).toEqual([{ page: 1, side: "recto" }]);
        expect(report.spreadVerticalGaps.length).toBeGreaterThan(1);
        expect(report.spreadVerticalGaps).toEqual(
          report.spreadVerticalGaps.map(() => report.sheetGap),
        );
        expect(report.spreadHorizontalGaps.length).toBeGreaterThan(1);
        expect(report.spreadHorizontalGaps).toEqual(
          report.spreadHorizontalGaps.map(() => report.sheetGap),
        );

        // CROSS-RUN COMPOSITION: a recto-starting run overlaps the previous
        // run's solo-verso row (decorate.ts's parity-proof margin pull), so
        // consecutive verso|recto pairs compose ACROSS run boundaries too.
        // The only legitimate solo rows are page 1 (the cover convention)
        // and, when the book ends on a verso, the final page. Anything else
        // solo means the overlap regressed and "spread view" is stacking
        // single pages again — the defect that made the first cross-run
        // implementation unacceptable (17 of 35 rows solo on the design
        // guide).
        const soloPages = report.rows
          .filter((row) => row.sheets.length === 1)
          .map((row) => row.sheets[0]!.page);
        const allowedSolos = new Set([1]);
        if (report.totalPages % 2 === 0) allowedSolos.add(report.totalPages);
        expect(soloPages.filter((p) => !allowedSolos.has(p))).toEqual([]);

        // …and the overlap that composes those cross-run pairs must be
        // hit-TRANSPARENT: elementFromPoint over the covered page's own
        // content resolves to that page's content, never the overlapping
        // run/strip chrome (the regression: 60/60 dead pointer probes on
        // every covered page in two-column view — right-click,
        // click-to-source, links, and text selection all dead).
        expect(report.overlapHit).not.toBeNull();
        expect(report.overlapHit!.hitIsChrome).toBe(false);
        expect(report.overlapHit!.hitPage).toBe(report.overlapHit!.coveredPage);
      } finally {
        await close();
      }
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  },
  RENDER_TEST_TIMEOUT_MS
);
}
