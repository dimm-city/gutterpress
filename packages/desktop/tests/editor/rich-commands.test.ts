/**
 * rich-commands.test.ts (SFE-P3ab, Lane B)
 *
 * Pure-function coverage for `../../src/lib/editor/rich-commands.ts`:
 *   1. command routing (`routeToolbarAction`) — the source-vs-rich decision
 *      for every `ToolbarAction`;
 *   2. applying the shared P2a vocabulary / layout markers / images / plain
 *      appends against an `EditorDocumentHost` (`applyRichCommand`,
 *      `applyRichLayoutBlock`, `applyRichImageInsert`, `applyRichAppend`,
 *      `documentEndSelection`);
 *   3. image-properties validation/serialization
 *      (`validateImageProperties`, `buildImageInsertText`);
 *   4. block movement — `splitIntoBlocks`/`moveBlock`/`applyBlockMove`,
 *      every edge the run spec names explicitly: first/last block, marker
 *      boundaries, plugin regions, single-block doc.
 *
 * Uses `MemoryDocumentHost` (the package's own test host — `@dimm-city/
 * gutterpress-editor`) exactly like `desktop-document-host.test.ts` and
 * `rich-mode.test.ts` already do, so these tests exercise the REAL D3
 * `applyEdit`/stale/readonly/invalid-range behavior, not a mock.
 */
import { describe, expect, test } from "bun:test";
import { MemoryDocumentHost } from "@dimm-city/gutterpress-editor";
import type { ApplyEditResult, DocumentSnapshot, EditorDocumentHost, SourceEdit } from "@dimm-city/gutterpress-editor/core";
import {
  applyBlockMove,
  applyRichAppend,
  applyRichCommand,
  applyRichImageInsert,
  applyRichLayoutBlock,
  blockIndexAtOffset,
  buildImageInsertText,
  documentEndSelection,
  moveBlock,
  resolveRichSelection,
  routeToolbarAction,
  splitIntoBlocks,
  validateImageProperties,
  type LiveSelection,
  type SourceBlock,
} from "../../src/lib/editor/rich-commands";
import { descriptorForLayoutBlock, type LayoutBlockKind } from "../../src/lib/editor/toolbar-actions";
import type { ImagePropertiesValue } from "../../src/lib/editor/image-classes";

const blankImage: ImagePropertiesValue = {
  src: "",
  alt: "",
  width: "",
  position: "",
  pinAlignment: "center",
  size: "",
  spacing: "",
  shape: false,
  flush: false,
  layer: "",
};

// ── documentEndSelection ─────────────────────────────────────────────────────

describe("documentEndSelection", () => {
  test("is a collapsed range at the end of the current text", () => {
    const snapshot: DocumentSnapshot = { text: "hello world", version: 3 };
    expect(documentEndSelection(snapshot)).toEqual({ start: 11, endExclusive: 11 });
  });

  test("is [0, 0) for an empty document", () => {
    expect(documentEndSelection({ text: "", version: 0 })).toEqual({ start: 0, endExclusive: 0 });
  });
});

// ── resolveRichSelection (SFE-P3ab, Lane D) ────────────────────────────────────

describe("resolveRichSelection", () => {
  const snapshot: DocumentSnapshot = { text: "hello world", version: 3 };

  test("with no live selection, falls back to documentEndSelection", () => {
    expect(resolveRichSelection(snapshot)).toEqual(documentEndSelection(snapshot));
    expect(resolveRichSelection(snapshot, undefined)).toEqual(documentEndSelection(snapshot));
  });

  test("with a live COLLAPSED caret, converts {from,to} to {start,endExclusive} at that position", () => {
    const live: LiveSelection = { from: 5, to: 5 };
    expect(resolveRichSelection(snapshot, live)).toEqual({ start: 5, endExclusive: 5 });
  });

  test("with a live NON-collapsed selection, preserves the full range", () => {
    const live: LiveSelection = { from: 2, to: 7 };
    expect(resolveRichSelection(snapshot, live)).toEqual({ start: 2, endExclusive: 7 });
  });

  test("a live selection at [0, 0) is used verbatim, not treated as \"no selection\"", () => {
    // A falsy-looking {from: 0, to: 0} must still route through the LIVE
    // branch (a real caret at the document start), not be mistaken for
    // "live is undefined" by a truthiness check on the object's contents.
    const live: LiveSelection = { from: 0, to: 0 };
    expect(resolveRichSelection(snapshot, live)).toEqual({ start: 0, endExclusive: 0 });
  });
});

// ── applyRichCommand ──────────────────────────────────────────────────────────

