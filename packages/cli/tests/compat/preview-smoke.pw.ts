/**
 * Preview smoke test (issue #46).
 *
 * For each target project (served by the webServer entries in
 * playwright.config.ts), renders the preview in Chromium and asserts:
 *
 *   - the native engine's viewer bundle dispatches `gp:layout` within a
 *     generous timeout
 *   - page count > 0 and matches the event's `pages` count
 *   - no layout collapse (sheets have non-zero size; no uncaught page errors)
 *
 * CHROMIUM ONLY. Gutterpress supports Chrome and other Chromium-based
 * browsers, and nothing else (CLAUDE.md, ratified 2026-08-23) — the print
 * path IS Chromium and the viewer's whole job is to agree with what Chromium
 * prints. The firefox/webkit legs, and the cross-engine page-count tolerance
 * that only existed to compare them against a chromium baseline, were removed
 * with that ruling.
 */
import { test, expect } from "playwright/test";
import { chromium, type Frame } from "playwright";

const RENDER_TIMEOUT_MS = 180_000;

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

async function renderPreview(url: string): Promise<RenderResult> {
  const browser = await chromium.launch({ headless: true });
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
  test(`${target.name}: preview renders in chromium`, async () => {
    test.setTimeout(RENDER_TIMEOUT_MS + 120_000);

    const r = await renderPreview(target.url);
    const label = `[${target.name}]`;

    expect(r.pageCount, `${label} page count`).toBeGreaterThan(0);
    expect(r.eventTotalPages, `${label} renderingComplete totalPages`).toBe(r.pageCount);
    expect(r.zeroSizedContentPages, `${label} zero-sized content pages (layout collapse)`).toBe(0);
    expect(r.pageErrors, `${label} uncaught page errors`).toEqual([]);
  });
}
