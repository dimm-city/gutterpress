import { EDITOR_PROTOCOL_VERSION, type Diagnostic, type SourceEdit } from "@dimm-city/gutterpress-editor/core";
import type { GutterpressProjection } from "gutterpress/render";
import { SimulatedExtensionHost } from "../../support/simulated-extension-host.ts";
import type {
  HostToWebviewMessage,
  PresentationInputMessage,
  ProjectionPluginError,
} from "../../../src/protocol/messages.ts";
import type { WebviewHostTransport } from "../../../src/webview-host/proxy-document-host.ts";

/**
 * SFE-P3c Lane C — a fake extension host for the REAL-Chromium webview
 * proofs (`tests/webview/*.btest.ts`), browser-bundled alongside
 * `tests/webview/support/entry.ts`.
 *
 * REUSE, not reinvention (run spec DETAILS #4: "reuse/adapt the
 * message-shape ideas from tests/support/simulated-extension-host.ts — but
 * yours must run in the browser bundle, so keep it browser-safe or inline a
 * small one"): `../../support/simulated-extension-host.ts` (Lane A) turns
 * out to be ALREADY browser-safe as written — it imports only
 * `@dimm-city/gutterpress-editor/core` and this package's own
 * webview-purity-checked `src/protocol/**` modules, and its own runtime
 * surface is `setTimeout`/`Math.random`/`Date.now`/`Set`, all standard
 * browser globals, not Node-specific. Verified by reading it (not assumed).
 * This module therefore REUSES it directly for the
 * D3 authority/convergence semantics (readonly -> stale -> invalid-range,
 * FIFO-ordered replies, out-of-order `externalChange` injection,
 * `disconnect()`) rather than re-deriving that logic — duplicating it would
 * be exactly the "hand-rolled scanner beside the real parser" class of
 * machinery the P3e ruling warns against.
 *
 * What THIS module adds, because `SimulatedExtensionHost` deliberately does
 * NOT cover it (it is scoped to the D3 snapshot/edit contract only, per its
 * own header): the two extra handshake replies a REAL `provider.ts`
 * resolve sends that `mountGutterpressWebview` (`../../../src/webview/
 * index.ts`) actually reads — `presentation-input` (D13's rich/source-
 * fallback decision) and `trust-state` (D9). Both are delivered
 * SYNCHRONOUSLY, immediately after the webview's own `"ready"` message is
 * observed, mirroring `provider.ts`'s own reply order (presentation-input,
 * then trust-state, THEN — asynchronously, via `SimulatedExtensionHost`'s
 * own ~1ms reply timer — `snapshot`).
 *
 * RECONCILIATION ADDENDUM — MESSAGE MERGE: `sendProjectionUpdate` (on the
 * returned session) sends a LATER `presentation-input` resend carrying a
 * projection payload — the real `provider.ts`'s own `sendProjection()`
 * equivalent, called explicitly by a test rather than automatically on
 * `"ready"`, so a test can assert the PRE-upgrade (plain `mountEditor`)
 * state first and make the upgrade to `mountGutterpressEditor` observable
 * (AP-21).
 */
export interface FakeExtensionHostOptions {
  /** D13's decision this session's `presentation-input` reply carries.
   *  Default `"rich"`. */
  readonly mode?: "rich" | "source-fallback";
  /** Required (by convention, not by this module) when `mode` is
   *  `"source-fallback"` — `presentation-input`'s own diagnostic field. */
  readonly diagnostic?: Diagnostic;
  /** D9's `trust-state` value. Default `true` (most scenarios in this
   *  suite are not exercising trust-gated behavior). */
  readonly trusted?: boolean;
  /** Forwarded to `SimulatedExtensionHost`'s own `latencyMs` option —
   *  reply-delay override for tests that need genuine in-flight overlap
   *  (burst typing, an external change racing a queued edit). Defaults to
   *  that class's own default (small random jitter) when omitted. */
  readonly latencyMs?: () => number;
}

