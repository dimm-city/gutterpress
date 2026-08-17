import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { undo } from "prosemirror-history";
import { createEditorState, mountRichEditor } from "../../src/lib/editor/rich-editor";
import { createEditorRenderer } from "../../src/lib/editor/markdown-doc";

/**
 * The editing surface, headless.
 *
 * DOM is happy-dom (the harness `tests/platform/dialog.test.ts` uses). It does
 * no layout, so nothing here asserts geometry — pagination is CSS and is
 * covered by `paginate.test.ts` plus the measurements recorded in
 * `paginate.ts`'s header.
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
