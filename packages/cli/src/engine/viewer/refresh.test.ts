import { serveDir } from "./test-support/serve-dir.ts";
import { test, expect, afterAll } from "bun:test";
import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveChromiumExecutable } from "../../lib/chromium.ts";
import { getAssetPath } from "../../lib/embedded-assets.ts";
import { closeBrowser, getBrowser } from "../../lib/browser-pool.ts";

/**
 * WP-B item 1: `Gutterpress.refresh()` must rebuild the strip structure, not
 * only re-measure the strips built at mount. `fixtures/refresh-splice.html`
 * starts as one page; the test splices in a `.on-named` element (assigned a
 * distinct `@page named` template via CSS already present at mount) and
 * calls `refresh()`. A sound refresh reports the SAME page count a fresh
 * navigation of the equivalent final DOM would
 * (`fixtures/refresh-splice-expected.html`) — an unsound re-measure-only
 * refresh silently keeps the old strip boundaries and under-reports.
 */

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const RENDER_TEST_TIMEOUT_MS = 60_000;

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;
if (!chromium) {
  // eslint-disable-next-line no-console
  console.warn(
    "[refresh.test] No Chromium resolved via resolveChromiumExecutable() — skipping. Install Chrome/Chromium or set CHROMIUM_PATH to run it."
  );
}

afterAll(async () => {
  await closeBrowser();
});


testIf(
  "refresh() after splicing in a new page-context element matches a fresh reload's page count",
  async () => {
    const dir = await fsp.mkdtemp(path.join(path.dirname(FIXTURES_DIR), ".refresh-test-"));
    try {
      for (const name of ["refresh-splice.html", "refresh-splice-expected.html"]) {
        await fsp.copyFile(path.join(FIXTURES_DIR, name), path.join(dir, name));
      }
      await fsp.copyFile(
        await getAssetPath("engine/gutterpress-viewer.js"),
        path.join(dir, "gutterpress-viewer.js")
      );
      const { url: root, close } = await serveDir(dir, "refresh-splice.html");
      // serveDir returns the server ROOT; build page URLs explicitly (the
      // old local copy embedded the entry in the URL and a .replace() built
      // the second one — which silently no-opped when the shape changed).
      const url = `${root}refresh-splice.html`;
      const expectedUrl = `${root}refresh-splice-expected.html`;
      try {
        const browser = await getBrowser(RENDER_TEST_TIMEOUT_MS);

        const page = await browser.newPage();
        let before: number;
        let afterRefresh: number;
        let repeat: { counts: number[]; runs: number[]; textSame: boolean[] };
        try {
          await page.goto(url, { waitUntil: "networkidle0" });
          await page.waitForFunction(
            "window.Gutterpress && window.Gutterpress.totalPages > 0"
          );
          before = await page.evaluate(() => (window as any).Gutterpress.totalPages);

          afterRefresh = await page.evaluate(() => {
            const root = document.getElementById("root")!;
            const spliced = document.createElement("div");
            spliced.className = "on-named";
            spliced.id = "spliced";
            spliced.innerHTML = '<p id="p2">Spliced content on its own named page.</p>';
            root.appendChild(spliced);
            (window as any).Gutterpress.refresh();
            return (window as any).Gutterpress.totalPages;
          });

          repeat = await page.evaluate(() => {
            const authored = () =>
              Array.from(document.querySelectorAll("p, h1, h2"))
                .filter((el) => !el.closest(".gp-layer"))
                .map((el) => el.textContent)
                .join("");
            const text0 = authored();
            const counts: number[] = [];
            const runs: number[] = [];
            const textSame: boolean[] = [];
            for (let i = 0; i < 3; i++) {
              (window as any).Gutterpress.refresh();
              counts.push((window as any).Gutterpress.totalPages);
              runs.push(document.querySelectorAll(".gp-run").length);
              textSame.push(authored() === text0);
            }
            return { counts, runs, textSame };
          });
        } finally {
          await page.close();
        }

        const expectedPage = await browser.newPage();
        let expected: number;
        try {
          await expectedPage.goto(expectedUrl, { waitUntil: "networkidle0" });
          await expectedPage.waitForFunction(
            "window.Gutterpress && window.Gutterpress.totalPages > 0"
          );
          expected = await expectedPage.evaluate(() => (window as any).Gutterpress.totalPages);
        } finally {
          await expectedPage.close();
        }

        // The bug this guards: an unsound refresh() reports `before` again
        // (the new page context is invisible to it) instead of `expected`.
        expect(before).toBeLessThan(expected);
        expect(afterRefresh).toBe(expected);
        // Repeated refresh must be idempotent, in page count AND in DOM
        // shape: `unwrapStrips()` has to remove decorate.ts's `.gp-run`
        // wrapper too, or each refresh leaves an orphan behind that the next
        // `buildStrips()` sweeps up as authored content (the ghost-page
        // failure `unwrapStrips`'s own comment records). Counting runs is
        // what catches an unwrap that "works" only because the page count
        // happens to survive.
        expect(repeat.counts).toEqual([expected, expected, expected]);
        expect(repeat.runs).toEqual([repeat.runs[0], repeat.runs[0], repeat.runs[0]]);
        expect(repeat.textSame).toEqual([true, true, true]);
      } finally {
        await close();
      }
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  },
  RENDER_TEST_TIMEOUT_MS
);
