/**
 * Problems panel helpers (#28). Pure functions over `ProblemEntry[]` so the
 * grouping/labeling logic is unit-testable outside Svelte.
 */
import type { ProblemEntry } from "$lib/platform/contract";

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
 */
const SOURCE_LABELS: Record<string, string> = {
  "source.links.local-refs": "Broken link",
  "source.stylelint": "Print-safety (CSS)",
  "source.markdownlint": "Markdown style",
  "source.htmlhint": "HTML check",
  "source.accessibility.alt-text": "Image description",
  "source.accessibility.heading-order": "Heading order",
};

export function friendlySource(checkId: string): string {
  return SOURCE_LABELS[checkId] ?? checkId;
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
