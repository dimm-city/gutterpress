/**
 * Regression test for the native-engine preview navigation saturation bug.
 *
 * The native viewer lays sheets out one CHAPTER per row (`.gp-run`), each
 * row scrolling HORIZONTALLY when its chapter is wider than the viewport, so
 * a page is NOT identified by its vertical position alone. `detectVisiblePage()`
 * used to scan by `top` only, which can't distinguish two sheets in a row (they
 * share the same `top`), so it always resolved to the LAST sheet of whichever
 * row was vertically visible — the toolbar's `goToPage(N)` for any N deep in a
 * later row would settle back on an earlier page once the scroll-end handler
 * ran. Measured on a 34-page book: goToPage(18/30/34) all landed on 14.
 *
 * This drives the REAL preview server (native engine) in a Chromium launched
 * through the engine's own launcher (`engine/shared/cdp.ts`) at a wide
 * viewport and asserts previewAPI.goToPage(N)'s reported currentPage() is N,
 * for N spread across the end of the book, after letting the debounced
 * scroll-detection settle (the exact window the bug lived in).
 */
import { test, expect, afterAll } from "bun:test";

import { resolveChromiumExecutable } from "../lib/chromium.ts";
import { launchChromium, type Browser } from "../engine/shared/cdp.ts";
import { startPreviewServer, type PreviewServerHandle } from "../server.ts";

const FIXTURE = "/tmp/fg-proof-parent/field-guide";
const RENDER_TEST_TIMEOUT_MS = 60_000;

const chromium = await resolveChromiumExecutable();
const fixtureAvailable = await Bun.file(`${FIXTURE}/chapter-00.md`).exists();

const testIf = chromium && fixtureAvailable ? test : test.skip;
if (!chromium) {
  // eslint-disable-next-line no-console
  console.warn("[nav-native.test] No Chromium resolved — skipping.");
}
if (!fixtureAvailable) {
  // eslint-disable-next-line no-console
  console.warn(`[nav-native.test] Fixture book not found at ${FIXTURE} — skipping.`);
}

let browser: Browser | undefined;
afterAll(async () => {
  await browser?.close();
});

/** Poll a browser-side predicate (the raw CDP session has no waitForFunction). */
async function waitFor(page: Awaited<ReturnType<Browser["newPage"]>>, expr: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (!(await page.evaluate<boolean>(`!!(${expr})`))) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${expr}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

testIf(
  "native preview: goToPage(N) near the end of a 34pp book settles on N at a wide viewport",
  async () => {
    let handle: PreviewServerHandle | undefined;
    try {
      handle = await startPreviewServer({
        input: FIXTURE,
        port: 0,
        host: "127.0.0.1",
        installSignalHandlers: false,
        noWatch: true,
      } as Parameters<typeof startPreviewServer>[0]);

      browser ??= await launchChromium();
      const page = await browser.newPage();
      try {
        // Wide enough to reproduce the saturation (measured at 1400px in the
        // bug report) while still leaving most rows needing horizontal scroll.
        await page.send("Emulation.setDeviceMetricsOverride", {
          width: 1400,
          height: 900,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await page.navigate(`${handle.url}/book.html`);
        await waitFor(
          page,
          "window.previewAPI && window.previewAPI.getTotalPages() > 0",
          RENDER_TEST_TIMEOUT_MS / 2
        );

        const totalPages = await page.evaluate<number>("window.previewAPI.getTotalPages()");
        expect(totalPages).toBeGreaterThan(20);

        for (const n of [18, 30, totalPages]) {
          const result = await page.evaluate<{ currentPage: number }>(
            `window.previewAPI.goToPage(${n})`
          );
          expect(result.currentPage).toBe(n);

          // The saturation bug only manifested once the debounced
          // scroll-detection listener ran (150ms debounce + 300ms
          // ignoreScrollUntil guard) and overwrote currentPage — wait past
          // that window before re-checking.
          await new Promise((r) => setTimeout(r, 500));
          const settled = await page.evaluate<number>("window.previewAPI.getCurrentPage()");
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