describe("applyRichCommand", () => {
  test("toggle-bold appends a fresh **…** pair at the document end", () => {
    const host = new MemoryDocumentHost({ text: "para", version: 0 });
    const outcome = applyRichCommand(host, { kind: "toggle-bold" });
    expect(outcome.ok).toBe(true);
    expect(host.getSnapshot().text).toBe("para****");
    expect(host.getSnapshot().version).toBe(1);
  });

  test("insert-link with an explicit placeholder matches source mode's convention", () => {
    const host = new MemoryDocumentHost({ text: "see also: ", version: 0 });
    const outcome = applyRichCommand(host, { kind: "insert-link", href: "url", text: "link text" });
    expect(outcome.ok).toBe(true);
    expect(host.getSnapshot().text).toBe("see also: [link text](url)");
  });

  test("insert-horizontal-rule inserts the standard blank-line-padded rule", () => {
    const host = new MemoryDocumentHost({ text: "before", version: 0 });
    applyRichCommand(host, { kind: "insert-horizontal-rule" });
    expect(host.getSnapshot().text).toContain("before\n\n---\n\n");
  });

  test("insert-table inserts a table skeleton with the given column count", () => {
    const host = new MemoryDocumentHost({ text: "", version: 0 });
    applyRichCommand(host, { kind: "insert-table", rows: 1, cols: 2 });
    const text = host.getSnapshot().text;
    expect(text).toContain("| Header 1 | Header 2 |");
    expect(text).toContain("| Cell | Cell |");
  });

  test("set-heading applies a level that is not currently active", () => {
    const host = new MemoryDocumentHost({ text: "Plain line", version: 0 });
    const outcome = applyRichCommand(host, { kind: "set-heading", level: 2 });
    expect(outcome.ok).toBe(true);
    expect(host.getSnapshot().text).toBe("## Plain line");
  });

  test("set-heading TOGGLES OFF when the pressed level is already active at the last line (mirrors applyHeading)", () => {
    const host = new MemoryDocumentHost({ text: "## Already H2", version: 0 });
    const outcome = applyRichCommand(host, { kind: "set-heading", level: 2 });
    expect(outcome.ok).toBe(true);
    expect(host.getSnapshot().text).toBe("Already H2");
  });

  test("set-heading to a DIFFERENT level than the one active does not toggle off", () => {
    const host = new MemoryDocumentHost({ text: "## Already H2", version: 0 });
    applyRichCommand(host, { kind: "set-heading", level: 3 });
    expect(host.getSnapshot().text).toBe("### Already H2");
  });

  test("a refused command (fenced code block heading) reports EDITOR_INVALID_RANGE and changes nothing", () => {
    const host = new MemoryDocumentHost({ text: "```js\ncode here\n```", version: 0 });
    const before = host.getSnapshot();
    const outcome = applyRichCommand(host, { kind: "set-heading", level: 2 });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.diagnostic.category).toBe("EDITOR_INVALID_RANGE");
      expect(outcome.diagnostic.safeAction).toBeTruthy();
    }
    expect(host.getSnapshot()).toEqual(before);
  });

  test("a readonly host rejects with EDITOR_READONLY and changes nothing", () => {
    const host = new MemoryDocumentHost({ text: "text", version: 0 }, { readonly: true });
    const outcome = applyRichCommand(host, { kind: "toggle-bold" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.diagnostic.category).toBe("EDITOR_READONLY");
    expect(host.getSnapshot().text).toBe("text");
  });

  test("a stale expectedVersion (simulated via a fake host) reports EDITOR_STALE_EDIT", () => {
    const fakeHost: EditorDocumentHost = {
      getSnapshot: (): DocumentSnapshot => ({ text: "x", version: 5 }),
      applyEdit: (_edit: SourceEdit): ApplyEditResult => ({
        ok: false,
        reason: "stale",
        snapshot: { text: "x", version: 5 },
      }),
      replaceExternal: () => {},
      subscribe: () => () => {},
    };
    const outcome = applyRichCommand(fakeHost, { kind: "toggle-bold" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.diagnostic.category).toBe("EDITOR_STALE_EDIT");
  });

  // ── Live-selection routing (SFE-P3ab, Lane D) ──────────────────────────────

  test("with a live caret MID-DOCUMENT, toggle-bold wraps AT THE CARET, not the document end", () => {
    const host = new MemoryDocumentHost({ text: "one two three", version: 0 });
    const caret = "one ".length; // between "one " and "two three"
    const live: LiveSelection = { from: caret, to: caret };
    const outcome = applyRichCommand(host, { kind: "toggle-bold" }, live);
    expect(outcome.ok).toBe(true);
    // A collapsed caret produces a fresh, empty **|** pair spliced in AT the
    // caret -- proving this landed at offset 4, not at text.length (13).
    expect(host.getSnapshot().text).toBe("one ****two three");
  });

  test("with a live NON-COLLAPSED selection, toggle-bold wraps the SELECTED TEXT, not an insert at its end", () => {
    const host = new MemoryDocumentHost({ text: "one two three", version: 0 });
    const wordStart = "one ".length;
    const live: LiveSelection = { from: wordStart, to: wordStart + "two".length };
    const outcome = applyRichCommand(host, { kind: "toggle-bold" }, live);
    expect(outcome.ok).toBe(true);
    expect(host.getSnapshot().text).toBe("one **two** three");
  });

  test("with NO live selection supplied (the fallback path), behaves exactly like the pre-P3ab document-end anchor", () => {
    const host = new MemoryDocumentHost({ text: "one two", version: 0 });
    const outcome = applyRichCommand(host, { kind: "toggle-bold" });
    expect(outcome.ok).toBe(true);
    expect(host.getSnapshot().text).toBe("one two****");
  });

  test("an explicit undefined live selection is the SAME fallback as omitting the argument", () => {
    const host = new MemoryDocumentHost({ text: "one two", version: 0 });
    const outcome = applyRichCommand(host, { kind: "toggle-bold" }, undefined);
    expect(outcome.ok).toBe(true);
    expect(host.getSnapshot().text).toBe("one two****");
  });

  test("set-heading's toggle-off-when-already-active decision reads the LIVE selection's line, not the last line of the document", () => {
    // Two headings; the live caret sits on the FIRST one. Without live
    // routing this would read commandState against the document-end
    // selection (the SECOND heading's line) and reach the wrong verdict.
    const text = "## First\n\n## Second";
    const host = new MemoryDocumentHost({ text, version: 0 });
    const caret = 3; // inside "## First"
    const live: LiveSelection = { from: caret, to: caret };
    const outcome = applyRichCommand(host, { kind: "set-heading", level: 2 }, live);
    expect(outcome.ok).toBe(true);
    // Toggled OFF: the caret's own line lost its "## " prefix; the second
    // heading, untouched by this command, is unaffected.
    expect(host.getSnapshot().text).toBe("First\n\n## Second");
  });
});

