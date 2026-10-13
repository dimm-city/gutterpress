import { expect, test } from "bun:test";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { resolveChromiumExecutable } from "../../lib/chromium.ts";
import { launchChromium } from "../shared/cdp.ts";
import { build } from "./build.ts";

/**
 * `hyphens: auto` is honoured only where the printing browser has a
 * dictionary for the text's language, so the build asks the browser instead
 * of linting the CSS. A language no Chromium ships a dictionary for stands in
 * for "a browser without dictionaries"; English is the control, and is only
 * asserted where this Chromium can actually hyphenate it.
 */

const RENDER_TEST_TIMEOUT_MS = 90_000;
const TEXT =
  "Incomprehensibilities notwithstanding, internationalization characteristically overwhelms extraordinarily uncharacteristic documentation.";

const doc = (lang: string, hyphens: string) => `<!doctype html><html lang="${lang}"><meta charset="utf-8"><style>
@page { size: 300px 400px; margin: 40px; }
body { font: 14px/1.4 serif; margin: 0 }
p { hyphens: ${hyphens}; text-align: justify }
</style>
<p>${TEXT}</p>`;

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;
if (!chromium) {
  // eslint-disable-next-line no-console
  console.warn(
    "[build.hyphenation-unsupported.test] No Chromium resolved — skipping. Install Chrome/Chromium or set CHROMIUM_PATH to run it.",
  );
}

testIf(
  "hyphens: auto is reported only for a language the printing browser cannot hyphenate",
  async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "gp-hyphens-"));
    const browser = await launchChromium();
    try {
      const run = async (name: string, html: string) => {
        const file = path.join(dir, `${name}.html`);
        await fsp.writeFile(file, html, "utf8");
        const result = await build({ input: pathToFileURL(file).href, browser, dpiFloor: 0 });
        return result.diagnostics.filter((d) => d.code === "engine.hyphenation.unsupported");
      };

      // No dictionary exists for this language anywhere.
      const found = await run("unsupported", doc("tlh", "auto"));
      expect(found).toHaveLength(1);
      expect(found[0]!.severity).toBe("warning");
      expect(found[0]!.message).toContain('"tlh"');
      expect(found[0]!.message).toContain("hyphens: auto");

      // Manual hyphenation never asks for a dictionary.
      expect(await run("manual", doc("tlh", "manual"))).toHaveLength(0);

      // English: silent wherever this browser hyphenates it, reported where it cannot.
      const page = await browser.newPage();
      await page.navigate(`data:text/html,${encodeURIComponent(doc("en", "auto"))}`);
      const canHyphenate = await page.evaluate<boolean>(`(() => {
        const mk = (h) => { const d = document.createElement("div"); d.lang = "en";
          d.style.cssText = "width:1px;font:16px/16px serif;hyphens:" + h; d.textContent = "documentation";
          document.body.appendChild(d); return d.offsetHeight; };
        return mk("auto") > mk("manual");
      })()`);
      await page.close();
      expect(await run("english", doc("en", "auto"))).toHaveLength(canHyphenate ? 0 : 1);
    } finally {
      await browser.close();
      await fsp.rm(dir, { recursive: true, force: true });
    }
  },
  RENDER_TEST_TIMEOUT_MS,
);
