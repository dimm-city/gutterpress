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
 *   2. `registerProjectServices` (`./project/register.ts`) — a TYPED STUB
 *      this run (Lane A creates it only so this file has a real call site
 *      to typecheck against; Lane B owns its real implementation from the
 *      next phase onward — see that file's own header).
 *
 * A shared `vscode.OutputChannel` ("Gutterpress") is created once here and
 * threaded into the provider for D15's host-local session logging (see
 * `provider.ts`'s `createSessionLogger`) — never document text.
 *
 * `@vscode/test-electron` and this package's build step were both P1a-
 * recorded gaps ("the run that adds a real build step" / "real activation
 * inside an actual VS Code instance is deferred"); THIS run is that run —
 * see `scripts/build.mjs` and this run's report for the build step, and
 * `tests/host-fidelity/` (or this run's report, if the bounded attempt did
 * not succeed) for the `@vscode/test-electron` outcome. The mocked unit
 * tests still work exactly as P1a set them up (`tests/support/vscode-mock.ts`
 * / `mock.module("vscode", ...)`, mirroring `packages/desktop/tests/support/
 * electron-mock.ts`'s identical pattern for "electron") — neither module is
 * a real runtime outside its actual host process.
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

  context.subscriptions.push(registerProjectServices(context));
}

export function deactivate(): void {
  // No-op: every disposable this extension owns is pushed onto
  // `context.subscriptions` in activate(), and VS Code disposes those
  // automatically on deactivation. Per-panel resources (the document
  // gateway, message/trust listeners) are NOT in `context.subscriptions` —
  // they are disposed on `webviewPanel.onDidDispose` instead, at the
  // correct (per-panel, not per-extension) lifetime; see `provider.ts`.
}