// ── applyRichLayoutBlock ──────────────────────────────────────────────────────

describe("applyRichLayoutBlock", () => {
  const kinds: readonly LayoutBlockKind[] = ["chapter", "section", "two-column", "page-break", "spread"];

  test.each(kinds)("%s appends the SAME template descriptorForLayoutBlock computes (G-09: one template)", (kind) => {
    const host = new MemoryDocumentHost({ text: "intro", version: 0 });
    const outcome = applyRichLayoutBlock(host, kind);
    expect(outcome.ok).toBe(true);
    expect(host.getSnapshot().text).toBe("intro" + descriptorForLayoutBlock(kind).insert);
  });

  test("page-break reuses the canonical @page-break token", () => {
    const host = new MemoryDocumentHost({ text: "content", version: 0 });
    applyRichLayoutBlock(host, "page-break");
    expect(host.getSnapshot().text).toBe("content\n\n@page-break\n\n");
  });

  test("with a live caret MID-DOCUMENT, inserts the template AT the caret, not the document end (SFE-P3ab, Lane D)", () => {
    const host = new MemoryDocumentHost({ text: "before after", version: 0 });
    const caret = "before".length;
    const live: LiveSelection = { from: caret, to: caret };
    const outcome = applyRichLayoutBlock(host, "page-break", live);
    expect(outcome.ok).toBe(true);
    expect(host.getSnapshot().text).toBe("before\n\n@page-break\n\n after");
  });

  test("with NO live selection (the fallback), still lands at the document end", () => {
    const host = new MemoryDocumentHost({ text: "before after", version: 0 });
    const outcome = applyRichLayoutBlock(host, "page-break");
    expect(outcome.ok).toBe(true);
    expect(host.getSnapshot().text).toBe("before after\n\n@page-break\n\n");
  });
});

// ── applyRichAppend ────────────────────────────────────────────────────────────

describe("applyRichAppend", () => {
  test("appends arbitrary text at the document end", () => {
    const host = new MemoryDocumentHost({ text: "one", version: 0 });
    const outcome = applyRichAppend(host, "\n\ntwo");
    expect(outcome.ok).toBe(true);
    expect(host.getSnapshot().text).toBe("one\n\ntwo");
  });

  test("with a live COLLAPSED caret, inserts AT the caret rather than appending (SFE-P3ab, Lane D)", () => {
    const host = new MemoryDocumentHost({ text: "one two", version: 0 });
    const caret = "one ".length;
    const live: LiveSelection = { from: caret, to: caret };
    const outcome = applyRichAppend(host, "MID", live);
    expect(outcome.ok).toBe(true);
    expect(host.getSnapshot().text).toBe("one MIDtwo");
  });

  test("with a live NON-COLLAPSED selection, REPLACES the selected text — mirrors MarkdownEditor.insertSnippet's own replace-selection behavior in source mode", () => {
    const host = new MemoryDocumentHost({ text: "one two three", version: 0 });
    const wordStart = "one ".length;
    const live: LiveSelection = { from: wordStart, to: wordStart + "two".length };
    const outcome = applyRichAppend(host, "TWO", live);
    expect(outcome.ok).toBe(true);
    expect(host.getSnapshot().text).toBe("one TWO three");
  });
});

