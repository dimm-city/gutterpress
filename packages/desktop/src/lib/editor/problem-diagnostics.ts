/**
 * problem-diagnostics — the Problems panel's entries for the open file, as
 * CodeMirror lint diagnostics (#383), so every reported line is marked in the
 * editor: a gutter marker and a severity-tinted line, the message and the
 * check's label on hover.
 *
 * Findings carry a line and sometimes a start column, never an end, so each
 * diagnostic spans its whole line. Entries for other files, file-level entries
 * (no line) and lines past the end of the buffer are dropped. The lint state
 * maps the ranges through later edits, so a mark follows its line until the
 * next Problems refresh replaces the set.
 *
 * PWA-clean and Svelte-free (CLAUDE.md §8).
 */
import type { Diagnostic } from "@codemirror/lint";
import type { Text } from "@codemirror/state";
import type { ProblemEntry } from "#lib/platform/dtos.ts";
import { friendlySource } from "#lib/problems.ts";

/**
 * Checks the CSS editor's live linter already runs (the same `checkCss`): a CSS
 * file takes those from the buffer, not from the last save, and shows each once.
 */
export const LIVE_CSS_SOURCES: readonly string[] = ["source.stylelint"];

export function problemDiagnostics(
  doc: Text,
  problems: readonly ProblemEntry[],
  filePath: string | null,
  skipSources: readonly string[] = [],
): Diagnostic[] {
  if (!filePath) return [];
  const diagnostics: Diagnostic[] = [];
  for (const p of problems) {
    if (p.filePath !== filePath || !p.line || p.line > doc.lines) continue;
    if (skipSources.includes(p.source)) continue;
    const line = doc.line(p.line);
    diagnostics.push({
      from: line.from,
      to: line.to,
      severity: p.severity,
      message: p.message,
      source: friendlySource(p.source),
    });
  }
  return diagnostics;
}
