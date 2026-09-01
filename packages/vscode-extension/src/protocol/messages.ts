import type { Diagnostic, DocumentSnapshot, SourceEdit } from "@dimm-city/gutterpress-editor/core";

/**
 * SFE-P3c Lane A — the host<->webview wire protocol shapes (D3/D9/D12).
 *
 * BROWSER-SAFE BY CONSTRUCTION: this file imports only type-only members
 * from `@dimm-city/gutterpress-editor/core` (erased at compile time) and
 * declares plain data interfaces — no `vscode`, no `node:*`, no runtime
 * dependency of any kind. `tools/check-architecture.mjs`'s webview-purity
 * rule (this run's deliverable 6) enforces this mechanically for everything
 * under `src/protocol/**`, so this file's own purity is self-checking, not
 * merely a comment's promise.
 *
 * MINIMALITY (run spec DETAILS #1: "Keep the message set MINIMAL — only
 * messages something in this run actually sends"): every message below has
 * a real sender and a real consumer inside THIS run's own deliverables
 * (`src/host/document-gateway.ts`, `src/webview-host/proxy-document-host.ts`,
 * `src/provider.ts`) — see each message's own doc comment for exactly who
 * sends and who reads it. No message anticipates a capability a later lane
 * or run might want; Lane B/C add their own message kinds in their own
 * runs if they turn out to need one (P3e's ruling: prefer the smallest
 * design that fully satisfies the specification).
 *
 * VERSIONING (D1/D3): every message carries `protocolVersion`, checked by
 * `../protocol/validate.ts` against `EDITOR_PROTOCOL_VERSION` on BOTH sides
 * before any payload field is trusted. A version bump is a decision-record
 * amendment (D1), never a silent shape change.
 *
 * DIRECTIONS mirror the run spec's "Authority and reconciliation model":
 * the extension host is the sole authority (point 1); the webview runs a
 * mirror that posts intent and receives authoritative truth back over the
 * SAME "snapshot" channel for both edit replies and external changes
 * (points 3 and 5).
 */

// ── Webview -> Host ─────────────────────────────────────────────────────

/**
 * Sent exactly once per webview lifetime, as soon as the webview's script
 * has attached its message listener and constructed its
 * `ProxyDocumentHost` (`../webview-host/proxy-document-host.ts`'s
 * constructor sends this immediately). The host's `src/provider.ts` replies
 * with the initial `presentation-input` + `trust-state` + `snapshot`
 * handshake — see `provider.ts`'s own header for the exact reply sequence.
 */
export interface ReadyMessage {
  readonly type: "ready";
  readonly protocolVersion: number;
}

/**
 * A `SourceEdit` the webview wants applied. Sent by `ProxyDocumentHost` the
 * moment its own (synchronous, D3-checked) optimistic mirror update
 * succeeds — never for an edit the mirror itself already rejected. Consumed
 * by `../host/document-gateway.ts`'s `DocumentGateway`, which is the ONLY
 * thing that ever calls `document.positionAt`/`workspace.applyEdit` for
 * this document.
 *
 * No correlation/request id: the run spec's binding reconciliation model
 * (point 4) deliberately suppresses the host's echo of an accepted edit
 * "without any origin bookkeeping" — the proxy recognizes its own edit by
 * comparing the AUTHORITATIVE REPLY'S TEXT against its current mirror text,
 * not by matching a request id. See `SnapshotMessage`'s doc comment.
 */
export interface ApplyEditMessage {
  readonly type: "apply-edit";
  readonly protocolVersion: number;
  readonly edit: SourceEdit;
}

/**
 * Informational: the webview observed a `Diagnostic` (a rejected local
 * edit, a dropped malformed inbound message, a projection fallback reason,
 * ...) and reports it to the host purely for D15 development-log purposes.
 * D15: "Development logs may record ... accepted/rejected edit reason;
 * projection fallback reason ..." and "Do not log document text by
 * default" — `Diagnostic` (see `@dimm-city/gutterpress-editor/core`) is
 * already designed to never carry document text, so this message type
 * cannot leak it either. The host never changes behavior in response to
 * this message; it only logs (`src/provider.ts`'s inbound-message switch).
 */
export interface DiagnosticReportMessage {
  readonly type: "diagnostic-report";
  readonly protocolVersion: number;
  readonly diagnostic: Diagnostic;
}

export type WebviewToHostMessage = ReadyMessage | ApplyEditMessage | DiagnosticReportMessage;

/** Every `WebviewToHostMessage["type"]` literal, for exhaustive validation. */
export const WEBVIEW_TO_HOST_MESSAGE_TYPES = ["ready", "apply-edit", "diagnostic-report"] as const;

// ── Host -> Webview ──────────────────────────────────────────────────────

