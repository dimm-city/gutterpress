/**
 * Regression guard (#318): every page BREAK is identical at every zoom level.
 *
 * `zoom.test.ts` pins the page COUNT and `pageOf()`'s coordinate spaces; this
 * pins where the breaks fall. The stage used to be zoomed with CSS `zoom`,
 * which is a layout input: lengths and font sizes are scaled before text
 * shaping and LayoutUnit snapping, so Chromium's column fragmentation broke
 * lines at different points per zoom level. In the user guide a paragraph
 * started on page 6 at 50% and on page 7 at 25%, while the page count
 * stayed the same, which is why a count assertion never saw it. Zoom is now
 * a paint transform, so layout (and therefore every break) is the zoom-1 one
 * and matches print.
 *
 * The book is generated here: prose with fractional font size, line height
 * and margins, so line boxes do not land on whole device pixels at any zoom
 * (the condition that made `zoom` shift breaks). Every word is its own span,
 * and the signature is the global index of the first word painted on each
 * sheet, read in rect space, so a single moved line changes it.
 */
import { serveDir } from "./test-support/serve-dir.ts";
import { test, expect, afterAll } from "bun:test";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveChromiumExecutable } from "../../lib/chromium.ts";
import { getAssetPath } from "../../lib/embedded-assets.ts";
import { closeBrowser, getBrowser } from "./test-support/browser.ts";

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const RENDER_TEST_TIMEOUT_MS = 120_000;
const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;

afterAll(async () => {
  await closeBrowser();
});

/** Deterministic prose: a seeded LCG picks words, so the fixture never drifts. */
function bookHtml(): string {
  const words = (
    "the quick brown fox jumps over a lazy dog while printing presses hum and " +
    "margins gutters bleed columns leading kerning ligature widow orphan folio " +
    "signature spine trim fold paper ink proof"
  ).split(" ");
  let seed = 318;
  const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
  let w = 0;
  const paras: string[] = [];
  for (let p = 0; p < 70; p++) {
    const n = 25 + (next() % 60);
    const spans: string[] = [];
    for (let i = 0; i < n; i++) spans.push(`<span data-w="${w++}">${words[next() % words.length]}</span>`);
    paras.push(`<p>${spans.join(" ")}</p>`);
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: 420px 520px; margin: 37px 41px; }
body { margin: 0; font: 13.3px/1.37 Georgia, serif; }
p { margin: 0 0 9.3px; }
</style></head><body><main>${paras.join("\n")}</main><script src="gutterpress-viewer.js"></script></body></html>`;
}

testIf(
  "page breaks are identical at every zoom level",
  async () => {
    const dir = await fsp.mkdtemp(path.join(path.dirname(FIXTURES_DIR), ".zoom-breaks-"));
    try {
      await fsp.writeFile(path.join(dir, "book.html"), bookHtml());
      await fsp.copyFile(
        await getAssetPath("engine/gutterpress-viewer.js"),
        path.join(dir, "gutterpress-viewer.js"),
      );
      const { url, close } = await serveDir(dir, "book.html");
      try {
        const browser = await getBrowser();
        const page = await browser.newPage();
        try {
          await page.setViewport({ width: 1280, height: 900 });
          await page.goto(url);
          await page.waitForFunction("window.Gutterpress?.totalPages > 0");

          const firstWordPerSheet = (zoom: string | null) =>
            page.evaluate(async (zoom) => {
              const root = document.documentElement;
              if (zoom === null) root.style.removeProperty("--gutterpress-zoom");
              else root.style.setProperty("--gutterpress-zoom", zoom);
              await new Promise((r) => setTimeout(r, 150));
              const sheets = Array.from(document.querySelectorAll<HTMLElement>(".gp-sheet[data-page]"));
              const boxes = sheets.map((s) => s.getBoundingClientRect());
              const first: Record<string, number> = {};
              for (const el of document.querySelectorAll<HTMLElement>("span[data-w]")) {
                const r = el.getBoundingClientRect();
                const x = r.left + r.width / 2;
                const y = r.top + r.height / 2;
                const i = boxes.findIndex(
                  (b) => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom,
                );
                if (i >= 0 && !(sheets[i]!.dataset.page! in first))
                  first[sheets[i]!.dataset.page!] = Number(el.dataset.w);
              }
              return { pages: sheets.length, first };
            }, zoom);

          const atZoom1 = await firstWordPerSheet(null);
          expect(atZoom1.pages).toBeGreaterThan(8);
          expect(Object.keys(atZoom1.first).length).toBe(atZoom1.pages);

          for (const zoom of ["0.25", "0.5", "0.75", "0.7936", "1.5"]) {
            const zoomed = await firstWordPerSheet(zoom);
            expect({ zoom, ...zoomed }).toEqual({ zoom, ...atZoom1 });
          }
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
