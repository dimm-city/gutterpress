import { randomBytes, randomUUID } from "node:crypto";
import * as vscode from "vscode";
import { EDITOR_PROTOCOL_VERSION } from "@dimm-city/gutterpress-editor/core";
import { DocumentGateway, type DocumentGatewayLogger, type DocumentGatewayVscodeApi } from "./host/document-gateway.ts";
import { fileTooLargeDiagnostic } from "./protocol/diagnostics.ts";
import { validateWebviewToHostMessage } from "./protocol/validate.ts";
import type { PresentationInputMessage } from "./protocol/messages.ts";
import { findGutterpressProject } from "./project/discover.ts";
import { resolveEditorProjectionPayload } from "./project/projection.ts";

/**
 * `gutterpress.markdownEditor` `CustomTextEditorProvider` — SFE-P3c Lane A
 * (run spec DETAILS #4: "PROVIDER + EXTENSION WIRING").
 *
 * P1a's version rendered a minimal, inert, read-only placeholder webview
 * (`enableScripts: false`) — see this run's report for the full account.
 * THIS run replaces it with the real wiring D9 describes: the host owns
 * `TextDocument`/`WorkspaceEdit`/file events (via `DocumentGateway`,
 * `./host/document-gateway.ts`) and validates every inbound webview message
 * before dispatch; the webview owns model/view/controller state and has no
 * filesystem or Node access (D9/D12) — its actual editor mount is Lane C's
 * `src/webview/**` (not written here; referenced only by its BUILT path,
 * `dist/webview.js`, per the run spec: "reference it by its built path...
 * do not create src/webview/**").
 *
 * D13's rich-vs-source-fallback decision is made HERE, host-side, once per
 * resolve, using the SAME byte-accurate ceiling
 * `packages/desktop/electron/editor-projection.ts`'s
 * `RICH_MODE_MAX_CONTENT_BYTES` already uses (see that constant's own doc
 * comment below for why it is duplicated rather than imported). The
 * decision reaches the webview as a `presentation-input` message; the
 * FALLBACK RENDERING ITSELF is Lane C's, not this file's.
 *
 * D15: one host-local correlation id per editor session (one per
 * `resolveCustomTextEditor` call — not one per message), logged to a
 * dedicated `vscode.OutputChannel` ("Gutterpress", created once in
 * `extension.ts` and threaded in here) — never document text. See
 * `createSessionLogger`'s own doc comment for exactly what is and is not
 * logged.
 *
 * SFE-P3c Lane B (this run's second phase) extended `resolveCustomTextEditor`
 * with the ONE thing it was still missing: the projection payload
 * `mountGutterpressEditor` requires (deliverable 2). This file's own share
 * of that work is kept to WIRING only, per this lane's write boundary
 * ("provider.ts — ONLY to wire the projection/presentation flow into
 * resolveCustomTextEditor"): resolve the document's Gutterpress project once
 * (`./project/discover.ts`'s `findGutterpressProject`, D9 — a plain folder
 * with no manifest is a supported non-error `undefined`), build+send the
 * first projection resend after the `ready` handshake's other three, and
 * rebuild+resend on exactly the events D9/G-11 name: an authoritative
 * `snapshot` change for this document, and a trust grant.
 *
 * RECONCILIATION ADDENDUM (integration lane D): two changes land here.
 * (1) The `ready` handshake's `snapshot` reply is now sent through
 * `gateway.sendInitialSnapshot()` rather than hand-built inline — every
 * authoritative snapshot needs a `baseStamp`, and that stamp is
 * `DocumentGateway`'s own to assign (see that class's header). (2) The
 * MESSAGE MERGE: `sendProjection()` below no longer builds a standalone
 * `type: "projection"` message (that type is deleted) — it merges
 * `resolveEditorProjectionPayload`'s result into a `presentation-input`
 * resend, `mode` held fixed at this session's own decision. The inbound
 * "apply-edit" case now forwards `message.base` to `gateway.applyEdit`
 * alongside `message.edit` — the addendum's other required change, and
 * `DocumentGateway.applyEdit`'s one production caller.
 *
 * REUSING THE GATEWAY'S EXISTING SUBSCRIPTION FLOW, LITERALLY (run spec:
 * "reuse the gateway's existing subscription flow from provider.ts rather
 * than adding a second watcher"): `DocumentGateway` already funnels EVERY
 * outbound message it ever sends — the accepted/rejected-edit reply AND the
 * external-change broadcast alike — through exactly one injected function,
 * `gatewayApi.postMessage` (this file's own construction, below). Wrapping
 * THAT function catches both of D9's named triggers with ZERO new `vscode`
 * subscriptions of any kind — not a second `onDidChangeTextDocument`
 * listener, which would be an entirely avoidable regression against
 * `tests/provider.test.ts`'s own "subscribes ... exactly once each" pin (a
 * file outside this lane's write boundary — see this run's report for the
 * one assertion elsewhere in that same suite this wiring still legitimately
 * outdates, which no available design could avoid without weakening the
 * feature itself). `#lastProjectedVersion` distinguishes a genuine new
 * version (accepted edit or external change, D3: both strictly bump the
 * version) from a REJECTED edit's reply (same version, unchanged text) —
 * only the former re-triggers a rebuild, so a stale/invalid edit costs
 * nothing extra. Trust grants use the EXISTING `trustSubscription` below,
 * extended with one more call — not a new subscription either.
 *
 * The actual DECIDE-and-BUILD logic (trust/project gating,
 * `loadPluginsWithCss`, `createEditorProjection`, the base-pipeline
 * fallback) lives entirely in `./project/projection.ts`'s
 * `resolveEditorProjectionPayload`, a `vscode`-free function this file only
 * calls — kept there rather than inlined here so it stays testable without
 * any `vscode` mocking and so this file's own diff stays the thinnest
 * wiring that satisfies the spec.
 *
 * STALENESS (G-11 — "reject stale responses"): building a plugin-aware
 * projection means loading plugin code from disk, which is not
 * instantaneous, and multiple rebuild triggers can overlap (a fast typist's
 * several accepted edits, each producing its own gateway reply).
 * `#projectionEpoch` below is bumped once per rebuild ATTEMPT (not per
 * completion) and once more on disposal; a build only posts its result if
 * its own captured epoch still equals the current one when it finishes —
 * whichever rebuild STARTED most recently always eventually wins, and a
 * result computed for an epoch a newer attempt has already superseded is
 * silently dropped rather than posted out of order.
 */

