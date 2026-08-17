import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { undo } from "prosemirror-history";
import { NodeSelection, TextSelection } from "prosemirror-state";
import { blockAtDom, blockPosFor } from "../../src/lib/editor/rich-drag-handle";
import type {
  RichToolbarAction,
  ToolbarPayloadLike,
} from "../../src/lib/editor/rich-commands";
import { createEditorState, mountRichEditor } from "../../src/lib/editor/rich-editor";
import { createEditorRenderer, gutterpressSchema, serializeDoc } from "../../src/lib/editor/markdown-doc";
import {
  lineForPos,
  lineTable,
  posForLine,
  resetLineTableCache,
} from "../../src/lib/editor/rich-lines";

/**
 * The editing surface, headless.
 *
 * DOM is happy-dom (the harness `tests/platform/dialog.test.ts` uses). It does
 * no layout, so nothing here asserts geometry — pagination is CSS and is
 * covered by `paginate.test.ts` and the reasoning recorded in `paginate.ts`'s
 * header.
 *
 * The property these tests exist for is the one the postmortem lost: an edit
 * must land in the author's file as the author's markdown, and the surface
 * must never be able to write back something the pipeline generated.
 */
const md = createEditorRenderer();

/**
 * ProseMirror's `EditorView` reads the globals directly — `window` for its
 * `MutationObserver` and `document` when building nodes — so a happy-dom
 * Window has to be installed globally for the duration of a test rather than
 * only passed in.
 */
function editor(content: string, onChange?: (s: string) => void) {
  const win = new Window();
  const g = globalThis as unknown as Record<string, unknown>;
  const prior = { window: g.window, document: g.document };
  g.window = win;
  g.document = win.document;

  const doc = win.document as unknown as Document;
  const mount = doc.createElement("div");
  doc.body.appendChild(mount);
  const handle = mountRichEditor({ mount, md, content, onChange });
  return {
    handle,
    mount,
    doc,
    win: win as unknown as Record<string, new (type: string, init?: unknown) => Event>,
    restore() {
      handle.destroy();
      g.window = prior.window;
      g.document = prior.document;
    },
  };
}

describe("document model wiring", () => {
  test("a mounted editor round-trips its content unchanged", () => {
    const src = "# Title\n\nSome **bold** and `code`.\n";
    const e = editor(src);
    expect(e.handle.getMarkdown()).toBe(src);
    e.restore();
  });

  test("onChange emits canonical markdown, not HTML or a doc", () => {
    const seen: string[] = [];
    const e = editor("Hello\n", (s) => seen.push(s));
    const { view } = e.handle;
    // Type " world" at the end of the paragraph.
    view.dispatch(view.state.tr.insertText(" world", view.state.doc.content.size - 1));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe("Hello world\n");
    e.restore();
  });

  test("onChange does NOT fire for a selection-only transaction", () => {
    const seen: string[] = [];
    const e = editor("Hello\n", (s) => seen.push(s));
    const { view } = e.handle;
    view.dispatch(view.state.tr.setMeta("pointer", true));
    expect(seen).toEqual([]);
    e.restore();
  });

  test("setContent replaces the document for a file switch", () => {
    const e = editor("# One\n");
    e.handle.setContent("# Two\n");
    expect(e.handle.getMarkdown()).toBe("# Two\n");
    e.restore();
  });

  test("setContent is not undoable back into the previous FILE", () => {
    // Undo crossing a file switch would write one chapter's text into another
    // — silently, and into a file the author is not looking at.
    const e = editor("# One\n");
    e.handle.setContent("# Two\n");
    const { view } = e.handle;
    expect(undo(view.state, view.dispatch)).toBe(false);
    expect(e.handle.getMarkdown()).toBe("# Two\n");
    e.restore();
  });

  test("an ordinary edit IS undoable", () => {
    // The guard above must come from a fresh history, not from history being
    // broken.
    const e = editor("Hello\n");
    const { view } = e.handle;
    view.dispatch(view.state.tr.insertText("!", view.state.doc.content.size - 1));
    expect(e.handle.getMarkdown()).toBe("Hello!\n");
    expect(undo(view.state, view.dispatch)).toBe(true);
    expect(e.handle.getMarkdown()).toBe("Hello\n");
    e.restore();
  });
});