// ── Image validation + serialization ──────────────────────────────────────────

describe("validateImageProperties", () => {
  test("requires a non-blank src", () => {
    expect(validateImageProperties(blankImage)).toBe("Choose an image path or URL.");
    expect(validateImageProperties({ ...blankImage, src: "   " })).toBe("Choose an image path or URL.");
  });

  test("rejects width AND size set together", () => {
    const value = { ...blankImage, src: "a.png", width: "300px", size: "gp-small" };
    expect(validateImageProperties(value)).toBe(
      "Choose either a custom width or a preset size, not both.",
    );
  });

  test("rejects an unrecognized position/size/spacing/layer", () => {
    expect(validateImageProperties({ ...blankImage, src: "a.png", position: "not-real" })).toBe(
      "Choose image options from the lists.",
    );
    expect(validateImageProperties({ ...blankImage, src: "a.png", size: "not-real" })).toBe(
      "Choose image options from the lists.",
    );
  });

  test("a minimal valid value (src only) passes", () => {
    expect(validateImageProperties({ ...blankImage, src: "a.png" })).toBeUndefined();
  });

  test("a fully populated valid value passes", () => {
    const value: ImagePropertiesValue = {
      src: "images/cover.png",
      alt: "Cover art",
      width: "",
      position: "gp-pin",
      pinAlignment: "bottom-right",
      size: "",
      spacing: "gp-loose",
      shape: true,
      flush: true,
      layer: "gp-front",
    };
    expect(validateImageProperties(value)).toBeUndefined();
  });
});

describe("buildImageInsertText", () => {
  test("a minimal value (src + alt only) has no {…} attrs suffix", () => {
    const text = buildImageInsertText({ ...blankImage, src: "a.png", alt: "A" });
    expect(text).toBe("\n\n![A](a.png)\n\n");
  });

  test("a blank alt falls back to \"image\"", () => {
    const text = buildImageInsertText({ ...blankImage, src: "a.png" });
    expect(text).toContain("![image](a.png)");
  });

  test("width, position, size, and shape all serialize as gp-* tokens", () => {
    const text = buildImageInsertText({
      ...blankImage,
      src: "a.png",
      alt: "A",
      width: "300px",
      position: "gp-right",
      shape: true,
    });
    expect(text).toBe('\n\n![A](a.png){width="300px" .gp-right .gp-shape}\n\n');
  });

  test("pinAlignment tokens are added only when position is gp-pin", () => {
    const notPinned = buildImageInsertText({ ...blankImage, src: "a.png", position: "gp-left", pinAlignment: "top" });
    expect(notPinned).not.toContain("gp-top");

    const pinned = buildImageInsertText({ ...blankImage, src: "a.png", position: "gp-pin", pinAlignment: "top-left" });
    expect(pinned).toContain(".gp-pin");
    expect(pinned).toContain(".gp-top");
    expect(pinned).toContain(".gp-left");
  });

  test("spacing, flush, and layer all round-trip", () => {
    const text = buildImageInsertText({
      ...blankImage,
      src: "a.png",
      position: "gp-pin",
      pinAlignment: "center",
      spacing: "gp-tight",
      flush: true,
      layer: "gp-behind",
    });
    expect(text).toContain(".gp-tight");
    expect(text).toContain(".gp-flush");
    expect(text).toContain(".gp-behind");
  });
});

describe("applyRichImageInsert", () => {
  test("appends the built snippet at the document end and accepts the edit", () => {
    const host = new MemoryDocumentHost({ text: "para", version: 0 });
    const value = { ...blankImage, src: "cover.png", alt: "Cover" };
    const outcome = applyRichImageInsert(host, value);
    expect(outcome.ok).toBe(true);
    expect(host.getSnapshot().text).toBe("para" + buildImageInsertText(value));
  });

  test("with a live caret MID-DOCUMENT, inserts the built snippet AT the caret, not the document end (SFE-P3ab, Lane D)", () => {
    const host = new MemoryDocumentHost({ text: "before after", version: 0 });
    const caret = "before".length;
    const live: LiveSelection = { from: caret, to: caret };
    const value = { ...blankImage, src: "cover.png", alt: "Cover" };
    const outcome = applyRichImageInsert(host, value, live);
    expect(outcome.ok).toBe(true);
    expect(host.getSnapshot().text).toBe("before" + buildImageInsertText(value) + " after");
  });
});

