/**
 * The editor toolbar's actions, as ProseMirror commands.
 *
 * The host has one toolbar and calls `runToolbarAction(action, payload)` on
 * whichever editor is mounted (`+page.svelte`). `toolbar-actions.ts` is the
 * CodeMirror implementation — it manipulates markdown TEXT with document
 * offsets. This is the same 14 actions against a document TREE.
 *
 * Two things are shared rather than reimplemented:
 *
 * - `buildImageAttrsString()` from `toolbar-actions.ts` is already pure, so
 *   image classes are built by exactly the same code in both modes.
 * - The layout blocks emit the same authored marker lines the CodeMirror
 *   versions insert, carried on the node's `marker` attribute — so what lands
 *   in the file is identical either way.
 *
 * `snippet` and `focus-mode` are absent on purpose: the host intercepts both
 * before they reach the editor.
 */
import { lift, setBlockType, toggleMark, wrapIn } from "prosemirror-commands";
import type { MarkType, Node as PMNode, NodeType } from "prosemirror-model";
import { liftListItem, wrapInList } from "prosemirror-schema-list";
import type { Command, EditorState, Transaction } from "prosemirror-state";
import { gutterpressSchema as schema } from "./markdown-doc";
import { tokenizeImageAttrs, unquoteAttrValue } from "./image-classes";
import {
  buildImageAttrsString,
  CHAPTER_TITLE_PLACEHOLDER,
  TWO_COLUMN_FILLER,
  type LayoutBlockKind,
} from "./toolbar-actions";

export type RichToolbarAction =
  | "bold" | "italic" | "strikethrough" | "code" | "link"
  | "blockquote" | "ul" | "ol" | "heading" | "hr"
  | "page-break" | "table" | "image" | "layout-block";

const { nodes, marks } = schema;

/** Replace the selection with `node`, then place the caret after it. */
function insert(node: PMNode): Command {
  return (state, dispatch) => {
    dispatch?.(state.tr.replaceSelectionWith(node).scrollIntoView());
    return true;
  };
}

/** An empty paragraph — every layout wrapper needs at least one child. */
const emptyParagraph = () => nodes.paragraph!.create();

/**
 * A layout wrapper carrying its authored marker line.
 *
 * The `marker` attribute IS what serializes (see `markdown-doc/schema.ts`), so
 * these strings are the contract with the file, not decoration. `@chapter`'s
 * label is quoted because `parseMarkerLine` allows only one bare token — an
 * unquoted multi-word label is a parse error, which is why the CodeMirror
 * version quotes it too.
 */
function layoutBlock(kind: LayoutBlockKind): PMNode {
  switch (kind) {
    case "chapter":
      return nodes.gp_chapter!.create(
        { marker: `@chapter "${CHAPTER_TITLE_PLACEHOLDER}"`, class: "chapter" },
        [nodes.gp_page!.create({ marker: "@page", class: "page" }, [emptyParagraph()])],
      );
    case "spread":
      return nodes.gp_spread!.create({ marker: "@spread", class: "spread" }, [
        nodes.gp_page!.create({ marker: "@page", class: "page" }, [emptyParagraph()]),
      ]);
    case "section":
      return nodes.gp_section!.create({ marker: "@section", class: "section" }, [emptyParagraph()]);
    case "two-column":
      return nodes.gp_section!.create(
        { marker: "@section .gp-columns-2", class: "section gp-columns-2" },
        [
          emptyParagraph(),
          nodes.gp_column_break!.create({ marker: "@column-break", class: "gp-column-break" }),
          nodes.paragraph!.create(null, schema.text(TWO_COLUMN_FILLER)),
        ],
      );
    case "page-break":
      return nodes.gp_page_break!.create({ marker: "@page-break", class: "gp-page-break" });
  }
}

/** A `cols`-wide table with a header row and one body row, matching the CM version. */
function table(cols: number): PMNode {
  const n = Math.max(1, Math.min(10, Math.trunc(cols) || 3));
  const header = Array.from({ length: n }, (_, i) =>
    nodes.table_header!.create(null, schema.text(`Header ${i + 1}`)),
  );
  const body = Array.from({ length: n }, () =>
    nodes.table_cell!.create(null, schema.text("Cell")),
  );
  return nodes.table!.create(null, [
    nodes.table_head!.create(null, [nodes.table_row!.create(null, header)]),
    nodes.table_body!.create(null, [nodes.table_row!.create(null, body)]),
  ]);
}

/**
 * Toggle a heading level, matching the CodeMirror behaviour: applying the
 * level a block already has turns it back into a paragraph.
 */
function toggleHeading(level: number): Command {
  return (state, dispatch, view) => {
    const { $from } = state.selection;
    const current = $from.parent;
    if (current.type === nodes.heading && current.attrs.level === level) {
      return setBlockType(nodes.paragraph as NodeType)(state, dispatch, view);
    }
    return setBlockType(nodes.heading as NodeType, { level })(state, dispatch, view);
  };
}

/**
 * Wrap the selection in a link.
 *
 * With no selection there is nothing to mark, so insert placeholder text and
 * select it — the same affordance the CodeMirror version gives (it inserts
 * `[link text](url)` and selects `link text`).
 */
