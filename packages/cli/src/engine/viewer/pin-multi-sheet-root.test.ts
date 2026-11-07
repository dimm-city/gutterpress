import { serveDir } from "./test-support/serve-dir.ts";
import { test, expect, afterAll } from "bun:test";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveChromiumExecutable } from "../../lib/chromium.ts";
import { getAssetPath } from "../../lib/embedded-assets.ts";
import { closeBrowser, getBrowser } from "./test-support/browser.ts";

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const RENDER_TEST_TIMEOUT_MS = 60_000;
const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;

afterAll(async () => {
  await closeBrowser();
});

testIf(
  "a page root that spans two sheets is stretched to two sheets, so a bottom pin sits at the foot of the last (#519)",
  async () => {
    const dir = await fsp.mkdtemp(path.join(path.dirname(FIXTURES_DIR), ".pin-multi-sheet-"));
    try {
      await fsp.copyFile(
        path.join(FIXTURES_DIR, "pin-multi-sheet.html"),
        path.join(dir, "pin-multi-sheet.html"),
      );
      await fsp.copyFile(
        await getAssetPath("engine/gutterpress-viewer.js"),
        path.join(dir, "gutterpress-viewer.js"),
      );
      const { url, close } = await serveDir(dir, "pin-multi-sheet.html");
      try {
        const browser = await getBrowser();
        const page = await browser.newPage();
        try {
          await page.goto(url);
          await page.waitForFunction("window.Gutterpress?.totalPages > 0");
          const result = await page.evaluate(() => {
            const root = document.querySelector<HTMLElement>("#long")!;
            const pin = document.querySelector<HTMLElement>(".pin")!;
            const rects = Array.from(root.getClientRects());
            const strip = root.closest<HTMLElement>(".gp-strip")!;
            return {
              runPages: (window as any).Gutterpress.strips.find((s: any) => s.el === strip).pages,
              minHeight: root.style.minHeight,
              fragments: rects.length,
              lastBottom: rects[rects.length - 1]!.bottom,
              pinBottom: pin.getBoundingClientRect().bottom,
              contentH: getComputedStyle(strip).getPropertyValue("--gp-content-h"),
            };
          });
          // two sheets of a 360px content box, less the 1px cushion
          expect(result.contentH).toBe("360px");
          expect(parseFloat(result.minHeight)).toBeCloseTo(719, 1);
          expect(result.fragments).toBe(2);
          // the stretch must not add a sheet to the run
          expect(result.runPages).toBe(2);
          expect(result.pinBottom).toBeCloseTo(result.lastBottom, 0);
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