// ── routeToolbarAction ────────────────────────────────────────────────────────

describe("routeToolbarAction", () => {
  test("bold/strikethrough/code map to their toggle commands", () => {
    expect(routeToolbarAction("bold")).toEqual({ kind: "command", command: { kind: "toggle-bold" } });
    expect(routeToolbarAction("strikethrough")).toEqual({ kind: "command", command: { kind: "toggle-strike" } });
    expect(routeToolbarAction("code")).toEqual({ kind: "command", command: { kind: "toggle-inline-code" } });
  });

  test("italic maps to the shared toggle-italic command (asterisk-canonical — a deliberate rich-mode divergence from CodeMirror's underscore-canonical applyItalic)", () => {
    expect(routeToolbarAction("italic")).toEqual({ kind: "command", command: { kind: "toggle-italic" } });
  });

  test("link supplies the same placeholder convention as applyLink", () => {
    expect(routeToolbarAction("link")).toEqual({
      kind: "command",
      command: { kind: "insert-link", href: "url", text: "link text" },
    });
  });

  test("blockquote/ul/ol map to their toggle commands", () => {
    expect(routeToolbarAction("blockquote")).toEqual({ kind: "command", command: { kind: "toggle-blockquote" } });
    expect(routeToolbarAction("ul")).toEqual({
      kind: "command",
      command: { kind: "toggle-list", variant: "bullet" },
    });
    expect(routeToolbarAction("ol")).toEqual({
      kind: "command",
      command: { kind: "toggle-list", variant: "ordered" },
    });
  });

  test("heading uses the payload's level, defaulting to 2 when omitted", () => {
    expect(routeToolbarAction("heading", { level: 4 })).toEqual({
      kind: "command",
      command: { kind: "set-heading", level: 4 },
    });
    expect(routeToolbarAction("heading")).toEqual({
      kind: "command",
      command: { kind: "set-heading", level: 2 },
    });
  });

  test("hr maps to insert-horizontal-rule", () => {
    expect(routeToolbarAction("hr")).toEqual({ kind: "command", command: { kind: "insert-horizontal-rule" } });
  });

  test("table uses the payload's column count, defaulting to 3, always rows: 1", () => {
    expect(routeToolbarAction("table", { cols: 5 })).toEqual({
      kind: "command",
      command: { kind: "insert-table", rows: 1, cols: 5 },
    });
    expect(routeToolbarAction("table")).toEqual({
      kind: "command",
      command: { kind: "insert-table", rows: 1, cols: 3 },
    });
  });

  test("page-break routes as a layout insertion, not a plain EditorCommand", () => {
    expect(routeToolbarAction("page-break")).toEqual({ kind: "layout", layout: "page-break" });
  });

  test("layout-block routes using the payload's kind", () => {
    expect(routeToolbarAction("layout-block", { kind: "spread" })).toEqual({ kind: "layout", layout: "spread" });
  });

  test("layout-block with no payload is unsupported (nothing to route)", () => {
    expect(routeToolbarAction("layout-block")).toEqual({ kind: "unsupported" });
  });

  test("image routes separately (the ImagePropertiesDialog flow, not applyRichCommand)", () => {
    expect(routeToolbarAction("image")).toEqual({ kind: "image" });
  });

  test("snippet and focus-mode are unsupported here (handled at the page level before routing)", () => {
    expect(routeToolbarAction("snippet")).toEqual({ kind: "unsupported" });
    expect(routeToolbarAction("focus-mode")).toEqual({ kind: "unsupported" });
  });
});

// ── splitIntoBlocks ────────────────────────────────────────────────────────────

function blockTexts(text: string, blocks: readonly SourceBlock[]): string[] {
  return blocks.map((b) => text.slice(b.from, b.to));
}

