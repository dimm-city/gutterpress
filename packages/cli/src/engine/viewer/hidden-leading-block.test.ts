/**
 * A box-free element must not open a page run.
 *
 * `explodeChildren` partitions a container's children into runs of one page
 * context each, and every run becomes a strip — a page. An element with
 * `display: none` generates no boxes at all, so print cannot start a page at
 * it; opening a run for one manufactures a page the PDF does not have.
 *
 * FOUND HERE: the desktop editor's locked view hides its Gutterpress marker
 * chips with `display: none`, so the `@page` chip sat ahead of the chapter's
 * own `h1 { page: chapter }` opener and the editor drew a blank first page for
 * every chapter that starts with a marker. The book, whose HTML has no chip,
 * drew none — a one-page divergence the editor↔preview parity gate reported
 * on 4 of 10 chapters of the user guide.
 *
 * Nothing about the rule is editor-specific: any book whose CSS hides an
 * element ahead of a page-context change hits the same thing.
 */
import { serveDir } from "./test-support/serve-dir.ts";
import { test, expect, afterAll } from "bun:test";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveChromiumExecutable } from "../../lib/chromium.ts";
import { getAssetPath } from "../../lib/embedded-assets.ts";
import { closeBrowser, getBrowser } from "../../lib/browser-pool.ts";

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const RENDER_TEST_TIMEOUT_MS = 60_000;
const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;

afterAll(async () => {
  await closeBrowser();
});

testIf(
  "a display:none element ahead of a chapter opener adds no page, and adds one once it is shown",
  async () => {
    const dir = await fsp.mkdtemp(path.join(path.dirname(FIXTURES_DIR), ".hidden-leading-"));
    try {
      await fsp.copyFile(
        path.join(FIXTURES_DIR, "hidden-leading-block.html"),
        path.join(dir, "hidden-leading-block.html"),
      );
      await fsp.copyFile(
        await getAssetPath("engine/gutterpress-viewer.js"),
        path.join(dir, "gutterpress-viewer.js"),
      );
      const { url, close } = await serveDir(dir, "hidden-leading-block.html");
      try {
        const browser = await getBrowser(RENDER_TEST_TIMEOUT_MS);
        const page = await browser.newPage();
        try {
          await page.goto(url, { waitUntil: "networkidle0" });
          await page.waitForFunction("window.Gutterpress?.totalPages > 0");

          const hidden = await page.evaluate(() => {
            const api = (
              window as unknown as {
                Gutterpress: { totalPages: number; strips: { el: HTMLElement }[] };
              }
            ).Gutterpress;
            return {
              totalPages: api.totalPages,
              strips: api.strips.map((s) => s.el.dataset["page"] ?? ""),
              // Liveness: the hidden element is really still in the document
              // (this is a run-partition assertion, not a "did it get
              // deleted" one), and really generates no boxes.
              present: !!document.getElementById("toggle"),
              rects: document.getElementById("toggle")!.getClientRects().length,
              openerPage: getComputedStyle(document.getElementById("opener")!).page,
            };
          });
          expect(hidden.present).toBe(true);
          expect(hidden.rects).toBe(0);
          expect(hidden.openerPage).toBe("chapter");
          // The chapter opener's own run comes FIRST: the hidden element
          // opened no default-page run ahead of it. Two runs, so two pages —
          // the opener's, then the body's, exactly as print fragments it.
          expect(hidden.strips).toEqual(["chapter", ""]);
          expect(hidden.totalPages).toBe(2);

          // Control: shown, it is ordinary content, so it legitimately DOES
          // open a leading default-page run and the book grows a page.
          const shown = await page.evaluate(() => {
            document.getElementById("toggle")!.style.display = "block";
            const api = (
              window as unknown as {
                Gutterpress: {
                  refresh: () => void;
                  totalPages: number;
                  strips: { el: HTMLElement }[];
                };
              }
            ).Gutterpress;
            api.refresh();
            return {
              totalPages: api.totalPages,
              strips: api.strips.map((s) => s.el.dataset["page"] ?? ""),
              leadingStripHasToggle: !!api.strips[0]!.el.querySelector("#toggle"),
            };
          });
          expect(shown.strips).toEqual(["", "chapter", ""]);
          expect(shown.leadingStripHasToggle).toBe(true);
          expect(shown.totalPages).toBe(3);
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
