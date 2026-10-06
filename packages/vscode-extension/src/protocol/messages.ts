import type { Diagnostic, DocumentSnapshot, SourceEdit } from "@dimm-city/gutterpress-editor/core";
import type { GutterpressProjection } from "gutterpress/render";

/**
 * SFE-P3c Lane A — the host<->webview wire protocol shapes (D3/D9/D12).
 *
 * BROWSER-SAFE BY CONSTRUCTION: this file imports only type-only members
 * from `@dimm-city/gutterpress-editor/core` and `gutterpress/render`
 * (erased at compile time — the latter is the SAME type-only import
 * pattern `packages/editor/src/gutterpress/mount.ts` etc. already use for
 * `GutterpressProjection` in browser-target code; see {@link PresentationInputMessage}'s
 * own doc comment) and declares plain data interfaces — no `vscode`, no
 * `node:*`, no VALUE import of any kind, so no runtime dependency of any
 * kind ships in a bundle that imports this file. `tools/check-architecture.mjs`'s
 * webview-purity rule (this run's deliverable 6) enforces this mechanically
 * for everything under `src/protocol/**`, so this file's own purity is
 * self-checking, not merely a comment's promise.
 *
 * MINIMALITY (run spec DETAILS #1: "Keep the message set MINIMAL — only
 * messages something in this run actually sends"): every message below has
 * a real sender and a real consumer inside THIS run's own deliverables
 * (`src/host/document-gateway.ts`, `src/webview-host/proxy-document-host.ts`,
 * `src/provider.ts`, `src/project/projection.ts`) — see each message's own
 * doc comment for exactly who sends and who reads it. No message
 * anticipates a capability a later lane or run might want; Lane C adds its
 * own message kinds in its own run if it turns out to need one (P3e's
 * ruling: prefer the smallest design that fully satisfies the
 * specification).
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
 *
 * RECONCILIATION ADDENDUM (binding, added after phases 1-2 reported):
 * `SnapshotMessage.baseStamp` and `ApplyEditMessage.base` are the fix for
 * the confirmed defect the original model under-specified — see each
 * field's own doc comment below and `../webview-host/proxy-document-host.ts`'s
 * class header for the full account. Short version: the wire needed a
 * THIRD number both sides agree on, distinct from the mirror's own local
 * version AND from vscode's real `TextDocument.version` — this stamp is
 * that number, owned solely by `DocumentGateway`.
 *
 * MESSAGE MERGE (same addendum): `presentation-input` and the formerly
 * separate `projection` message type are now ONE message.
 * `PresentationInputMessage` carries `mode` (decided once, per D13) and
 * OPTIONALLY `projection`/`pluginCss`/`pluginErrors` (built asynchronously,
 * host-side, and (re)sent every time the addendum's own triggers fire — an
 * accepted edit, an external change, or a trust grant). A `mode` decision
 * with no projection (the D13 oversized -> source-fallback case) stays
 * valid by omission — see that interface's own doc comment.
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
 *
 * `base` (reconciliation addendum): the `SnapshotMessage.baseStamp` of the
 * state `ProxyDocumentHost`'s mirror last converged to — NOT `edit.expectedVersion`
 * (that field stays the mirror's own LOCAL D3 check, in the mirror's own
 * version space, and is never compared against anything host-side; see
 * `../webview-host/proxy-document-host.ts`'s class header). `DocumentGateway.applyEdit`
 * accepts the edit only when `base` equals its OWN current stamp; otherwise
 * it replies authoritatively without ever touching the real document — the
 * new, correct "is my view of the document still current" check that
 * replaces the original model's broken cross-space `expectedVersion`
 * comparison (the committed regression this addendum fixes).
 */
