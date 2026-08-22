import { expect, test } from "bun:test";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { resolveChromiumExecutable } from "../../lib/chromium.ts";
import { launchChromium } from "../shared/cdp.ts";
import { build } from "./build.ts";

/**
 * `engine.content.overheight` must compare an element with the content box of
 * the page context it actually requests. The real field guide's 1080px
 * `.gp-bleed` fits its zero-margin named page but used to be compared against
 * the default page's 960px content box and warned falsely.
 */

const RENDER_TEST_TIMEOUT_MS = 90_000;
// Regression for bounded pseudo enumeration: the old powerset generated more
// than one billion contexts for these 30 exact :nth() selectors. The build
// must remain linear in authored exact-selector sets and still use their
// smallest content box.
const manyNthRules = Array.from(
  { length: 30 },
  (_, i) => `@page many:nth(${i + 1}) { margin: ${i === 29 ? 100 : 0}px 0; }`,
).join("\n");
const fixture = `<!doctype html><meta charset="utf-8"><style>
@page { size: 384px 240px; margin: 24px; }
@page full-bleed { size: 384px 240px; margin: 0; }
@page variant { size: 384px 240px; margin: 0; }
@page variant:left { margin: 40px 0; }
@page variant:right { size: 384px 260px; margin: 0; }
@page compound { size: 384px 240px; margin: 0; }
@page compound:right { size: 384px 260px; }
@page compound:right:recto { margin: 60px 0; }
@page many { size: 384px 240px; margin: 0; }
${manyNthRules}
body { margin: 0; }
img { display: block; width: 40px; break-before: page; }
.named { page: full-bleed; }
.variant { page: variant; }
.compound { page: compound; }
.many { page: many; }
.fits-named { height: 220px; }
.too-tall-named { height: 260px; }
.too-tall-default { height: 220px; }
.fits-every-variant { height: 150px; }
.too-tall-for-left-variant { height: 170px; }
.fits-compound-variant { height: 130px; }
.too-tall-for-compound-variant { height: 150px; }
.fits-many-nth-variants { height: 30px; }
.too-tall-for-nth-variant { height: 50px; }
</style>
<img class="fits-named named" alt="fits named page"
  src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='220'/%3E">
<img class="too-tall-named named" alt="too tall for named page"
  src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='260'/%3E">
<img class="too-tall-default" alt="too tall for default page"
  src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='220'/%3E">
<img class="fits-every-variant variant" alt="fits every named-page variant"
  src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='150'/%3E">
<img class="too-tall-for-left-variant variant" alt="too tall for left variant"
  src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='170'/%3E">
<img class="fits-compound-variant compound" alt="fits compound variant"
  src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='130'/%3E">
<img class="too-tall-for-compound-variant compound" alt="too tall for compound variant"
  src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='150'/%3E">
<img class="fits-many-nth-variants many" alt="fits every nth variant"
  src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='30'/%3E">
<img class="too-tall-for-nth-variant many" alt="too tall for nth variant"
  src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='50'/%3E">`;

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;
if (!chromium) {
  // eslint-disable-next-line no-console
  console.warn(
    "[build.overheight-page-context.test] No Chromium resolved — skipping. Install Chrome/Chromium or set CHROMIUM_PATH to run it.",
  );
}

testIf(
  "overheight uses the element's named content box without silencing true overheight",
  async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "gp-overheight-context-"));
    const browser = await launchChromium();
    try {
      const file = path.join(dir, "book.html");
      await fsp.writeFile(file, fixture, "utf8");
      const result = await build({ input: pathToFileURL(file).href, browser, dpiFloor: 0 });
      const findings = result.diagnostics.filter((d) => d.code === "engine.content.overheight");

      expect(findings).toHaveLength(5);
      expect(findings.some((d) => d.message.includes("fits-named"))).toBe(false);
      expect(findings.some((d) => d.message.includes("fits-every-variant"))).toBe(false);
      expect(findings.some((d) => d.message.includes("fits-compound-variant"))).toBe(false);
      expect(findings.some((d) => d.message.includes("fits-many-nth-variants"))).toBe(false);
      expect(
        findings.some(
          (d) => d.message.includes("too-tall-named") && d.message.includes("240px full-bleed page"),
        ),
      ).toBe(true);
      expect(
        findings.some(
          (d) =>
            d.message.includes("too-tall-for-nth-variant") &&
            d.message.includes("40px many page"),
        ),
      ).toBe(true);
      expect(
        findings.some(
          (d) =>
            d.message.includes("too-tall-for-compound-variant") &&
            d.message.includes("140px compound page"),
        ),
      ).toBe(true);
      expect(
        findings.some(
          (d) => d.message.includes("too-tall-default") && d.message.includes("192px default-page"),
        ),
      ).toBe(true);
      expect(
        findings.some(
          (d) =>
            d.message.includes("too-tall-for-left-variant") &&
            d.message.includes("160px variant page"),
        ),
      ).toBe(true);
    } finally {
      await browser.close();
      await fsp.rm(dir, { recursive: true, force: true });
    }
  },
  RENDER_TEST_TIMEOUT_MS,
);
