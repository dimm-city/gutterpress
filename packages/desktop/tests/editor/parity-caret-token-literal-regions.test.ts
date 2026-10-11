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

/**
 * SFE-P3e review round 1 (CONFIRMED finding): the FIRST cut of the
 * occurrence check asked only "does ANY real image/link child in the
 * enclosing block share this destination" — set membership, not "is the
 * caret's own candidate the one the real parser actually recognized". A
 * code-span literal sharing its destination with a real occurrence
 * ELSEWHERE in the same block satisfied that check regardless of which one
 * the caret was on. Reproduced directly against the pre-fix code (restoring
 * `git show cf66572c`'s scanners refused all four; the block-scoped
 * set-membership check accepted all four).
 *
 * The fix matches the caret's candidate against the real pipeline's own
 * `{token, occurrence}` stamp (`gutterpress/render`'s
 * `sourceTokenOccurrenceAt`/`inlineSourceMetaOf` — the SAME disambiguator
 * `data-gp-source-token`/`data-gp-source-occurrence` uses for the preview
 * context menu), so each case below asserts BOTH directions: the fake
 * (code-span) occurrence still refuses, and the real occurrence in the
 * SAME block still resolves — a fix that merely refused everything would
 * pass the first assertion and fail the second.
 */
describe("SFE-P3e over-acceptance fix: caret-scoped, not block-scoped, evidence", () => {
  test("image: a code-span literal sharing its src with a real image in the same paragraph refuses; the real one resolves", () => {
    const text = "A real ![a](b.png) image and a literal `![a](b.png)` sample.\n";
    const realCaret = text.indexOf("b.png");
    const codeSpanCaret = text.lastIndexOf("b.png");
    expect(codeSpanCaret).toBeGreaterThan(realCaret);

    const fake = locateImageAtCaret(text, codeSpanCaret);
    expect(fake.ok).toBe(false);
    if (fake.ok) throw new Error("unreachable");
    expect(fake.reason).toBe("no-token");

    const real = locateImageAtCaret(text, realCaret);
    expect(real.ok).toBe(true);
    if (!real.ok) throw new Error("unreachable");
    expect(real.value.match.src).toBe("b.png");
  });

  test("image: reverse order — the code-span literal comes FIRST, the real image second — still resolves correctly both ways", () => {
    const text = "Use `![a](b.png)` to embed. Example: ![a](b.png)\n";
    const codeSpanCaret = text.indexOf("b.png");
    const realCaret = text.lastIndexOf("b.png");
    expect(realCaret).toBeGreaterThan(codeSpanCaret);

    const fake = locateImageAtCaret(text, codeSpanCaret);
    expect(fake.ok).toBe(false);
    if (fake.ok) throw new Error("unreachable");
    expect(fake.reason).toBe("no-token");

    const real = locateImageAtCaret(text, realCaret);
    expect(real.ok).toBe(true);
  });

  test("link: a code-span literal sharing its href with a real link in the same paragraph refuses; the real one resolves", () => {
    const text = "A real [t](h.html) link and a literal `[t](h.html)` sample.\n";
    const realCaret = text.indexOf("h.html");
    const codeSpanCaret = text.lastIndexOf("h.html");
    expect(codeSpanCaret).toBeGreaterThan(realCaret);

    const fake = locateLinkAtCaret(text, codeSpanCaret);
    expect(fake.ok).toBe(false);
    if (fake.ok) throw new Error("unreachable");
    expect(fake.reason).toBe("no-token");

    const real = locateLinkAtCaret(text, realCaret);
    expect(real.ok).toBe(true);
    if (!real.ok) throw new Error("unreachable");
    expect(real.value.match.href).toBe("h.html");
  });

  test("multi-line-within-one-paragraph variant: the real image and the code-span literal fall on different SOURCE LINES of the same wrapped paragraph", () => {
    const text = "A real ![a](b.png) image\nand a literal `![a](b.png)` sample.\n";
    const realCaret = text.indexOf("b.png");
    const codeSpanCaret = text.lastIndexOf("b.png");
    // Liveness: the two occurrences really are on different lines of ONE
    // paragraph (markdown-it does not treat this as two paragraphs — no
    // blank line separates them).
    expect(text.slice(0, realCaret).includes("\n")).toBe(false);
    expect(text.slice(0, codeSpanCaret).includes("\n")).toBe(true);

    const fake = locateImageAtCaret(text, codeSpanCaret);
    expect(fake.ok).toBe(false);
    if (fake.ok) throw new Error("unreachable");
    expect(fake.reason).toBe("no-token");

    const real = locateImageAtCaret(text, realCaret);
    expect(real.ok).toBe(true);
  });

  test("percent-encoding pair: a real %20-encoded destination and a differently-spelled code-span literal do not satisfy each other's evidence check", () => {
    // Before this fix, `md.normalizeLink` was applied to BOTH sides before
    // comparing, so normalizeLink("my pic.png") === normalizeLink("my%20pic.png")
    // made these two TEXTUALLY DIFFERENT destinations satisfy each other's
    // check. The fix compares literal token text, not normalized
    // destinations, so it never reaches that collision in the first place.
    const text = "A real ![a](my%20pic.png) image and a literal `![a](<my pic.png>)` sample.\n";
    const realCaret = text.indexOf("my%20pic.png");
    const codeSpanCaret = text.lastIndexOf("my pic.png");
    expect(codeSpanCaret).toBeGreaterThan(realCaret);

    const fake = locateImageAtCaret(text, codeSpanCaret);
    expect(fake.ok).toBe(false);
    if (fake.ok) throw new Error("unreachable");
    expect(fake.reason).toBe("no-token");

    const real = locateImageAtCaret(text, realCaret);
    expect(real.ok).toBe(true);
    if (!real.ok) throw new Error("unreachable");
    expect(real.value.match.src).toBe("my%20pic.png");
  });
});

