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

/**
 * The fields of `PresentationInputMessage` (`../protocol/messages.ts`)
 * `ProxyDocumentHostOptions.onPresentationInput` forwards, on every
 * delivery of that message type — reconciliation addendum's message merge.
 * `mode`/`diagnostic` are always meaningful; `projection`/`pluginCss`/
 * `pluginErrors` are present only once a projection has actually been
 * built and sent (never on the FIRST, synchronous handshake reply — see
 * that interface's own doc comment) and absent otherwise, exactly mirroring
 * the wire shape rather than inventing a separate "has a projection yet"
 * boolean.
 */
export type PresentationInputPayload = Pick<
  PresentationInputMessage,
  "mode" | "diagnostic" | "projection" | "pluginCss" | "pluginErrors"
>;

export interface ProxyDocumentHostOptions {
  /** Fired for every locally-relevant `Diagnostic`: an external-replacement
   *  notice, or a GENUINE `EDITOR_HOST_DISCONNECTED` transition
   *  (`#handleDisconnect` — a closed document or a reply that never
   *  arrived). Threaded straight through by Lane C's `mountGutterpressEditor`
   *  call the same way every other host's `onDiagnostic` option already is.
   *
   *  Repair round 1 (finding "One malformed inbound message permanently
   *  destroys the editing surface"): a rejected inbound message NO LONGER
   *  fires this callback — see `onProtocolRejection` below for why, and for
   *  where that signal now goes instead. */
  readonly onDiagnostic?: (diagnostic: Diagnostic) => void;
  /**
   * Repair round 1 (finding "One malformed inbound message permanently
   * destroys the editing surface, while the proxy mirror stays writable and
   * the message listener does no origin filtering"): fired for a message
   * that fails `validateHostToWebviewMessage` — a wrong protocol version,
   * unknown type, missing/wrong-typed field, or an oversized payload.
   *
   * PRE-repair, this same event was reported through `onDiagnostic` as
   * `EDITOR_HOST_DISCONNECTED` (the closest existing D14 category —
   * `diagnosticForProtocolRejection`'s own doc comment) — and the webview's
   * `handleDiagnostic` treats ANY `EDITOR_HOST_DISCONNECTED` as "tear down
   * and latch a permanent fallback." That conflated two genuinely different
   * events: a REJECTED MESSAGE (this class's own D3/D12 checks already
   * refused it — nothing was applied, the mirror is provably unharmed and
   * stays fully writable, exactly as `#disconnected` staying `false`
   * already implies) is not the same as a REAL channel loss (a closed
   * document, a reply that never arrives). Worse, with `window.addEventListener("message",
   * ...)` doing no origin filtering (the webview entry's own known,
   * documented limitation — see that file's header), ANY unrelated window
   * message reaching this listener — from a stray browser extension, an
   * embedded iframe, anything sharing the same `window` — could trip this
   * path and permanently kill an otherwise-healthy session.
   *
   * This callback is the FIX: the webview logs it (dev-visible) and
   * CONTINUES — the session survives a malformed/unrelated message exactly
   * as it should, since nothing about this class's own state actually
   * changed. `diagnostic-report`'s wire payload back to the host is
   * UNCHANGED (still `EDITOR_HOST_DISCONNECTED`, the closest existing D14
   * category for a host-side dev log line the host never acts on) —
   * `onDiagnostic`/`EDITOR_HOST_DISCONNECTED` is reserved, from this class's
   * webview-facing surface, for a REAL disconnection only.
   */
  readonly onProtocolRejection?: (failure: ProtocolValidationFailure) => void;
  /** Fired on every `trust-state` message (D9: "Trust granted mid-session
   *  re-resolves"). Outside `EditorDocumentHost`'s own contract (that
   *  interface has no trust member — see `packages/editor/src/core/hosts.ts`)
   *  so this is a separate, optional channel Lane C's webview entry may
   *  wire into its own project/plugin-trust presentation. */
  readonly onTrustChange?: (trusted: boolean) => void;
  /** Fired on EVERY `presentation-input` message — the initial reply (D13's
   *  rich-vs-fallback `mode` decision, a one-time, mount-time decision — see
   *  `PresentationInputMessage`'s own doc comment in `../protocol/messages.ts`)
   *  AND every later resend the addendum's message merge adds (`mode`
   *  unchanged, `projection`/`pluginCss`/`pluginErrors` newly populated or
   *  refreshed). The caller distinguishes the two by whether `projection` is
   *  present — see `PresentationInputPayload`'s own doc comment below. */
  readonly onPresentationInput?: (input: PresentationInputPayload) => void;
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
 * spec's binding reconciliation model AS AMENDED (reconciliation addendum —
 * see this file's own header note on the defect the addendum fixes, and
 * `../protocol/messages.ts`'s `SnapshotMessage`/`ApplyEditMessage` doc
 * comments for the wire fields below):
 *
 *   Point 2 (amended) — `applyEdit` performs the D3 checks (readonly ->
 *   stale -> invalid-range) against the mirror via the SAME pure
 *   `applyEdit` every other host uses, applies optimistically, bumps the
 *   mirror version exactly once, and notifies subscribers — ALWAYS,
 *   synchronously, regardless of the wire. The mirror's version counter
 *   (`edit.expectedVersion`, `getSnapshot().version`) is LOCAL and
 *   monotonic and is NEVER sent anywhere meaningful on the wire (the
 *   addendum's own fix: the original design sent it as `ApplyEditMessage`'s
 *   `expectedVersion` and the gateway compared it against ITS OWN,
 *   unrelated version space — a comparison that could only ever coincide by
 *   accident, and in practice never did after the first real edit; a
 *   committed regression test reproduced this deterministically). What
 *   crosses the wire instead is `#lastKnownStamp`, described next.
 *
 *   Point 2 (addendum) — AT MOST ONE apply-edit in flight. Sending an edit
 *   to the transport is decoupled from applying it to the mirror: every
 *   accepted local edit updates the mirror and notifies IMMEDIATELY
 *   (optimistic, per point 2 above), but if another edit is already
 *   awaiting its authoritative reply, this one's WIRE MESSAGE queues
 *   (`#queue`) rather than sending concurrently. `#inFlightExpectedText`
 *   remembers the mirror text the one currently in-flight edit was expected
 *   to produce; each `ApplyEditMessage` carries `base: #lastKnownStamp` —
 *   the stamp of the state this proxy last had authoritative confirmation
 *   of — as PROOF to the gateway of which state this edit was built
 *   against (see `DocumentGateway.applyEdit`'s own header for the other
 *   half of this check). No per-edit correlation id exists anywhere in this
 *   class or on the wire — this is a stamp plus a bounded send queue, never
 *   request/reply matching.
 *
 *   Point 3/5 — every authoritative reply (an edit's accept/reject, or an
 *   unprompted external change) arrives over the SAME "snapshot" message
 *   kind, each carrying the gateway's freshly bumped `baseStamp`.
 *
 *   Point 4 (amended, and re-amended by repair round 2 — see below) —
 *   convergence by REPLACEMENT, evaluated against what THIS reply was
 *   expected to confirm, not against the mirror's CURRENT text (which may
 *   already be ahead of it — see point 2's queueing note). WHILE SOMETHING
 *   IS IN FLIGHT, a reply confirms ONLY by matching `#inFlightExpectedText`
 *   exactly — the mirror's current text is NEVER consulted as a fallback in
 *   that case, even though it is normally identical to `#inFlightExpectedText`
 *   for a single edit with nothing queued behind it. Once something else is
 *   queued on top, the mirror's current text reflects THOSE later,
 *   optimistic, not-yet-confirmed edits too — and can coincidentally equal
 *   an UNRELATED reply's text (e.g. the host's unchanged pre-edit text,
 *   reported because this reply's own edit was rejected) purely by chance,
 *   which is not evidence of anything real. Repair round 2 (finding "A
 *   queued edit is still dispatched after a REJECTED in-flight edit"): the
 *   ORIGINAL "amended" wording above allowed EITHER match to count while
 *   in flight, on the theory that "already caught up" only ever meant a
 *   confirmed reply arriving with nothing queued — but the mirror can just
 *   as easily be "caught up" to a value it reached by OPTIMISTICALLY
 *   APPLYING a later queued edit, which looks identical to this check and
 *   is not remotely the same fact. Only when NOTHING is in flight does the
 *   mirror's current text become the right thing to compare against — the
 *   plain external-broadcast case (also covers a reply arriving once the
 *   queue has already fully drained). Either way: a reply that fails to
 *   confirm calls `replaceExternal` (one version bump) AND discards the
 *   whole queue along with it — the addendum's own "no rebasing" rule: later
 *   queued edits were computed on top of a mirror state now proven wrong,
 *   and are dropped rather than replayed, rather than being dispatched
 *   against a state the host never actually confirmed reaching. A reply
 *   that DOES confirm dispatches the queue's next entry (if any), using
 *   this reply's `baseStamp`. This is what suppresses the host's echo of
 *   our own accepted edit "without any origin bookkeeping": still no
 *   request/reply correlation id, just a text comparison against a value
 *   this class already knows — now scoped to the ONE value that is actually
 *   proof of anything while an edit is outstanding.
 */
export class ProxyDocumentHost implements EditorDocumentHost {
  #mirror: DocumentSnapshot;
  #readonly: boolean;
  #disconnected = false;
  readonly #listeners = new Set<(snapshot: DocumentSnapshot) => void>();
  readonly #transport: WebviewHostTransport;
  readonly #unsubscribeTransport: () => void;
  readonly #onDiagnostic?: (diagnostic: Diagnostic) => void;
  readonly #onProtocolRejection?: (failure: ProtocolValidationFailure) => void;
  readonly #onTrustChange?: (trusted: boolean) => void;
  readonly #onPresentationInput?: (input: PresentationInputPayload) => void;
  readonly #replyTimeoutMs: number;
  /** The highest `SnapshotMessage.baseStamp` (the GATEWAY's own stamp — see
   *  the class doc comment's point 3/5 and `../protocol/messages.ts`)
   *  accepted so far. Starts at 0, matching `DocumentGateway`'s own
   *  pre-first-send starting value (that class's `#stamp` also starts at
   *  0), so the very first reply — whose stamp is always 1 or higher, since
   *  the gateway bumps before every send — is always newer. Used for BOTH
   *  jobs the addendum's fix separates from the mirror's own version:
   *  dropping stale/out-of-order wire deliveries, AND as the value sent
   *  back as the NEXT edit's `ApplyEditMessage.base` — never surfaced as,
   *  or conflated with, the mirror's own local version. */
  #lastKnownStamp = 0;
  /** The mirror text the CURRENTLY in-flight edit (if any) was expected to
   *  produce — `undefined` when nothing is in flight. Captured at the
   *  moment an edit is actually POSTED to the transport (`#postEdit`), not
   *  read fresh from `#mirror` later: by the time a reply arrives, `#mirror`
   *  may already be AHEAD of it (later keystrokes queued on top while this
   *  one was in flight — class doc comment, point 2's queueing note). This
   *  is the one piece of "which edit is this" bookkeeping this class keeps,
   *  and it names a STATE (a string to compare), never an id to correlate a
   *  reply against — `#handleSnapshot` still converges by plain text
   *  comparison. */
  #inFlightExpectedText: string | undefined;
  /**
   * Repair round 1 (finding "Projection staleness compares the host's
   * TextDocument.version against the webview mirror's LOCAL version"): the
   * mirror's own LOCAL `version` (`#mirror.version`) is what
   * `packages/editor`'s `projectionNeedsRefresh` compares a projection's
   * `sourceVersion` against (via `getSnapshot().version`, this class's own
   * public surface) — but `../project/projection.ts` stamps a built
   * projection's `sourceVersion` from `DocumentGateway.currentStamp()`, a
   * THIRD space (see that method's own doc comment). Left unremapped, the
   * two spaces "only ever coincide by accident" (this class's own header,
   * describing the identical failure mode the reconciliation addendum's
   * `baseStamp` fixed for the edit-application path) — a rejected/queued
   * edit permanently offsets them, silently and permanently disabling every
   * Gutterpress chip for the rest of the session.
   *
   * This field pairs `#lastKnownStamp` (the host-stamp space) with the
   * mirror `.version` (the mirror-local space) it corresponded to at the
   * exact moment the mirror last provably converged to EXACTLY the text
   * that stamp describes — see `#recordConvergenceAnchor`'s own doc
   * comment for the precise conditions under which that is true, and
   * `#remapProjectionSourceVersion` for how it is used. `undefined` means
   * "no valid anchor for the CURRENT `#lastKnownStamp`" — a projection
   * tagged with any stamp then remaps to a value that can never equal the
   * mirror's current version, so it is safely treated as stale rather than
   * wrongly trusted.
   */
  #mirrorVersionAtLastKnownStamp: number | undefined;
  /** Edits applied to the mirror while another edit was already in flight —
   *  optimistic and already reflected in `#mirror`/subscribers by the time
   *  they land here; only their WIRE SEND is deferred. Each entry pairs the
   *  edit with the mirror text it produced AT THE MOMENT it was queued
   *  (`expectedText`) — NOT re-derived from `#mirror` later, because by the
   *  time an earlier entry is dispatched, `#mirror` may already reflect
   *  STILL-LATER queued entries too (three rapid keystrokes queue three
   *  entries; dispatching the first must not claim credit for the other
   *  two's text). Drained in order, one at a time, as each predecessor's
   *  authoritative reply confirms (`#dispatchNextQueued`) — never sent
   *  two-at-once, and wholly discarded (never rebased/replayed) the moment
   *  a reply proves divergence (class doc comment, point 4). */
  readonly #queue: Array<{ readonly edit: SourceEdit; readonly expectedText: string }> = [];
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
    this.#onProtocolRejection = options.onProtocolRejection;
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
      // Addendum, point 2: AT MOST ONE apply-edit in flight. The mirror
      // already reflects this edit (above) regardless of which branch
      // fires below — only the WIRE SEND is gated.
      if (this.#inFlightExpectedText === undefined) {
        this.#postEdit(edit, result.snapshot.text);
      } else {
        this.#queue.push({ edit, expectedText: result.snapshot.text });
      }
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

  /**
   * Posts `edit` to the transport as this session's one in-flight request,
   * remembering `expectedText` (the mirror text this specific edit was
   * expected to produce) so `#handleSnapshot` can recognize its
   * confirmation later even if the mirror has since moved further ahead
   * (class doc comment, point 2/4). `base` is always `#lastKnownStamp` —
   * the freshest stamp this proxy has authoritative proof of.
   */
  #postEdit(edit: SourceEdit, expectedText: string): void {
    this.#inFlightExpectedText = expectedText;
    this.#transport.postMessage({
      type: "apply-edit",
      protocolVersion: EDITOR_PROTOCOL_VERSION,
      edit,
      base: this.#lastKnownStamp,
    });
    this.#armReplyTimeoutIfNeeded();
  }

  /**
   * Records (or invalidates) the anchor pairing `#lastKnownStamp` with a
   * mirror version — see `#mirrorVersionAtLastKnownStamp`'s own doc
   * comment. Called ONLY from `#handleSnapshot`'s `confirmed` branch, where
   * `confirmedText` is `snapshot.text` — the text this reply just
   * confirmed. Valid (records `this.#mirror.version`) ONLY when the
   * mirror's CURRENT text is EXACTLY `confirmedText` right now: if
   * `confirmed` matched only via `#inFlightExpectedText` while the mirror
   * has since moved further ahead (queued local edits already applied on
   * top before this reply arrived), the mirror does NOT currently equal
   * what this stamp describes, and no mirror version anchors it correctly
   * — invalidated (`undefined`) rather than recording one whose text would
   * not actually match.
   */
  #recordConvergenceAnchor(confirmedText: string): void {
    this.#mirrorVersionAtLastKnownStamp = confirmedText === this.#mirror.text ? this.#mirror.version : undefined;
  }

  /**
   * Remaps a projection's host-stamp-space `sourceVersion` (see
   * `resolveEditorProjectionPayload`, `../project/projection.ts`, which
   * stamps it from `DocumentGateway.currentStamp()`, never
   * `document.version`) into the mirror's own LOCAL version space
   * `mountGutterpressEditor`'s `isStale()` check actually compares against
   * (`host.getSnapshot().version`, i.e. `this.#mirror.version` —
   * `packages/editor/src/gutterpress/mount.ts`, `match.ts`'s
   * `projectionNeedsRefresh`). See `#mirrorVersionAtLastKnownStamp`'s own
   * doc comment for the full account of the defect this fixes.
   *
   * A projection built from EXACTLY the state this mirror last provably
   * converged to (`hostStamp === #lastKnownStamp`, AND a valid anchor
   * exists for it) remaps to that anchor's own mirror version — equal to
   * `this.#mirror.version` right now if, and only if, nothing has changed
   * the mirror since that convergence (no later local edit, no later
   * authoritative reply). Any OTHER stamp — older, unrecognized, or one
   * with no valid anchor at all — remaps to a sentinel `this.#mirror.version`
   * can never equal (mirror versions are always finite and non-negative),
   * so the projection is correctly treated as stale rather than silently
   * trusted against a state it does not actually describe.
   */
  #remapProjectionSourceVersion(hostStamp: number): number {
    if (this.#mirrorVersionAtLastKnownStamp !== undefined && hostStamp === this.#lastKnownStamp) {
      return this.#mirrorVersionAtLastKnownStamp;
    }
    return Number.NEGATIVE_INFINITY;
  }

  /**
   * Sends the next queued edit (if any), using the stamp `#handleSnapshot`
   * just recorded — or, if the queue is empty, marks nothing in flight.
   * Called ONLY from `#handleSnapshot`'s "no divergence" branch (a reply
   * confirmed what it was expected to, or the queue was just discarded
   * along with a divergence) — never from `applyEdit` itself, which posts
   * its OWN edit directly when nothing is already in flight.
   */
  #dispatchNextQueued(): void {
    const next = this.#queue.shift();
    if (next === undefined) {
      this.#inFlightExpectedText = undefined;
      return;
    }
    this.#postEdit(next.edit, next.expectedText);
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
    // Repair round 1 — see `onProtocolRejection`'s own doc comment: a
    // rejected MESSAGE is reported on its own dedicated channel, never
    // `onDiagnostic`/`EDITOR_HOST_DISCONNECTED` (which the webview treats
    // as a genuine, permanent channel loss). Nothing about this class's own
    // state changed — the mirror stays exactly as writable as it was.
    this.#onProtocolRejection?.(failure);
    const diagnostic = diagnosticForProtocolRejection(failure);
    // D15-safe: `diagnostic` never carries document text (see
    // `../protocol/diagnostics.ts`'s header). Reported back to the host
    // purely for its own dev-log visibility — the host never changes
    // behavior in response (see `DiagnosticReportMessage`'s doc comment).
    this.#transport.postMessage({ type: "diagnostic-report", protocolVersion: EDITOR_PROTOCOL_VERSION, diagnostic });
  }

  #dispatch(message: HostToWebviewMessage): void {
    switch (message.type) {
      case "snapshot":
        this.#handleSnapshot(message.snapshot, message.baseStamp);
        return;
      case "trust-state":
        this.#onTrustChange?.(message.trusted);
        return;
      case "presentation-input":
        this.#onPresentationInput?.({
          mode: message.mode,
          diagnostic: message.diagnostic,
          // Repair round 1 (finding "Projection staleness compares the
          // host's TextDocument.version against the webview mirror's LOCAL
          // version"): the projection this class hands upward NEVER
          // carries the host's own wire-space `sourceVersion` unremapped
          // — see `#remapProjectionSourceVersion`'s own doc comment. This
          // is a plain STATE comparison against values this class already
          // tracks (G-05: never an origin inference).
          projection: message.projection
            ? { ...message.projection, sourceVersion: this.#remapProjectionSourceVersion(message.projection.sourceVersion) }
            : undefined,
          pluginCss: message.pluginCss,
          pluginErrors: message.pluginErrors,
        });
        if (message.diagnostic) this.#onDiagnostic?.(message.diagnostic);
        return;
      case "disconnect":
        this.#handleDisconnect(message.diagnostic);
        return;
    }
  }

  /**
   * Point 4's (amended) convergence rule. ANY snapshot message — whatever
   * its content — proves the channel is alive, so the reply timer always
   * clears here first, before the staleness/content checks below decide
   * whether anything else happens; it is re-armed at the very end if this
   * class is still waiting on something once those checks finish (covers
   * the pre-first-snapshot race below, which otherwise leaves the timer
   * cleared with no reply yet actually confirmed).
   */
  #handleSnapshot(snapshot: DocumentSnapshot, baseStamp: number): void {
    this.#clearReplyTimeout();
    const isFirstSnapshot = !this.#receivedInitialSnapshot;
    this.#receivedInitialSnapshot = true;

    // Reconciliation addendum: stale/out-of-order delivery guard, keyed on
    // the GATEWAY's own stamp (never adopted as the mirror's version — see
    // the class doc comment). `>=`, not strict `>`: the gateway's initial
    // ready-handshake reply deliberately does NOT bump the stamp
    // (`DocumentGateway.sendInitialSnapshot`'s own doc comment) — it and
    // this proxy's own `#lastKnownStamp` both start at 0, so the very
    // first reply must still be accepted at that shared starting value.
    // Older-or-equal-to-what's-already-known means this reply carries no
    // information this class does not already have; drop it before even
    // comparing text, and before updating any in-flight/queue state below.
    if (baseStamp >= this.#lastKnownStamp) {
      this.#lastKnownStamp = baseStamp;

      // Confirmation, evaluated against what THIS reply was expected to
      // show. Repair round 2 (finding "A queued edit is still dispatched
      // after a REJECTED in-flight edit"): WHILE something is in flight,
      // the ONLY valid proof this reply confirms it is a match against
      // `#inFlightExpectedText` — the mirror's CURRENT text is not
      // consulted, because queued-but-unsent edits already applied to it
      // optimistically can make it coincidentally equal an UNRELATED
      // reply's text (e.g. the host's unchanged pre-edit text, reported
      // because THIS edit was rejected) with no relation to what actually
      // happened. Only once NOTHING is in flight does the mirror's current
      // text become the right comparison — the plain external-broadcast
      // case (also covers a reply arriving after the queue has already
      // fully drained). See the class doc comment's point 4 for the full
      // account, including the false-positive this replaces.
      const wasInFlight = this.#inFlightExpectedText !== undefined;
      const confirmed = wasInFlight ? snapshot.text === this.#inFlightExpectedText : snapshot.text === this.#mirror.text;

      if (confirmed) {
        // Run spec convergence case (a): no spurious replacement. If this
        // was the reply the in-flight edit was waiting on, the queue
        // advances; otherwise there is nothing to advance.
        this.#recordConvergenceAnchor(snapshot.text);
        if (wasInFlight) this.#dispatchNextQueued();
      } else if (isFirstSnapshot && this.#hasAppliedLocalEdit) {
        // The FIRST snapshot this proxy EVER receives is always the reply
        // to `ready` (see `#hasAppliedLocalEdit`'s doc comment for why a
        // message channel guarantees this) — reporting the document as it
        // stood BEFORE this session existed. If a local edit already moved
        // the mirror past that, this stale confirmation must not revert
        // it, and must not be treated as this edit's own reply either (the
        // REAL reply is still to come) — its STAMP is still recorded above
        // so the genuinely fresher reply that follows compares correctly,
        // but its CONTENT is discarded here, and nothing in-flight/queued
        // is touched. No valid convergence anchor exists for THIS stamp
        // either — the mirror is provably ahead of what it describes.
        this.#mirrorVersionAtLastKnownStamp = undefined;
      } else {
        // Text differs and this is real, current information: either a
        // rejected edit reverting to the host's unchanged text (case (b)),
        // or a genuine external change (case (c)) — either way, converge
        // by replacement in exactly one step. Addendum: "no rebasing" —
        // any still-queued edits were built on top of a mirror state now
        // proven wrong, so they are discarded along with the replacement,
        // never replayed.
        this.replaceExternal(snapshot.text);
        this.#queue.length = 0;
        this.#inFlightExpectedText = undefined;
        // Valid unconditionally: replaceExternal just set #mirror.text to
        // EXACTLY snapshot.text.
        this.#mirrorVersionAtLastKnownStamp = this.#mirror.version;
        this.#onDiagnostic?.(externalReplacementDiagnostic());
      }
    }

    if (this.#inFlightExpectedText !== undefined) this.#armReplyTimeoutIfNeeded();
  }

  #handleDisconnect(diagnostic: Diagnostic): void {
    if (this.#disconnected) return;
    this.#disconnected = true;
    this.#clearReplyTimeout();
    this.#onDiagnostic?.(diagnostic);
  }
}
