/**
 * Pinned-art policy — shared by the compiler and the viewer, like every rule
 * that DECIDES something (see synthesis.ts's header).
 *
 * THE MODEL: a pin box the text never shares. A `.gp-pin` with an edge word
 * (`.gp-top`, `.gp-right`, `.gp-bottom`, `.gp-left`) positions itself inside
 * its page root (`.page`/`.spread`, `position: relative` in MARKER_CSS), and
 * where it sits has no effect on the text:
 *
 *  1. The page MARGIN on each pinned edge is freed. Chromium's printable area
 *     IS the page area — MEASURED, a pinned box pulled into the margin with
 *     negative insets fragments onto the NEXT sheet, one moved there with a
 *     transform is clipped away entirely, and a margin box in a ~zero margin
 *     (1px, with padding/height compensation) simply does not render. So the
 *     only way art reaches the paper is page GEOMETRY, per page:
 *       - the COMPILER aliases the root's own page context under a generated
 *         name (verbatim rule copies — never a resolved flatten, which is the
 *         "re-implement the @page cascade" trap tier2's history records),
 *         zeroes the pinned margins on the alias, and assigns the root to it;
 *       - the VIEWER keeps the author's page context and frees the margins in
 *         the run's strip geometry, from these same functions.
 *  2. The root gets that same margin back as PADDING (`box-decoration-break:
 *     clone`, so every fragment of a root that spans pages keeps it), added
 *     to any padding the root has of its own. Its content box is therefore
 *     the author's content box — same width, same height, same place, same
 *     line and page breaks — whatever is pinned where. That is the whole
 *     point: freeing the margin once let the text grow into it. (What the
 *     root paints itself — a background, a border — does grow with it: the
 *     root's box is the page area, and that area reaches the paper.)
 *  3. The pin box is the root's padding box — which now reaches the paper on
 *     the pinned edges — inset by the printer's ART-SAFE line: `--gp-pin-<edge>`
 *     on the root, read by `.gp-pin`'s four insets (GUTTERPRESS_CSS). On the
 *     top, bottom and outside edge that is the bleed plus `page.artSafe`; at
 *     the binding edge `page.safe` (no bleed there) — the manifest's print
 *     area (print-area.ts), so a book with none sets 0, the paper's edge.
 *  4. `.gp-flush` on the pin zeroes the four properties in plain CSS: the
 *     opt-in escape hatch to the paper's edge (the markdown pipeline warns).
 *     Nothing else here knows about it.
 *
 * Sides. Recto values are the defaults (`@page :right`'s margins, the
 * binding on the left). Mirrored `:left`/`:right` margins agree on the content
 * SIZE, so the viewer paginates identically either way; each engine corrects a
 * verso root once it knows the side — the viewer after it measures its
 * strips, the compiler in its synthesis step (`setPinGeometry`).
 *
 * Margin boxes live IN the margin, so a freed edge's furniture (folio, running
 * head) cannot render natively there — MEASURED, no compensation trick
 * survives. Both renderers therefore keep painting that furniture themselves
 * at its ORIGINAL coordinates: the viewer already synthesizes all furniture as
 * DOM; the compiler injects the freed edge's boxes into the page root as
 * positioned elements with engine-resolved text. Nothing the author declared
 * is lost — that is the contract this module's box map exists to keep.
 *
 * Everything the author's document gets is standard CSS: a padding, a custom
 * property per edge, absolute insets, and (print only) a named page.
 */
import type { PageGeometry } from "./gcpm-extract.ts";
import type { PageSide, PrintArea } from "./print-area.ts";

export const PIN_EDGES = ["top", "right", "bottom", "left"] as const;
export type PinEdge = (typeof PIN_EDGES)[number];

/** Every pin that names an edge. */
export const EDGE_PIN_SELECTOR = PIN_EDGES.map((edge) => `.gp-pin.gp-${edge}`).join(", ");

/** Minimal DOM shapes `pinEdgesIn` needs — keeps this module node-safe. */
interface PinElement {
  /** an HTML element's containing block for abspos (`HTMLElement.offsetParent`) */
  readonly offsetParent?: unknown;
  readonly classList: { contains(token: string): boolean };
}
interface QueryRoot {
  querySelectorAll(selector: string): ArrayLike<PinElement>;
}

/**
 * The edges the pins of page root `root` use, in canonical t/r/b/l order — a
 * pin counts when `root` is its containing block (its `offsetParent`): a pin
 * in a nested page root belongs to that root, and one a positioned card
 * frames belongs to the card, so neither frees this root's margins. A pin
 * without an edge word frees nothing and centres in the text block.
 */
