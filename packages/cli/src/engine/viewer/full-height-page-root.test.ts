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
  "a full-height named-page containing block keeps bottom art on its print page",
  async () => {
    const dir = await fsp.mkdtemp(path.join(path.dirname(FIXTURES_DIR), ".full-height-root-"));
    try {
      await fsp.copyFile(
        path.join(FIXTURES_DIR, "full-height-abspos.html"),
        path.join(dir, "full-height-abspos.html"),
      );
      await fsp.copyFile(
        await getAssetPath("engine/gutterpress-viewer.js"),
        path.join(dir, "gutterpress-viewer.js"),
      );
      const { url, close } = await serveDir(dir, "full-height-abspos.html");
      try {
        const browser = await getBrowser(RENDER_TEST_TIMEOUT_MS);
        const page = await browser.newPage();
        try {
          await page.goto(url, { waitUntil: "networkidle0" });
          await page.waitForFunction("window.Gutterpress?.totalPages > 0");
          const result = await page.evaluate(() => {
            const root = document.querySelector<HTMLElement>(".art-page")!;
            const prose = document.querySelector<HTMLElement>(".prose")!;
            const art = document.querySelector<HTMLElement>(".bottom-art")!;
            const strip = root.closest<HTMLElement>(".gp-strip")!;
            const rr = root.getBoundingClientRect();
            const pr = prose.getBoundingClientRect();
            const ar = art.getBoundingClientRect();
            const sr = strip.getBoundingClientRect();
            return {
              runPages: (window as any).Gutterpress.strips.find(
                (s: any) => s.el === strip,
              ).pages,
              rootFragments: root.getClientRects().length,
              rootTop: rr.top,
              stripTop: sr.top,
              proseInset: pr.top - rr.top,
              artBottom: ar.bottom,
              rootBottom: rr.bottom,
              stabilized: root.dataset.gpLeadingPageRoot,
              page: getComputedStyle(root).page,
              display: getComputedStyle(root).display,
              position: getComputedStyle(root).position,
              height: getComputedStyle(root).height,
              stripHeight: getComputedStyle(strip).getPropertyValue("--gp-content-h"),
            };
          });

          expect(result.runPages).toBe(1);
          expect(result.rootFragments).toBe(1);
          expect(result.rootTop).toBeCloseTo(result.stripTop, 1);
          expect(result.proseInset).toBeCloseTo(16, 1);
          expect(result.artBottom).toBeCloseTo(result.rootBottom, 1);
          expect(result.stabilized).toBe("stabilized");

          // A CSS/content refresh may make the root cease to qualify. The
          // viewer must restore the exact authored inline display instead of
          // leaking its flow-root correction into the rebuilt document.
          const refreshed = await page.evaluate(() => {
            const root = document.querySelector<HTMLElement>(".art-page")!;
            root.style.minHeight = "100px";
            (window as any).Gutterpress.refresh();
            return {
              marker: root.dataset.gpLeadingPageRoot,
              inlineDisplay: root.style.display,
              computedDisplay: getComputedStyle(root).display,
            };
          });
          expect(refreshed.marker).toBeUndefined();
          expect(refreshed.inlineDisplay).toBe("block");
          expect(refreshed.computedDisplay).toBe("block");
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

testIf(
  "break synthesis follows the winning cascade for before and after",
  async () => {
    const dir = await fsp.mkdtemp(path.join(path.dirname(FIXTURES_DIR), ".break-cascade-"));
    try {
      await fsp.copyFile(
        path.join(FIXTURES_DIR, "break-cascade.html"),
        path.join(dir, "break-cascade.html"),
      );
      await fsp.copyFile(
        await getAssetPath("engine/gutterpress-viewer.js"),
        path.join(dir, "gutterpress-viewer.js"),
      );
      const { url, close } = await serveDir(dir, "break-cascade.html");
      try {
        const browser = await getBrowser(RENDER_TEST_TIMEOUT_MS);
        const page = await browser.newPage();
        try {
          await page.goto(url, { waitUntil: "networkidle0" });
          await page.waitForFunction("window.Gutterpress?.totalPages > 0");
          const result = await page.evaluate(() => ({
            computed: {
              before: getComputedStyle(document.querySelector("#overridden-before")!).breakBefore,
              after: getComputedStyle(document.querySelector("#overridden-after")!).breakAfter,
              always: getComputedStyle(document.querySelector("#invalid-always")!).breakBefore,
            },
            spacers: Array.from(document.querySelectorAll(".gp-column-break-spacer")).map(
              (el) => ({
                previous: el.previousElementSibling?.id,
                next: el.nextElementSibling?.id,
              }),
            ),
          }));

          expect(result.computed).toEqual({ before: "auto", after: "auto", always: "auto" });
          expect(result.spacers).toEqual([
            { previous: "invalid-always", next: "valid-before" },
            { previous: "valid-after", next: "tail" },
          ]);
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

testIf(
  "an avoid block deferred only by a trailing margin matches print fragmentation",
  async () => {
    const dir = await fsp.mkdtemp(path.join(path.dirname(FIXTURES_DIR), ".avoid-margin-"));
    try {
      await fsp.copyFile(
        path.join(FIXTURES_DIR, "avoid-trailing-margin.html"),
        path.join(dir, "avoid-trailing-margin.html"),
      );
      await fsp.copyFile(
        await getAssetPath("engine/gutterpress-viewer.js"),
        path.join(dir, "gutterpress-viewer.js"),
      );
      const { url, close } = await serveDir(dir, "avoid-trailing-margin.html");
      try {
        const browser = await getBrowser(RENDER_TEST_TIMEOUT_MS);
        const page = await browser.newPage();
        try {
          await page.goto(url, { waitUntil: "networkidle0" });
          await page.waitForFunction("window.Gutterpress?.totalPages > 0");
          const result = await page.evaluate(() => {
            const api = (window as any).Gutterpress;
            const byId = (id: string) => document.querySelector<HTMLElement>(`#${id}`)!;
            return {
              fit: [api.pageOf(byId("fit-prev")), api.pageOf(byId("fit-block"))],
              second: [api.pageOf(byId("second-prev")), api.pageOf(byId("second-block"))],
              tall: [api.pageOf(byId("tall-prev")), api.pageOf(byId("tall-block"))],
              fitMarker: byId("fit-prev").dataset.gpTrailingMargin,
              secondMarker: byId("second-prev").dataset.gpTrailingMargin,
              tallMarker: byId("tall-prev").dataset.gpTrailingMargin,
              ordinaryMarker: byId("ordinary-prev").dataset.gpTrailingMargin,
            };
          });
          expect(result.fit[1]).toBe(result.fit[0]);
          expect(result.second[1]).toBe(result.second[0]);
          expect(result.tall[1]).toBe(result.tall[0]! + 1);
          expect(result.fitMarker).toBe("compensated");
          expect(result.secondMarker).toBe("compensated");
          expect(result.tallMarker).toBeUndefined();
          expect(result.ordinaryMarker).toBeUndefined();

          const refreshed = await page.evaluate(() => {
            const prev = document.querySelector<HTMLElement>("#fit-prev")!;
            document.querySelector<HTMLElement>("#fit-block")!.style.height = "150px";
            (window as any).Gutterpress.refresh();
            return {
              marker: prev.dataset.gpTrailingMargin,
              inlineMargin: prev.style.marginBlockEnd,
              computedMargin: getComputedStyle(prev).marginBlockEnd,
            };
          });
          expect(refreshed).toEqual({
            marker: undefined,
            inlineMargin: "",
            computedMargin: "40px",
          });
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
