/**
 * SFE-P3c Lane B — `gutterpress.preview` (run spec deliverable 4).
 *
 * The real preview server, not a placeholder notice: `gutterpress`'s public
 * `startPreviewServer` — the SAME `node:http` + `ws` server the standalone
 * CLI (`gutterpress preview`) and the desktop app
 * (`packages/desktop/electron/preview/controller.ts`) already embed in a
 * long-lived host process, `installSignalHandlers: false` for exactly this
 * "library/embedded caller" case (that option's own doc comment). This
 * command starts it for the resolved project, then opens the served URL in
 * the user's default browser (`vscode.env.openExternal`) — VS Code has no
 * live-reloading webview surface of its own for this, and the point of the
 * preview (CLAUDE.md: "HOT-RELOAD EDITING") is exactly what a real browser
 * tab already gives it for free once the server is running.
 *
 * `port: 0` — "OS-assigned" (`resolvePort`'s own documented convention,
 * `packages/cli/src/lib/cli-args.ts`) rather than the CLI's fixed default
 * port: a VS Code preview may run ALONGSIDE a desktop preview or a CLI
 * preview of a DIFFERENT project on the same machine, and OS assignment
 * avoids the port collision a fixed default would risk.
 *
 * ONE SERVER PER EXTENSION SESSION, REUSED ACROSS INVOCATIONS: `PreviewSession`
 * (this module, `vscode`-free) owns the single active handle. A second
 * invocation for the SAME project just re-opens the browser; for a
 * DIFFERENT project it calls the handle's own `restart(newInputPath)`
 * (`PreviewServerHandle`'s real, documented capability) rather than leaking
 * a second server. `registerPreviewCommand`'s returned `Disposable.dispose()`
 * stops any still-running server — `../project/register.ts`'s own
 * `Disposable` composes this in, so `extension.ts`'s existing
 * `context.subscriptions.push(registerProjectServices(context))` needs no
 * change to get this cleanup for free.
 *
 * REPAIR ROUND 1 (finding "gutterpress.preview can serve the wrong project:
 * identity is tracked against a handle field restart() never updates"):
 * `open()` used to compare against `this.#handle.inputPath` — but the real
 * `PreviewServerHandle.inputPath` (`packages/cli/src/server.ts`) is a plain
 * value captured in the handle's OWN object literal at start time, and
 * `restart()` mutates the SERVER's internal state without ever replacing
 * that already-returned object or its `inputPath` property. So after
 * `open(A)` -> `open(B)` (which calls `restart(B)`, leaving
 * `handle.inputPath` still reading `A`) -> `open(A)` again, the THIRD call's
 * `this.#handle.inputPath === projectDir` comparison would wrongly match A
 * and return the cached URL WITHOUT restarting — even though the server is
 * actually still serving project B. `#currentProjectDir` below is this
 * class's OWN tracked value, set on both `start` and `restart`, so it always
 * reflects what THIS session actually last requested, independent of
 * whatever `PreviewServerHandle`'s own field does or does not update.
 */
import * as vscode from "vscode";
import { currentActiveProjectDirParams, resolveProjectForCommand } from "../project/discover.ts";
import { describeNoProjectFailure } from "./precondition-messages.ts";

/** The one slice of `PreviewServerHandle` (`gutterpress`'s public type)
 *  this module actually calls. */
export interface PreviewServerHandleLike {
  readonly url: string;
  readonly inputPath: string;
  readonly stop: () => Promise<void>;
  readonly restart: (newInputPath: string) => Promise<void>;
}

export type PreviewServerStarter = (options: {
  readonly input: string;
  readonly port: number;
  readonly host: string;
  readonly verbose: boolean;
  readonly noWatch: boolean;
  readonly openBrowser: boolean;
  readonly installSignalHandlers?: boolean;
}) => Promise<PreviewServerHandleLike>;

/**
 * Owns the one active preview server handle for this extension session.
 * `vscode`-free — see this module's header — so it is unit-testable with a
 * fake `starter` and no `mock.module("vscode", ...)` at all.
 */
export class PreviewSession {
  #handle: PreviewServerHandleLike | undefined;
  readonly #starter: PreviewServerStarter;
  /** The project directory THIS session last started or restarted the
   *  server for — see this class's own header ("REPAIR ROUND 1") for why
   *  this is tracked here rather than read back off `this.#handle.inputPath`. */
  #currentProjectDir: string | undefined;

  constructor(starter: PreviewServerStarter) {
    this.#starter = starter;
  }

  /** Starts (or reuses/redirects) the preview server for `projectDir` and
   *  returns its URL. */
  async open(projectDir: string): Promise<{ readonly url: string }> {
    if (this.#handle) {
      if (this.#currentProjectDir === projectDir) {
        return { url: this.#handle.url };
      }
      await this.#handle.restart(projectDir);
      this.#currentProjectDir = projectDir;
      return { url: this.#handle.url };
    }
    this.#handle = await this.#starter({
      input: projectDir,
      port: 0,
      host: "127.0.0.1",
      verbose: false,
      noWatch: false,
      openBrowser: false,
      installSignalHandlers: false,
    });
    this.#currentProjectDir = projectDir;
    return { url: this.#handle.url };
  }

  /** Stops the active server, if any. Safe to call more than once. */
  async dispose(): Promise<void> {
    const handle = this.#handle;
    this.#handle = undefined;
    this.#currentProjectDir = undefined;
    if (handle) await handle.stop();
  }
}

export interface PreviewCommandDeps {
  readonly session: PreviewSession;
  readonly outputChannel: vscode.OutputChannel;
  /** `vscode.env.openExternal` in production; injected so tests can assert
   *  on the URL without a real browser launch. */
  readonly openExternal: (url: string) => Thenable<boolean>;
}

/** Registers `gutterpress.preview`. D14: the precondition refusal (no
 *  project resolved) is a specific, actionable message — the server is
 *  never started in that case. */
export function registerPreviewCommand(deps: PreviewCommandDeps): vscode.Disposable {
  return vscode.commands.registerCommand("gutterpress.preview", async () => {
    const resolution = resolveProjectForCommand(currentActiveProjectDirParams());
    if (!resolution.found) {
      void vscode.window.showErrorMessage(describeNoProjectFailure(resolution.reason));
      return;
    }
    const projectDir = resolution.project.projectDir;
    try {
      const { url } = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Gutterpress: starting preview…" },
        () => deps.session.open(projectDir),
      );
      deps.outputChannel.appendLine(`Gutterpress preview running: ${url}`);
      await deps.openExternal(url);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.outputChannel.appendLine(`Gutterpress preview failed to start: ${message}`);
      void vscode.window.showErrorMessage(`Gutterpress preview failed to start: ${message}`);
    }
  });
}