describe("Gutterpress markers survive the surface", () => {
  test("layout markers round-trip verbatim", () => {
    const src = "@chapter Introduction\n\n@page .wide\n\nHello\n\n@page-break\n";
    const e = editor(src);
    expect(e.handle.getMarkdown()).toBe(src);
    e.restore();
  });

  test("a marker's classes reach the DOM so book CSS applies", () => {
    // This is what makes the editor look like the print output: the book
    // styles `.page` and the author's own `.wide`, and the editing view must
    // emit both.
    const e = editor("@page .wide\n\nHello\n");
    expect(e.mount.innerHTML).toContain("page wide");
    e.restore();
  });

  test("editing inside a marker does not disturb the marker line", () => {
    const src = "@page .wide\n\nHello\n";
    const e = editor(src);
    const { view } = e.handle;
    view.dispatch(view.state.tr.insertText("!", view.state.doc.content.size - 2));
    expect(e.handle.getMarkdown()).toBe("@page .wide\n\nHello!\n");
    e.restore();
  });
});

describe("generated content is decoration, never document", () => {
  test("the chapter opener is visible in the editor", () => {
    // print shows it, so the editor must too
    const e = editor("@chapter Introduction\n\nBody text.\n");
    expect(e.mount.innerHTML).toContain("chapter-opener");
    expect(e.mount.innerHTML).toContain("Introduction");
    e.restore();
  });

  test("but it can never be written back to the file", () => {
    // The postmortem's failure mode was generated content becoming authored
    // content on save. A widget decoration lives in the view, not the
    // document, so there is no path from it to the serializer.
    const src = "@chapter Introduction\n\nBody text.\n";
    const e = editor(src);
    expect(e.handle.getMarkdown()).toBe(src);
    expect(e.handle.getMarkdown()).not.toContain("chapter-opener");
    e.restore();
  });
});

describe("raw HTML", () => {
  test("is carried verbatim rather than reinterpreted", () => {
    const src = '<div class="custom">\n  <span>raw</span>\n</div>\n';
    const e = editor(src);
    expect(e.handle.getMarkdown()).toBe(src);
    e.restore();
  });
});

describe("editor state", () => {
  test("createEditorState needs no DOM", () => {
    // Keeps the state layer testable and the component shell thin.
    const state = createEditorState(md, "# Hi\n");
    expect(state.doc.firstChild?.type.name).toBe("heading");
  });

  test("the surface carries history, input rules and a keymap", () => {
    const state = createEditorState(md, "x\n");
    // 7 plugins: keymap, baseKeymap, inputRules, history, dropCursor,
    // gapCursor, generated-content decorations.
    expect(state.plugins.length).toBe(7);
  });
});

