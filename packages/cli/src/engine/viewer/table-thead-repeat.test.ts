/**
 * The viewer repeats a table header on a continuation sheet only where print
 * does, and draws it the way print does.
 *
 * Chromium prints a `<thead>` on every page a table spans while the section is
 * `display: table-header-group`. An author who sets `thead { display:
 * table-row-group }` gets the header once, at the top, in print, and the
 * viewer's repeated-header shim must follow the same standard CSS rather than
 * repeat every `tHead` it finds. Where the header does repeat, the shim copies
 * the header cell's look (case, tracking, colour), not just its font.
 */
import { serveDir } from "./test-support/serve-dir.ts";
import { test, expect, afterAll, describe } from "bun:test";
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

// Content box 236px tall (300 - 2 * 32): 16 rows of 20px under a 20px header
// cannot fit on one sheet, so the table continues on the next.
function bookHtml(theadCss: string): string {
  const rows = Array.from({ length: 16 }, (_, i) => `<tr><td>${i + 1}</td><td>Row ${i + 1}</td></tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: 360px 300px; margin: 32px; }
html { font: 14px/21px sans-serif; }
body { margin: 0; }
table { border-collapse: collapse; width: 100%; margin: 0; }
td, th { padding: 0; height: 20px; line-height: 20px; }
th { text-transform: uppercase; letter-spacing: 2px; color: rgb(200, 0, 0); }
${theadCss}
</style></head><body><main>
<table><thead><tr><th>Roll</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table>
</main><script src="gutterpress-viewer.js"></script></body></html>`;
}

async function renderShims(theadCss: string) {
  const dir = await fsp.mkdtemp(path.join(path.dirname(FIXTURES_DIR), ".table-thead-repeat-"));
  try {
    await fsp.writeFile(path.join(dir, "book.html"), bookHtml(theadCss));
    await fsp.copyFile(await getAssetPath("engine/gutterpress-viewer.js"), path.join(dir, "gutterpress-viewer.js"));
    const { url, close } = await serveDir(dir, "book.html");
    try {
      const browser = await getBrowser();
      const page = await browser.newPage();
      try {
        await page.setViewport({ width: 1280, height: 900 });
        await page.goto(url);
        await page.waitForFunction("window.Gutterpress?.totalPages > 0");
        await new Promise((r) => setTimeout(r, 200));
        return (await page.evaluate(() => {
          const shims = Array.from(document.querySelectorAll<HTMLTableRowElement>("tr.gp-thead-shim"));
          const cell = shims[0]?.cells[0];
          const cs = cell ? getComputedStyle(cell) : null;
          return {
            pages: (window as unknown as { Gutterpress: { totalPages: number } }).Gutterpress.totalPages,
            shims: shims.length,
            look: cs ? { transform: cs.textTransform, spacing: cs.letterSpacing, color: cs.color } : null,
          };
        })) as {
          pages: number;
          shims: number;
          look: { transform: string; spacing: string; color: string } | null;
        };
      } finally {
        await page.close();
      }
    } finally {
      await close();
    }
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

describe("viewer repeats a table header only where print does", () => {
  testIf(
    "a header group repeats on the continuation sheet, drawn like the header",
    async () => {
      const r = await renderShims("");
      expect(r.pages).toBeGreaterThan(1);
      expect(r.shims).toBe(1);
      expect(r.look).toEqual({ transform: "uppercase", spacing: "2px", color: "rgb(200, 0, 0)" });
    },
    RENDER_TEST_TIMEOUT_MS,
  );

  testIf(
    "a thead set to display: table-row-group prints once and is not repeated",
    async () => {
      const r = await renderShims("thead { display: table-row-group; }");
      expect(r.pages).toBeGreaterThan(1);
      expect(r.shims).toBe(0);
    },
    RENDER_TEST_TIMEOUT_MS,
  );
});
