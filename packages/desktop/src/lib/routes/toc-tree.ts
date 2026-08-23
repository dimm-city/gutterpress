import type { OutlineEntry } from "$lib/preview-client";

/**
 * A node in the derived Table-of-contents tree. The outline the preview
 * produces is FLAT (one record per heading, in document order, carrying only a
 * `level` 1–6); this module derives the nesting from those levels so the TOC
 * panel can render a collapsible tree that mirrors the Files panel — see
 * `LeftPanel.svelte`'s TOC tab. Pure, no runes, same style as `outline.ts`.
 */
export interface TocNode {
  entry: OutlineEntry;
  /** Stable identity for expansion tracking + `{#each}` keying — the outline
   *  index is unique and survives outline reloads better than array position. */
  key: string;
  children: TocNode[];
}

/**
 * Derive a nesting tree from the flat `outline` using heading `level` alone:
 * each heading's parent is the nearest preceding heading with a strictly
 * smaller level. A level jump (e.g. h1 → h3 with no h2) simply nests the h3
 * under the h1 — the deepest still-open ancestor. Document order is preserved.
 */
export function buildTocTree(outline: OutlineEntry[]): TocNode[] {
  const roots: TocNode[] = [];
  const stack: TocNode[] = [];
  for (const entry of outline) {
    const node: TocNode = { entry, key: String(entry.index), children: [] };
    // Pop back to the nearest ancestor with a strictly-smaller level.
    while (stack.length > 0 && stack[stack.length - 1].entry.level >= entry.level) {
      stack.pop();
    }
    if (stack.length > 0) stack[stack.length - 1].children.push(node);
    else roots.push(node);
    stack.push(node);
  }
  return roots;
}

/**
 * The page column's text for one TOC row.
 *
 * `getOutline()` reports a page of `0` for a heading whose page could not be
 * measured: the preview bridge's `pageIndexOf()` collapses the viewer's
 * "no fragmentainer contains this element" answer (`pageOf() === -1`) to `0`.
 * Rendering that with `{entry.page || ""}` made an unmeasured page look
 * identical to a row that simply has no page column — a real book showed one
 * chapter heading with a silently blank page while every other row carried a
 * number. An em dash says "not known" instead of saying nothing.
 */
export function tocPageLabel(page: number | null | undefined): string {
  return typeof page === "number" && Number.isFinite(page) && page > 0 ? String(page) : "—";
}

/**
 * Keys of the strict ancestors of the entry at array index `activeIndex`,
 * nearest-first — used to auto-expand the branch containing the cursor so
 * "opening the panel reveals the active item." Walks back over
 * strictly-smaller levels, the same parent rule {@link buildTocTree} uses.
 * Returns `[]` for a top-level item or an out-of-range index.
 */
export function ancestorKeysForActive(outline: OutlineEntry[], activeIndex: number): string[] {
  const keys: string[] = [];
  if (activeIndex < 0 || activeIndex >= outline.length) return keys;
  let level = outline[activeIndex].level;
  for (let i = activeIndex - 1; i >= 0; i--) {
    if (outline[i].level < level) {
      keys.push(String(outline[i].index));
      level = outline[i].level;
    }
  }
  return keys;
}