/**
 * SFE-P3e review round 1 (CONFIRMED finding): markdown-it does not set
 * `.map` on a table cell's `td_open`/`inline`/`td_close` triad (only
 * `table_open`/`tbody_open`/`tr_open` carry it), so requiring the enclosing
 * `inline` token itself to carry a map — `enclosingProseChildren`'s
 * original check — refused every image/link inside a table cell even
 * though `md.render()` produces a genuine `<img>`/`<a>` for it. Verified as
 * a REGRESSION against `git show cf66572c`'s scanners, which resolved this
 * exact shape correctly.
 */
describe("SFE-P3e over-refusal fix: images and links inside table cells", () => {
  test("an image inside a GFM table cell resolves as a real, editable image", () => {
    const text = "| a | b |\n| - | - |\n| ![a](b.png) | x |\n";
    const caret = text.indexOf("b.png");
    expect(text).toContain("![a](b.png)");

    const located = locateImageAtCaret(text, caret);
    expect(located.ok).toBe(true);
    if (!located.ok) throw new Error("unreachable");
    expect(located.value.match.src).toBe("b.png");
  });

  test("a link inside a GFM table cell resolves as a real, editable link", () => {
    const text = "| a | b |\n| - | - |\n| [t](h.html) | x |\n";
    const caret = text.indexOf("h.html");

    const located = locateLinkAtCaret(text, caret);
    expect(located.ok).toBe(true);
    if (!located.ok) throw new Error("unreachable");
    expect(located.value.match.href).toBe("h.html");
  });
});

/**
 * SFE-P3e review round 2 (CONFIRMED finding): every case above lives in a
 * block that starts at document offset 0 — the ONE shape where a
 * whole-document occurrence count and a block-scoped occurrence count
 * happen to agree by coincidence. Round 1's fix computed the caret's own
 * candidate occurrence with `sourceTokenOccurrenceAt(text, ...)` (a
 * whole-document scan) but compared it against a stamp scoped to the
 * enclosing block's own inline content — so the false-accept this section
 * exists to close (a code span "wins" against a real occurrence elsewhere
 * in the document) still reproduced whenever a code span preceded a real
 * occurrence in an EARLIER block, and, separately, an ordinary real
 * image/link repeated in a SECOND block was newly refused. This describe
 * block pins both directions with the block boundary explicit (`\n\n`, a
 * second list item, and so on) — none of it lives at offset 0 — and
 * reproduces the exact shapes SFE-P3e.md's review round 2 finding recorded:
 * "the same token in two paragraphs", "the same token in two list items", a
 * code span in a later block with an earlier real occurrence (image and
 * link), and the reverse.
 */
