/**
 * In-app CSS editor (#39) — language mode, diagnostics, and completions.
 *
 * The CSS editor is a LANGUAGE-MODE layer on the existing #38 editor, not a
 * new editor or a new platform capability. File load/save already go through
 * `$lib/files/files-capability`'s `readFile`/`writeFile` (`fs:*` typed IPC)
 * in `+page.svelte`.
 *
 *  - {@link languageForPath} picks the CodeMirror language from a file's
 *    extension. The editor holds the language in a `Compartment` so switching
 *    files reconfigures the language without recreating the EditorView.
 *  - {@link cssDiagnosticsSource} runs the print-safety lint via
 *    `$lib/lint/lint-capability`'s `checkCss` (typed IPC into the Electron
 *    main process), NOT by importing the lib. `checkCss` is postcss-based
 *    and postcss's `node:url` usage crashes the renderer if bundled into
 *    the SPA — so the UI stays clean of platform/node code and the host
 *    runs it. Same check `Gutterpress validate` uses, so the gutter and CLI
 *    never disagree. (Async — CodeMirror's linter accepts a Promise source.)
 *  - {@link pagedMediaCompletions} is a curated, static table — no generated
 *    schema, no runtime data read.
 *  - No Git/GitHub surface is touched (CLAUDE.md §7 is N/A to this issue).
 */

import type { PrintSafeWarning } from "$lib/platform";
import { checkCss as checkCssCapability } from "$lib/lint/lint-capability";
import type { Diagnostic } from "@codemirror/lint";
import type { EditorState } from "@codemirror/state";
import type {
  CompletionContext,
  CompletionResult,
  Completion,
} from "@codemirror/autocomplete";

/**
 * Which CodeMirror language extension to apply to a document, chosen from the
 * active file's extension.
 */
export type EditorLanguage = "markdown" | "css" | "plain";

/**
 * Pick the editor language from a file path (extension-driven).
 *  - `.css`                 → `"css"`
 *  - `.md` / `.markdown`    → `"markdown"`
 *  - anything else / null   → `"plain"`
 */
export function languageForPath(path: string | null): EditorLanguage {
  if (!path) return "plain";
  const lower = path.toLowerCase();
  if (lower.endsWith(".css")) return "css";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  return "plain";
}

/**
 * A single editor gutter diagnostic, decoupled from CodeMirror's `Diagnostic`
 * type. Phase 2 maps {@link PrintSafeWarning} → `CssDiagnostic` → CodeMirror
 * `Diagnostic`.
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
  /** The print-safety rule id (e.g. `printsafe/no-remote-urls`). */
  source: string;
}

/**
 * Convert a lib print-safety warning to an editor diagnostic. The
 * `lineStartOffset` callback resolves a 1-based line number to its document
 * start offset (CM: `state.doc.line(n).from`); `lineLength` gives the marker a
 * full-line fallback when only a line (no column) is known.
 *
 * The warning's `line`/`column` are 1-based (postcss convention). When a usable
 * column is present we mark from that column to end-of-line; otherwise we mark
 * the whole line.
 */
export function toCssDiagnostic(
  warning: PrintSafeWarning,
  lineStartOffset: (line: number) => number,
  lineLength: (line: number) => number,
): CssDiagnostic {
  const line = warning.line >= 1 ? warning.line : 1;
  const start = lineStartOffset(line);
  const len = lineLength(line);
  const col = warning.column >= 1 ? warning.column - 1 : 0;
  const from = start + Math.min(col, len);
  const to = start + len;
  return {
    from,
    to: to > from ? to : from + 1,
    severity: warning.severity,
    message: warning.message,
    source: warning.rule,
  };
}

/**
 * Map an EditorState's CSS document through `checkCss` into CodeMirror
 * diagnostics. Async — delegates to the host via `$lib/lint/lint-capability`
 * (typed IPC).
 */
export async function cssDiagnosticsSource(state: EditorState): Promise<Diagnostic[]> {
  const doc = state.doc;
  const warnings = await checkCssCapability('', doc.toString());
  return warnings.map((w) => {
    const d = toCssDiagnostic(
      w,
      (line) => doc.line(Math.min(line, doc.lines)).from,
      (line) => doc.line(Math.min(line, doc.lines)).length,
    );
    return {
      from: Math.min(d.from, doc.length),
      to: Math.min(d.to, doc.length),
      severity: d.severity,
      message: d.message,
      source: d.source,
    } satisfies Diagnostic;
  });
}

/**
 * One CSS Paged Media completion entry. The set is a hand-maintained static
 * table (`pagedMediaCompletions`) — no generated schema, no runtime data read.
 */
export interface PagedMediaCompletion {
  /** Text the user types to match (e.g. `@page`, `@top-center`, `size`). */
  label: string;
  /** Inserted text; may be a snippet template (e.g. `size: A4 portrait;`). */
  apply: string;
  /** `"atrule"` | `"property"` | `"value"` — drives the completion icon. */
  type: "atrule" | "property" | "value";
  /** Short value hint shown in the completion detail (e.g. `A4 portrait`). */
  detail?: string;
}

/**
 * The curated CSS Paged Media completion table consumed by the Phase 3
 * autocompletion source. Covers the constructs the issue calls out: `@page`
 * + pseudo variants, the sixteen margin boxes, and page properties with value
 * hints (`size`, `margin`, `bleed`, `marks`) plus the supported `prince-*`
 * extensions the project uses.
 */
