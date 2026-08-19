/**
 * How a page's PAPER gets its paint — shared by the two surfaces that draw
 * page boxes: the viewer's decoration pass (`decorate.ts`, `.gp-sheet`) and
 * the engine's live-document mode (`live-document.ts`, `.gp-editor-sheet`).
 *
 * A printed page's background has two author-controlled layers, painted in
 * this order (CSS Paged Media §3.1):
 *
 *   1. the PAGE box's own background — `@page { background: … }`, which
 *      Chromium paints across the whole sheet, margins included;
 *   2. the CANVAS background — the `html`/`body` background, which print
 *      propagates onto every page. This is how a book gets paper texture on
 *      every printed page from one `body { background: url(…) }` rule.
 *
 * Any surface that shows "a page" and skips either layer is showing the
 * wrong book: the field guide's brick paper is a canvas background, and the
 * editor painted plain white sheets over it until this module gave it the
 * viewer's own recipe. One implementation, two consumers, no drift.
 */

/** A declaration map, as `resolvePage()` returns it. */
export type PaintDeclarations = Record<string, string>;

/*
 * Structural DOM types, not the DOM lib: the library tsconfig compiles
 * against ESNext only (the render surface must be importable in a plain
 * Node type environment), and this module needs exactly this much of a
 * document to capture a background from.
 */
interface StyleReader {
  backgroundColor: string;
  backgroundImage: string;
  getPropertyValue(prop: string): string;
}
export interface CanvasElementLike {
  style: { background: string };
}
export interface CanvasDocumentLike {
  documentElement: CanvasElementLike | null;
  body: CanvasElementLike | null;
  // `el: never` on purpose: parameters are checked contravariantly, and the
  // real Window.getComputedStyle wants an Element this structural type
  // cannot name. `never` accepts any real signature; the implementation
  // below only ever passes the document's own elements back to it.
  defaultView: { getComputedStyle(el: never): StyleReader } | null;
}

/**
 * The background longhands worth carrying from the canvas onto a page box.
 * `background-attachment` is deliberately absent: `fixed` is
 * viewport-relative and meaningless for a page.
 */
export const CANVAS_BG_PROPS = [
  "background-color",
  "background-image",
  "background-repeat",
  "background-position",
  "background-size",
  "background-origin",
  "background-clip",
  "background-blend-mode",
] as const;

/**
 * The `@page` background declarations from a resolved page context, in
 * declaration order — everything `background*` except `background-attachment`
 * (skipped for the same reason as above).
 */
export function pageBackgroundEntries(decls: PaintDeclarations): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [prop, value] of Object.entries(decls)) {
    const p = prop.toLowerCase();
    if (p !== "background" && !p.startsWith("background-")) continue;
    if (p === "background-attachment") continue;
    out.push([p, value]);
  }
  return out;
}

/**
 * The document's canvas background — `html`'s, or `body`'s when `html`
 * paints nothing — as the longhands above, computed from the live document.
 *
 * Print propagates this onto every page, so a page-drawing surface applies
 * the captured values to each sheet it paints. The element it came from is
 * returned so the caller can decide what to do with the ORIGINAL paint:
 * both surfaces neutralize it (the paper now carries it; leaving it on the
 * canvas too would paint the page texture across the area BETWEEN pages).
 */
export function captureCanvasBackground(
  doc: CanvasDocumentLike,
): { entries: Array<[string, string]>; from: CanvasElementLike | null } {
  for (const el of [doc.documentElement, doc.body]) {
    if (!el) continue;
    const cs = doc.defaultView!.getComputedStyle(el as never);
    const transparent = /^(transparent|rgba\(0, ?0, ?0, ?0\))$/.test(cs.backgroundColor);
    if (cs.backgroundImage === "none" && transparent) continue;
    return {
      entries: CANVAS_BG_PROPS.map((p) => [p, cs.getPropertyValue(p)] as [string, string]),
      from: el,
    };
  }
  return { entries: [], from: null };
}
