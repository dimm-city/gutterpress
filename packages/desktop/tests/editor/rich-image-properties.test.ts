import { describe, expect, test } from "bun:test";
import { Fragment, Slice, type Node as PMNode } from "prosemirror-model";
import {
  applyImageProperties,
  imageAttrsToTokens,
  readImageProperties,
  tokensToImageAttrs,
  type ImagePropertiesValue,
} from "../../src/lib/editor/image-classes";
import type { ExtraAttrs } from "../../src/lib/editor/markdown-doc/attrs";
import {
  createDocParser,
  createEditorRenderer,
  serializeDoc,
} from "../../src/lib/editor/markdown-doc";

/**
 * Adjusting an image from the RICH surface.
 *
 * Rich mode could insert an image and never change one: position, size,
 * spacing, the `.gp-pin` edges and the shape-wrap toggle were reachable only
 * by right-clicking the image in the PREVIEW pane. For a book laid out around
 * its art, that is most of the layout work done in the wrong pane — and the
 * reason the surface meant to be the PRIMARY one could not do the job.
 *
 * The editing itself is `image-classes`, shared with the context menu, so
 * what these tests hold is the part that is new: the document model keeps an
 * attribute MAP and the vocabulary edits a TOKEN LIST, and a book's bytes
 * depend on that conversion being exact in both directions.
 */

const md = createEditorRenderer();
const parse = (src: string) => createDocParser(md).parse(src);

/** The document's first image node. */
function imageIn(doc: PMNode): PMNode {
  let found: PMNode | null = null;
  doc.descendants((node) => {
    if (!found && node.type.name === "image") found = node;
    return !found;
  });
  if (!found) throw new Error("no image in document");
  return found;
}

/** Where that image sits. */
function positionOf(doc: PMNode): number {
  let at = -1;
  doc.descendants((node, pos) => {
    if (at === -1 && node.type.name === "image") at = pos;
    return at === -1;
  });
  return at;
}

/**
 * What `RichEditorHandle.setSelectedImage` does, minus the ProseMirror view.
 *
 * The handle reads the node's attrs, runs them through the shared vocabulary,
 * and writes the result back with `setNodeMarkup`; this does the same with a
 * one-node slice, so the test measures the CONVERSION and the serialized
 * bytes rather than a mounted editor. Refusals come back as a string so the
 * assertions can name the sentence the author would see.
 */
function edit(src: string, change: Partial<ImagePropertiesValue>): string {
  const doc = parse(src);
  const node = imageIn(doc);
  const tokens = imageAttrsToTokens(node.attrs.attrs as ExtraAttrs | null);
  const initial = readImageProperties(
    node.attrs.src as string,
    (node.attrs.alt as string) ?? "",
    tokens,
  );
  const next = { ...initial, ...change };
  const applied = applyImageProperties(tokens, initial, next);
  if ("error" in applied) return `ERROR: ${applied.error}`;
  const replaced = node.type.create({
    ...node.attrs,
    src: next.src.trim(),
    alt: next.alt || null,
    attrs: tokensToImageAttrs(applied.tokens),
  });
  const at = positionOf(doc);
  return serializeDoc(
    doc.replace(at, at + node.nodeSize, new Slice(Fragment.from(replaced), 0, 0)),
  );
}

describe("image attrs ↔ vocabulary tokens", () => {
  test("round-trips an untouched attribute set byte-for-byte", () => {
    const src = "![Art](art.jpg){.gp-right .my-note #fig width=3in}\n";
    const doc = parse(src);
    const attrs = imageIn(doc).attrs.attrs as ExtraAttrs | null;
    const tokens = imageAttrsToTokens(attrs);
    expect(tokensToImageAttrs(tokens)).toEqual(attrs);
    expect(serializeDoc(doc)).toBe(src);
  });

  test("no attributes is null, not an empty brace block", () => {
    expect(imageAttrsToTokens(null)).toEqual([]);
    expect(tokensToImageAttrs([])).toBeNull();
  });

  test("an unrecognized token survives a facet change", () => {
    // The whole reason the vocabulary edits tokens rather than rebuilding
    // from a parsed shape: `.my-note`, `#fig` and `data-x` mean nothing to it
    // and must come back untouched.
    const out = edit("![Art](art.jpg){.gp-right .my-note #fig data-x=\"a b\"}\n", {
      position: "gp-left",
    });
    expect(out).toContain(".gp-left");
    expect(out).not.toContain(".gp-right");
    expect(out).toContain(".my-note");
    expect(out).toContain("#fig");
    expect(out).toContain('data-x="a b"');
  });
});

describe("editing the selected image", () => {
  test("sets a position on an image that had none", () => {
    expect(edit("![Art](art.jpg)\n", { position: "gp-bleed" })).toBe(
      "![Art](art.jpg){.gp-bleed}\n",
    );
  });

  test("clears a position back to none", () => {
    expect(edit("![Art](art.jpg){.gp-right}\n", { position: "" })).toBe("![Art](art.jpg)\n");
  });

  test("a pinned image keeps its edges together", () => {
    const out = edit("![Art](art.jpg)\n", { position: "gp-pin", pinAlignment: "bottom-right" });
    expect(out).toContain(".gp-pin");
    expect(out).toContain(".gp-bottom");
    expect(out).toContain(".gp-right");
  });

  test("changes src and alt", () => {
    expect(edit("![Art](art.jpg){.gp-left}\n", { src: "new.png", alt: "New" })).toBe(
      "![New](new.png){.gp-left}\n",
    );
  });

  test("width and a preset size together are refused, not silently merged", () => {
    expect(edit("![Art](art.jpg)\n", { width: "3in", size: "gp-small" })).toBe(
      "ERROR: Choose either a custom width or a preset size, not both.",
    );
  });

  test("an empty src is refused", () => {
    expect(edit("![Art](art.jpg)\n", { src: "  " })).toBe("ERROR: Choose an image path or URL.");
  });

  test("a value outside the vocabulary is refused", () => {
    expect(edit("![Art](art.jpg)\n", { position: "gp-sideways" })).toBe(
      "ERROR: Choose image options from the lists.",
    );
  });
});
