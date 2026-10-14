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

test("findPostScriptShadingPages returns no pages for bytes that are not a PDF", async () => {
  expect(await findPostScriptShadingPages(Buffer.from("not a pdf at all"))).toEqual([]);
});