export function pinEdgesIn(root: QueryRoot): PinEdge[] {
  const pins = Array.from(root.querySelectorAll(EDGE_PIN_SELECTOR)).filter(
    (pin) => pin.offsetParent === root,
  );
  return PIN_EDGES.filter((edge) => pins.some((pin) => pin.classList.contains(`gp-${edge}`)));
}

/** Canonical short key for an edge set: "b", "rb", "trbl"… (t/r/b/l order). */
export function pinKey(edges: readonly PinEdge[]): string {
  return PIN_EDGES.filter((e) => edges.includes(e))
    .map((e) => e[0])
    .join("");
}

/**
 * Generated page name for (author page context, edge set). The `gp--` double
 * dash marks an engine-generated page (the `gp--blank` convention); these
 * exist only in builds that actually contain an edge pin, which is why the
 * width check may treat them as real author contexts.
 */
export function pinPageName(authorPage: string | undefined, edges: readonly PinEdge[]): string {
  const safe = authorPage ? authorPage.replace(/[^A-Za-z0-9_-]/g, "_") : "";
  return `gp--pin${safe ? `-${safe}` : ""}-${pinKey(edges)}`;
}

/** The page's margins with the pinned edges freed. */
export function flushMargins(
  margin: PageGeometry["margin"],
  edges: readonly PinEdge[],
): PageGeometry["margin"] {
  return {
    top: edges.includes("top") ? 0 : margin.top,
    right: edges.includes("right") ? 0 : margin.right,
    bottom: edges.includes("bottom") ? 0 : margin.bottom,
    left: edges.includes("left") ? 0 : margin.left,
  };
}

/**
 * The art-safe line's distance from the sheet edge on each pinned edge, in pt:
 * the bleed plus `artSafe` on the top, bottom and outside edge, `safe` on the
 * binding edge (the left of a recto, the right of a verso), 0 on an edge the
 * pins do not use (the pin box's edge is the text block's there). No print
 * area means 0 everywhere: the paper's edge.
 */
export function pinInsets(
  area: Pick<PrintArea, "bleed" | "safe" | "artSafe"> | null,
  side: PageSide,
  edges: readonly PinEdge[],
): Record<PinEdge, number> {
  const binding: PinEdge = side === "recto" ? "left" : "right";
  const inset = (edge: PinEdge) =>
    !area || !edges.includes(edge) ? 0 : edge === binding ? area.safe : area.bleed + area.artSafe;
  return { top: inset("top"), right: inset("right"), bottom: inset("bottom"), left: inset("left") };
}

/** No padding of the root's own. */
export const NO_PADDING: Readonly<Record<PinEdge, number>> = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * A pin root's own declarations for one side, in px (pt × 96/72, like the
 * strip variables): the freed margins back as padding, cloned onto every
 * fragment, and the four inset properties. `margin` is the ORIGINAL margin of
 * the page context the root lands on; `padding` is the root's own (author)
 * padding in px, which the freed margin is added to rather than replacing,
 * so a padded root's text stays put too. All four properties are set, so a
 * pin never reads another root's values.
 */
export function pinRootStyle(
  margin: PageGeometry["margin"],
  area: Pick<PrintArea, "bleed" | "safe" | "artSafe"> | null,
  side: PageSide,
  edges: readonly PinEdge[],
  padding: Readonly<Record<PinEdge, number>> = NO_PADDING,
): Record<string, string> {
  const px = (pt: number) => (pt * 96) / 72;
  const inset = pinInsets(area, side, edges);
  const style: Record<string, string> = { "box-decoration-break": "clone" };
  for (const edge of PIN_EDGES)
    if (edges.includes(edge)) style[`padding-${edge}`] = `${px(margin[edge]) + padding[edge]}px`;
  for (const edge of PIN_EDGES) style[`--gp-pin-${edge}`] = `${px(inset[edge])}px`;
  return style;
}

/** A computed style's four paddings, in px. */
export function paddingOf(cs: {
  paddingTop: string;
  paddingRight: string;
  paddingBottom: string;
  paddingLeft: string;
}): Record<PinEdge, number> {
  return {
    top: parseFloat(cs.paddingTop) || 0,
    right: parseFloat(cs.paddingRight) || 0,
    bottom: parseFloat(cs.paddingBottom) || 0,
    left: parseFloat(cs.paddingLeft) || 0,
  };
}

/**
 * Margin boxes that live (wholly or partly) in a freed edge's margin area —
 * the set both renderers must keep painting themselves. A corner box belongs
 * to BOTH of its edges: `bottom-left-corner` dies when either the bottom or
 * the left margin is freed.
 */
export function marginBoxesOnEdges(edges: readonly PinEdge[]): string[] {
  const owners: Record<string, PinEdge[]> = {
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
