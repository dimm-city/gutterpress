/**
 * parity-image-link-image-properties.test.ts (SFE-P3d-parity, Lane D)
 *
 * Closes the `image-properties` parity-matrix waiver row: before this run,
 * no command in either editing surface edited an EXISTING image's
 * properties in place — `toolbar-actions.ts#applyImage` and
 * `rich-commands.ts#applyRichImageInsert` only ever INSERT a brand-new
 * image. `locateImageAtCaret`/`computeImagePropertiesEdit`
 * (`../../src/lib/editor/caret-token-commands.ts`) are the shared pure
 * computation both editing surfaces' "Image properties…" toolbar item now
 * routes through (`+page.svelte`'s `handleImagePropertiesAtCaret`).
 *
 * G-01/AP-01: every test below EXERCISES the replacement against a real
 * fixture and asserts EXACT resulting bytes — never "a function with this
 * name exists". AP-21: each success case asserts the located token's own
 * fields (proof the scanner actually ran and actually saw the real token)
 * BEFORE asserting on the final edit bytes; each refusal case asserts the
 * SPECIFIC typed reason, not just `ok === false`.
 */
import { describe, expect, test } from "bun:test";
import {
  locateImageAtCaret,
  computeImagePropertiesEdit,
} from "../../src/lib/editor/caret-token-commands";
import type { ImagePropertiesValue } from "../../src/lib/editor/image-classes";

function applyEdit(text: string, edit: { from: number; to: number; insert: string }): string {
  return text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
}

describe("image-properties: locate + compute at the caret", () => {
  test("sees a plain image at the caret and edits its alt/size, preserving everything else", () => {
    const text = "Intro paragraph.\n\n![A cat](cat.png)\n\nOutro paragraph.";
    const caret = text.indexOf("cat.png"); // caret mid-token, inside the destination

    const located = locateImageAtCaret(text, caret);
    expect(located.ok).toBe(true);
    if (!located.ok) throw new Error("unreachable");
    // Liveness (AP-21): prove the scanner actually found and parsed the
    // REAL token before touching the edit path at all.
    expect(located.value.match.src).toBe("cat.png");
    expect(located.value.match.alt).toBe("A cat");
    expect(located.value.match.attrsRaw).toBe("");
    expect(located.value.wrapper).toBeNull();
    expect(located.value.initial).toEqual({
      src: "cat.png",
      alt: "A cat",
      width: "",
      position: "",
      pinAlignment: "center",
      size: "",
      spacing: "",
      shape: false,
      flush: false,
      layer: "",
    } satisfies ImagePropertiesValue);

    const next: ImagePropertiesValue = { ...located.value.initial, alt: "A happy cat", size: "gp-large" };
    const edit = computeImagePropertiesEdit(located.value.match, located.value.initial, next);
    expect(edit).not.toBeNull();
    expect(applyEdit(text, edit!)).toBe(
      "Intro paragraph.\n\n![A happy cat](cat.png){.gp-large}\n\nOutro paragraph.",
    );
  });

  test("sees an image with existing classes and edits its position, preserving size and width", () => {
    const text = 'Para.\n\n![A dog](dog.png){.gp-right .gp-small width="200px"}\n\nMore.';
    const caret = text.indexOf("dog.png") + 2; // caret mid-destination

    const located = locateImageAtCaret(text, caret);
    expect(located.ok).toBe(true);
    if (!located.ok) throw new Error("unreachable");
    expect(located.value.initial).toEqual({
      src: "dog.png",
      alt: "A dog",
      width: "200px",
      position: "gp-right",
      pinAlignment: "center",
      size: "gp-small",
      spacing: "",
      shape: false,
      flush: false,
      layer: "",
    } satisfies ImagePropertiesValue);

    const next: ImagePropertiesValue = { ...located.value.initial, position: "gp-left" };
    const edit = computeImagePropertiesEdit(located.value.match, located.value.initial, next);
    expect(edit).not.toBeNull();
    expect(applyEdit(text, edit!)).toBe(
      'Para.\n\n![A dog](dog.png){.gp-left .gp-small width="200px"}\n\nMore.',
    );
  });

  test("sees a wrapped image at the caret and edits its alt, leaving the link wrapper untouched", () => {
    const text = "Para.\n\n[![Logo](logo.png)](https://example.com)\n\nMore.";
    const caret = text.indexOf("logo.png");

    const located = locateImageAtCaret(text, caret);
    expect(located.ok).toBe(true);
    if (!located.ok) throw new Error("unreachable");
    // Liveness: the wrapper IS found (this is the "wrapped image" fixture),
    // but image-properties only ever edits the inner image token.
    expect(located.value.wrapper).toEqual({ start: 7, end: 47, imageToken: "![Logo](logo.png)" });
    expect(located.value.initial.src).toBe("logo.png");

    const next: ImagePropertiesValue = { ...located.value.initial, alt: "Company logo" };
    const edit = computeImagePropertiesEdit(located.value.match, located.value.initial, next);
    expect(edit).not.toBeNull();
    expect(applyEdit(text, edit!)).toBe(
      "Para.\n\n[![Company logo](logo.png)](https://example.com)\n\nMore.",
    );
  });

  test("returns no edit when nothing in the properties actually changed", () => {
    const text = "![A cat](cat.png)";
    const located = locateImageAtCaret(text, 5);
    expect(located.ok).toBe(true);
    if (!located.ok) throw new Error("unreachable");
    const edit = computeImagePropertiesEdit(located.value.match, located.value.initial, {
      ...located.value.initial,
    });
    expect(edit).toBeNull();
  });

  test("refuses with no-token when the caret is not on any image", () => {
    const text = "Just plain text with no image or link here.";
    const located = locateImageAtCaret(text, 10);
    expect(located.ok).toBe(false);
    if (located.ok) throw new Error("unreachable");
    expect(located.reason).toBe("no-token");
    expect(located.diagnostic.category).toBe("EDITOR_INVALID_RANGE");
  });

  test("refuses with fenced-code-block when the caret is on a markdown-shaped image inside a fenced code block", () => {
    const text = "Example:\n\n```markdown\n![A cat](cat.png)\n```\n\nDone.";
    const caret = text.indexOf("cat.png");
    // Liveness: this offset really does sit on text that PARSES as a valid
    // image token — the refusal comes from the fence check, not from the
    // scanner failing to find anything.
    expect(text).toContain("![A cat](cat.png)");

    const located = locateImageAtCaret(text, caret);
    expect(located.ok).toBe(false);
    if (located.ok) throw new Error("unreachable");
    expect(located.reason).toBe("fenced-code-block");
    expect(located.diagnostic.category).toBe("EDITOR_UNSUPPORTED_PROJECTION");
  });
});
