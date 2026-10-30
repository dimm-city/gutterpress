import { afterAll, expect, test } from "bun:test";

import { launchChromium, type Browser } from "../../../cli/src/engine/shared/cdp";
import { resolveChromiumExecutable } from "../../../cli/src/lib/chromium";
import { sampleComputedValues } from "../../src/lib/style-tokens";
import { sampleSrcdoc } from "../../src/lib/components/config/config-helpers";

/**
 * #454: the design settings take each token's value from the sample page's
 * `getComputedStyle`, so the cascade is Chromium's. This runs the shipped
 * `sampleComputedValues` (and the `sampleSrcdoc` it renders) in Chromium over
 * a stylesheet shaped like the book's: core and extensions layered, the
 * book's sheets unlayered, last.
 */
const chromium = await resolveChromiumExecutable();
const browserTest = chromium ? test : test.skip;
// Launched at module scope, outside any per-test timeout (see preview-scroll-browser.test.ts).
const browser: Browser | undefined = chromium ? await launchChromium() : undefined;

afterAll(async () => {
  await browser?.close();
});

const PAPER = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><path d='M0 0;L4 4'/></svg>")`;

browserTest("the sample page computes each token's value with the book's cascade", async () => {
  const css = [
    "@layer gp.marker, gp.vocab;",
    "@layer gp.vocab {\n:root { --gp-z-front: 2; }\n}",
    // An extension's own sublayer, then its plain rules: both inside its layer.
    "@layer ext.look {\n@layer theme { :root { --color-accent: #111111; } }\n:root { --fs-body: 11pt; --color-accent: #2b4c7e; }\n}",
    "@layer ext.later {\n:root { --fs-body: 12pt; --paper: none; }\n}",
    // The book's sheets: unlayered, so they win whatever comes before.
    ":root {\n  --fs-body: 10.5pt;\n}",
    `:root {\n  --paper: ${PAPER};\n}`,
    "@media print { :root { --fs-body: 9pt; } }",
  ].join("\n\n");
  const page = await browser!.newPage();
  try {
    await page.setContent("<!doctype html><body></body>");
    const values = await page.evaluate<Record<string, string>>(
      `(() => { ${sampleSrcdoc.toString()}; return (${sampleComputedValues.toString()})(${JSON.stringify(css)}, ["--color-accent", "--fs-body", "--paper", "--gp-z-front", "--unset"]); })()`,
    );
    expect(values).toEqual({
      "--color-accent": "#2b4c7e",
      "--fs-body": "10.5pt",
      "--paper": PAPER,
      "--gp-z-front": "2",
      "--unset": "",
    });
    // The off-screen frame is gone again.
    expect(await page.evaluate<number>("document.querySelectorAll('iframe').length")).toBe(0);
  } finally {
    await page.close();
  }
}, 30_000);