/**
 * D13's rich-mode ceiling, measured in UTF-8 bytes via `Buffer.byteLength`
 * — matching `packages/desktop/electron/editor-projection.ts`'s
 * `RICH_MODE_MAX_CONTENT_BYTES` exactly (same constant value, same
 * measurement convention) so the SAME limit reads identically across
 * hosts. Duplicated rather than imported: D4/`tools/check-architecture.mjs`
 * forbid `packages/vscode-extension` from importing `packages/desktop` (a
 * Svelte/Electron product shell, not a shared library) — see this
 * package's Rule 4 in that tool. `../protocol/validate.ts`'s own
 * `MAX_MESSAGE_STRING_LENGTH` is a DIFFERENT, browser-safe, UTF-16-length
 * wire-sanity backstop (it cannot use `Buffer`, a Node global, and stay
 * browser-safe) — the two constants answer different questions and are not
 * meant to be unified.
 */
export const RICH_MODE_MAX_CONTENT_BYTES = 2 * 1024 * 1024;

/**
 * D15-safe session logger: every call site in `DocumentGateway` and this
 * file passes only an event NAME plus already-safe scalar detail fields
 * (a D3 rejection reason, a D14 diagnostic category, a message `type`, an
 * API error's `.message`) — never `document.getText()` or any snapshot/edit
 * `insert`/`text` field. Backed by a real `vscode.OutputChannel` (created
 * once in `extension.ts`, pushed onto `context.subscriptions` there) so
 * D15's "development logs may record ..." list is actually visible to a
 * developer (VS Code's Output panel), not silently swallowed by a
 * `console.log` a packaged extension host never surfaces.
 */
