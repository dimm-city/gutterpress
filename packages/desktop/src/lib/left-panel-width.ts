/**
 * Left-panel width bounds — pure math, shared by the panel itself (mount,
 * drag, arrow keys, window resize) and by `+page.svelte` when it restores a
 * persisted width. Both must agree, or one clamps and the other clamps back.
 *
 * The open panel is at least {@link PANEL_MIN_W}px: below that its lists
 * (project names, chapter titles, media filenames) truncate to the point of
 * being unreadable, which is the whole job of the panel.
 *
 * The exception is a window too narrow to give that away. Below ~820px the
 * panel is already an overlay above a scrim, so it may take most of the
 * width — but never the whole window: `EDGE_RESERVE` keeps a strip of the
 * workspace visible, so it still reads as a panel over content and stays
 * dismissable by clicking that strip. `ABSOLUTE_MIN_W` is the hard floor for
 * the very narrowest windows.
 */

/** The readable minimum on any window that can afford it. */
export const PANEL_MIN_W = 300;
/** The widest the panel may be dragged. */
export const PANEL_MAX_W = 480;
/** Hard floor when even the reserve can't be honoured. */
export const ABSOLUTE_MIN_W = 200;
/** Workspace strip that must stay visible beside the panel. */
export const EDGE_RESERVE = 72;

export interface PanelWidthBounds {
  /** Smallest allowed width right now. */
  lo: number;
  /** Largest allowed width right now. */
  hi: number;
}

/**
 * The [lo, hi] the panel may occupy in a viewport `viewportWidth` px wide.
 * The ceiling drops first; the floor follows it down only when it has to (a
 * floor above the ceiling would push the panel off-screen).
 */
export function panelWidthBounds(viewportWidth: number): PanelWidthBounds {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) {
    return { lo: PANEL_MIN_W, hi: PANEL_MAX_W };
  }
  const spare = Math.round(viewportWidth - EDGE_RESERVE);
  const hi = Math.max(ABSOLUTE_MIN_W, Math.min(PANEL_MAX_W, spare));
  return { lo: Math.min(PANEL_MIN_W, hi), hi };
}

/** Clamp a width (persisted, dragged, or typed) into today's bounds. */
export function clampPanelWidth(width: number, viewportWidth: number): number {
  const { lo, hi } = panelWidthBounds(viewportWidth);
  const w = Number.isFinite(width) ? Math.round(width) : PANEL_MIN_W;
  return Math.min(hi, Math.max(lo, w));
}

/** The live viewport width, or 0 during SSR (bounds fall back to defaults). */
export function viewportWidth(): number {
  return typeof window === "undefined" ? 0 : window.innerWidth;
}
