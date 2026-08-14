import { test, expect, describe } from "bun:test";
import MarkdownIt from "markdown-it";
import {
  findImageToken,
  findImageWrapper,
  makeLinkToken,
  rewriteImageToken,
  rewriteLinkToken,
  resolveLinkToken,
  spliceToken,
} from "../../src/lib/editor/context-menu-actions";

const image = (token: string, occurrence = 0, src = "x.png", alt = "Art") => ({
  src,
  alt,
  source: { token, occurrence },
});

const link = (token: string | null, occurrence = 0, href = "same", text = "link") => ({
  href,
  text,
  source: token == null ? null : { token, occurrence },
});

describe("parser-owned image coordinates", () => {
  test("find the exact occurrence and capture only its attrs", () => {
    const token = "![Art](x.png)";
    const slice = `<!-- ${token} --> ${token}{width="200px"} and ${token}{.gp-right}`;
    const match = findImageToken(slice, image(token, 2))!;
    expect(match.start).toBe(slice.lastIndexOf(token));
    expect(match.attrsRaw).toBe("{.gp-right}");
  });

  test("raw HTML images have no Markdown coordinates and cannot resolve", () => {
    const slice = '![Raw](x.png) <img src="x.png" alt="Raw">';
    expect(findImageToken(slice, { src: "x.png", alt: "Raw", source: null })).toBeNull();
  });

  test("preserves escaped alt, destination, title, and unrelated attrs", () => {
    const token = String.raw`![A \[cat\]](media/a\(b\).png "Caption")`;
    const match = findImageToken(`${token}{width=40% .custom}`, image(token, 0, "media/a(b).png", "A [cat]"))!;
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
    const match = findImageToken(token, image(token, 0, "media/my%20image.png"))!;
    expect(rewriteImageToken(match, { src: "new image.png" })).toBe("![Art](<new image.png>)");
  });

  test("fills a parser-verified empty image destination", () => {
    const token = "![Art]()";
    const match = findImageToken(token, image(token, 0, ""))!;
    expect(match).not.toBeNull();
    expect(rewriteImageToken(match, { src: "new.png" })).toBe("![Art](new.png)");
  });

  test("serializes prompt values without breaking image Markdown", () => {
    const token = "![Art](x.png)";
    const match = findImageToken(token, image(token))!;
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
    const match = findImageToken(token, image(token))!;
    const entered = "a *b* `x  y` &copy;";
    const source = rewriteImageToken(match, { alt: entered });
    const html = createMarkdownRenderer().render(source);
    expect(html).toContain('alt="a *b* `x  y` &amp;copy;"');
  });

  test("supports a literal closing bracket inside an alt-text code span", () => {
    const token = "![a `]` b](x.png)";
    expect(findImageToken(token, image(token))).not.toBeNull();
  });

  test("does not close an alt-text code span on a longer backtick run", () => {
    const token = "![a `x```] y`](x.png)";
    expect(findImageToken(token, image(token))).not.toBeNull();
  });

  test("captures consecutive attribute groups as one editable suffix", () => {
    const token = "![Art](x.png)";
    const match = findImageToken(
      `${token}{.gp-right}{width=40%}`,
      image(token),
    )!;
    expect(match.attrsRaw).toBe("{.gp-right}{width=40%}");
    expect(match.end).toBe(`${token}{.gp-right}{width=40%}`.length);
  });

  test("does not consume a literal empty brace pair after an image", () => {
    const token = "![Art](x.png)";
    const match = findImageToken(`${token}{} tail`, image(token))!;
    expect(match.attrsRaw).toBe("");
    expect(match.end).toBe(token.length);
  });

  test("does not consume literal invalid attribute-looking suffixes", () => {
    const token = "![Art](x.png)";
    for (const literal of ["{#}", "{.}", String.raw`{\#}`, String.raw`{title="a\b"}`]) {
      const match = findImageToken(`${token}${literal} tail`, image(token))!;
      expect(match.attrsRaw).toBe("");
      expect(match.end).toBe(token.length);
    }
  });
});

