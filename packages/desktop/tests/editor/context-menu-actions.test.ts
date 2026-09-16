import { test, expect, describe } from "bun:test";
import MarkdownIt from "markdown-it";
import {
  findImageTokenAtOffset,
  findImageWrapper,
  findLinkTokenAtOffset,
  rewriteImageToken,
  rewriteLinkToken,
  spliceToken,
} from "../../src/lib/editor/context-menu-actions";

/**
 * SFE-P4: this file used to drive these same lexical-scanner/rewrite
 * primitives through the preview context menu's own PREVIEW-DRIVEN finders
 * (`findImageToken`/`resolveLinkToken`, deleted with the context menu's
 * mutation half — see `context-menu-actions.ts`'s header). Every case below
 * is the same edge case, migrated to the CARET-based finders
 * (`findImageTokenAtOffset`/`findLinkTokenAtOffset`) those finders' one
 * remaining consumer (`caret-token-commands.ts`, and through it
 * `toolbar-actions.ts`/`rich-commands.ts`) actually uses — a raw `(text,
 * offset)` pair rather than a rendered element's resolved token. Where the
 * old API additionally distinguished "reference-style" vs. "linkified" vs.
 * "not-found" (only meaningful for a disabled-item tooltip the deleted menu
 * needed), the caret-based finder collapses all three to `null`; the one
 * test that exercised that distinction is adapted accordingly.
 */

describe("parser-owned image coordinates", () => {
  test("find the exact occurrence and capture only its attrs", () => {
    const token = "![Art](x.png)";
    const slice = `<!-- ${token} --> ${token}{width="200px"} and ${token}{.gp-right}`;
    const offset = slice.lastIndexOf(token) + 1;
    const match = findImageTokenAtOffset(slice, offset)!;
    expect(match.start).toBe(slice.lastIndexOf(token));
    expect(match.attrsRaw).toBe("{.gp-right}");
  });

  test("caret on a raw HTML <img> has no Markdown token to address", () => {
    const slice = '![Raw](x.png) <img src="x.png" alt="Raw">';
    expect(findImageTokenAtOffset(slice, slice.indexOf("<img") + 3)).toBeNull();
  });

  test("preserves escaped alt, destination, title, and unrelated attrs", () => {
    const token = String.raw`![A \[cat\]](media/a\(b\).png "Caption")`;
    const text = `${token}{width=40% .custom}`;
    const match = findImageTokenAtOffset(text, 1)!;
    expect(rewriteImageToken(match, { attrsRaw: "{width=55% .custom}" })).toBe(
      `${token}{width=55% .custom}`,
    );
    expect(rewriteImageToken(match, { alt: "New alt" })).toBe(
      String.raw`![New alt](media/a\(b\).png "Caption"){width=40% .custom}`,
    );
    expect(rewriteImageToken(match, { src: "new.png" })).toBe(
      String.raw`![A \[cat\]](new.png "Caption"){width=40% .custom}`,
    );
  });

  test("supports angle destinations without DOM URL matching", () => {
    const token = "![Art](<media/my image.png>)";
    const match = findImageTokenAtOffset(token, 1)!;
    expect(rewriteImageToken(match, { src: "new image.png" })).toBe("![Art](<new image.png>)");
  });

  test("fills a parser-verified empty image destination", () => {
    const token = "![Art]()";
    const match = findImageTokenAtOffset(token, 1)!;
    expect(match).not.toBeNull();
    expect(rewriteImageToken(match, { src: "new.png" })).toBe("![Art](new.png)");
  });

  test("serializes prompt values without breaking image Markdown", () => {
    const token = "![Art](x.png)";
    const match = findImageTokenAtOffset(token, 1)!;
    expect(rewriteImageToken(match, { alt: String.raw`A ] [ \\ safe` })).toBe(
      String.raw`![A \] \[ \\\\ safe](x.png)`,
    );
    expect(rewriteImageToken(match, { src: "new path.png" })).toBe(
      "![Art](<new path.png>)",
    );
    expect(new MarkdownIt().render(rewriteImageToken(match, { src: "new path.png" }))).toContain(
      'src="new%20path.png"',
    );
  });

  test("serializes alt prompt input as plain text through the production renderer", async () => {
    const { createMarkdownRenderer } = await import(
      "../../../cli/src/lib/markdown/renderer"
    );
    const token = "![Art](x.png)";
    const match = findImageTokenAtOffset(token, 1)!;
    const entered = "a *b* `x  y` &copy;";
    const source = rewriteImageToken(match, { alt: entered });
    const html = createMarkdownRenderer().render(source);
    expect(html).toContain('alt="a *b* `x  y` &amp;copy;"');
  });

  test("supports a literal closing bracket inside an alt-text code span", () => {
    const token = "![a `]` b](x.png)";
    expect(findImageTokenAtOffset(token, 1)).not.toBeNull();
  });

  test("does not close an alt-text code span on a longer backtick run", () => {
    const token = "![a `x```] y`](x.png)";
    expect(findImageTokenAtOffset(token, 1)).not.toBeNull();
  });

  test("captures consecutive attribute groups as one editable suffix", () => {
    const token = "![Art](x.png)";
    const text = `${token}{.gp-right}{width=40%}`;
    const match = findImageTokenAtOffset(text, 1)!;
    expect(match.attrsRaw).toBe("{.gp-right}{width=40%}");
    expect(match.end).toBe(text.length);
  });

  test("does not consume a literal empty brace pair after an image", () => {
    const token = "![Art](x.png)";
    const text = `${token}{} tail`;
    const match = findImageTokenAtOffset(text, 1)!;
    expect(match.attrsRaw).toBe("");
    expect(match.end).toBe(token.length);
  });

  test("does not consume literal invalid attribute-looking suffixes", () => {
    const token = "![Art](x.png)";
    for (const literal of ["{#}", "{.}", String.raw`{\#}`, String.raw`{title="a\b"}`]) {
      const match = findImageTokenAtOffset(`${token}${literal} tail`, 1)!;
      expect(match.attrsRaw).toBe("");
      expect(match.end).toBe(token.length);
    }
  });
});

