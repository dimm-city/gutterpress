/**
 * In-app CSS editor (#39) — type stubs (Phase 0, design only).
 *
 * These are the interfaces the later phases (see
 * `docs/design/issue-39-plan.md`) implement against. NOTHING here imports
 * CodeMirror or the lib yet — Phase 0 stays dependency-free and compile-clean.
 * Phases 1–3 fill in the implementations.
 *
 * Architecture notes (enforced by CLAUDE.md):
 *  - The CSS editor is a LANGUAGE-MODE layer on the existing #38 editor, not a
 *    new editor or a new platform capability. File load/save already go through
 *    `PlatformAdapter.readFile`/`writeFile` in `+page.svelte`.
 *  - Diagnostics reuse `checkCss` from `@dimm-city/print-md-lib` (pure JS, runs
 *    in the renderer) so the gutter and `print-md validate` never disagree.
 *  - No Git/GitHub surface is touched (CLAUDE.md §7 is N/A to this issue).
 */

import type { PrintSafeWarning } from "@dimm-city/print-md-lib";

/**
 * Which CodeMirror language extension to apply to a document, chosen from the
 * active file's extension. Held in a CM `Compartment` so switching files
 * reconfigures the language without recreating the EditorView.
 */
export type EditorLanguage = "markdown" | "css" | "plain";

/**
 * Pick the editor language from a file path (extension-driven).
 *  - `.css`                 → `"css"`
 *  - `.md` / `.markdown`    → `"markdown"`
 *  - anything else / null   → `"plain"`
 *
 * Phase 1 implements this; Phase 0 declares the contract only.
 */
export declare function languageForPath(path: string | null): EditorLanguage;

/**
 * A single editor gutter diagnostic, decoupled from CodeMirror's `Diagnostic`
 * type so this module carries no CM dependency in Phase 0. Phase 2 maps
 * {@link PrintSafeWarning} → `CssDiagnostic` → CodeMirror `Diagnostic`.
 */
export interface CssDiagnostic {
  /** Document offset (inclusive) where the marker starts. */
  from: number;
  /** Document offset (exclusive) where the marker ends. Defaults to line end. */
  to: number;
  /** Maps 1:1 from `PrintSafeWarning.severity`. */
  severity: "error" | "warning";
  /** Human-readable message shown in the gutter tooltip. */
  message: string;
  /** The print-safety rule id (e.g. `printsafe/no-pagedjs-crash-selectors`). */
  source: string;
}

/**
 * Produces gutter diagnostics for a CSS document. Phase 2 implements this by
 * calling `checkCss(doc)` and converting each {@link PrintSafeWarning}'s
 * 1-based `line`/`column` to document offsets. Active only when the editor
 * language is `"css"`.
 */
export interface CssDiagnosticsSource {
  /** @param doc the full CSS text. @returns one diagnostic per finding. */
  diagnose(doc: string): CssDiagnostic[];
}

/**
 * Convert a lib print-safety warning to an editor diagnostic. Phase 2
 * implements; declared here so the mapping contract is reviewable now. The
 * `lineStartOffset` callback resolves a 1-based line number to its document
 * start offset (CM: `state.doc.line(n).from`); `lineLength` gives the marker a
 * full-line fallback when only a line (no column) is known.
 */
export declare function toCssDiagnostic(
  warning: PrintSafeWarning,
  lineStartOffset: (line: number) => number,
  lineLength: (line: number) => number,
): CssDiagnostic;

/**
 * One CSS Paged Media completion entry. The set is a hand-maintained static
 * table (`pagedMediaCompletions`) — no generated schema, no runtime data read.
 */
export interface PagedMediaCompletion {
  /** Text the user types to match (e.g. `@page`, `@top-center`, `size`). */
  label: string;
  /** Inserted text; may be a snippet template (e.g. `size: ${A4} ${portrait}`). */
  apply: string;
  /** `"atrule"` | `"property"` | `"value"` — drives the completion icon. */
  type: "atrule" | "property" | "value";
  /** Short value hint shown in the completion detail (e.g. `A4 portrait`). */
  detail?: string;
}

/**
 * The curated CSS Paged Media completion table consumed by the Phase 3
 * autocompletion source. Declared (not defined) in Phase 0.
 */
export declare const pagedMediaCompletions: readonly PagedMediaCompletion[];
