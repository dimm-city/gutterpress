import {
  applyEdit as applyEditPure,
  EDITOR_PROTOCOL_VERSION,
  externalReplacementDiagnostic,
  type ApplyEditResult,
  type Diagnostic,
  type DocumentSnapshot,
  type EditorDocumentHost,
  type SourceEdit,
} from "@dimm-city/gutterpress-editor/core";
import { diagnosticForProtocolRejection, hostDisconnectedDiagnostic } from "../protocol/diagnostics.ts";
import { validateHostToWebviewMessage, type ProtocolValidationFailure } from "../protocol/validate.ts";
import type { HostToWebviewMessage, PresentationInputMessage, WebviewToHostMessage } from "../protocol/messages.ts";

/**
 * SFE-P3c Lane A — `ProxyDocumentHost` (run spec DETAILS #3): the
 * WEBVIEW-side half of the host<->webview authority split, implementing
 * `EditorDocumentHost` from `@dimm-city/gutterpress-editor/core` per the
 * run spec's "Authority and reconciliation model" (binding, six numbered
 * points — every design choice below cites the point it implements).
 *
 * BROWSER-SAFE (no `vscode`, no node builtin — enforced mechanically by
 * `tools/check-architecture.mjs`'s webview-purity rule over this whole
 * directory). The real webview entry (Lane C, `src/webview/**`) supplies a
 * `WebviewHostTransport` backed by `acquireVsCodeApi()` +
 * `window.addEventListener("message", ...)`; this module never references
 * either directly, so it is equally usable from a pure `bun test` unit
 * suite with a fake transport (see `tests/support/simulated-extension-host.ts`)
 * as it will be from real Chromium.
 */

/** The webview-side transport this class sends/receives over. Point 2's
 *  "local mirror" needs nothing more than post + subscribe — no request/
 *  reply correlation (see `#handleIncoming`'s doc comment for why). Inbound
 *  payloads are typed `unknown`: D12 — "every message payload is untrusted
 *  and runtime validated" applies to BOTH directions, so this class never
 *  trusts the transport's own typing and always re-validates via
 *  `validateHostToWebviewMessage`. */
export interface WebviewHostTransport {
  /** `acquireVsCodeApi().postMessage(message)` in the real webview entry. */
  postMessage(message: WebviewToHostMessage): void;
  /** `window.addEventListener("message", (e) => listener(e.data))` in the
   *  real webview entry. Returns an unsubscribe function. */
  onMessage(listener: (message: unknown) => void): () => void;
}

export interface ProxyDocumentHostOptions {
  /** Fired for every locally-relevant `Diagnostic`: a rejected inbound
   *  message, an external-replacement notice, or an `EDITOR_HOST_DISCONNECTED`
   *  transition. Threaded straight through by Lane C's `mountGutterpressEditor`
   *  call the same way every other host's `onDiagnostic` option already is. */
  readonly onDiagnostic?: (diagnostic: Diagnostic) => void;
  /** Fired on every `trust-state` message (D9: "Trust granted mid-session
   *  re-resolves"). Outside `EditorDocumentHost`'s own contract (that
   *  interface has no trust member — see `packages/editor/src/core/hosts.ts`)
   *  so this is a separate, optional channel Lane C's webview entry may
   *  wire into its own project/plugin-trust presentation. */
  readonly onTrustChange?: (trusted: boolean) => void;
  /** Fired once on the initial `presentation-input` reply (D13's rich-vs-
   *  fallback decision) — see `PresentationInputMessage`'s own doc comment
   *  in `../protocol/messages.ts` for why this is a one-time, mount-time
   *  decision, not a live subscription. */
  readonly onPresentationInput?: (input: Pick<PresentationInputMessage, "mode" | "diagnostic">) => void;
  /** Starts the mirror in readonly mode (matches
   *  `DocumentHostFactoryOptions.readonly` in
   *  `@dimm-city/gutterpress-editor/core`'s shared contract suite — see
   *  `contract-tests.ts`'s own header). Today's real caller (Lane C) has no
   *  production path that needs this at construction time (D9: standard
   *  rich editing stays available even in an untrusted workspace — only
   *  PLUGIN regions are restricted, a projection-level concern, not a
   *  whole-document readonly flag); it exists so `ProxyDocumentHost` can
   *  satisfy the shared `DocumentHostFactory` shape every host in this
   *  system is proven against. */
  readonly initialReadonly?: boolean;
  /** How long to wait for ANY `snapshot` reply after sending an edit before
   *  self-diagnosing `EDITOR_HOST_DISCONNECTED` (run spec behavior table,
   *  "Host disconnection" row: "... or a reply that never arrives").
   *  Defaults to a real-world-reasonable 15s; tests inject a small value. */
  readonly replyTimeoutMs?: number;
}

