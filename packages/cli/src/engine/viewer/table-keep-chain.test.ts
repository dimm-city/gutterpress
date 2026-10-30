/**
 * Regression guard (#370): a table whose header fits at a sheet's foot with no
 * room for the first body row starts on the next sheet, and the keep-with-next
 * chain above it — a heading, or, with the lead-in rule in MARKER_CSS, a
 * lead-in paragraph — goes with it, as print does (print never strands a lone
 * header).
 *
 * The viewer used to force a break before the chain's head itself, because
 * multicol did not repeat a plain `thead`. viewer.css now makes the header
 * group `break-inside: avoid`, and Chromium then repeats it and breaks around
 * it in a column as it does on a page (#454), so this is its own fragmenter's
 * answer.
 *
 * The fixture is sized so the header row fits in the space left after the
 * label and the first body row does not (the failing arrangement), once with a
 * lead-in paragraph and once with an `h3`.
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

// Content box 236px tall (300 - 2 * 32), 21px lines: 9 filler lines + the
// label = 210px, leaving 26px — room for the 20px header row, not for the
// 20px first body row.
const FILLERS = 9;

function bookHtml(label: "p" | "h3"): string {
  const fill = Array.from({ length: FILLERS }, (_, i) => `<p class="fill">Filler line ${i + 1}.</p>`).join("");
  const lead = label === "p" ? `<p id="label">Roll a die!</p>` : `<h3 id="label">Roll a die!</h3>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: 360px 300px; margin: 32px; }
html { font: 14px/21px sans-serif; }
body { margin: 0; }
p, h3, table { margin: 0; padding: 0; }
h3 { font: bold 14px/21px sans-serif; }
table { border-collapse: collapse; width: 100%; }
td, th { padding: 0; height: 20px; line-height: 20px; }
h3 { break-after: avoid; }
:where(p):has(+ :where(table, ul, ol)) { break-after: avoid; }
</style></head><body><main>${fill}${lead}
<table><thead><tr><th>Roll</th><th>Result</th></tr></thead><tbody>
<tr><td>1-3</td><td>Lose a turn</td></tr><tr><td>4-6</td><td>Roll again</td></tr></tbody></table>
</main><script src="gutterpress-viewer.js"></script></body></html>`;
}

describe("a table moved off a sheet keeps its keep-with-next chain together (#370)", () => {
  for (const label of ["p", "h3"] as const) {
    testIf(
      `a ${label === "p" ? "lead-in paragraph" : "heading"} stays on the sheet its <thead> table starts on`,
      async () => {
        const dir = await fsp.mkdtemp(path.join(path.dirname(FIXTURES_DIR), ".table-keep-chain-"));
        try {
          await fsp.writeFile(path.join(dir, "book.html"), bookHtml(label));
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
              await new Promise((r) => setTimeout(r, 200));

              const sheets = (await page.evaluate(() => {
                const boxes = Array.from(document.querySelectorAll<HTMLElement>(".gp-sheet[data-page]")).map(
                  (s) => s.getBoundingClientRect(),
                );
                const sheetOf = (el: Element) => {
                  const r = el.getClientRects()[0]!;
                  const x = r.left + r.width / 2;
                  const y = r.top + r.height / 2;
                  return boxes.findIndex((b) => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom);
                };
                const fills = Array.from(document.querySelectorAll(".fill"));
                return {
                  lastFiller: sheetOf(fills[fills.length - 1]!),
                  label: sheetOf(document.getElementById("label")!),
                  header: sheetOf(document.querySelector("thead tr")!),
                  firstRow: sheetOf(document.querySelector("tbody tr")!),
                };
              })) as { lastFiller: number; label: number; header: number; firstRow: number };

              // The fillers fill sheet 0; the table cannot start there (its
              // header would be stranded), so the chain moves as one.
              expect(sheets.lastFiller).toBe(0);
              expect(sheets.header).toBe(sheets.firstRow);
              expect(sheets.header).toBeGreaterThan(0);
              expect(sheets.label).toBe(sheets.header);
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
  }
});
