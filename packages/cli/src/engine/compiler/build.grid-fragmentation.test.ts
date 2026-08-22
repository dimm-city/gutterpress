import { expect, test } from "bun:test";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getDocumentProxy } from "unpdf";

import { MARKER_CSS } from "../../lib/markdown/markers.js";
import { GUTTERPRESS_CSS } from "../../lib/markdown/gutterpress-css.ts";
import { resolveChromiumExecutable } from "../../lib/chromium.ts";
import { launchChromium } from "../shared/cdp.ts";
import { build } from "./build.ts";

/**
 * `.gp-grid-2` under fragmentation: the core promise the vocabulary shipped
 * on. A grid row taller than the page must fragment across sheets — both
 * columns continuing on the next sheet at unchanged x positions — with no
 * fit-one-page constraint. MEASURED before the class existed (Chromium 151,
 * gp-grid evidence pack, 4-verifier review): 2- and 3-col rows fragment
 * with EXACT print/viewer row parity, equal and unequal item heights,
 * mid-row cuts, multi-sheet overflow; gap geometry is pixel-identical
 * across the cut. This test pins the PRINT half of that finding in the
 * shipped PDF; the viewer half is held by the parity gate's gp-grid
 * fixture (docs/fixtures/gp-grid/book).
 *
 * Geometry mirrors the evidence pack's fixtures: 400x500px sheet, 40px
 * margins -> a 320x420px content box; 10px/20px monospace lines, so every
 * line is exactly 20px and 21 lines fill one page. Two 40-line sections as
 * the grid items -> one 800px row on a 420px box -> exactly 2 sheets, cut
 * after line 21 of each column.
 */

const RENDER_TEST_TIMEOUT_MS = 90_000;

const SHEET_W = 400;
const SHEET_H = 500;
const MARGIN = 40;
const LINES = 40;
const LINES_PER_SHEET = 21; // (500 - 2*40) / 20

const lines = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => `<p>${prefix}${String(i + 1).padStart(2, "0")}</p>`).join(
    "\n",
  );

const fixture = `<!doctype html><meta charset="utf-8"><style>
${MARKER_CSS}
${GUTTERPRESS_CSS}
@page { size: ${SHEET_W}px ${SHEET_H}px; margin: ${MARGIN}px; }
p { margin: 0; font: 10px/20px monospace; }
</style>
<div class="page gp-grid-2">
<section class="section">${lines("A", LINES)}</section>
<section class="section">${lines("B", LINES)}</section>
</div>`;

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;
if (!chromium) {
  // eslint-disable-next-line no-console
  console.warn(
    "[build.grid-fragmentation.test] No Chromium resolved — skipping. Install Chrome/Chromium or set CHROMIUM_PATH to run it.",
  );
}

testIf(
  "a .gp-grid-2 row taller than the page fragments: both columns continue on sheet 2 at unchanged x",
  async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "gp-grid-frag-"));
    const browser = await launchChromium();
    try {
      const file = path.join(dir, "book.html");
      await fsp.writeFile(file, fixture, "utf8");
      const result = await build({ input: pathToFileURL(file).href, browser, dpiFloor: 0 });

      // 40 lines per column, 21 per sheet: exactly 2 sheets — the row
      // fragments instead of clipping, shifting, or spilling a third sheet.
      expect(result.pageCount).toBe(2);
      expect(result.diagnostics).toEqual([]);

      const doc = await getDocumentProxy(result.bytes);
      const itemsOn = async (pageNumber: number) => {
        const tc = await (await doc.getPage(pageNumber)).getTextContent();
        return tc.items
          .map((i) => i as { str: string; transform: number[] })
          .filter((i) => i.str.trim())
          .map((i) => ({ str: i.str, x: i.transform[4]!, y: i.transform[5]! }));
      };
      const find = (items: Awaited<ReturnType<typeof itemsOn>>, needle: string) => {
        const hit = items.find((i) => i.str === needle);
        expect(hit, `expected "${needle}"`).toBeDefined();
        return hit!;
      };

      const p1 = await itemsOn(1);
      const p2 = await itemsOn(2);

      // Sheet 1 carries lines 1..21 of BOTH columns; the cut is mid-row.
      find(p1, "A01");
      find(p1, `A${LINES_PER_SHEET}`);
      find(p1, "B01");
      find(p1, `B${LINES_PER_SHEET}`);
      expect(p1.some((i) => i.str === `A${LINES_PER_SHEET + 1}`)).toBe(false);
      expect(p1.some((i) => i.str === `B${LINES_PER_SHEET + 1}`)).toBe(false);

      // Sheet 2 carries the REST OF BOTH columns — the measured behavior
      // this class shipped on. A wedged or re-placed grid would strand one
      // column's tail.
      find(p2, `A${LINES_PER_SHEET + 1}`);
      find(p2, `A${LINES}`);
      find(p2, `B${LINES_PER_SHEET + 1}`);
      find(p2, `B${LINES}`);

      // Column identity survives the cut: A stays the left track, B the
      // right, on both sheets.
      expect(find(p1, "A01").x).toBeLessThan(find(p1, "B01").x);
      expect(find(p2, `A${LINES_PER_SHEET + 1}`).x).toBeLessThan(
        find(p2, `B${LINES_PER_SHEET + 1}`).x,
      );

      // Gap geometry is pixel-identical across the cut (measured): each
      // track's x on sheet 2 equals its x on sheet 1.
      expect(find(p2, `A${LINES_PER_SHEET + 1}`).x).toBeCloseTo(find(p1, "A01").x, 1);
      expect(find(p2, `B${LINES_PER_SHEET + 1}`).x).toBeCloseTo(find(p1, "B01").x, 1);
    } finally {
      await browser.close();
      await fsp.rm(dir, { recursive: true, force: true });
    }
  },
  RENDER_TEST_TIMEOUT_MS,
);
