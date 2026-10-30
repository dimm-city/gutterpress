/**
 * #470 — the scale a book prints at, read off its PDF.
 *
 * Chromium shrinks the WHOLE print to fit anything that reaches past the page
 * content box, by however little, and the preview never shrinks, so the two
 * lay the book out at different widths. Justified text with inline markup
 * reached 1/64 px per text item past the column on its own; the engine now
 * holds the body's overflow to the page content box, and reports any shrink
 * still left as a warning, read off the printed PDF (`printScale`).
 *
 * Self-skips when no Chromium is resolvable, like every real-Chromium test in
 * this package.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PDFDocument } from "pdf-lib";

import { resolveChromiumExecutable } from "../../lib/chromium.ts";
import { runBuild } from "../../lib/build-runner.ts";
import { GUTTERPRESS_CSS } from "../../lib/markdown/gutterpress-css.ts";
import { MARKER_CSS } from "../../lib/markdown/markers.js";
import { launchChromium, type Browser } from "../shared/cdp.ts";
import { printScale } from "../shared/pdf-inspect.ts";
import { build, type BuildDiagnostic } from "./build.ts";

const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../docs/fixtures/justified-text/book",
);
const TIMEOUT_MS = 90_000;

// A 336px page content box (384px sheet, 24px margins). `outside` goes
// after the `.page`, which is positioned (MARKER_CSS).
const doc = (css: string, body: string, outside = "") => `<!doctype html><meta charset="utf-8"><style>
${MARKER_CSS}
${GUTTERPRESS_CSS}
@page { size: 384px 480px; margin: 24px; }
body { font: 12px/1.4 serif; }
${css}
</style>
<div class="page">
  <p>Ordinary page text.</p>
  ${body}
</div>
${outside}`;

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;
if (!chromium) {
  // eslint-disable-next-line no-console
  console.warn(
    "[build.print-scale.test] No Chromium resolved — skipping. Install Chrome/Chromium or set CHROMIUM_PATH to run it.",
  );
}

let browser: Browser | undefined;
const dirs: string[] = [];
beforeAll(async () => {
  if (chromium) browser = await launchChromium();
});
afterAll(async () => {
  await browser?.close();
  for (const d of dirs.splice(0)) await fsp.rm(d, { recursive: true, force: true });
});

const buildDoc = async (html: string, allowShrink = false) => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "gp-print-scale-"));
  dirs.push(dir);
  const file = path.join(dir, "book.html");
  await fsp.writeFile(file, html, "utf8");
  return build({ input: pathToFileURL(file).href, browser, dpiFloor: 0, allowShrink });
};

const widthWarnings = (diagnostics: BuildDiagnostic[]) =>
  diagnostics.filter((d) => d.code === "engine.width.overflow").map((d) => d.message);

testIf(
  "justified text with inline markup prints at full size, with no width warning",
  async () => {
    // Before the root clip this book printed at 0.99992: its 384px column
    // laid out 384.03px wide, under the CI runner's fonts and a dev
    // container's alike.
    const outDir = await fsp.mkdtemp(path.join(os.tmpdir(), "gp-justified-"));
    dirs.push(outDir);
    const result = await runBuild({
      inputDir: FIXTURE,
      format: "pdf",
      outDir,
      skipLint: true,
      skipPreValidate: true,
      skipPostValidate: true,
      rawArgs: {},
    });
    const bytes = await fsp.readFile(result.pdfPath!);
    expect(printScale(await PDFDocument.load(bytes, { updateMetadata: false }))).toBe(1);
    expect(widthWarnings(result.diagnostics)).toEqual([]);
  },
  TIMEOUT_MS,
);

testIf(
  "an element 0.5px past the content box that still shrinks the print is a warning naming it",
  async () => {
    // Nothing positioned around it, so it is placed against the whole
    // document and the body's clip does not hold it: its overflow reaches
    // the page area and Chromium shrinks.
    const result = await buildDoc(
      doc(
        `.marker { position: absolute; left: 0; top: 0; width: 336.5px; height: 4px; background: #cde; }`,
        "",
        `<div class="marker"></div>`,
      ),
    );
    expect(result.post.scale).toBeCloseTo(336 / 336.5, 6);
    const warnings = widthWarnings(result.diagnostics);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("printed at 99.8514% of its declared size");
    expect(warnings[0]).toContain("about 0.50px past the 336px page content box");
    expect(warnings[1]).toBe(
      "div.marker reaches 0.50px past the 336px page content box. Keep it inside the page content box.",
    );
  },
  TIMEOUT_MS,
);

testIf(
  "an element 0.5px past the content box inside the body is clipped: full size, no warning",
  async () => {
    // Print already clips the page area at that edge, so holding the body's
    // overflow there cuts nothing that printed before — it only stops the
    // shrink.
    const result = await buildDoc(
      doc(`.wide { width: 336.5px; height: 4px; background: #cde; }`, `<div class="wide"></div>`),
    );
    expect(result.post.scale).toBe(1);
    expect(widthWarnings(result.diagnostics)).toEqual([]);
  },
  TIMEOUT_MS,
);

testIf(
  "with allowShrink an over-wide box still shrinks the print, and the warning states the printed scale",
  async () => {
    // The author accepted the shrink, so nothing is clipped: Chromium scales
    // to fit, down to its 1.5x clamp.
    const result = await buildDoc(
      doc(`.wide { width: 900px; height: 40px; background: #cde; }`, `<div class="wide art">wide</div>`),
      true,
    );
    expect(result.post.scale).toBeCloseTo(1 / 1.5, 5);
    const warnings = widthWarnings(result.diagnostics);
    expect(warnings).toContain(
      "div.wide.art is 900px wide, past the 336px page content box. Give it an explicit width that fits.",
    );
    expect(warnings.some((w) => w.startsWith("This book printed at 66.6667% of its declared size"))).toBe(
      true,
    );
  },
  TIMEOUT_MS,
);
