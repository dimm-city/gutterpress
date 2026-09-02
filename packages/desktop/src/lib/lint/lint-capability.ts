/**
 * Lint capability (SFE-P5c4) — replaces `api.lint.*`.
 *
 * `checkCss` is the CSS editor's lint-gutter source
 * (`editor/css-editor.ts`'s `cssDiagnosticsSource`) — CodeMirror's linter
 * contract expects one async function; this keeps that exact seam shape,
 * only the transport under it changes (typed IPC, not fetch). `lintProject`
 * is `+page.svelte`'s Problems-panel source, run on project open/change.
 *
 * Error semantics (run rule 2, repair round 1): scrubs the Electron IPC
 * transport prefix (`friendlyHostError`) off a rejection before re-throwing
 * — the same discipline every other capability module uses.
 */
import { bridge } from "$lib/platform/bridge";
import { hostCall } from "$lib/errors";
import type { PrintSafeWarning, ProblemEntry } from "$lib/platform/dtos";

/** Run CSS print-safety lint on the given CSS content. */
export async function checkCss(cssPath: string, content: string): Promise<PrintSafeWarning[]> {
  return hostCall(bridge().lint.checkCss(cssPath, content));
}

/** Run project-wide pre-build source lint checks for the Problems panel. */
export async function lintProject(projectDir: string): Promise<ProblemEntry[]> {
  return hostCall(bridge().lint.project(projectDir));
}