describe("toolbar actions", () => {
  /** Apply an action to `src` with the caret in the first block, return markdown. */
  function act(src: string, action: RichToolbarAction, payload?: ToolbarPayloadLike) {
    const e = editor(src);
    const { view } = e.handle;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
    const applied = e.handle.runToolbarAction(action, payload);
    const out = e.handle.getMarkdown();
    e.restore();
    return { applied, out };
  }

  test("block actions produce the expected markdown", () => {
    expect(act("plain\n", "heading", { level: 2 }).out).toBe("## plain\n");
    expect(act("plain\n", "blockquote").out).toBe("> plain\n");
    expect(act("plain\n", "ul").out).toBe("* plain\n");
    expect(act("plain\n", "ol").out).toBe("1. plain\n");
  });

  test("heading toggles back to a paragraph at the same level", () => {
    // Matches the CodeMirror behaviour, so the button feels the same in both.
    expect(act("## already\n", "heading", { level: 2 }).out).toBe("already\n");
  });

  test("layout blocks emit real markers that round-trip", () => {
    const chapter = act("x\n", "layout-block", { kind: "chapter" }).out;
    expect(chapter).toContain('@chapter "Chapter Title"');
    expect(chapter).toContain("@page");

    const section = act("x\n", "layout-block", { kind: "section" }).out;
    expect(section).toContain("@section");
    expect(section).toContain("@end-section");

    const twoCol = act("x\n", "layout-block", { kind: "two-column" }).out;
    expect(twoCol).toContain("@section .gp-columns-2");
    expect(twoCol).toContain("@column-break");

    expect(act("x\n", "page-break").out).toContain("@page-break");
  });

  test("an inserted table keeps its structure", () => {
    const out = act("x\n", "table", { cols: 3 }).out;
    expect(out).toContain("| Header 1 | Header 2 | Header 3 |");
    expect(out).toContain("| Cell | Cell | Cell |");
  });

  test("image classes are built by the SAME code as source mode", () => {
    // buildImageAttrsString() is shared with toolbar-actions.ts, so the two
    // modes cannot drift on what `.gp-right .gp-small` means.
    const out = act("x\n", "image", {
      src: "a.png", alt: "Art", position: "right", size: "small",
    }).out;
    expect(out).toContain("![Art](a.png)");
    expect(out).toContain(".gp-right");
    expect(out).toContain(".gp-small");
  });

  test("strikethrough works, and the file stays rich-editable", () => {
    const e = editor("plain\n");
    const { view } = e.handle;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6)));
    expect(e.handle.runToolbarAction("strikethrough")).toBe(true);
    expect(e.handle.getMarkdown()).toBe("~~plain~~\n");
    e.restore();
  });

  test("an action whose payload is missing reports false rather than guessing", () => {
    const e = editor("x\n");
    expect(e.handle.runToolbarAction("image")).toBe(false);
    expect(e.handle.runToolbarAction("layout-block")).toBe(false);
    expect(e.handle.getMarkdown()).toBe("x\n");
    e.restore();
  });
});

describe("source-offset edits (CommitEngine)", () => {
  test("applies when the document matches the file on disk", () => {
    const src = "Hello world\n";
    const e = editor(src);
    expect(e.handle.canApplySourceOffsets(src)).toBe(true);
    expect(e.handle.applyRangeEdit(src, 6, 11, "there")).toBe(true);
    expect(e.handle.getMarkdown()).toBe("Hello there\n");
    e.restore();
  });

  test("REFUSES when the document does not match the offsets' basis", () => {
    // The canonical form of `+ one` is `* one`, so a project that has not been
    // normalized has offsets that point somewhere else. Writing anyway would
    // corrupt the file at a position the author never chose.
    const onDisk = "+ one\n";
    const e = editor(onDisk);
    expect(e.handle.canApplySourceOffsets(onDisk)).toBe(false);
    expect(e.handle.applyRangeEdit(onDisk, 2, 5, "two")).toBe(false);
    expect(e.handle.getMarkdown()).toBe("* one\n");
    e.restore();
  });

  test("REFUSES out-of-bounds offsets", () => {
    const src = "Hello\n";
    const e = editor(src);
    expect(e.handle.applyRangeEdit(src, 0, 999, "x")).toBe(false);
    expect(e.handle.applyRangeEdit(src, -1, 2, "x")).toBe(false);
    expect(e.handle.getMarkdown()).toBe(src);
    e.restore();
  });

  test("an applied edit is undoable — it is one history step", () => {
    const src = "Hello world\n";
    const e = editor(src);
    e.handle.applyRangeEdit(src, 6, 11, "there");
    const { view } = e.handle;
    expect(undo(view.state, view.dispatch)).toBe(true);
    expect(e.handle.getMarkdown()).toBe(src);
    e.restore();
  });
});

