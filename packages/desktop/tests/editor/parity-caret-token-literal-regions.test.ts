/**
 * parity-caret-token-literal-regions.test.ts
 *
 * SFE-P3d-parity repair round 1 closed a CONFIRMED review finding here:
 * `isInsideFencedCodeBlock` used to guard only PLAIN, TOP-LEVEL fenced code
 * blocks, and markdown-it treats three OTHER regions as literal text
 * exactly the same way — an inline code span, an indented (non-fenced)
 * code block, and a fenced block introduced with container prefixes (a
 * blockquote, 4+ columns of list-nested indent). Before that repair, a
 * caret in any of those four regions on text that LOOKS like
 * `![alt](src)`/`[text](href)` resolved as a real token and would have
 * been rewritten — verified against real committed content
 * (`examples/with-design-guide/design-guide/05-layout.md`, which documents
 * markdown-it-attrs syntax inside an inline code span; see the "real
 * committed content" describe block below, which now reads that file
 * directly rather than only a same-shaped synthetic fixture).
 *
 * SFE-P3e replaced the three hand-rolled scanners those regions were
 * checked with (`isInsideFencedCodeBlock`/`isInsideIndentedCodeBlock`/
 * `isInsideInlineCodeSpan`, `caret-token-commands.ts`) with one question to
 * the REAL markdown-it pipeline: does `md.parse()` actually produce this
 * token here? See that module's "Real-parser literal-region evidence"
 * section. Every CASE below still refuses exactly as before — this file's
 * mechanism assertions (which no longer have a scanner function to call)
 * are gone, replaced by asserting through the public `locate*AtCaret`
 * contract only. One reason/category CHANGES with the new mechanism: an
 * inline code span is not a block-level `fence`/`code_block` token at all
 * (it is swallowed into the enclosing paragraph's ordinary `code_inline`
 * child), so the real parser's evidence for it is "no matching image/link
 * child in this prose block" — the SAME fact `"no-token"` already names —
 * rather than `"fenced-code-block"`. A real `fence`/`code_block` token
 * (top-level, indented, list-nested, or blockquoted) keeps refusing with
 * `"fenced-code-block"`, now backed by that token's own `.map` range
 * instead of a scanner guessing at container indentation.
 *
 * One probe per region, each asserting the SPECIFIC refusal reason and
 * category (never just `ok === false`) — plus a positive control proving
 * the SAME offset resolves as a real token once it is NOT inside a literal
 * region, so a probe that "passes" by refusing everything is caught.
 *
 * A final describe block pins the SFE-P3e over-refusal fix: the deleted
 * `isInsideIndentedCodeBlock` scanner checked raw line indentation with no
 * notion of list-item container context, so ANY paragraph indented 4+
 * columns and preceded by a blank line was treated as an indented code
 * block — including perfectly ordinary list-item continuation content
 * whose OWN list ("1.  " and similar wide markers, or a nested list purely
 * from nesting depth) legitimately requires that much indentation. The
 * real parser has no such blind spot: it resolves list-item content
 * indentation itself, so these two ordinary authoring shapes now resolve
 * as real, editable images instead of being refused with a "code block"
 * message.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import { locateImageAtCaret, locateLinkAtCaret } from "../../src/lib/editor/caret-token-commands";

describe("literal-region refusal: inline code span", () => {
  test("a caret on markdown-shaped image syntax inside an inline code span refuses with no-token", () => {
    const text = "Use `![a](b.png)` in markdown.";
    const caret = text.indexOf("b.png");
    // Liveness: this really is a well-formed image token shape.
    expect(text).toContain("![a](b.png)");

    const located = locateImageAtCaret(text, caret);
    expect(located.ok).toBe(false);
    if (located.ok) throw new Error("unreachable");
    // An inline code span is not a block-level fence/code_block token — the
    // real parser's evidence is "no matching image child in this prose
    // block's real inline token stream" (see this file's header), the SAME
    // reason a candidate-free caret gets.
    expect(located.reason).toBe("no-token");
    expect(located.diagnostic.category).toBe("EDITOR_INVALID_RANGE");
  });

  test("positive control: the SAME image syntax OUTSIDE the code span resolves as a real token", () => {
    const text = "Use `code` and then a real ![a](b.png) image.";
    const caret = text.indexOf("b.png");
    const located = locateImageAtCaret(text, caret);
    expect(located.ok).toBe(true);
  });

  test("a caret on link syntax inside an inline code span refuses with no-token", () => {
    const text = "Write `[text](href.html)` to make a link.";
    const caret = text.indexOf("href.html");
    const located = locateLinkAtCaret(text, caret);
    expect(located.ok).toBe(false);
    if (located.ok) throw new Error("unreachable");
    expect(located.reason).toBe("no-token");
  });
});

describe("literal-region refusal: indented (non-fenced) code block", () => {
  test("a caret on markdown-shaped image syntax in a 4-space indented code block refuses with fenced-code-block", () => {
    const text = "Example:\n\n    ![A cat](cat.png)\n\nDone.";
    const caret = text.indexOf("cat.png");

    const located = locateImageAtCaret(text, caret);
    expect(located.ok).toBe(false);
    if (located.ok) throw new Error("unreachable");
    // The real parser produces a `code_block` token for this line range —
    // still a real, block-level literal region.
    expect(located.reason).toBe("fenced-code-block");
    expect(located.diagnostic.category).toBe("EDITOR_UNSUPPORTED_PROJECTION");
  });

  test("positive control: the SAME image syntax at top-level (no indent) resolves as a real token", () => {
    const text = "Example:\n\n![A cat](cat.png)\n\nDone.";
    const caret = text.indexOf("cat.png");
    const located = locateImageAtCaret(text, caret);
    expect(located.ok).toBe(true);
  });
});

describe("literal-region refusal: list-nested fence (4-space indented ```)", () => {
  test("a caret on markdown-shaped image syntax inside a 4-space indented fenced block refuses with fenced-code-block", () => {
    const text = "- List item:\n\n    ```markdown\n    ![A cat](cat.png)\n    ```\n\nDone.";
    const caret = text.indexOf("cat.png");

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
    const located = locateImageAtCaret(text, caret);
    expect(located.ok).toBe(false);
    if (located.ok) throw new Error("unreachable");
    expect(located.reason).toBe("fenced-code-block");
  });
});

describe("literal-region refusal: real committed content (design-guide/05-layout.md)", () => {
  // The exact shape SFE-P3d-parity repair round 1 fixed: an inline code
  // span documenting markdown-it-attrs syntax, quoted verbatim in a real
  // shipped example project. Read directly from disk (AP-25: committed
  // fixtures are read-only inputs) rather than only a same-shaped synthetic
  // stand-in, so "the real-book case must still refuse" (SFE-P3e's run
  // specification) is proven against the actual file, not an analog of it.
  const REPO_ROOT = pathResolve(import.meta.dir, "../../../..");
  const LAYOUT_DOC_PATH = pathResolve(REPO_ROOT, "examples/with-design-guide/design-guide/05-layout.md");

  test("the img-float-right syntax sample still refuses to resolve as a real image", () => {
    const text = readFileSync(LAYOUT_DOC_PATH, "utf8");
    const needle = "![alt](src){.img-float-right}";
    // Liveness (AP-21/AP-24): the sample this test depends on must actually
    // be present, inside a backtick span, as committed.
    expect(text).toContain("`" + needle + "`");
    const caret = text.indexOf(needle) + needle.indexOf("src");

    const located = locateImageAtCaret(text, caret);
    expect(located.ok).toBe(false);
    if (located.ok) throw new Error("unreachable");
    expect(located.reason).toBe("no-token");
  });
});

describe("SFE-P3e over-refusal fix: list-item continuation content is not a code block", () => {
  // The deleted isInsideIndentedCodeBlock scanner checked raw line
  // indentation with no notion of list-item container context: ANY
  // paragraph indented 4+ columns and preceded by a blank line was treated
  // as an indented code block, including perfectly ordinary list-item
  // continuation content whose OWN list legitimately requires that much
  // indentation. The real parser has no such blind spot.

  test("an ordered-list item with a wide marker ('1.  ') no longer treats its 4-space continuation paragraph as code", () => {
    const text = "1.  Item with a wide marker.\n\n    A continuation paragraph with an image ![a](b.png) here.\n";
    const caret = text.indexOf("b.png");
    // Liveness: the old scanner really did over-refuse this exact shape —
    // 4+ columns of indentation, preceded by a blank line, is precisely
    // what it flagged as an indented code block.
    expect(text).toContain("![a](b.png)");

    const located = locateImageAtCaret(text, caret);
    expect(located.ok).toBe(true);
    if (!located.ok) throw new Error("unreachable");
    expect(located.value.match.src).toBe("b.png");
  });

  test("a nested list item's continuation paragraph (4+ columns from nesting depth alone) resolves as a real image", () => {
    const text = "- Outer\n\n  - Inner item\n\n    A continuation paragraph with an image ![a](b.png) here.\n";
    const caret = text.indexOf("b.png");
    expect(text).toContain("![a](b.png)");

    const located = locateImageAtCaret(text, caret);
    expect(located.ok).toBe(true);
    if (!located.ok) throw new Error("unreachable");
    expect(located.value.match.src).toBe("b.png");
  });
});
