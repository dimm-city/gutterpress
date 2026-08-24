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
 * COUNTERPART: `packages/desktop/src/lib/errors.ts`'s `overWideExportMessage`.
 *
 * That function is the desktop export's "Build anyway" affordance (#163): it
 * recognizes the hard error thrown below, names the offenders, and states what
 * accepting the shrink costs. It cannot receive structured data — Electron IPC
 * flattens an `Error` to its message string — so it SCRAPES this prose. That
 * makes the emitted wording a wire contract owned by this package, and without
 * a test here a reword would break the affordance silently, degrading it back
 * to the generic error #163 removed.
 *
 * So this test pins the format at its source. The regexes below are a verbatim
 * mirror of the desktop parser's (duplicated, not imported — the CLI package
 * must not depend on the desktop package; same discipline as
 * `src/lib/markdown/source-range.test.ts`). The desktop package owns testing
 * the sentence it assembles from these captures; this test owns proving THIS
 * package still emits what they need.
 *
 * The input is generated the way `checks/source/merge-markers.test.ts`
 * generates its markers — from a real `build()` against a real Chromium, never
 * a hand-typed copy of the prose — so the pin cannot go stale against the
 * producer it is pinning.
 *
 * Both headline branches are covered, because the desktop guard accepts both
 * and a reword of either alone silently returns `null`:
 *   - RIGHT-edge overflow, which yields a measured shrink scale;
 *   - LEFT-edge protrusion, which clips rather than shrinks, so the engine has
 *     no scale to state and the desktop falls back to its generic cost phrase.
 */

// ── verbatim mirror of packages/desktop/src/lib/errors.ts ────────────────────
/** The desktop guard: returns `null` (generic error, no affordance) if unmatched. */
const HEADLINE = /content (?:wider than|outside) the page content box/;
/** Two-space indent, em dash, `Math.round`ed integer px, the words "content box". */
const OFFENDER_LINE = /^\s+(\S[^\n]*?)\s+—\s+\d+px\s*>\s*\d+px content box/gm;
/** The measured scale and its worked 12pt example, both shown to the author. */
const SCALE = /to about ([\d.]+)x its declared size \(([^)]*)\)/;
// ─────────────────────────────────────────────────────────────────────────────

/** What the desktop parser extracts from a raw engine error message. */
function parseAsDesktopDoes(raw: string) {
  if (!HEADLINE.test(raw)) return null;
  return {
    offenders: [...raw.matchAll(OFFENDER_LINE)].map((m) => m[1]!.trim()),
    scale: raw.match(SCALE),
  };
}

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
// because the desktop names the first three and counts the rest — a format
// that drops or merges offender lines would show the author the wrong count.
const overWide = doc(
  `.wide { width: 900px; height: 40px; background: #cde; }`,
  `<div class="wide bare-art">escapes</div>
   <div class="wide second-art">escapes</div>
   <div class="wide third-art">escapes</div>
   <div class="wide fourth-art">escapes</div>`,
);

// Left-edge protrusion with an ordinary width: nothing crosses the RIGHT edge,
// so `shrinkScale` has no scale to report and the headline takes its other form.
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

/** Build `html` and return the message of the hard error it must throw. */
const buildAndCatch = async (name: string, html: string): Promise<string> => {
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
    return err!.message;
  } finally {
    await browser.close();
    await fsp.rm(dir, { recursive: true, force: true });
  }
};

testIf(
  "right-edge overflow: the thrown message still yields offenders and a scale to the desktop parser",
  async () => {
    const raw = await buildAndCatch("wide", overWide);
    const parsed = parseAsDesktopDoes(raw);
    // A null here IS the #163 regression: the desktop falls back to a generic
    // error and the author never sees the "Build anyway" escape hatch.
    expect(parsed).not.toBeNull();
    expect(parsed!.offenders).toEqual([
      "div.wide.bare-art",
      "div.wide.second-art",
      "div.wide.third-art",
      "div.wide.fourth-art",
    ]);
    expect(parsed!.scale).not.toBeNull();
    // 336px content box / 900px box, clamped by MAX_SHRINK — the number the
    // author is shown, and its worked 12pt example.
    expect(parsed!.scale![1]).toBe("0.67");
    expect(parsed!.scale![2]).toBe("12pt type prints at 8.0pt");
    // The instruction the desktop replaces, and the reason it must: there is
    // no `allowShrink` for an author to pass in the app.
    expect(raw).toContain("pass allowShrink to build anyway");
  },
  RENDER_TEST_TIMEOUT_MS,
);

testIf(
  "left-edge protrusion: the other headline still parses, with no scale to state",
  async () => {
    const raw = await buildAndCatch("pulled", pulledLeft);
    const parsed = parseAsDesktopDoes(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.offenders).toEqual(["div.pull.left-art"]);
    // No scale: a box pulled off the LEFT edge clips rather than shrinks, so
    // the desktop must fall back to its generic cost phrase. If a reword ever
    // made this match, the author would be quoted a scale the engine never
    // measured.
    expect(parsed!.scale).toBeNull();
  },
  RENDER_TEST_TIMEOUT_MS,
);
