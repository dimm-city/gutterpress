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
 * Content too wide for the page is a hard error (#163), because Chromium would
 * otherwise scale the WHOLE document down silently. Both views offer "build
 * anyway" on it, so the error carries what they need as data: the `TOO_WIDE`
 * code, the offending elements, and the shrink scale (none for a box pulled
 * off the left edge, which clips rather than shrinks). Neither view reads the
 * message (ADR 0012); `explainBuildFailure` words it.
 *
 * The input is a real `build()` against a real Chromium, so the data is what
 * the engine really measures.
 */

const RENDER_TEST_TIMEOUT_MS = 90_000;
const doc = (css: string, body: string) => `<!doctype html><meta charset="utf-8"><style>
${MARKER_CSS}
${GUTTERPRESS_CSS}
@page { size: 384px 480px; margin: 24px; }
body { font: 12px/1.4 serif; }
${css}
</style>
<div class="page">
  <p>Ordinary page text.</p>
  ${body}
</div>`;

// Right-edge overflow: 900px boxes against a 336px content box. Four of them,
// because the views name the first three and count the rest.
const overWide = doc(
  `.wide { width: 900px; height: 40px; background: #cde; }`,
  `<div class="wide bare-art">escapes</div>
   <div class="wide second-art">escapes</div>
   <div class="wide third-art">escapes</div>
   <div class="wide fourth-art">escapes</div>`,
);

// Left-edge protrusion with an ordinary width: nothing crosses the RIGHT edge,
// so `shrinkScale` has no scale to report.
const pulledLeft = doc(
  `.pull { width: 200px; height: 40px; margin-left: -260px; background: #cde; }`,
  `<div class="pull left-art">pulled</div>`,
);

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;
if (!chromium) {
  // eslint-disable-next-line no-console
  console.warn(
    "[build.over-wide-message.test] No Chromium resolved — skipping. Install Chrome/Chromium or set CHROMIUM_PATH to run it.",
  );
}

type OverWideError = Error & { code?: string; offenders?: string[]; scale?: number | null };

/** Build `html` and return the hard error it must throw. */
const buildAndCatchError = async (name: string, html: string): Promise<OverWideError> => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), `gp-over-wide-${name}-`));
  const browser = await launchChromium();
  try {
    const file = path.join(dir, "book.html");
    await fsp.writeFile(file, html, "utf8");
    const err = await build({ input: pathToFileURL(file).href, browser, dpiFloor: 0 }).then(
      () => null,
      (e: Error) => e,
    );
    expect(err).not.toBeNull();
    return err!;
  } finally {
    await browser.close();
    await fsp.rm(dir, { recursive: true, force: true });
  }
};

testIf(
  "the thrown error carries its code, offenders and scale, so the publish run never reads the prose",
  async () => {
    const wide = await buildAndCatchError("wide-code", overWide);
    expect(wide.code).toBe("TOO_WIDE");
    expect(wide.offenders).toEqual([
      "div.wide.bare-art",
      "div.wide.second-art",
      "div.wide.third-art",
      "div.wide.fourth-art",
    ]);
    expect(wide.scale?.toFixed(2)).toBe("0.67");

    const pulled = await buildAndCatchError("pulled-code", pulledLeft);
    expect(pulled.code).toBe("TOO_WIDE");
    expect(pulled.offenders).toEqual(["div.pull.left-art"]);
    expect(pulled.scale).toBeNull();
  },
  RENDER_TEST_TIMEOUT_MS * 2,
);