describe("SFE-P3e round 2: occurrence counting is scoped per block, not per document", () => {
  test("the same image repeated in a SECOND paragraph resolves (not just the first)", () => {
    const text = "![a](b.png)\n\nLater: ![a](b.png)\n";
    const firstCaret = text.indexOf("b.png");
    const secondCaret = text.lastIndexOf("b.png");
    expect(secondCaret).toBeGreaterThan(firstCaret);

    const first = locateImageAtCaret(text, firstCaret);
    expect(first.ok).toBe(true);

    const second = locateImageAtCaret(text, secondCaret);
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("unreachable");
    expect(second.value.match.src).toBe("b.png");
  });

  test("the same link repeated in a SECOND paragraph resolves (not just the first)", () => {
    const text = "[t](h.html)\n\nLater: [t](h.html)\n";
    const secondCaret = text.lastIndexOf("h.html");

    const second = locateLinkAtCaret(text, secondCaret);
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("unreachable");
    expect(second.value.match.href).toBe("h.html");
  });

  test("the same image repeated across a HEADING-separated pair of paragraphs resolves on the second", () => {
    const text = "# Title\n\n![a](b.png)\n\nMore text\n\n![a](b.png)\n";
    const secondCaret = text.lastIndexOf("b.png");

    const second = locateImageAtCaret(text, secondCaret);
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("unreachable");
    expect(second.value.match.src).toBe("b.png");
  });

  test("the same image repeated in a SECOND list item resolves (not just the first)", () => {
    const text = "- ![a](b.png)\n- ![a](b.png)\n";
    const firstCaret = text.indexOf("b.png");
    const secondCaret = text.lastIndexOf("b.png");
    expect(secondCaret).toBeGreaterThan(firstCaret);

    const first = locateImageAtCaret(text, firstCaret);
    expect(first.ok).toBe(true);

    const second = locateImageAtCaret(text, secondCaret);
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("unreachable");
    expect(second.value.match.src).toBe("b.png");
  });

  test("the same link repeated in a SECOND list item resolves (not just the first)", () => {
    const text = "- [t](h.html)\n- [t](h.html)\n";
    const secondCaret = text.lastIndexOf("h.html");

    const second = locateLinkAtCaret(text, secondCaret);
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("unreachable");
    expect(second.value.match.href).toBe("h.html");
  });

  test("a code span in a LATER block with an earlier REAL occurrence in a prior block still refuses (image)", () => {
    const text = "Text ![a](b.png) one.\n\nLiteral `![a](b.png)` and real ![a](b.png).\n";
    const codeSpanCaret = text.indexOf("`![a](b.png)`") + 5;
    const realCaret = text.lastIndexOf("![a](b.png)") + 2;
    expect(realCaret).toBeGreaterThan(codeSpanCaret);

    const fake = locateImageAtCaret(text, codeSpanCaret);
    expect(fake.ok).toBe(false);
    if (fake.ok) throw new Error("unreachable");
    expect(fake.reason).toBe("no-token");

    const real = locateImageAtCaret(text, realCaret);
    expect(real.ok).toBe(true);
    if (!real.ok) throw new Error("unreachable");
    expect(real.value.match.src).toBe("b.png");
  });

  test("a code span in a LATER block with an earlier REAL occurrence in a prior block still refuses (link)", () => {
    const text = "Text [t](h.html) one.\n\nLiteral `[t](h.html)` and real [t](h.html).\n";
    const codeSpanCaret = text.indexOf("`[t](h.html)`") + 5;
    const realCaret = text.lastIndexOf("[t](h.html)") + 2;
    expect(realCaret).toBeGreaterThan(codeSpanCaret);

    const fake = locateLinkAtCaret(text, codeSpanCaret);
    expect(fake.ok).toBe(false);
    if (fake.ok) throw new Error("unreachable");
    expect(fake.reason).toBe("no-token");

    const real = locateLinkAtCaret(text, realCaret);
    expect(real.ok).toBe(true);
    if (!real.ok) throw new Error("unreachable");
    expect(real.value.match.href).toBe("h.html");
  });

  test("reverse: a code span in an EARLIER block with a real occurrence LATER still refuses the code span and resolves the real one (image)", () => {
    const text = "Literal `![a](b.png)` here.\n\nReal ![a](b.png) there.\n";
    const codeSpanCaret = text.indexOf("`![a](b.png)`") + 5;
    const realCaret = text.lastIndexOf("b.png");
    expect(realCaret).toBeGreaterThan(codeSpanCaret);

    const fake = locateImageAtCaret(text, codeSpanCaret);
    expect(fake.ok).toBe(false);
    if (fake.ok) throw new Error("unreachable");
    expect(fake.reason).toBe("no-token");

    const real = locateImageAtCaret(text, realCaret);
    expect(real.ok).toBe(true);
    if (!real.ok) throw new Error("unreachable");
    expect(real.value.match.src).toBe("b.png");
  });

  test("reverse: a code span in an EARLIER block with a real occurrence LATER still refuses the code span and resolves the real one (link)", () => {
    const text = "Literal `[t](h.html)` here.\n\nReal [t](h.html) there.\n";
    const codeSpanCaret = text.indexOf("`[t](h.html)`") + 5;
    const realCaret = text.lastIndexOf("h.html");
    expect(realCaret).toBeGreaterThan(codeSpanCaret);

    const fake = locateLinkAtCaret(text, codeSpanCaret);
    expect(fake.ok).toBe(false);
    if (fake.ok) throw new Error("unreachable");
    expect(fake.reason).toBe("no-token");

    const real = locateLinkAtCaret(text, realCaret);
    expect(real.ok).toBe(true);
    if (!real.ok) throw new Error("unreachable");
    expect(real.value.match.href).toBe("h.html");
  });
});

