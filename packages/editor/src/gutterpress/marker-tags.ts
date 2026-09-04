/**
 * Margin icons for the marker chips the paged view keeps out of its flow.
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
 * So what the author sees is drawn HERE, as an overlay outside the flow:
 * one icon per hidden chip, named for the marker's kind, positioned from
 * the box of the block the marker stands next to (the wrapper it opens, or
 * the block it closes) and hung in the page margin to the left of it. The
 * marker's own text is the icon's tooltip; markers that share an anchor
 * line up side by side. The overlay is a child of the fork's scrolling
 * content container, which is `position: relative` in the fork's own CSS,
 * so the icons scroll and zoom with the pages.
 *
 * Clicking an icon places the caret at the marker's own offset
 * (`EditorMount.setSelection`), which is what a click on the chip did: the
 * block becomes active and shows its source, in the flow, for editing.
 * Leaving it hides the chip again and the page's shape returns.
 */

/** Class on the overlay layer. */
export const MARKER_TAG_LAYER_CLASS = "gp-marker-tags";
/** Class on each icon in the layer. */
export const MARKER_TAG_CLASS = "gp-marker-tag";
/** Data attribute the mount stamps on every inactive block: its source offset (see `mount.ts`). */
export const BLOCK_START_ATTR = "data-gp-start";
/** Data attribute the mount stamps on every inactive block: its source length. */
export const BLOCK_LENGTH_ATTR = "data-gp-length";
/** Data attribute the mount stamps on a chip: the offset a click on its icon puts the caret at. */
export const CHIP_CARET_ATTR = "data-gp-caret";

export interface MarkerTagsHandle {
  /** Re-anchor the icons to the current layout; coalesced to one per frame. */
  refresh(): void;
  dispose(): void;
}

export interface MarkerTagsOptions {
  /** Called with the marker's source offset when its icon is clicked. */
  readonly onActivate?: (absoluteStart: number) => void;
}

/** Chips whose whole box is the pipeline's own output, which prints; they have no icon. */
const RENDERING_KINDS = new Set(["plugin-region", "raw-html"]);
/** Whether a chip closes what came before it (anchored to the block above rather than below): an `end-*` marker, or a raw closing tag. */
/** An icon's box and the step between icons sharing a row (editor-css.ts's .gp-marker-tag rules). */
const TAG_SIZE = 22;
const TAG_STEP = 26;

function isClosing(kind: string, text: string): boolean {
  return kind.startsWith("end-") || (kind === "html-container" && text.startsWith("</"));
}

/**
 * One glyph per marker kind: 24x24 stroke paths, the same idiom as the
 * desktop's own icon set. Static strings written here, never author text,
 * so writing them as markup is safe.
 */
const GLYPHS: Record<string, string> = {
  chapter:
    '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  page: '<path d="M6 2h8l5 5v15H6z"/><path d="M14 2v5h5"/>',
  spread: '<rect x="3" y="4" width="8" height="16" rx="1"/><rect x="13" y="4" width="8" height="16" rx="1"/>',
  section: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h10"/><path d="M7 13h10"/><path d="M7 17h6"/>',
  continue: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  "end-section": '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m9 9 6 6"/><path d="m15 9-6 6"/>',
  "page-break": '<path d="M3 12h3"/><path d="M9 12h6"/><path d="M18 12h3"/><path d="M6 3v5"/><path d="M18 3v5"/><path d="M6 16v5"/><path d="M18 16v5"/>',
  "column-break": '<path d="M12 3v3"/><path d="M12 9v6"/><path d="M12 18v3"/><path d="M3 6h5"/><path d="M16 6h5"/><path d="M3 18h5"/><path d="M16 18h5"/>',
  "plugin-marker": '<path d="M20 12l-8 8-9-9V4h7l10 8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  "html-container": '<path d="m8 8-4 4 4 4"/><path d="m16 8 4 4-4 4"/>',
};
const DEFAULT_GLYPH = '<circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16h.01"/>';

function glyphFor(kind: string): string {
  return GLYPHS[kind] ?? (kind.startsWith("end-") ? GLYPHS["end-section"]! : DEFAULT_GLYPH);
}

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
    /** Where icons have been hung, so the next one steps left of any it would
     *  cover. Measured on the drawn boxes, not the anchors: a chapter's icon
     *  anchors to the chapter wrapper and the page's to the page wrapper
     *  inside it (the same corner), and a section holding one block hangs its
     *  opener at that block's top and its closer just above the block's
     *  bottom, which for a one-line block is the same row. */
    const placed: { x: number; y: number }[] = [];
    for (const chip of Array.from(documentElement.querySelectorAll<HTMLElement>(".gp-block-chip"))) {
      const kind = chip.dataset["gpBlockKind"] ?? "";
      if (RENDERING_KINDS.has(kind)) continue;
      const source = chip.querySelector(".gp-block-chip__source");
      if (!source) continue;
      const text = (source.textContent ?? "").trim();
      const closing = isClosing(kind, text);
      const anchor = anchorFor(chip, closing);
      if (!anchor) continue;
      const rect = anchor.getBoundingClientRect();
      const left = (rect.left - containerRect.left) / zoom + container.scrollLeft;
      const top = ((closing ? rect.bottom : rect.top) - containerRect.top) / zoom + container.scrollTop;
      // The box the icon will occupy (editor-css.ts hangs it left of the
      // anchor, and a closer above the anchor's bottom edge).
      const drawnTop = closing ? top - TAG_SIZE : top;
      const covers = (slotIndex: number): boolean =>
        placed.some((box) => Math.abs(box.y - drawnTop) < TAG_SIZE && Math.abs(box.x - (left - slotIndex * TAG_STEP)) < TAG_SIZE);
      let slot = 0;
      while (covers(slot)) slot += 1;
      placed.push({ x: left - slot * TAG_STEP, y: drawnTop });
      const attrs = Array.from(chip.querySelectorAll(".gp-block-chip__attr"), (a) => (a.textContent ?? "").trim());
      // A div with the button role rather than a <button>: the fork treats a
      // mousedown on a real button inside its content container as one of
      // its own controls and drops the selection this click just set.
      const tag = doc.createElement("div");
      tag.setAttribute("role", "button");
      tag.tabIndex = 0;
      tag.className = `${MARKER_TAG_CLASS} ${MARKER_TAG_CLASS}--${kind}${closing ? ` ${MARKER_TAG_CLASS}--closing` : ""}`;
      tag.title = [text, ...attrs].filter(Boolean).join("\n");
      tag.setAttribute("aria-label", `${kind} marker: ${text}`);
      tag.setAttribute("data-gp-kind", kind);
      const start = chip.getAttribute(CHIP_CARET_ATTR);
      if (start !== null) tag.setAttribute(CHIP_CARET_ATTR, start);
      tag.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${glyphFor(kind)}</svg>`;
      tag.style.setProperty("--gp-tag-slot", String(slot));
      tag.style.left = `${left}px`;
      tag.style.top = `${top}px`;
      const offset = Number(start);
      if (Number.isFinite(offset) && options.onActivate) {
        // pointerdown, not mousedown: the fork handles pointer events on its
        // container and a real click reached it first, which cleared the
        // selection this handler had just set (a synthetic mousedown, which
        // no pointerdown precedes, worked). Handled here and stopped, the
        // fork never sees a press that was aimed at the margin.
        tag.addEventListener("pointerdown", (event) => {
          // The default would move focus (and the caret) to wherever the
          // icon happens to be drawn, which is over the page margin.
          event.preventDefault();
          event.stopPropagation();
          options.onActivate?.(offset);
        });
        tag.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          options.onActivate?.(offset);
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
