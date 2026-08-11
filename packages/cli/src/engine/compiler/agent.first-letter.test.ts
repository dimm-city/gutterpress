import { test, expect } from "bun:test";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { resolveChromiumExecutable } from "../../lib/chromium.ts";
import { launchChromium } from "../shared/cdp.ts";
import { build } from "./build.ts";

/**
 * `ensureAnchor()`'s measurement anchor must stay invisible to
 * `::first-letter` — a drop cap is standard book typography, and the anchor is
 * injected as the heading's FIRST CHILD, exactly where `::first-letter` looks.
 *
 * This is not theoretical: an `inline-block` anchor SUPPRESSES the drop cap in
 * Chromium (measured — a non-inline child before the text disqualifies the
 * first letter), while an empty `display:inline` anchor does not. The test
 * discriminates via page count: the drop cap here is so large that the styled
 * heading cannot fit on one page, so a suppressed `::first-letter` collapses
 * the document back to a single page. Measured both ways — 2 pages with the
 * `display:inline` anchor, 1 page with an `inline-block` one.
 *
 * The `@top-center { content: string(doc-title) }` consumer is load-bearing:
 * without a `string()` reference the compiler never collects the `string-set`
 * source, so the h1 is never anchored and the test would pass vacuously.
 */

const HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: 300pt 300pt; margin: 10pt; @top-center { content: string(doc-title); } }
html, body { margin: 0; font: 12pt/1.2 serif; }
h1 { string-set: doc-title content(); font-weight: normal; }
h1::first-letter { font-size: 260pt; line-height: 1; float: left; }
</style></head><body>
<h1>Alpha</h1>
</body></html>`;

const RENDER_TEST_TIMEOUT_MS = 90_000;
const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;
if (!chromium) {
  // eslint-disable-next-line no-console
  console.warn(
    "[agent.first-letter.test] No Chromium resolved — skipping. Install Chrome/Chromium or set CHROMIUM_PATH to run it.",
  );
}

testIf(
  "the injected measurement anchor does not suppress ::first-letter on its host",
  async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "gutterpress-first-letter-test-"));
    const browser = await launchChromium();
    try {
      const htmlPath = path.join(dir, "doc.html");
      await fsp.writeFile(htmlPath, HTML, "utf8");
      const result = await build({ input: pathToFileURL(htmlPath).href, browser });
      // The h1 has no author id, so it IS anchored (that is the code path under
      // test). With the drop cap applied it overflows one 300pt page.
      expect(result.pageCount).toBeGreaterThan(1);
    } finally {
      await browser.close();
      await fsp.rm(dir, { recursive: true, force: true });
    }
  },
  RENDER_TEST_TIMEOUT_MS,
);
