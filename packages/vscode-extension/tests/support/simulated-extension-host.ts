import {
  applyEdit as applyEditPure,
  EDITOR_PROTOCOL_VERSION,
  type DocumentSnapshot,
} from "@dimm-city/gutterpress-editor/core";
import { hostDisconnectedDiagnostic } from "../../src/protocol/diagnostics.ts";
import { validateWebviewToHostMessage } from "../../src/protocol/validate.ts";
import type { HostToWebviewMessage } from "../../src/protocol/messages.ts";
import type { WebviewHostTransport } from "../../src/webview-host/proxy-document-host.ts";

/**
 * A fake extension-host counterpart for `ProxyDocumentHost` unit tests
 * (SFE-P3c run spec: "The shared runDocumentHostContractTests suite passes
 * against ProxyDocumentHost wired to a simulated host with latency and
 * out-of-order replies"). This is TEST INFRASTRUCTURE, not a production
 * implementation — the real host-side authority is
 * `../../src/host/document-gateway.ts`'s `DocumentGateway`; this class
 * reuses the SAME pure `applyEdit` (`@dimm-city/gutterpress-editor/core`)
 * for its own document-authority behavior so its accept/reject decisions
 * match a real host's, but it has none of `DocumentGateway`'s vscode
 * plumbing.
 *
 * LATENCY AND OUT-OF-ORDER DELIVERY, faithfully modeled:
 *
 *   - A real message channel (VS Code's `webview.postMessage`, or any
 *     `postMessage`-based transport) preserves SEND ORDER between one
 *     sender and one receiver — it does not let a later-posted message
 *     overtake an earlier one purely due to network jitter. `#reply()`
 *     below enforces this with a monotonic `#nextDeliveryTime` cursor: no
 *     reply is ever delivered before one queued earlier, even if its own
 *     randomized transmission delay would otherwise be shorter.
 *   - `"ready"` is always the very FIRST message a `ProxyDocumentHost` ever
 *     sends (its constructor sends it before a caller could reach
 *     `applyEdit`), and its reply is computed synchronously (no real async
 *     gap on the host side for it) — delivered with a small FIXED delay,
 *     not drawn from `options.latencyMs`, so its place at the front of the
 *     FIFO cursor is never left to chance.
 *   - `"apply-edit"`'s reply, in contrast, is NOT computed/queued
 *     synchronously: it goes through a caller-controlled PROCESSING delay
 *     first (`options.latencyMs`), simulating the real
 *     `DocumentGateway`'s `await workspace.applyEdit(...)` gap. During
 *     that gap, an INDEPENDENT event — `externalChange()`, simulating an
 *     unrelated host-side change — can be queued and delivered FIRST, even
 *     though the edit was submitted earlier. THIS is the genuine
 *     out-of-order case the run spec's convergence case (c) needs; it is
 *     not the same thing as "ready racing behind an edit reply," which the
 *     fixed small delay above rules out by construction.
 *
 * Together these prove `ProxyDocumentHost`'s staleness/first-snapshot
 * handling (`#lastSeenHostVersion`, `#hasAppliedLocalEdit`) against
 * realistic reordering — not an unrealistic one where even causally-ordered
 * replies from the SAME sender could arrive scrambled, which no real
 * `postMessage` channel would ever do.
 */
export interface SimulatedExtensionHostOptions {
  /** Returns the delay (ms) before the NEXT reply is delivered. Called once
   *  per reply. Default: `Math.floor(Math.random() * 20)` (0-19ms jitter,
   *  enough for genuine interleaving across a handful of concurrent
   *  replies without slowing the suite down). */
  readonly latencyMs?: () => number;
}

/** `"ready"`'s reply delay — fixed, not drawn from `options.latencyMs`. See
 *  this module's header for why. */
const READY_REPLY_DELAY_MS = 1;

export class SimulatedExtensionHost {
  #snapshot: DocumentSnapshot;
  readonly #latencyMs: () => number;
  #deliver: (message: HostToWebviewMessage) => void = () => {};
  /** FIFO delivery cursor: no reply is ever scheduled to arrive before this
   *  point, regardless of its own transmission delay — see this module's
   *  header. Monotonically non-decreasing. */
  #nextDeliveryTime = 0;

  constructor(initial: DocumentSnapshot, options: SimulatedExtensionHostOptions = {}) {
    this.#snapshot = initial;
    this.#latencyMs = options.latencyMs ?? (() => Math.floor(Math.random() * 20));
  }

