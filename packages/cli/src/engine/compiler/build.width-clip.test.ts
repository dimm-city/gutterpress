import { expect, test } from "bun:test";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { resolveChromiumExecutable } from "../../lib/chromium.ts";
import { GUTTERPRESS_CSS } from "../../lib/markdown/gutterpress-css.ts";
import { MARKER_CSS } from "../../lib/markdown/markers.js";
import { launchChromium } from "../shared/cdp.ts";
import { build } from "./build.ts";

/**
 * The pre-print width check exists to catch Chromium's print shrink-to-fit,
 * and shrink-to-fit only reacts to overflow that ESCAPES — content a
 * clipping/scrolling ancestor already contains never reaches the document's
 * overflow and never scales the book.
 *
 * Every case below is MEASURED, not reasoned: each fixture was built with
 * `allowShrink` and the printed width of a marker word read off
 * `pdftotext -bbox` against an unshrunk control (56.505pt unshrunk vs
 * 37.670pt = 0.667x shrunk, the 1.5x clamp).
 *
 *   contained (56.505pt, no shrink)   | escapes (37.670pt, shrunk)
 *   ----------------------------------|---------------------------------
 *   overflow: hidden / clip / auto    | no clipping ancestor at all
 *     / scroll                        | overflow-x: visible + overflow-y:
 *   overflow-x: hidden alone          |   clip (per CSS Overflow 3, `clip`
 *   overflow-y: hidden alone (`clip`  |   does NOT force the other axis off
 *     computes x to `auto`)           |   `visible`, so x really is open)
 *   abspos under a clipping ancestor  | overflow-clip-margin wide enough to
 *     that IS its containing block    |   let the box through
 *   html + body both hidden           | abspos under a STATIC clipper
 *                                     | html alone, or body alone, hidden
 *                                     |   (root overflow propagates to the
 *                                     |   viewport; the element stops
 *                                     |   clipping its own content)
 *
 * Two fixtures, one build each: everything that must stay silent, and
 * everything that must still hard-error.
 */

const RENDER_TEST_TIMEOUT_MS = 90_000;
const doc = (css: string, body: string) => `<!doctype html><meta charset="utf-8"><style>
${MARKER_CSS}
${GUTTERPRESS_CSS}
@page { size: 384px 480px; margin: 24px; }
body { font: 12px/1.4 serif; }
.wide { width: 900px; height: 40px; background: #cde; }
.shell { width: 300px; height: 60px; }
${css}
</style>
<div class="page">
  <p>Ordinary page text.</p>
  ${body}
</div>`;

// Every over-wide box here is sealed inside a clipping ancestor, so the
// document's own overflow is unchanged and Chromium prints at 1.0x.
const contained = doc(
  `.hidden-shell { overflow: hidden; }
   .clip-shell { overflow-x: clip; }
   .scroll-shell { overflow: auto; }
   .y-hidden-shell { overflow-y: hidden; }
   .cb-shell { position: relative; overflow: hidden; }`,
  `<div class="shell hidden-shell"><div class="wide hidden-art">clipped</div></div>
   <div class="shell clip-shell"><div class="wide clipx-art">clipped</div></div>
   <div class="shell scroll-shell"><div class="wide scroll-art">clipped</div></div>
   <div class="shell y-hidden-shell"><div class="wide yhidden-art">clipped</div></div>
   <div class="shell cb-shell"><div class="wide abspos-art" style="position:absolute;left:0;top:0">clipped</div></div>
   <div class="shell hidden-shell"><div class="wide left-art" style="width:200px;margin-left:-260px">clipped</div></div>`,
);

// Nothing here is contained: each box's overflow reaches the document and
// scales the whole book, so each must still be named in the hard error.
const escaping = doc(
  `.open-y-clip-shell { overflow-x: visible; overflow-y: clip; }
   .margin-shell { overflow: clip; overflow-clip-margin: 700px; }
   .static-shell { overflow: hidden; }`,
  `<div class="wide bare-art">escapes</div>
   <div class="shell open-y-clip-shell"><div class="wide openaxis-art">escapes</div></div>
   <div class="shell margin-shell"><div class="wide clipmargin-art">escapes</div></div>
   <div class="shell static-shell"><div class="wide escaped-art" style="position:absolute;left:0;top:0">escapes</div></div>`,
);

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;
if (!chromium) {
  // eslint-disable-next-line no-console
  console.warn(
    "[build.width-clip.test] No Chromium resolved — skipping. Install Chrome/Chromium or set CHROMIUM_PATH to run it.",
  );
}

const buildFixture = async (name: string, html: string) => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), `gp-width-clip-${name}-`));
  const browser = await launchChromium();
  try {
    const file = path.join(dir, "book.html");
    await fsp.writeFile(file, html, "utf8");
    return await build({ input: pathToFileURL(file).href, browser, dpiFloor: 0 });
  } finally {
    await browser.close();
    await fsp.rm(dir, { recursive: true, force: true });
  }
};

testIf(
  "over-wide content sealed inside a clipping ancestor is not a width offender",
  async () => {
    const result = await buildFixture("contained", contained);
    expect(result.diagnostics.filter((d) => d.code === "engine.width.overflow")).toHaveLength(0);
  },
  RENDER_TEST_TIMEOUT_MS,
);

testIf(
  "overflow that escapes its ancestors still hard-errors",
  async () => {
    const err = await buildFixture("escaping", escaping).then(
      () => null,
      (e: Error) => e,
    );
    expect(err).not.toBeNull();
    const msg = err!.message;
    expect(msg).toContain("wider than the page content box");
    for (const art of ["bare-art", "openaxis-art", "clipmargin-art", "escaped-art"])
      expect(msg).toContain(art);
  },
  RENDER_TEST_TIMEOUT_MS,
);
