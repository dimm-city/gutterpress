import { test, expect } from "bun:test";
import { checkCss, rulePagedjsCrashSelectors } from "./printsafe";

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