describe("splitIntoBlocks", () => {
  test("an empty document has no blocks", () => {
    expect(splitIntoBlocks("")).toEqual([]);
  });

  test("a document containing only blank lines has no blocks", () => {
    expect(splitIntoBlocks("\n\n\n")).toEqual([]);
  });

  test("single-block doc: one paragraph, no markers, no blank lines", () => {
    const text = "just one paragraph of prose";
    const blocks = splitIntoBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({ from: 0, to: text.length, isMarker: false });
  });

  test("blank-line-separated prose splits into one block per paragraph", () => {
    const text = "First.\n\nSecond.\n\nThird.";
    const blocks = splitIntoBlocks(text);
    // Each block's own trailing line terminator belongs to the GAP, not the
    // block (see splitIntoBlocks's header) — no block text ends in "\n".
    expect(blockTexts(text, blocks)).toEqual(["First.", "Second.", "Third."]);
    expect(blocks.every((b) => !b.isMarker)).toBe(true);
  });

  test("marker boundaries: a marker line is always its own solo block, never merged with prose", () => {
    const text = "stats\n\n@section\n\n@end-section\n\n";
    const blocks = splitIntoBlocks(text);
    expect(blockTexts(text, blocks)).toEqual(["stats", "@section", "@end-section"]);
    expect(blocks.map((b) => b.isMarker)).toEqual([false, true, true]);
  });

  test("marker boundaries: two ADJACENT marker lines (no blank line between) are never merged into one block", () => {
    const text = '@chapter "Intro"\n@page\n';
    const blocks = splitIntoBlocks(text);
    expect(blockTexts(text, blocks)).toEqual(['@chapter "Intro"', "@page"]);
    expect(blocks.every((b) => b.isMarker)).toBe(true);
  });

  test("plugin regions: a project-plugin marker (e.g. @sidebar) is recognized generically, same as a core marker", () => {
    const text = "@sidebar\nSidebar content.\n@end-sidebar";
    const blocks = splitIntoBlocks(text);
    expect(blockTexts(text, blocks)).toEqual(["@sidebar", "Sidebar content.", "@end-sidebar"]);
    expect(blocks.map((b) => b.isMarker)).toEqual([true, false, true]);
  });

  test("blocks partition the document contiguously with no overlaps, in source order", () => {
    const text = "one\n\n@page-break\n\ntwo\n\nthree";
    const blocks = splitIntoBlocks(text);
    for (let i = 1; i < blocks.length; i++) {
      expect(blocks[i]!.from).toBeGreaterThan(blocks[i - 1]!.to);
    }
    // Reassembling with the gaps recovers the exact original text.
    let rebuilt = text.slice(0, blocks[0]!.from);
    for (let i = 0; i < blocks.length; i++) {
      rebuilt += text.slice(blocks[i]!.from, blocks[i]!.to);
      const next = blocks[i + 1];
      rebuilt += next ? text.slice(blocks[i]!.to, next.from) : text.slice(blocks[i]!.to);
    }
    expect(rebuilt).toBe(text);
  });
});

// ── blockIndexAtOffset (SFE-P3ab, Lane D — the live-caret -> block-index mapping) ──

describe("blockIndexAtOffset", () => {
  test("a caret strictly INSIDE a block's own range belongs to that block", () => {
    const text = "First.\n\nSecond.\n\nThird.";
    const blocks = splitIntoBlocks(text);
    // Offset 10 falls inside "Second." (blocks[1]).
    expect(blocks[1]!.from).toBeLessThanOrEqual(10);
    expect(blocks[1]!.to).toBeGreaterThan(10);
    expect(blockIndexAtOffset(text, 10)).toBe(1);
  });

  test("a caret at a block's exact start offset belongs to that block", () => {
    const text = "First.\n\nSecond.";
    const blocks = splitIntoBlocks(text);
    expect(blockIndexAtOffset(text, blocks[1]!.from)).toBe(1);
  });

  test("a caret in a GAP (a blank line between two blocks) belongs to the PRECEDING block", () => {
    const text = "First.\n\nSecond.";
    // Offset 7 is the blank line between "First." (ends at 6) and
    // "Second." (starts at 8) -- squarely inside the gap.
    expect(blockIndexAtOffset(text, 7)).toBe(0);
  });

  test("a caret BEFORE every block (leading blank lines) has no owning block", () => {
    const text = "\n\nFirst.\n\nSecond.";
    // Offset 0 is before blocks[0].from (which starts after the leading
    // blank lines).
    const blocks = splitIntoBlocks(text);
    expect(blocks[0]!.from).toBeGreaterThan(0);
    expect(blockIndexAtOffset(text, 0)).toBeUndefined();
  });

  test("an empty document has no owning block at any offset", () => {
    expect(blockIndexAtOffset("", 0)).toBeUndefined();
  });

  test("a caret past the LAST block's end still belongs to that last block (trailing whitespace/EOF)", () => {
    const text = "First.\n\nSecond.";
    expect(blockIndexAtOffset(text, text.length)).toBe(1);
  });

  test("marker boundaries: a caret on a solo marker line resolves to that marker's own block, distinct from its prose neighbors", () => {
    const text = "Intro.\n\n@page-break\n\nOutro.";
    const blocks = splitIntoBlocks(text);
    const markerIndex = blocks.findIndex((b) => b.isMarker);
    const markerOffset = blocks[markerIndex]!.from + 1; // inside "@page-break"
    expect(blockIndexAtOffset(text, markerOffset)).toBe(markerIndex);
  });
});

// ── moveBlock ──────────────────────────────────────────────────────────────────