const applyLink: Command = (state, dispatch) => {
  const linkMark = marks.link!.create({ href: "url", title: null });
  if (state.selection.empty) {
    const text = schema.text("link text", [linkMark]);
    dispatch?.(state.tr.replaceSelectionWith(text, false).scrollIntoView());
    return true;
  }
  return toggleMark(marks.link as MarkType, { href: "url", title: null })(state, dispatch);
};

/**
 * Toggle blockquote: lift out when already inside one.
 *
 * `lift` rather than a hand-computed depth. The hand-rolled version passed a
 * literal `0` as the lift target, which lifts to the document root — so
 * toggling inside a nested quote unwrapped BOTH levels in one keystroke,
 * rather than the one the author asked for. `blockquote` is in this schema's
 * `block` group, so nesting is legal and reachable.
 */
const applyBlockquote: Command = (state, dispatch, view) => {
  for (let d = state.selection.$from.depth; d > 0; d--) {
    if (state.selection.$from.node(d).type === nodes.blockquote) {
      return lift(state, dispatch);
    }
  }
  return wrapIn(nodes.blockquote as NodeType)(state, dispatch, view);
};

/** Toggle a list: lift the items out when the selection is already in one. */
function applyList(type: NodeType): Command {
  return (state, dispatch, view) => {
    for (let d = state.selection.$from.depth; d > 0; d--) {
      if (state.selection.$from.node(d).type === type) {
        return liftListItem(nodes.list_item as NodeType)(state, dispatch, view);
      }
    }
    return wrapInList(type)(state, dispatch, view);
  };
}

export interface ImagePayload {
  src: string;
  alt: string;
  width?: string;
  position?: string;
  size?: string;
  shape?: boolean;
}

/**
 * The image node, with its `{...}` classes.
 *
 * `buildImageAttrsString()` returns the authored brace text (e.g.
 * `{.gp-right .gp-small}`); the node stores the parsed map, which is what
 * `attrs.ts` re-emits on save. Parsing our own output here — with the same
 * `tokenizeImageAttrs` the context menu uses — keeps ONE definition of that
 * syntax rather than a second, drifting one. (A hand-rolled split here DID
 * drift: it kept the quotes `setWidth` adds, so `width="30%"` round-tripped
 * to `width="&quot;30%&quot;"` on save.)
 */
function image(payload: ImagePayload): PMNode {
  const braces = buildImageAttrsString(
    payload.width, payload.position, payload.size, payload.shape,
  );
  const classes: string[] = [];
  const parsed: Record<string, string> = {};
  for (const token of tokenizeImageAttrs(braces)) {
    if (token.startsWith(".")) classes.push(token.slice(1));
    else if (token.startsWith("#")) parsed.id = token.slice(1);
    else {
      const eq = token.indexOf("=");
      if (eq > 0) parsed[token.slice(0, eq)] = unquoteAttrValue(token.slice(eq + 1));
    }
  }
  if (classes.length) parsed.class = classes.join(" ");
  const attrs = Object.keys(parsed).length > 0 ? parsed : null;
  return nodes.image!.create({ src: payload.src, alt: payload.alt || null, title: null, attrs });
}

export type ToolbarPayloadLike =
  | { level: 1 | 2 | 3 | 4 }
  | { cols: number }
  | ImagePayload
  | { kind: LayoutBlockKind }
  | undefined;

/**
 * Resolve a toolbar action to a command, or null when the payload a
 * payload-requiring action needs is missing.
 *
 * Returning null rather than a no-op command lets the caller tell "this action
 * did nothing because it was not applicable" from "this action is unknown".
 */
export function toolbarCommand(
  action: RichToolbarAction,
  payload?: ToolbarPayloadLike,
): Command | null {
  switch (action) {
    case "bold":          return toggleMark(marks.strong as MarkType);
    case "italic":        return toggleMark(marks.em as MarkType);
    case "strikethrough": return toggleMark(marks.strikethrough as MarkType);
    case "code":          return toggleMark(marks.code as MarkType);
    case "link":          return applyLink;
    case "blockquote":    return applyBlockquote;
    case "ul":            return applyList(nodes.bullet_list as NodeType);
    case "ol":            return applyList(nodes.ordered_list as NodeType);
    case "heading":       return toggleHeading((payload as { level?: number })?.level ?? 2);
    case "hr":            return insert(nodes.horizontal_rule!.create());
    case "page-break":    return insert(layoutBlock("page-break"));
    case "table":         return insert(table((payload as { cols?: number })?.cols ?? 3));
    case "image": {
      const img = payload as ImagePayload | undefined;
      return img?.src ? insert(image(img)) : null;
    }
    case "layout-block": {
      const kind = (payload as { kind?: LayoutBlockKind } | undefined)?.kind;
      return kind ? insert(layoutBlock(kind)) : null;
    }
  }
}

/** Selection text, for "save selection as snippet". */
export function selectionText(state: EditorState): string {
  const { from, to } = state.selection;
  return from === to ? "" : state.doc.textBetween(from, to, "\n", "\n");
}

/** Insert literal text at the selection (snippet insertion). */
export function insertText(state: EditorState, text: string): Transaction {
  return state.tr.insertText(text).scrollIntoView();
}
