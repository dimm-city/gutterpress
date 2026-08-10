/**
 * Gutterpress viewer entry. Bundled to a single self-contained IIFE (`gutterpress-viewer.js`) —
 * zero runtime dependencies, no CSS parser in the hot path.
 *
 * Embed contract is an iframe (§3): the viewer owns its document, so CSSOM is
 * always same-origin and no shadow-DOM isolation machinery is needed.
 */
import {
  applySpreadMode,
  fragmentDocument,
  type GutterpressViewerApi,
  type LayoutOptions,
} from "./fragment.ts";
import { decorate, type DecorationApi } from "./decorate.ts";

export interface GutterpressApi extends GutterpressViewerApi {
  decoration: DecorationApi;
  /** 1-based, matching `.gp-sheet[data-page]` and every other book-facing
   * page number in the API (pageOf() is the one deliberate exception — it's
   * documented 0-based for DOM-index math). Clamped to [1, totalPages]. */
  goto(page: number): void;
  next(): void;
  prev(): void;
  /** 1-based; see `goto()`. */
  currentPage(): number;
  /** re-fragment + redecorate after a content/CSS change (hot reload) */
  refresh(): void;
  /** two-up/spread view mode (viewer.css's `.gp-strip[data-wrap]`); no-op
   * to single-row on a browser without `column-wrap: wrap` support. */
  setSpread(on: boolean): void;
}

declare global {
  interface Window {
    Gutterpress?: GutterpressApi;
    __gpReadyPending?: boolean;
  }
}

let resizeListener: (() => void) | undefined;

export async function mount(opts: LayoutOptions & { designer?: boolean } = {}) {
  const t0 = performance.now();
  const layout = await fragmentDocument(opts);
  const decoration = decorate(layout, { designer: opts.designer });
  // Tracked here (not derived from the DOM) because `relayout()` rebuilds
  // `layout.strips` from scratch on every refresh — the fresh elements carry
  // no `data-wrap` attribute, so the previously-requested view mode has to be
  // re-applied explicitly, not just relied on to survive.
  let spreadOn = false;
  const api: GutterpressApi = Object.assign(layout, {
    decoration,
    goto(page: number) {
      // Public surface is 1-based (matches dataset.page); sheetFor()/`current`
      // are 0-based internally (matches pageOf()). Clamp BEFORE converting so
      // an out-of-range call (e.g. goto(totalPages) rounding up past the
      // last valid index) still lands on the last page instead of missing
      // decoration.sheetFor() and scrolling nowhere.
      const clamped = Math.max(1, Math.min(layout.totalPages, Math.round(page)));
      current = clamped - 1;
      const target = decoration.sheetFor(current);
      target?.scrollIntoView({ block: "start", inline: "center" });
      emit();
    },
    next: () => api.goto(api.currentPage() + 1),
    prev: () => api.goto(api.currentPage() - 1),
    currentPage: () => current + 1,
    refresh() {
      layout.relayout();
      applySpreadMode(layout.strips, spreadOn);
      decoration.redraw();
      emit();
    },
    setSpread(on: boolean) {
      spreadOn = on;
      applySpreadMode(layout.strips, spreadOn);
      decoration.redraw();
      emit();
    },
  });
  let current = 0;
  const emit = () => {
    const detail = { page: current, pagecount: layout.totalPages };
    window.dispatchEvent(new CustomEvent("gp:page", { detail }));
    if (window.parent !== window) window.parent.postMessage({ gp: detail }, "*");
  };

  // the global must BE the mounted api: relayout() mutates totalPages /
  // warnings / blankPages in place, so a merged copy would read stale after a
  // refresh. Fold global.ts's module-namespace members in instead.
  const ns = window.Gutterpress as Record<string, unknown> | undefined;
  if (ns) for (const k of Object.keys(ns)) if (!(k in api)) (api as any)[k] = ns[k];
  window.Gutterpress = api;
  emit();
  window.dispatchEvent(
    new CustomEvent("gp:layout", {
      detail: { ms: performance.now() - t0, pages: layout.totalPages },
    }),
  );
  fitZoom();
  // Repeat mount() calls (hot reload of the standalone viewer, re-embedding)
  // must not stack a new listener on top of the last one — each stale
  // closure would keep firing fitZoom() forever.
  if (resizeListener) window.removeEventListener("resize", resizeListener);
  resizeListener = fitZoom;
  window.addEventListener("resize", resizeListener);
  return api;
}

/**
 * Narrow viewports (phones) get a SMALLER PAGE, never a reflow: scale the
 * stage down via `--gutterpress-fit-zoom`, which `.gp-stage` multiplies
 * with the host's own `--gutterpress-zoom` (viewer.css). Never zooms up past
 * 1 — only shrinks to fit.
 */
function fitZoom() {
  const sheet = document.querySelector<HTMLElement>(".gp-sheet");
  if (!sheet) return;
  const pageW = parseFloat(sheet.style.getPropertyValue("--gp-page-w"));
  if (!pageW) return;
  const stagePadding =
    parseFloat(getComputedStyle(document.body).paddingLeft) +
    parseFloat(getComputedStyle(document.body).paddingRight);
  const available = window.innerWidth - stagePadding;
  if (available > 0 && available < pageW)
    document.body.style.setProperty("--gutterpress-fit-zoom", String(available / pageW));
  else document.body.style.removeProperty("--gutterpress-fit-zoom");
}

if (typeof document !== "undefined" && !(window as any).__GP_MANUAL__) {
  const params = new URLSearchParams(location.search);
  const start = () => mount({ designer: params.has("designer") });
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", start, { once: true });
  else void start();
}

export { fragmentDocument } from "./fragment.ts";
export * from "./fragment.ts";
