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
 * The fixture proves the audit's contracts in one Chromium build (each backed
 * by print-raster measurement — see the pass comment in build.ts):
 *   - a stacking-context ancestor is diagnosed (branch unchanged);
 *   - a clipping ancestor is diagnosed ONLY where the art overhangs its clip
 *     box on a clipped axis: within-bounds art under `.page { overflow-x:
 *     clip }` (a real book's declaration, the false positive that motivated
 *     the refinement) stays silent, an overhang on the clipped axis warns
 *     with the cut geometry, an overhang on a `visible` axis stays silent;
 *   - a STATIC wrapper's overflow never binds an abspos pin (the pin escapes
 *     its clip entirely), so it stays silent too;
 *   - a safe wrapper is not diagnosed;
 *   - output is capped at 20 findings even for pathological generated markup.
 *
 * A second, smaller build covers the two BINDING rules this audit only started
 * applying when the clip geometry became shared with the pre-print width check
 * (`CLIP_EDGES_JS`): `position: fixed`, and root overflow propagation.
 */

const RENDER_TEST_TIMEOUT_MS = 90_000;
const SVG = encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#36c"/></svg>',
);
const SRC = `data:image/svg+xml,${SVG}`;
const image = (className: string, style = "") =>
  `<img class="gp-pin gp-behind ${className}" src="${SRC}" alt="background plate"${style ? ` style="${style}"` : ""}>`;
const overflowTraps = Array.from(
  { length: 22 },
  (_, i) => `<div class="generated-trap-${i}" style="isolation:isolate">${image(`generated-${i}`)}</div>`,
).join("\n");

