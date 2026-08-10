import { serveDir } from "./test-support/serve-dir.ts";
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
 * WP-B item 5: a live-preview `target-counter()` reference to a nonexistent
 * id used to render a bare "p.?" with no explanation. `fixtures/broken-xref.html`
 * has one broken reference ("#nope") and one valid one ("#real") — the
 * broken one must surface the same actionable warning the compiler's PDF
 * build diagnoses (`engine.xref.broken` in `compiler/build.ts`), and the
 * valid one must still resolve to a real page number, proving the viewer's
 * target-counter machinery works and the "?" case really is a content bug
 * (a dead link), not a resolution gap.
 */

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const RENDER_TEST_TIMEOUT_MS = 60_000;

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;
if (!chromium) {
  // eslint-disable-next-line no-console
  console.warn(
    "[xref-warning.test] No Chromium resolved via resolveChromiumExecutable() — skipping. Install Chrome/Chromium or set CHROMIUM_PATH to run it."
  );
}

afterAll(async () => {
  await closeBrowser();
});


testIf(
  "a broken target-counter() href warns instead of silently printing '?'; a valid one still resolves",
  async () => {
    const dir = await fsp.mkdtemp(path.join(path.dirname(FIXTURES_DIR), ".xref-warning-test-"));
    try {
      await fsp.copyFile(
        path.join(FIXTURES_DIR, "broken-xref.html"),
        path.join(dir, "broken-xref.html")
      );
      await fsp.copyFile(
        await getAssetPath("engine/gutterpress-viewer.js"),
        path.join(dir, "gutterpress-viewer.js")
      );
      const { url, close } = await serveDir(dir, "broken-xref.html");
      try {
        const browser = await getBrowser(RENDER_TEST_TIMEOUT_MS);
        const page = await browser.newPage();
        try {
          await page.goto(url, { waitUntil: "networkidle0" });
          await page.waitForFunction(
            "window.Gutterpress && window.Gutterpress.totalPages > 0"
          );
          const result = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll("a")).map((a) => ({
              href: a.getAttribute("href"),
              after: a.getAttribute("data-gp-after"),
            }));
            return {
              links,
              warnings: (window as any).Gutterpress.decoration.warnings as string[],
            };
          });

          const broken = result.links.find((l) => l.href === "#nope")!;
          const real = result.links.find((l) => l.href === "#real")!;
          expect(broken.after).toBe(" p.?");
          expect(real.after).toBe(" p.1");
          expect(
            result.warnings.some(
              (w) => w.includes('"#nope"') && w.includes("doesn't point at anything")
            )
          ).toBe(true);
          expect(result.warnings.some((w) => w.includes('"#real"'))).toBe(false);
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
