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
 * Phase 4b regression: a hand-authored HTML file with bare body children (no
 * wrapper divs — the shape `assemble.ts` never produces) plus one
 * `<script src>` of the viewer bundle must render EVERY page's content, not
 * just the first. `.folio-strip` used to be `overflow: hidden` at a
 * fixed one-column width: pageOf()/scrollWidth still measured columns 2+
 * correctly, but they never painted. See `fixtures/standalone-hand.html`.
 */

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const RENDER_TEST_TIMEOUT_MS = 60_000;

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;
if (!chromium) {
  // eslint-disable-next-line no-console
  console.warn(
    "[standalone.test] No Chromium resolved via resolveChromiumExecutable() — skipping. Install Chrome/Chromium or set CHROMIUM_PATH to run it."
  );
}

afterAll(async () => {
  await closeBrowser();
});

/** Serve `dir` over a local HTTP server; returns the base URL and a close fn. */
function serveDir(dir: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent((req.url ?? "/").split("?")[0]!).replace(/^\/+/, "");
    const filePath = path.join(dir, rel || "standalone-hand.html");
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
        url: `http://127.0.0.1:${port}/standalone-hand.html`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

testIf(
  "hand-authored standalone HTML paints content on every page of a run",
  async () => {
    // Stage the fixture beside a fresh copy of the viewer bundle — the
    // supported drop-in usage is exactly this: one HTML file, one script tag,
    // no build step.
    const dir = await fsp.mkdtemp(path.join(path.dirname(FIXTURES_DIR), ".standalone-test-"));
    try {
      await fsp.copyFile(
        path.join(FIXTURES_DIR, "standalone-hand.html"),
        path.join(dir, "standalone-hand.html")
      );
      await fsp.copyFile(
        await getAssetPath("engine/gutterpress-viewer.js"),
        path.join(dir, "gutterpress-viewer.js")
      );
      const { url, close } = await serveDir(dir);
      try {
        const browser = await getBrowser(RENDER_TEST_TIMEOUT_MS);
        const page = await browser.newPage();
        try {
          // Wide enough that every column of the fixture's one run sits
          // inside the viewport simultaneously — the check below must not
          // depend on scrolling to reach a later page.
          await page.setViewport({ width: 3000, height: 1200 });
          await page.goto(url, { waitUntil: "networkidle0" });
          await page.waitForFunction(
            "window.Gutterpress && window.Gutterpress.totalPages > 0"
          );
          const result = await page.evaluate(() => {
            const strip = document.querySelector<HTMLElement>(".folio-strip")!;
            const paras = Array.from(strip.querySelectorAll<HTMLElement>("p"));
            // "Paragraph 20" sits on page 3 of the run (a column past the
            // first) — the exact site the regression clipped from painting.
            const last = paras.find((p) => p.textContent?.includes("Paragraph 20"))!;
            const rect = last.getBoundingClientRect();

            // `elementFromPoint` is unreliable for this check — measured
            // (Chromium): it can still resolve to a clipped-away element.
            // Instead intersect the element's own rect against every
            // ancestor's clip: for each ancestor whose computed overflow is
            // not `visible`, its own border box bounds what's actually
            // paintable through it (the exact mechanism the regression hit —
            // `.folio-strip`'s `overflow: hidden` at a fixed one-column
            // width clipped every later column even though layout still
            // positioned their content correctly). A non-empty resulting
            // rect is proof the element is genuinely visible, not merely
            // positioned.
            let visible = { ...rect.toJSON() } as { top: number; left: number; right: number; bottom: number };
            // The root scrolling element (here `.folio-stage`'s `<body>`) gets
            // its `overflow` promoted to the visual viewport by the browser —
            // it is not a nested clipping box, so its own getBoundingClientRect()
            // is not a valid clip bound. Stop the walk there and clip against
            // the (wide) viewport instead.
            for (
              let el = last.parentElement;
              el && el.tagName !== "BODY" && el.tagName !== "HTML";
              el = el.parentElement
            ) {
              const cs = getComputedStyle(el);
              if (cs.overflow === "visible" && cs.overflowX === "visible" && cs.overflowY === "visible") continue;
              const r = el.getBoundingClientRect();
              visible = {
                top: Math.max(visible.top, r.top),
                left: Math.max(visible.left, r.left),
                right: Math.min(visible.right, r.right),
                bottom: Math.min(visible.bottom, r.bottom),
              };
            }
            visible = {
              top: Math.max(visible.top, 0),
              left: Math.max(visible.left, 0),
              right: Math.min(visible.right, window.innerWidth),
              bottom: Math.min(visible.bottom, window.innerHeight),
            };
            const visibleWidth = visible.right - visible.left;
            const visibleHeight = visible.bottom - visible.top;

            return {
              totalPages: (window as any).Gutterpress.totalPages,
              paraCount: paras.length,
              lastParaText: last.textContent ?? "",
              rectIsEmpty: rect.width === 0 || rect.height === 0,
              visibleWidth,
              visibleHeight,
            };
          });
          expect(result.totalPages).toBeGreaterThanOrEqual(4);
          expect(result.paraCount).toBeGreaterThan(0);
          expect(result.lastParaText).toContain("Paragraph 20");
          expect(result.rectIsEmpty).toBe(false);
          // Proof it is actually painted (not clipped away by an ancestor's
          // overflow box), not merely positioned.
          expect(result.visibleWidth).toBeGreaterThan(0);
          expect(result.visibleHeight).toBeGreaterThan(0);
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
  RENDER_TEST_TIMEOUT_MS
);