/**
 * The host's authoritative `DocumentSnapshot`, sent over ONE shared channel
 * for every case the run spec's reconciliation model names as "an
 * authoritative message": the reply to an accepted OR rejected `apply-edit`
 * (`DocumentGateway.applyEdit` — reason "rejected applyEdit, closed
 * document, concurrent change" all reply with this SAME shape, distinguished
 * only by whether the text changed), and every `workspace.onDidChangeTextDocument`
 * firing for this document regardless of source (undo/redo, the plain text
 * editor, another extension) — binding point 5: "External changes are
 * authoritative messages too ... goes through the same channel and the
 * same convergence rule."
 *
 * `ProxyDocumentHost` converges by REPLACEMENT (binding point 4): if
 * `snapshot.text` differs from its current mirror text, it calls
 * `replaceExternal` (one version bump); if it matches — the common case,
 * since MOST of these messages are simply confirming an edit the mirror
 * already applied optimistically — it does nothing. `snapshot.version` is
 * the HOST's own version (VS Code's real `TextDocument.version`, which
 * "will strictly increase after each change" per its own `.d.ts`); the
 * proxy uses it ONLY to drop stale/out-of-order deliveries (a message whose
 * version is not newer than the highest one already seen is ignored before
 * even comparing text) — it is NEVER assigned to the proxy's own local
 * mirror version (binding point 2: "the host's `TextDocument.version` is
 * never exposed to the editor and the two are never conflated").
 */
export interface SnapshotMessage {
  readonly type: "snapshot";
  readonly protocolVersion: number;
  readonly snapshot: DocumentSnapshot;
}

/**
 * Workspace-trust state (D9's untrusted-workspace behavior; D12). Carries
 * ONLY the raw VS Code primitive `vscode.workspace.isTrusted` — not a
 * project- or plugin-specific trust decision (that is Lane B's
 * `src/project/**` territory, layered on top in a later phase of this same
 * run). Sent once as part of the initial `ready` handshake and again
 * whenever `vscode.workspace.onDidGrantWorkspaceTrust` fires ("Trust
 * granted mid-session re-resolves" — D9).
 */
export interface TrustStateMessage {
  readonly type: "trust-state";
  readonly protocolVersion: number;
  readonly trusted: boolean;
}

/**
 * D13's rich-vs-fallback mount decision, made host-side
 * (`src/provider.ts`, using the SAME 2 MiB ceiling
 * `packages/desktop/electron/editor-projection.ts`'s
 * `RICH_MODE_MAX_CONTENT_BYTES` already uses) and communicated once, as
 * part of the initial `ready` handshake reply. `mode: "source-fallback"`
 * carries the `EDITOR_FILE_TOO_LARGE` diagnostic explaining why; the actual
 * fallback RENDERING is Lane C's (run spec DETAILS #4: "the fallback
 * rendering itself is Lane C's").
 *
 * The decision is made once, at resolve time, not re-evaluated as the
 * document grows or shrinks during the session — see `provider.ts`'s
 * header for why (P3e: no machinery for a scenario — live remount on
 * crossing the ceiling mid-edit — this run's specification does not ask
 * for).
 */
export interface PresentationInputMessage {
  readonly type: "presentation-input";
  readonly protocolVersion: number;
  readonly mode: "rich" | "source-fallback";
  readonly diagnostic?: Diagnostic;
}

/**
 * D14: "`EDITOR_HOST_DISCONNECTED` gets its first real producer in this
 * run." Sent when `DocumentGateway` observes `workspace.onDidCloseTextDocument`
 * for this document while the panel is still alive (see
 * `document-gateway.ts`'s header for why a disposed PANEL does not send
 * this — there is no live receiver to send it to). `ProxyDocumentHost`
 * also self-diagnoses the same category when no `snapshot` reply arrives
 * within its reply timeout ("a reply that never arrives" — run spec
 * behavior table, "Host disconnection" row) — that path never needs this
 * wire message at all, since the proxy detects it locally.
 *
 * Always carries a `Diagnostic` (never optional) — D14: "Generic 'failed'
 * errors at a boundary are a confirmed review finding."
 */
export interface DisconnectMessage {
  readonly type: "disconnect";
  readonly protocolVersion: number;
  readonly diagnostic: Diagnostic;
}

export type HostToWebviewMessage =
  | SnapshotMessage
  | TrustStateMessage
  | PresentationInputMessage
  | DisconnectMessage;

/** Every `HostToWebviewMessage["type"]` literal, for exhaustive validation. */
export const HOST_TO_WEBVIEW_MESSAGE_TYPES = [
  "snapshot",
  "trust-state",
  "presentation-input",
  "disconnect",
] as const;
