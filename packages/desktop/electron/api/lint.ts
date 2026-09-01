/**
 * Lint IPC handlers for the "lint" capability (SFE-P5c4). Ports
 * `src/routes/api/lint/{check-css,project}/+server.ts` verbatim — same
 * `requireProjectDir` project-scoping guard on `lint:project` (a
 * renderer-supplied `projectDir` unlocks real filesystem work — the same
 * containment `vcs`/`project-config` already require), same relative-path
 * mapping for the Problems panel.
 *
 * `lint:checkCss` stays the CSS editor's lint-gutter source
 * (`css-editor.ts`'s `cssDiagnosticsSource`) — CodeMirror's linter contract
 * expects one async function; only the transport under it changes (postcss
 * stays host-side, CLAUDE.md §8 render purity).
 */
import path from "node:path";
import { loadLib } from "./lib-loader";
import { requireProjectDir } from "./validation";
import type { PrintSafeWarning, ProblemEntry } from "../../src/lib/platform/dtos";
import type { SecureHandle } from "../server-bridge/secure-handle";

/** Run CSS print-safety lint on the given CSS content. */
export async function lintCheckCss(rawCssPath: unknown, rawContent: unknown): Promise<PrintSafeWarning[]> {
  if (typeof rawContent !== "string") throw new Error("'content' string is required");
  const cssPath = typeof rawCssPath === "string" ? rawCssPath : undefined;
  const lib = await loadLib();
  return lib.checkCss(rawContent, cssPath);
}

/** Run project-wide pre-build source lint checks for the Problems panel. */
export async function lintProject(rawProjectDir: unknown): Promise<ProblemEntry[]> {
  const projectDir = await requireProjectDir(rawProjectDir, "lint:project");
  const lib = await loadLib();
  const execution = await lib.executeValidation({
    input: projectDir,
    category: "source",
    phase: "pre-build",
  });
  const dirPrefix = projectDir.replace(/[\\/]+$/, "") + path.sep;
  return execution.report.results.map((r) => {
    const abs = r.file ? path.resolve(r.file) : undefined;
    const rel =
      abs && abs.startsWith(dirPrefix)
        ? abs.slice(dirPrefix.length).split(path.sep).join("/")
        : abs
          ? path.basename(abs)
          : undefined;
    return {
      filePath: abs,
      file: rel,
      line: r.line,
      column: r.column,
      severity: r.severity,
      message: r.message,
      source: r.checkId,
    };
  });
}

/** Register the lint:* IPC channels (SFE-P6b). */
export function registerLintHandlers(secureHandle: SecureHandle): void {
  secureHandle("lint:checkCss", (_e, cssPath: unknown, content: unknown) =>
    lintCheckCss(cssPath, content),
  );
  secureHandle("lint:project", (_e, projectDir: unknown) => lintProject(projectDir));
}
