/**
 * Place a floating panel near a point without letting it leave the workspace.
 *
 * Shared because there is exactly one right answer to this and three callers
 * that need it: the context menu, the editor's slash menu, and the editor's
 * selection bubble. It lived privately inside `ContextMenuController`, and the
 * inline editor chrome grew a byte-identical second copy of the same four
 * lines before this module existed.
 *
 * Pure geometry — no DOM, no host, no runes — so it is testable without
 * mounting anything (CLAUDE.md §8 / ADR 0004).
 */

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Place a `width`×`height` panel at `point`, flipping away from the near edge
 * and clamping inside `workspace`.
 *
 * `preferAbove` is what a bubble toolbar wants: it sits over the selection, so
 * the natural placement is above and it flips DOWN only when there is no room.
 * Everything else — menus that drop from a caret or a cursor — wants the
 * default, which is below-and-right until an edge says otherwise.
 */
export function flipClamp(
  point: Point,
  width: number,
  height: number,
  workspace: Rect,
  preferAbove = false,
): Point {
  const maxX = workspace.left + workspace.width;
  const maxY = workspace.top + workspace.height;

  let x = point.x + width > maxX ? point.x - width : point.x;
  let y = preferAbove
    ? point.y - height < workspace.top
      ? point.y
      : point.y - height
    : point.y + height > maxY
      ? point.y - height
      : point.y;

  x = Math.min(Math.max(x, workspace.left), Math.max(workspace.left, maxX - width));
  y = Math.min(Math.max(y, workspace.top), Math.max(workspace.top, maxY - height));
  return { x, y };
}
