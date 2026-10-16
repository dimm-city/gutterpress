import { expect, test } from "bun:test";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { resolveChromiumExecutable } from "../../lib/chromium.ts";
import { launchChromium } from "../shared/cdp.ts";
import { build } from "./build.ts";

/**
 * `engine.multicol.dead-column` is for a balanced multicol container that runs
 * over more than one page. Column properties only make a BLOCK container
 * multicol: a grid that also carries `column-count` (a stylesheet can set
 * `display: grid` on an `@columns` block) lays out no columns, so it must not
 * be reported.
 */

const RENDER_TEST_TIMEOUT_MS = 90_000;
const fixture = `<!doctype html><meta charset="utf-8"><style>
@page { size: 384px 240px; margin: 24px; }
body { margin: 0; }
.cols { column-count: 2; }
.grid { column-count: 2; display: grid; }
.cols > div, .grid > div { height: 120px; }
</style>
<div class="cols">${"<div></div>".repeat(8)}</div>
<div class="grid">${"<div></div>".repeat(8)}</div>`;

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;
if (!chromium) {
  // eslint-disable-next-line no-console
  console.warn(
    "[build.multicol-dead-column.test] No Chromium resolved — skipping. Install Chrome/Chromium or set CHROMIUM_PATH to run it.",
  );
}

testIf(
  "dead-column reports a fragmenting multicol block and not a grid carrying column-count",
  async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "gp-multicol-dead-column-"));
    const browser = await launchChromium();
    try {
      const file = path.join(dir, "book.html");
      await fsp.writeFile(file, fixture, "utf8");
      const result = await build({ input: pathToFileURL(file).href, browser, dpiFloor: 0 });
      const findings = result.diagnostics.filter((d) => d.code === "engine.multicol.dead-column");

      expect(findings).toHaveLength(1);
      expect(findings[0]!.message).toContain(".cols");
    } finally {
      await browser.close();
      await fsp.rm(dir, { recursive: true, force: true });
    }
  },
  RENDER_TEST_TIMEOUT_MS,
);
