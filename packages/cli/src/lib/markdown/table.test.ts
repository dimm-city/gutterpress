import { describe, expect, test } from "bun:test";
import { createMarkdownRenderer } from "./renderer";
import { scanCodeSpan } from "./table";

interface Env {
  layoutWarnings?: Array<{ line: number; type: string; message: string }>;
}

const cells = (html: string) => [...html.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((m) => m[1]);

describe("table cells", () => {
  test("a | inside a code span stays in its cell", () => {
    const env: Env = {};
    const html = createMarkdownRenderer().render("| a | b |\n|---|---|\n| `x | y` | ``a|b`` |\n", env);
    expect(cells(html)).toEqual(["<code>x | y</code>", "<code>a|b</code>"]);
    expect(env.layoutWarnings).toBeUndefined();
  });

  test("\\| still escapes a pipe in plain text, and an unmatched backtick is just a backtick", () => {
    const html = createMarkdownRenderer().render("| a | b |\n|---|---|\n| x \\| y | a ` b |\n", {});
    expect(cells(html)).toEqual(["x | y", "a ` b"]);
  });

  test("without the math feature a $ opens nothing, so | between dollars still splits", () => {
    const env: Env = {};
    const html = createMarkdownRenderer().render("| a | b |\n|---|---|\n| $5 | $10 |\n", env);
    expect(cells(html)).toEqual(["$5", "$10"]);
    expect(env.layoutWarnings).toBeUndefined();
  });

  test("a row with more cells than the header is reported, not silently cut", () => {
    const env: Env = {};
    const html = createMarkdownRenderer().render("Text.\n\n| a | b |\n|---|---|\n| 1 | 2 | 3 | 4 |\n| 5 | 6 |\n", env);
    expect(cells(html)).toEqual(["1", "2", "5", "6"]);
    expect(env.layoutWarnings).toEqual([
      {
        line: 5,
        type: "table_extra_cells",
        message: expect.stringContaining("This row has 4 cells but the table has 2 columns, so its last 2 cells are left out"),
      },
    ]);
  });

  test("scanCodeSpan resumes after the span, or after an opening run that closes nothing", () => {
    expect(scanCodeSpan("`a|b` c", 0, 7)).toBe(5);
    expect(scanCodeSpan("``a`b`` c", 0, 9)).toBe(7);
    expect(scanCodeSpan("``a`b c", 0, 7)).toBe(2);
  });
});
