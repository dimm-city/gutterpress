/**
 * The rich editing surface — ProseMirror over the Gutterpress document model.
 *
 * Framework-free on purpose: everything here is testable without mounting a
 * Svelte component, which is how the repo already treats `toolbar-actions.ts`
 * and friends. `RichEditor.svelte` is a thin shell around `mountRichEditor()`.
 *
 * ## Why bare ProseMirror rather than Tiptap
 *
 * The plan named Tiptap, and this deviates from it deliberately. Tiptap builds
 * its schema FROM its extensions; we already have a schema
 * (`markdown-doc/schema.ts`) that the parser, the serializer and the corpus
 * fixpoint gate are all bound to. Adopting Tiptap would mean re-declaring
 * every one of those node types as an extension and keeping the two
 * declarations in agreement — a second source of truth for the exact thing the
 * corpus gate exists to prove. `@tiptap/pm` is a re-export of the same official
 * ProseMirror packages imported here, so this is the same code with one fewer
 * layer, not a lower-level alternative. What Tiptap would have supplied on top
 * — input rules, commands, keymaps — is what this file is, and it is small.
 *
 * ## What this file must never do
 *
 * Import `engine/viewer/fragment.ts`. The previous attempt mounted that
 * DOM-rewriting fragmenter over ProseMirror's own DOM; ProseMirror's
 * `DOMObserver` reverted its mutations, and detaching the observer around
 * every layout pass became a permanent obligation. Pagination here is CSS
 * (`paginate.ts`) and touches nothing.
 */
import { baseKeymap, chainCommands, exitCode, setBlockType, toggleMark } from "prosemirror-commands";
import { dropCursor } from "prosemirror-dropcursor";
import { gapCursor } from "prosemirror-gapcursor";
import { history, redo, undo } from "prosemirror-history";
import { inputRules, textblockTypeInputRule, wrappingInputRule } from "prosemirror-inputrules";
import { keymap } from "prosemirror-keymap";
import type { MarkType, Node as PMNode, NodeType, ResolvedPos } from "prosemirror-model";
import { liftListItem, sinkListItem, splitListItem, wrapInList } from "prosemirror-schema-list";
import { EditorState, NodeSelection, Plugin, Selection, type Command } from "prosemirror-state";
import { Decoration, DecorationSet, EditorView } from "prosemirror-view";
import type MarkdownIt from "markdown-it";
import { createDocParser, gutterpressSchema, serializeDoc } from "./markdown-doc";
import {
  insertText,
  selectionText,
  toolbarCommand,
  type RichToolbarAction,
  type ToolbarPayloadLike,
} from "./rich-commands";
import { lineForPos, posForLine } from "./rich-lines";
import { isSlashTrigger } from "./rich-chrome.svelte";
import { mountDragHandle } from "./rich-drag-handle";
import { moveBlockDown, moveBlockUp } from "./rich-move-block";

const schema = gutterpressSchema;

export interface MountOptions {
  /** Element the editor is mounted into. Gets the page-flow class. */
  mount: HTMLElement;
  /** Gutterpress's markdown-it instance — the same one that prints. */
  md: MarkdownIt;
  /** Initial markdown. */
  content: string;
  /** Fires with canonical markdown after each document change. */
  onChange?: (markdown: string) => void;
  /** Fires on the save shortcut, so the host can drive its own save path. */
  onSave?: () => void;
  /**
   * Editor→preview sync. Fires with the 1-based source line at the top of the
   * view on scroll, or of the caret on a deliberate (non-typing) move — the
   * same contract `MarkdownEditor` has, so the host wires them identically.
   */
  onAnchorLine?: (line: number, origin: "scroll" | "caret") => void;
  /**
   * Inline chrome state. Fires whenever the slash menu or the selection
   * toolbar should appear, move or close; `null` means close.
   *
   * Coordinates are in the FRAME's viewport — the host translates them (see
   * `rich-chrome.svelte.ts`), because only the host knows where the frame sits.
   */
  onChrome?: (state: ChromeState | null) => void;
}

