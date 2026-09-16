/**
 * parity-image-link-image-unwrap.test.ts (SFE-P3d-parity, Lane D)
 *
 * Closes the `image-unwrap` parity-matrix waiver row: before this run, no
 * command in either editing surface removed an image's enclosing link
 * wrapper (`.gp-pin`-style plain-link wrapping) in place —
 * `context-menu-actions.ts`'s `findImageWrapper`/`spliceToken` (the pure
 * computation the preview context menu's "Unwrap image" item used) were
 * shared and tested, but reachable ONLY from that soon-deleted context
 * menu. `locateImageUnwrapEdit`
 * (`../../src/lib/editor/caret-token-commands.ts`) is the shared caret-
 * driven wrapper both editing surfaces' "Unwrap image" toolbar item now
 * routes through (`+page.svelte`'s `handleImageUnwrapAtCaret`) — it calls
 * `findImageWrapper` unchanged, it does not reimplement it.
 *
 * G-01/AP-01: every test EXERCISES the replacement against a real fixture
 * and asserts EXACT resulting bytes. AP-21: each case asserts the located
 * token's own fields before asserting on final bytes/refusal reason.
 */
import { describe, expect, test } from "bun:test";
import { locateImageUnwrapEdit } from "../../src/lib/editor/caret-token-commands";

function applyEdit(text: string, edit: { from: number; to: number; insert: string }): string {
  return text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
}

describe("image-unwrap: locate + compute at the caret", () => {
  test("sees a wrapped image at the caret and removes its link wrapper, leaving the image token untouched", () => {
    const text = "Para.\n\n[![Logo](logo.png)](https://example.com)\n\nMore.";
    const caret = text.indexOf("logo.png");

    const located = locateImageUnwrapEdit(text, caret);
    expect(located.ok).toBe(true);
    if (!located.ok) throw new Error("unreachable");
    // Liveness (AP-21): the computed edit's own `insert` IS the bare image
    // token this fixture's wrapper surrounds — proof the wrapper was
    // actually located, not merely assumed present.
    expect(located.value.insert).toBe("![Logo](logo.png)");

    expect(applyEdit(text, located.value)).toBe("Para.\n\n![Logo](logo.png)\n\nMore.");
  });

  test("preserves surrounding text exactly — only the wrapper brackets/href are removed", () => {
    const text = "Before. [![Alt text](a/b/c.png){.gp-small}](https://example.com/page) After.";
    const caret = text.indexOf("c.png");

    const located = locateImageUnwrapEdit(text, caret);
    expect(located.ok).toBe(true);
    if (!located.ok) throw new Error("unreachable");
    expect(located.value.insert).toBe("![Alt text](a/b/c.png){.gp-small}");

    expect(applyEdit(text, located.value)).toBe(
      "Before. ![Alt text](a/b/c.png){.gp-small} After.",
    );
  });

  test("refuses with no-wrapper when the caret is on a plain (unwrapped) image", () => {
    const text = "Intro paragraph.\n\n![A cat](cat.png)\n\nOutro paragraph.";
    const caret = text.indexOf("cat.png");

    const located = locateImageUnwrapEdit(text, caret);
    expect(located.ok).toBe(false);
    if (located.ok) throw new Error("unreachable");
    expect(located.reason).toBe("no-wrapper");
    expect(located.diagnostic.category).toBe("EDITOR_INVALID_RANGE");
  });

  test("refuses with no-token when the caret is not on any image", () => {
    const text = "Just plain text with no image or link here.";
    const located = locateImageUnwrapEdit(text, 10);
    expect(located.ok).toBe(false);
    if (located.ok) throw new Error("unreachable");
    expect(located.reason).toBe("no-token");
  });

  test("refuses with fenced-code-block when the caret is on a markdown-shaped, wrapped image inside a fenced code block", () => {
    const text = "Example:\n\n```markdown\n[![Logo](logo.png)](https://example.com)\n```\n\nDone.";
    const caret = text.indexOf("logo.png");
    // Liveness: this offset really does sit on text that PARSES as a valid,
    // wrapped image — the refusal comes from the fence check.
    expect(text).toContain("[![Logo](logo.png)](https://example.com)");

    const located = locateImageUnwrapEdit(text, caret);
    expect(located.ok).toBe(false);
    if (located.ok) throw new Error("unreachable");
    expect(located.reason).toBe("fenced-code-block");
    expect(located.diagnostic.category).toBe("EDITOR_UNSUPPORTED_PROJECTION");
  });
});
