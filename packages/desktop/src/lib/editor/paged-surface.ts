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
  PX_PER_PT,
  resolvePage,
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
  // `:scope` as well as `:root`: the book's CSS reaches the editor scoped
  // into the document element, with its `:root` rules rewritten to `:scope`
  // (`composeEditorCss`). The `@page` rules are hoisted out of that scope
  // and still reference the book's own custom properties, so without this a
  // book whose page geometry is expressed in variables — `@page { margin:
  // var(--page-margin) ... }` — throws here and the editor silently stops
  // paginating altogether.
  const model = extract(css, { rootSelectors: [":root", ":scope"] });
  // One entry is enough: the book's CSS is stable while a project is open,
  // and a stale entry would pin a whole GCPM model per edit of the theme.
  modelCache.clear();
  modelCache.set(css, model);
  return model;
}

export function createPagedSurface(bookCss: string, doc: Document = document): PagedSurface {
  injectViewerCss(doc);
  const model = modelFor(bookCss);
  /** The book's default page width in CSS px — known from the model, before anything is laid out. */
  const pageWidthPx = resolvePage(model).geometry.width * PX_PER_PT;
  const listeners = new Set<(totalPages: number) => void>();
  let pages = 0;
  let decoration: DecorationApi | undefined;
  let layout: ReturnType<typeof paginate> | undefined;
  let resize: ResizeObserver | undefined;
  let fontsSettled = false;
  let disposed = false;

  /**
   * Scale the whole stage down when a page is wider than the pane, exactly
   * as the standalone viewer's own `fitZoom()` does — `.gp-stage`'s `zoom`
   * multiplies `--gutterpress-fit-zoom` in. Without it a Letter page (816px)
   * simply overflows a 450px editor pane and the author sees a sliver.
   *
   * This runs BEFORE pagination, and the page width comes from the MODEL
   * rather than from a rendered strip. `zoom` changes used values, so a
   * zoom applied after fragmenting means every page count was measured at
   * the previous zoom: the cover paginated into two pages at 1:1 and then
   * shrank to fit one, leaving a phantom second page. Ordering it first is
   * what makes the editor's page count match the book's.
   */
  function fit(stage: HTMLElement): void {
    const host = stage.parentElement?.parentElement;
    const available = (host?.clientWidth ?? 0) - STAGE_PADDING * 2;
    if (!Number.isFinite(pageWidthPx) || pageWidthPx <= 0 || available <= 0) return;
    stage.style.setProperty("--gutterpress-fit-zoom", String(Math.min(1, available / pageWidthPx)));
  }

  /**
   * Re-paginate OUTSIDE the editor's own render (fonts arriving, the pane
   * resizing). It must go through `relayout()`, not a fresh `paginate()`:
   * the document is currently in its paginated shape, and fragmenting it
   * again would wrap the previous run wrappers in new ones. `relayout()`
   * restores the flat document first, which is what makes a re-run
   * idempotent — without it the page count climbed on every resize.
   */
  function refresh(documentElement: HTMLElement): void {
    if (disposed || !documentElement.isConnected) return;
    if (!layout) {
      run(documentElement);
      return;
    }
    const stage = documentElement.parentElement;
    if (stage) fit(stage);
    layout.relayout();
    applySpreadMode(layout.strips, false);
    decoration?.redraw();
    pages = layout.totalPages;
    for (const listener of listeners) listener(pages);
  }

  /**
   * Re-paginate once the document's art has actually loaded.
   *
   * An image with no intrinsic size yet measures as a placeholder — near
   * zero — so a page count taken before it loads is a page count for a
   * document with its plates missing. This is the same problem the font
   * wait above solves, and the same answer: let it settle, then lay it out
   * again. Both a load and an error settle it; a broken reference is a real,
   * final size too.
   */
  function awaitImages(documentElement: HTMLElement): void {
    const pending = [...documentElement.querySelectorAll("img")].filter((img) => !img.complete);
    if (pending.length === 0) return;
    let left = pending.length;
    const settle = (): void => {
      if (--left === 0) refresh(documentElement);
    };
    for (const img of pending) {
      img.addEventListener("load", settle, { once: true });
      img.addEventListener("error", settle, { once: true });
    }
  }

  function run(documentElement: HTMLElement): void {
    const stage = documentElement.parentElement;
    if (stage) {
      stage.classList.add(STAGE_CLASS);
      fit(stage);
    }
    layout = paginate(model, { root: documentElement });
    // Single-page view is a ONE-COLUMN wrap, not the unwrapped default: the
    // unwrapped strip lays every page out in one long horizontal row. Must
    // run before `decorate`, which positions sheets from the wrap geometry.
    applySpreadMode(layout.strips, false);
    decoration = decorate(layout, { canvasRoots: [documentElement] });
    // A book's own webfonts load asynchronously, and text measured in a
    // fallback face breaks into different pages than the real one — the
    // editor would sit one page long until the next edit re-rendered it.
    // Re-paginate once, the first time the fonts are actually ready.
    if (!fontsSettled) {
      fontsSettled = true;
      void doc.fonts?.ready
        .then(() => refresh(documentElement))
        .catch(() => {
          // No font API, or a face failed to load — what is on screen stands.
        });
    }
    awaitImages(documentElement);
    if (stage && !resize) {
      // A resize changes the fit zoom, which changes how much fits on a
      // page — so the whole pagination is redone, not just the scale.
      resize = new ResizeObserver(() => refresh(documentElement));
      const host = stage.parentElement?.parentElement;
      if (host) resize.observe(host);
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
      layout = undefined;
      resize?.disconnect();
      resize = undefined;
      listeners.clear();
      decoration = undefined;
    },
  };
}
