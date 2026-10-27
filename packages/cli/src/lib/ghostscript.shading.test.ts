import { expect, test } from "bun:test";
import { resolveChromiumExecutable } from "./chromium.ts";
import { launchChromium } from "../engine/shared/cdp.ts";
import { findPostScriptShadingPages } from "./ghostscript.ts";

// #386: needs a real Chromium, because the thing under test is the exact PDF
// structure Skia emits (/PatternType 2 -> /ShadingType 1 + /FunctionType 4),
// not something worth hand-forging.
const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;
if (!chromium) {
  // eslint-disable-next-line no-console
  console.warn("[ghostscript.shading.test] Skipping — no Chromium resolved.");
}

const PAGE = `<style>@page{size:200px 200px;margin:0} div{width:200px;height:200px;break-after:page}</style>`;
const BOXES = [
  `<div style="background:linear-gradient(red,blue)"></div>`,
  `<div style="background:repeating-linear-gradient(45deg,red 0 10px,blue 10px 20px)"></div>`,
  `<div style="background:linear-gradient(90deg,#b33 0 6px,#c8c5bf 6px 10px);background-size:10px 100%"></div>`,
  `<div style="background:radial-gradient(circle,red,blue)"></div>`,
  `<div style="background:repeating-radial-gradient(circle,red 0 10px,blue 10px 20px)"></div>`,
  `<div style="background:conic-gradient(red,blue,red)"></div>`,
  `<div style="background:repeating-conic-gradient(red 0 20deg,blue 20deg 40deg)"></div>`,
];

testIf("findPostScriptShadingPages names exactly the pages with repeating/conic gradients", async () => {
  const browser = await launchChromium();
  try {
    const page = await browser.newPage();
    await page.setContent(PAGE + BOXES.join(""));
    const pdf = await page.printToPDF({ printBackground: true, preferCSSPageSize: true });
    expect(await findPostScriptShadingPages(pdf)).toEqual([2, 5, 6, 7]);
  } finally {
    await browser.close();
  }
});

// #438: a box that opens a page, with ink overflow above its top edge (here a
// box-shadow blur), is painted by Chromium into the previous page as well —
// its whole background, clipped to that page's content box, so the previous
// page carries the gradient as a sliver of no area. Only the page the box is
// on is reported. The sheet is the dtrpg trim with 1in margins (the build's
// default), a content height of a whole number of pixels, which is where the
// sliver appears; the first page is short on purpose.
testIf("findPostScriptShadingPages ignores the sliver of a gradient box that opens the next page", async () => {
  const browser = await launchChromium();
  try {
    const page = await browser.newPage();
    await page.setContent(
      `<style>@page{size:621pt 810pt;margin:1in} section{break-after:page}
.vibe{padding:16px;box-shadow:0 8px 16px rgba(0,0,0,.4);background:repeating-linear-gradient(35deg,#ffc 0 8pt,#3ce 8pt 16pt)}</style>
<section><p>short</p></section><section><div class="vibe">Vibe</div></section>`
    );
    const pdf = await page.printToPDF({ printBackground: true, preferCSSPageSize: true });
    expect(await findPostScriptShadingPages(pdf)).toEqual([2]);
  } finally {
    await browser.close();
  }
});

test("findPostScriptShadingPages returns no pages for bytes that are not a PDF", async () => {
  expect(await findPostScriptShadingPages(Buffer.from("not a pdf at all"))).toEqual([]);
});
