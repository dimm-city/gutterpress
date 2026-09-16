/**
 * parity-image-link-link-edit.test.ts (SFE-P3d-parity, Lane D)
 *
 * Closes the `link-edit` parity-matrix waiver row: before this run, no
 * command in either editing surface edited an EXISTING link's target in
 * place — `toolbar-actions.ts#applyLink` and the rich `insert-link` command
 * both only ever wrap a selection as a NEW link (that is `format-link`'s
 * job, a genuinely different operation — see the mapped-actions table's own
 * note on this distinction). `locateLinkAtCaret`/`computeLinkEditEdit`
 * (`../../src/lib/editor/caret-token-commands.ts`) are the shared pure
 * computation both editing surfaces' "Edit link…" toolbar item now routes
 * through (`+page.svelte`'s `handleLinkEditAtCaret`) — `rewriteLinkToken`
 * itself is unchanged, reused exactly as the preview context menu's own
 * "Edit link…" item used it.
 *
 * G-01/AP-01: every test EXERCISES the replacement against a real fixture
 * and asserts EXACT resulting bytes. AP-21: each case asserts the located
 * token's own fields (or, for a refusal, that the fixture text really does
 * contain link-shaped syntax) before asserting on final bytes/reason.
 */
import { describe, expect, test } from "bun:test";
import { locateLinkAtCaret, computeLinkEditEdit } from "../../src/lib/editor/caret-token-commands";

function applyEdit(text: string, edit: { from: number; to: number; insert: string }): string {
  return text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
}

describe("link-edit: locate + compute at the caret", () => {
  test("sees an inline link with a title at the caret and edits its href, preserving the title", () => {
    const text = 'Read the [manual](https://old.example.com/manual "User Manual") today.';
    const caret = text.indexOf("manual](") + 2; // caret inside the link's label text

    const located = locateLinkAtCaret(text, caret);
    expect(located.ok).toBe(true);
    if (!located.ok) throw new Error("unreachable");
    // Liveness (AP-21): prove the scanner actually found and parsed the
    // REAL link token, title included, before touching the edit path.
    expect(located.value.match.tokenRaw).toBe(
      '[manual](https://old.example.com/manual "User Manual")',
    );
    expect(located.value.initialHref).toBe("https://old.example.com/manual");

    const edit = computeLinkEditEdit(located.value.match, "https://new.example.com/manual");
    expect(applyEdit(text, edit)).toBe(
      'Read the [manual](https://new.example.com/manual "User Manual") today.',
    );
  });

  test("sees a plain inline link (no title) at the caret and edits its href, leaving the label untouched", () => {
    const text = "See the [docs](old-path.html) for details.";
    const caret = text.indexOf("old-path.html");

    const located = locateLinkAtCaret(text, caret);
    expect(located.ok).toBe(true);
    if (!located.ok) throw new Error("unreachable");
    expect(located.value.initialHref).toBe("old-path.html");

    const edit = computeLinkEditEdit(located.value.match, "new-path.html");
    expect(applyEdit(text, edit)).toBe("See the [docs](new-path.html) for details.");
  });

  test("refuses with no-token when the caret is on a reference-style link", () => {
    const text = "See [docs][ref] for more.\n\n[ref]: https://example.com/docs";
    const caret = text.indexOf("docs][ref]") + 2;
    // Liveness: this fixture really is a reference-style link, not a typo —
    // it just has no `(...)` destination for the caret-driven scanner to
    // resolve inline (the same shape the preview context menu's own
    // `resolveLinkToken` reports as `"reference-style"`).
    expect(text).toContain("[docs][ref]");

    const located = locateLinkAtCaret(text, caret);
    expect(located.ok).toBe(false);
    if (located.ok) throw new Error("unreachable");
    expect(located.reason).toBe("no-token");
    expect(located.diagnostic.category).toBe("EDITOR_INVALID_RANGE");
  });

  test("refuses with no-token when the caret is on a bare (linkified) URL", () => {
    const text = "Visit https://example.com/page for details.";
    const caret = text.indexOf("example.com");

    const located = locateLinkAtCaret(text, caret);
    expect(located.ok).toBe(false);
    if (located.ok) throw new Error("unreachable");
    expect(located.reason).toBe("no-token");
  });

  test("refuses with no-token when the caret is not on any link", () => {
    const text = "Just plain text with no image or link here.";
    const located = locateLinkAtCaret(text, 10);
    expect(located.ok).toBe(false);
    if (located.ok) throw new Error("unreachable");
    expect(located.reason).toBe("no-token");
  });

  test("refuses with fenced-code-block when the caret is on a markdown-shaped link inside a fenced code block", () => {
    const text = 'Example:\n\n```markdown\n[manual](https://old.example.com/manual "User Manual")\n```\n\nDone.';
    const caret = text.indexOf("old.example.com");
    // Liveness: this offset really does sit on text that PARSES as a valid
    // link — the refusal comes from the fence check, not from the scanner
    // failing to find anything.
    expect(text).toContain('[manual](https://old.example.com/manual "User Manual")');

    const located = locateLinkAtCaret(text, caret);
    expect(located.ok).toBe(false);
    if (located.ok) throw new Error("unreachable");
    expect(located.reason).toBe("fenced-code-block");
    expect(located.diagnostic.category).toBe("EDITOR_UNSUPPORTED_PROJECTION");
  });

  test("does not confuse an image's brackets for a link at the same caret", () => {
    const text = "![A cat](cat.png) and [a real link](https://example.com).";
    const imageCaret = text.indexOf("cat.png");

    const located = locateLinkAtCaret(text, imageCaret);
    expect(located.ok).toBe(false);
    if (located.ok) throw new Error("unreachable");
    expect(located.reason).toBe("no-token");
  });
});