describe("selection and snippets", () => {
  test("getSelectionText returns the selected text", () => {
    const e = editor("Hello world\n");
    const { view } = e.handle;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6)));
    expect(e.handle.getSelectionText()).toBe("Hello");
    e.restore();
  });

  test("getSelectionText is empty with no selection", () => {
    const e = editor("Hello\n");
    expect(e.handle.getSelectionText()).toBe("");
    e.restore();
  });

  test("insertSnippet inserts at the caret", () => {
    const e = editor("Hello\n");
    const { view } = e.handle;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 6)));
    e.handle.insertSnippet("!!");
    expect(e.handle.getMarkdown()).toBe("Hello!!\n");
    e.restore();
  });
});

/**
 * Press a key through ProseMirror's own keymap dispatch.
 *
 * Calling the command directly would prove the command works and say nothing
 * about whether anything is BOUND to it — and the binding is the part that
 * makes the reorder reachable without a mouse, which is the requirement.
 *
 * Module scope because both spellings of the reorder are tested: the keymap
 * below, and the drag handle, which has to agree with it.
 */
function press(e: ReturnType<typeof editor>, key: string): boolean {
  const event = new (e.win.KeyboardEvent as unknown as new (
    t: string,
    i: Record<string, unknown>,
  ) => KeyboardEvent)("keydown", { key, altKey: true, bubbles: true });
  return e.handle.view.someProp("handleKeyDown", (f) => f(e.handle.view, event)) === true;
}

/** Put the caret in the block containing `text`. */
function caretIn(e: ReturnType<typeof editor>, text: string): void {
  const { view } = e.handle;
  let found = -1;
  view.state.doc.descendants((node, pos) => {
    if (found === -1 && node.isTextblock && node.textContent === text) found = pos + 1;
    return found === -1;
  });
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, found)));
}

describe("moving blocks (the drag handle's keyboard equivalent)", () => {
  test("Alt-ArrowDown moves a block below its sibling", () => {
    const e = editor("Alpha\n\nBravo\n\nCharlie\n");
    caretIn(e, "Alpha");
    expect(press(e, "ArrowDown")).toBe(true);
    expect(e.handle.getMarkdown()).toBe("Bravo\n\nAlpha\n\nCharlie\n");
    e.restore();
  });

  test("Alt-ArrowUp moves a block above its sibling", () => {
    const e = editor("Alpha\n\nBravo\n\nCharlie\n");
    caretIn(e, "Charlie");
    expect(press(e, "ArrowUp")).toBe(true);
    expect(e.handle.getMarkdown()).toBe("Alpha\n\nCharlie\n\nBravo\n");
    e.restore();
  });

  test("the caret travels with the block, so a second press moves the same one", () => {
    const e = editor("Alpha\n\nBravo\n\nCharlie\n");
    caretIn(e, "Charlie");
    press(e, "ArrowUp");
    press(e, "ArrowUp");
    expect(e.handle.getMarkdown()).toBe("Charlie\n\nAlpha\n\nBravo\n");
    e.restore();
  });

  test("undo restores the original order", () => {
    const src = "Alpha\n\nBravo\n";
    const e = editor(src);
    caretIn(e, "Alpha");
    press(e, "ArrowDown");
    expect(e.handle.getMarkdown()).toBe("Bravo\n\nAlpha\n");
    const { view } = e.handle;
    expect(undo(view.state, view.dispatch)).toBe(true);
    expect(e.handle.getMarkdown()).toBe(src);
    e.restore();
  });

  test("the edge of the document reports false rather than swallowing the key", () => {
    // A command that returns true without doing anything would eat the key for
    // whatever binding comes after it.
    const e = editor("Alpha\n\nBravo\n");
    caretIn(e, "Alpha");
    expect(press(e, "ArrowUp")).toBe(false);
    expect(e.handle.getMarkdown()).toBe("Alpha\n\nBravo\n");
    e.restore();
  });

  test("a block moves WITHIN its marker, and the marker line is untouched", () => {
    const src = "@section .gp-columns-2\n\nOne\n\nTwo\n\n@end-section\n";
    const e = editor(src);
    caretIn(e, "One");
    expect(press(e, "ArrowDown")).toBe(true);
    expect(e.handle.getMarkdown()).toBe("@section .gp-columns-2\n\nTwo\n\nOne\n\n@end-section\n");
    e.restore();
  });

  test("a list item moves, not the paragraph that is its only child", () => {
    // The search starts at the caret's own block and walks OUTWARD until it
    // finds a depth with a sibling to swap with — so the useful thing moves
    // without a special case for lists.
    const e = editor("* one\n* two\n* three\n");
    caretIn(e, "one");
    expect(press(e, "ArrowDown")).toBe(true);
    expect(e.handle.getMarkdown()).toBe("* two\n* one\n* three\n");
    e.restore();
  });

  test("inside a table the whole TABLE moves — cells are not authored order", () => {
    const src = "Before\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n";
    const e = editor(src);
    caretIn(e, "1");
    expect(press(e, "ArrowUp")).toBe(true);
    expect(e.handle.getMarkdown()).toBe("| A | B |\n| --- | --- |\n| 1 | 2 |\n\nBefore\n");
    e.restore();
  });

  test("a selection spanning two blocks refuses rather than moving one of them", () => {
    const src = "Alpha\n\nBravo\n\nCharlie\n";
    const e = editor(src);
    const { view } = e.handle;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3, 10)));
    expect(press(e, "ArrowDown")).toBe(false);
    expect(e.handle.getMarkdown()).toBe(src);
    e.restore();
  });
});

