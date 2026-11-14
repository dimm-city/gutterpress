import { serveDir } from "./test-support/serve-dir.ts";
import { test, expect, afterAll } from "bun:test";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { resolveChromiumExecutable } from "../../lib/chromium.ts";
import { getAssetPath } from "../../lib/embedded-assets.ts";
import { closeBrowser, getBrowser } from "./test-support/browser.ts";

/**
 * Mounting must not force a style recalc of its own for every run of
 * same-named pages it builds and draws.
 *
 * THE BUG THIS EXISTS FOR: `buildStrips` and `draw` each read a computed style
 * inside their per-run loop, straight after the previous run's writes, so
 * every run forced a recalc. Alone that is cheap. But a book stylesheet with
 * a rule such as `:is(.a, .b) > .label + *` makes Chromium dirty every later
 * sibling of an inserted element, the rest of the book, so each of those
 * recalcs covered the whole document: a 248-page book in 60 runs recalculated
 * its 14,000 elements about 90 times per mount, 8 of 12 seconds (measured).
 *
 * Counted, not timed: the recalcs a mount adds per extra run. Measured on this
 * fixture, 3.0 per run before the reads were hoisted out of the loops and 2.0
 * after (the two left are each strip's own inline-style writes, which dirty
 * that strip alone).
 */

const RENDER_TEST_TIMEOUT_MS = 60_000;

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;
if (!chromium) {
  // eslint-disable-next-line no-console
  console.warn("[recalc-per-run.test] No Chromium resolved via resolveChromiumExecutable() — skipping.");
}

afterAll(async () => {
  await closeBrowser();
});

/** A book of `runs` blocks on alternating named pages: one strip each. */
function book(runs: number): string {
  const blocks = Array.from(
    { length: runs },
    (_, i) => `<div class="page ${i % 2 ? "b" : "a"}"><p class="label">Block ${i}</p><p>Text.</p></div>`,
  ).join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Runs</title><style>
@page { size: 4in 3in; margin: 0.4in; }
@page a { margin-top: 0.5in; }
@page b { margin-top: 0.6in; }
body { margin: 0; font: 10pt serif; }
.page { break-before: page; }
.page.a { page: a; }
.page.b { page: b; }
:is(.a, .b) > .label + * { color: #333; }
</style></head><body>
${blocks}
<script src="gutterpress-viewer.js"></script>
</body></html>`;
}

testIf(
  "a mount adds fewer than 2.5 style recalcs per run of named pages",
  async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "gutterpress-recalc-test-"));
    try {
      await fsp.copyFile(
        await getAssetPath("engine/gutterpress-viewer.js"),
        path.join(dir, "gutterpress-viewer.js"),
      );
      await fsp.writeFile(path.join(dir, "few.html"), book(10));
      await fsp.writeFile(path.join(dir, "many.html"), book(40));
      const { url: root, close } = await serveDir(dir, "few.html");
      try {
        const browser = await getBrowser();
        const recalcs = async (file: string): Promise<number> => {
          const page = await browser.newPage();
          try {
            await page.metrics();
            await page.goto(`${root}${file}`);
            await page.waitForFunction("window.Gutterpress && window.Gutterpress.totalPages > 0");
            return (await page.metrics()).RecalcStyleCount!;
          } finally {
            await page.close();
          }
        };
        const few = await recalcs("few.html");
        const many = await recalcs("many.html");
        expect((many - few) / 30).toBeLessThan(2.5);
      } finally {
        await close();
      }
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  },
  RENDER_TEST_TIMEOUT_MS,
);
