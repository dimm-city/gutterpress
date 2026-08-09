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

function serveDir(dir: string, entry: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent((req.url ?? "/").split("?")[0]!).replace(/^\/+/, "");
    const filePath = path.join(dir, rel || entry);
    if (!filePath.startsWith(dir) || !fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.setHeader(
      "content-type",
      filePath.endsWith(".js") ? "text/javascript" : "text/html"
    );
    fs.createReadStream(filePath).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      resolve({
        url: `http://127.0.0.1:${port}/${entry}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

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
      const { url, close } = await serveDir(dir, "refresh-splice.html");
      try {
        const browser = await getBrowser(RENDER_TEST_TIMEOUT_MS);

        const page = await browser.newPage();
        let before: number;
        let afterRefresh: number;
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
        } finally {
          await page.close();
        }

        const expectedUrl = url.replace("refresh-splice.html", "refresh-splice-expected.html");
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
      } finally {
        await close();
      }
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  },
  RENDER_TEST_TIMEOUT_MS
);
