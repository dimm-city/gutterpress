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
import type { MarkType, Node as PMNode, NodeType } from "prosemirror-model";
import { liftListItem, sinkListItem, splitListItem, wrapInList } from "prosemirror-schema-list";
import { EditorState, Plugin, type Command } from "prosemirror-state";
import { Decoration, DecorationSet, EditorView } from "prosemirror-view";
import type MarkdownIt from "markdown-it";
import { createDocParser, gutterpressSchema, serializeDoc } from "./markdown-doc";

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
}

export interface RichEditorHandle {
  readonly view: EditorView;
  /** Replace the whole document — a file switch or an external-edit reload. */
  setContent(markdown: string): void;
  /** Canonical markdown for the current document. */
  getMarkdown(): string;
  focus(): void;
  destroy(): void;
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

  const insertBreak: Command = (state, dispatch) => {
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
 * the 51 `html_block`s and 30 `html_inline`s in the corpus would show as
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

export function createEditorState(md: MarkdownIt, content: string, onSave?: () => void): EditorState {
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
  const { mount, md, content, onChange, onSave } = opts;

  // `{ mount }` makes the given element the editable root itself rather than
  // appending one inside it. That matters here: the page-flow element carries
  // the multicol pagination, and putting a second block between it and the
  // content would give the fragmenter one opaque child to break inside.
  const view = new EditorView({ mount }, {
    state: createEditorState(md, content, onSave),
    nodeViews: {
      html_block: rawHtmlView(false),
      html_inline: rawHtmlView(true),
    },
    dispatchTransaction(tr) {
      const next = view.state.apply(tr);
      view.updateState(next);
      if (tr.docChanged) onChange?.(serializeDoc(next.doc));
    },
  });

  return {
    view,
    setContent(markdown: string) {
      // A whole-document replacement, not an edit: this is a file switch or an
      // external reload, and neither should be undoable back into the previous
      // FILE's content.
      view.updateState(createEditorState(md, markdown, onSave));
    },
    getMarkdown: () => serializeDoc(view.state.doc),
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}