describe("the block drag handle", () => {
  /** The chrome the handle mounts into the FRAME's body. */
  function grip(e: ReturnType<typeof editor>): HTMLElement {
    return e.doc.body.querySelector(".gp-drag-handle") as HTMLElement;
  }

  /** Move the pointer over `el`, which is how the handle chooses its block. */
  function hover(e: ReturnType<typeof editor>, el: Element): void {
    el.dispatchEvent(
      new (e.win.MouseEvent as unknown as new (t: string, i: Record<string, unknown>) => Event)(
        "mousemove",
        { bubbles: true },
      ),
    );
  }

  /** A drag event carrying a real DataTransfer (happy-dom's init dict drops it). */
  function dragEvent(e: ReturnType<typeof editor>, type: string): Event {
    const win = e.win as unknown as Record<string, new (...a: unknown[]) => unknown>;
    const event = new (win.DragEvent as unknown as new (
      t: string,
      i: Record<string, unknown>,
    ) => Event)(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", {
      value: new win.DataTransfer!(),
      configurable: true,
    });
    return event;
  }

  test("the grip lives in the frame body — never in the document, never in the flow", () => {
    // The correctness constraint this whole design turns on: an affordance
    // that were a ProseMirror node would be written into the author's .md by
    // the serializer, and one inside `view.dom` would be reverted by
    // DOMObserver. It is a sibling of the editable root, so it is neither.
    const src = "@page .wide\n\nHello\n";
    const e = editor(src);
    expect(grip(e)).not.toBeNull();
    expect(e.mount.contains(grip(e))).toBe(false);
    expect(e.mount.innerHTML).not.toContain("gp-drag-handle");
    expect(e.handle.getMarkdown()).toBe(src);
    e.restore();
  });

  test("destroying the editor takes its chrome with it", () => {
    const e = editor("Hello\n");
    expect(grip(e)).not.toBeNull();
    e.restore();
    expect(e.doc.body.querySelector(".gp-drag-handle")).toBeNull();
  });

  test("hovering a block resolves it, including nested and generated content", () => {
    // `After` gives the section a sibling of its own, so the pointer can
    // resolve the section as well as the paragraphs inside it.
    const e = editor("@section\n\nOne\n\nTwo\n\n@end-section\n\nAfter\n");
    const { view } = e.handle;
    const section = e.mount.firstElementChild as HTMLElement;
    const para = section.firstElementChild as HTMLElement;

    // The nested paragraph, not the section that wraps it: the handle grabs
    // whatever is directly under the pointer.
    expect(blockAtDom(view, para)?.pos).toBe(1);
    expect(view.state.doc.nodeAt(blockAtDom(view, para)!.pos)?.type.name).toBe("paragraph");
    // A text node inside it resolves the same way — the walk goes upward.
    expect(blockAtDom(view, para.firstChild)?.el).toBe(para);
    // The section itself, when the pointer is on its own box.
    expect(blockAtDom(view, section)?.pos).toBe(0);
    e.restore();
  });

  test("a table's internals offer no grip, but the table does", () => {
    // `Before` gives the table a sibling to be reordered among; without one
    // there is nowhere for it to go and no grip is offered at all (see the
    // agreement test below).
    const e = editor("Before\n\n| A |\n| --- |\n| 1 |\n");
    const { view } = e.handle;
    const table = e.mount.querySelector("table") as HTMLElement;
    const cell = e.mount.querySelector("td") as HTMLElement;
    expect(view.state.doc.nodeAt(blockAtDom(view, table)!.pos)?.type.name).toBe("table");
    // Walking up from a cell skips every table-internal parent and lands on
    // the table — the same answer the keyboard command gives.
    expect(blockAtDom(view, cell)?.el).toBe(table);
    e.restore();
  });

  test("the grip grabs the same block Alt+Arrow moves — including in a list", () => {
    // The divergence this pins: `reordersChildren(list_item)` is true, so a
    // handle that asked only that question stopped at the PARAGRAPH inside the
    // bullet and offered to drag it out of its own list item, while Alt+Arrow
    // at the same caret moved the whole item. `isReorderable()` is the
    // command's entire search condition, so both now stop at the same depth.
    const e = editor("* one\n* two\n* three\n");
    const { view } = e.handle;
    const item = e.mount.querySelectorAll("li")[1] as HTMLElement;
    const para = item.firstElementChild as HTMLElement;

    const found = blockAtDom(view, para)!;
    expect(view.state.doc.nodeAt(found.pos)?.type.name).toBe("list_item");
    expect(found.el).toBe(item);

    // And the keyboard, from a caret in that same paragraph, moves that item.
    caretIn(e, "two");
    expect(press(e, "ArrowUp")).toBe(true);
    expect(e.handle.getMarkdown()).toBe("* two\n* one\n* three\n");
    e.restore();
  });

  test("a block with nowhere to go offers no grip", () => {
    // Alt+Arrow returns false on the only block in the document, so a grip
    // beside it would be an affordance for an edit that cannot happen.
    const e = editor("| A |\n| --- |\n| 1 |\n");
    const table = e.mount.querySelector("table") as HTMLElement;
    expect(blockAtDom(e.handle.view, table)).toBeNull();
    caretIn(e, "1");
    expect(press(e, "ArrowUp")).toBe(false);
    e.restore();
  });

  test("an element left over from the previous document resolves to nothing", () => {
    // `posAtDOM` reads the `pmViewDesc` ProseMirror hangs off the element, and
    // a detached one still carries a stale desc — so it answers from a tree
    // that no longer exists instead of refusing. Measured in Chromium 153:
    // this throws "Position -1 out of range", out of a mousemove listener.
    const e = editor("Alpha\n\nBravo\n");
    const stale = e.mount.lastElementChild as HTMLElement;
    e.handle.setContent("# Something else entirely\n");
    expect(() => blockPosFor(e.handle.view, stale)).not.toThrow();
    expect(blockPosFor(e.handle.view, stale)).toBeNull();
    expect(blockAtDom(e.handle.view, stale)).toBeNull();
    e.restore();
  });

  test("dragstart hands ProseMirror a slice and a node selection", () => {
    // This is what stops PM's drop handler from re-parsing the DataTransfer.
    // With `view.dragging` null it would rebuild the block from HTML — and the
    // layout nodes have no `parseDOM`, so an `@section` would come back as a
    // plain div AND the original would survive, i.e. a mangled duplicate.
    const e = editor("@section\n\nOne\n\n@end-section\n\nAfter\n");
    const { view } = e.handle;
    hover(e, e.mount.firstElementChild!);
    const event = dragEvent(e, "dragstart");
    grip(e).dispatchEvent(event);

    expect(view.dragging).not.toBeNull();
    expect(view.dragging!.move).toBe(true);
    expect(view.dragging!.slice.content.firstChild?.type.name).toBe("gp_section");
    // `copyMove`, the value prosemirror-view's own dragstart sets. A bare
    // `move` tells the user agent that the Ctrl/Option-modified copy the docs
    // promise is not permitted, and a drag the agent cannot resolve can end
    // with no drop event at all.
    expect((event as DragEvent).dataTransfer?.effectAllowed).toBe("copyMove");
    expect(view.state.selection).toBeInstanceOf(NodeSelection);
    // Starting a drag changes nothing on disk.
    expect(e.handle.getMarkdown()).toBe("@section\n\nOne\n\n@end-section\n\nAfter\n");
    e.restore();
  });

  test("a drag it cannot describe is refused outright", () => {
    // No hover means no block, so there is no slice to hand over. Cancelling
    // the drag is the only safe answer — see the test above for what a drag
    // with a null `view.dragging` does.
    const e = editor("Hello\n");
    const { view } = e.handle;
    const event = dragEvent(e, "dragstart");
    grip(e).dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(view.dragging).toBeNull();
    e.restore();
  });

  test("a completed drop reorders the file and nothing else", () => {
    // ProseMirror's own `editHandlers.drop` runs here — the module adds no
    // drop code of its own. Only the hit test is stubbed, because happy-dom
    // does no layout; everything downstream of it is upstream's.
    const e = editor("Alpha\n\nBravo\n\nCharlie\n");
    const { view } = e.handle;
    hover(e, e.mount.firstElementChild!);
    grip(e).dispatchEvent(dragEvent(e, "dragstart"));

    // Drop at the end of the document: pos 21 is after "Charlie".
    (view as unknown as { posAtCoords: () => { pos: number; inside: number } }).posAtCoords = () => ({
      pos: view.state.doc.content.size,
      inside: -1,
    });
    view.dom.dispatchEvent(dragEvent(e, "drop"));

    expect(e.handle.getMarkdown()).toBe("Bravo\n\nCharlie\n\nAlpha\n");
    // The grip is chrome, not content: it cannot have been carried along.
    expect(e.handle.getMarkdown()).not.toContain("gp-drag-handle");
    e.restore();
  });

  test("an undo puts a dropped block back where it was", () => {
    const src = "Alpha\n\nBravo\n\nCharlie\n";
    const e = editor(src);
    const { view } = e.handle;
    hover(e, e.mount.firstElementChild!);
    grip(e).dispatchEvent(dragEvent(e, "dragstart"));
    (view as unknown as { posAtCoords: () => { pos: number; inside: number } }).posAtCoords = () => ({
      pos: view.state.doc.content.size,
      inside: -1,
    });
    view.dom.dispatchEvent(dragEvent(e, "drop"));
    expect(e.handle.getMarkdown()).not.toBe(src);

    expect(undo(view.state, view.dispatch)).toBe(true);
    expect(e.handle.getMarkdown()).toBe(src);
    e.restore();
  });
});

