/**
 * The page-size choices, shared by the new-book wizard and Book settings
 * (#357) so the two surfaces offer — and word — exactly the same options.
 *
 * Pure data + arithmetic: no `gutterpress` value import, no `node:*` (CLAUDE.md
 * §8). The labels are UI copy; the lib's `PRESET_IDS` / preset geometry is the
 * authority (`scaffoldProject` and `setPageSetup` reject anything unknown), and
 * the named sizes below carry the exact point values the manifest records.
 */

/** Which vendor the book is DESIGNED for (ADR 0008) — the manifest `preset:`. */
export type PresetChoice = "dtrpg" | "book" | "custom";

export const PRESET_CHOICES: Array<{ id: PresetChoice; label: string; description: string }> = [
  {
    id: "dtrpg",
    label: "DriveThruRPG print",
    description: "Print-on-demand ready for DriveThruRPG: trim, ink and PDF checks preset.",
  },
  {
    id: "book",
    label: "Trade book",
    description: "A neutral 6×9in book with no print-service rules.",
  },
  {
    id: "custom",
    label: "Custom size",
    description: "You set the page size your book is designed for.",
  },
];

/** Authors think in INCHES; the manifest stores points (72pt = 1in). */
export const PT_PER_INCH = 72;

export interface CommonSize {
  id: string;
  label: string;
  /** Exact trim in points, or null for "I'll type my own". */
  points: { width: number; height: number } | null;
}

export const COMMON_SIZES: CommonSize[] = [
  { id: "letter", label: "US Letter — 8.5 × 11 in", points: { width: 612, height: 792 } },
  { id: "trade", label: "Trade paperback — 6 × 9 in", points: { width: 432, height: 648 } },
  { id: "digest", label: "Digest — 5.5 × 8.5 in", points: { width: 396, height: 612 } },
  { id: "a4", label: "A4 — 210 × 297 mm", points: { width: 595, height: 842 } },
  { id: "a5", label: "A5 — 148 × 210 mm", points: { width: 420, height: 595 } },
  { id: "custom", label: "My own size…", points: null },
];

/** Round to 3dp so 8.27in doesn't land as 595.44000000000005pt. */
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * The trim in points a size dropdown + typed inches mean, or null while the
 * typed inches are incomplete. A named size wins over the inches fields.
 */
export function trimPoints(
  sizeChoice: string,
  widthIn: string,
  heightIn: string,
): { width: number; height: number } | null {
  const named = COMMON_SIZES.find((s) => s.id === sizeChoice)?.points;
  if (named) return named;
  const w = Number(widthIn);
  const h = Number(heightIn);
  if (!(Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0)) return null;
  return { width: round3(w * PT_PER_INCH), height: round3(h * PT_PER_INCH) };
}

/** Points -> an inches string for a number input (`612` -> `"8.5"`). */
export function pointsToInches(points: number): string {
  return String(round3(points / PT_PER_INCH));
}

/**
 * Which dropdown row a recorded trim is: the named size within half a point
 * (the validation tolerance), else the "My own size…" row.
 */
export function sizeChoiceFor(width: number, height: number): string {
  const hit = COMMON_SIZES.find(
    (s) =>
      s.points !== null &&
      Math.abs(s.points.width - width) < 0.5 &&
      Math.abs(s.points.height - height) < 0.5,
  );
  return hit?.id ?? "custom";
}
