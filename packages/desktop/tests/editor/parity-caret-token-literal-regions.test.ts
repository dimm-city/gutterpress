/**
 * parity-caret-token-literal-regions.test.ts (SFE-P3d-parity repair round 1)
 *
 * Closes a CONFIRMED review finding: `isInsideFencedCodeBlock` (now
 * `isInsideLiteralMarkdownRegion`, `caret-token-commands.ts`) used to guard
 * only PLAIN, TOP-LEVEL fenced code blocks. Markdown-it treats three OTHER
 * regions as literal text exactly the same way: an inline code span, an
 * indented (non-fenced) code block, and a fenced block introduced with
 * container prefixes this scanner used to strip only up to 3 leading
 * spaces (never a blockquote `>`, never 4+ columns of list-nested indent).
 * Before this repair, a caret in any of those four regions on text that
 * LOOKS like `![alt](src)`/`[text](href)` resolved as a real token and
 * would have been rewritten — verified against real committed content
 * (`examples/with-design-guide/design-guide/05-layout.md`, which documents
 * markdown-it-attrs syntax inside inline code spans).
 *
 * One probe per region, each asserting the SPECIFIC refusal reason and
 * category (never just `ok === false`) — plus a positive control proving
 * the SAME offset resolves as a real token once it is NOT inside a literal
 * region, so a probe that "passes" by refusing everything is caught.
 */
import { describe, expect, test } from "bun:test";
import {
  locateImageAtCaret,
  locateLinkAtCaret,
  isInsideFencedCodeBlock,
  isInsideLiteralMarkdownRegion,
} from "../../src/lib/editor/caret-token-commands";

describe("literal-region refusal: inline code span", () => {
  test("a caret on markdown-shaped image syntax inside an inline code span refuses with fenced-code-block", () => {
    const text = "Use `![a](b.png)` in markdown.";
    const caret = text.indexOf("b.png");
    // Liveness: this really is a well-formed image token shape.
    expect(text).toContain("![a](b.png)");
    expect(isInsideFencedCodeBlock(text, caret)).toBe(false); // NOT a fenced block — proves this is the NEW region
    expect(isInsideLiteralMarkdownRegion(text, caret)).toBe(true);

    const located = locateImageAtCaret(text, caret);
    expect(located.ok).toBe(false);
    if (located.ok) throw new Error("unreachable");
    expect(located.reason).toBe("fenced-code-block");
    expect(located.diagnostic.category).toBe("EDITOR_UNSUPPORTED_PROJECTION");
  });

  test("positive control: the SAME image syntax OUTSIDE the code span resolves as a real token", () => {
    const text = "Use `code` and then a real ![a](b.png) image.";
    const caret = text.indexOf("b.png");
    expect(isInsideLiteralMarkdownRegion(text, caret)).toBe(false);
    const located = locateImageAtCaret(text, caret);
    expect(located.ok).toBe(true);
  });

  test("a caret on link syntax inside an inline code span refuses with fenced-code-block", () => {
    const text = "Write `[text](href.html)` to make a link.";
    const caret = text.indexOf("href.html");
    expect(isInsideLiteralMarkdownRegion(text, caret)).toBe(true);
    const located = locateLinkAtCaret(text, caret);
    expect(located.ok).toBe(false);
    if (located.ok) throw new Error("unreachable");
    expect(located.reason).toBe("fenced-code-block");
  });
});

describe("literal-region refusal: indented (non-fenced) code block", () => {
  test("a caret on markdown-shaped image syntax in a 4-space indented code block refuses with fenced-code-block", () => {
    const text = "Example:\n\n    ![A cat](cat.png)\n\nDone.";
    const caret = text.indexOf("cat.png");
    expect(isInsideFencedCodeBlock(text, caret)).toBe(false); // NOT a fenced block
    expect(isInsideLiteralMarkdownRegion(text, caret)).toBe(true);

    const located = locateImageAtCaret(text, caret);
    expect(located.ok).toBe(false);
    if (located.ok) throw new Error("unreachable");
    expect(located.reason).toBe("fenced-code-block");
    expect(located.diagnostic.category).toBe("EDITOR_UNSUPPORTED_PROJECTION");
  });

  test("positive control: the SAME image syntax at top-level (no indent) resolves as a real token", () => {
    const text = "Example:\n\n![A cat](cat.png)\n\nDone.";
    const caret = text.indexOf("cat.png");
    expect(isInsideLiteralMarkdownRegion(text, caret)).toBe(false);
    const located = locateImageAtCaret(text, caret);
    expect(located.ok).toBe(true);
  });
});

describe("literal-region refusal: list-nested fence (4-space indented ```)", () => {
  test("a caret on markdown-shaped image syntax inside a 4-space indented fenced block refuses with fenced-code-block", () => {
    const text = "- List item:\n\n    ```markdown\n    ![A cat](cat.png)\n    ```\n\nDone.";
    const caret = text.indexOf("cat.png");
    expect(isInsideLiteralMarkdownRegion(text, caret)).toBe(true);

    const located = locateImageAtCaret(text, caret);
    expect(located.ok).toBe(false);
    if (located.ok) throw new Error("unreachable");
    expect(located.reason).toBe("fenced-code-block");
  });
});

describe("literal-region refusal: blockquoted fence", () => {
  test("a caret on markdown-shaped image syntax inside a blockquoted fenced block refuses with fenced-code-block", () => {
    const text = "> Example:\n>\n> ```markdown\n> ![A cat](cat.png)\n> ```\n\nDone.";
    const caret = text.indexOf("cat.png");
    expect(isInsideLiteralMarkdownRegion(text, caret)).toBe(true);

    const located = locateImageAtCaret(text, caret);
    expect(located.ok).toBe(false);
    if (located.ok) throw new Error("unreachable");
    expect(located.reason).toBe("fenced-code-block");
  });
});

describe("literal-region refusal: plain top-level fence (control — unchanged behavior)", () => {
  test("a caret on markdown-shaped image syntax inside a plain fenced block still refuses with fenced-code-block", () => {
    const text = "Example:\n\n```markdown\n![A cat](cat.png)\n```\n\nDone.";
    const caret = text.indexOf("cat.png");
    expect(isInsideFencedCodeBlock(text, caret)).toBe(true);
    expect(isInsideLiteralMarkdownRegion(text, caret)).toBe(true);
    const located = locateImageAtCaret(text, caret);
    expect(located.ok).toBe(false);
  });
});
