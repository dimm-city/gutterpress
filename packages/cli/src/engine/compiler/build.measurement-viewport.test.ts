import { expect, test } from "bun:test";
import fsp from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { resolveChromiumExecutable } from "../../lib/chromium.ts";
import { makeTempDir, pngRgb } from "../../test-helpers/testkit.ts";
import { connectChromium, type Browser } from "../shared/cdp.ts";
import { build } from "./build.ts";

/**
 * THE INVARIANT: the engine's pinned measurement viewport is the SHEET, not
 * the sheet minus whatever chrome the host's browser happens to draw.
 *
 * Every audit, the pre-print width check and the Tier-3 viewer prediction read
 * boxes laid out inside that viewport. If it is 15px narrower than the sheet,
 * the engine measures a document that is not the one it prints — and because
 * the print itself re-lays out at the paper box, the PDF looks fine while the
 * VERDICTS about it are wrong.
 *
 * WHY THIS EXISTS (docs/analysis/cli-desktop-print-parity.md §6, §7): Chromium
 * only hides scrollbars if something asks. The CLI's browser is launched by
 * puppeteer, whose default argument set contains `--hide-scrollbars`; an
 * Electron `BrowserWindow` — the desktop app's engine browser — is not. So the
 * same book, byte for byte, measured 576px on the CLI and 561px on the
 * desktop, and that decided real outcomes in BOTH directions: a box measuring
 * 450px against a 442px limit hard-errored on the CLI and shipped a PDF on the
 * desktop, and 8 of 21 low-DPI print-quality warnings on a real 289-page book
 * never reached the desktop author. Nothing in Gutterpress ever asked for that
 * flag or knew it was load-bearing.
 *
 * WHY IT IS SINGLE-HOST. A CLI-vs-desktop comparison would sample the one
 * Chromium pair CI happens to have, while the CLI runs on any Chrome, Edge,
 * Brave, Vivaldi or Opera build >= 148. This asserts the invariant instead, so
 * it holds for every host, including hosts that do not exist yet.
 *
 * HARNESS CONDITIONS (this defect family has been misdiagnosed three times by
 * harness artifacts, so they are stated rather than assumed):
 *
 *   - driver: puppeteer-core `launch` -> `connectChromium`, which IS the CLI's
 *     product path (`browser-pool.ts` -> `lib/engine.ts`) — but with
 *     `ignoreDefaultArgs: ["--hide-scrollbars"]`, i.e. a host that does not
 *     contribute the flag. **A version of these tests that runs under
 *     puppeteer's defaults passes today and proves nothing.**
 *   - `--virtual-time-budget`: not passed.
 *   - pre-navigation device-metrics override: none. `build()` navigates first
 *     and pins after; nothing here establishes an override before that.
 *   - scheme: `file://`.
 *   - the fixtures OVERFLOW the pinned viewport vertically. Measured: a
 *     one-line document reads 576/576/576 on every leg, because a classic
 *     scrollbar takes no space until there is something to scroll. Every real
 *     book overflows; a fixture that does not would make these tests green for
 *     the wrong reason.
 *
 * Both tests drive the real `build()`. They deliberately do not re-create its
 * navigate/pin sequence: a test that runs its own copy of the code under test
 * measures its own copy.
 */

/** Sheet: 6 x 9 in, zero margin. 576 x 864 CSS px at 96 dpi. */
const SHEET_PX = 576;

/** Enough height to force a scrollbar in a browser that draws one. */
const TALL = `<div style="height: 3000px"></div>`;

/**
 * One image, `width: 100%`, on a zero-margin page with a zero-margin body: its
 * laid-out width IS `document.documentElement.clientWidth`. The print-quality
 * audit reports that width in inches, which is how the pinned viewport becomes
 * readable from `build()`'s own return value without a second measurement path.
 */
const dpiProbe = `<!doctype html><meta charset="utf-8"><style>
@page { size: 6in 9in; margin: 0 }
html, body { margin: 0 }
img { display: block; width: 100% }
</style><img src="plate.png" alt=""> ${TALL}`;

/**
 * The consequence fixture, sized to STRADDLE the gap: content box = the full
 * 576px sheet, and the box is `width: 100%` plus 4px of padding a side. Under
 * the sheet it measures 584px — 7px past the limit, a hard error. Under the
 * sheet minus a 15px scrollbar it measures 569px — 8px inside the limit, and
 * the book ships. Same source, same lib, opposite verdicts.
 */