describe("moveBlock", () => {
  test("first/last block: moving the FIRST block UP refuses", () => {
    const text = "First.\n\nSecond.\n\nThird.";
    const result = moveBlock(text, 0, "up");
    expect(result).toEqual({ refused: true, reason: "first-block" });
  });

  test("first/last block: moving the LAST block DOWN refuses", () => {
    const text = "First.\n\nSecond.\n\nThird.";
    const blocks = splitIntoBlocks(text);
    const result = moveBlock(text, blocks.length - 1, "down");
    expect(result).toEqual({ refused: true, reason: "last-block" });
  });

  test("single-block doc: both directions refuse (no neighbor either way)", () => {
    const text = "the only block";
    expect(moveBlock(text, 0, "up")).toEqual({ refused: true, reason: "first-block" });
    expect(moveBlock(text, 0, "down")).toEqual({ refused: true, reason: "last-block" });
  });

  test("out-of-range block index refuses without touching the document", () => {
    const text = "First.\n\nSecond.";
    expect(moveBlock(text, 5, "up")).toEqual({ refused: true, reason: "out-of-range" });
    expect(moveBlock(text, -1, "down")).toEqual({ refused: true, reason: "out-of-range" });
  });

  test("swapping two adjacent prose blocks preserves the exact original gap and every other block's bytes", () => {
    const text = "First.\n\nSecond.\n\nThird.";
    const result = moveBlock(text, 0, "down"); // swap "First." and "Second."
    expect("edit" in result).toBe(true);
    if ("edit" in result) {
      const { from, to, insert } = result.edit;
      const rebuilt = text.slice(0, from) + insert + text.slice(to);
      expect(rebuilt).toBe("Second.\n\nFirst.\n\nThird.");
    }
  });

  test("marker boundaries: swapping a marker block with its prose neighbor keeps the marker's own bytes intact", () => {
    const text = "Intro paragraph.\n\n@page-break\n\nOutro paragraph.";
    const blocks = splitIntoBlocks(text);
    const markerIndex = blocks.findIndex((b) => b.isMarker);
    expect(markerIndex).toBeGreaterThan(-1);
    const result = moveBlock(text, markerIndex, "up"); // move @page-break above the intro
    expect("edit" in result).toBe(true);
    if ("edit" in result) {
      const { from, to, insert } = result.edit;
      const rebuilt = text.slice(0, from) + insert + text.slice(to);
      expect(rebuilt).toBe("@page-break\n\nIntro paragraph.\n\nOutro paragraph.");
      expect(rebuilt).toContain("@page-break"); // marker text survived byte-for-byte
    }
  });

  test("marker boundaries: swapping two adjacent marker blocks preserves both markers verbatim and the gap between them", () => {
    const text = "stats\n\n@section\n\n@end-section\n\n";
    const result = moveBlock(text, 1, "down"); // swap @section and @end-section
    expect("edit" in result).toBe(true);
    if ("edit" in result) {
      const { from, to, insert } = result.edit;
      const rebuilt = text.slice(0, from) + insert + text.slice(to);
      expect(rebuilt).toBe("stats\n\n@end-section\n\n@section\n\n");
    }
  });

  test("plugin regions: moving prose OUT from between two plugin markers is a plain adjacent swap (no region-nesting awareness — documented scope limit)", () => {
    const text = "@sidebar\nSidebar content.\n@end-sidebar";
    const blocks = splitIntoBlocks(text);
    expect(blocks).toHaveLength(3);
    const result = moveBlock(text, 1, "down"); // swap "Sidebar content." past "@end-sidebar"
    expect("edit" in result).toBe(true);
    if ("edit" in result) {
      const { from, to, insert } = result.edit;
      const rebuilt = text.slice(0, from) + insert + text.slice(to);
      expect(rebuilt).toBe("@sidebar\n@end-sidebar\nSidebar content.");
      // Both markers survive byte-for-byte even though the move crossed a
      // region boundary this pure function has no concept of pairing.
      expect(rebuilt).toContain("@sidebar");
      expect(rebuilt).toContain("@end-sidebar");
    }
  });

  test("leading and trailing whitespace outside any block is never touched by a swap", () => {
    const text = "\n\nFirst.\n\nSecond.\n\n\n";
    const result = moveBlock(text, 0, "down");
    expect("edit" in result).toBe(true);
    if ("edit" in result) {
      const { from, to, insert } = result.edit;
      const rebuilt = text.slice(0, from) + insert + text.slice(to);
      expect(rebuilt.startsWith("\n\n")).toBe(true);
      expect(rebuilt.endsWith("\n\n\n")).toBe(true);
      expect(rebuilt).toBe("\n\nSecond.\n\nFirst.\n\n\n");
    }
  });
});

// ── applyBlockMove (host integration) ─────────────────────────────────────────