describe("image wrappers", () => {
  test("unwrap extent includes balanced parentheses and a title", () => {
    const token = '![Art](x.png "Caption")';
    const text = `[${token}](https://example.com/a_(b) "title ) retained")`;
    const wrapper = findImageWrapper(text, findImageTokenAtOffset(text, text.indexOf(token) + 1)!)!;
    expect(text.slice(wrapper.start, wrapper.end)).toBe(text);
    expect(wrapper.imageToken).toBe(token);
  });

  test("rejects an escaped outer bracket", () => {
    const token = "![Art](x.png)";
    const text = String.raw`\[${token}](https://example.com)`;
    const match = findImageTokenAtOffset(text, text.indexOf(token) + 1)!;
    expect(findImageWrapper(text, match)).toBeNull();
  });

  test("unwrap includes every consecutive image attribute group", () => {
    const token = "![Art](x.png)";
    const text = `[${token}{.gp-right}{width=40%}](https://example.com)`;
    const match = findImageTokenAtOffset(text, text.indexOf(token) + 1)!;
    const wrapper = findImageWrapper(text, match)!;
    expect(wrapper).not.toBeNull();
    expect(text.slice(wrapper.start, wrapper.end)).toBe(text);
    expect(wrapper.imageToken).toBe(`${token}{.gp-right}{width=40%}`);
  });
});

describe("parser-owned link coordinates", () => {
  test("select the exact duplicate occurrence", () => {
    const token = "[same](url)";
    const slice = `${token} and ${token}`;
    const offset = slice.lastIndexOf(token) + 1;
    const match = findLinkTokenAtOffset(slice, offset);
    expect(match).not.toBeNull();
    expect(match!.start).toBe(slice.lastIndexOf(token));
  });

  test("preserves escaped labels and titles when changing href", () => {
    const token = String.raw`[A \[link\]](<https://example.com/my page> "Title")`;
    const match = findLinkTokenAtOffset(token, 1)!;
    expect(match).not.toBeNull();
    expect(rewriteLinkToken(match, "https://example.com/new")).toBe(
      String.raw`[A \[link\]](https://example.com/new "Title")`,
    );
  });

  test("fills a parser-verified empty link destination", () => {
    const token = "[label]( )";
    const match = findLinkTokenAtOffset(token, 1)!;
    expect(match).not.toBeNull();
    expect(rewriteLinkToken(match, "https://example.com")).toBe(
      "[label]( https://example.com)",
    );
  });

  test("serializes a link destination containing spaces", () => {
    const token = '[label](old "Title")';
    const match = findLinkTokenAtOffset(token, 1)!;
    expect(match).not.toBeNull();
    expect(rewriteLinkToken(match, "new path")).toBe(
      '[label](<new path> "Title")',
    );
    expect(new MarkdownIt().render(rewriteLinkToken(match, "new path"))).toContain(
      'href="new%20path"',
    );
  });

  test("supports a literal closing bracket inside a link-label code span", () => {
    const token = "[a `]` b](url)";
    expect(findLinkTokenAtOffset(token, 1)).not.toBeNull();
  });

  test("does not close a link-label code span on a longer backtick run", () => {
    const token = "[a `x```] y`](url)";
    expect(findLinkTokenAtOffset(token, 1)).not.toBeNull();
  });

  test("reference-style and linkified forms are not editable tokens (both collapse to null)", () => {
    expect(findLinkTokenAtOffset("[docs][id]", 1)).toBeNull();
    expect(findLinkTokenAtOffset("Visit https://example.com", 6)).toBeNull();
  });
});

test("spliceToken replaces a half-open region", () => {
  expect(spliceToken("abcdef", 2, 4, "XY")).toBe("abXYef");
});
