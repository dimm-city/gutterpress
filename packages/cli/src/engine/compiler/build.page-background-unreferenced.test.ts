import { expect, test } from "bun:test";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { resolveChromiumExecutable } from "../../lib/chromium.ts";
import { launchChromium } from "../shared/cdp.ts";
import { build } from "./build.ts";

/**
 * docs/known-limitations.md §3 (#152). Chromium does not paint a `url()`
 * image inside an `@page` rule when that rule is the document's ONLY
 * reference to it — the sheet prints with its background colour alone, with
 * no error anywhere.
 *
 * Measured Chrome 151.0.7922.75, 96dpi raster, mean absolute pixel difference
 * against the same page with no background image:
 *
 *   @page { background: url(tile.png) }, sole reference       0.0000
 *     + <link rel="preload" as="image">                      89.3574
 *     + html { background: url(same) }                       89.3574
 *     + an <img src="same">                                   0.0000  (!)
 *     + a preload AND an <img src="same">                     0.0000  (!)
 *   the same url as a `data:` URI, sole reference            89.3574  (immune)
 *   @top-center { background-image: url(tile.png) }, sole      0.0000
 *     + <link rel="preload" as="image">                       8.0345
 *     (control: a gradient on the same box                   16.8009)
 *
 * The two `(!)` rows are why this audit's predicate had to change. An `<img>`
 * does not protect the page box under this pipeline's print sequence, and when
 * a preload is present the `<img>` MATCHES and CONSUMES it — so an element
 * reference is not weak evidence of safety, it is evidence of the failure.
 * "Something else mentions this URL" is the wrong question; the right one is
 * "does an unconsumed preload name it".
 *
 * Why this is a build-time audit and not a CSS lint: `checkCss` sees CSS
 * source only, and the references that decide the outcome are in the HTML.
 * A source lint would fire on the common, correct case and stay silent on
 * half the broken one.
 */

const RENDER_TEST_TIMEOUT_MS = 90_000;
const TILE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAANElEQVR4nGM8oaHBAANqx47B2besrLCKMzGQCGivgfHdu3dwDi53I4sPRj+MxgMtnESyBgChUhnhqt25gQAAAABJRU5ErkJggg==";
const DATA_URI = `data:image/png;base64,${TILE_PNG_BASE64}`;

/** Both places an `@page` rule can reference an image, neither referenced
 * anywhere else in the document. */
const dropped = `<!doctype html><meta charset="utf-8"><style>
@page {
  size: 300px 400px; margin: 40px;
  background: #fff url("tile.png") repeat;
  @top-center { content: "F"; background-image: url("chrome.png"); }
}
body { font: 14px/1.4 serif; margin: 0 }
</style>
<p>Page text.</p>`;

/** The same two images, each given the second reference that makes Chromium
 * paint them — plus the three shapes that are never affected: a `data:` URI,
 * a gradient and a solid colour. */
const painted = `<!doctype html><meta charset="utf-8">
<link rel="preload" as="image" href="tile.png">
<style>
@page {
  size: 300px 400px; margin: 40px;
  background: #fff url("tile.png") repeat;
  @top-center { content: "F"; background-image: url("chrome.png"); }
}
@page :first { background: #2d6cdf url("${DATA_URI}") repeat; }
@page named { background: linear-gradient(#c00, #00c); }
body { font: 14px/1.4 serif; margin: 0 }
.crumb { background-image: url("chrome.png"); width: 1px; height: 1px }
</style>
<p>Page text.</p><div class="crumb"></div>`;

/**
 * The two shapes where an ELEMENT reference to the same URL is what breaks the
 * page box, and the audit used to read as proof of safety.
 *
 * `tile.png` is named by an `<img src>` and nothing else: measured, that does
 * NOT protect the page box under this pipeline's print sequence, it drops.
 * `chrome.png` has the `<link rel="preload">` that would protect it AND an
 * `<img src>` — the `<img>` matches the preload and consumes it, so the page
 * box has to start a fresh fetch and drops too (measured by request count:
 * preload+img issues 2 tile requests, not 3).
 *
 * Both must be reported. Treating `[src]` as protective is not merely
 * incomplete — it is inverted for exactly the reference type that breaks the
 * thing the audit exists to protect.
 */
const consumed = `<!doctype html><meta charset="utf-8">
<link rel="preload" as="image" href="chrome.png">
<style>
@page {
  size: 300px 400px; margin: 40px;
  background: #fff url("tile.png") repeat;
  @top-center { content: "F"; background-image: url("chrome.png"); }
}
body { font: 14px/1.4 serif; margin: 0 }
</style>
<p>Page text.</p>
<img src="tile.png" style="display:none" alt="">
<img src="chrome.png" style="display:none" alt="">`;

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;
if (!chromium) {
  // eslint-disable-next-line no-console
  console.warn(
    "[build.page-background-unreferenced.test] No Chromium resolved — skipping. Install Chrome/Chromium or set CHROMIUM_PATH to run it.",
  );
}

testIf(
  "an image referenced only inside an @page rule is reported; a second reference, a data: URI, a gradient and a colour are not",
  async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "gp-page-bg-"));
    const browser = await launchChromium();
    try {
      const png = Buffer.from(TILE_PNG_BASE64, "base64");
      await fsp.writeFile(path.join(dir, "tile.png"), png);
      await fsp.writeFile(path.join(dir, "chrome.png"), png);

      const run = async (name: string, html: string) => {
        const file = path.join(dir, `${name}.html`);
        await fsp.writeFile(file, html, "utf8");
        const result = await build({ input: pathToFileURL(file).href, browser, dpiFloor: 0 });
        return result.diagnostics.filter((d) => d.code === "engine.page-background.unreferenced");
      };

      const found = await run("dropped", dropped);
      expect(found).toHaveLength(2);
      expect(found.every((d) => d.severity === "warning")).toBe(true);
      const page = found.find((d) => d.message.includes("tile.png"))!;
      expect(page).toBeDefined();
      expect(page.message).toContain("@page");
      expect(page.message).toContain("will not print");
      expect(found.some((d) => d.message.includes("chrome.png"))).toBe(true);

      expect(await run("painted", painted)).toHaveLength(0);

      // An `<img src>` naming the URL is not protection — with or without a
      // preload it drops, so both must still be reported.
      const consumedFound = await run("consumed", consumed);
      expect(consumedFound.map((d) => d.message).join("\n")).toContain("tile.png");
      expect(consumedFound.map((d) => d.message).join("\n")).toContain("chrome.png");
      expect(consumedFound).toHaveLength(2);
    } finally {
      await browser.close();
      await fsp.rm(dir, { recursive: true, force: true });
    }
  },
  RENDER_TEST_TIMEOUT_MS,
);
