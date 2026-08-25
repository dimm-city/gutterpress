import { expect, test } from "bun:test";
import fsp from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { resolveChromiumExecutable } from "../../lib/chromium.ts";
import {
  makeTempDir,
  meanAbsDiff,
  pngRgb,
  rasterizePdfPage,
  resolveRasterizer,
} from "../../test-helpers/testkit.ts";
import { launchChromium } from "../shared/cdp.ts";
import { build } from "./build.ts";

/**
 * EXPIRY CANARY for the `<link rel="preload" as="image">` emitter in
 * `lib/markdown/assemble.ts`.
 *
 * It asserts THE CHROMIUM BUG IS STILL THERE (#152,
 * docs/known-limitations.md §3): an image referenced only from inside an
 * `@page` rule prints as nothing. While it is green the emitter is doing
 * necessary work. **The day this test goes red, Chromium has fixed the bug:
 * delete the preload emitter (`preloadImages` in `assemble.ts` and the one
 * `.map()` that feeds it in `lib/markdown/index.ts`) and delete this file.**
 *
 * A shim with no removal trigger is a shim that outlives its gap. This is that
 * trigger, in the repo's own suite, so nobody has to remember to check.
 *
 * THE TRIGGER IS BEHAVIOURAL ON PURPOSE. It measures pixels off the product's
 * own print path and asserts nothing about how Chromium reaches that outcome.
 * The mechanism is known — `PrintRenderFrameHelper::PrintWithParams`, the path
 * CDP `Page.printToPDF` reaches, never calls `Document::WillPrintSoon()`, so
 * the print does not wait for the resource it just requested
 * (PR #187's `docs/analysis/why-page-background-drops.md`) — but three earlier
 * explanations of this defect were wrong, and a canary pinned to an
 * explanation retires on the wrong day.
 *
 * WHY A STANDALONE FIXTURE, NOT A BUILT BOOK: every book the product builds
 * now carries a preload, so a book fixture could never exercise the
 * unprotected case this is measuring.
 *
 * HARNESS CONDITIONS (this defect has been misdiagnosed three times by harness
 * artifacts): a browser from `launchChromium()` with no `--window-size`, a
 * page that is NAVIGATED FIRST and only then put under
 * `Emulation.setDeviceMetricsOverride` (`build()`'s own order), a `file://`
 * input, and no `--virtual-time-budget`. The third assertion below is what
 * enforces the one that matters, executably.
 */

const chromium = await resolveChromiumExecutable();
const rasterizer = await resolveRasterizer();
const testIf = chromium && rasterizer ? test : test.skip;
if (!chromium || !rasterizer) {
  // eslint-disable-next-line no-console
  console.warn(
    `[page-background-chromium-bug.canary.test] Skipping — ${!chromium ? "no Chromium resolved" : "no Ghostscript resolved"}. This suite needs both.`,
  );
}

/** Solid near-black, so painting it is unmistakable against the white sheet. */
const TILE = pngRgb(16, 16, () => [24, 24, 24]);

const SHEET = `size: 300px 400px; margin: 40px`;

/** The declaration under test is the fixture's ONLY reference to the image. */
const sole = `<!doctype html><meta charset="utf-8"><style>
@page { ${SHEET}; background: #ffffff url("tile.png") repeat }
body { font: 14px/1.4 serif; margin: 0 }
</style><p>Page text.</p>`;

/** The control: identical, minus the declaration. */
const control = `<!doctype html><meta charset="utf-8"><style>
@page { ${SHEET}; background: #ffffff }
body { font: 14px/1.4 serif; margin: 0 }
</style><p>Page text.</p>`;

/** The same declaration, plus the second reference the emitter supplies. */
const preloaded = `<!doctype html><meta charset="utf-8">
<link rel="preload" as="image" href="tile.png">
<style>
@page { ${SHEET}; background: #ffffff url("tile.png") repeat }
body { font: 14px/1.4 serif; margin: 0 }
</style><p>Page text.</p>`;

/** The same declaration, plus an ELEMENT reference to the same URL. */
const elementRef = `<!doctype html><meta charset="utf-8"><style>
@page { ${SHEET}; background: #ffffff url("tile.png") repeat }
body { font: 14px/1.4 serif; margin: 0 }
</style><p>Page text.</p><img src="tile.png" style="display:none" alt="">`;

testIf(
  "CANARY: Chromium still drops an @page background image that nothing else references",
  async () => {
    const dir = await makeTempDir("gp-page-bg-canary-");
    const browser = await launchChromium();
    try {
      await fsp.writeFile(path.join(dir, "tile.png"), TILE);

      const print = async (name: string, html: string) => {
        const file = path.join(dir, `${name}.html`);
        await fsp.writeFile(file, html, "utf8");
        const result = await build({
          input: pathToFileURL(file).href,
          browser,
          dpiFloor: 0,
        });
        const pdf = path.join(dir, `${name}.pdf`);
        await fsp.writeFile(pdf, result.bytes);
        return rasterizePdfPage(rasterizer!, pdf, dir, name);
      };

      const base = await print("control", control);
      const dropped = meanAbsDiff(await print("sole", sole), base);
      const painted = meanAbsDiff(await print("preloaded", preloaded), base);
      const viaElement = meanAbsDiff(await print("element", elementRef), base);

      // 1. THE TRIGGER. The declaration changes nothing: the bug is still here.
      expect(
        dropped,
        `Chromium PAINTED an @page background image that nothing else references (mean-abs-diff ${dropped.toFixed(4)}, expected 0). The bug this shim exists for is FIXED. Delete the preload emitter — \`preloadImages\` in lib/markdown/assemble.ts and the \`inlined.copies.map\` that feeds it in lib/markdown/index.ts — and delete this file.`,
      ).toBe(0);

      // 2. The control on the control: a preload really does restore it, so a
      //    zero above means "Chromium dropped it", not "this harness prints
      //    blank paper".
      expect(
        painted,
        `The <link rel="preload" as="image"> did not restore the background either (mean-abs-diff ${painted.toFixed(4)}). Nothing in this fixture is measuring what it claims to.`,
      ).toBeGreaterThan(1);

      // 3. THE LAUNCH-CONFIG CHECK, executable rather than a comment. Measured:
      //    an element reference protects the page box ONLY when the page was
      //    already under a device-metrics override before it loaded (which is
      //    what puppeteer's `defaultViewport` does at page creation). This
      //    pipeline establishes none — it navigates first — so an `<img>` must
      //    NOT protect. If it does, the browser this canary runs in is in that
      //    immunised state, and assertion 1 would be measuring a different
      //    browser from the one the product prints with. This is the guard for
      //    the accident named in #187: acquiring a pre-navigation override by
      //    switching to puppeteer, a pooled browser, or a `BrowserWindow`.
      expect(
        viaElement,
        `An <img> reference protected the @page background (mean-abs-diff ${viaElement.toFixed(4)}, expected 0). That only happens when a device-metrics override was established BEFORE navigation, so this canary is no longer running the print path the product uses — check how the browser and page were launched, not this assertion.`,
      ).toBe(0);
    } finally {
      await browser.close();
      await fsp.rm(dir, { recursive: true, force: true });
    }
  },
  240_000,
);
