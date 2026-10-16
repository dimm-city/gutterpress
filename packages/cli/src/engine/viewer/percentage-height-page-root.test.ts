import { serveDir } from "./test-support/serve-dir.ts";
import { test, expect, afterAll } from "bun:test";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveChromiumExecutable } from "../../lib/chromium.ts";
import { getAssetPath } from "../../lib/embedded-assets.ts";
import { closeBrowser, getBrowser } from "./test-support/browser.ts";
import { MARKER_CSS } from "../../lib/markdown/markers.js";

/**
 * A page root's PERCENTAGE height resolves on screen exactly where it
 * resolves in print — against the flow root, and only when that is definite.
 *
 * `fixtures/percentage-height-root.html` is examples/with-print-effects'
 * shape: `[data-name="x"] { height: 100% }` on each page block, a rule that
 * also reaches the block's heading (the pipeline gives both the same
 * data-name). In print the flow root's height is auto, so the percentage is
 * auto, MARKER_CSS's min-height cushion sizes the root, and nothing happens.
 * The viewer's strip used to be a definite `height: var(--gp-content-h)`, so
 * on screen the percentage resolved: the root ended exactly on the column
 * edge, the heading filled the root, the paragraph spilled into the next
 * column, and the run's LAST root left a blank column — a preview page the
 * PDF does not have (that example: print 5pp, viewer 8pp). `.gp-strip` is now
 * `height: 100%` clamped to the column (viewer.css), so it asks the flow root
 * the same question print's percentage does.
 *
 * Both cases print the SAME markup with the viewer script removed, so the
 * PDF side is Chromium's own paged-media fragmenter and nothing else: the
 * viewer's page count must equal it, never a belief about it.
 */

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const RENDER_TEST_TIMEOUT_MS = 60_000;

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;

afterAll(async () => {
  await closeBrowser();
});

// MARKER_CSS ahead of the author's sheet in its own layer, as assemble.ts
// injects it, so the author's unlayered rules win as they do in a real book.
const SOURCE = (await fsp.readFile(path.join(FIXTURES_DIR, "percentage-height-root.html"), "utf8")).replace(
  "<style>",
  `<style>@layer gp.marker, gp.vocab;\n@layer gp.marker {\n${MARKER_CSS}\n}</style>\n<style>`,
);
const VIEWER_SCRIPT = '<script src="gutterpress-viewer.js"></script>';

/** The fixture with `extraCss` after the author's sheet. */
function variant(extraCss: string): string {
  return extraCss ? SOURCE.replace("</head>", `<style>${extraCss}</style>\n</head>`) : SOURCE;
}

async function printPages(html: string): Promise<number> {
  const page = await (await getBrowser()).newPage();
  try {
    await page.setContent(html.replace(VIEWER_SCRIPT, ""));
    const pdf = await page.pdf({ preferCSSPageSize: true });
    return (Buffer.from(pdf).toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  } finally {
    await page.close();
  }
}

interface Measured {
  total: number;
  /** fragments per page root, in document order — 1 when nothing spilled */
  rootFragments: number[];
  /** the strip's rendered box, which must stay one column tall either way */
  stripClientHeight: number;
  contentH: number;
}

async function viewerPages(html: string, viewport: { width: number; height: number }): Promise<Measured> {
  const dir = await fsp.mkdtemp(path.join(FIXTURES_DIR, "..", ".percentage-height-"));
  try {
    await fsp.writeFile(path.join(dir, "book.html"), html, "utf8");
    await fsp.copyFile(await getAssetPath("engine/gutterpress-viewer.js"), path.join(dir, "gutterpress-viewer.js"));
    const { url, close } = await serveDir(dir, "book.html");
    try {
      const page = await (await getBrowser()).newPage();
      try {
        await page.setViewport(viewport);
        await page.goto(url);
        await page.waitForFunction("window.Gutterpress?.totalPages > 0");
        // Read AFTER mount: decoration has wrapped the strip in `.gp-run` by
        // now, and a definite wrapper would have resolved the percentage late
        // and re-fragmented the run under its sheets.
        return (await page.evaluate(() => {
          const G = (window as any).Gutterpress;
          const strip = document.querySelector<HTMLElement>(".gp-strip")!;
          return {
            total: G.totalPages,
            rootFragments: Array.from(document.querySelectorAll(".page")).map((r) => r.getClientRects().length),
            stripClientHeight: strip.clientHeight,
            contentH: parseFloat(getComputedStyle(strip).getPropertyValue("--gp-content-h")),
          };
        })) as Measured;
      } finally {
        await page.close();
      }
    } finally {
      await close();
    }
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

testIf(
  "a percentage-height page root paginates as print does when the flow root's height is auto",
  async () => {
    const html = variant("");
    const print = await printPages(html);
    const viewer = await viewerPages(html, { width: 1600, height: 1200 });

    expect(viewer.total).toBe(print);
    // The percentage resolved to auto, as in print: no root ended on the
    // column edge and nothing spilled into a second fragment.
    expect(viewer.rootFragments).toEqual([1, 1, 1, 1]);
    // ...while the strip's box is still exactly one column tall.
    expect(viewer.stripClientHeight).toBeCloseTo(viewer.contentH, 0);
  },
  RENDER_TEST_TIMEOUT_MS,
);

testIf(
  "a percentage-height page root paginates as print does when the flow root is definite (html, body { height: 100% })",
  async () => {
    // Print's percentage DOES resolve here, against the page area, and the
    // viewer must follow it: the same markup gives one more page in both
    // renderers. That extra page is also the control that keeps the test
    // above honest — it shows this fixture's shape really costs a fragment
    // the moment the percentage resolves. The viewport is SHORTER than the
    // column, the ordinary preview iframe: the strip's `height: 100%`
    // resolves against the viewport-tall body and the min/max pair must still
    // clamp it to the column.
    const definite = variant("html, body { height: 100%; }");
    const print = await printPages(definite);
    const viewer = await viewerPages(definite, { width: 1600, height: 700 });

    expect(viewer.total).toBe(print);
    expect(print).toBe((await printPages(variant(""))) + 1);
    expect(viewer.stripClientHeight).toBeCloseTo(viewer.contentH, 0);
  },
  RENDER_TEST_TIMEOUT_MS,
);
