import { test, expect } from "bun:test";
import { checkCss, rulePagedjsCrashSelectors, ruleRiskyProps } from "./printsafe";

// Regression: splitSelectorList must not mis-parse an EVEN number of trailing
// backslashes before a closing quote. With `\\"` the quote is NOT escaped (the
// pair of backslashes is itself an escaped backslash), so the attribute string
// closes and the top-level comma after it splits the selector list. The second
// selector (a Paged.js crash-prone pattern) must still be detected.
test("checkCss flags the second selector even when the first ends in escaped backslash + quote", () => {
  const css = `a[data-x="v\\\\"], h1:first-of-type + p { color: red }`;
  const warnings = checkCss(css);
  const crash = warnings.filter((w) => w.rule === rulePagedjsCrashSelectors);
  expect(crash.length).toBe(1);
  // The flagged selector must be the clean SECOND selector only — not the
  // merged list that still carries the first attribute selector. With the bug
  // the two selectors merge, so the crash message contains `a[data-x=` too.
  expect(crash[0]!.message).toContain("h1:first-of-type + p");
  expect(crash[0]!.message).not.toContain("a[data-x=");
});

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
