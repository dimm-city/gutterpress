/**
 * `.gp-flush` policy — shared by the compiler and the viewer, like every rule
 * that DECIDES something (see synthesis.ts's header).
 *
 * A pinned image reaches the paper only if the page's own margin is removed
 * on that edge: Chromium's printable area IS the page area — MEASURED, a
 * pinned box pulled into the margin with negative insets fragments onto the
 * NEXT sheet, one moved there with a transform is clipped away entirely, and
 * a margin box in a ~zero margin (1px, with padding/height compensation)
 * simply does not render. So flush is implemented as page GEOMETRY, per page:
 *
 *  - The COMPILER aliases the flush root's own page context under a
 *    generated name (verbatim rule copies — never a resolved flatten, which
 *    is the "re-implement the @page cascade" trap tier2's history records),
 *    zeroes the flushed margins on the alias, and assigns the root to it.
 *  - The VIEWER keeps the author's page context and adjusts the strip
 *    geometry in JS from these same functions.
 *
 * Margin boxes live IN the margin, so the flushed edge's furniture (folio,
 * running head) cannot render natively there — MEASURED, no compensation
 * trick survives. Both renderers therefore keep painting that furniture
 * themselves at its ORIGINAL coordinates: the viewer already synthesizes all
 * furniture as DOM; the compiler injects the flushed edge's boxes into the
 * page root as positioned elements with engine-resolved text. Nothing the
 * author declared is lost — that is the contract this module's box map
 * exists to keep.
 */
import type { PageGeometry } from "./gcpm-extract.ts";

export const FLUSH_EDGES = ["top", "right", "bottom", "left"] as const;
export type FlushEdge = (typeof FLUSH_EDGES)[number];

/** Minimal DOM shape needed by `flushEdgesIn` — keeps this module node-safe. */
interface QueryRoot {
  querySelector(sel: string): unknown;
}

/**
 * Which edges the flush pins inside `root` ask for, in canonical t/r/b/l
 * order. A `.gp-flush` without `.gp-pin` or without an edge word is inert by
 * construction — every selector here requires all three.
 */
export function flushEdgesIn(root: QueryRoot): FlushEdge[] {
  return FLUSH_EDGES.filter((edge) => root.querySelector(`.gp-pin.gp-flush.gp-${edge}`));
}

/** Canonical short key for an edge set: "b", "rb", "trbl"… (t/r/b/l order). */
export function flushKey(edges: readonly FlushEdge[]): string {
  return FLUSH_EDGES.filter((e) => edges.includes(e))
    .map((e) => e[0])
    .join("");
}

/**
 * Generated page name for (author page context, edge set). The `gp--` double
 * dash marks an engine-generated page (the `gp--blank` convention); these
 * exist only in builds that actually contain a flush pin, which is why the
 * width check may treat them as real author contexts.
 */
export function flushPageName(authorPage: string | undefined, edges: readonly FlushEdge[]): string {
  const safe = authorPage ? authorPage.replace(/[^A-Za-z0-9_-]/g, "_") : "";
  return `gp--flush${safe ? `-${safe}` : ""}-${flushKey(edges)}`;
}

/** The page's margins with the flushed edges freed. */
export function flushMargins(
  margin: PageGeometry["margin"],
  edges: readonly FlushEdge[],
): PageGeometry["margin"] {
  return {
    top: edges.includes("top") ? 0 : margin.top,
    right: edges.includes("right") ? 0 : margin.right,
    bottom: edges.includes("bottom") ? 0 : margin.bottom,
    left: edges.includes("left") ? 0 : margin.left,
  };
}

/**
 * Margin boxes that live (wholly or partly) in a flushed edge's margin area —
 * the set both renderers must keep painting themselves. A corner box belongs
 * to BOTH of its edges: `bottom-left-corner` dies when either the bottom or
 * the left margin is freed.
 */
export function marginBoxesOnEdges(edges: readonly FlushEdge[]): string[] {
  const owners: Record<string, FlushEdge[]> = {
    "top-left-corner": ["top", "left"],
    "top-left": ["top"],
    "top-center": ["top"],
    "top-right": ["top"],
    "top-right-corner": ["top", "right"],
    "bottom-left-corner": ["bottom", "left"],
    "bottom-left": ["bottom"],
    "bottom-center": ["bottom"],
    "bottom-right": ["bottom"],
    "bottom-right-corner": ["bottom", "right"],
    "left-top": ["left"],
    "left-middle": ["left"],
    "left-bottom": ["left"],
    "right-top": ["right"],
    "right-middle": ["right"],
    "right-bottom": ["right"],
  };
  return Object.entries(owners)
    .filter(([, own]) => own.some((e) => edges.includes(e)))
    .map(([name]) => name);
}