export interface FakeExtensionHostSession {
  readonly transport: WebviewHostTransport;
  /** The underlying `SimulatedExtensionHost` this session wraps — for
   *  direct authority/convergence behaviors this module does not
   *  re-expose: `currentSnapshot()`, `externalChange(text)`,
   *  `disconnect()`. */
  readonly simulated: SimulatedExtensionHost;
  /**
   * Sends a LATER `presentation-input` resend carrying a projection payload
   * — mirrors `../../../src/provider.ts`'s async `sendProjection()` resend
   * (reconciliation addendum's message merge: `presentation-input`, not a
   * separate `"projection"` message, now carries this). `mode` is fixed at
   * this session's own construction-time decision, matching the real
   * provider's own invariant that `mode` never changes mid-session. Lets a
   * test seed a projection AFTER asserting the pre-upgrade (plain
   * `mountEditor`) state, so `mountGutterpressWebview`'s upgrade is
   * observable rather than baked into the initial handshake reply.
   */
  sendProjectionUpdate(payload: {
    readonly projection: GutterpressProjection;
    readonly pluginCss?: string;
    readonly pluginErrors?: readonly ProjectionPluginError[];
    readonly diagnostic?: Diagnostic;
  }): void;
  /**
   * Every `apply-edit` message this host RECEIVED from the webview, in
   * order, carrying the EXACT `{from, to, insert}` `SourceEdit` the webview
   * sent — independent of `simulated.currentSnapshot()`'s resulting text,
   * so a test can assert the wire message itself was byte-exact (run spec
   * DETAILS #4b: "produces apply-edit messages whose {from,to,insert} land
   * byte-exactly against the fake host's document"), not merely that the
   * final text happened to come out right.
   */
  recordedEdits(): readonly SourceEdit[];
  /**
   * The number of `WebviewHostTransport.onMessage` listeners CURRENTLY
   * registered against this session's transport — mirrors
   * `packages/editor/tests/web/support/counting-host.ts`'s
   * `withSubscriberCounting`/`activeSubscriberCount()` proof technique,
   * applied to THIS layer instead: one real `ProxyDocumentHost` per live
   * `mountGutterpressWebview` call registers exactly one listener at
   * construction and removes it on `dispose()` (run spec DETAILS #4e,
   * "Disposal": "removes every listener ... on both sides" — this is the
   * webview-transport half of that proof). Used by
   * `tests/webview/disposal.btest.ts` to prove dispose-then-remount leaves
   * no leaked subscription, directly, rather than only inferring it from a
   * message-count side effect.
   */
  listenerCount(): number;
  /**
   * Delivers an ARBITRARY, untyped payload directly to every subscriber of
   * this session's transport — bypassing `SimulatedExtensionHost` entirely,
   * which only ever constructs well-formed `HostToWebviewMessage`s (repair
   * round 1, finding "One malformed inbound message permanently destroys
   * the editing surface"). Simulates a malformed message or unrelated
   * window-message noise reaching the real webview's
   * `window.addEventListener("message", ...)` listener — the exact path
   * the finding names as untested by any suite.
   */
  deliverRaw(raw: unknown): void;
  /**
   * Sends a LATER, well-formed `trust-state` message on its own — mirrors
   * `../../../src/provider.ts`'s `onDidGrantWorkspaceTrust` subscription
   * handler's own FIRST statement (a fresh `trust-state` post, independent
   * of and always followed by that same handler's `sendProjection()` call —
   * see `sendProjectionUpdate` above for the second half of that same real
   * sequence). This session's OWN construction-time `trusted` option
   * (`FakeExtensionHostOptions.trusted`) already covers the INITIAL
   * handshake reply; this method exists for a test that needs a SECOND,
   * later `trust-state` — repair round 1, finding "D9's required trust
   * explanation is not implemented" (proving the webview's OPTIMISTIC
   * `onTrustChange` clear, independent of whatever `presentation-input`
   * resend follows it).
   */
  sendTrustState(trusted: boolean): void;
}

/**
 * Constructs one fake extension host + its paired `WebviewHostTransport`,
 * exactly as `mountGutterpressWebview` expects to be wired in production
 * (`acquireVsCodeApi().postMessage` / `window.addEventListener("message",
 * ...)`) — see `../../../src/webview/index.ts`'s own production wiring at
 * the bottom of that file for the shape this mirrors.
 */
export function createFakeExtensionHost(
  initialText: string,
  options: FakeExtensionHostOptions = {},
): FakeExtensionHostSession {
  const simulated = new SimulatedExtensionHost(
    { text: initialText, version: 0 },
    options.latencyMs !== undefined ? { latencyMs: options.latencyMs } : {},
  );
  const listeners = new Set<(message: unknown) => void>();
  const edits: SourceEdit[] = [];

  function deliver(message: HostToWebviewMessage): void {
    for (const listener of listeners) listener(message);
  }
  simulated.connect(deliver);

  const transport: WebviewHostTransport = {
    postMessage: (message) => {
      if (message.type === "apply-edit") edits.push(message.edit);
      // Reuses SimulatedExtensionHost's own real D3 authority/convergence
      // handling for "ready" (schedules a snapshot reply) and "apply-edit"
      // (dry-runs the SAME pure applyEdit every other host uses, schedules
      // an accept/reject snapshot reply) — see this file's header.
      simulated.receive(message);

      if (message.type === "ready") {
        const presentationInput: PresentationInputMessage = {
          type: "presentation-input",
          protocolVersion: EDITOR_PROTOCOL_VERSION,
          mode: options.mode ?? "rich",
          ...(options.diagnostic ? { diagnostic: options.diagnostic } : {}),
        };
        deliver(presentationInput);
        deliver({
          type: "trust-state",
          protocolVersion: EDITOR_PROTOCOL_VERSION,
          trusted: options.trusted ?? true,
        });
      }
    },
    onMessage: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  return {
    transport,
    simulated,
    recordedEdits: () => edits.slice(),
    listenerCount: () => listeners.size,
    deliverRaw: (raw: unknown) => {
      // Bypasses `deliver`'s `HostToWebviewMessage` typing on purpose — see
      // this session's own `deliverRaw` doc comment.
      for (const listener of listeners) listener(raw);
    },
    sendTrustState: (trusted: boolean) => {
      deliver({ type: "trust-state", protocolVersion: EDITOR_PROTOCOL_VERSION, trusted });
    },
    sendProjectionUpdate: (payload) => {
      deliver({
        type: "presentation-input",
        protocolVersion: EDITOR_PROTOCOL_VERSION,
        mode: options.mode ?? "rich",
        projection: payload.projection,
        pluginCss: payload.pluginCss ?? "",
        pluginErrors: payload.pluginErrors ?? [],
        ...(payload.diagnostic ? { diagnostic: payload.diagnostic } : {}),
      });
    },
  };
}