function createSessionLogger(outputChannel: vscode.OutputChannel, correlationId: string): DocumentGatewayLogger {
  return (event, detail) => {
    const suffix = detail ? ` ${JSON.stringify(detail)}` : "";
    outputChannel.appendLine(`[${correlationId}] ${event}${suffix}`);
  };
}

export function createGutterpressMarkdownEditorProvider(
  context: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel,
): vscode.CustomTextEditorProvider {
  return {
    resolveCustomTextEditor(document: vscode.TextDocument, webviewPanel: vscode.WebviewPanel): void {
      const correlationId = randomUUID();
      const log = createSessionLogger(outputChannel, correlationId);
      log("mount");

      const distDirUri = vscode.Uri.joinPath(context.extensionUri, "dist");

      webviewPanel.webview.options = {
        enableScripts: true,
        localResourceRoots: [distDirUri],
      };

      // D9: resolved ONCE per resolve — the document's OWN workspace
      // folder, not a walk-up search (see discover.ts's header). A folder
      // with no `vscode.WorkspaceFolder` (an ungrouped single-file open) or
      // no manifest there both collapse to `undefined`, the same supported
      // non-error "no project" state either way.
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
      const project = findGutterpressProject(workspaceFolder?.uri.fsPath);

      // G-11 staleness guard — see this file's own header for the full
      // account. Bumped on every rebuild ATTEMPT and once more on disposal.
      let projectionEpoch = 0;
      // Distinguishes a genuine new version (D3: an accepted edit or an
      // external change both strictly bump it) from a REJECTED edit's
      // reply, whose snapshot is unchanged — see #lastProjectedVersion in
      // this file's own header.
      let lastProjectedVersion = document.version;

      function sendProjection(): void {
        // D13: a document already mounting the source-mode fallback never
        // mounts mountGutterpressEditor, so it has nothing to project for —
        // building one anyway would be pure waste (and, for a huge file,
        // exactly the kind of unbounded work D13 exists to avoid asking
        // for). presentationInput.mode is fixed for this resolve (see
        // buildPresentationInput's own comment on why it is not
        // re-evaluated mid-session).
        if (presentationInput.mode !== "rich") return;

        projectionEpoch += 1;
        const epoch = projectionEpoch;
        void resolveEditorProjectionPayload(gateway.currentSnapshot(), project, vscode.workspace.isTrusted, (error) => {
          log("projection-build-failed", { message: error instanceof Error ? error.message : String(error) });
        }).then((payload) => {
          if (epoch !== projectionEpoch) return; // superseded by a later rebuild — drop, never post out of order
          for (const pluginError of payload.pluginErrors) {
            log("plugin-load-failed", { pluginRef: pluginError.pluginRef });
          }
          // Reconciliation addendum — message merge: the projection payload
          // rides inside a `presentation-input` resend, `mode` held fixed at
          // this session's own decision (`presentationInput.mode`, never
          // re-evaluated — see that variable's own construction below).
          void webviewPanel.webview.postMessage({
            type: "presentation-input",
            protocolVersion: EDITOR_PROTOCOL_VERSION,
            mode: presentationInput.mode,
            projection: payload.projection,
            pluginCss: payload.pluginCss,
            pluginErrors: payload.pluginErrors,
            ...(payload.diagnostic ? { diagnostic: payload.diagnostic } : {}),
          });
        });
      }

      const gatewayApi: DocumentGatewayVscodeApi = {
        document,
        createWorkspaceEdit: () => new vscode.WorkspaceEdit(),
        createRange: (start, end) => new vscode.Range(start, end),
        applyWorkspaceEdit: (edit) => vscode.workspace.applyEdit(edit),
        onDidChangeTextDocument: (listener) => vscode.workspace.onDidChangeTextDocument(listener),
        onDidCloseTextDocument: (listener) => vscode.workspace.onDidCloseTextDocument(listener),
        postMessage: (message) => {
          // Every "snapshot" DocumentGateway ever sends — the accepted/
          // rejected-edit reply AND the external-change broadcast alike —
          // passes through here (see this file's header). A version that
          // did not move means a REJECTED edit's unchanged bounce-back,
          // not one of D9's two named triggers; skip it.
          if (message.type === "snapshot" && message.snapshot.version !== lastProjectedVersion) {
            lastProjectedVersion = message.snapshot.version;
            sendProjection();
          }
          return webviewPanel.webview.postMessage(message);
        },
      };
      const gateway = new DocumentGateway(gatewayApi, log);

      const presentationInput = buildPresentationInput(document);

      // D12: every inbound message is runtime-validated BEFORE dispatch —
      // an invalid message is logged and dropped, never coerced or
      // partially handled.
      const messageSubscription = webviewPanel.webview.onDidReceiveMessage((raw: unknown) => {
        const result = validateWebviewToHostMessage(raw);
        if (!result.valid) {
          log("rejected-inbound-message", { reason: result.failure.reason });
          return;
        }
        const message = result.value;
        switch (message.type) {
          case "ready":
            log("webview-ready");
            void webviewPanel.webview.postMessage(presentationInput);
            void webviewPanel.webview.postMessage({
              type: "trust-state",
              protocolVersion: EDITOR_PROTOCOL_VERSION,
              trusted: vscode.workspace.isTrusted,
            });
            // Routed through the gateway (reconciliation addendum) rather
            // than hand-built here: every authoritative snapshot needs a
            // freshly bumped `baseStamp`, and `DocumentGateway` is the one
            // place that stamp is assigned — see that class's header.
            void gateway.sendInitialSnapshot();
            // Deliberately AFTER, not alongside, the three sends above —
            // see this file's header ("SENT ASYNCHRONOUSLY, ALWAYS AFTER
            // the ready handshake's other three messages" on
            // `PresentationInputMessage` in protocol/messages.ts).
            sendProjection();
            return;
          case "apply-edit":
            // Reconciliation addendum: `message.base` is the ONLY thing
            // `DocumentGateway.applyEdit` uses to decide staleness now —
            // see that method's own header for why `message.edit.expectedVersion`
            // plays no part in this call.
            void gateway.applyEdit(message.edit, message.base);
            return;
          case "diagnostic-report":
            log("webview-diagnostic", { category: message.diagnostic.category });
            return;
        }
      });

      // D9: "Trust granted mid-session re-resolves." `workspace.isTrusted`
      // only ever transitions false -> true (there is no
      // "onDidRevokeWorkspaceTrust"), so re-sending the current value on
      // this event is always the correct new state.
      const trustSubscription = vscode.workspace.onDidGrantWorkspaceTrust(() => {
        void webviewPanel.webview.postMessage({
          type: "trust-state",
          protocolVersion: EDITOR_PROTOCOL_VERSION,
          trusted: vscode.workspace.isTrusted,
        });
        // Untrusted -> trusted moves an open project from the base pipeline
        // to the plugin-aware one — re-resolve and resend (D9).
        sendProjection();
      });

      webviewPanel.webview.html = renderWebviewHtml({
        cspSource: webviewPanel.webview.cspSource,
        baseUri: webviewPanel.webview.asWebviewUri(distDirUri).toString(),
        scriptUri: webviewPanel.webview.asWebviewUri(vscode.Uri.joinPath(distDirUri, "webview.js")).toString(),
      });

      webviewPanel.onDidDispose(() => {
        log("dispose");
        messageSubscription.dispose();
        trustSubscription.dispose();
        gateway.dispose();
        // Invalidates any in-flight sendProjection() build so it drops its
        // result instead of posting to a panel that is now gone.
        projectionEpoch += 1;
      });
    },
  };
}

