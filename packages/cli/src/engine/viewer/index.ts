/**
 * Folio viewer entry. Bundled to a single self-contained IIFE (`gutterpress-viewer.js`) —
 * zero runtime dependencies, no CSS parser in the hot path.
 *
 * Embed contract is an iframe (§3): the viewer owns its document, so CSSOM is
 * always same-origin and no shadow-DOM isolation machinery is needed.
 */
import { fragmentDocument, type FolioViewerApi, type LayoutOptions } from "./fragment.ts";
import { decorate, type DecorationApi } from "./decorate.ts";

export interface FolioApi extends FolioViewerApi {
  decoration: DecorationApi;
  goto(page: number): void;
  next(): void;
  prev(): void;
  currentPage(): number;
  /** re-fragment + redecorate after a content/CSS change (hot reload) */
  refresh(): void;
}

declare global {
  interface Window {
    Gutterpress?: FolioApi;
    /** @deprecated use window.Gutterpress */
    folio?: FolioApi;
    __folioReadyPending?: boolean;
  }
}

export async function mount(opts: LayoutOptions & { designer?: boolean } = {}) {
  const t0 = performance.now();
  const layout = await fragmentDocument(opts);
  const decoration = decorate(layout, { designer: opts.designer });
  const api: FolioApi = Object.assign(layout, {
    decoration,
    goto(page: number) {
      const target = decoration.sheetFor(page);
      target?.scrollIntoView({ block: "start", inline: "center" });
      current = Math.max(0, Math.min(layout.totalPages - 1, page));
      emit();
    },
    next: () => api.goto(current + 1),
    prev: () => api.goto(current - 1),
    currentPage: () => current,
    refresh() {
      layout.relayout();
      decoration.redraw();
      emit();
    },
  });
  let current = 0;
  const emit = () => {
    const detail = { page: current, pagecount: layout.totalPages };
    window.dispatchEvent(new CustomEvent("folio:page", { detail }));
    if (window.parent !== window) window.parent.postMessage({ folio: detail }, "*");
  };

  // the global must BE the mounted api: relayout() mutates totalPages /
  // warnings / blankPages in place, so a merged copy would read stale after a
  // refresh. Fold global.ts's module-namespace members in instead.
  const ns = window.Gutterpress as Record<string, unknown> | undefined;
  if (ns) for (const k of Object.keys(ns)) if (!(k in api)) (api as any)[k] = ns[k];
  window.Gutterpress = api;
  window.folio = api; // deprecated alias, same object
  (window as any).Folio = api; // deprecated alias, same object
  emit();
  window.dispatchEvent(
    new CustomEvent("folio:layout", {
      detail: { ms: performance.now() - t0, pages: layout.totalPages },
    }),
  );
  return api;
}

if (typeof document !== "undefined" && !(window as any).__FOLIO_MANUAL__) {
  const params = new URLSearchParams(location.search);
  const start = () => mount({ designer: params.has("designer") });
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", start, { once: true });
  else void start();
}

export { fragmentDocument } from "./fragment.ts";
export * from "./fragment.ts";