export const pagedMediaCompletions: readonly PagedMediaCompletion[] = [
  // ── @page rules ──────────────────────────────────────────────────────────
  { label: "@page", apply: "@page {\n\t\n}", type: "atrule", detail: "Page rule" },
  { label: "@page :first", apply: "@page :first {\n\t\n}", type: "atrule", detail: "First page" },
  { label: "@page :left", apply: "@page :left {\n\t\n}", type: "atrule", detail: "Left (verso) pages" },
  { label: "@page :right", apply: "@page :right {\n\t\n}", type: "atrule", detail: "Right (recto) pages" },
  { label: "@page :blank", apply: "@page :blank {\n\t\n}", type: "atrule", detail: "Blank pages" },
  // ── Margin boxes (16) ────────────────────────────────────────────────────
  { label: "@top-left-corner", apply: "@top-left-corner {\n\tcontent: \"\";\n}", type: "atrule", detail: "Margin box" },
  { label: "@top-left", apply: "@top-left {\n\tcontent: \"\";\n}", type: "atrule", detail: "Margin box" },
  { label: "@top-center", apply: "@top-center {\n\tcontent: \"\";\n}", type: "atrule", detail: "Margin box" },
  { label: "@top-right", apply: "@top-right {\n\tcontent: \"\";\n}", type: "atrule", detail: "Margin box" },
  { label: "@top-right-corner", apply: "@top-right-corner {\n\tcontent: \"\";\n}", type: "atrule", detail: "Margin box" },
  { label: "@bottom-left-corner", apply: "@bottom-left-corner {\n\tcontent: \"\";\n}", type: "atrule", detail: "Margin box" },
  { label: "@bottom-left", apply: "@bottom-left {\n\tcontent: \"\";\n}", type: "atrule", detail: "Margin box" },
  { label: "@bottom-center", apply: "@bottom-center {\n\tcontent: \"\";\n}", type: "atrule", detail: "Margin box" },
  { label: "@bottom-right", apply: "@bottom-right {\n\tcontent: counter(page);\n}", type: "atrule", detail: "Margin box (page no.)" },
  { label: "@bottom-right-corner", apply: "@bottom-right-corner {\n\tcontent: \"\";\n}", type: "atrule", detail: "Margin box" },
  { label: "@left-top", apply: "@left-top {\n\tcontent: \"\";\n}", type: "atrule", detail: "Margin box" },
  { label: "@left-middle", apply: "@left-middle {\n\tcontent: \"\";\n}", type: "atrule", detail: "Margin box" },
  { label: "@left-bottom", apply: "@left-bottom {\n\tcontent: \"\";\n}", type: "atrule", detail: "Margin box" },
  { label: "@right-top", apply: "@right-top {\n\tcontent: \"\";\n}", type: "atrule", detail: "Margin box" },
  { label: "@right-middle", apply: "@right-middle {\n\tcontent: \"\";\n}", type: "atrule", detail: "Margin box" },
  { label: "@right-bottom", apply: "@right-bottom {\n\tcontent: \"\";\n}", type: "atrule", detail: "Margin box" },
  // ── Page-context properties with value hints ─────────────────────────────
  { label: "size", apply: "size: A4 portrait;", type: "property", detail: "A4 portrait" },
  { label: "size", apply: "size: A4 landscape;", type: "property", detail: "A4 landscape" },
  { label: "size", apply: "size: letter portrait;", type: "property", detail: "letter portrait" },
  { label: "size", apply: "size: letter landscape;", type: "property", detail: "letter landscape" },
  { label: "size", apply: "size: 6in 9in;", type: "property", detail: "custom (6in 9in)" },
  { label: "margin", apply: "margin: 20mm;", type: "property", detail: "20mm" },
  { label: "marks", apply: "marks: crop cross;", type: "property", detail: "crop cross" },
  { label: "bleed", apply: "bleed: 3mm;", type: "property", detail: "3mm" },
  { label: "page", apply: "page: ;", type: "property", detail: "named page" },
  { label: "string-set", apply: "string-set: title content();", type: "property", detail: "running header" },
  // ── Prince extensions used by the project ────────────────────────────────
  { label: "prince-bookmark-level", apply: "prince-bookmark-level: 1;", type: "property", detail: "PDF outline" },
  { label: "prince-bookmark-state", apply: "prince-bookmark-state: open;", type: "property", detail: "PDF outline" },
] as const;

/**
 * CodeMirror completion source backed by {@link pagedMediaCompletions}.
 * Triggered on `@`-words and on identifier/property words. Returns null when no
 * word is being typed (so it stays out of the way).
 */
export function pagedMediaCompletionSource(
  context: CompletionContext,
): CompletionResult | null {
  // Match @at-rule starts (including the leading @) or bare property words.
  const word = context.matchBefore(/@?[\w-]*/);
  if (!word) return null;
  if (word.from === word.to && !context.explicit) return null;

  const options: Completion[] = pagedMediaCompletions.map((c) => ({
    label: c.label,
    apply: c.apply,
    type: c.type,
    detail: c.detail,
  }));

  return {
    from: word.from,
    options,
    validFor: /^@?[\w-]*$/,
  };
}