describe("applyBlockMove", () => {
  test("applies an accepted move through the host", () => {
    const host = new MemoryDocumentHost({ text: "First.\n\nSecond.", version: 0 });
    const outcome = applyBlockMove(host, 0, "down");
    expect(outcome.ok).toBe(true);
    expect(host.getSnapshot().text).toBe("Second.\n\nFirst.");
    expect(host.getSnapshot().version).toBe(1);
  });

  test("a refused move (first block, up) reports a diagnostic and changes nothing", () => {
    const host = new MemoryDocumentHost({ text: "First.\n\nSecond.", version: 0 });
    const outcome = applyBlockMove(host, 0, "up");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.diagnostic.category).toBe("EDITOR_INVALID_RANGE");
      expect(outcome.diagnostic.message).toContain("first block");
    }
    expect(host.getSnapshot().text).toBe("First.\n\nSecond.");
    expect(host.getSnapshot().version).toBe(0);
  });

  test("a refused move (last block, down) reports a distinct diagnostic message", () => {
    const host = new MemoryDocumentHost({ text: "First.\n\nSecond.", version: 0 });
    const outcome = applyBlockMove(host, 1, "down");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.diagnostic.message).toContain("last block");
  });

  test("single-block doc via the host: both directions refuse without changing the snapshot", () => {
    const host = new MemoryDocumentHost({ text: "only one block here", version: 0 });
    expect(applyBlockMove(host, 0, "up").ok).toBe(false);
    expect(applyBlockMove(host, 0, "down").ok).toBe(false);
    expect(host.getSnapshot().version).toBe(0);
  });
});

// ── Caret-driven block move (SFE-P3ab, Lane D — the full keyboard-wiring
// pipeline: blockIndexAtOffset(host.getSnapshot().text, live.from) then
// applyBlockMove, exactly as +page.svelte's Alt+Shift+ArrowUp/Down handler
// composes them) ─────────────────────────────────────────────────────────

describe("caret-driven block move (blockIndexAtOffset + applyBlockMove composed, as the keyboard shortcut does)", () => {
  test("a live caret inside the SECOND block moves it up, past the first", () => {
    const host = new MemoryDocumentHost({ text: "First.\n\nSecond.\n\nThird.", version: 0 });
    const live: LiveSelection = { from: "First.\n\nSec".length, to: "First.\n\nSec".length };
    const blockIndex = blockIndexAtOffset(host.getSnapshot().text, live.from);
    expect(blockIndex).toBe(1); // "Second."
    const outcome = applyBlockMove(host, blockIndex!, "up");
    expect(outcome.ok).toBe(true);
    expect(host.getSnapshot().text).toBe("Second.\n\nFirst.\n\nThird.");
  });

  test("a live caret inside the FIRST block refuses to move up (nowhere to go), same diagnostic as the direct call", () => {
    const host = new MemoryDocumentHost({ text: "First.\n\nSecond.", version: 0 });
    const live: LiveSelection = { from: 2, to: 2 };
    const blockIndex = blockIndexAtOffset(host.getSnapshot().text, live.from);
    expect(blockIndex).toBe(0);
    const outcome = applyBlockMove(host, blockIndex!, "up");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.diagnostic.message).toContain("first block");
    expect(host.getSnapshot().text).toBe("First.\n\nSecond.");
  });

  test("with no live caret at all (never focused), there is no blockIndex to move — the caller's own null-check, not a refusal from applyBlockMove", () => {
    const host = new MemoryDocumentHost({ text: "First.\n\nSecond.", version: 0 });
    const live: LiveSelection | undefined = undefined;
    const blockIndex = live
      ? blockIndexAtOffset(host.getSnapshot().text, live.from)
      : undefined;
    expect(blockIndex).toBeUndefined();
    // Mirrors +page.svelte's own guard: with no blockIndex, applyBlockMove
    // is never called at all.
    expect(host.getSnapshot().text).toBe("First.\n\nSecond.");
    expect(host.getSnapshot().version).toBe(0);
  });

  test("moving a marker block by caret preserves its bytes exactly, same as the direct moveBlock call", () => {
    const host = new MemoryDocumentHost({ text: "Intro.\n\n@page-break\n\nOutro.", version: 0 });
    const markerOffset = "Intro.\n\n@page".length; // inside "@page-break"
    const blockIndex = blockIndexAtOffset(host.getSnapshot().text, markerOffset);
    const blocks = splitIntoBlocks(host.getSnapshot().text);
    expect(blocks[blockIndex!]!.isMarker).toBe(true);
    const outcome = applyBlockMove(host, blockIndex!, "down");
    expect(outcome.ok).toBe(true);
    expect(host.getSnapshot().text).toBe("Intro.\n\nOutro.\n\n@page-break");
    expect(host.getSnapshot().text).toContain("@page-break");
  });
});
