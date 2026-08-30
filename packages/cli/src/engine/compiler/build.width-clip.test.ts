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

// A PSEUDO-ELEMENT's overflow is invisible to a border-box scan: pass 1 walks
// `document.querySelectorAll("*")` and reads `getBoundingClientRect()`, and
// `::before`/`::after` are in neither. Their overflow still reaches the
// document and still triggers shrink-to-fit, so the audit has to see it.
//
// Not hypothetical — this class is the field guide's own bug, found the
// expensive way. `.dc-spray::before` is a decorative skewed tab pinned at
// `right: -8px; width: 14px`. It escaped its shell, Chromium's print widened
// the layout past the page content box by ONE CSS pixel (696 -> 697, read as a
// vector rect out of the PDF), that pixel re-broke a line, a paragraph set in
// 3 lines instead of 4, and the book printed two pages shorter than the
// preview, with this audit silent throughout.
//
// HONEST LIMIT, verified by rebuilding that book with its fix reverted: this
// audit does NOT catch that particular instance. What it fixes is the
// structural blindness — a pseudo-element's overflow was invisible at ANY
// magnitude, because pass 1 walks `querySelectorAll("*")` and reads border
// boxes. The field guide's own instance is 1 CSS px, which is inside the +1px
// tolerance every element check needs so sub-pixel rounding does not flag
// noise in every book.
//
// A document-level check (`documentElement.scrollWidth` vs the page area) WAS
// built and then REMOVED, because it is the trigger Chromium actually reacts
// to but cannot tell a real offender from a legitimate one: a full-bleed plate
// on `@page full { margin: 0 }` is sheet-wide by design, so the document
// overflows the ordinary page area by ~120px in any book that has one. It
// fired identically on the field guide with its bug fixed and with it present.
// A diagnostic that cries wolf on correct books is worse than one that misses
// a 1px case, so it is not shipped. Catching that case needs per-page
// document-overflow accounting, not a single global read.
const pseudoEscaping = doc(
  `.spray { position: relative; width: 200px; height: 40px; background: #cde; }
   .spray::before { content: ""; position: absolute; top: 0; right: -600px;
                    width: 100px; height: 40px; background: #ecc; }
   .sealed { position: relative; width: 200px; height: 40px; overflow-x: clip; }
   .sealed::before { content: ""; position: absolute; top: 0; right: -600px;
                     width: 100px; height: 40px; background: #cec; }`,
  `<div class="spray pseudo-art">tab escapes</div>
   <div class="sealed pseudo-sealed">tab contained</div>`,
);

testIf(
  "a pseudo-element's escaping overflow is a width offender (border-box scans cannot see it)",
  async () => {
    const err = await buildFixture("pseudo", pseudoEscaping).then(
      () => null,
      (e: Error) => e,
    );
    expect(err).not.toBeNull();
    const msg = err!.message;
    expect(msg).toContain("wider than the page content box");
    // The element carrying the pseudo is the actionable target — the author
    // cannot select a pseudo-element in a fix.
    expect(msg).toContain("pseudo-art");
    // …and one sealed by a clipping ancestor stays silent, same as every other
    // contained case above: shrink-to-fit only reacts to overflow that ESCAPES.
    expect(msg).not.toContain("pseudo-sealed");
  },
  RENDER_TEST_TIMEOUT_MS,
);

// A margin-0 named page must not raise the bar for pages that HAVE margins.
//
// `findWidthOffenders` compared every element against the widest page context
// in the document. One `@page full { margin: 0 }` — the ordinary way to author
// a full-bleed art plate — therefore lifted the limit from the content box to
// the whole sheet for EVERY page, and over-wide content on ordinary pages went
// unreported. That is what hid the field guide's 696 -> 697px overflow: the
// book declares such a page, so its real limit was the 828px sheet and the
// offense sat 131px under the bar.
//
// The plate itself is legitimate — it is full-sheet ON ITS OWN full-sheet page.
// So the limit has to be resolved per element, from the page that element
// actually lands on, not from the widest page in the book.
const perPageLimit = doc(
  `@page full { margin: 0; }
   .plate { page: full; width: 384px; height: 60px; background: #cce; }
   .toowide { width: 370px; height: 40px; background: #ecc; }`,
  `<div class="plate legit-plate">full sheet on its own zero-margin page</div>
   <div class="toowide default-page-art">over-wide on an ordinary page</div>`,
);

testIf(
  "a margin-0 named page does not raise the width limit for ordinary pages",
  async () => {
    const err = await buildFixture("perpage", perPageLimit).then(
      () => null,
      (e: Error) => e,
    );
    expect(err).not.toBeNull();
    const msg = err!.message;
    // 370px is past the 336px content box of the DEFAULT page it sits on...
    expect(msg).toContain("default-page-art");
    // ...while the plate is exactly its own page's 384px sheet and is fine.
    expect(msg).not.toContain("legit-plate");
  },
  RENDER_TEST_TIMEOUT_MS,
);
