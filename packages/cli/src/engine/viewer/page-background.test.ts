import { serveDir } from "./test-support/serve-dir.ts";
import { test, expect, afterAll } from "bun:test";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveChromiumExecutable } from "../../lib/chromium.ts";
import { getAssetPath } from "../../lib/embedded-assets.ts";
import { closeBrowser, getBrowser } from "../../lib/browser-pool.ts";

/**
 * `@page { background }` paints the whole SHEET — margins included — in
 * Chromium's print path (measured, Chromium 148/151). The viewer must paint
 * the same thing, or a book that styles its paper this way prints correctly
 * and previews as blank white.
 *
 * THE BUG THIS EXISTS FOR: `resolvePage()` has always returned the page
 * box's own declarations, but `PageCtx` in decorate.ts kept only
 * `geometry` + `marginBoxes` and dropped the rest, so nothing ever read
 * `background`. Verified against the pre-fix bundle: every sheet reported
 * `rgb(255, 255, 255)` while the PDF for the same source painted
 * #2d6cdf / #d94f2b.
 *
 * The parity gate cannot catch this class of defect at all — it asserts
 * page counts, page-of-element maps and resolved target-counter values,
 * and makes no paint assertions whatsoever. So it needs its own test.
 */

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const RENDER_TEST_TIMEOUT_MS = 60_000;

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;
if (!chromium) {
  // eslint-disable-next-line no-console
  console.warn(
    "[page-background.test] No Chromium resolved via resolveChromiumExecutable() — skipping.",
  );
}

afterAll(async () => {
  await closeBrowser();
});

testIf(
  "@page background paints each sheet, honoring :left and named-page overrides",
  async () => {
    const dir = await fsp.mkdtemp(path.join(path.dirname(FIXTURES_DIR), ".pagebg-test-"));
    try {
      await fsp.copyFile(
        path.join(FIXTURES_DIR, "page-background.html"),
        path.join(dir, "page-background.html"),
      );
      await fsp.copyFile(
        await getAssetPath("engine/gutterpress-viewer.js"),
        path.join(dir, "gutterpress-viewer.js"),
      );
      const { url: root, close } = await serveDir(dir, "page-background.html");
      try {
        const browser = await getBrowser(RENDER_TEST_TIMEOUT_MS);
        const page = await browser.newPage();
        let sheets: Array<{ page: string; side: string; bg: string }>;
        try {
          await page.goto(`${root}page-background.html`, { waitUntil: "networkidle0" });
          await page.waitForFunction(
            "window.Gutterpress && window.Gutterpress.totalPages > 0",
          );
          sheets = await page.evaluate(() =>
            Array.from(document.querySelectorAll<HTMLElement>(".gp-sheet")).map((s) => ({
              page: s.dataset.page ?? "",
              side: s.dataset.side ?? "",
              bg: getComputedStyle(s).backgroundColor,
            })),
          );
        } finally {
          await page.close();
        }

        expect(sheets.length).toBeGreaterThanOrEqual(3);
        // Page 1 — a recto — takes the base @page background.
        expect(sheets[0]).toMatchObject({ page: "1", side: "recto", bg: "rgb(45, 108, 223)" });
        // Page 2 — a verso — takes the `:left` override, proving the pseudo
        // cascade is resolved and not just the unqualified rule.
        expect(sheets[1]).toMatchObject({ page: "2", side: "verso", bg: "rgb(217, 79, 43)" });
        // Page 3 — the named page `tinted`.
        expect(sheets[2]).toMatchObject({ page: "3", bg: "rgb(30, 138, 76)" });
        // No sheet may be left at the viewer's default white: that is exactly
        // the pre-fix symptom.
        expect(sheets.map((s) => s.bg)).not.toContain("rgb(255, 255, 255)");
      } finally {
        await close();
      }
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  },
  RENDER_TEST_TIMEOUT_MS,
);