/**
 * SFE-P3e review round 3 (CONFIRMED finding): every table-cell case above
 * (both the round-1 "images and links inside table cells" fix and every
 * case elsewhere in this file) uses exactly ONE image/link per row, where
 * the round-2 fix's block-scoped occurrence counting happens to work by
 * coincidence — a table cell's `td_open`/`inline`/`td_close` triad carries
 * no `.map` of its own, so the resolved container widens to the WHOLE ROW,
 * and occurrence was counted against the row's raw text as if it were one
 * `state.src` even though each cell is actually parsed against only its
 * OWN content. With a single token per row that coincidence never surfaces;
 * with two cells sharing byte-identical image/link syntax, or a code span
 * in one cell and a real token in the next, it reproduces the SAME
 * false-accept/false-refuse pair round 1 fixed, one level up:
 *   - a code span in an earlier cell could false-ACCEPT against a real
 *     token in a later cell of the SAME row (row-scoped counting made the
 *     code span's own row position look like the real token's cell
 *     position);
 *   - a real token whose cell was not the row's first could false-REFUSE
 *     (row-scoped counting never matched the stamp, which was computed
 *     against only that cell's own content).
 * This describe block pins both shapes, each asserting the SPECIFIC
 * refusal reason (never just `ok === false`), reproduced directly against
 * the pre-round-3 code before this fix (row-scoped counting accepted the
 * code-span cases and refused the second identical-token cases below).
 */
