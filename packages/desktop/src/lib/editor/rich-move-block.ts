/**
 * Reordering whole blocks — the operation the drag handle performs, expressed
 * as a command so it also has a keyboard spelling.
 *
 * ## Why this is not `prosemirror-commands`
 *
 * Nothing upstream does it. `joinUp`/`joinDown` MERGE a block into its
 * neighbour, `lift` UNWRAPS one, and `selectParentNode` only moves the
 * selection — none of them exchange two siblings. So this is written on the
 * transaction directly.
 *
 * ## Which block moves
 *
 * The innermost enclosing block that CAN move in the requested direction,
 * searched outward from the selection. That one rule gives every case the
 * behaviour an author expects without a table of special cases:
 *
 *   - caret in a paragraph inside `@section` → the paragraph moves among the
 *     section's children (the common shape in these books);
 *   - caret in a list item's paragraph → the paragraph is an only child, so
 *     the search moves outward and the LIST ITEM moves among its siblings;
 *   - a nested list that cannot legally sit above its item's first paragraph
 *     (`list_item` is `paragraph block*`) → rejected by `validContent`, so the
 *     search moves outward and the whole list item moves instead;
 *   - caret anywhere inside a table → every candidate's parent carries a
 *     `tableRole`, so the search skips them all and the whole TABLE moves.
 *
 * The last one is why `reordersChildren()` exists rather than a
 * "refuse inside tables" guard: a table's internal order is structural (a
 * `table_head` before a `table_body`, cells aligned into columns), not the
 * author's to shuffle, but the table itself is an ordinary block.
 *
 * `isReorderable()` is that whole search condition, exported so the drag
 * handle stops its own outward walk at exactly the block this command would
 * move. The handle used to share only `reordersChildren()`, which is a
 * strictly weaker question, and the two picked different blocks in a bulleted
 * list — see that function's own comment.
 *
 * ## Why the moved node is re-inserted rather than the parent rewritten
 *
 * Delete-then-insert produces two steps that map every OTHER position in the
 * document exactly, so a decoration or a pending selection elsewhere survives.
 * Replacing the parent's whole content would be one step that maps everything
 * inside it to nowhere in particular.
 */
import { Fragment, type Node as PMNode } from "prosemirror-model";
import { NodeSelection, Selection, type Command } from "prosemirror-state";

/**
 * Whether this node's children are in an order the AUTHOR chose.
 *
 * False for a table's internals: `table` is `table_head? table_body?`, a row's
 * cells are columns, and none of that is a sequence the author reorders by
 * dragging. Everything else — the document, a `@page`, a `@section`, a
 * blockquote, a list — holds blocks in authored order.
 */
function reordersChildren(parent: PMNode): boolean {
  return !parent.type.spec.tableRole;
}

/**
 * Whether `parent.child(index)` can trade places with the sibling `dir` away.
 *
 * The schema check is what lets the outward search below exist: a nested list
 * cannot legally sit above its item's first paragraph (`list_item` is
 * `paragraph block*`), so asking the schema here turns an illegal arrangement
 * into "try the next depth out" rather than a throw from `tr.insert`.
 */
function canSwap(parent: PMNode, index: number, dir: 1 | -1): boolean {
  const target = index + dir;
  if (target < 0 || target >= parent.childCount) return false;
  const children: PMNode[] = [];
  parent.content.forEach((child) => children.push(child));
  const [moved] = children.splice(index, 1);
  children.splice(target, 0, moved!);
  return parent.type.validContent(Fragment.from(children));
}

/**
 * Whether `parent.child(index)` is a block the author can reorder at all.
 *
 * Exported because the drag handle has to ask the same question the keyboard
 * asks, at the same depth, or the two offer different blocks at the same spot.
 * Sharing only `reordersChildren()` was NOT enough and the divergence was
 * exactly the one an author would meet first: the paragraph inside a list item
 * has a parent whose children are authored, so the grip stopped there and
 * offered to drag the paragraph OUT of its bullet — while Alt-Arrow, finding
 * that paragraph has no sibling to swap with, fell outward and moved the whole
 * list item. Answering "is there anywhere for this to go" rather than "is this
 * parent orderable" makes the grip stop where the command stops.
 */
export function isReorderable(parent: PMNode, index: number): boolean {
  return reordersChildren(parent) && (canSwap(parent, index, -1) || canSwap(parent, index, 1));
}

/**
 * Move the block at the selection one place up (`-1`) or down (`+1`).
 *
 * Returns false, changing nothing, when there is no sibling to swap with at
 * any depth — the first block of the document pressed up, say. That is the
 * command contract: a false lets the keymap fall through to the next binding
 * rather than swallowing the key.
 */
function moveBlock(dir: 1 | -1): Command {
  return (state, dispatch) => {
    const { selection } = state;
    const $from = selection.$from;
    const isNodeSelection = selection instanceof NodeSelection;

    // A selection spanning two blocks has no single block to move, and picking
    // one of them would silently discard half of what the author highlighted.
    if (!isNodeSelection && !$from.sameParent(selection.$to)) return false;

    // For a NodeSelection `$from` sits BEFORE the node, so its own depth is
    // already the parent's; for a caret it sits inside a textblock, whose
    // parent is one shallower.
    for (let depth = isNodeSelection ? $from.depth : $from.depth - 1; depth >= 0; depth--) {
      const parent = $from.node(depth);
      const index = $from.index(depth);
      if (!reordersChildren(parent) || !canSwap(parent, index, dir)) continue;

      if (!dispatch) return true;

      const target = index + dir;
      const node = parent.child(index);
      const from = $from.posAtIndex(index, depth);
      const to = from + node.nodeSize;
      const neighbour = parent.child(target);
      // Where the node lands: the far edge of the sibling it jumps over.
      const landing = dir < 0 ? from - neighbour.nodeSize : to + neighbour.nodeSize;

      const tr = state.tr.delete(from, to);
      // Mapped, not arithmetic: moving DOWN puts the landing point after the
      // deleted range, so it has shifted by the node's size.
      const at = tr.mapping.map(landing);
      tr.insert(at, node);

      // Keep the author with the block they moved — the caret at the same
      // spot in its text, or the node selection still on it. Without this the
      // selection maps to wherever the deletion left it and a second press
      // moves a different block.
      if (isNodeSelection) {
        tr.setSelection(NodeSelection.create(tr.doc, at));
      } else {
        const offset = Math.min(Math.max(selection.head - from, 0), node.nodeSize);
        tr.setSelection(Selection.near(tr.doc.resolve(at + offset)));
      }
      dispatch(tr.scrollIntoView());
      return true;
    }
    return false;
  };
}

/** Move the block at the selection above its previous sibling. */
export const moveBlockUp: Command = moveBlock(-1);

/** Move the block at the selection below its next sibling. */
export const moveBlockDown: Command = moveBlock(1);
