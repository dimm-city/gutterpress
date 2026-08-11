import { test, expect } from "bun:test";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { resolveChromiumExecutable } from "../../lib/chromium.ts";
import { launchChromium } from "../shared/cdp.ts";
import { build } from "./build.ts";
import { PAGED_CSS } from "../../lib/markdown/markdown-it-paged.js";

/**
 * The engine.abspos.leak audit's class exclusion. Historically the scan
 * skipped ANY element with a `gp-*` class — written when gp-* classes were
 * engine-internal DOM. `.gp-pin` (PAGED_CSS) made `gp-` author-facing
 * vocabulary that is abspos BY DESIGN, so the exclusion was narrowed to the
 * engine's own print-document class (`gp-recto-spacer`) + `__gp` classes.
 *
 * Two things must both stay true:
 *   1. a leaked author `.gp-pin` (no positioned ancestor) IS diagnosed —
 *      this is the raw-HTML backstop behind the markdown-level
 *      `pin_outside_page` warning, which cannot see `<img>` tags in
 *      html_block content;
 *   2. the engine's own abspos instrumentation is still excluded, so every
 *      build doesn't warn about the engine's furniture.
 *
 * A contained `.gp-pin` (inside `.page`, which PAGED_CSS makes
 * `position: relative`) must stay silent — that is the supported idiom.
 */

const RENDER_TEST_TIMEOUT_MS = 90_000;

const SVG = encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><rect width="100" height="100" fill="#36c"/></svg>'
);
const SRC = `data:image/svg+xml,${SVG}`;

const fixture = `<!doctype html><meta charset="utf-8"><style>
${PAGED_CSS}
@page { size: 384px 480px; margin: 24px; }
</style>
<div class="page">
  <h1>Contained</h1>
  <p><img class="gp-pin gp-bottom" src="${SRC}" alt="contained pin"></p>
</div>
<p>Raw flow after the page wrapper.</p>
<p><img class="gp-pin" src="${SRC}" alt="leaked pin"></p>
<div class="gp-recto-spacer" style="position: absolute; width: 10px; height: 10px;"></div>
<div class="__gp-probe" style="position: absolute; width: 10px; height: 10px;"></div>`;

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;
if (!chromium) {
  // eslint-disable-next-line no-console
  console.warn(
    "[build.abspos-leak.test] No Chromium resolved — skipping. Install Chrome/Chromium or set CHROMIUM_PATH to run it."
  );
}

testIf(
  "a leaked author .gp-pin is diagnosed; engine-internal abspos and contained pins are not",
  async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "gp-absposleak-"));
    const browser = await launchChromium();
    try {
      const file = path.join(dir, "book.html");
      await fsp.writeFile(file, fixture, "utf8");
      const result = await build({ input: pathToFileURL(file).href, browser });

      const leaks = result.diagnostics.filter((d) => d.code === "engine.abspos.leak");
      // Exactly the one leaked pin: not the contained one (its offsetParent
      // is the positioned .page), not gp-recto-spacer, not __gp-probe.
      expect(leaks).toHaveLength(1);
      expect(leaks[0]!.message).toContain("gp-pin");
      expect(leaks[0]!.message).not.toContain("gp-bottom");
    } finally {
      await browser.close();
      await fsp.rm(dir, { recursive: true, force: true });
    }
  },
  RENDER_TEST_TIMEOUT_MS
);