describe("SFE-P3e round 3: occurrence counting is scoped per table CELL, not per row", () => {
  test("image: two byte-identical images in the SAME row resolve independently, caret on each", () => {
    const text = "| a | b |\n| - | - |\n| ![a](b.png) | ![a](b.png) |\n";
    const firstCaret = text.indexOf("b.png");
    const secondCaret = text.lastIndexOf("b.png");
    expect(secondCaret).toBeGreaterThan(firstCaret);

    const first = locateImageAtCaret(text, firstCaret);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("unreachable");
    expect(first.value.match.src).toBe("b.png");

    const second = locateImageAtCaret(text, secondCaret);
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("unreachable");
    expect(second.value.match.src).toBe("b.png");
  });

  test("link: two byte-identical links in the SAME row resolve independently, caret on each", () => {
    const text = "| a | b |\n| - | - |\n| [t](h.html) | [t](h.html) |\n";
    const firstCaret = text.indexOf("h.html");
    const secondCaret = text.lastIndexOf("h.html");
    expect(secondCaret).toBeGreaterThan(firstCaret);

    const first = locateLinkAtCaret(text, firstCaret);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("unreachable");
    expect(first.value.match.href).toBe("h.html");

    const second = locateLinkAtCaret(text, secondCaret);
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("unreachable");
    expect(second.value.match.href).toBe("h.html");
  });

  test("image: a code span in cell 1 with a real image in cell 2 of the SAME row — the code span refuses, the real one resolves", () => {
    const text = "| a | b |\n| - | - |\n| `![a](b.png)` | ![a](b.png) |\n";
    const codeSpanCaret = text.indexOf("b.png");
    const realCaret = text.lastIndexOf("b.png");
    expect(realCaret).toBeGreaterThan(codeSpanCaret);

    const fake = locateImageAtCaret(text, codeSpanCaret);
    expect(fake.ok).toBe(false);
    if (fake.ok) throw new Error("unreachable");
    expect(fake.reason).toBe("no-token");

    const real = locateImageAtCaret(text, realCaret);
    expect(real.ok).toBe(true);
    if (!real.ok) throw new Error("unreachable");
    expect(real.value.match.src).toBe("b.png");
  });

  test("link: a code span in cell 1 with a real link in cell 2 of the SAME row — the code span refuses, the real one resolves", () => {
    const text = "| a | b |\n| - | - |\n| `[t](h.html)` | [t](h.html) |\n";
    const codeSpanCaret = text.indexOf("h.html");
    const realCaret = text.lastIndexOf("h.html");
    expect(realCaret).toBeGreaterThan(codeSpanCaret);

    const fake = locateLinkAtCaret(text, codeSpanCaret);
    expect(fake.ok).toBe(false);
    if (fake.ok) throw new Error("unreachable");
    expect(fake.reason).toBe("no-token");

    const real = locateLinkAtCaret(text, realCaret);
    expect(real.ok).toBe(true);
    if (!real.ok) throw new Error("unreachable");
    expect(real.value.match.href).toBe("h.html");
  });

  test("image: reverse order — a real image in cell 1 and a code-span literal sharing its src in cell 2 — still resolves/refuses correctly both ways", () => {
    const text = "| a | b |\n| - | - |\n| ![a](b.png) | `![a](b.png)` |\n";
    const realCaret = text.indexOf("b.png");
    const codeSpanCaret = text.lastIndexOf("b.png");
    expect(codeSpanCaret).toBeGreaterThan(realCaret);

    const real = locateImageAtCaret(text, realCaret);
    expect(real.ok).toBe(true);
    if (!real.ok) throw new Error("unreachable");
    expect(real.value.match.src).toBe("b.png");

    const fake = locateImageAtCaret(text, codeSpanCaret);
    expect(fake.ok).toBe(false);
    if (fake.ok) throw new Error("unreachable");
    expect(fake.reason).toBe("no-token");
  });

  test("link: reverse order — a real link in cell 1 and a code-span literal sharing its href in cell 2 — still resolves/refuses correctly both ways", () => {
    const text = "| a | b |\n| - | - |\n| [t](h.html) | `[t](h.html)` |\n";
    const realCaret = text.indexOf("h.html");
    const codeSpanCaret = text.lastIndexOf("h.html");
    expect(codeSpanCaret).toBeGreaterThan(realCaret);

    const real = locateLinkAtCaret(text, realCaret);
    expect(real.ok).toBe(true);
    if (!real.ok) throw new Error("unreachable");
    expect(real.value.match.href).toBe("h.html");

    const fake = locateLinkAtCaret(text, codeSpanCaret);
    expect(fake.ok).toBe(false);
    if (fake.ok) throw new Error("unreachable");
    expect(fake.reason).toBe("no-token");
  });
});
