import { describe, expect, test } from "bun:test";
import { createMarkdownRenderer, BUILTIN_OPTIONAL_PLUGINS } from "./renderer";
import { findInlineMathEnd } from "./math";
import { GUTTERPRESS_CSS } from "./gutterpress-css";

interface Env {
  layoutWarnings?: Array<{ line: number; type: string; message: string }>;
}

function withMath() {
  return createMarkdownRenderer([
    { name: "gutterpress-math", plugin: BUILTIN_OPTIONAL_PLUGINS["gutterpress-math"]!, options: {} },
  ]);
}

/** The formulas as `<mjx-container …>`, the SVG inside elided. */
const containers = (html: string) =>
  [...html.matchAll(/<mjx-container[^>]*>/g)].map((m) => m[0]);

describe("gutterpress-math", () => {
  test("is off unless the book lists it", () => {
    const html = createMarkdownRenderer().render("Costs $x$ and $$y$$.\n", {});
    expect(html).toContain("Costs $x$ and $$y$$.");
    expect(html).not.toContain("mjx-container");
  });

  test("typesets inline and display math as SVG with no font or stylesheet to ship", () => {
    const html = withMath().render("Let $x \\in \\mathbb{R}$.\n\n$$\n\\frac{a}{b}\n\\tag{1}\n$$\n", {});
    const [inline, display] = containers(html);
    expect(inline).toContain('jax="SVG"');
    expect(inline).not.toContain("display=");
    expect(display).toContain('display="true"');
    expect(html).toContain("<svg");
    expect(html).toContain('data-mml-node="mfrac"');
    // The assistive MathML carries the formula for screen readers.
    expect(html).toContain("<mjx-assistive-mml");
  });

  test("a dollar sign is a dollar sign unless it opens a formula (Pandoc's rule)", () => {
    const md = withMath();
    const env: Env = {};
    const prose = "It costs $5 and $10, from $1,000 to $2,000, or $5/$10; $PATH is set.";
    expect(md.render(prose + "\n", env)).toContain(prose);
    expect(md.render("Pay $5 now, where $n$ is the count.\n", env)).toMatch(/\$5 now, where <mjx-container/);
    expect(md.render("An empty $$ pair, and \\$ escaped $x$.\n", env)).toMatch(/An empty \$\$ pair, and \$ escaped <mjx-container/);
    expect(env.layoutWarnings).toBeUndefined();
  });

  test("findInlineMathEnd is the one grammar: closing index, -1 for prose, -2 for an empty pair", () => {
    expect(findInlineMathEnd("a $x$ b", 2, 7)).toBe(4);
    expect(findInlineMathEnd("$5 and $10", 0, 10)).toBe(-1); // closer followed by a digit
    expect(findInlineMathEnd("$ x$", 0, 4)).toBe(-1); // opener followed by a space
    expect(findInlineMathEnd("$x $", 0, 4)).toBe(-1); // closer preceded by a space
    expect(findInlineMathEnd("$$", 0, 2)).toBe(-2);
    expect(findInlineMathEnd("$a\\$b$", 0, 6)).toBe(5); // escaped dollar inside
  });

  test("a formula MathJax cannot typeset prints in red and is reported with its line", () => {
    const md = withMath();
    const env: Env = {};
    const html = md.render("Intro.\n\nSee $\\frac{a}{b$ here.\n\n$$\n\\fraction{1}{2}\n$$\n", env);
    expect(html).toContain('data-mml-node="merror"');
    expect(env.layoutWarnings).toEqual([
      { line: 3, type: "math_error", message: expect.stringContaining("Missing close brace") },
      { line: 5, type: "math_error", message: expect.stringContaining("Undefined control sequence \\fraction") },
    ]);
  });

  test("a broken formula in a table cell is reported at its row's line", () => {
    const env: Env = {};
    withMath().render("Intro.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | $\\frac{a}{b$ |\n", env);
    expect(env.layoutWarnings).toEqual([
      { line: 6, type: "math_error", message: expect.stringContaining("Missing close brace") },
    ]);
  });

  test("\\newcommand lasts for one renderer, not the next", () => {
    const first = withMath();
    const env1: Env = {};
    first.render("$$\\newcommand{\\R}{\\mathbb{R}}$$\n\nIn $\\R$.\n", env1);
    expect(env1.layoutWarnings).toBeUndefined();
    const env2: Env = {};
    withMath().render("In $\\R$.\n", env2);
    expect(env2.layoutWarnings?.[0]?.message).toContain("Undefined control sequence \\R");
  });

  test("a | inside a formula does not split a table cell", () => {
    const env: Env = {};
    const html = withMath().render("| a | b |\n|---|---|\n| $\\lvert x \\rvert = |y|$ | $\\|z\\|$ |\n", env);
    expect(html.match(/<td/g)).toHaveLength(2);
    expect(html).toContain('stretchy="false">|</mo>'); // the bare | reached MathJax
    expect(html).toContain(">∥</mo>"); // and \| stayed LaTeX's norm bars
    expect(env.layoutWarnings).toBeUndefined();
  });

  test("core CSS carries MathJax's rules for its output", () => {
    expect(GUTTERPRESS_CSS).toContain('mjx-container[jax="SVG"][display="true"]');
    expect(GUTTERPRESS_CSS).toContain("mjx-assistive-mml {");
  });
});