  /** Wires this host's outbound replies to `deliver` (called by
   *  `createSimulatedProxyPair` below, once, at construction). */
  connect(deliver: (message: HostToWebviewMessage) => void): void {
    this.#deliver = deliver;
  }

  /** The receiving end of `WebviewHostTransport.postMessage` — call this
   *  with whatever the proxy posts. Runs every inbound message through the
   *  SAME real protocol validator a real host would (a malformed message
   *  from a broken proxy implementation is simply dropped, matching D12 —
   *  this harness is not the place to test the validator itself; see
   *  `tests/protocol/validate.test.ts` for that). */
  receive(raw: unknown): void {
    const result = validateWebviewToHostMessage(raw);
    if (!result.valid) return;
    const message = result.value;

    if (message.type === "ready") {
      this.#reply(READY_REPLY_DELAY_MS);
      return;
    }
    if (message.type === "apply-edit") {
      // The PROCESSING delay — see this module's header: computing and
      // queuing this reply is deferred, simulating the real
      // DocumentGateway's `await workspace.applyEdit(...)` gap, during
      // which an independent externalChange() can queue and deliver first.
      const processingDelayMs = this.#latencyMs();
      setTimeout(() => {
        const outcome = applyEditPure(this.#snapshot, message.edit);
        if (outcome.ok) this.#snapshot = outcome.snapshot;
        // Always reply with the fresh truth, exactly like DocumentGateway's
        // own single-reply-site design (accept and reject share this same
        // path, differing only in the snapshot's content).
        this.#reply(this.#latencyMs());
      }, processingDelayMs);
      return;
    }
    // "diagnostic-report": no host-side effect in this harness.
  }

  /** Simulates a host-authoritative external change (undo/redo, another
   *  extension's edit, ...) — the "External changes are authoritative
   *  messages too" binding point. Computed and queued SYNCHRONOUSLY
   *  (unlike "apply-edit"'s reply): a real `onDidChangeTextDocument`
   *  listener firing has no comparable async gap of its own. */
  externalChange(text: string): void {
    this.#snapshot = { text, version: this.#snapshot.version + 1 };
    this.#reply(this.#latencyMs());
  }

  /** The host's current authoritative snapshot — read by tests to assert
   *  the proxy's mirror ends up byte-identical to it (convergence case
   *  (c)). */
  currentSnapshot(): DocumentSnapshot {
    return this.#snapshot;
  }

  /** Simulates the real `DocumentGateway`'s `EDITOR_HOST_DISCONNECTED`
   *  broadcast (a closed document, in real usage) — delivered immediately,
   *  bypassing the FIFO cursor entirely, since a real disconnect is not
   *  something a host would ever queue behind a pending reply. Used by
   *  convergence case (d)'s test ("a local edit after disconnect is
   *  refused"). */
  disconnect(): void {
    this.#deliver({
      type: "disconnect",
      protocolVersion: EDITOR_PROTOCOL_VERSION,
      diagnostic: hostDisconnectedDiagnostic("document-closed"),
    });
  }

  /** Queues a `snapshot` reply with `transmissionDelayMs` latency, but
   *  never delivers it before `#nextDeliveryTime` — preserving FIFO order
   *  relative to every reply queued earlier (see this module's header). */
  #reply(transmissionDelayMs: number): void {
    const snapshotAtCallTime = this.#snapshot;
    const now = Date.now();
    const deliverAt = Math.max(now + transmissionDelayMs, this.#nextDeliveryTime);
    this.#nextDeliveryTime = deliverAt;
    setTimeout(
      () => {
        this.#deliver({ type: "snapshot", protocolVersion: EDITOR_PROTOCOL_VERSION, snapshot: snapshotAtCallTime });
      },
      Math.max(0, deliverAt - now),
    );
  }
}

/**
 * Wires a fresh `SimulatedExtensionHost` to an in-memory
 * `WebviewHostTransport` — the pairing every test in
 * `tests/webview-host/proxy-document-host.test.ts` builds a
 * `ProxyDocumentHost` over.
 */
export function createSimulatedProxyPair(
  initialText: string,
  options: SimulatedExtensionHostOptions = {},
): { readonly host: SimulatedExtensionHost; readonly transport: WebviewHostTransport } {
  const host = new SimulatedExtensionHost({ text: initialText, version: 0 }, options);
  const listeners = new Set<(message: unknown) => void>();

  const transport: WebviewHostTransport = {
    postMessage: (message) => host.receive(message),
    onMessage: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  host.connect((message) => {
    for (const listener of listeners) listener(message);
  });

  return { host, transport };
}