const overWide = `<!doctype html><meta charset="utf-8"><style>
@page { size: 6in 9in; margin: 0 }
html, body { margin: 0 }
.overwide { width: 100%; padding: 0 4px; background: #cde }
</style><div class="overwide">escapes</div> ${TALL}`;

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;
if (!chromium) {
  // eslint-disable-next-line no-console
  console.warn(
    "[build.measurement-viewport.test] No Chromium resolved — skipping. Install Chrome/Chromium or set CHROMIUM_PATH to run it.",
  );
}

/**
 * The CLI's own launch + connect path, minus the one default flag that has
 * been silently doing this job. `ignoreDefaultArgs` takes the flag out of
 * puppeteer's set without adding anything to Gutterpress's.
 */
async function withScrollbarDrawingBrowser<T>(fn: (browser: Browser) => Promise<T>): Promise<T> {
  const puppeteer = (await import("puppeteer-core")).default;
  const pup = await puppeteer.launch({
    headless: true,
    executablePath: chromium!,
    ignoreDefaultArgs: ["--hide-scrollbars"],
    args: (process.env.GUTTERPRESS_CHROMIUM_ARGS ?? "").split(/\s+/).filter(Boolean),
  });
  const browser = await connectChromium(pup.wsEndpoint());
  try {
    return await fn(browser);
  } finally {
    await browser.close();
    await pup.close();
  }
}

testIf(
  "the pinned measurement viewport is the sheet, not the sheet minus the host's scrollbar",
  async () => {
    const dir = await makeTempDir("gp-measurement-viewport-");
    try {
      // 800px wide, printed 6in wide = 133 DPI: under the 300 bar, so the
      // audit reports it and states the width it measured.
      await fsp.writeFile(
        path.join(dir, "plate.png"),
        pngRgb(800, 100, () => [200, 40, 40]),
      );
      const file = path.join(dir, "book.html");
      await fsp.writeFile(file, dpiProbe, "utf8");

      const result = await withScrollbarDrawingBrowser((browser) =>
        build({ input: pathToFileURL(file).href, browser }),
      );

      expect(result.viewport.width).toBe(SHEET_PX);

      const lowDpi = result.diagnostics.filter((d) => d.code === "engine.image.low-dpi");
      // The control: if the audit did not fire, the assertion below would
      // vacuously pass on an empty list.
      expect(lowDpi).toHaveLength(1);

      const inches = Number(/printed at ([\d.]+)in/.exec(lowDpi[0]!.message)?.[1]);
      expect(inches).not.toBeNaN();
      const measuredPx = Math.round(inches * 96);

      expect(
        measuredPx,
        `The engine laid the document out at ${measuredPx}px inside a ${result.viewport.width}px pinned viewport. ` +
          `The measurement viewport must be the sheet, not the sheet minus whatever chrome the host's browser draws — ` +
          `every audit, the width check and the Tier-3 prediction read boxes from it, and a host that draws a scrollbar ` +
          `silently measures a document ${result.viewport.width - measuredPx}px narrower than the one it prints. ` +
          `Own the state in build(), beside the viewport pin; do not rely on the launcher to supply it.`,
      ).toBe(result.viewport.width);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  },
  90_000,
);

testIf(
  "the over-wide verdict is the same on a host that draws scrollbars",
  async () => {
    const dir = await makeTempDir("gp-measurement-viewport-width-");
    try {
      const file = path.join(dir, "book.html");
      await fsp.writeFile(file, overWide, "utf8");

      const outcome = await withScrollbarDrawingBrowser((browser) =>
        build({ input: pathToFileURL(file).href, browser }).then(
          (r) => `built and returned a ${r.bytes.length}-byte PDF`,
          (e: Error) => e.message,
        ),
      );

      // The consequence, not the mechanism: same source, same manifest, same
      // lib — one host must not hard-error while the other hands the author a
      // book. A scrollbar makes the measurement NARROWER, so the host that
      // draws one under-reports right-edge overflow and ships the PDF.
      expect(
        outcome,
        `build() ${outcome} for content that overflows the page content box, because the host's ` +
          "scrollbar made the document measure narrower than the sheet. Chromium answers over-wide " +
          "content by shrinking the WHOLE book silently; the engine's job is to refuse it, on every host.",
      ).toContain("content wider than the page content box");
      expect(outcome).toContain(`> ${SHEET_PX}px content box`);
      // 576 (sheet) + 2 x 4px padding. The number is the measurement: a host
      // measuring 561 does not report 569 here, it reports nothing at all.
      expect(outcome).toContain(`div.overwide — ${SHEET_PX + 8}px`);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  },
  90_000,
);
