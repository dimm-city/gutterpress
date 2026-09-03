/**
 * Problems panel helpers (#28). Pure functions over `ProblemEntry[]` so the
 * grouping/labeling logic is unit-testable outside Svelte.
 */
import type { ProblemEntry } from "$lib/platform/dtos";

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
 * in `tests/platform/problems.test.ts` (M32) — keyed to the live check
 * registry (`getChecks({ category: "source" })`), not a hand-copied list, so
 * a new check can't silently ship without a label here.
 */
const SOURCE_LABELS: Record<string, string> = {
  "source.links.local-refs": "Broken link",
  "source.stylelint": "Print-safety (CSS)",
  "source.css-ownership": "CSS ownership",
  "source.markdownlint": "Markdown style",
  "source.htmlhint": "HTML check",
  "source.accessibility.alt-text": "Image description",
  "source.accessibility.heading-order": "Heading order",
  "source.markdown.layout-markers": "Layout marker",
  "source.sync.merge-markers": "Two versions",
  "desktop.preview": "Preview",
  // Asset-category checks (#105 publish preflight). Kept in the SAME table as
  // the source checks so `friendlySource` stays the ONE plain-language label
  // authority — preflight must not maintain a second, drifting label map.
  "asset.image.file-size": "Image file size",
  "asset.image.resolution": "Image resolution",
  "asset.image.color-space": "Image colour space",
  "asset.image.alpha-channel": "Image transparency",
  "asset.image.tac-raster": "Image ink coverage",
  "asset.font.approved-files": "Font files",
  "asset.font.license": "Font licence",
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
  "engine.flush.margin-box": "Running head on a flushed edge",
  "engine.page-background.unreferenced": "Page background image not printed",
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
 * M32: `source.markdownlint` (the one check already fixed for writer-first
 * copy) emits `"<description> (<code>)"` — the human-readable description
 * leads, the rule code is a demotable trailing suffix, not the headline.
 * Splits that suffix out so the Problems panel can render it as secondary
 * text. Messages with no such trailing "(...)" pass through unchanged with
 * `code: null` (this covers one established convention, not a general
 * check-message parser — checks that lead with the code inline, e.g.
 * "rule: message", are unaffected and render as before).
 */
export function splitProblemMessage(message: string): { text: string; code: string | null } {
  const m = /^(.*\S)\s+\(([A-Za-z0-9][\w./-]*)\)$/.exec(message);
  if (!m) return { text: message, code: null };
  return { text: m[1]!, code: m[2]! };
}

/**
 * L9 regression fix: in compact mode (viewport < 820px) the Problems panel's
 * expanded body is presented as a full-viewport overlay that visually covers
 * the toggle strip which would otherwise collapse it, so ProblemsPanel.svelte
 * drives closing from two other explicit actions instead — picking a result,
 * or pressing Escape. The decision logic lives here (not inline in the
 * component) purely so it is unit-testable rather than only verifiable by
 * markup inspection.
 */

/** Selecting a problem in compact mode should also close the overlay so the
 *  writer lands on the now-unobscured editor. Non-compact mode's panel never
 *  covers the editor, so selection there leaves the panel state untouched. */
export function closesPanelOnSelect(compact: boolean): boolean {
  return compact;
}

/** Escape closes the panel only when it's the compact overlay AND actually
 *  open — otherwise it must not interfere with unrelated Escape handling
 *  elsewhere in the app. */
export function closesPanelOnEscape(compact: boolean, open: boolean, key: string): boolean {
  return compact && open && key === "Escape";
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
      g = { file: p.file ?? "Project", filePath: p.filePath, entries: [] };
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
