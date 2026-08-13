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
 * Build-time layer containment must inspect the live ancestor chain. A source
 * lint cannot know that `.chapter-shell` or any other downstream class wraps a
 * `.gp-behind`; computed DOM can, without a book-class allowlist.
 *
 * The fixture proves all three contracts in one Chromium build:
 *   - arbitrary stacking and clipping ancestors are diagnosed;
 *   - a safe wrapper is not;
 *   - output is capped at 20 findings even for pathological generated markup.
 */

const RENDER_TEST_TIMEOUT_MS = 90_000;
const SVG = encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#36c"/></svg>',
);
const SRC = `data:image/svg+xml,${SVG}`;
const image = (className: string) =>
  `<img class="gp-pin gp-behind ${className}" src="${SRC}" alt="background plate">`;
const overflowTraps = Array.from(
  { length: 22 },
  (_, i) => `<div class="generated-trap-${i}" style="isolation:isolate">${image(`generated-${i}`)}</div>`,
).join("\n");

const fixture = `<!doctype html><meta charset="utf-8"><style>
${MARKER_CSS}
${GUTTERPRESS_CSS}
@page { size: 384px 480px; margin: 24px; }
.page { min-height: 200px; }
</style>
<div class="page">
  <div class="chapter-shell" style="isolation:isolate">${image("stacked-art")}</div>
  <div class="crop-shell" style="overflow:hidden">${image("clipped-art")}</div>
  <div class="safe-shell">${image("safe-art")}</div>
  ${overflowTraps}
  <p>Visible page text keeps the wrapper in layout.</p>
</div>`;

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;
if (!chromium) {
  // eslint-disable-next-line no-console
  console.warn(
    "[build.layer-trapped.test] No Chromium resolved — skipping. Install Chrome/Chromium or set CHROMIUM_PATH to run it.",
  );
}

testIf(
  "live DOM audit reports arbitrary trapped ancestors, ignores safe wrappers, and caps findings",
  async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "gp-layer-trapped-"));
    const browser = await launchChromium();
    try {
      const file = path.join(dir, "book.html");
      await fsp.writeFile(file, fixture, "utf8");
      const result = await build({ input: pathToFileURL(file).href, browser, dpiFloor: 0 });
      const findings = result.diagnostics.filter((d) => d.code === "engine.layer.trapped");

      expect(findings).toHaveLength(20);
      expect(findings.every((d) => d.severity === "warning")).toBe(true);
      expect(findings.some((d) => d.message.includes("chapter-shell") && d.message.includes("stacking context"))).toBe(true);
      expect(findings.some((d) => d.message.includes("crop-shell") && d.message.includes("clips descendants"))).toBe(true);
      expect(findings.some((d) => d.message.includes("safe-shell"))).toBe(false);
      expect(findings.some((d) => d.message.includes("safe-art"))).toBe(false);
    } finally {
      await browser.close();
      await fsp.rm(dir, { recursive: true, force: true });
    }
  },
  RENDER_TEST_TIMEOUT_MS,
);
