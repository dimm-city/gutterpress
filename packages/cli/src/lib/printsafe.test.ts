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
