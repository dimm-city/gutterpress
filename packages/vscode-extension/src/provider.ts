import { randomBytes } from "node:crypto";
import { EDITOR_PROTOCOL_VERSION } from "@dimm-city/gutterpress-editor";
// Type-only: erased at compile time, so this file needs NO runtime "vscode"
// module — only extension.ts (which calls
// `vscode.window.registerCustomEditorProvider`) does, and only its test
// mocks "vscode" (see tests/support/vscode-mock.ts).
import type * as vscode from "vscode";

/**
 * `gutterpress.markdownEditor` `CustomTextEditorProvider` — SFE-P1a skeleton
 * (D9, run spec "Extension skeleton" behavior-table row).
 *
 * THIS RUN'S SCOPE: `resolveCustomTextEditor` renders a MINIMAL, INERT,
 * read-only placeholder webview — a CSP'd HTML document with a nonce,
 * showing the document's exact text (D2: source is the only authoritative
 * document; this view never mutates it — there is no source-edit path here
 * at all yet) plus `EDITOR_PROTOCOL_VERSION` imported from
 * `@dimm-city/gutterpress-editor`. That import is the point of this run: it
 * proves the shared-protocol dependency edge between this extension and the
 * framework-free editor package before any real editing surface exists.
 *
 * Real rich editing — the shared web mount from `packages/editor/src/web`,
 * source-edit commands, undo/redo delegation through `WorkspaceEdit`,
 * Gutterpress projection rendering — lands in later runs (P1b onward) per
 * D9's "Webview owns: editor model/view/controller...". None of that exists
 * yet, and this provider must not pretend otherwise: it is read-only and
 * `enableScripts: false`.
 *
 * Security (D12/D9 "Webview owns:... no filesystem or Node access"): the
 * webview HTML below runs no script, loads no local or remote resource, and
 * sets a restrictive CSP with a per-render nonce. This module itself (the
 * PROVIDER, running in the extension host, not the webview) is the only
 * place Node APIs (`node:crypto`) are used — exactly the D9 split between a
 * host that owns `TextDocument`/`WorkspaceEdit`/file and workspace access,
 * and a webview that owns only editor model/view/controller state and has
 * "no filesystem or Node access".
 */
export function createGutterpressMarkdownEditorProvider(
  _context: vscode.ExtensionContext,
): vscode.CustomTextEditorProvider {
  return {
    resolveCustomTextEditor(
      document: vscode.TextDocument,
      webviewPanel: vscode.WebviewPanel,
      _token: vscode.CancellationToken,
    ): void {
      webviewPanel.webview.options = {
        enableScripts: false,
        localResourceRoots: [],
      };
      webviewPanel.webview.html = renderPlaceholderHtml(document.getText());
      // This run creates no per-resolve state (no timers, no watchers, no
      // subscriptions), so there is nothing to release on disposal yet —
      // no `onDidDispose` registration here. Real per-resolve state (the
      // shared web mount from `packages/editor/src/web`) arrives in a
      // later run (P1b onward); that is where disposal cleanup — and a
      // test that can actually fail if it is missing — belongs.
    },
  };
}

/**
 * Builds the placeholder webview HTML. Exported so the provider unit test
 * can assert its content directly (document text present, CSP meta tag
 * with a nonce present) without needing a full fake `WebviewPanel` for
 * every assertion — see tests/provider.test.ts.
 */
export function renderPlaceholderHtml(documentText: string): string {
  const nonce = createNonce();
  const escapedText = escapeHtml(documentText);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; img-src 'none'; script-src 'none';" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style nonce="${nonce}">
  body { font-family: var(--vscode-editor-font-family, monospace); white-space: pre-wrap; padding: 1rem; }
  .gp-protocol-version { opacity: 0.7; font-size: 0.85em; margin-bottom: 1rem; }
</style>
</head>
<body>
<div class="gp-protocol-version">Gutterpress Markdown Editor — protocol v${EDITOR_PROTOCOL_VERSION} (read-only placeholder, SFE-P1a)</div>
<pre>${escapedText}</pre>
</body>
</html>`;
}

function createNonce(): string {
  return randomBytes(16).toString("base64");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
