import { expect, test } from "bun:test";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { MARKER_CSS } from "../../lib/markdown/markers.js";
import { resolveChromiumExecutable } from "../../lib/chromium.ts";
import { launchChromium } from "../shared/cdp.ts";
import { build } from "./build.ts";

/**
 * `engine.pin.page-span` (#519): a `.gp-bottom` pin in a page root taller than
 * one sheet lands at the end of the text, so the build warns; one that fits a
 * sheet does not.
 */

const SVG = "pin.svg";
const prose = Array.from({ length: 40 }, () => `<p>Line of prose.</p>`).join("");
const fixture = `<!doctype html><meta charset="utf-8"><style>
${MARKER_CSS}
@page { size: 384px 240px; margin: 24px; }
body { margin: 0; }
p { margin: 0; font: 12px/1 monospace; }
</style>
<div class="page">${prose}<img class="gp-pin gp-bottom" alt="" src="${SVG}?long"></div>
<div class="page"><p>Short.</p><img class="gp-pin gp-bottom" alt="" src="${SVG}?short"></div>`;

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;

testIf(
  "a bottom pin warns only when its page root runs across more than one sheet",
  async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "gp-pin-span-"));
    const browser = await launchChromium();
    try {
      const file = path.join(dir, "book.html");
      await fsp.writeFile(file, fixture, "utf8");
      const result = await build({ input: pathToFileURL(file).href, browser, dpiFloor: 0 });
      const findings = result.diagnostics.filter((d) => d.code === "engine.pin.page-span");
      expect(findings).toHaveLength(1);
      expect(findings[0]!.message).toContain("?long");
      expect(findings[0]!.message).toMatch(/runs across \d+ pages/);
    } finally {
      await browser.close();
      await fsp.rm(dir, { recursive: true, force: true });
    }
  },
  90_000,
);
