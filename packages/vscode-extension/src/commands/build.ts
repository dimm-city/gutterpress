/**
 * SFE-P3c Lane B — `gutterpress.build` (run spec deliverable 4).
 *
 * The smallest real thing: the CLI library's own `runBuild`
 * (`gutterpress`'s public export, the exact function `gutterpress build`
 * and `packages/desktop/electron/export/controller.ts`'s export pipeline
 * both call) invoked against the resolved project's directory with NO
 * `outDir` override, so the library uses its own documented "project"
 * delivery convention (`<manifestDir>/dist/<title-slug>/`) — "the project's
 * configured output" the run spec asks for is that convention, not a
 * setting this command invents. Format defaults to `"pdf"`, matching the
 * CLI's own `gutterpress build` default.
 *
 * INJECTABLE `runBuild` (mirrors `packages/desktop/electron/export/controller.ts`'s
 * `ExportControllerDeps`/`packages/desktop/electron/preview/controller.ts`'s
 * `PreviewOpenControllerDeps` pattern already established in this codebase
 * for host-side commands that call into `gutterpress`): production wiring
 * (`../project/register.ts`) passes the REAL library function; tests pass a
 * fake, so a precondition-refusal test never needs a real project on disk
 * and a success-path test never needs real Chromium/Ghostscript.
 */
import * as vscode from "vscode";
import type { BuildRunnerOptions, BuildRunnerResult } from "gutterpress";
import { currentActiveProjectDirParams, resolveProjectForCommand } from "../project/discover.ts";
import { describeNoProjectFailure } from "./precondition-messages.ts";

export type BuildRunnerFn = (options: BuildRunnerOptions) => Promise<BuildRunnerResult>;

export interface BuildCommandDeps {
  readonly runBuild: BuildRunnerFn;
  readonly outputChannel: vscode.OutputChannel;
}

/**
 * Runs one build for `projectDir` and reports it — the part of the command
 * with no `vscode.commands.registerCommand`/progress-UI wrapping, so a test
 * can drive it directly with a fake `runBuild` and a fake output channel
 * without touching `vscode.commands` at all.
 */
export async function runBuildForProject(projectDir: string, deps: BuildCommandDeps): Promise<void> {
  try {
    const result = await deps.runBuild({ inputDir: projectDir, format: "pdf", rawArgs: {} });
    const delivered = result.pdfPath ?? result.htmlPath ?? result.outDir;
    deps.outputChannel.appendLine(`Gutterpress build finished: ${delivered}`);
    for (const diagnostic of result.diagnostics) {
      deps.outputChannel.appendLine(`  [${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}`);
    }
    void vscode.window.showInformationMessage(`Gutterpress build finished: ${delivered}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.outputChannel.appendLine(`Gutterpress build failed: ${message}`);
    void vscode.window.showErrorMessage(`Gutterpress build failed: ${message}`);
  }
}

/**
 * Registers `gutterpress.build`. D14: the precondition refusal (no project
 * resolved for the active editor/workspace) is a specific, actionable
 * message — `deps.runBuild` is never even called in that case.
 */
export function registerBuildCommand(deps: BuildCommandDeps): vscode.Disposable {
  return vscode.commands.registerCommand("gutterpress.build", async () => {
    const resolution = resolveProjectForCommand(currentActiveProjectDirParams());
    if (!resolution.found) {
      void vscode.window.showErrorMessage(describeNoProjectFailure(resolution.reason));
      return;
    }
    const projectDir = resolution.project.projectDir;
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Gutterpress: building…" },
      () => runBuildForProject(projectDir, deps),
    );
  });
}
