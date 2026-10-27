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
 * Severity is `warning` — these are "your markup did not mean what you
 * think", never a reason to abort a build (only `error` results set ok=false).
 * Two kinds keep their own severity: a plugin component's opt-in `validate`
 * (its designer may mark a problem `error` or `info`), and `flush_art`, an
 * `info` because `.gp-flush` is a choice the author made. An author can still
 * downgrade the whole check via `checks:` in the manifest.
 */
import { readFile } from "node:fs/promises";
import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { finding, inspectionFailed } from "../policy";
import { createMarkdownRenderer, type LoadedPlugin } from "../../lib/markdown/renderer";
import { loadPlugins } from "../../lib/markdown/plugins";
import type { LayoutWarning } from "../../lib/markdown/assemble";
import { MARKER_CSS } from "../../lib/markdown/markers.js";
import { GUTTERPRESS_CSS } from "../../lib/markdown/gutterpress-css";
import { collectStyleDependencies } from "../../lib/asset-inline";
import { addCssClasses, classesInTokens, nearestKnownClass } from "../../lib/unknown-classes";


/**
 * Every class named by a selector in the CSS this book would be built with:
 * core's two blocks, each loaded plugin's `css` and `styles`, and the book's
 * own stylesheets, with their local `@import` closure (a minified stylesheet
 * is read here even though the print-safety check skips it). An unreadable
 * file adds nothing: the print-safety check already reports it.
 */
async function collectKnownClasses(ctx: CheckContext, plugins: LoadedPlugin[]): Promise<Set<string>> {
  const names = new Set<string>();
  addCssClasses(MARKER_CSS, names);
  addCssClasses(GUTTERPRESS_CSS, names);
  for (const p of plugins) if (p.css) addCssClasses(p.css, names);

  const roots = [...(ctx.cssFiles ?? []), ...plugins.flatMap((p) => p.styles ?? [])];
  const sheets = (await collectStyleDependencies(ctx.inputDir, roots)).filter((f) => /\.css$/i.test(f));
  for (const sheet of sheets) {
    try {
      addCssClasses(await readFile(sheet, "utf8"), names);
    } catch {
      // see above
    }
  }
  return names;
}

const check: Check = {
  id: "source.markdown.layout-markers",
  name: "Layout Markers",
  description:
    "Reports @page/@section/@chapter marker arguments Gutterpress could not understand, any unknown gp-* class and any other class no stylesheet mentions, a table row with more cells than its table has columns, and a formula that could not be typeset",
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
    const plugins = await loadPlugins(ctx.config.extensions, ctx.inputDir, (ref, error) => {
      results.push(
        inspectionFailed(
          check.id,
          `Plugin "${ref}" could not be loaded, so markers it defines were not checked: ${error.message}`
        )
      );
    });
    const md = createMarkdownRenderer(plugins);

    // Every class any selector in play names, built on first use and once per
    // run: Gutterpress's own CSS, the plugins' CSS, the book's stylesheets.
    let known: Promise<Set<string>> | undefined;
    const knownClasses = (): Promise<Set<string>> =>
      (known ??= collectKnownClasses(ctx, plugins));

    for (const file of files) {
      try {
        const content = await readFile(file, "utf8");
        const env: { layoutWarnings?: LayoutWarning[] } = {};
        // `md.render`, split in two so the tokens are there to read.
        const tokens = md.parse(content, env);
        md.renderer.render(tokens, md.options, env);

        // A class that no selector names styles nothing: usually a typo.
        // One finding per class per file, at its first use.
        const uses = classesInTokens(tokens);
        if (uses.size > 0) {
          const names = await knownClasses();
          // A marker line that already earned a warning is not reported twice:
          // its stray words became class names (`@page My Cover`), and the
          // marker warning says what to do about them.
          const warnedLines = new Set((env.layoutWarnings ?? []).map((w) => w.line));
          for (const [cls, use] of uses) {
            if (names.has(cls) || warnedLines.has(use.line)) continue;
            const guess = nearestKnownClass(cls, names);
            results.push(
              finding(check.id, {
                severity: "warning",
                message:
                  `Class ".${cls}" is not in any stylesheet (Gutterpress's own, the plugins', or this book's), so it styles nothing.` +
                  (guess ? ` Did you mean ".${guess}"?` : "") +
                  (use.count > 1 ? ` Used ${use.count} times in this file; the first is reported.` : ""),
                file,
                ...(use.line > 0 ? { line: use.line } : {}),
                code: "unknown_class",
              })
            );
          }
        }

        for (const w of env.layoutWarnings ?? []) {
          results.push(
            finding(check.id, {
              severity: w.severity ?? "warning",
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
