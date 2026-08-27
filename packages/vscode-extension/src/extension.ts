import * as vscode from "vscode";
import { createGutterpressMarkdownEditorProvider } from "./provider.ts";

/**
 * VS Code extension entry point — SFE-P1a skeleton (D9).
 *
 * `activate()` registers exactly one contribution this run: the
 * `gutterpress.markdownEditor` `CustomTextEditorProvider` (see
 * provider.ts). D9 is explicit that this custom editor is OPTIONAL, never
 * VS Code's default handler for all Markdown. That is enforced by the
 * MANIFEST (package.json `contributes.customEditors[0].priority: "option"`)
 * — `registerCustomEditorProvider` itself takes no "make this the default"
 * flag; "option" priority is the actual mechanism: it makes the editor
 * available in VS Code's "Open With..." / "Reopen Editor With..." picker
 * without taking over `*.md` as the default handler. See
 * tests/manifest.test.ts, which asserts `priority === "option"` and the
 * `*.md` selector directly against the parsed JSON — a manifest regression
 * (e.g. someone flips this to "default") fails a fast, host-free test
 * instead of depending on a human re-reading the JSON.
 *
 * `@vscode/test-electron` is NOT added this run (recorded gap — real
 * activation inside an actual VS Code instance is deferred to the run that
 * builds the extension for real; see docs/plans/source-first-editor/runs/
 * SFE-P1a.md). These unit tests mock the "vscode" module instead (see
 * tests/support/vscode-mock.ts and tests/extension.test.ts) — the same
 * approach this monorepo already uses for "electron" in
 * packages/desktop/tests/support/electron-mock.ts, since neither module is
 * a real runtime outside its actual host process.
 *
 * Buildless this run (package.json "main": "./dist/extension.js" is the
 * conventional target a real VS Code extension host loads via `require()`,
 * but nothing produces that file yet, and nothing loads it — the mocked
 * unit tests import this file directly by its `src/` path, and no
 * `@vscode/test-electron` host reads "main" either). A compile step (tsc
 * emit, no bundler — see tsconfig.json's module/moduleResolution comment)
 * is added in the run that actually activates this extension in a real or
 * `@vscode/test-electron`-hosted VS Code.
 */
export function activate(context: vscode.ExtensionContext): void {
  const provider = createGutterpressMarkdownEditorProvider(context);
  const registration = vscode.window.registerCustomEditorProvider(
    "gutterpress.markdownEditor",
    provider,
    {
      webviewOptions: { retainContextWhenHidden: false },
      supportsMultipleEditorsPerDocument: false,
    },
  );
  context.subscriptions.push(registration);
}

export function deactivate(): void {
  // No-op: every disposable this extension owns is pushed onto
  // `context.subscriptions` in activate(), and VS Code disposes those
  // automatically on deactivation. Nothing else to release yet.
}
