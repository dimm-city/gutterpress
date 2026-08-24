import { test, expect } from "bun:test";
import { checkCss, ruleRiskyProps, rulePageContainment } from "./printsafe";

// MIGRATION.md Step 1 "Scope filter:" — filter: is measured to rasterize its
// subtree to a 300 DPI bitmap and dominate build time (~90%; 57.0s -> 6.2s
// over 60pp when scoped, ENGINE.md §10). The warning must fire and must carry
// those measured consequences, not just the generic risky-property message.
test("checkCss warns on filter: with the measured rasterization/build-time message", () => {
  const css = `.card { filter: drop-shadow(0 0 4px #000); }`;
  const warnings = checkCss(css);
  const filterWarnings = warnings.filter((w) => w.rule === ruleRiskyProps);
  expect(filterWarnings.length).toBe(1);
  expect(filterWarnings[0]!.severity).toBe("warning");
  expect(filterWarnings[0]!.message).toContain("300 DPI bitmap");
  expect(filterWarnings[0]!.message).toContain("57.0s -> 6.2s");
});

test("checkCss stays silent on filter: when the CSS has no filter declarations", () => {
  const css = `.card { color: red; box-shadow: 0 0 4px #000; }`;
  const warnings = checkCss(css);
  expect(warnings.filter((w) => w.rule === ruleRiskyProps)).toHaveLength(0);
});

// Chromium silently ignores transform/box-shadow inside @page margin boxes
// (renders square, unshadowed) though they're valid per CSS Paged Media.
test("checkCss warns once on transform: inside an @page margin box", () => {
  const css = `@page { @bottom-left { content: "x"; transform: rotate(5deg); } }`;
  const warnings = checkCss(css);
  const marginBoxWarnings = warnings.filter((w) => w.rule === ruleRiskyProps);
  expect(marginBoxWarnings.length).toBe(1);
  expect(marginBoxWarnings[0]!.message).toContain(
    "not supported in Chromium @page margin boxes and is silently ignored",
  );
});

test("checkCss does not flag transform: outside an @page margin box", () => {
  const css = `.card { transform: rotate(5deg); }`;
  const warnings = checkCss(css);
  expect(warnings.filter((w) => w.rule === ruleRiskyProps)).toHaveLength(0);
});

// A margin box is sized by its margin AREA: `width: fit-content` collapses
// only the inline axis, so a chip stays stretched to the full band height and
// paints as a tall rectangle around its text. This shipped in a real book's
// folio (reported against 0.10.0-alpha.1) — the author wrote the Paged.js-era
// `align-self: end`, which does nothing under native.
test("checkCss warns on width: fit-content with no block-axis size in a margin box", () => {
  const css = `@page { @bottom-left { content: "P." counter(page); width: fit-content; align-self: end; } }`;
  const warnings = checkCss(css).filter((w) => w.rule === ruleRiskyProps);
  expect(warnings.length).toBe(1);
  expect(warnings[0]!.message).toContain("collapses only the inline axis");
});

test("checkCss accepts fit-content width once a block-axis size is present", () => {
  for (const h of ["height: fit-content", "block-size: fit-content", "height: 1.4em"]) {
    const css = `@page { @bottom-left { content: "x"; width: fit-content; ${h}; } }`;
    expect(checkCss(css).filter((w) => w.rule === ruleRiskyProps)).toHaveLength(0);
  }
});

// A layered/gradient background means the author paints the chip themselves
// and leaves the box full-height on purpose (so its last layer keeps a
// patterned margin band continuous) — the opposite of the defect.
test("checkCss does not flag a full-height margin box that paints its own chip", () => {
  const css = `@page { @bottom-left {
    content: "P." counter(page); width: fit-content; padding: 0 13px 0 9px;
    background: linear-gradient(#eee,#eee) no-repeat 0 center / calc(100% - 4px) 0.22in,
                url("brick.png") repeat;
  } }`;
  expect(checkCss(css).filter((w) => w.rule === ruleRiskyProps)).toHaveLength(0);
});

test("checkCss does not flag fit-content width outside an @page margin box", () => {
  const css = `.chip { width: fit-content; }`;
  expect(checkCss(css).filter((w) => w.rule === ruleRiskyProps)).toHaveLength(0);
});

// `.page` / `.spread` are the containing blocks core creates for pinned and
// full-bleed content, so what a book declares on them decides whether those
// classes work. Both failure modes are silent and look nothing like their
// cause — a clipped .gp-bleed plate cost a multi-hour bisection to find.
test("checkCss warns when a page wrapper clips its descendants", () => {
  const css = `.page { overflow-x: clip; }`;
  const w = checkCss(css).filter((x) => x.rule === rulePageContainment);
  expect(w.length).toBe(1);
  expect(w[0]!.message).toContain("clips out-of-flow descendants");
});

test("checkCss warns when a page wrapper becomes a stacking context", () => {
  for (const d of ["z-index: 1", "isolation: isolate", "opacity: 0.9", "transform: translateZ(0)"]) {
    const w = checkCss(`.spread { ${d}; }`).filter((x) => x.rule === rulePageContainment);
    expect(w.length).toBe(1);
    expect(w[0]!.message).toContain("stacking context");
    expect(w[0]!.message).toContain("source-only");
    expect(w[0]!.message).toContain("engine.layer.trapped");
  }
});

