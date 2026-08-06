import { test, expect, describe } from "bun:test";
import {
  findImageToken,
  hasRawHtmlImg,
  resolveLinkToken,
  spliceToken,
} from "../../src/lib/editor/context-menu-actions";

describe("findImageToken", () => {
  test("finds a plain image token by matching src/alt", () => {
    const slice = "Some text.\n\n![A cat](cat.png){width=\"200px\"}\n\n";
    const m = findImageToken(slice, { src: "cat.png", alt: "A cat" });
    expect(m).not.toBeNull();
    expect(m?.alt).toBe("A cat");
    expect(m?.src).toBe("cat.png");
    expect(m?.attrsRaw).toBe('{width="200px"}');
    expect(slice.slice(m!.start, m!.end)).toBe('![A cat](cat.png){width="200px"}');
  });

  test("finds a token with no attrs suffix", () => {
    const slice = "![alt](img.png)\n";
    const m = findImageToken(slice, { src: "img.png", alt: "alt" });
    expect(m?.attrsRaw).toBe("");
  });

  test("returns null when src does not match any token", () => {
    const slice = "![alt](other.png)\n";
    const m = findImageToken(slice, { src: "img.png", alt: "alt" });
    expect(m).toBeNull();
  });

  test("returns null with no src to match", () => {
    expect(findImageToken("![alt](img.png)", { src: null, alt: null })).toBeNull();
  });

  test("picks the matching occurrence among multiple images", () => {
    const slice = "![one](a.png)\n\n![two](b.png)\n";
    const m = findImageToken(slice, { src: "b.png", alt: "two" });
    expect(m?.src).toBe("b.png");
  });
});

describe("hasRawHtmlImg", () => {
  test("detects a raw HTML <img> tag", () => {
    expect(hasRawHtmlImg('<img src="a.png" alt="a">')).toBe(true);
  });
  test("false for ordinary markdown", () => {
    expect(hasRawHtmlImg("![alt](a.png)")).toBe(false);
  });
});

describe("resolveLinkToken", () => {
  test("found: a plain markdown link", () => {
    const slice = "See [the docs](https://example.com/docs) for more.\n";
    const r = resolveLinkToken(slice, { href: "https://example.com/docs", text: "the docs" });
    expect(r.kind).toBe("found");
    if (r.kind === "found") {
      expect(r.match.text).toBe("the docs");
      expect(r.match.href).toBe("https://example.com/docs");
      expect(slice.slice(r.match.start, r.match.end)).toBe("[the docs](https://example.com/docs)");
    }
  });

  test("does not match an image token as a link", () => {
    const slice = "![alt](https://example.com/img.png)\n";
    const r = resolveLinkToken(slice, { href: "https://example.com/img.png", text: "alt" });
    expect(r.kind).not.toBe("found");
  });

  test("reference-style: [text][id] degrades", () => {
    const slice = "See [the docs][1] for more.\n";
    const r = resolveLinkToken(slice, { href: "https://example.com/docs", text: "the docs" });
    expect(r.kind).toBe("reference-style");
  });

  test("linkified bare URL degrades", () => {
    const slice = "Visit https://example.com directly.\n";
    const r = resolveLinkToken(slice, { href: "https://example.com", text: "https://example.com" });
    expect(r.kind).toBe("linkified");
  });

  test("not-found when neither pattern nor href text exists", () => {
    const slice = "Nothing here.\n";
    const r = resolveLinkToken(slice, { href: "https://example.com", text: "x" });
    expect(r.kind).toBe("not-found");
  });

  test("not-found with a null href", () => {
    expect(resolveLinkToken("text", { href: null, text: "x" }).kind).toBe("not-found");
  });
});

describe("spliceToken", () => {
  test("replaces the [start,end) region", () => {
    expect(spliceToken("abcdef", 2, 4, "XY")).toBe("abXYef");
  });
  test("zero-width insert", () => {
    expect(spliceToken("abcdef", 3, 3, "-")) .toBe("abc-def");
  });
});
