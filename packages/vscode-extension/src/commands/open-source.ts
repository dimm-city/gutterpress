/**
 * SFE-P3c Lane B — `gutterpress.openSource` (run spec deliverable 4): opens
 * the active custom-editor document in the default text editor.
 *
 * FINDING "the active custom-editor document" WITHOUT extra state tracking:
 * `vscode.window.activeTextEditor` only ever reflects a plain TEXT editor,
 * never a webview-backed custom editor, so this command instead reads
 * `vscode.window.tabGroups.activeTabGroup.activeTab.input` — when it is a
 * `vscode.TabInputCustom` for THIS extension's `viewType`
 * (`gutterpress.markdownEditor`, matching `../extension.ts`'s registration
 * and `package.json`'s `contributes.customEditors[0].viewType` — not
 * imported from either, both being outside this lane's write boundary this
 * phase; a real, `.d.ts`-documented VS Code type, verified against
 * `node_modules/.bun/@types+vscode@1.134.0/.../index.d.ts`), it carries the
 * document's own `uri` directly. No panel-lifecycle tracking of "which
 * document is active" is needed in `../provider.ts` for this — VS Code
 * already tracks it per tab.
 *
 * OPENED VIA `openTextDocument`+`showTextDocument`, NOT the `"vscode.openWith"`
 * built-in command: both reach the same result (this file's `uri` in VS
 * Code's plain text editor — `gutterpress.markdownEditor`'s own
 * `priority: "option"` means it is never the DEFAULT handler a plain
 * `showTextDocument` would otherwise route through, so no fighting the
 * custom editor's own registration is needed), but `openTextDocument`/
 * `showTextDocument` are real, fully `.d.ts`-typed API members this file
 * can cite directly, unlike a bare command-id string VS Code's own type
 * declarations do not enumerate.
 */
import * as vscode from "vscode";

const GUTTERPRESS_MARKDOWN_EDITOR_VIEW_TYPE = "gutterpress.markdownEditor";

const NO_ACTIVE_EDITOR_MESSAGE =
  "Gutterpress: no Gutterpress editor is currently active. Open a Markdown file with the " +
  "Gutterpress editor, then run this command again.";

/** The active custom-editor tab's document URI, or `undefined` when the
 *  active tab is not a `gutterpress.markdownEditor` tab (including "no tab
 *  is active at all"). Exported for direct unit testing without a command
 *  registration round trip. */
export function findActiveGutterpressEditorUri(): vscode.Uri | undefined {
  const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
  const input = activeTab?.input;
  if (input instanceof vscode.TabInputCustom && input.viewType === GUTTERPRESS_MARKDOWN_EDITOR_VIEW_TYPE) {
    return input.uri;
  }
  return undefined;
}

/** Registers `gutterpress.openSource`. D14: the precondition refusal (no
 *  active Gutterpress editor tab) is a specific, actionable message. */
export function registerOpenSourceCommand(): vscode.Disposable {
  return vscode.commands.registerCommand("gutterpress.openSource", async () => {
    const uri = findActiveGutterpressEditorUri();
    if (!uri) {
      void vscode.window.showErrorMessage(NO_ACTIVE_EDITOR_MESSAGE);
      return;
    }
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, { preview: false });
  });
}