test("page-containment stays a narrow source hint; live wrapper chains belong to the engine audit", () => {
  const css = `.book-defined-wrapper { isolation: isolate; overflow: hidden; }`;
  expect(checkCss(css).filter((x) => x.rule === rulePageContainment)).toHaveLength(0);
});

test("checkCss accepts the values core itself relies on", () => {
  const css = `.page, .spread { position: relative; z-index: auto; overflow: visible; }`;
  expect(checkCss(css).filter((x) => x.rule === rulePageContainment)).toHaveLength(0);
});

// `.page-credits` is a different class; flagging it would make the rule noise.
test("checkCss does not flag classes that merely start with page/spread", () => {
  const css = `.page-credits { overflow: hidden; z-index: 2; } .spread-wide { overflow: clip; }`;
  expect(checkCss(css).filter((x) => x.rule === rulePageContainment)).toHaveLength(0);
});

// A scoped exception is the documented fix, so it must not warn — a rule
// that fires on its own recommended remedy teaches people to ignore it.
test("checkCss accepts a :has()-scoped clip exception", () => {
  const css = `.page:not(:has(.gp-bleed, .gp-pin)) { overflow-x: clip; }`;
  expect(checkCss(css).filter((x) => x.rule === rulePageContainment)).toHaveLength(0);
});

// --- Chromium print gaps that fail silently (docs/known-limitations.md) ----

// §1 / #149. Measured Chrome 151.0.7922.75, 96dpi raster, mean absolute pixel
// difference against the same page with the declaration removed: a solid
// colour on @page paints the sheet (129.0673) while linear (0.0000), radial
// (0.0000) and repeating (0.0000) gradients paint NOTHING. There is no error
// and the PDF looks valid, so the author only finds out in print.
test("checkCss warns on a gradient in @page { background }", () => {
  for (const g of [
    "linear-gradient(45deg, #c00, #00c)",
    "radial-gradient(circle, #c00, #00c)",
    "repeating-linear-gradient(45deg, #c00 0 10px, #00c 10px 20px)",
  ]) {
    const w = checkCss(`@page { size: 6in 9in; background: ${g}; }`).filter(
      (x) => x.rule === ruleRiskyProps,
    );
    expect(w.length).toBe(1);
    expect(w[0]!.message).toContain("paints nothing");
  }
});

test("checkCss warns on a gradient in @page { background-image }", () => {
  const w = checkCss(`@page { background-image: linear-gradient(#c00, #00c); }`).filter(
    (x) => x.rule === ruleRiskyProps,
  );
  expect(w.length).toBe(1);
});

// SCOPE. The same gradient renders on `html` (127.1714) and as a margin box
// background (11.1627) — both measured on the same Chrome. Warning there
// would send authors away from the two places that actually work.
test("checkCss does not flag a gradient anywhere a gradient paints", () => {
  const css = `
    html { background: linear-gradient(45deg, #c00, #00c); }
    @page { @top-center { content: "x"; background: linear-gradient(#c00, #00c); } }
    @page { background: #2d6cdf; }
    .cover { background-image: radial-gradient(#c00, #00c); }
  `;
  expect(checkCss(css).filter((x) => x.rule === ruleRiskyProps)).toHaveLength(0);
});

// §2 / #150. The margin-box drop list is broader than transform/box-shadow:
// opacity, outline (shorthand and longhands), filter and mix-blend-mode all
// measured 0.0000 on the same box where text-shadow (0.1375), border-radius
// (0.3397) and a background gradient (11.2260) are honoured.
test("checkCss warns on every property a margin box silently drops", () => {
  for (const d of [
    "opacity: 0.5",
    "outline: 6px solid #c00",
    "outline-color: #c00",
    "filter: blur(3px)",
    "mix-blend-mode: multiply",
    "backdrop-filter: invert(1)",
    "clip-path: inset(0 40% 0 0)",
    "perspective: 40px",
    "rotate: -12deg",
  ]) {
    const w = checkCss(`@page { @bottom-center { content: "x"; ${d}; } }`).filter(
      (x) => x.rule === ruleRiskyProps,
    );
    expect(w.length).toBe(1);
    expect(w[0]!.message).toContain("silently ignored");
  }
});

// The generic risky-props message ("rasterizes its subtree to a 300 DPI
// bitmap") describes what filter: does in the page CONTENT. In a margin box
// nothing is rasterized because nothing paints at all — the author must be
// told the declaration is dropped, not that it is expensive.
test("filter: in a margin box reports the drop, not the rasterization cost", () => {
  const w = checkCss(`@page { @top-left { content: "x"; filter: blur(2px); } }`).filter(
    (x) => x.rule === ruleRiskyProps,
  );
  expect(w.length).toBe(1);
  expect(w[0]!.message).toContain("silently ignored");
  expect(w[0]!.message).not.toContain("300 DPI bitmap");
});

test("checkCss does not flag the properties a margin box honours", () => {
  const css = `@page { @bottom-right {
    content: "x"; text-shadow: 3px 3px 0 #c00; border-radius: 12px;
    writing-mode: vertical-rl; padding-left: 10px; border: 2px solid #333;
    font-size: 9pt; color: #036; letter-spacing: 2px; text-transform: uppercase;
    visibility: hidden;
  } }`;
  expect(checkCss(css).filter((x) => x.rule === ruleRiskyProps)).toHaveLength(0);
});
