/**
 * Publish preflight helpers (#105). Pure, host-agnostic result-shaping over the
 * raw check results the `publish:preflight` IPC handler
 * (`electron/api/publish.ts`'s `publishPreflight`) resolves — so the
 * "registry result → author-facing row" mapping (label lookup, code demotion,
 * `fixable` derivation, severity roll-up, grouping) is unit-testable outside
 * both Svelte AND Node.
 *
 * PWA-clean (§8 / ADR 0004): imports only the shared `problems.ts` label +
 * message helpers — NO `node:*`, NO lib value import. Labels come from
 * `friendlySource` (the ONE plain-language label table); we never hardcode a
 * second table here.
 */
import { friendlySource, splitProblemMessage } from "./problems";

export type PreflightSeverity = "error" | "warning" | "info";

/**
 * Remediation class for a preflight row. NAVIGATE-only by decision (#105):
 * preflight never mutates document content, so there is no `autofix`.
 *   - `navigate`: the finding points at a file (+ maybe a line) — the row gets a
 *     "Go to" button that reveals it in the editor.
 *   - `none`: a project-level finding with no location — it only explains itself.
 */
type PreflightFixable = "none" | "navigate";

/**
 * The host-resolved check result the route hands the shaper. Path resolution
 * (`node:path`) happens in the route; everything in this module is pure. A
 * present `filePath` (absolute) identifies the finding's location; only source
 * files the text editor supports are navigable.
 */
export interface PreflightRawResult {
  checkId: string;
  category: string;
  severity: PreflightSeverity;
  message: string;
  /** Absolute path to the finding. */
  filePath?: string;
  /** Project-relative display path (falls back to the basename). */
  file?: string;
  line?: number;
  column?: number;
  /** Set only for provider-scoped findings (none in v1 — see the route). */
  provider?: string;
}

interface PreflightLocation {
  filePath?: string;
  file?: string;
  line?: number;
  column?: number;
}

/** One author-facing preflight row (the wizard renders these). */
export interface PreflightRow {
  /** Originating check id (e.g. "source.links.local-refs") — demoted in the UI. */
  id: string;
  /** Check category ("source" | "asset" | …) — drives grouping. */
  category: string;
  severity: PreflightSeverity;
  /** Plain-language label via `friendlySource` (raw id fallback for unknowns). */
  label: string;
  /** The finding message with any trailing "(RULE-CODE)" peeled off. */
  message: string;
  /** The demoted trailing rule code, or null. */
  code: string | null;
  location?: PreflightLocation;
  fixable: PreflightFixable;
  provider?: string;
}

function isEditableSource(path: string): boolean {
  return /\.(?:css|md|markdown|yaml|yml|txt)$/i.test(path);
}

/** Shape one raw registry result into an author-facing row. */
export function toPreflightRow(raw: PreflightRawResult): PreflightRow {
  const { text, code } = splitProblemMessage(raw.message);
  const hasLocation = Boolean(raw.filePath);
  const canNavigate = Boolean(raw.filePath && isEditableSource(raw.filePath));
  const location: PreflightLocation | undefined = hasLocation
    ? { filePath: raw.filePath, file: raw.file, line: raw.line, column: raw.column }
    : undefined;
  return {
    id: raw.checkId,
    category: raw.category,
    severity: raw.severity,
    label: friendlySource(raw.checkId),
    message: text,
    code,
    ...(location ? { location } : {}),
    fixable: canNavigate ? "navigate" : "none",
    ...(raw.provider ? { provider: raw.provider } : {}),
  };
}

export function shapePreflight(raws: PreflightRawResult[]): PreflightRow[] {
  return raws.map(toPreflightRow);
}

// ── Severity roll-up ─────────────────────────────────────────────────────────

const SEVERITY_RANK: Record<PreflightSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

/** The worst (most severe) severity present, or null when there are no rows. */
export function worstSeverity(rows: PreflightRow[]): PreflightSeverity | null {
  let worst: PreflightSeverity | null = null;
  for (const r of rows) {
    if (worst === null || SEVERITY_RANK[r.severity] < SEVERITY_RANK[worst]) {
      worst = r.severity;
    }
  }
  return worst;
}

/** Header colour: red on any error, amber on any warning (no error), else green. */
export type PreflightHeaderLevel = "error" | "warning" | "ok";

export function preflightHeaderLevel(rows: PreflightRow[]): PreflightHeaderLevel {
  const worst = worstSeverity(rows);
  if (worst === "error") return "error";
  if (worst === "warning") return "warning";
  return "ok"; // info-only or empty → clean
}

export interface PreflightCounts {
  errors: number;
  warnings: number;
  infos: number;
}

export function preflightCounts(rows: PreflightRow[]): PreflightCounts {
  let errors = 0;
  let warnings = 0;
  let infos = 0;
  for (const r of rows) {
    if (r.severity === "error") errors++;
    else if (r.severity === "warning") warnings++;
    else infos++;
  }
  return { errors, warnings, infos };
}

// ── Grouping ─────────────────────────────────────────────────────────────────

export interface PreflightGroup {
  category: string;
  rows: PreflightRow[];
}

const CATEGORY_LABELS: Record<string, string> = {
  source: "Content & styles",
  asset: "Images & fonts",
};

/** Plain-language heading for a category group (raw category fallback). */
export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

// Stable display order; unknown categories sort after the known ones.
const CATEGORY_ORDER = ["source", "asset"];

/**
 * Group rows by category for display: groups in a stable order (source, asset,
 * then any others alphabetically), rows within a group sorted worst-severity
 * first, then by label.
 */
export function groupPreflight(rows: PreflightRow[]): PreflightGroup[] {
  const groups = new Map<string, PreflightRow[]>();
  for (const r of rows) {
    let g = groups.get(r.category);
    if (!g) {
      g = [];
      groups.set(r.category, g);
    }
    g.push(r);
  }
  for (const g of groups.values()) {
    g.sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        a.label.localeCompare(b.label),
    );
  }
  return [...groups.entries()]
    .sort(([a], [b]) => {
      const ia = CATEGORY_ORDER.indexOf(a);
      const ib = CATEGORY_ORDER.indexOf(b);
      if (ia !== -1 || ib !== -1) {
        return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
      }
      return a.localeCompare(b);
    })
    .map(([category, groupRows]) => ({ category, rows: groupRows }));
}
