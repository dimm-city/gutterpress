/**
 * Layout-marker check — the author-facing surface for `env.layoutWarnings`.
 *
 * The marker parser (lib/markdown/markers.js) has always computed typed,
 * line-numbered warnings for author mistakes, but the only place they ever
 * went was a `log.warn` line in the build/preview terminal. A non-technical
 * writer using the desktop app never saw them: the Problems panel is fed by
 * `executeValidation({ category: "source", phase: "pre-build" })` and no
 * source check produced marker findings.
 *
 * Running them AS A CHECK is what closes that gap, and it needs no new IPC
 * channel or renderer code (§8): the desktop's `/api/lint/project` route
 * already maps every `CheckResult` to a `ProblemEntry`.
 *
 * Severity is always `warning` — these are "your markup did not mean what you
 * think", never a reason to abort a build (only `error` results set ok=false).
 */
import { readFile } from "node:fs/promises";
import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { finding, inspectionFailed } from "../policy";
import { createMarkdownRenderer } from "../../lib/markdown/renderer";
import { loadPlugins } from "../../lib/markdown/plugins";

interface LayoutWarning {
  line: number;
  type: string;
  message: string;
}

const check: Check = {
  id: "source.markdown.layout-markers",
  name: "Layout Markers",
  description:
    "Reports @page/@section/@chapter marker arguments Gutterpress could not understand",
  category: "source",
  phase: "pre-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    const files = (ctx.markdownFiles ?? []).slice().sort();
    if (files.length === 0) return [];

    const results: CheckResult[] = [];

    // Degrade-and-report, NOT fail-fast: linting is the preview-side contract
    // (see loadPlugins' doc comment). A project whose plugin isn't installed
    // must still get marker diagnostics for the rest of its document — but the
    // missing plugin is itself reported, never swallowed.
    const plugins = await loadPlugins(ctx.config.plugins, ctx.inputDir, (ref, error) => {
      results.push(
        inspectionFailed(
          check.id,
          `Plugin "${ref}" could not be loaded, so markers it defines were not checked: ${error.message}`
        )
      );
    });
    const md = createMarkdownRenderer(plugins);

    for (const file of files) {
      try {
        const content = await readFile(file, "utf8");
        const env: { layoutWarnings?: LayoutWarning[] } = {};
        md.render(content, env);
        for (const w of env.layoutWarnings ?? []) {
          results.push(
            finding(check.id, {
              severity: "warning",
              message: w.message,
              file,
              // `line: 0` is the parser's "no line" sentinel (e.g. the EOF
              // spread close). Emitting it would point the editor at a line
              // that isn't the problem.
              ...(w.line > 0 ? { line: w.line } : {}),
              code: w.type,
            })
          );
        }
      } catch (error) {
        results.push(
          inspectionFailed(
            check.id,
            `Could not check layout markers in ${file}: ${
              error instanceof Error ? error.message : String(error)
            }`,
            { file }
          )
        );
      }
    }

    return results;
  },
};

registerCheck(check);

export default check;
