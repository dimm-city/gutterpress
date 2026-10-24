/**
 * Problems panel helpers (#28). Pure functions over `ProblemEntry[]` so the
 * grouping/labeling logic is unit-testable outside Svelte.
 */
import type { ProblemEntry } from "$lib/platform/dtos";
import type { ExportFindingDto } from "$lib/platform/shared-types";

/** One file's worth of problems, ready to render as a panel group. */
export interface ProblemGroup {
  /** Project-relative display path ("Project" when the finding has no file). */
  file: string;
  /** Absolute path (undefined for project-level findings). */
  filePath?: string;
  entries: ProblemEntry[];
}

/**
 * Plain-language labels for check ids — the audience is non-technical authors,
 * so "source.links.local-refs" reads as "Broken link". Unknown ids fall back
 * to the raw id so new checks are never hidden.
 *
 * Coverage against the CLI's registered `source`-category checks is asserted
 * in `tests/platform/problems.test.ts` — keyed to the live check
 * registry (`getChecks({ category: "source" })`), not a hand-copied list, so
 * a new check can't silently ship without a label here.
 */
const SOURCE_LABELS: Record<string, string> = {
  "source.links.local-refs": "Broken link",
  "source.links.dangling": "Unopenable link",
  "source.stylelint": "Print-safety (CSS)",
  "source.css-ownership": "CSS ownership",
  "source.markdownlint": "Markdown style",
  "source.htmlhint": "HTML check",
  "source.accessibility.alt-text": "Image description",
  "source.accessibility.heading-order": "Heading order",
  "source.markdown.layout-markers": "Layout marker",
  "source.sync.merge-markers": "Two versions",
  "source.characters": "Unusual character",
  "desktop.preview": "Preview",
  // Asset-category checks (#105 publish preflight). Kept in the SAME table as
  // the source checks so `friendlySource` stays the ONE plain-language label
  // authority — preflight must not maintain a second, drifting label map.
  "asset.image.file-size": "Image file size",
  "asset.image.alpha-channel": "Image transparency",
  "asset.font.approved-files": "Font files",
  "asset.font.license": "Font license",
  // Print-quality findings from the render itself (native engine). These are
  // things only pagination can know — nothing in the source files is wrong,
  // so they cannot come from a source lint. Kept in the same table so
  // `friendlySource` stays the ONE label authority.
  "engine.width.overflow": "Too wide for the page",
  "engine.width.intrinsic": "Image has no width set",
  "engine.xref.broken": "Broken link",
  "engine.abspos.leak": "Placed off its page",
  "engine.layer.trapped": "Layer trapped on a page",
  "engine.multicol.dead-column": "Empty column",
  "engine.content.overheight": "Taller than the page",
  "engine.image.low-dpi": "Image resolution",
  "engine.pin.margin-box": "Running head on a pinned edge",
  "engine.page-background.unreferenced": "Page background image not printed",
  "engine.hyphenation.unsupported": "Hyphenation not available",
  // The post-build PDF checks, run on the exported file (#399) — the lib's
  // `pdf` and `heuristic` categories, covered by the same registry-keyed test.
  "pdf.structure.qpdf": "PDF structure",
  "pdf.print.page-size": "Page size",
  "pdf.print.safe-margins": "Safe margins",
  "pdf.print.pdfx-markers": "PDF/X markers",
  "pdf.print.pdfx-metadata": "PDF/X metadata",
  "pdf.print.color-spaces": "Color spaces",
  "pdf.print.embedded-fonts": "Embedded fonts",
  "pdf.print.ink-coverage": "Ink coverage",
  "pdf.print.black-text": "Black text",
  "pdf.print.signature": "Page count",
  "pdf.print.image-resolution": "Image resolution",
  "pdf.print.transparency": "Transparency",
  "pdf.print.bleed": "Bleed",
  "pdf.nav.bookmarks": "Bookmarks",
  "pdf.nav.toc-links": "Contents links",
  "pdf.nav.cross-refs": "Cross-references",
  "pdf.nav.page-labels": "Page labels",
  "heuristic.decoration.layer-count": "Decorative layers",
  "heuristic.layout.placement-variance": "Image placement",
  "heuristic.chunking.section-density": "Section length",
  "heuristic.whitespace.text-density": "Text density",
  // The checks themselves could not run (electron/export/controller.ts).
  "desktop.export.checks": "PDF checks",
};

export function friendlySource(checkId: string): string {
  return SOURCE_LABELS[checkId] ?? checkId;
}

/**
 * Print-quality findings come back from an EXPORT, not from the source lint
 * that fills the panel — so a lint refresh (any file save) would wipe them.
 * They are held separately and merged for display, and they carry no file or
 * line: pagination findings name a rendered element, not a source location,
 * and inventing a line number would send the author to the wrong place.
 */
