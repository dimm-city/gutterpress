/**
 * Cross-browser preview smoke test (issue #46).
 *
 * For each target project (served by the webServer entries in
 * playwright.config.ts), renders the preview in chromium, firefox, and
 * webkit and asserts:
 *
 *   - the native engine's viewer bundle dispatches `gp:layout` within a
 *     generous timeout
 *   - page count > 0 and matches the event's `pages` count
 *   - no layout collapse (sheets have non-zero size; no uncaught page errors)
 *   - page count is within tolerance of the chromium baseline (engines
 *     legitimately reflow slightly differently because of font-fallback
 *     metrics — the 2026-06 audit measured webkit at -10% on the user guide)
 *
 * The PREVIEW is the only cross-browser surface; PDF export always renders
 * in Chromium and is not covered here.
 */
import { test, expect } from "playwright/test";
import { chromium, firefox, webkit, type BrowserType, type Frame } from "playwright";

const RENDER_TIMEOUT_MS = 180_000;
/** Allowed relative page-count deviation from the chromium baseline. */
const PAGE_COUNT_TOLERANCE = 0.2;

const ENGINES: Record<string, BrowserType> = { chromium, firefox, webkit };

const TARGETS = [
  { name: "gutterpress-user-guide", url: "http://127.0.0.1:4111/" },
  { name: "with-design-guide", url: "http://127.0.0.1:4112/" },
  { name: "feature-probe", url: "http://127.0.0.1:4113/" },
];

interface RenderResult {
  pageCount: number;
  eventTotalPages: number | null;
  zeroSizedContentPages: number;
  consoleErrors: string[];
  pageErrors: string[];
}

async function renderPreview(engine: BrowserType, url: string): Promise<RenderResult> {
  const browser = await engine.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => pageErrors.push(String(err)));

    // The native engine's viewer bundle (engine/viewer/index.ts) dispatches
    // `gp:layout` on the window once pagination finishes. Init scripts run
    // in every frame, so this works for both the shell at "/" (book.html in
    // an iframe) and a direct /book.html load.
    await page.addInitScript(() => {
      (window as any).__gutterpressRender = { done: false };
      window.addEventListener("gp:layout", (e: any) => {
        (window as any).__gutterpressRender = { done: true, totalPages: e?.detail?.pages ?? null };
      });
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });

    // Locate the frame holding the paginated document.
    let frame: Frame | null = null;
    const deadline = Date.now() + 30_000;
    while (!frame && Date.now() < deadline) {
      frame = page.frames().find((f) => f.url().includes("book.html")) ?? null;
      if (!frame && page.frames().length === 1) frame = page.mainFrame();
      if (!frame) await page.waitForTimeout(250);
    }
    if (!frame) throw new Error("preview frame (book.html) never appeared");

    await frame.waitForFunction(() => (window as any).__gutterpressRender?.done, null, {
      timeout: RENDER_TIMEOUT_MS,
      polling: 250,
    });

    const measured = await frame.evaluate(() => {
      const pages = Array.from(document.querySelectorAll(".gp-sheet"));
      // A trailing structural 0×0 sheet can legitimately exist; what signals
      // collapse is content sheets without geometry.
      const zeroSizedContentPages = pages.filter((p) => {
        const b = p.getBoundingClientRect();
        const hasText = (p.textContent || "").trim().length > 0;
        return hasText && (b.width < 10 || b.height < 10);
      }).length;
      return {
        pageCount: pages.length,
        eventTotalPages: (window as any).__gutterpressRender?.totalPages ?? null,
        zeroSizedContentPages,
      };
    });

    return { ...measured, consoleErrors, pageErrors };
  } finally {
    await browser.close();
  }
}

for (const target of TARGETS) {
  test(`${target.name}: preview renders in chromium, firefox, and webkit`, async () => {
    test.setTimeout(RENDER_TIMEOUT_MS * 3 + 120_000);

    const results: Record<string, RenderResult> = {};
    for (const [name, engine] of Object.entries(ENGINES)) {
      results[name] = await renderPreview(engine, target.url);
    }

    const baseline = results.chromium!.pageCount;
    expect(baseline, "chromium baseline must render at least one page").toBeGreaterThan(0);

    for (const [name, r] of Object.entries(results)) {
      const label = `[${target.name} / ${name}]`;
      expect(r.pageCount, `${label} page count`).toBeGreaterThan(0);
      expect(r.eventTotalPages, `${label} renderingComplete totalPages`).toBe(r.pageCount);
      expect(r.zeroSizedContentPages, `${label} zero-sized content pages (layout collapse)`).toBe(0);
      expect(r.pageErrors, `${label} uncaught page errors`).toEqual([]);

      const deviation = Math.abs(r.pageCount - baseline) / baseline;
      expect(
        deviation,
        `${label} page count ${r.pageCount} deviates ${(deviation * 100).toFixed(1)}% from chromium baseline ${baseline}`
      ).toBeLessThanOrEqual(PAGE_COUNT_TOLERANCE);
    }
  });
}