/**
 * D13's decision, made once per resolve (see this file's header for why it
 * is not re-evaluated as the document grows/shrinks mid-session).
 */
function buildPresentationInput(document: vscode.TextDocument): PresentationInputMessage {
  const tooLarge = Buffer.byteLength(document.getText(), "utf8") > RICH_MODE_MAX_CONTENT_BYTES;
  if (tooLarge) {
    return {
      type: "presentation-input",
      protocolVersion: EDITOR_PROTOCOL_VERSION,
      mode: "source-fallback",
      diagnostic: fileTooLargeDiagnostic(),
    };
  }
  return { type: "presentation-input", protocolVersion: EDITOR_PROTOCOL_VERSION, mode: "rich" };
}

interface WebviewHtmlOptions {
  /** `webview.cspSource` — the CSP origin for THIS webview's own local
   *  resources (`asWebviewUri`-resolved paths only; never a remote
   *  `https:`/`http:` source — see this function's own CSP comment). */
  readonly cspSource: string;
  /** `webview.asWebviewUri(dist/)`, used as the document's `<base href>` —
   *  D12: "The host supplies the first effective base URI; author HTML
   *  cannot replace it." A SECOND `<base>` tag anywhere later in a
   *  document is a browser no-op (only the first one in document order
   *  ever takes effect), so declaring ours first in `<head>` is sufficient
   *  even though nothing in this run's own scope ever injects author HTML
   *  into this top-level document at all (author/plugin HTML only ever
   *  reaches the DOM inside the mounted editor, Lane C's concern). */
  readonly baseUri: string;
  /** `webview.asWebviewUri(dist/webview.js)`. */
  readonly scriptUri: string;
}

