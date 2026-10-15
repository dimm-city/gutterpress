/**
 * Print overlays — the host side of the preview toolbar toggle.
 *
 * The overlays themselves (three layers: bleed, safe area, page margins, each
 * with its own colour) and their legend are drawn by the viewer inside the
 * preview frame (cli `engine/viewer/overlay.ts`); the app owns only the
 * choices — the master on/off (`preview.marginOverlay`), which layers show
 * (`overlayLayers`), their colours (`overlayColors`) and the strength, all
 * persisted — and shows what the viewer found. This module is the pure part:
 * the viewer's result type, the settings read as the viewer takes them, and the
 * words for the toolbar button.
 *
 * PWA-clean (§8): no host imports.
 */
import { DEFAULT_SETTINGS } from "./platform/shared-types";

/** The layers, in the order the toolbar menu and the settings list them. */
export const OVERLAY_LAYERS = [
  { id: "bleed", label: "Bleed" },
  { id: "safe", label: "Safe area" },
  { id: "margins", label: "Page margins" },
] as const;

export type MarginOverlayLayer = (typeof OVERLAY_LAYERS)[number]["id"];
export type MarginOverlayLayers = Record<MarginOverlayLayer, boolean>;
export type MarginOverlayColors = Record<MarginOverlayLayer, string>;

/** What the viewer reports after drawing: the `overlayChanged` event's detail. */
export interface MarginOverlaySummary {
  on: boolean;
  /** the layers that are drawn; the counts below are only judged while `safe` is one of them */
  layers: MarginOverlayLayers;
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
  layers?: Partial<MarginOverlayLayers>;
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
    layers: overlayLayersFrom(detail.layers),
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

/** What the app sends the viewer with the layers (`setMarginOverlay`'s second argument). */
export interface MarginOverlayStyle {
  strength: "subtle" | "normal" | "strong";
  colors: MarginOverlayColors;
}

export const MARGIN_OVERLAY_STRENGTHS: ReadonlyArray<{ value: MarginOverlayStyle["strength"]; label: string }> = [
  { value: "subtle", label: "Subtle" },
  { value: "normal", label: "Normal" },
  { value: "strong", label: "Strong" },
];

const DEFAULTS = DEFAULT_SETTINGS.preview;

/** The persisted layer choice; a layer that is missing or hand-edited to a non-boolean is on, as by default. */
export function overlayLayersFrom(layers: unknown): MarginOverlayLayers {
  const l = (layers && typeof layers === "object" ? layers : {}) as Record<string, unknown>;
  const on = (id: MarginOverlayLayer) => (typeof l[id] === "boolean" ? (l[id] as boolean) : DEFAULTS.overlayLayers[id]);
  return { bleed: on("bleed"), safe: on("safe"), margins: on("margins") };
}

/** The persisted colours as the viewer takes them; a hand-edited bad value falls back to that layer's default. */
function overlayColorsFrom(colors: unknown): MarginOverlayColors {
  const c = (colors && typeof colors === "object" ? colors : {}) as Record<string, unknown>;
  const color = (id: MarginOverlayLayer) =>
    typeof c[id] === "string" && /^#[0-9a-f]{6}$/i.test(c[id] as string) ? (c[id] as string) : DEFAULTS.overlayColors[id];
  return { bleed: color("bleed"), safe: color("safe"), margins: color("margins") };
}

/** The persisted colours and strength as the viewer takes them. */
export function overlayStyleFrom(colors: unknown, strength: unknown): MarginOverlayStyle {
  return {
    strength: strength === "subtle" || strength === "strong" ? strength : "normal",
    colors: overlayColorsFrom(colors),
  };
}

/** The toolbar button's tooltip (and accessible name), for its current state: one line. */
export function overlayTooltip(on: boolean, summary: MarginOverlaySummary | null): string {
  if (!on) {
    return "Show print overlays: bleed, safe area and page margins, with content outside the safe area highlighted";
  }
  const found: string[] = [];
  // only the safe layer judges the book, so only then is there anything to report
  if (summary?.layers.safe) {
    const { text, art, bleed, offPage } = summary.counts;
    const outside = [text > 0 && `${text} text`, art > 0 && `${art} art`].filter(Boolean).join(", ");
    if (summary.issues === 0) found.push("everything inside the safe area");
    if (outside) found.push(`${outside} outside the safe area`);
    if (bleed > 0) found.push(`${bleed} in the bleed band`);
    if (offPage > 0) found.push(`${offPage} off the page`);
    if (summary.intended > 0) found.push(`${summary.intended} placed on purpose`);
  }
  return ["Hide print overlays", ...found].join(" · ");
}