export interface ApplyEditMessage {
  readonly type: "apply-edit";
  readonly protocolVersion: number;
  readonly edit: SourceEdit;
  readonly base: number;
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
 * only by whether the text changed), the initial ready-handshake reply
 * (`DocumentGateway.sendInitialSnapshot`), and every
 * `workspace.onDidChangeTextDocument` firing for this document regardless
 * of source (undo/redo, the plain text editor, another extension) —
 * binding point 5: "External changes are authoritative messages too ...
 * goes through the same channel and the same convergence rule."
 *
 * `ProxyDocumentHost` converges by REPLACEMENT (binding point 4): if
 * `snapshot.text` differs from what it currently expects, it calls
 * `replaceExternal` (one version bump); if it matches — the common case,
 * since MOST of these messages are simply confirming an edit the mirror
 * already applied optimistically — it does nothing. `snapshot.version` is
 * the HOST's own version (VS Code's real `TextDocument.version`, which
 * "will strictly increase after each change" per its own `.d.ts`); it is
 * carried for informational/persistence purposes only and is NEVER read by
 * `ProxyDocumentHost` for any accept/reject or ordering decision (binding
 * point 2: "the host's `TextDocument.version` is never exposed to the
 * editor and the two are never conflated") — `baseStamp` below is the field
 * that decision actually uses.
 *
 * `baseStamp` (reconciliation addendum — the fix for the committed
 * regression the original model left underspecified): a monotonic integer
 * `DocumentGateway` alone owns and increments exactly once per authoritative
 * snapshot it sends, regardless of whether the text changed. Neither
 * vscode's real `TextDocument.version` (host-external, not gateway-owned)
 * nor the proxy's own local mirror version (webview-local) — a THIRD number
 * that exists solely so both sides of the wire agree on one thing: "which
 * authoritative state is this." `ProxyDocumentHost` uses it for BOTH jobs
 * the old, broken design conflated into `snapshot.version`: dropping
 * stale/out-of-order deliveries (a message whose `baseStamp` is not greater
 * than the highest one already seen is ignored before even comparing text),
 * and as the value it sends back as the NEXT edit's `ApplyEditMessage.base`.
 */
export interface SnapshotMessage {
  readonly type: "snapshot";
  readonly protocolVersion: number;
  readonly snapshot: DocumentSnapshot;
  readonly baseStamp: number;
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
 * One plugin that failed to load, degrade-and-report style (D14
 * `EDITOR_PLUGIN_LOAD_FAILED`). Mirrors
 * `packages/desktop/electron/editor-projection.ts`'s
 * `EditorProjectionPluginError` shape field-for-field — NOT imported from
 * there: D4 forbids `packages/vscode-extension` importing `packages/desktop`
 * (a Svelte/Electron product shell, not a shared library; enforced by
 * `tools/check-architecture.mjs`). The real LOADING logic this describes the
 * output of is genuinely shared (`gutterpress/plugins`'s `loadPluginsWithCss`
 * — see `../project/projection.ts`); only this two-field wire shape is
 * duplicated, which is a plain data contract, not behavior.
 */
export interface ProjectionPluginError {
  /** The manifest entry's own ref — a local path (e.g. `./plugins/foo.js`)
   *  or an npm package name, whichever the manifest used. */
  readonly pluginRef: string;
  /** A user-facing message naming why this one plugin was skipped. */
  readonly message: string;
}

/**
 * D13's rich-vs-fallback mount decision, made host-side
 * (`src/provider.ts`, using the SAME 2 MiB ceiling
 * `packages/desktop/electron/editor-projection.ts`'s
 * `RICH_MODE_MAX_CONTENT_BYTES` already uses) and sent as part of the
 * initial `ready` handshake reply. `mode: "source-fallback"` carries the
 * `EDITOR_FILE_TOO_LARGE` diagnostic explaining why; the actual fallback
 * RENDERING is Lane C's (run spec DETAILS #4: "the fallback rendering
 * itself is Lane C's").
 *
 * `mode` itself is decided ONCE, at resolve time, and never changes for the
 * life of a session — not re-evaluated as the document grows or shrinks
 * mid-edit (P3e: no machinery for a scenario this run's specification does
 * not ask for). A `mode: "source-fallback"` document never mounts rich, so
 * it never needs — and never carries — a projection; that is what "a mode
 * decision with no projection stays valid by omission" means below.
 *
 * RECONCILIATION ADDENDUM — MESSAGE MERGE: `projection`/`pluginCss`/
 * `pluginErrors` are OPTIONAL, and this SAME message type is what carries
 * them — the formerly separate `type: "projection"` message is deleted.
 * Unlike `mode`, this trio is NOT decided once: for a `mode: "rich"`
 * session, `../provider.ts`'s `sendProjection()` sends this message AGAIN,
 * with `mode` unchanged and a freshly (re)built projection, every time the
 * addendum's own triggers fire — an authoritative change to the document
 * (an accepted edit or an external change) or a trust grant (D9: "Trust
 * granted mid-session re-resolves"). The FIRST `presentation-input` a
 * session ever receives (the synchronous part of the `ready` handshake
 * reply) never carries these three fields, since building a plugin-aware
 * projection means loading plugin code from disk, which is not
 * instantaneous — see `../webview/index.ts`'s `handlePresentationInput` for
 * how the webview treats "no projection yet" versus "a projection arrived."
 * `pluginErrors` names per-plugin degrade-and-report failures that still
 * produced a projection; `diagnostic`, on a message carrying a projection,
 * is set only when the WHOLE build failed outright (`EDITOR_PLUGIN_LOAD_FAILED`)
 * and is DISTINCT from the D13 file-too-large diagnostic a `source-fallback`
 * message's `diagnostic` field carries — the two never coexist on one
 * message, since a `source-fallback` mode never reaches `sendProjection()`
 * at all. Either way, once a session's `mode` is `"rich"` and a projection
 * has ever been sent, it is ALWAYS populated with a SAFE fallback (the base
 * pipeline) on every resend — this message can never leave the webview with
 * nothing to mount (D14: unsupported behavior falls back, it never blanks
 * the document).
 */
export interface PresentationInputMessage {
  readonly type: "presentation-input";
  readonly protocolVersion: number;
  readonly mode: "rich" | "source-fallback";
  readonly diagnostic?: Diagnostic;
  readonly projection?: GutterpressProjection;
  /** Concatenated plugin CSS (load order), for the mount's `extraCss` —
   *  `""` when no loaded plugin declares any, including the untrusted/
   *  no-project base-pipeline case. Present exactly when `projection` is. */
  readonly pluginCss?: string;
  /** Every plugin that failed to load this build. Empty when every
   *  configured plugin loaded, when trust/project gating skipped plugin
   *  loading entirely, or when the whole build failed outright (in which
   *  case `diagnostic` carries the reason instead). Present exactly when
   *  `projection` is. */
  readonly pluginErrors?: readonly ProjectionPluginError[];
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