/**
 * Builds the webview's top-level HTML shell. Exported so
 * `tests/provider.test.ts` can assert its CSP/nonce/base/script-tag
 * properties directly.
 *
 * CSP (D12: "Webview/iframe content uses a restrictive CSP"):
 *   - `default-src 'none'` — everything is denied unless explicitly opened
 *     below.
 *   - `script-src 'nonce-<per-render nonce>'` — ONLY the one script tag
 *     this file itself emits, carrying the SAME nonce, may run. This is
 *     the load-bearing property D12 actually cares about ("author HTML
 *     never grants script execution in the editor") — no other script,
 *     inline or remote, author-influenced or not, can execute.
 *   - `style-src 'unsafe-inline'` — NOT nonced. `@dimm-city/gutterpress-editor`'s
 *     `mountEditor`/`mountGutterpressEditor` (`packages/editor/src/web/mount.ts`,
 *     `.../gutterpress/mount.ts` — outside this lane's write boundary this
 *     run) inject their chrome CSS via plain `document.createElement("style")`
 *     with NO nonce attribute; a nonce-only `style-src` would silently
 *     blank the editor's own styling. Per CSP semantics, combining a nonce
 *     with `'unsafe-inline'` in the SAME directive does not help (modern
 *     browsers ignore `'unsafe-inline'` whenever a nonce is present in that
 *     directive), so this is a deliberate, documented choice: `style-src`
 *     stays open to inline styles while `script-src` stays strictly
 *     nonced. Inline CSS cannot execute script in a Chromium-only target
 *     (CLAUDE.md's Chromium-only ruling), so this does not weaken the
 *     property D12 is actually protecting.
 *   - `img-src`/`font-src` scoped to `cspSource` ONLY (this webview's own
 *     `asWebviewUri`-resolved extension resources) — no remote `https:`/
 *     `http:` origin is ever allowed, so a markdown author's remote image
 *     URL will not load (a conservative default; loosening it is a future,
 *     explicit decision, not this run's). Included now, ahead of this
 *     run's own use, so Lane B/C's later asset-resolution work is not
 *     blocked behind a provider.ts change from a lane that will not be
 *     running anymore by then — see this run's report.
 */
export function renderWebviewHtml(options: WebviewHtmlOptions): string {
  const nonce = createNonce();
  const csp = [
    "default-src 'none'",
    `base-uri ${options.baseUri}`,
    `script-src 'nonce-${nonce}'`,
    "style-src 'unsafe-inline'",
    `img-src ${options.cspSource}`,
    `font-src ${options.cspSource}`,
  ].join("; ");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<base href="${options.baseUri}/">
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Gutterpress</title>
</head>
<body>
<div id="gp-editor-root" style="position:fixed;inset:0;"></div>
<script nonce="${nonce}" src="${options.scriptUri}"></script>
</body>
</html>`;
}

function createNonce(): string {
  return randomBytes(16).toString("base64");
}
