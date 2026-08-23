/**
 * Regression guard: `pageOf()` must compare like with like at any zoom.
 *
 * `indexInStrip()` measures an element's client rect against the strides
 * `stripMetrics()` derives from `--gp-content-w`/`--gp-content-h`. The viewer
 * zooms its stage (`viewer.css`'s `.gp-stage`), and CSS `zoom` scales client
 * rects but NOT custom properties, `clientHeight` or `scrollWidth` — so before
 * `cssZoomOf()` the two sides of that comparison were in different coordinate
 * spaces and every answer was off by the zoom factor.
 *
 * Measured on the dc-op-manual field guide at its settled fit-width zoom
 * 0.7936: `--gp-content-h` 1032px + row-gap 72px gave a 1104px row stride
 * against a real rect-space sheet pitch of 876.1px, and 277 of 316 headings
 * resolved to a page other than the `.gp-sheet[data-page]` they visually sit
 * on. At zoom 1, 0 of 316. This fixture is the same failure in six pages
 * (measured 6 of 21 probes wrong at 0.7936, 0 at zoom 1).
 *
 * Which side of the zoom the measurement lands on is a race, so the bug is
 * intermittent by construction: the standalone fit-width default happens to
 * measure before zoom applies, but a numeric `preview.defaultZoom` — and
 * EVERY hot reload — measures under it.
 *
 * The check is "does `pageOf()` name the sheet this element is painted on",
 * not a comparison against hard-coded page numbers: both sides are read in
 * rect space, so it is itself zoom-independent and cannot be satisfied by
 * moving the bug.
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

/** The field guide's settled fit-width zoom — the number the bug was measured at. */
const FIT_ZOOM = "0.7936";

testIf(
  "pageOf() names the sheet an element is painted on at any zoom",
  async () => {
    const dir = await fsp.mkdtemp(path.join(path.dirname(FIXTURES_DIR), ".zoom-page-of-"));
    try {
      await fsp.copyFile(
        path.join(FIXTURES_DIR, "spread-rows.html"),
        path.join(dir, "spread-rows.html"),
      );
      await fsp.copyFile(
        await getAssetPath("engine/gutterpress-viewer.js"),
        path.join(dir, "gutterpress-viewer.js"),
      );
      const { url, close } = await serveDir(dir, "spread-rows.html");
      try {
        const browser = await getBrowser(RENDER_TEST_TIMEOUT_MS);
        const page = await browser.newPage();
        try {
          await page.setViewport({ width: 1280, height: 900 });
          await page.goto(url, { waitUntil: "networkidle0" });
          await page.waitForFunction("window.Gutterpress?.totalPages > 0");

          const probeAt = (zoom: string | null) =>
            page.evaluate((zoom) => {
              const root = document.documentElement;
              if (zoom === null) root.style.removeProperty("--gutterpress-zoom");
              else root.style.setProperty("--gutterpress-zoom", zoom);
              void document.body.offsetHeight; // settle layout before reading

              const gp = (window as unknown as { Gutterpress: { pageOf(el: Element): number } })
                .Gutterpress;
              const sheets = Array.from(document.querySelectorAll<HTMLElement>(".gp-sheet"));
              // Both sides read in rect space: which sheet is this element's
              // first fragment painted inside? 0-based, to match pageOf().
              const sheetOf = (el: Element): number => {
                const r = el.getClientRects()[0] ?? el.getBoundingClientRect();
                const x = r.left + Math.min(r.width, 4) / 2;
                const y = r.top + Math.min(r.height, 4) / 2;
                for (const sheet of sheets) {
                  const s = sheet.getBoundingClientRect();
                  if (x >= s.left && x <= s.right && y >= s.top && y <= s.bottom)
                    return Number(sheet.dataset.page) - 1;
                }
                return -1;
              };

              const probes = Array.from(document.querySelectorAll<HTMLElement>("#root > *"));
              const strip = document.querySelector<HTMLElement>(".gp-strip")!;
              const cs = getComputedStyle(strip);
              return {
                probes: probes.length,
                pageOf: probes.map((el) => gp.pageOf(el)),
                wrong: probes
                  .map((el) => ({ id: el.id, pageOf: gp.pageOf(el), painted: sheetOf(el) }))
                  .filter((p) => p.painted >= 0 && p.pageOf !== p.painted),
                // Proof the two coordinate spaces really are apart here — a
                // test that ran at an effective zoom of 1 would pass vacuously.
                rowStride:
                  parseFloat(cs.getPropertyValue("--gp-content-h")) +
                  (parseFloat(cs.rowGap) || 0),
                stripRectHeight: strip.getBoundingClientRect().height,
                stripClientHeight: strip.clientHeight,
              };
            }, zoom);

          const unzoomed = await probeAt(null);
          expect(unzoomed.probes).toBeGreaterThan(15);
          expect(unzoomed.stripRectHeight).toBeCloseTo(unzoomed.stripClientHeight, 1);
          expect(unzoomed.wrong).toEqual([]);

          for (const zoom of [FIT_ZOOM, "1.5"]) {
            const zoomed = await probeAt(zoom);
            // The rect space and the strip's own space are genuinely apart…
            expect(zoomed.stripRectHeight).toBeCloseTo(
              zoomed.stripClientHeight * parseFloat(zoom),
              1,
            );
            expect(zoomed.stripClientHeight).toBeCloseTo(unzoomed.stripClientHeight, 1);
            expect(zoomed.rowStride).toBeCloseTo(unzoomed.rowStride, 1);
            // …and pageOf() still answers in the strip's space.
            expect(zoomed.wrong).toEqual([]);
            expect(zoomed.pageOf).toEqual(unzoomed.pageOf);
          }

          // A hot reload re-fragments while the host's zoom is already
          // applied — the path that made this bug permanent for an author
          // rather than merely a cold-start race.
          const afterRefresh = await page.evaluate(async (zoom) => {
            document.documentElement.style.setProperty("--gutterpress-zoom", zoom);
            void document.body.offsetHeight;
            (window as unknown as { Gutterpress: { refresh(): void } }).Gutterpress.refresh();
            await new Promise((r) => setTimeout(r, 50));
            return null;
          }, FIT_ZOOM);
          expect(afterRefresh).toBeNull();
          const reloaded = await probeAt(FIT_ZOOM);
          expect(reloaded.wrong).toEqual([]);
          expect(reloaded.pageOf).toEqual(unzoomed.pageOf);

          // The column axis: spread mode lays the same pages out two-up, so
          // `indexInStrip`'s horizontal division carries the answer. Its
          // verdict must stay the single-mode one (`spread.test.ts`'s
          // property, which is the parity-gated answer) under zoom too.
          const spread = await page.evaluate(async (zoom) => {
            document.documentElement.style.setProperty("--gutterpress-zoom", zoom);
            const gp = (
              window as unknown as {
                Gutterpress: { setSpread(on: boolean): void; pageOf(el: Element): number };
              }
            ).Gutterpress;
            gp.setSpread(true);
            await new Promise((r) => setTimeout(r, 50));
            const probes = Array.from(document.querySelectorAll<HTMLElement>("#root > *"));
            const pages = probes.map((el) => gp.pageOf(el));
            gp.setSpread(false);
            return pages;
          }, FIT_ZOOM);
          expect(spread).toEqual(unzoomed.pageOf);
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