/** What the inline chrome should currently show. */
export interface ChromeState {
  kind: "slash" | "selection";
  /** Anchor point, in the frame's viewport. */
  x: number;
  y: number;
  /** Slash only: the text typed after `/`. */
  query?: string;
}

export interface RichEditorHandle {
  readonly view: EditorView;
  /**
   * Replace the whole document — a file switch or an external-edit reload.
   * False when the markdown is one this schema cannot model, so the caller
   * can fall back to source mode instead of leaving a stale document on
   * screen.
   */
  setContent(markdown: string): boolean;
  /** Canonical markdown for the current document. */
  getMarkdown(): string;
  focus(): void;
  destroy(): void;
  /** Run a toolbar action. Returns false when it does not apply here. */
  runToolbarAction(action: RichToolbarAction, payload?: ToolbarPayloadLike): boolean;
  /** Selected text, for "save selection as snippet". */
  getSelectionText(): string;
  /** Insert literal text at the caret. */
  insertSnippet(text: string): void;
  /**
   * Apply a `[from, to)` edit expressed in SOURCE character offsets.
   *
   * Returns false — changing nothing — when those offsets cannot be trusted;
   * see `canApplySourceOffsets()`.
   */
  applyRangeEdit(expectedSource: string, from: number, to: number, insert: string): boolean;
  /**
   * Whether source-offset edits can be applied right now.
   *
   * True only when the document's canonical markdown is byte-identical to
   * what is on disk, because that is the text the caller's offsets index into.
   * On a project that has not been normalized the two differ, and applying the
   * offsets would corrupt the file at a position the author never chose —
   * "never guess an edit" (ADR 0009).
   */
  canApplySourceOffsets(diskContent: string): boolean;
  /** Scroll a 1-based source line into view, optionally focusing the editor. */
  revealLine(line: number, focusEditor?: boolean): void;
}

// ---------------------------------------------------------------------------
// generated content
// ---------------------------------------------------------------------------

/**
 * Content the PIPELINE generates, shown but never editable.
 *
 * `markers.js` injects a `<div class="chapter-opener">` at the top of every
 * `@chapter`. It is not in the author's file, and `renderer.ts`'s provenance
 * filter deliberately keeps it out of the document model so it can never be
 * written back. But print SHOWS it, and this editor's whole promise is that
 * text looks as it will print — so it is rendered as a widget DECORATION.
 *
 * Decoration is exactly the right mechanism: a widget lives in the view and
 * not in the document, so there is no path by which it can reach the
 * serializer. Authored content is document; generated content is decoration.
 */
function generatedContent(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type !== schema.nodes.gp_chapter) return true;
    const label = /(?:^|\s)@chapter\s+(.*)$/.exec((node.attrs.marker as string) || "")?.[1]?.trim();
    if (!label) return true;
    // +1 puts the widget inside the chapter, before its first child, which is
    // where the pipeline injects it.
    decorations.push(
      Decoration.widget(
        pos + 1,
        () => {
          const el = document.createElement("div");
          el.className = "chapter-opener";
          el.setAttribute("data-chapter-label", label);
          el.setAttribute("contenteditable", "false");
          el.textContent = label;
          return el;
        },
        { side: -1, key: `chapter-opener:${label}` },
      ),
    );
    return true;
  });
  return DecorationSet.create(doc, decorations);
}

const generatedContentPlugin = new Plugin({
  props: {
    decorations: (state) => generatedContent(state.doc),
  },
});

// ---------------------------------------------------------------------------
// input rules — the Obsidian/Typora typing feel
// ---------------------------------------------------------------------------

/**
 * Markdown shorthands that transform as you type.
 *
 * NOT included: smart quotes and dashes (`prosemirror-inputrules` ships them).
 * markdown-it's `typographer` already produces those in the printed output, so
 * an input rule would only change what is written to the AUTHOR'S FILE —
 * turning their `"` into `"` in source for no difference in the PDF.
 * Normalization is accepted where it buys something; this buys nothing.
 */
