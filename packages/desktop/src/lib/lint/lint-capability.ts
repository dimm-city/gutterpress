/**
 * Lint capability (SFE-P5c4) — replaces `api.lint.*`.
 *
 * `checkCss` is the CSS editor's lint-gutter source
 * (`editor/css-editor.ts`'s `cssDiagnosticsSource`) — CodeMirror's linter
 * contract expects one async function; this keeps that exact seam shape,
 * only the transport under it changes (typed IPC, not fetch). `lintProject`
 * is `+page.svelte`'s Problems-panel source, run on project open/change.
 */
import { bridge } from "$lib/platform/bridge";
import type { PrintSafeWarning, ProblemEntry } from "$lib/platform/dtos";

/** Run CSS print-safety lint on the given CSS content. */
export function checkCss(cssPath: string, content: string): Promise<PrintSafeWarning[]> {
  return bridge().lint.checkCss(cssPath, content);
}

/** Run project-wide pre-build source lint checks for the Problems panel. */
export function lintProject(projectDir: string): Promise<ProblemEntry[]> {
  return bridge().lint.project(projectDir);
}
