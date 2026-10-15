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
  /** text and art that leave their safe area by accident, or the trim (the count in the toolbar) */
  issues: number;
  /** art placed on purpose (.gp-bleed, .gp-pin, …) outside it — shown softly, never counted */
  intended: number;
  /** the project's bleed in pt (`page.bleed`, inside the page); 0 = none set */
  bleedPt: number;
  /** the TEXT rule's inset from the trim in pt (`page.safe`); 0 = none set */
  safePt: number;
  /** the ART rule's inset on the top, bottom and outer edge in pt (`page.artSafe`, else `page.safe`) */
  artSafePt: number;
  /** what `issues` is made of, plus the placed art: one per outlined rect */
  counts: { text: number; art: number; bleed: number; offPage: number; intended: number };
}

/** A viewer result, or null for anything that is not one (older viewer, off). */
export function overlaySummaryFrom(detail: {
  on?: boolean;
  issues?: number;
  intended?: number;
  bleedPt?: number;
  safePt?: number;
  artSafePt?: number;
  counts?: Partial<MarginOverlaySummary["counts"]>;
} | null | undefined): MarginOverlaySummary | null {
  if (!detail || detail.on !== true) return null;
  const count = (n: number | undefined) => Math.max(0, Math.floor(n ?? 0));
  return {
    on: true,
    issues: count(detail.issues),
    intended: count(detail.intended),
    bleedPt: Math.max(0, detail.bleedPt ?? 0),
    safePt: Math.max(0, detail.safePt ?? 0),
    artSafePt: Math.max(0, detail.artSafePt ?? 0),
    counts: {
      text: count(detail.counts?.text),
      art: count(detail.counts?.art),
      bleed: count(detail.counts?.bleed),
      offPage: count(detail.counts?.offPage),
      intended: count(detail.counts?.intended),
    },
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
    const { text, art, bleed, offPage } = summary.counts;
    const outside = [text > 0 && `${text} text`, art > 0 && `${art} art`].filter(Boolean).join(", ");
    if (summary.issues === 0) lines.push("Everything is inside the safe area");
    if (outside) lines.push(`${outside} outside the safe area`);
    if (bleed > 0) lines.push(`${bleed} in the bleed band`);
    if (offPage > 0) lines.push(`${offPage} off the page`);
    if (summary.intended > 0) {
      lines.push(`${plural(summary.intended, "piece", "pieces")} of art placed on purpose (not counted)`);
    }
    const textIn = formatBleed(summary.safePt);
    lines.push(
      summary.safePt <= 0 && summary.artSafePt <= 0
        ? "No safe area set \u2014 set page.safe in manifest.yaml"
        : summary.artSafePt === summary.safePt
          ? `Safe area: ${textIn} inside the trim`
          : `Safe area: text ${textIn}, art ${formatBleed(summary.artSafePt)} (${textIn} at the binding), inside the trim`,
    );
    lines.push(
      summary.bleedPt > 0
        ? `Bleed: ${formatBleed(summary.bleedPt)}, inside the page on the top, bottom and outer edges`
        : "No bleed set \u2014 set page.bleed in manifest.yaml",
    );
  }
  return lines.join("\n");
}
