/**
 * Safe area & bleed overlay — the host side of the preview toolbar toggle.
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
  /** elements that leave the safe area by accident (the count in the toolbar) */
  issues: number;
  /** art placed on purpose (.gp-bleed, .gp-pin, …) outside it — shown softly, never counted */
  intended: number;
  /** the project's bleed in pt (`page.bleed`, inside the page); 0 = none set */
  bleedPt: number;
  /** the project's safe-area inset in pt (`page.safe`); 0 = none set */
  safePt: number;
}

/** A viewer result, or null for anything that is not one (older viewer, off). */
export function overlaySummaryFrom(detail: {
  on?: boolean;
  issues?: number;
  intended?: number;
  bleedPt?: number;
  safePt?: number;
} | null | undefined): MarginOverlaySummary | null {
  if (!detail || detail.on !== true) return null;
  return {
    on: true,
    issues: Math.max(0, Math.floor(detail.issues ?? 0)),
    intended: Math.max(0, Math.floor(detail.intended ?? 0)),
    bleedPt: Math.max(0, detail.bleedPt ?? 0),
    safePt: Math.max(0, detail.safePt ?? 0),
  };
}

/** What the app sends the viewer with the on/off switch (`setMarginOverlay`'s second argument). */
export interface MarginOverlayStyle {
  color: string;
  strength: "subtle" | "normal" | "strong";
}

export const MARGIN_OVERLAY_STRENGTHS: ReadonlyArray<{ value: MarginOverlayStyle["strength"]; label: string }> = [
  { value: "subtle", label: "Subtle" },
  { value: "normal", label: "Normal" },
  { value: "strong", label: "Strong" },
];

/** The two persisted settings as the viewer takes them; a hand-edited bad value falls back to the default. */
export function overlayStyleFrom(color: unknown, strength: unknown): MarginOverlayStyle {
  return {
    color: typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color) ? color : "#2f80ed",
    strength: strength === "subtle" || strength === "strong" ? strength : "normal",
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "0.125 in" for a length in pt. */
export function formatBleed(pt: number): string {
  const inches = pt / 72;
  return `${Number.isInteger(inches) ? inches : inches.toFixed(3).replace(/0+$/, "")} in`;
}

/** The toolbar button's tooltip (and accessible name), for its current state. */
export function overlayTooltip(on: boolean, summary: MarginOverlaySummary | null): string {
  if (!on) {
    return "Show safe area and bleed: outlines each page's safe area and bleed from your print settings and highlights content outside the safe area";
  }
  const lines = ["Hide safe area and bleed"];
  if (summary) {
    lines.push(
      summary.issues > 0
        ? `${plural(summary.issues, "element extends", "elements extend")} past the safe area`
        : "Everything is inside the safe area",
    );
    if (summary.intended > 0) {
      lines.push(`${plural(summary.intended, "piece", "pieces")} of art placed on purpose (not counted)`);
    }
    lines.push(
      summary.safePt > 0
        ? `Safe area: ${formatBleed(summary.safePt)} inside the trim`
        : "No safe area set \u2014 set page.safe in manifest.yaml",
    );
    lines.push(
      summary.bleedPt > 0
        ? `Bleed: ${formatBleed(summary.bleedPt)}, inside the page on the top, bottom and outer edges`
        : "No bleed set \u2014 set page.bleed in manifest.yaml",
    );
  }
  return lines.join("\n");
}