function gutterpressInputRules(): Plugin {
  const { heading, blockquote, bullet_list, ordered_list, code_block } =
    schema.nodes;
  return inputRules({
    rules: [
      // `# ` .. `###### `
      textblockTypeInputRule(/^(#{1,6})\s$/, heading!, (m) => ({ level: m[1]!.length })),
      // `> `
      wrappingInputRule(/^\s*>\s$/, blockquote!),
      // `- `, `* `, `+ `
      wrappingInputRule(/^\s*([-+*])\s$/, bullet_list!),
      // `1. `, and keep the author's start number
      wrappingInputRule(
        /^(\d+)\.\s$/,
        ordered_list!,
        (m) => ({ order: +m[1]! }),
        (m, node) => node.childCount + (node.attrs.order as number) === +m[1]!,
      ),
      // ``` or ```lang
      textblockTypeInputRule(/^```([a-zA-Z0-9_+-]*)?\s$/, code_block!, (m) => ({ params: m[1] || "" })),
      // No `---` rule: it is ambiguous while typing (a setext underline for
      // the line above, or a thematic break) and guessing wrong destroys a
      // heading. `Mod-_` inserts one explicitly instead.
    ],
  });
}

// ---------------------------------------------------------------------------
// keymap
// ---------------------------------------------------------------------------

/** `Mod-` is Cmd on macOS, Ctrl elsewhere — ProseMirror resolves it. */
function buildKeymap(onSave?: () => void): Plugin {
  const {
    heading, paragraph, code_block, list_item, hard_break, horizontal_rule,
  } = schema.nodes;
  const { strong, em, code } = schema.marks;

  /**
   * Shift-Enter, except inside a table cell.
   *
   * A cell's content is `inline*`, so `hard_break` is a legal child there and
   * this used to insert one — but a markdown table row is one line by
   * construction. `cellText()` serializes the break as `\` + newline and then
   * flattens the newline to a space, so the author's forced break became a
   * stray backslash in the cell, permanently (it round-trips as a literal
   * backslash from then on). Refusing is the honest answer: markdown has no
   * spelling for it, so the key does nothing rather than writing something
   * else.
   */
  const insertBreak: Command = (state, dispatch) => {
    for (let d = state.selection.$from.depth; d > 0; d--) {
      const role = state.selection.$from.node(d).type.spec.tableRole;
      if (role === "cell" || role === "header_cell") return false;
    }
    dispatch?.(state.tr.replaceSelectionWith(hard_break!.create()).scrollIntoView());
    return true;
  };

  const bindings: Record<string, Command> = {
    "Mod-z": undo,
    "Mod-y": redo,
    "Shift-Mod-z": redo,
    "Mod-b": toggleMark(strong as MarkType),
    "Mod-i": toggleMark(em as MarkType),
    "Mod-`": toggleMark(code as MarkType),
    "Shift-Ctrl-\\": setBlockType(code_block as NodeType),
    "Mod-Shift-8": wrapInList(schema.nodes.bullet_list!),
    "Mod-Shift-9": wrapInList(schema.nodes.ordered_list!),
    "Mod-Shift-0": setBlockType(paragraph as NodeType),
    // The keyboard equivalent of the block drag handle, and the reason the
    // handle is allowed to exist: a mouse-only reorder has no answer for an
    // author who cannot drag. Alt-Arrow is the same key CodeMirror's
    // `defaultKeymap` binds to `moveLineUp`/`moveLineDown`, which is what
    // source mode already does here — so one key does the analogous thing in
    // both modes, a line there and a block here.
    "Alt-ArrowUp": moveBlockUp,
    "Alt-ArrowDown": moveBlockDown,
    Enter: splitListItem(list_item as NodeType),
    Tab: sinkListItem(list_item as NodeType),
    "Shift-Tab": liftListItem(list_item as NodeType),
    "Shift-Enter": chainCommands(exitCode, insertBreak),
    "Mod-_": (state, dispatch) => {
      dispatch?.(state.tr.replaceSelectionWith(horizontal_rule!.create()).scrollIntoView());
      return true;
    },
  };

  for (let level = 1; level <= 6; level++) {
    bindings[`Mod-Shift-${level}`] = setBlockType(heading as NodeType, { level });
  }

  if (onSave) {
    bindings["Mod-s"] = () => {
      onSave();
      return true;
    };
  }

  return keymap(bindings);
}

// ---------------------------------------------------------------------------
// raw HTML
// ---------------------------------------------------------------------------

/**
 * Render an author's raw HTML as HTML, not as escaped source text.
 *
 * A `toDOM` spec cannot produce raw markup, so this is a NodeView. Without it
 * the 49 `html_block`s and 30 `html_inline`s in the corpus would show as
 * literal angle brackets while printing as real elements — a visible break in
 * the one promise this editor makes.
 *
 * Safe because of where it runs: the editing surface is an iframe whose
 * document carries `script-src 'none'` (see `RichEditor.svelte`), so author
 * markup renders but author scripts do not execute. The node keeps its `html`
 * attribute untouched, so what round-trips to the file is the author's
 * original bytes either way.
 */
function rawHtmlView(inline: boolean) {
  return (node: PMNode) => {
    const dom = document.createElement(inline ? "span" : "div");
    dom.innerHTML = node.attrs.html as string;
    dom.contentEditable = "false";
    return {
      dom,
      // The subtree is ours, not ProseMirror's — it must not try to read
      // editing changes out of it.
      ignoreMutation: () => true,
      stopEvent: () => false,
    };
  };
}

// ---------------------------------------------------------------------------
// state + mount
// ---------------------------------------------------------------------------

/**
 * Watches for the slash trigger and the selection, and reports where the
 * chrome belongs.
 *
 * A plugin rather than DOM listeners: it sees every state change, including
 * programmatic ones, so the menu cannot be left open over a document that has
 * moved out from under it.
 */
function chromePlugin(onChrome: (state: ChromeState | null) => void): Plugin {
  // A flag, NOT a position. The menu still opens only on TYPING `/`, so
  // putting the caret after a slash already in the text does not summon it —
  // but WHERE that slash is gets re-derived from the live document on every
  // update. Holding the position meant holding a number across transactions
  // that never mapped through them, and `applyRangeEdit` dispatches exactly
  // such a transaction onto this same state: an insertion earlier in the
  // document left the number pointing somewhere else, or past the end, where
  // `coordsAtPos` throws. A flag cannot go stale.
  let open = false;

  return new Plugin({
    view: (view) => ({
      update(v, prev) {
        if (v.state.doc === prev.doc && v.state.selection.eq(prev.selection)) return;
        const { state } = v;
        const { selection } = state;

        // ── slash menu ────────────────────────────────────────────────────
        if (selection.empty) {
          const $pos = selection.$from;
          const textBefore = $pos.parent.textBetween(
            Math.max(0, $pos.parentOffset - 80), $pos.parentOffset, undefined, "\ufffc",
          );
          if (!open && isSlashTrigger(textBefore)) open = true;
          if (open) {
            // Typing past the trigger filters; deleting it, or inserting a
            // space, is the author writing a literal slash — close.
            const at = slashQueryAt($pos);
            if (!at) open = false;
            else {
              const coords = v.coordsAtPos(at.from);
              onChrome({ kind: "slash", x: coords.left, y: coords.bottom, query: at.query });
              return;
            }
          }
        } else {
          open = false;
        }

        // ── selection toolbar ─────────────────────────────────────────────
        // A NodeSelection is never a formatting selection. The drag handle
        // puts one on a whole block for both the click and the drag, and that
        // selection is non-empty and has text — so without this the bubble
        // opened the instant the author grabbed a grip, sat between the pointer
        // and the drop target for the whole drag, and stayed open on the moved
        // block afterwards, offering to apply `strong` to an entire
        // `gp_section`. Selecting a block is a structural act, not a request to
        // format it.
        if (
          !(selection instanceof NodeSelection) &&
          !selection.empty &&
          state.doc.textBetween(selection.from, selection.to).trim()
        ) {
          const start = v.coordsAtPos(selection.from);
          const end = v.coordsAtPos(selection.to);
          onChrome({
            kind: "selection",
            x: (Math.min(start.left, end.left) + Math.max(start.right, end.right)) / 2,
            y: Math.min(start.top, end.top),
          });
          return;
        }

        onChrome(null);
      },
      destroy() {
        onChrome(null);
      },
    }),
  });
}

/**
 * The `/query` the caret sits at the end of, located in the CURRENT document.
 *
 * One definition, used by both the menu (to place itself and to filter) and
 * `clearSlashQuery` (to delete the text before inserting). They read the same
 * span by construction, so the menu can never be filtering on one range while
 * the insert removes another.
 *
 * Returns null when there is no live slash command: no slash, a slash in the
 * middle of a word (`and/or`), or whitespace since the slash.
 */
function slashQueryAt($pos: ResolvedPos): { from: number; query: string } | null {
  // The leaf char keeps text offsets aligned with document positions when the
  // block holds an inline atom (a raw `html_inline` span).
  const text = $pos.parent.textBetween(0, $pos.parentOffset, undefined, "￼");
  const slash = text.lastIndexOf("/");
  if (slash === -1) return null;
  if (slash > 0 && !/\s$/.test(text.slice(0, slash))) return null;
  const query = text.slice(slash + 1);
  if (/\s/.test(query)) return null;
  return { from: $pos.start() + slash, query };
}

/** Delete the `/query` the author typed, before running the chosen command. */
export function clearSlashQuery(view: EditorView): void {
  const at = slashQueryAt(view.state.selection.$from);
  if (!at) return;
  view.dispatch(view.state.tr.delete(at.from, view.state.selection.from));
}

export function createEditorState(
  md: MarkdownIt,
  content: string,
  onSave?: () => void,
  onChrome?: (state: ChromeState | null) => void,
): EditorState {
  return EditorState.create({
    doc: createDocParser(md).parse(content),
    plugins: [
      buildKeymap(onSave),
      keymap(baseKeymap),
      gutterpressInputRules(),
      history(),
      dropCursor(),
      gapCursor(),
      generatedContentPlugin,
      ...(onChrome ? [chromePlugin(onChrome)] : []),
    ],
  });
}

/**
 * Mount an editor.
 *
 * `onChange` receives CANONICAL markdown — the same string the file would be
 * saved with — so the host can feed its existing buffer without knowing
 * anything about ProseMirror. It fires only for transactions that actually
 * changed the document, so selection and focus churn cost nothing.
 */
export function mountRichEditor(opts: MountOptions): RichEditorHandle {
  const { mount, md, content, onChange, onSave, onAnchorLine, onChrome } = opts;

  /**
   * Anchor-line emission, mirroring `MarkdownEditor`'s three guards: a
   * timestamp window so a programmatic scroll cannot bounce back as an
   * editor→preview event, an equality check, and rAF coalescing on scroll.
   * Without the window the two panes chase each other.
   */
  let suppressEmitUntil = 0;
  let lastEmittedLine = -1;
  let anchorRaf = 0;
  const emitAnchor = (line: number, origin: "scroll" | "caret") => {
    if (!onAnchorLine || Date.now() < suppressEmitUntil || line === lastEmittedLine) return;
    lastEmittedLine = line;
    onAnchorLine(line, origin);
  };

  // `{ mount }` makes the given element the editable root itself rather than
  // appending one inside it. That matters here: the page-flow element carries
  // the multicol pagination, and putting a second block between it and the
  // content would give the fragmenter one opaque child to break inside.
  const view = new EditorView({ mount }, {
    state: createEditorState(md, content, onSave, onChrome),
    nodeViews: {
      html_block: rawHtmlView(false),
      html_inline: rawHtmlView(true),
    },
    dispatchTransaction(tr) {
      const next = view.state.apply(tr);
      view.updateState(next);
      if (tr.docChanged) onChange?.(serializeDoc(next.doc));
      // A DELIBERATE caret move only — emitting while typing would yank the
      // preview on every keystroke.
      if (tr.selectionSet && !tr.docChanged) {
        emitAnchor(lineForPos(next.doc, next.selection.head), "caret");
      }
    },
  });

  /** Replace the document while KEEPING undo history (unlike `setContent`). */
  function replaceDoc(markdown: string): void {
    const next = createDocParser(md).parse(markdown);
    const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, next.content);
    view.dispatch(tr);
  }

  // Block reordering by pointer. It appends its own chrome to the FRAME's
  // body, outside `view.dom`, so it is neither a document node nor something
  // `DOMObserver` can revert — see `rich-drag-handle.ts`. Its keyboard
  // equivalent is in the keymap above.
  const dragHandle = mountDragHandle(view);

  // Scrolling produces no transactions, so this rides the scroll container —
  // the editor's own document inside the iframe.
  const scrollRoot = mount.ownerDocument?.defaultView;
  const onScroll = () => {
    if (!onAnchorLine || anchorRaf) return;
    anchorRaf = (scrollRoot ?? window).requestAnimationFrame(() => {
      anchorRaf = 0;
      const rect = mount.getBoundingClientRect();
      const found = view.posAtCoords({ left: rect.left + 6, top: Math.max(rect.top, 0) + 6 });
      if (found) emitAnchor(lineForPos(view.state.doc, found.pos), "scroll");
    });
  };
  scrollRoot?.addEventListener("scroll", onScroll, { passive: true });

  return {
    view,
    /**
     * Replace the whole document. Returns false when the markdown is one this
     * schema cannot model.
     *
     * The parse throws by design (see `parser.ts`, FAIL CLOSED), and the
     * preflight that is supposed to keep such content away from here only
     * chooses which component MOUNTS — it does not gate what is later pushed
     * into an already-mounted one. Two ordinary things do exactly that: an
     * external edit adding a footnote to the open file, and switching to a
     * chapter that uses one. Reporting the refusal lets the host fall back to
     * source mode; throwing left an unhandled rejection and skipped the
     * caller's remaining work.
     */
    setContent(markdown: string): boolean {
      let next: EditorState;
      try {
        next = createEditorState(md, markdown, onSave, onChrome);
      } catch {
        return false;
      }
      suppressEmitUntil = Date.now() + 300;
      lastEmittedLine = -1;
      // A whole-document replacement, not an edit: this is a file switch or an
      // external reload, and neither should be undoable back into the previous
      // FILE's content.
      view.updateState(next);
      return true;
    },
    getMarkdown: () => serializeDoc(view.state.doc),
    focus: () => view.focus(),
    destroy: () => {
      scrollRoot?.removeEventListener("scroll", onScroll);
      dragHandle.destroy();
      view.destroy();
    },

    revealLine(line: number, focusEditor = false) {
      const pos = posForLine(view.state.doc, line);
      if (pos == null) return;
      // Suppress the scroll this causes, or it returns as an editor->preview
      // anchor and the panes fight.
      suppressEmitUntil = Date.now() + 300;
      lastEmittedLine = line;
      const dom = view.nodeDOM(pos) ?? view.domAtPos(pos).node;
      if (dom instanceof HTMLElement) dom.scrollIntoView({ block: "start" });
      if (focusEditor) {
        view.dispatch(
          view.state.tr.setSelection(Selection.near(view.state.doc.resolve(pos))).scrollIntoView(),
        );
        view.focus();
      }
    },

    runToolbarAction(action, payload) {
      const command = toolbarCommand(action, payload);
      if (!command) return false;
      view.focus();
      return command(view.state, view.dispatch, view);
    },

    getSelectionText: () => selectionText(view.state),

    insertSnippet(text: string) {
      view.focus();
      view.dispatch(insertText(view.state, text));
    },

    canApplySourceOffsets: (diskContent: string) => serializeDoc(view.state.doc) === diskContent,

    applyRangeEdit(expectedSource, from, to, insert) {
      // The offsets index into `expectedSource`. If the document does not
      // serialize to exactly that, they point somewhere else entirely — refuse
      // rather than write at a guessed position.
      const current = serializeDoc(view.state.doc);
      if (current !== expectedSource) return false;
      if (from < 0 || to < from || to > current.length) return false;
      replaceDoc(current.slice(0, from) + insert + current.slice(to));
      return true;
    },
  };
}
