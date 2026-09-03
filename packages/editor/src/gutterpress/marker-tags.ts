/**
 * Margin tags for the marker chips the paged view keeps out of its flow.
 *
 * A marker line (`@section .gp-columns-2`, `@page`, `@end-section`) has no
 * element on the printed page, so its chip has no box in the editor either:
 * `editor-css.ts` gives it `display: none`, in the locked view and the
 * unlocked one alike. That is not a preference but a measurement. A
 * zero-height in-flow chip moved Chromium's `break-inside: avoid` decisions
 * for the sections around it (chapter-03 of the field guide paginated into
 * 17 pages against the book's 14), and an absolutely positioned one still
 * did (15): any box in the fragmented flow is a box the page does not have.
 *
 * So the tag the author sees is drawn HERE, as an overlay outside the flow:
 * one element per hidden chip, positioned from the box of the block the
 * marker stands next to (the wrapper it opens, or the block it closes), and
 * hung in the page margin to the left of that block. The overlay is a child
 * of the fork's scrolling content container, which is `position: relative`
 * in the fork's own CSS, so the tags scroll and zoom with the pages.
 *
 * Clicking a tag places the caret at the marker's own offset
 * (`EditorMount.setSelection`), which is what a click on the chip did: the
 * block becomes active and shows its source, in the flow, for editing.
 * Leaving it hides the chip again and the page's shape returns.
 */

/** Class on the overlay layer. */
export const MARKER_TAG_LAYER_CLASS = "gp-marker-tags";
/** Class on each tag in the layer. */
export const MARKER_TAG_CLASS = "gp-marker-tag";
/** Data attribute the mount stamps on a chip with an offset inside its marker line (see `mount.ts`). */
export const CHIP_START_ATTR = "data-gp-start";

export interface MarkerTagsHandle {
  /** Re-anchor the tags to the current layout; coalesced to one per frame. */
  refresh(): void;
  dispose(): void;
}

export interface MarkerTagsOptions {
  /** Called with the marker's source offset when its tag is clicked. */
  readonly onActivate?: (absoluteStart: number) => void;
}

/** Chips whose whole box is the pipeline's own output, which prints; they have no tag. */
const RENDERING_KINDS = new Set(["plugin-region", "raw-html"]);
/** Chips that close what came before them, anchored to the block above rather than below. */
const CLOSING_KINDS = new Set(["end-section", "html-container"]);

/**
 * Installs the overlay for `documentElement` (the fork's `.md-document`)
 * inside its content container and keeps it current: after every layout the
 * host reports (`refresh()` from `afterDocumentMount`), and whenever the
 * document's size or attributes change underneath (a re-pagination on fonts
 * or a resize, which the host publishes as an attribute on the document).
 */
