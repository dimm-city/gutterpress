/**
 * Render-parity report extraction + comparison (issue #252).
 *
 * A "report" is a canonical, deterministic JSON summary of everything about a
 * rendered PDF that print fidelity actually depends on: page count, page
 * size, every non-whitespace text run's exact string + extents, and every
 * placed image's position + size. Two builds of the "same" document — the
 * same markdown+CSS run through the same Chromium twice, or a base vs.
 * candidate CLI on the same fixture in one CI job — produce byte-identical
 * reports when nothing about the printed pages changed, and a readable
 * page/kind/before->after diff when something did.
 *
 * Deliberately excluded from the report: file paths, timestamps, pdf.js's own
 * (post-subsetting) font names, and XObject resource names — all either
 * non-deterministic across runs/environments or meaningless for parity (a
 * font subset can be renamed between two otherwise-identical builds while the
 * identical glyphs print at the identical position; that is not a diff this
 * gate exists to catch).
 *
 * Built directly over pdf-inspect.ts's existing primitives (`loadPdf`,
 * `getPageSize`, `getTextPass`, `getOpPass`) — no new dependency, no
 * rasterization, per CLAUDE.md §1/§3. See docs/render-parity-gate.md for the
 * CLI this backs (packages/cli/scripts/render-parity.ts).
 */
import { loadPdf, getPageSize, getTextPass, getOpPass } from "./pdf-inspect.ts";

/** Bumped only if the canonical report shape changes in a way old reports
 *  cannot be compared against (e.g. a committed baseline in the book repo). */
export const REPORT_VERSION = 1;

