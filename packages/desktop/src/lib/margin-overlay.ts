/**
 * Margin & bleed overlay — the host side of the preview toolbar toggle.
 *
 * The overlay itself is drawn by the viewer inside the preview frame
 * (cli `engine/viewer/overlay.ts`); the app owns only the on/off choice
 * (`preview.marginOverlay`, persisted) and shows what the viewer found. This
 * module is the pure part: the viewer's result type and the words for it.
 *
 * PWA-clean (§8): no host imports.
 */

/** What the viewer reports after drawing: the `overlayChanged` event's detail. */
export interface MarginOverlaySummary {
  on: boolean;
  /** elements that leave their text area by accident (the count in the toolbar) */
  issues: number;
  /** art placed on purpose (.gp-bleed, .gp-pin, …) outside it — shown softly, never counted */
  intended: number;
  /** the book's `@page` bleed in pt; 0 = the book defines none */
  bleedPt: number;
}

/** A viewer result, or null for anything that is not one (older viewer, off). */
export function overlaySummaryFrom(detail: {
  on?: boolean;
  issues?: number;
  intended?: number;
  bleedPt?: number;
} | null | undefined): MarginOverlaySummary | null {
  if (!detail || detail.on !== true) return null;
  return {
    on: true,
    issues: Math.max(0, Math.floor(detail.issues ?? 0)),
    intended: Math.max(0, Math.floor(detail.intended ?? 0)),
    bleedPt: Math.max(0, detail.bleedPt ?? 0),
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "0.125 in" for a bleed in pt. */
export function formatBleed(pt: number): string {
  const inches = pt / 72;
  return `${Number.isInteger(inches) ? inches : inches.toFixed(3).replace(/0+$/, "")} in`;
}

/** The toolbar button's tooltip (and accessible name), for its current state. */
export function overlayTooltip(on: boolean, summary: MarginOverlaySummary | null): string {
  if (!on) {
    return "Show margins and bleed: outlines each page's margins and bleed area and highlights content that spills into them";
  }
  const lines = ["Hide margins and bleed"];
  if (summary) {
    lines.push(
      summary.issues > 0
        ? `${plural(summary.issues, "element extends", "elements extend")} past the margins`
        : "Nothing extends past the margins",
    );
    if (summary.intended > 0) {
      lines.push(`${plural(summary.intended, "piece", "pieces")} of art placed on purpose (not counted)`);
    }
    lines.push(
      summary.bleedPt > 0
        ? `Bleed: ${formatBleed(summary.bleedPt)}`
        : "No bleed defined: add @page { bleed: 0.125in } to show it",
    );
  }
  return lines.join("\n");
}