export function buildProblems(
  diagnostics: Array<{ code: string; severity: "warning" | "info"; message: string }>,
): ProblemEntry[] {
  return diagnostics.map((d) => ({
    severity: d.severity,
    message: d.message,
    source: d.code,
  }));
}

/**
 * The post-build PDF checks' findings (#399), held with `buildProblems`'s
 * entries for the same reason: they come from an export, not the source lint.
 * No file or line either — a finding is about the finished PDF, and its
 * message already names the page where it has one ("Page 3: …"). The check's
 * rule (`detail`) follows the message so the author reads what the limit is,
 * and a finding produced for one publish target carries that target's tag the
 * way the CLI prints it (`[dtrpg] …`).
 */
export function exportProblems(findings: ExportFindingDto[]): ProblemEntry[] {
  return findings.map((f) => ({
    severity: f.severity,
    message: `${f.target ? `[${f.target}] ` : ""}${f.message}${f.detail ? ` ${f.detail}` : ""}`,
    source: f.source,
  }));
}

/**
 * `source.markdownlint` (writer-first copy) emits `"<description> (<code>)"` —
 * the human-readable description leads, the rule code is a demotable trailing
 * suffix, not the headline. Splits that suffix out so the Problems panel can
 * render it as secondary text. Messages with no such trailing "(...)" pass
 * through unchanged with `code: null` (this covers one established convention,
 * not a general check-message parser — checks that lead with the code inline,
 * e.g. "rule: message", are unaffected).
 */
export function splitProblemMessage(message: string): { text: string; code: string | null } {
  const m = /^(.*\S)\s+\(([A-Za-z0-9][\w./-]*)\)$/.exec(message);
  if (!m) return { text: message, code: null };
  return { text: m[1]!, code: m[2]! };
}

/**
 * In compact mode (viewport < 820px) the Problems panel's
 * expanded body is presented as a full-viewport overlay that visually covers
 * the toggle strip which would otherwise collapse it, so ProblemsPanel.svelte
 * drives closing from two other explicit actions instead — picking a result,
 * or pressing Escape. The decision logic lives here (not inline in the
 * component) purely so it is unit-testable rather than only verifiable by
 * markup inspection.
 */


/** Escape closes an OPEN panel only from inside the list — otherwise it must
 *  not interfere with unrelated Escape handling elsewhere in the app. */
export function closesPanelOnEscape(open: boolean, key: string, focusInside: boolean): boolean {
  return open && key === "Escape" && focusInside;
}

/** Errors + warnings (the badge count). Infos are listed but not badged. */
export function problemCounts(problems: ProblemEntry[]): {
  errors: number;
  warnings: number;
  infos: number;
  badge: number;
} {
  let errors = 0;
  let warnings = 0;
  let infos = 0;
  for (const p of problems) {
    if (p.severity === "error") errors++;
    else if (p.severity === "warning") warnings++;
    else infos++;
  }
  return { errors, warnings, infos, badge: errors + warnings };
}

/** The badge counts in words — "1 error, 3 warnings" — for screen readers and
 *  the toggle's accessible name. Empty when there is neither. */
export function problemsSummary(counts: { errors: number; warnings: number }): string {
  const parts: string[] = [];
  if (counts.errors > 0) parts.push(`${counts.errors} ${counts.errors === 1 ? "error" : "errors"}`);
  if (counts.warnings > 0) parts.push(`${counts.warnings} ${counts.warnings === 1 ? "warning" : "warnings"}`);
  return parts.join(", ");
}

/**
 * Whether the status bar offers to expand the list (#307). An empty list has
 * nothing to show, so a clean project reads "No problems" in the bar instead
 * of opening an empty panel. A failed check still has a message to show, and a
 * list that is already open stays closable — e.g. the writer just fixed the
 * last problem.
 */
export function canExpandProblems(
  problems: ProblemEntry[],
  error: string | null,
  open: boolean,
): boolean {
  return problems.length > 0 || !!error || open;
}

/**
 * Group problems by file for display: groups sorted by file name (project-
 * level findings last), entries within a group sorted by line then severity.
 */
export function groupProblems(problems: ProblemEntry[]): ProblemGroup[] {
  const groups = new Map<string, ProblemGroup>();
  for (const p of problems) {
    const key = p.file ?? "";
    let g = groups.get(key);
    if (!g) {
      g = { file: p.file ?? "Book", filePath: p.filePath, entries: [] };
      groups.set(key, g);
    }
    g.entries.push(p);
  }
  const severityRank = { error: 0, warning: 1, info: 2 } as const;
  for (const g of groups.values()) {
    g.entries.sort(
      (a, b) =>
        (a.line ?? 0) - (b.line ?? 0) ||
        severityRank[a.severity] - severityRank[b.severity],
    );
  }
  return [...groups.entries()]
    .sort(([a], [b]) => {
      if (a === "") return 1; // project-level findings last
      if (b === "") return -1;
      return a.localeCompare(b);
    })
    .map(([, g]) => g);
}