export interface TextRunReport {
  s: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ImageReport {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PageReport {
  w: number;
  h: number;
  text: TextRunReport[];
  images: ImageReport[];
}

export interface Report {
  version: 1;
  pageCount: number;
  pages: PageReport[];
}

/** Round to 3 decimal places — sub-thousandth-of-a-point noise is not a real
 *  layout difference, and fixing precision keeps two extractions of the same
 *  PDF byte-identical regardless of floating-point summation order. */
function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/**
 * Extract the canonical parity report for one PDF. Keys are always written in
 * the same order (`version`, `pageCount`, `pages`; each page `w`, `h`,
 * `text`, `images`; each run/image field in the order declared above) so
 * `serializeReport` produces byte-identical output for byte-identical input,
 * and so a committed baseline report diffs sanely in git.
 */
export async function extractReport(pdfPath: string): Promise<Report> {
  const doc = await loadPdf(pdfPath);
  if (!doc) throw new Error(`Cannot load PDF for render-parity extraction: ${pdfPath}`);

  const [{ runsByPage }, { imagesByPage }] = await Promise.all([
    getTextPass(doc),
    getOpPass(doc),
  ]);

  const pages: PageReport[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const { w, h } = getPageSize(page);
    const runs = runsByPage[i - 1] ?? [];
    const images = imagesByPage.get(i) ?? [];
    pages.push({
      w: round3(w),
      h: round3(h),
      text: runs.map((r) => ({
        s: r.s,
        x: round3(r.x),
        y: round3(r.y),
        w: round3(r.w),
        h: round3(r.h),
      })),
      images: images.map((im) => ({
        x: round3(im.x),
        y: round3(im.y),
        w: round3(im.placedW),
        h: round3(im.placedH),
      })),
    });
  }

  return { version: REPORT_VERSION, pageCount: doc.numPages, pages };
}

/**
 * Fixed layout serialization: `JSON.stringify(report, null, 1)` plus a
 * trailing newline. Two extractions of the same PDF are byte-identical
 * strings — the acceptance test for this whole gate — because `extractReport`
 * always builds the object in the same key order and every number is already
 * rounded to 3 decimals before it gets here.
 */
export function serializeReport(report: Report): string {
  return JSON.stringify(report, null, 1) + "\n";
}

// ---------------------------------------------------------------------------
// Compare
// ---------------------------------------------------------------------------

export type WaiverKind = "page-count" | "page-size" | "text" | "image";

export interface Waiver {
  /** 1-based page number. Omit for kind "page-count" (there is no page). */
  page?: number;
  kind: WaiverKind;
  /** Optional substring the text run's string must contain. Only meaningful
   *  for kind "text"; ignored for the other kinds. */
  match?: string;
  /** Non-empty, one line: why this diff is expected/acceptable. Required —
   *  a waiver with no reason is a usage error, not a silent pass. */
  reason: string;
}

export interface Diff {
  /** 1-based page number. Absent for kind "page-count". */
  page?: number;
  kind: WaiverKind;
  /** Index within the page's text/image array, when the diff is about one
   *  run/image rather than the array's length. */
  index?: number;
  before: string;
  after: string;
  /** The base run's string, for kind "text" — what a waiver's `match` tests
   *  against, and what a human reads to find the run in the source. */
  text?: string;
}

export interface CompareOptions {
  /** Points. Applies to text run and image extents (x/y/w/h). Default 0.5. */
  tolerance?: number;
  waivers?: Waiver[];
}

export interface CompareResult {
  /** Diffs NOT excused by any waiver — non-empty means the gate fails. */
  diffs: Diff[];
  /** Diffs that were found but matched a waiver. */
  waived: Diff[];
  /** Waivers that matched nothing this run — stale, should be deleted. */
  unusedWaivers: Waiver[];
}

/** A waiver failed validation (currently: missing/empty `reason`). The CLI
 *  treats this as a usage error (exit 2), distinct from a real diff (exit 1). */
export class WaiverValidationError extends Error {}

type Extent = { x: number; y: number; w: number; h: number };
const EXTENT_AXES = ["x", "y", "w", "h"] as const;
type ExtentAxis = (typeof EXTENT_AXES)[number];

/** Which of x/y/w/h differ by more than `tolerance`, in a fixed order. */
function diffAxes(before: Extent, after: Extent, tolerance: number): ExtentAxis[] {
  const axes: ExtentAxis[] = [];
  for (const axis of EXTENT_AXES) {
    if (Math.abs(before[axis] - after[axis]) > tolerance) axes.push(axis);
  }
  return axes;
}

function formatAxes(v: Extent, axes: ExtentAxis[]): string {
  return axes.map((a) => `${a} ${v[a].toFixed(3)}`).join(", ");
}

/**
 * Text runs align by INDEX within a page, not by content search — the two
 * sides are builds of what should be the same document, so index N's run is
 * expected to be the same run on both sides. A STRING mismatch means a reflow
 * moved content to different runs from that point on, so every following
 * index would otherwise register as a spurious mismatch; one line names the
 * divergence and the rest of the page is skipped (`return`) rather than
 * flooding the report with reflow noise. An EXTENT-only mismatch (same
 * string, different position) does not cascade the same way, so scanning
 * continues — a global CSS shift genuinely does move every run on the page,
 * and each is real, independent information.
 */
function diffTextRuns(
  out: Diff[],
  page: number,
  before: TextRunReport[],
  after: TextRunReport[],
  tolerance: number,
): void {
  const limit = Math.min(before.length, after.length);
  for (let i = 0; i < limit; i++) {
    const b = before[i]!;
    const a = after[i]!;
    if (b.s !== a.s) {
      out.push({ page, kind: "text", index: i, before: b.s, after: a.s, text: b.s });
      return; // reflow cascade past this point — one line is enough (see doc comment)
    }
    const axes = diffAxes(b, a, tolerance);
    if (axes.length > 0) {
      out.push({
        page,
        kind: "text",
        index: i,
        before: formatAxes(b, axes),
        after: formatAxes(a, axes),
        text: b.s,
      });
    }
  }
  if (before.length !== after.length) {
    out.push({
      page,
      kind: "text",
      before: `${before.length} run(s)`,
      after: `${after.length} run(s)`,
    });
  }
}

/** Images align by index (paint order); no string to cascade on, so every
 *  index up to the shorter side's length is compared independently. */
function diffImages(
  out: Diff[],
  page: number,
  before: ImageReport[],
  after: ImageReport[],
  tolerance: number,
): void {
  const limit = Math.min(before.length, after.length);
  for (let i = 0; i < limit; i++) {
    const b = before[i]!;
    const a = after[i]!;
    const axes = diffAxes(b, a, tolerance);
    if (axes.length > 0) {
      out.push({
        page,
        kind: "image",
        index: i,
        before: formatAxes(b, axes),
        after: formatAxes(a, axes),
      });
    }
  }
  if (before.length !== after.length) {
    out.push({
      page,
      kind: "image",
      before: `${before.length} image(s)`,
      after: `${after.length} image(s)`,
    });
  }
}

function computeRawDiffs(base: Report, cand: Report, tolerance: number): Diff[] {
  const diffs: Diff[] = [];

  if (base.pageCount !== cand.pageCount) {
    diffs.push({
      kind: "page-count",
      before: String(base.pageCount),
      after: String(cand.pageCount),
    });
  }

  // Pages beyond the shorter report have nothing on the other side to line up
  // against — the page-count diff above already says so; per-page checks only
  // make sense where both sides have a page N to compare.
  const pageLimit = Math.min(base.pages.length, cand.pages.length);
  for (let i = 0; i < pageLimit; i++) {
    const page = i + 1;
    const bp = base.pages[i]!;
    const cp = cand.pages[i]!;

    if (bp.w !== cp.w || bp.h !== cp.h) {
      diffs.push({
        page,
        kind: "page-size",
        before: `${bp.w.toFixed(3)}x${bp.h.toFixed(3)}`,
        after: `${cp.w.toFixed(3)}x${cp.h.toFixed(3)}`,
      });
    }

    diffTextRuns(diffs, page, bp.text, cp.text, tolerance);
    diffImages(diffs, page, bp.images, cp.images, tolerance);
  }

  return diffs;
}

function assertValidWaivers(waivers: Waiver[]): void {
  for (const w of waivers) {
    if (!w.reason || w.reason.trim().length === 0) {
      throw new WaiverValidationError(
        `Waiver missing a reason (page=${w.page ?? "-"}, kind=${w.kind}${
          w.match ? `, match=${JSON.stringify(w.match)}` : ""
        }) — every waiver must carry a one-line reason.`,
      );
    }
  }
}

function waiverMatches(w: Waiver, d: Diff): boolean {
  if (w.kind !== d.kind) return false;
  if (d.kind !== "page-count" && w.page !== d.page) return false;
  if (w.match !== undefined) {
    const haystack = d.text ?? d.before;
    if (!haystack.includes(w.match)) return false;
  }
  return true;
}

/**
 * Compare two reports. Throws {@link WaiverValidationError} (a usage error,
 * not a diff) if any waiver is missing its reason — validated up front, before
 * any comparison work, so a malformed waivers file never silently passes.
 *
 * Every waiver is matched against the FULL diff set (not a display-truncated
 * one — see `formatDiffs` for the printed-output cap) so an unwaived diff
 * past the cap still fails the gate, and a waiver is reported unused only
 * when it genuinely excused nothing.
 */
export function compareReports(
  base: Report,
  cand: Report,
  options: CompareOptions = {},
): CompareResult {
  const tolerance = options.tolerance ?? 0.5;
  const waivers = options.waivers ?? [];
  assertValidWaivers(waivers);

  const raw = computeRawDiffs(base, cand, tolerance);

  const diffs: Diff[] = [];
  const waived: Diff[] = [];
  const usedWaivers = new Set<Waiver>();
  for (const d of raw) {
    const w = waivers.find((w) => waiverMatches(w, d));
    if (w) {
      waived.push(d);
      usedWaivers.add(w);
    } else {
      diffs.push(d);
    }
  }
  const unusedWaivers = waivers.filter((w) => !usedWaivers.has(w));

  return { diffs, waived, unusedWaivers };
}

// ---------------------------------------------------------------------------
// Human-readable formatting
// ---------------------------------------------------------------------------

/** Per-page cap on printed diff lines — a reflowed page can otherwise drown
 *  the report in hundreds of individually-true but redundant shifted-run
 *  lines. The full, untruncated set still decides the exit code (see
 *  `compareReports`'s doc comment); this only shapes what a human reads. */
const MAX_LINES_PER_PAGE = 12;

function truncate(s: string, max = 60): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function formatOneDiff(d: Diff): string {
  const loc = d.page !== undefined ? `p${d.page}` : "doc";
  const quoted = d.kind === "text" && d.text !== undefined ? ` "${truncate(d.text)}"` : "";
  return `${loc} ${d.kind}${quoted} ${d.before} -> ${d.after}`;
}

/**
 * Render a `CompareResult` as the lines the CLI prints: every unwaived diff
 * (capped per page — see `MAX_LINES_PER_PAGE`), every waived diff (marked, so
 * a reviewer can see what was excused without it counting as a failure),
 * every unused waiver as a warning, and a final one-line summary — `CLEAN: N
 * pages` or `DIFF: B vs C pages, N diff(s) (W waived), tolerance Tpt`.
 */
export function formatDiffs(
  result: CompareResult,
  info: { basePageCount: number; candPageCount: number; tolerance: number },
): string[] {
  const lines: string[] = [];

  const byPage = new Map<number | undefined, Diff[]>();
  for (const d of result.diffs) {
    const key = d.page;
    const group = byPage.get(key);
    if (group) group.push(d);
    else byPage.set(key, [d]);
  }
  // Stable order: the document-level page-count diff (no page) first, then
  // ascending page number.
  const pageKeys = [...byPage.keys()].sort((a, b) => (a ?? 0) - (b ?? 0));
  for (const key of pageKeys) {
    const group = byPage.get(key)!;
    for (const d of group.slice(0, MAX_LINES_PER_PAGE)) lines.push(formatOneDiff(d));
    if (group.length > MAX_LINES_PER_PAGE) {
      lines.push(`   ...${group.length - MAX_LINES_PER_PAGE} more`);
    }
  }

  for (const d of result.waived) lines.push(`WAIVED ${formatOneDiff(d)}`);
  for (const w of result.unusedWaivers) {
    const loc = w.kind === "page-count" ? "doc" : `p${w.page ?? "?"}`;
    const match = w.match !== undefined ? ` match=${JSON.stringify(w.match)}` : "";
    lines.push(`WARNING unused waiver: ${loc} ${w.kind}${match} — ${w.reason}`);
  }

  const waivedNote = result.waived.length > 0 ? ` (${result.waived.length} waived)` : "";
  if (result.diffs.length === 0) {
    lines.push(`CLEAN: ${info.candPageCount} pages${waivedNote}`);
  } else {
    lines.push(
      `DIFF: ${info.basePageCount} vs ${info.candPageCount} pages, ${result.diffs.length} diff(s)${waivedNote}, tolerance ${info.tolerance}pt`,
    );
  }

  return lines;
}