describe("image wrappers", () => {
  test("unwrap extent includes balanced parentheses and a title", () => {
    const token = '![Art](x.png "Caption")';
    const text = `[${token}](https://example.com/a_(b) "title ) retained")`;
    const wrapper = findImageWrapper(text, findImageToken(text, image(token))!)!;
    expect(text.slice(wrapper.start, wrapper.end)).toBe(text);
    expect(wrapper.imageToken).toBe(token);
  });

  test("rejects an escaped outer bracket", () => {
    const token = "![Art](x.png)";
    const text = String.raw`\[${token}](https://example.com)`;
    expect(findImageWrapper(text, findImageToken(text, image(token))!)).toBeNull();
  });

  test("unwrap includes every consecutive image attribute group", () => {
    const token = "![Art](x.png)";
    const text = `[${token}{.gp-right}{width=40%}](https://example.com)`;
    const wrapper = findImageWrapper(text, findImageToken(text, image(token))!)!;
    expect(wrapper).not.toBeNull();
    expect(text.slice(wrapper.start, wrapper.end)).toBe(text);
    expect(wrapper.imageToken).toBe(`${token}{.gp-right}{width=40%}`);
  });
});

describe("parser-owned link coordinates", () => {
  test("select the exact duplicate occurrence", () => {
    const token = "[same](url)";
    const slice = `${token} and ${token}`;
    const result = resolveLinkToken(slice, link(token, 1, "url", "same"));
    expect(result.kind).toBe("found");
    if (result.kind === "found") expect(result.match.start).toBe(slice.lastIndexOf(token));
  });

  test("preserves escaped labels and titles when changing href", () => {
    const token = String.raw`[A \[link\]](<https://example.com/my page> "Title")`;
    const result = resolveLinkToken(token, link(token, 0, "https://example.com/my%20page", "A [link]"));
    expect(result.kind).toBe("found");
    if (result.kind === "found") {
      expect(rewriteLinkToken(result.match, "https://example.com/new")).toBe(
        String.raw`[A \[link\]](https://example.com/new "Title")`,
      );
    }
  });

  test("fills a parser-verified empty link destination", () => {
    const token = "[label]( )";
    const result = resolveLinkToken(token, link(token, 0, "", "label"));
    expect(result.kind).toBe("found");
    if (result.kind === "found") {
      expect(rewriteLinkToken(result.match, "https://example.com")).toBe(
        "[label]( https://example.com)",
      );
    }
  });

  test("serializes a link destination containing spaces", () => {
    const token = '[label](old "Title")';
    const result = resolveLinkToken(token, link(token, 0, "old", "label"));
    expect(result.kind).toBe("found");
    if (result.kind === "found") {
      expect(rewriteLinkToken(result.match, "new path")).toBe(
        '[label](<new path> "Title")',
      );
      expect(new MarkdownIt().render(rewriteLinkToken(result.match, "new path"))).toContain(
        'href="new%20path"',
      );
    }
  });

  test("builds a safe link from prompt text and destination", () => {
    expect(makeLinkToken(String.raw`A ] [ \\ safe`, "new path")).toBe(
      String.raw`[A \] \[ \\\\ safe](<new path>)`,
    );
    expect(new MarkdownIt().render(makeLinkToken("A ] safe", "new path"))).toContain(
      'href="new%20path"',
    );
  });

  test("supports a literal closing bracket inside a link-label code span", () => {
    const token = "[a `]` b](url)";
    expect(resolveLinkToken(token, link(token, 0, "url", "a ] b")).kind).toBe("found");
  });

  test("does not close a link-label code span on a longer backtick run", () => {
    const token = "[a `x```] y`](url)";
    expect(resolveLinkToken(token, link(token, 0, "url", "a x```] y")).kind).toBe("found");
  });

  test("reference and linkified forms degrade without guessing", () => {
    expect(resolveLinkToken("[docs][id]", link("[docs][id]", 0, "url", "docs")).kind).toBe("reference-style");
    expect(resolveLinkToken("Visit https://example.com", link(null, 0, "https://example.com", "https://example.com")).kind).toBe("linkified");
  });
});

test("spliceToken replaces a half-open region", () => {
  expect(spliceToken("abcdef", 2, 4, "XY")).toBe("abXYef");
});