export function installMarkerTags(documentElement: HTMLElement, options: MarkerTagsOptions = {}): MarkerTagsHandle {
  const doc = documentElement.ownerDocument;
  const layer = doc.createElement("div");
  layer.className = MARKER_TAG_LAYER_CLASS;
  layer.setAttribute("aria-hidden", "true");
  // The fork reports the document mounted before it has a parent on the
  // first render, so the container is looked up when there is something to
  // paint, and the layer joins it then.
  let observedContainer: HTMLElement | undefined;

  let frame = 0;
  let disposed = false;
  const refresh = (): void => {
    if (disposed || frame) return;
    frame = doc.defaultView?.requestAnimationFrame(paint) ?? 0;
    if (!frame) paint();
  };
  const resize = doc.defaultView?.ResizeObserver ? new doc.defaultView.ResizeObserver(refresh) : undefined;
  const paint = (): void => {
    frame = 0;
    if (disposed || !documentElement.isConnected) return;
    const container = documentElement.parentElement;
    if (!container) return;
    if (layer.parentElement !== container) container.appendChild(layer);
    if (observedContainer !== container) {
      if (observedContainer) resize?.unobserve(observedContainer);
      resize?.observe(container);
      observedContainer = container;
    }
    layer.replaceChildren();
    const containerRect = container.getBoundingClientRect();
    // A zoomed stage (the host fits a page to its pane with CSS `zoom`)
    // reports zoomed client rects but lays its children out in unzoomed
    // px; the ratio of the two is the zoom to divide by.
    const zoom = container.offsetWidth ? containerRect.width / container.offsetWidth : 1;
    for (const chip of Array.from(documentElement.querySelectorAll<HTMLElement>(".gp-block-chip"))) {
      const kind = chip.dataset["gpBlockKind"] ?? "";
      if (RENDERING_KINDS.has(kind)) continue;
      const source = chip.querySelector(".gp-block-chip__tag");
      if (!source) continue;
      const anchor = anchorFor(chip, CLOSING_KINDS.has(kind));
      if (!anchor) continue;
      const rect = anchor.getBoundingClientRect();
      const tag = doc.createElement("div");
      tag.className = `${MARKER_TAG_CLASS} ${MARKER_TAG_CLASS}--${kind}`;
      tag.append(...Array.from(source.cloneNode(true).childNodes));
      const startAttr = chip.getAttribute(CHIP_START_ATTR);
      if (startAttr !== null) tag.setAttribute(CHIP_START_ATTR, startAttr);
      const left = (rect.left - containerRect.left) / zoom + container.scrollLeft;
      tag.style.left = `${left}px`;
      // The tag hangs to the left of its block and must stay inside the
      // scrolling container: what lies left of its edge is unreachable. So
      // it may take at most the room between the container's edge and the
      // block, wrapping its text to fit.
      tag.style.maxWidth = `${Math.max(48, left - container.scrollLeft - 14)}px`;
      const top = CLOSING_KINDS.has(kind) ? rect.bottom : rect.top;
      tag.style.top = `${(top - containerRect.top) / zoom + container.scrollTop}px`;
      if (CLOSING_KINDS.has(kind)) tag.classList.add(`${MARKER_TAG_CLASS}--closing`);
      const start = Number(chip.getAttribute(CHIP_START_ATTR));
      if (Number.isFinite(start) && options.onActivate) {
        // The tag sits inside the fork's own content container, whose
        // pointer handling would otherwise map the click to whichever block
        // is nearest the page margin and put the caret there, after this
        // handler had put it on the marker. The default would move focus to
        // where the tag is drawn. Neither may happen.
        for (const type of ["pointerdown", "mouseup", "click"]) {
          tag.addEventListener(type, (event) => event.stopPropagation());
        }
        tag.addEventListener("mousedown", (event) => {
          event.preventDefault();
          event.stopPropagation();
          options.onActivate?.(start);
        });
      }
      layer.appendChild(tag);
    }
  };
  resize?.observe(documentElement);
  const mutation = doc.defaultView?.MutationObserver ? new doc.defaultView.MutationObserver(refresh) : undefined;
  mutation?.observe(documentElement, { attributes: true });

  refresh();
  return {
    refresh,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (frame) doc.defaultView?.cancelAnimationFrame(frame);
      resize?.disconnect();
      mutation?.disconnect();
      layer.remove();
    },
  };
}

/**
 * The block a hidden chip stands next to: the first following sibling with
 * a box (the wrapper an opener opens, or the block after it), or for a
 * closer the first preceding one (the wrapper it closes). A chip with no
 * boxed sibling at all is anchored to its parent.
 */
function anchorFor(chip: HTMLElement, closing: boolean): Element | null {
  const step = closing ? "previousElementSibling" : "nextElementSibling";
  for (let el = chip[step]; el; el = el[step]) {
    if (hasBox(el)) return el;
  }
  const other = closing ? "nextElementSibling" : "previousElementSibling";
  for (let el = chip[other]; el; el = el[other]) {
    if (hasBox(el)) return el;
  }
  const parent = chip.parentElement;
  return parent && hasBox(parent) ? parent : null;
}

function hasBox(el: Element): boolean {
  if (el.classList.contains("gp-block-chip") && !RENDERING_KINDS.has((el as HTMLElement).dataset["gpBlockKind"] ?? "")) return false;
  const rect = el.getBoundingClientRect();
  return rect.height > 0 && rect.width > 0;
}
