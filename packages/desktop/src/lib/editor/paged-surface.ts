/**
 * The paged editing surface: the vendored vscode markdown editor's live
 * document, paginated on screen by the SAME engine that paginates the
 * preview (`gutterpress/viewer`).
 *
 * This is what makes the editor and the viewer one thing. The editor renders
 * the author's blocks; after every render — synchronously, before the editor
 * measures caret geometry — this module hands the editor's document element
 * to `paginate()` as a flow root and lets Chromium fragment it into the
 * book's own page boxes, then `decorate()` paints the sheets, margin boxes,
 * running heads and folios around them. Nothing here re-implements layout:
 * the geometry comes from the book's `@page` rules, read out of the same
 * composed stylesheet the mount injects.
 *
 * Re-paginating on every render is not a choice — the editor's own child
 * reconciler re-parents every block back under the document element when it
 * renders, which flattens the strips. That is also what keeps this honest:
 * the pages you see are always a fresh fragmentation of the current text.
 */
import {
  applySpreadMode,
  decorate,
  extract,
  injectViewerCss,
  paginate,
  type DecorationApi,
  type GcpmModel,
} from "gutterpress/viewer";

/** Class the fork's scrolling content container gets so the viewer's stage chrome (backdrop, padding, zoom) applies to it. */
const STAGE_CLASS = "gp-stage";
/** `.gp-stage`'s own padding (viewer.css), subtracted when fitting a page to the pane. */
const STAGE_PADDING = 32;

export interface PagedSurface {
  /** Pass to the mount's `afterDocumentMount`. */
  readonly onDocumentMount: (documentElement: HTMLElement) => void;
  /** Page count of the most recent pagination; 0 before the first render. */
  readonly totalPages: () => number;
  /** Fires after every pagination with the current page count. */
  readonly onPaginated: (listener: (totalPages: number) => void) => () => void;
  readonly dispose: () => void;
}

const modelCache = new Map<string, GcpmModel>();

function modelFor(css: string): GcpmModel {
  const cached = modelCache.get(css);
  if (cached) return cached;
  const model = extract(css);
  // One entry is enough: the book's CSS is stable while a project is open,
  // and a stale entry would pin a whole GCPM model per edit of the theme.
  modelCache.clear();
  modelCache.set(css, model);
  return model;
}

export function createPagedSurface(bookCss: string, doc: Document = document): PagedSurface {
  injectViewerCss(doc);
  const model = modelFor(bookCss);
  const listeners = new Set<(totalPages: number) => void>();
  let pages = 0;
  let decoration: DecorationApi | undefined;
  let resize: ResizeObserver | undefined;
  let disposed = false;

  /**
   * Scale the whole stage down when a page is wider than the pane, exactly
   * as the standalone viewer's own `fitZoom()` does — `.gp-stage`'s `zoom`
   * multiplies `--gutterpress-fit-zoom` in. Without it a Letter page (816px)
   * simply overflows a 450px editor pane and the author sees a sliver.
   */
  function fit(stage: HTMLElement, documentElement: HTMLElement): void {
    const strip = documentElement.querySelector<HTMLElement>(".gp-strip");
    const pageW = strip ? parseFloat(getComputedStyle(strip).getPropertyValue("--gp-page-w")) : NaN;
    const host = stage.parentElement?.parentElement;
    const available = (host?.clientWidth ?? 0) - STAGE_PADDING * 2;
    if (!Number.isFinite(pageW) || pageW <= 0 || available <= 0) return;
    stage.style.setProperty("--gutterpress-fit-zoom", String(Math.min(1, available / pageW)));
  }

  function run(documentElement: HTMLElement): void {
    const stage = documentElement.parentElement;
    if (stage) stage.classList.add(STAGE_CLASS);
    const layout = paginate(model, { root: documentElement });
    // Single-page view is a ONE-COLUMN wrap, not the unwrapped default: the
    // unwrapped strip lays every page out in one long horizontal row. Must
    // run before `decorate`, which positions sheets from the wrap geometry.
    applySpreadMode(layout.strips, false);
    decoration = decorate(layout, { canvasRoots: [documentElement] });
    if (stage) {
      fit(stage, documentElement);
      if (!resize) {
        resize = new ResizeObserver(() => fit(stage, documentElement));
        const host = stage.parentElement?.parentElement;
        if (host) resize.observe(host);
      }
    }
    pages = layout.totalPages;
    for (const listener of listeners) listener(pages);
  }

  return {
    onDocumentMount(documentElement: HTMLElement): void {
      if (disposed) return;
      // On the editor's FIRST render its document element is still detached
      // (the view appends it after building it), and every geometry read on
      // a detached element is empty — pagination would measure NaN pages.
      // Later renders reuse the mounted element and paginate synchronously,
      // which is what keeps caret geometry correct while typing.
      if (!documentElement.isConnected) {
        requestAnimationFrame(() => {
          if (!disposed && documentElement.isConnected) run(documentElement);
        });
        return;
      }
      run(documentElement);
    },
    totalPages: () => pages,
    onPaginated(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      resize?.disconnect();
      resize = undefined;
      listeners.clear();
      decoration = undefined;
    },
  };
}