const DEFAULT_REPLY_TIMEOUT_MS = 15_000;

/**
 * Implements `EditorDocumentHost` against a LOCAL MIRROR, per the run
 * spec's binding reconciliation model:
 *
 *   Point 2 — `applyEdit` performs the D3 checks (readonly -> stale ->
 *   invalid-range) against the mirror via the SAME pure `applyEdit` every
 *   other host uses, applies optimistically, bumps the mirror version
 *   exactly once, notifies subscribers, and posts the edit to the host. The
 *   mirror's version counter is LOCAL and monotonic; the host's real
 *   `TextDocument.version` is read ONLY to detect stale/out-of-order wire
 *   deliveries (`#lastSeenHostVersion` below) and is NEVER assigned to the
 *   mirror's own version.
 *
 *   Point 3/5 — every authoritative reply (an edit's accept/reject, or an
 *   unprompted external change) arrives over the SAME "snapshot" message
 *   kind.
 *
 *   Point 4 — convergence by REPLACEMENT: an incoming snapshot whose text
 *   differs from the mirror calls `replaceExternal` (one version bump);
 *   when it matches — the common case, confirming an edit already applied
 *   optimistically — nothing happens. This is what suppresses the host's
 *   echo of our own accepted edit "without any origin bookkeeping": no
 *   request/reply correlation id exists anywhere in this class.
 */
export class ProxyDocumentHost implements EditorDocumentHost {
  #mirror: DocumentSnapshot;
  #readonly: boolean;
  #disconnected = false;
  readonly #listeners = new Set<(snapshot: DocumentSnapshot) => void>();
  readonly #transport: WebviewHostTransport;
  readonly #unsubscribeTransport: () => void;
  readonly #onDiagnostic?: (diagnostic: Diagnostic) => void;
  readonly #onTrustChange?: (trusted: boolean) => void;
  readonly #onPresentationInput?: (input: Pick<PresentationInputMessage, "mode" | "diagnostic">) => void;
  readonly #replyTimeoutMs: number;
  /** The highest `snapshot.version` (the HOST's real version — see the
   *  class doc comment's point 2) accepted so far. Starts below any real
   *  version so the FIRST reply is always accepted regardless of its
   *  numeric value (a fresh document's starting version is host-defined,
   *  not necessarily 0). Used ONLY to drop stale/out-of-order deliveries —
   *  never surfaced as, or conflated with, the mirror's own version. */
  #lastSeenHostVersion = Number.NEGATIVE_INFINITY;
  #pendingReplyTimer: ReturnType<typeof setTimeout> | undefined;
  /** True once ANY local edit has been optimistically accepted (point 2).
   *  Combined with `#receivedInitialSnapshot` below to resolve a real race
   *  the protocol otherwise leaves unhandled: `ready` is always the FIRST
   *  message this proxy ever sends (the constructor sends it before a
   *  caller could possibly reach `applyEdit`), so — because a message
   *  channel preserves send order between one sender and one receiver —
   *  the FIRST `snapshot` message this proxy ever RECEIVES is always the
   *  reply to THAT `ready`, reporting the document's state from BEFORE
   *  this session existed. If a local edit was applied (synchronously,
   *  optimistically) before that confirmation arrives, its content is
   *  already stale relative to what the mirror has moved to locally, and
   *  must not be allowed to revert it — see `#handleSnapshot`. */
  #hasAppliedLocalEdit = false;
  /** False only until the very first `snapshot` message is processed — see
   *  `#hasAppliedLocalEdit`'s doc comment above. */
  #receivedInitialSnapshot = false;

