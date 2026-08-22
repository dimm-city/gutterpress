import { serveDir } from "./test-support/serve-dir.ts";
import { test, expect, afterAll } from "bun:test";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveChromiumExecutable } from "../../lib/chromium.ts";
import { getAssetPath } from "../../lib/embedded-assets.ts";
import { closeBrowser, getBrowser } from "../../lib/browser-pool.ts";
import { MARKER_CSS } from "../../lib/markdown/markers.js";
import { GUTTERPRESS_CSS } from "../../lib/markdown/gutterpress-css.ts";

/**
 * `.gp-flush` in the VIEWER — the preview twin of the print measurement in
 * `compiler/build.page-content-height.test.ts`.
 *
 * The viewer implements flush in JS from the same shared policy the compiler
 * uses (shared/flush.ts): a run whose root carries flush pins gets a strip
 * whose content box grows into the freed margins, while decoration keeps the
 * AUTHOR context's geometry — sheets and margin-box furniture do not move.
 * The whole mechanism has to survive a completely different fragmenter than
 * print's. If it ever does not, an author sees art on the paper's edge on
 * screen and art at the margin in the PDF — the worst failure this project
 * can produce.
 */

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const RENDER_TEST_TIMEOUT_MS = 60_000;
const PAGE_MARGIN = 40;

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;

afterAll(async () => {
  await closeBrowser();
});

testIf(
  "the viewer puts a flush pin on the sheet edge and an ordinary pin on the margin",
  async () => {
    const dir = await fsp.mkdtemp(path.join(FIXTURES_DIR, "..", ".flush-pin-"));
    try {
      const source = await fsp.readFile(path.join(FIXTURES_DIR, "flush-pin.html"), "utf8");
      await fsp.writeFile(
        path.join(dir, "flush-pin.html"),
        source.replace("</style>", `</style>\n<style>${MARKER_CSS}\n${GUTTERPRESS_CSS}</style>`),
        "utf8",
      );
      await fsp.copyFile(
        await getAssetPath("engine/gutterpress-viewer.js"),
        path.join(dir, "gutterpress-viewer.js"),
      );
      const { url, close } = await serveDir(dir, "flush-pin.html");
      try {
        const browser = await getBrowser(RENDER_TEST_TIMEOUT_MS);
        const page = await browser.newPage();
        try {
          await page.goto(url, { waitUntil: "networkidle0" });
          await page.waitForFunction("window.Gutterpress?.totalPages > 0");
          const m = await page.evaluate(() => {
            const sheets = Array.from(document.querySelectorAll(".gp-sheet")).map((s) =>
              s.getBoundingClientRect(),
            );
            const gap = (id: string) => {
              const r = document.getElementById(id)!.getBoundingClientRect();
              const sheet = sheets.find((s) => r.top >= s.top - 2 && r.bottom <= s.bottom + 2)!;
              return { fromSheetBottom: sheet.bottom - r.bottom, found: !!sheet };
            };
            return {
              totalPages: (window as any).Gutterpress.totalPages,
              plain: gap("plain-art"),
              flush: gap("flush-art"),
              flushPageName:
                document.getElementById("flush")!.closest<HTMLElement>(".gp-strip")!.dataset.page,
              flushStripContentH: getComputedStyle(
                document.getElementById("flush")!.closest<HTMLElement>(".gp-strip")!,
              ).getPropertyValue("--gp-content-h"),
            };
          });

          // Two page roots, two sheets: freeing a margin must not cost a page
          // here any more than it does in print.
          expect(m.totalPages).toBe(2);
          expect(m.plain.found).toBe(true);
          expect(m.flush.found).toBe(true);

          // The ordinary pin rests on the content box's floor: one margin up
          // from the paper, plus MARKER_CSS's 1px page-root cushion.
          expect(m.plain.fromSheetBottom).toBeGreaterThan(PAGE_MARGIN - 2);
          expect(m.plain.fromSheetBottom).toBeLessThan(PAGE_MARGIN + 2);

          // The flush pin rests on the paper itself.
          expect(m.flush.fromSheetBottom).toBeLessThan(2);

          // The strip's own geometry grew (the print twin is the compiler's
          // generated page context), but the AUTHOR's page context is what
          // the viewer keeps: no named page is visible anywhere the author
          // or the tooling looks.
          expect(m.flushPageName).toBeUndefined();
          // sheet 500px tall, top margin kept, bottom margin freed
          expect(m.flushStripContentH).toBe(`${500 - PAGE_MARGIN}px`);
        } finally {
          await page.close();
        }
      } finally {
        await close();
      }
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  },
  RENDER_TEST_TIMEOUT_MS,
);
