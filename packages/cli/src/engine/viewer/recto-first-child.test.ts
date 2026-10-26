import { test, expect, afterAll } from "bun:test";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import { resolveChromiumExecutable } from "../../lib/chromium.ts";
import { getAssetPath } from "../../lib/embedded-assets.ts";
import { serveDir } from "./test-support/serve-dir.ts";
import { closeBrowser, getBrowser } from "./test-support/browser.ts";

/**
 * dimm-city/gutterpress#421: a `break-before: left | right | recto | verso`
 * site that is the first child of its wrapper got no blank page in the
 * preview. `compensateRectoBreaks()` planned the blank but built it from two
 * zero-height `break-before: column` spacers, and Chromium ignores a forced
 * break that would leave a column empty, so a spacer that was the first box
 * in its column broke nothing. The element then sat on the wrong side and
 * every later page was numbered one lower than in the PDF.
 *
 * The fixture is the issue's repro in marker-book shape (`.chapter >
 * .section.opener`): one opener at the very start of the book, one after a
 * one-page chapter. Both must land on left-hand (even) pages, where the PDF
 * puts them, and the blanks must show up as blank pages.
 */

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const RENDER_TEST_TIMEOUT_MS = 60_000;

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;
if (!chromium) {
  // eslint-disable-next-line no-console
  console.warn(
    "[recto-first-child.test] No Chromium resolved via resolveChromiumExecutable() — skipping. Install Chrome/Chromium or set CHROMIUM_PATH to run it."
  );
}

afterAll(async () => {
  await closeBrowser();
});

testIf(
  "a left-hand opener that is its wrapper's first child gets its blank page, at the start of the book and after a chapter",
  async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "gp-recto-first-child-"));
    try {
      fs.copyFileSync(path.join(FIXTURES_DIR, "recto-first-child.html"), path.join(dir, "recto-first-child.html"));
      fs.copyFileSync(await getAssetPath("engine/gutterpress-viewer.js"), path.join(dir, "gutterpress-viewer.js"));
      const { url, close } = await serveDir(dir, "recto-first-child.html");
      try {
        const page = await (await getBrowser()).newPage();
        try {
          await page.setViewport({ width: 1200, height: 900 });
          await page.goto(url);
          await page.waitForFunction("window.Gutterpress && window.Gutterpress.totalPages > 0");
          const report = await page.evaluate(() => {
            const gp = (window as any).Gutterpress;
            const pageOf = (id: string) => gp.pageOf(document.getElementById(id)!) + 1; // 1-based
            const blanks = Array.from(document.querySelectorAll(".gp-recto-spacer")).map(
              (el) => gp.pageOf(el) + 1,
            );
            return {
              totalPages: gp.totalPages as number,
              one: pageOf("opener-one"),
              two: pageOf("opener-two"),
              blanks,
            };
          });
          // The PDF: blank 1, chapter one on 2, blank 3, chapter two on 4.
          expect(report.one).toBe(2);
          expect(report.two).toBe(4);
          expect(report.blanks).toEqual([1, 3]);
          expect(report.totalPages).toBe(4);
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
