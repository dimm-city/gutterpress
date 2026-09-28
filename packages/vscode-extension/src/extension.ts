import * as vscode from "vscode";
import { createGutterpressMarkdownEditorProvider } from "./provider.ts";
import { registerProjectServices } from "./project/register.ts";

/**
 * VS Code extension entry point — SFE-P3c Lane A (extends the SFE-P1a
 * skeleton this file used to describe; that skeleton's placeholder-webview
 * account is now stale and has been removed — see `provider.ts`'s own
 * header for what actually happens on resolve).
 *
 * `activate()` registers two contributions:
 *
 *   1. The `gutterpress.markdownEditor` `CustomTextEditorProvider` (see
 *      `provider.ts`). D9 is explicit that this custom editor is OPTIONAL,
 *      never VS Code's default handler for all Markdown. That is enforced
 *      by the MANIFEST (package.json `contributes.customEditors[0].priority:
 *      "option"`) — `registerCustomEditorProvider` itself takes no "make
 *      this the default" flag; "option" priority is the actual mechanism.
 *      See `tests/manifest.test.ts`, which asserts `priority === "option"`
 *      and the `*.md` selector directly against the parsed JSON — unchanged
 *      by this run, and it must keep passing.
 *   2. `registerProjectServices` (`./project/register.ts`) — D9's three
 *      host-owned commands (`gutterpress.build`/`.preview`/`.openSource`).
 *      Its signature grew an `outputChannel` parameter this phase (its own
 *      stub header explicitly sanctioned this); the ONE call below is
 *      updated to pass the same channel the provider's own D15 session
 *      logging already uses — see that file's own header for the full
 *      account.
 *
 * A shared `vscode.OutputChannel` ("Gutterpress") is created once here and
 * threaded into the provider for D15's host-local session logging (see
 * `provider.ts`'s `createSessionLogger`) — never document text.
 *
 * `@vscode/test-electron` and this package's build step were both P1a-
 * recorded gaps ("the run that adds a real build step" / "real activation
 * inside an actual VS Code instance is deferred"); the SFE-P3c run added
 * the build step (`scripts/build.mjs`). Its own bounded, time-boxed
 * `@vscode/test-electron` attempt could not reach the VS Code download CDN
 * through this environment's outbound proxy allowlist — the exact command
 * and failure are recorded in `docs/plans/source-first-editor/runs/SFE-P3c.md`'s
 * "Deviations and evidence" section. Repair round 1 removed the resulting
 * dead scaffold (`tests/host-fidelity/launch.mjs`/`run-in-host.js`/its
 * fixture, and the `@vscode/test-electron` devDependency and
 * `test:host-fidelity` script) rather than keep an untested, never-invoked
 * launcher whose own package-identifier lookup was independently confirmed
 * wrong (a scoped package name never produces a valid unscoped VS Code
 * extension identifier) — see that same section for the full account.
 * `tests/support/fidelity-vscode.ts`'s FIDELITY MOCK (real
 * `offsetAt`/`positionAt`/`WorkspaceEdit` application/event semantics — see
 * that module's own fidelity checklist) is, and remains, the sanctioned
 * substitute this run's own specification named for exactly this
 * situation. The mocked unit tests still work exactly as P1a set them up
 * (`tests/support/vscode-mock.ts` / `mock.module("vscode", ...)`, mirroring
 * `packages/desktop/tests/support/electron-mock.ts`'s identical pattern for
 * "electron") — neither module is a real runtime outside its actual host
 * process.
 */
export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel("Gutterpress");
  context.subscriptions.push(outputChannel);

  const provider = createGutterpressMarkdownEditorProvider(context, outputChannel);
  const registration = vscode.window.registerCustomEditorProvider(
    "gutterpress.markdownEditor",
    provider,
    {
      webviewOptions: { retainContextWhenHidden: false },
      supportsMultipleEditorsPerDocument: false,
    },
  );
  context.subscriptions.push(registration);

  context.subscriptions.push(registerProjectServices(context, outputChannel));
}

export function deactivate(): void {
  // No-op: every disposable this extension owns is pushed onto
  // `context.subscriptions` in activate(), and VS Code disposes those
  // automatically on deactivation. Per-panel resources (the document
  // gateway, message/trust listeners) are NOT in `context.subscriptions` —
  // they are disposed on `webviewPanel.onDidDispose` instead, at the
  // correct (per-panel, not per-extension) lifetime; see `provider.ts`.
}
