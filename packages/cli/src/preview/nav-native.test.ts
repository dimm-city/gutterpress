/**
 * Regression test for the native-engine preview navigation saturation bug
 * (WORK PACKAGE B item 1, docs/native-engine-acceptance-gate.md C.15).
 *
 * The native viewer lays sheets out one CHAPTER per row (`.folio-run`), each
 * row scrolling HORIZONTALLY when its chapter is wider than the viewport —
 * unlike Paged.js's single vertical page stack. `detectVisiblePage()` used to
 * scan by `top` only, which can't distinguish two sheets in the same row (they
 * share the same `top`), so it always resolved to the LAST sheet of whichever
 * row was vertically visible — the toolbar's `goToPage(N)` for any N deep in a
 * later row would settle back on an earlier page once the scroll-end handler
 * ran. Measured on a 34-page book: goToPage(18/30/34) all landed on 14.
 *
 * This drives the REAL preview server (native engine) with Puppeteer at a wide
 * viewport and asserts previewAPI.goToPage(N)'s reported currentPage() is N,
 * for N spread across the end of the book, after letting the debounced
 * scroll-detection settle (the exact window the bug lived in).
 */
import { test, expect, afterAll } from "bun:test";

import { resolveChromiumExecutable } from "../lib/chromium.ts";
import { closeBrowser, getBrowser } from "../lib/browser-pool.ts";
import { startPreviewServer, type PreviewServerHandle } from "../server.ts";

const FIXTURE = "/tmp/fg-proof-parent/field-guide";
const RENDER_TEST_TIMEOUT_MS = 60_000;

const chromium = await resolveChromiumExecutable();
const fixtureAvailable = await Bun.file(`${FIXTURE}/chapter-00.md`).exists();
// The `page.evaluate` callbacks below are serialized and run in the BROWSER,
// where `window.previewAPI` (preview-interface.js) exists — but this package's
// tsconfig is deliberately Node-targeted with no DOM lib (see its comment: a
// package-wide `lib: ["DOM"]` leaks DOM overloads into every Node file). Declare
// just the one browser global these callbacks touch, file-locally.
declare const window: {
  previewAPI?: {
    getTotalPages(): number;
    getCurrentPage(): number;
    goToPage(n: number): { currentPage: number };
  };
};

const testIf = chromium && fixtureAvailable ? test : test.skip;
if (!chromium) {
  // eslint-disable-next-line no-console
  console.warn("[nav-native.test] No Chromium resolved — skipping.");
}
if (!fixtureAvailable) {
  // eslint-disable-next-line no-console
  console.warn(`[nav-native.test] Fixture book not found at ${FIXTURE} — skipping.`);
}

afterAll(async () => {
  await closeBrowser();
});

testIf(
  "native preview: goToPage(N) near the end of a 34pp book settles on N at a wide viewport",
  async () => {
    let handle: PreviewServerHandle | undefined;
    try {
      handle = await startPreviewServer({
        input: FIXTURE,
        engine: "native",
        port: 0,
        host: "127.0.0.1",
        installSignalHandlers: false,
        noWatch: true,
      } as Parameters<typeof startPreviewServer>[0]);

      const browser = await getBrowser(RENDER_TEST_TIMEOUT_MS);
      const page = await browser.newPage();
      try {
        // Wide enough to reproduce the saturation (measured at 1400px in the
        // bug report) while still leaving most rows needing horizontal scroll.
        await page.setViewport({ width: 1400, height: 900 });
        await page.goto(`${handle.url}/book.html`, { waitUntil: "networkidle0" });
        await page.waitForFunction(
          "window.previewAPI && window.previewAPI.getTotalPages() > 0"
        );

        const totalPages = await page.evaluate(() => window.previewAPI!.getTotalPages());
        expect(totalPages).toBeGreaterThan(20);

        for (const n of [18, 30, totalPages]) {
          const result = await page.evaluate((target) => {
            return window.previewAPI!.goToPage(target);
          }, n);
          expect(result.currentPage).toBe(n);

          // The saturation bug only manifested once the debounced
          // scroll-detection listener ran (150ms debounce + 300ms
          // ignoreScrollUntil guard) and overwrote currentPage — wait past
          // that window before re-checking.
          await new Promise((r) => setTimeout(r, 500));
          const settled = await page.evaluate(() => window.previewAPI!.getCurrentPage());
          expect(settled).toBe(n);
        }
      } finally {
        await page.close();
      }
    } finally {
      await handle?.stop();
    }
  },
  RENDER_TEST_TIMEOUT_MS
);