  constructor(initial: DocumentSnapshot, transport: WebviewHostTransport, options: ProxyDocumentHostOptions = {}) {
    this.#mirror = initial;
    this.#readonly = options.initialReadonly ?? false;
    this.#transport = transport;
    this.#onDiagnostic = options.onDiagnostic;
    this.#onTrustChange = options.onTrustChange;
    this.#onPresentationInput = options.onPresentationInput;
    this.#replyTimeoutMs = options.replyTimeoutMs ?? DEFAULT_REPLY_TIMEOUT_MS;
    this.#unsubscribeTransport = transport.onMessage((raw) => this.#handleIncoming(raw));
    this.#transport.postMessage({ type: "ready", protocolVersion: EDITOR_PROTOCOL_VERSION });
  }

  getSnapshot(): DocumentSnapshot {
    return this.#mirror;
  }

  applyEdit(edit: SourceEdit): ApplyEditResult {
    // Point 6's own escape hatch aside, disconnection folds into the SAME
    // `readonly` flag `applyEditPure` already understands — D3's reason
    // union has no fourth "disconnected" value to add (and this class does
    // not own that contract), and "readonly" is exactly what a
    // disconnected mirror behaviorally IS from here on (run spec behavior
    // table: "d) a local edit after disconnect is refused, not silently
    // accepted").
    const result = applyEditPure(this.#mirror, edit, { readonly: this.#readonly || this.#disconnected });
    if (result.ok) {
      this.#mirror = result.snapshot;
      this.#hasAppliedLocalEdit = true;
      this.#notify();
      this.#transport.postMessage({ type: "apply-edit", protocolVersion: EDITOR_PROTOCOL_VERSION, edit });
      this.#armReplyTimeoutIfNeeded();
    }
    return result;
  }

  replaceExternal(text: string): void {
    this.#mirror = { text, version: this.#mirror.version + 1 };
    this.#notify();
  }

  subscribe(listener: (snapshot: DocumentSnapshot) => void): () => void {
    this.#listeners.add(listener);
    let unsubscribed = false;
    return () => {
      if (unsubscribed) return;
      unsubscribed = true;
      this.#listeners.delete(listener);
    };
  }

  /** Tears down the reply timer and the transport subscription. Does not
   *  post anything — a disposed proxy has nothing left to say, and Lane
   *  C's webview entry is the one tearing down the message channel itself
   *  around this call. */
  dispose(): void {
    this.#clearReplyTimeout();
    this.#unsubscribeTransport();
  }

  #notify(): void {
    for (const listener of this.#listeners) listener(this.#mirror);
  }

  /**
   * Arms the reply-timeout timer ONLY if none is already pending — so
   * continuing to type (submitting more local edits) never resets an
   * already-running clock. This is deliberate: the timer represents "how
   * long since I last had proof the channel is alive," and resetting it on
   * every new local edit would let a genuinely dead channel hide behind
   * continuous typing forever. `#handleIncoming`'s `"snapshot"` case is the
   * only thing that clears it (ANY snapshot message proves liveness,
   * whether or not it changes the mirror's text).
   */
  #armReplyTimeoutIfNeeded(): void {
    if (this.#pendingReplyTimer !== undefined) return;
    this.#pendingReplyTimer = setTimeout(() => {
      this.#pendingReplyTimer = undefined;
      this.#handleDisconnect(hostDisconnectedDiagnostic("reply-timeout"));
    }, this.#replyTimeoutMs);
  }

