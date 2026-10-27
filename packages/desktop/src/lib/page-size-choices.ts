/**
 * The page-size choices, shared by the new-book wizard and Book setup
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
    description: "US Letter (8.5 × 11 in), set up for DriveThruRPG's print rules.",
  },
  {
    id: "book",
    label: "Trade paperback",
    description: "6 × 9 in. No print-service rules.",
  },
  {
    id: "custom",
    label: "Other size",
    description: "A common size (Letter, A4, Digest…) or one you type.",
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
 * What an inches field holds: the string we set it to, the number the author
 * typed (a number input's `bind:value` hands back a number), or null once the
 * author emptied it.
 */
export type InchesDraft = string | number | null;

/**
 * Typed inches -> points, or null while the field is not a length (empty, not
 * a number, negative). Zero is a length: a margin can be none.
 */
export function inchesToPoints(draft: InchesDraft): number | null {
  if (draft === null || String(draft).trim() === "") return null;
  const n = Number(draft);
  return Number.isFinite(n) && n >= 0 ? round3(n * PT_PER_INCH) : null;
}

/**
 * The trim in points a size dropdown + typed inches mean, or null while the
 * typed inches are incomplete. A named size wins over the inches fields.
 */
export function trimPoints(
  sizeChoice: string,
  widthIn: InchesDraft,
  heightIn: InchesDraft,
): { width: number; height: number } | null {
  const named = COMMON_SIZES.find((s) => s.id === sizeChoice)?.points;
  if (named) return named;
  const width = inchesToPoints(widthIn);
  const height = inchesToPoints(heightIn);
  if (!width || !height) return null;
  return { width, height };
}

/** The size drafts (dropdown row + typed inches) for a recorded trim, or the blank defaults for none. */
export function sizeDraftsFor(
  points: { width: number; height: number } | null | undefined,
): { sizeChoice: string; widthIn: string; heightIn: string } {
  if (!points) return { sizeChoice: "letter", widthIn: "", heightIn: "" };
  return {
    sizeChoice: sizeChoiceFor(points.width, points.height),
    widthIn: pointsToInches(points.width),
    heightIn: pointsToInches(points.height),
  };
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
