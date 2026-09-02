import { describe, test, expect } from "bun:test";
import { GUTTERPRESS_CSS, GP_CLASSES } from "./gutterpress-css.ts";
import { MARKER_CSS } from "./markers.js";

/**
 * #226: `GP_CLASSES` (gp-pin-scope.js's `unknown_gp_class` vocabulary) must
 * never drift from the actual `.gp-*` selectors the two core CSS blocks
 * define. A class added to the CSS but forgotten here would silently defeat
 * the unknown-class warning for every author who later mistypes it; a class
 * removed from the CSS but left here would suggest a dead name as a
 * "did you mean".
 */

/** Every literal `.gp-...` class SELECTOR in `css`, comments stripped. Finds
 * a class embedded in a compound/prefixed selector (`img.gp-shape`,
 * `:where(.gp-behind)`) the same way as a standalone `.gp-shape` rule. */
function selectorClasses(css: string): Set<string> {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return new Set([...stripped.matchAll(/\.(gp-[a-z0-9-]+)\b/g)].map((m) => m[1]!));
}

// Real author-facing vocabulary with no CSS rule of its own (see the
// GP_CLASSES doc comment) — legitimately absent from the CSS text, so
// excluded from the "every GP_CLASSES entry has a rule" direction below.
const MARKER_ONLY_NO_CSS_RULE = new Set(["gp-continued", "gp-flush"]);

describe("GP_CLASSES agrees with the CSS it describes", () => {
  const fromCss = new Set([
    ...selectorClasses(GUTTERPRESS_CSS),
    ...selectorClasses(MARKER_CSS),
  ]);

  test("every .gp-* selector in the CSS text is known to GP_CLASSES", () => {
    const missing = [...fromCss].filter((c) => !GP_CLASSES.has(c));
    expect(missing).toEqual([]);
  });

  test("every GP_CLASSES entry other than the marker-only exceptions has a real CSS rule", () => {
    const orphaned = [...GP_CLASSES].filter(
      (c) => !MARKER_ONLY_NO_CSS_RULE.has(c) && !fromCss.has(c)
    );
    expect(orphaned).toEqual([]);
  });

  test("the marker-only exceptions really are absent from the CSS text (else the exception is stale)", () => {
    for (const c of MARKER_ONLY_NO_CSS_RULE) {
      expect(fromCss.has(c)).toBe(false);
      expect(GP_CLASSES.has(c)).toBe(true);
    }
  });
});