  #clearReplyTimeout(): void {
    if (this.#pendingReplyTimer === undefined) return;
    clearTimeout(this.#pendingReplyTimer);
    this.#pendingReplyTimer = undefined;
  }

  #handleIncoming(raw: unknown): void {
    const result = validateHostToWebviewMessage(raw);
    if (!result.valid) {
      this.#reportRejectedInbound(result.failure);
      return;
    }
    this.#dispatch(result.value);
  }

  #reportRejectedInbound(failure: ProtocolValidationFailure): void {
    const diagnostic = diagnosticForProtocolRejection(failure);
    this.#onDiagnostic?.(diagnostic);
    // D15-safe: `diagnostic` never carries document text (see
    // `../protocol/diagnostics.ts`'s header). Reported back to the host
    // purely for its own dev-log visibility — the host never changes
    // behavior in response (see `DiagnosticReportMessage`'s doc comment).
    this.#transport.postMessage({ type: "diagnostic-report", protocolVersion: EDITOR_PROTOCOL_VERSION, diagnostic });
  }

  #dispatch(message: HostToWebviewMessage): void {
    switch (message.type) {
      case "snapshot":
        this.#handleSnapshot(message.snapshot);
        return;
      case "trust-state":
        this.#onTrustChange?.(message.trusted);
        return;
      case "presentation-input":
        this.#onPresentationInput?.({ mode: message.mode, diagnostic: message.diagnostic });
        if (message.diagnostic) this.#onDiagnostic?.(message.diagnostic);
        return;
      case "disconnect":
        this.#handleDisconnect(message.diagnostic);
        return;
    }
  }

  /** Point 4's convergence rule. ANY snapshot message — whatever its
   *  content — proves the channel is alive, so the reply timer always
   *  clears here first, before the staleness/content checks below decide
   *  whether anything else happens. */
  #handleSnapshot(snapshot: DocumentSnapshot): void {
    this.#clearReplyTimeout();
    const isFirstSnapshot = !this.#receivedInitialSnapshot;
    this.#receivedInitialSnapshot = true;

    // Point 2: stale/out-of-order delivery guard, keyed on the HOST's own
    // version (never adopted as the mirror's version — see the class doc
    // comment). Strictly-not-newer means this reply is older information
    // than something already applied; drop it before even comparing text.
    if (snapshot.version <= this.#lastSeenHostVersion) return;
    this.#lastSeenHostVersion = snapshot.version;

    if (snapshot.text === this.#mirror.text) {
      // The common case: this reply confirms an edit the mirror already
      // applied optimistically. No spurious replacement (run spec
      // convergence case (a)).
      return;
    }

    // The FIRST snapshot this proxy EVER receives is always the reply to
    // `ready` (see `#hasAppliedLocalEdit`'s doc comment for why a message
    // channel guarantees this) — reporting the document as it stood BEFORE
    // this session existed. If a local edit already moved the mirror past
    // that, this stale confirmation must not revert it; its VERSION is
    // still recorded above so the genuinely fresher reply that follows
    // compares correctly, but its CONTENT is discarded here rather than
    // applied.
    if (isFirstSnapshot && this.#hasAppliedLocalEdit) return;

    // Text differs and this is real, current information: either a
    // rejected edit reverting to the host's unchanged text (case (b)), or
    // a genuine external change (case (c)) — either way, converge by
    // replacement in exactly one step.
    this.replaceExternal(snapshot.text);
    this.#onDiagnostic?.(externalReplacementDiagnostic());
  }

  #handleDisconnect(diagnostic: Diagnostic): void {
    if (this.#disconnected) return;
    this.#disconnected = true;
    this.#clearReplyTimeout();
    this.#onDiagnostic?.(diagnostic);
  }
}
