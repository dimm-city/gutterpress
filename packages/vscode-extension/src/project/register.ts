import * as vscode from "vscode";
import { runBuild, startPreviewServer } from "gutterpress";
import { registerBuildCommand } from "../commands/build.ts";
import { PreviewSession, registerPreviewCommand } from "../commands/preview.ts";
import { registerOpenSourceCommand } from "../commands/open-source.ts";

/**
 * SFE-P3c Lane B — replaces Lane A's typed stub (run spec deliverable 4:
 * "Register through src/project/register.ts (replace the stub body)").
 *
 * Registers the three commands D9 names as host-owned: `gutterpress.build`,
 * `gutterpress.preview`, `gutterpress.openSource`. Each command module
 * (`../commands/**`) owns its own precondition check and D14 diagnostic;
 * this function is composition only — wiring the REAL `gutterpress` library
 * functions (`runBuild`, `startPreviewServer`) into each command's
 * INJECTABLE dependency, exactly once, for this extension's whole lifetime.
 *
 * SIGNATURE CHANGE FROM THE STUB: the stub's own header explicitly
 * sanctioned this ("changing the signature is Lane B's call to make ... it
 * would land together with its one caller in extension.ts"). This function
 * now also takes `outputChannel` — the SAME "Gutterpress"
 * `vscode.OutputChannel` `../provider.ts`'s D15 session logging already
 * uses, created once in `extension.ts` — so build/preview command output
 * lands in the one place a Gutterpress author already has open, rather
 * than a second channel splitting the log. `../extension.ts`'s one call
 * site is updated to pass it through; nothing else in that file changes.
 *
 * DISPOSAL: the returned `Disposable` disposes all three command
 * registrations AND stops any preview server `PreviewSession` still has
 * running (`../commands/preview.ts`'s own header: "`../project/register.ts`'s
 * own Disposable composes this in, so `extension.ts`'s existing
 * `context.subscriptions.push(...)` needs no change to get this cleanup for
 * free"). `PreviewSession.dispose()` is async (it awaits the server's own
 * `stop()`); `context.subscriptions`'s own `Disposable.dispose(): void`
 * contract does not await disposal (VS Code's own `.d.ts` types it
 * `void`-returning), so this is fire-and-forget here exactly as
 * `webviewPanel.webview.postMessage` calls already are elsewhere in this
 * package — a slow shutdown does not block extension deactivation, and a
 * failed stop is not a case this run's scope (or `PreviewSession`'s own
 * documented contract) asks for a retry/report path.
 */
export function registerProjectServices(
  _context: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel,
): vscode.Disposable {
  const previewSession = new PreviewSession(startPreviewServer);

  const buildRegistration = registerBuildCommand({ runBuild, outputChannel });
  const previewRegistration = registerPreviewCommand({
    session: previewSession,
    outputChannel,
    openExternal: (url) => vscode.env.openExternal(vscode.Uri.parse(url)),
  });
  const openSourceRegistration = registerOpenSourceCommand();

  return {
    dispose(): void {
      buildRegistration.dispose();
      previewRegistration.dispose();
      openSourceRegistration.dispose();
      void previewSession.dispose();
    },
  };
}
