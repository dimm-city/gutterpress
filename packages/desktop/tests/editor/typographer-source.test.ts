import { describe, expect, test } from "bun:test";
import {
  createDocParser,
  createEditorRenderer,
  normalize,
} from "../../src/lib/editor/markdown-doc";

/**
 * Typographer/linkify must never reach the author's bytes.
 *
 * Both rules rewrite TEXT before the ProseMirror doc exists, so a doc model
 * built with them on bakes `’`/`“”`/`–`/`…`/`©` and rewritten URLs into the
 * file on save — and both round-trip gates are blind to the loss by
 * construction (stable on the second pass, render-identical). The fix is the
 * per-parse flip in `createDocParser(...).parse()`: both options off for the
 * duration of the doc-model parse, restored in a `finally`. This suite pins
 * the two properties that make it correct: the author's raw substitutions
 * survive a save byte-identically, and a THROWING parse — the routine path
 * through that choke point — never leaks the flip onto the shared instance.
 */

describe("typographer/linkify input survives normalize byte-identically", () => {
  const cases: Record<string, string> = {
    "straight quotes": 'She said "never" and it wasn\'t over.\n',
    "dashes and ellipsis": "One -- two --- three... and so on.\n",
    "symbol replacements": "Copyright (c), trademark (tm), registered (r).\n",
    "bare URL": "Visit https://example.com for details.\n",
  };

  for (const [name, src] of Object.entries(cases)) {
    test(name, () => {
      const md = createEditorRenderer();
      const once = normalize(md, src);
      expect(once).toBe(src);
      expect(normalize(md, once)).toBe(src);
    });
  }

  test("KNOWN EDGE: a paragraph-leading `--` gains a `\\-` escape on first save", () => {
    // Previously typographer rewrote the leading `--` to `–` before the doc
    // model existed, so the serializer saw no dash — and the en dash was
    // baked into the author's file (the defect fixed here). With typographer
    // off the doc holds the authored `--`, and prosemirror-markdown's
    // start-of-line escape writes it back as `\--` so the reparse cannot
    // read it as a list bullet. The documented, accepted first-save edge:
    // the second save is a fixpoint, but the escape DOES change print — an
    // escape splits the text token, and markdown-it 14 joins text AFTER
    // `replacements`/`smartquotes`, so `\--` prints literally as `--`, not
    // as an en dash. No corpus file starts a paragraph this way; table
    // cells, where the corpus does hit the shape, strip the escape in
    // `cellText` instead (a cell is an inline context with no list to guard
    // against — see serializer.ts).
    const src = "-- a dash-led line, not a list.\n";
    const md = createEditorRenderer();
    const once = normalize(md, src);
    expect(once).toBe("\\-- a dash-led line, not a list.\n");
    expect(normalize(md, once)).toBe(once);
  });
});

describe("a throwing parse never leaks the flip onto the shared instance", () => {
  // The md instance is a session-long shared cache (`project-renderer.ts`),
  // and throwing is the ROUTINE path through the parse choke point. A leaked
  // `typographer:false` would quietly blind every later render — preview and
  // the semantic gates included — starting at the first refused file.
  test("options are restored and a later render still typographs + linkifies", () => {
    const md = createEditorRenderer();
    const parser = createDocParser(md);

    // The explicit reference-definition raise, inside the flipped window.
    expect(() => parser.parse("[ref]: https://example.com\n\nSee [ref].\n")).toThrow(
      /reference/,
    );
    expect(md.options.typographer).toBe(true);
    expect(md.options.linkify).toBe(true);

    // The library raise (unknown token type) — the other routine throw path.
    expect(() => parser.parse("A claim.[^1]\n\n[^1]: Source.\n")).toThrow();
    expect(md.options.typographer).toBe(true);
    expect(md.options.linkify).toBe(true);

    const html = md.render('He said "hello" -- see https://example.com now.\n', {});
    expect(html).toContain("“hello”");
    expect(html).toContain("–");
    expect(html).toContain('<a href="https://example.com"');
  });
});