describe("source lines (editor↔preview sync)", () => {
  const CHAPTER = "# Title\n\nFirst paragraph.\n\n## Section\n\nSecond paragraph.\n";

  test("every block reports the line it actually occupies on disk", () => {
    // The property the whole mapping rests on: the line comes from the SAME
    // serializer that writes the file, so it cannot drift from the file.
    const state = createEditorState(md, CHAPTER);
    const lines = CHAPTER.split("\n");
    const table = lineTable(state.doc);
    expect(table.length).toBe(4);
    for (const entry of table) {
      const node = state.doc.nodeAt(entry.pos)!;
      expect(lines[entry.line - 1]).toContain(node.textContent.split("\n")[0]!.slice(0, 10));
    }
    resetLineTableCache();
  });

  test("line numbers survive an edit — they are derived, never stored", () => {
    // Storing token.map on nodes would leave every line below an insertion
    // silently wrong. Inserting a block must shift the ones after it.
    const e = editor(CHAPTER);
    const { view } = e.handle;
    const before = lineTable(view.state.doc).map((b) => b.line);
    view.dispatch(view.state.tr.insert(0, gutterpressSchema.nodes.paragraph!.create(
      null, gutterpressSchema.text("Inserted."),
    )));
    const after = lineTable(view.state.doc).map((b) => b.line);
    expect(after[0]).toBe(1);
    // everything that was there is now two lines lower (block + blank line)
    expect(after.slice(1)).toEqual(before.map((l) => l + 2));
    resetLineTableCache();
    e.restore();
  });

  test("posForLine and lineForPos agree with each other", () => {
    const state = createEditorState(md, CHAPTER);
    for (const { pos, line } of lineTable(state.doc)) {
      expect(posForLine(state.doc, line)).toBe(pos);
      expect(lineForPos(state.doc, pos)).toBe(line);
    }
    resetLineTableCache();
  });

  test("two adjacent lists do not shift every line after them", () => {
    // The serializer puts TWO blank lines between same-shape sibling lists —
    // one blank would let re-parsing merge them into a single list. The table
    // used to assume one separator everywhere and reported every later block
    // a line early. This is the shape the list toolbar action produces when
    // used twice in a row, so it is reachable without writing it by hand.
    const li = (t: string) =>
      gutterpressSchema.nodes.list_item!.create(
        null,
        gutterpressSchema.nodes.paragraph!.create(null, gutterpressSchema.text(t)),
      );
    const list = (t: string) =>
      gutterpressSchema.nodes.bullet_list!.create({ tight: true }, [li(t)]);
    const doc = gutterpressSchema.nodes.doc!.create(null, [
      list("one"),
      list("two"),
      gutterpressSchema.nodes.paragraph!.create(null, gutterpressSchema.text("after")),
    ]);

    const saved = serializeDoc(doc).split("\n");
    for (const entry of lineTable(doc)) {
      const node = doc.nodeAt(entry.pos)!;
      // Every reported line must be where that block's text really is.
      expect(saved[entry.line - 1]).toContain(node.textContent.split("\n")[0]!);
    }
    resetLineTableCache();
  });

  test("a line inside a block resolves to that block, not the next one", () => {
    const state = createEditorState(md, "para one\n\npara two\n");
    const table = lineTable(state.doc);
    expect(table.map((t) => t.line)).toEqual([1, 3]);
    // line 2 is the blank separator — it belongs to the block before it
    expect(posForLine(state.doc, 2)).toBe(table[0]!.pos);
    resetLineTableCache();
  });

  test("onAnchorLine does NOT fire while typing", () => {
    // Emitting on every keystroke would yank the preview out from under the
    // author — the exact behaviour MarkdownEditor guards against.
    const seen: Array<[number, string]> = [];
    const win = new Window();
    const g = globalThis as unknown as Record<string, unknown>;
    const prior = { window: g.window, document: g.document };
    g.window = win;
    g.document = win.document;
    const doc = win.document as unknown as Document;
    const mount = doc.createElement("div");
    doc.body.appendChild(mount);
    const handle = mountRichEditor({
      mount, md, content: CHAPTER,
      onAnchorLine: (line, origin) => seen.push([line, origin]),
    });
    const { view } = handle;
    view.dispatch(view.state.tr.insertText("x", 1));
    expect(seen).toEqual([]);

    // ...but a deliberate caret move does fire, with the right line.
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 24)));
    expect(seen.length).toBe(1);
    expect(seen[0]![1]).toBe("caret");

    handle.destroy();
    g.window = prior.window;
    g.document = prior.document;
    resetLineTableCache();
  });
});
