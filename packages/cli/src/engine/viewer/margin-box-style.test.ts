import { serveDir } from "./test-support/serve-dir.ts";
import { test, expect, afterAll } from "bun:test";
import fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveChromiumExecutable } from "../../lib/chromium.ts";
import { getAssetPath } from "../../lib/embedded-assets.ts";
import { closeBrowser, getBrowser } from "../../lib/browser-pool.ts";

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const RENDER_TEST_TIMEOUT_MS = 60_000;

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;
if (!chromium) {
  // eslint-disable-next-line no-console
  console.warn("[margin-box-style.test] No Chromium resolved -- skipping.");
}

afterAll(async () => {
  await closeBrowser();
});

testIf(
  "viewer replays styled margin-box furniture without losing edge alignment",
  async () => {
    const dir = await fsp.mkdtemp(path.join(tmpdir(), "gutterpress-marginbox-test-"));
    try {
      await fsp.copyFile(
        path.join(FIXTURES_DIR, "margin-box-style.html"),
        path.join(dir, "margin-box-style.html"),
      );
      await fsp.copyFile(
        await getAssetPath("engine/gutterpress-viewer.js"),
        path.join(dir, "gutterpress-viewer.js"),
      );
      const { url: root, close } = await serveDir(dir, "margin-box-style.html");
      try {
        const browser = await getBrowser(RENDER_TEST_TIMEOUT_MS);
        const page = await browser.newPage();
        let boxes: Array<{
          page: string;
          name: string;
          text: string;
          slotLeft: number;
          slotRight: number;
          contentLeft: number;
          contentRight: number;
          background: string;
          borderStyle: string;
          paddingLeft: string;
          fontWeight: string;
          letterSpacing: string;
          transform: string;
          boxShadow: string;
          inlineTransform: string;
          inlineBoxShadow: string;
        }>;
        try {
          await page.goto(`${root}margin-box-style.html`, { waitUntil: "networkidle0" });
          await page.waitForFunction("window.Gutterpress && window.Gutterpress.totalPages > 0");
          boxes = await page.evaluate(() =>
            Array.from(document.querySelectorAll<HTMLElement>(".gp-marginbox")).map((slot) => {
              const content = slot.querySelector<HTMLElement>(".gp-marginbox-content")!;
              const sr = slot.getBoundingClientRect();
              const cr = content.getBoundingClientRect();
              const cs = getComputedStyle(content);
              return {
                page: slot.closest<HTMLElement>(".gp-sheet")?.dataset.page ?? "",
                name: slot.dataset.box ?? "",
                text: content.textContent ?? "",
                slotLeft: sr.left,
                slotRight: sr.right,
                contentLeft: cr.left,
                contentRight: cr.right,
                background: cs.backgroundColor,
                borderStyle: cs.borderStyle,
                paddingLeft: cs.paddingLeft,
                fontWeight: cs.fontWeight,
                letterSpacing: cs.letterSpacing,
                transform: cs.transform,
                boxShadow: cs.boxShadow,
                inlineTransform: content.style.transform,
                inlineBoxShadow: content.style.boxShadow,
              };
            }),
          );
        } finally {
          await page.close();
        }

        const chapter = boxes.find((b) => b.page === "1" && b.name === "bottom-left")!;
        const folio = boxes.find((b) => b.page === "1" && b.name === "bottom-right")!;
        const versoFolio = boxes.find((b) => b.page === "2" && b.name === "bottom-left")!;
        const versoChapter = boxes.find((b) => b.page === "2" && b.name === "bottom-right")!;
        expect(chapter.text).toBe("C.1");
        expect(folio.text).toBe("P.1");
        expect(versoFolio.text).toBe("P.2");
        expect(versoChapter.text).toBe("C.2");
        expect(chapter.background).toBe("rgb(222, 208, 184)");
        expect(chapter.borderStyle).toBe("dashed");
        expect(chapter.paddingLeft).toBe("7px");
        expect(chapter.fontWeight).toBe("700");
        expect(chapter.letterSpacing).not.toBe("normal");
        // Native Chromium silently drops both effects in @page margin boxes;
        // preview must stay square and unshadowed too.
        expect(chapter.transform).toBe("none");
        expect(chapter.boxShadow).toBe("none");
        expect(chapter.inlineTransform).toBe("");
        expect(chapter.inlineBoxShadow).toBe("");
        expect(folio.background).toBe("rgb(244, 239, 228)");
        expect(folio.borderStyle).toBe("solid");
        expect(folio.paddingLeft).toBe("8px");
        expect(folio.fontWeight).toBe("700");
        expect(folio.transform).toBe("none");
        expect(folio.boxShadow).toBe("none");
        expect(versoFolio.background).toBe("rgb(244, 239, 228)");
        expect(versoChapter.background).toBe("rgb(222, 208, 184)");
        // fit-content must shrink the painted face, while the slot keeps it
        // anchored to the appropriate outer edge.
        expect(chapter.contentLeft).toBeCloseTo(chapter.slotLeft, 0);
        expect(folio.contentRight).toBeCloseTo(folio.slotRight, 0);
        expect(versoFolio.contentLeft).toBeCloseTo(versoFolio.slotLeft, 0);
        expect(versoChapter.contentRight).toBeCloseTo(versoChapter.slotRight, 0);
        expect(chapter.contentRight - chapter.contentLeft).toBeLessThan(
          chapter.slotRight - chapter.slotLeft,
        );
        expect(folio.contentRight - folio.contentLeft).toBeLessThan(
          folio.slotRight - folio.slotLeft,
        );
      } finally {
        await close();
      }
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  },
  RENDER_TEST_TIMEOUT_MS,
);