// Geometry the assertions depend on: the 40x40 pin in crop-shell's 120x24
// padding box lands flush to the top (Chromium clamps an overflowing abspos
// center alignment to the start edge), so it overhangs the bottom clip edge
// by 40-24 = 16px; bleed-x-art's start-justified pin with margin-left:-30px
// puts its border box 30px past .page's left clip edge; offaxis-art overhangs
// .page's BOTTOM by 30px, but .page clips only overflow-x, so that axis is
// visible and must stay silent.
const fixture = `<!doctype html><meta charset="utf-8"><style>
${MARKER_CSS}
${GUTTERPRESS_CSS}
@page { size: 384px 480px; margin: 24px; }
.page { min-height: 200px; overflow-x: clip; }
</style>
<div class="page">
  <div class="chapter-shell" style="isolation:isolate">${image("stacked-art")}</div>
  <div class="crop-shell" style="position:relative;overflow:hidden;width:120px;height:24px">${image("cut-art")}</div>
  ${image("gp-left bleed-x-art", "margin-left:-30px")}
  ${image("gp-bottom offaxis-art", "margin-bottom:-30px")}
  <div class="skip-shell" style="overflow:hidden;width:80px;height:40px">${image("escaped-art")}</div>
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
  "live DOM audit reports stacking ancestors and real clip cuts, ignores harmless containment, and caps findings",
  async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "gp-layer-trapped-"));
    const browser = await launchChromium();
    try {
      const file = path.join(dir, "book.html");
      await fsp.writeFile(file, fixture, "utf8");
      // allowShrink: bleed-x-art deliberately extends past the page content
      // box, which the pre-print width gate would otherwise turn into a
      // build error before this audit's diagnostics are reachable.
      const result = await build({
        input: pathToFileURL(file).href,
        browser,
        dpiFloor: 0,
        allowShrink: true,
      });
      const findings = result.diagnostics.filter((d) => d.code === "engine.layer.trapped");

      expect(findings).toHaveLength(20);
      expect(findings.every((d) => d.severity === "warning")).toBe(true);
      // stacking-context branch: unchanged.
      expect(findings.some((d) => d.message.includes("chapter-shell") && d.message.includes("stacking context"))).toBe(true);
      // clipping branch: a real cut warns with its measured geometry.
      expect(
        findings.some(
          (d) =>
            d.message.includes("crop-shell") &&
            d.message.includes("clips it") &&
            d.message.includes("16px past its bottom clip edge"),
        ),
      ).toBe(true);
      // .page is reported exactly once — for the art that overhangs its
      // clipped axis — never for the within-bounds pins under the same
      // `.page { overflow-x: clip }` (the false positive this refinement
      // removes).
      const pageFindings = findings.filter((d) => d.message.includes("div.page"));
      expect(pageFindings).toHaveLength(1);
      expect(pageFindings[0]!.message).toContain("bleed-x-art");
      expect(pageFindings[0]!.message).toContain("30px past its left clip edge");
      // per-axis: a bottom overhang under overflow-x-only clipping is on a
      // `visible` axis and never cut.
      expect(findings.some((d) => d.message.includes("offaxis-art"))).toBe(false);
      // an abspos pin escapes a STATIC wrapper's clip entirely.
      expect(findings.some((d) => d.message.includes("skip-shell") || d.message.includes("escaped-art"))).toBe(false);
      expect(findings.some((d) => d.message.includes("safe-shell"))).toBe(false);
      expect(findings.some((d) => d.message.includes("safe-art"))).toBe(false);
    } finally {
      await browser.close();
      await fsp.rm(dir, { recursive: true, force: true });
    }
  },
  RENDER_TEST_TIMEOUT_MS,
);

// Both cases here are BINDING rules — which ancestors clip at all — and both
// were already settled by the pre-print width check's measured evidence. The
// audit reached them only once the two copies of the clip geometry became one
// (`CLIP_EDGES_JS`); before that it reported a cut in each.
//
//   FIXED — a fixed box's containing block is the viewport, so a merely
//     positioned ancestor does not clip it. `.page` is `position: relative` in
//     MARKER_CSS, so a clipping `.page` used to be reported as cutting every
//     fixed `.gp-behind` inside it.
//   ROOT PROPAGATION — `html` propagates its overflow to the viewport instead
//     of clipping its own content, so it never cuts; `body` clips only when
//     the root's own overflow is not `visible` (with both hidden, as here, the
//     clip is really body's). The audit is normally spared this by stopping at
//     the `.page`/`.spread` boundary — but a `.gp-behind` that IS that
//     boundary walks straight past it to the root.
const bindingFixture = `<!doctype html><meta charset="utf-8"><style>
${MARKER_CSS}
${GUTTERPRESS_CSS}
@page { size: 384px 480px; margin: 24px; }
html, body { overflow: hidden; }
.page { min-height: 200px; overflow: hidden; }
.page.gp-behind { overflow: visible; }
.fixed-art { position: fixed; left: -40px; top: -30px; }
</style>
<div class="page">
  <img class="gp-behind fixed-art" src="${SRC}" alt="background plate">
  <p>Visible page text keeps the wrapper in layout.</p>
</div>
<div class="page gp-behind self-boundary-art" style="margin-left:-40px">
  <p>More page text.</p>
</div>`;

testIf(
  "clip binding: a fixed box is unclippable, and the root propagates instead of cutting",
  async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "gp-layer-binding-"));
    const browser = await launchChromium();
    try {
      const file = path.join(dir, "book.html");
      await fsp.writeFile(file, bindingFixture, "utf8");
      const result = await build({
        input: pathToFileURL(file).href,
        browser,
        dpiFloor: 0,
        allowShrink: true,
      });
      const findings = result.diagnostics.filter((d) => d.code === "engine.layer.trapped");
      // The clipping `.page` is `position: relative`, not the fixed box's
      // containing block — it cannot cut it, so nothing is reported.
      expect(findings.some((d) => d.message.includes("fixed-art"))).toBe(false);
      // `html` never cuts; `body` does, and is named.
      const self = findings.filter((d) => d.message.includes("self-boundary-art"));
      expect(self).toHaveLength(1);
      expect(self[0]!.message).toContain("ancestor body clips it");
      expect(self[0]!.message).toContain("40px past its left clip edge");
    } finally {
      await browser.close();
      await fsp.rm(dir, { recursive: true, force: true });
    }
  },
  RENDER_TEST_TIMEOUT_MS,
);
