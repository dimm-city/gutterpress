import type { Diagnostic, EditorDocumentHost } from "@dimm-city/gutterpress-editor/core";
import { mountEditor, type EditorMount } from "@dimm-city/gutterpress-editor/web";
import { ProxyDocumentHost, type WebviewHostTransport } from "../webview-host/proxy-document-host.ts";
import type { PresentationInputMessage } from "../protocol/messages.ts";

/**
 * SFE-P3c Lane C — the real webview entry (run spec DETAILS #1, "THE
 * ENTRY"). This is the file `../../scripts/build.mjs` (Lane A) looks for at
 * exactly this path; once it exists, that script bundles it for real
 * (`target: "browser", format: "esm"`) instead of emitting its placeholder
 * `dist/webview.js`. The bundle is loaded by `../provider.ts`'s
 * `renderWebviewHtml` via one `<script type="module" nonce="...">` tag, into
 * the `#gp-editor-root` div that same HTML shell creates.
 *
 * PURITY (run spec DETAILS #2): nothing in this file imports `vscode`, a
 * Node builtin, or the desktop package — enforced mechanically by
 * `tools/check-architecture.mjs`'s webview-purity rule (Lane A), which
 * already scopes `src/webview` alongside `src/protocol`/`src/webview-host`.
 * `acquireVsCodeApi` is a real VS Code webview global (injected because
 * `provider.ts` sets `enableScripts: true`) — declared locally below, never
 * imported.
 *
 * AUTHORITY MODEL (run spec "Authority and reconciliation model", points
 * 1-6): this module NEVER treats itself as authoritative. It constructs one
 * `ProxyDocumentHost` (`../webview-host/proxy-document-host.ts`, Lane A) —
 * whose constructor performs the D3 checks against a local mirror and sends
 * the initial `"ready"` message on its own, before this file does anything
 * else — and mounts the shared editor over it. Every accept/reject/external-
 * replacement/disconnect decision already lives in that class; this file's
 * only job is UI: decide what to show in `#gp-editor-root` for the host's
 * `presentation-input` decision (D13) and for an `EDITOR_HOST_DISCONNECTED`
 * diagnostic (D14) at any later point in the session.
 *
 * PROJECTION-MESSAGE SEAM (run spec DETAILS #1): `src/protocol/messages.ts`
 * now defines `ProjectionMessage` (added mid-run, concurrently with this
 * file, by another phase of Lane A's own work) but it is not yet
 * consumable here — `ProxyDocumentHost` has no hook for it and
 * `validate.ts`'s dispatcher does not yet accept it. `mountRichSurface`
 * below is therefore ALWAYS today's `mountEditor` (standard-Markdown)
 * branch, which independently satisfies D9's "untrusted/plain files still
 * get rich editing." See that function's own header for the exact gap,
 * citations, and the ready-to-wire replacement, and this run's report for
 * the same note.
 */

declare global {
  /**
   * Injected into every VS Code webview's global scope because
   * `provider.ts` sets `webview.options = { enableScripts: true, ... }` —
   * never imported (run spec DETAILS #2). Typed to exactly the one member
   * this module uses; the real API also has `getState`/`setState`, omitted
   * here because nothing in this run's D3/D7 design persists webview view-
   * state (the authoritative snapshot lives host-side, per the authority
   * model above), so declaring them would be guessing at an unused surface.
   */
  function acquireVsCodeApi(): { postMessage(message: unknown): void };
}

const EDITOR_ROOT_ID = "gp-editor-root";

export interface WebviewSession {
  /**
   * Tears down the mounted editor (if any), `ProxyDocumentHost`'s own reply
   * timer and transport subscription (D14 "Disposal": "removes every
   * listener, timer and subscription on both sides" — this is the webview
   * side's half), and clears any fallback DOM this session rendered.
   * Idempotent — matches `EditorMount.dispose()`'s and
   * `ProxyDocumentHost.dispose()`'s own idempotent contracts.
   */
  dispose(): void;
}

/**
 * The one production entry point. Exported (not merely a bottom-of-file
 * side effect) so `tests/webview/support/entry.ts` drives THIS SAME
 * function, against a fake transport, from real Chromium — AP-21: the code
 * under test actually runs, in both production and the browser proofs, not
 * a reimplementation of it. Idempotent per call: each call owns its own
 * host/mount/fallback state, so a caller (production wiring below, or a
 * test driver's `mount()`) is free to construct a fresh session per
 * `container`/`transport` pair.
 */
export function mountGutterpressWebview(container: Element, transport: WebviewHostTransport): WebviewSession {
  const ownerDocument = container.ownerDocument;
  if (!ownerDocument) {
    // Mirrors `mountEditor`'s own guard (`@dimm-city/gutterpress-editor/web`):
    // every real Element a real browser or webview ever hands out has a
    // non-null ownerDocument, so reaching this is a broken caller, not a
    // D14 diagnostic case — failing loudly here is more honest than
    // silently no-oping.
    throw new Error("mountGutterpressWebview: container has no ownerDocument");
  }

  let mount: EditorMount | undefined;
  let disposed = false;
  let fallbackShown = false;

  // `ProxyDocumentHost`'s constructor sends "ready" as its OWN last
  // statement (see that class's own header), and this file's binding
  // callback (`onPresentationInput` below) reads the outer `host` const
  // once it fires. A REAL VS Code webview channel is inherently
  // asynchronous (it crosses a process/IPC boundary), so a real host's
  // handshake reply can never return synchronously inside the SAME call
  // stack as `postMessage()` — but nothing in `WebviewHostTransport`'s own
  // contract GUARANTEES that, and this file's own real-Chromium test fake
  // host (`tests/webview/support/fake-extension-host.ts`) legitimately
  // replies synchronously. A synchronous reply would otherwise re-enter
  // `onPresentationInput` while `const host = new ProxyDocumentHost(...)`
  // below is still evaluating its right-hand side — reading `host` at that
  // point throws `ReferenceError: Cannot access 'host' before
  // initialization` (verified live by this run's own browser suite, which
  // is exactly how this was caught). `hostConstructed`/
  // `pendingPresentationInput` are declared and initialized BEFORE that
  // statement, so referencing THEM inside the callback is always safe —
  // they gate whether `host` itself is safe to touch yet, and replay
  // exactly one captured synchronous reply immediately after construction
  // completes.
  let hostConstructed = false;
  let pendingPresentationInput: Pick<PresentationInputMessage, "mode" | "diagnostic"> | undefined;

  const host = new ProxyDocumentHost(
    { text: "", version: 0 },
    transport,
    {
      onDiagnostic: handleDiagnostic,
      onPresentationInput: (input) => {
        if (!hostConstructed) {
          pendingPresentationInput = input;
          return;
        }
        handlePresentationInput(input);
      },
    },
  );
  hostConstructed = true;
  if (pendingPresentationInput) {
    const captured = pendingPresentationInput;
    pendingPresentationInput = undefined;
    handlePresentationInput(captured);
  }

  /**
   * D13's rich-vs-fallback decision, fired exactly once on the initial
   * handshake reply (`PresentationInputMessage`'s own doc comment,
   * `../protocol/messages.ts`: "made once, at resolve time, not re-
   * evaluated as the document grows or shrinks during the session"). At
   * the moment this fires, `host.getSnapshot()` still holds the
   * placeholder `{text: "", version: 0}` this function constructed above —
   * the real initial text arrives moments later as the handshake's
   * `snapshot` reply (sent third, after `presentation-input` and
   * `trust-state` — see `provider.ts`'s own reply order) and reaches the
   * mounted view through `ProxyDocumentHost`'s ordinary convergence path
   * (`replaceExternal`, which `createVscodeEditorAdapter`'s host
   * subscription already renders on its own) — the SAME mechanism an
   * external file change uses, not a special case. This is the intended
   * design (`ProxyDocumentHost`'s own doc comment: "the FIRST snapshot this
   * proxy ever receives is always the reply to `ready`"), not a workaround.
   *
   * Called either directly (a genuinely async host reply — the common,
   * realistic case) or replayed once, immediately above, for a reply that
   * arrived synchronously during construction — `host` is guaranteed fully
   * initialized by the time this function body ever runs, either way.
   */
  function handlePresentationInput(input: Pick<PresentationInputMessage, "mode" | "diagnostic">): void {
    if (disposed || fallbackShown) return;
    if (input.mode === "source-fallback") {
      renderFallback(input.diagnostic ?? UNRESOLVED_PRESENTATION_DIAGNOSTIC);
      return;
    }
    mount = mountRichSurface(container, host, handleDiagnostic);
  }

  /**
   * D14: an `EDITOR_HOST_DISCONNECTED` diagnostic — from a disposed panel,
   * a closed document, or a reply that never arrived (`ProxyDocumentHost`'s
   * own self-diagnosis) — tears down any live mount and renders the same
   * honest fallback text D13's oversized case uses, per this run's DETAILS
   * #1: "your fallback rendering for the file-too-large / disconnect
   * states is plain, honest text in #gp-editor-root with the D14 category
   * and safe next action." Every OTHER diagnostic category (a rejected
   * local edit, an external-replacement notice, a malformed inbound
   * message `ProxyDocumentHost` already reported back to the host on its
   * own) has no dedicated webview-chrome surface in this run's scope
   * (P3e ruling: the smallest design that satisfies the specification — a
   * toast/banner system for those is a future run's concern, not named by
   * this run's behavior table) and is only dev-visible via `console.warn`.
   */
  function handleDiagnostic(diagnostic: Diagnostic): void {
    if (disposed) return;
    if (diagnostic.category === "EDITOR_HOST_DISCONNECTED") {
      renderFallback(diagnostic);
      return;
    }
    console.warn(`[gutterpress webview] ${diagnostic.category}: ${diagnostic.message}`);
  }

  function renderFallback(diagnostic: Diagnostic): void {
    fallbackShown = true;
    mount?.dispose();
    mount = undefined;
    container.replaceChildren();

    const wrap = ownerDocument.createElement("div");
    wrap.setAttribute("data-gp-fallback", diagnostic.category);
    wrap.style.cssText = "font-family:sans-serif;padding:1rem;line-height:1.5;";

    const message = ownerDocument.createElement("p");
    message.setAttribute("data-gp-fallback-message", "");
    message.textContent = diagnostic.message;
    wrap.appendChild(message);

    if (diagnostic.safeAction) {
      const action = ownerDocument.createElement("p");
      action.setAttribute("data-gp-fallback-action", "");
      action.style.cssText = "font-weight:600;";
      action.textContent = diagnostic.safeAction;
      wrap.appendChild(action);
    }

    container.appendChild(wrap);
  }

  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      mount?.dispose();
      mount = undefined;
      host.dispose();
    },
  };
}

/**
 * D9's mount decision (run spec DETAILS #1): "when a projection has
 * arrived ... use mountGutterpressEditor from
 * '@dimm-city/gutterpress-editor/gutterpress' with extraCss from the
 * message; otherwise mountEditor from '@dimm-city/gutterpress-editor/web'
 * (standard Markdown — D9 says untrusted/plain files still get rich
 * editing)".
 *
 * *** PROJECTION-MESSAGE SEAM — READ BEFORE CHANGING *** (see this run's
 * report for the same account): `../protocol/messages.ts` NOW defines
 * `ProjectionMessage` (`type: "projection"`, fields `projection: GutterpressProjection`,
 * `pluginCss: string`, `pluginErrors`, `diagnostic?`) — added mid-run by a
 * concurrent phase of Lane A's own work (`../project/projection.ts`'s
 * `resolveEditorProjectionMessage` already builds it; observed landing
 * while this file was being written). Its CONTRACT is stable and worth
 * citing exactly: "SENT ASYNCHRONOUSLY, ALWAYS AFTER the `ready` handshake's
 * other three messages ... RESENT on every authoritative change to the
 * document ... and on `trust-state` transitioning to trusted ... `projection`
 * is always populated with a SAFE fallback (the base pipeline)."
 *
 * It is NOT YET CONSUMABLE from this file, for two reasons verified by
 * reading (not guessing) the current state of files outside this lane's
 * write boundary:
 *
 *   1. `../webview-host/proxy-document-host.ts`'s `ProxyDocumentHostOptions`
 *      has no `onProjection` callback, and its `#dispatch` switch has no
 *      `case "projection"` — a `ProjectionMessage` that reached it would be
 *      silently dropped (matched by nothing).
 *   2. `../protocol/validate.ts`'s `validateHostToWebviewMessage` has no
 *      `case (type === "projection")` in its dispatch chain either, despite
 *      already importing/defining `validateProjectionShape` and
 *      `validateProjectionPluginErrors` — a `ProjectionMessage` reaching it
 *      today falls through to the "unreachable" tail and is REJECTED as
 *      `unknown-message-type`, before this file could ever see it.
 *
 * Both are Lane A's own files (`src/protocol/**`, `src/webview-host/**`) —
 * outside this lane's write boundary, and this run's own "Behavior that
 * must remain unchanged" clause forbids editing `packages/editor/src/**`
 * to invent a different seam instead. Rather than hand-roll a SECOND,
 * parallel `transport.onMessage` subscription with its own ad hoc
 * (re-)validation of `ProjectionMessage` — exactly the kind of duplicate
 * machinery beside the real validator P3e's ruling warns against, and one
 * this file has no authority to keep in sync with Lane A's still-moving
 * design for the two hooks above — this function stays the "otherwise"
 * branch for now, which independently satisfies D9 on its own (standard
 * Markdown rich editing, available immediately, regardless of workspace
 * trust or project detection).
 *
 * Once both hooks land, wire it here exactly as the desktop's
 * `RichEditor.svelte` does for the equivalent decision — and, since this
 * file's own `handleDiagnostic`/`renderFallback` already dispose-and-replace
 * a live `mount` imperatively (no reactive prop-watching to omit, unlike the
 * Svelte `{#key}` bug SFE-P3e's review found and fixed on desktop), the same
 * pattern extends safely to a live upgrade-on-arrival:
 *
 *   function handleProjection(message: Pick<ProjectionMessage, "projection" | "pluginCss" | "diagnostic">): void {
 *     if (disposed || fallbackShown) return;
 *     if (message.diagnostic) handleDiagnostic(message.diagnostic); // dev-visible only; never blocks the mount below
 *     mount?.dispose();
 *     mount = mountGutterpressEditor(container, host, {
 *       projection: message.projection,
 *       extraCss: message.pluginCss || undefined,
 *       onDiagnostic: handleDiagnostic,
 *     });
 *   }
 *
 * wired as an ADDITIONAL `ProxyDocumentHostOptions` callback (e.g.
 * `onProjection: handleProjection`) alongside `onDiagnostic`/
 * `onPresentationInput` above — mounting `mountEditor` immediately on
 * `presentation-input` and then UPGRADING to `mountGutterpressEditor` the
 * moment a projection arrives (first delivery or a later resend) is
 * deliberately chosen over waiting for the first projection before ever
 * mounting: it keeps the editor usable from t=0 even if a build is slow (or,
 * as observed while writing this seam, not yet wired at all), and the
 * explicit imperative dispose-then-remount above has no missing-reactivity
 * failure mode to repeat.
 */
function mountRichSurface(
  container: Element,
  host: EditorDocumentHost,
  onDiagnostic: (diagnostic: Diagnostic) => void,
): EditorMount {
  return mountEditor(container, host, { onDiagnostic });
}

/** D14 requires every boundary failure to carry a specific category —
 *  never a generic "failed". A `presentation-input` reply of
 *  `mode: "source-fallback"` with no `diagnostic` field is itself a
 *  protocol-contract violation on the HOST's part (D13/`PresentationInputMessage`'s
 *  own doc comment: "`mode: 'source-fallback'` carries the
 *  `EDITOR_FILE_TOO_LARGE` diagnostic explaining why"), not a case this
 *  module invents a reason for; this is the fallback's fallback, reusing
 *  the closest existing D14 category (mirrors `../protocol/diagnostics.ts`'s
 *  own "closest existing category" judgment calls) so the webview still
 *  fails closed with SOME honest, categorized text instead of silently
 *  rendering nothing. */
const UNRESOLVED_PRESENTATION_DIAGNOSTIC: Diagnostic = {
  category: "EDITOR_HOST_DISCONNECTED",
  message: "The editor could not determine how to open this document.",
  safeAction: "Reload the editor",
};

/**
 * Real production wiring (run spec DETAILS #1: "construct the transport,
 * construct ProxyDocumentHost, send ready ..., and mount"). Guarded on
 * `acquireVsCodeApi` actually being defined: ALWAYS true inside a real VS
 * Code webview (`provider.ts` sets `enableScripts: true`, which is what
 * makes VS Code inject it), never true on `tests/webview/support/entry.ts`'s
 * harness page (which defines no such global) — so this side effect no-ops
 * there, and that file instead calls `mountGutterpressWebview` directly
 * against fake transports, once per test scenario, within the one shared
 * browser session its own header describes. This guard is genuine
 * defensive coding, not a test-only hook: a script that somehow loaded
 * outside a real webview context should not throw on a missing global.
 */
if (typeof acquireVsCodeApi === "function") {
  const root = document.getElementById(EDITOR_ROOT_ID);
  if (root) {
    const vscodeApi = acquireVsCodeApi();
    const transport: WebviewHostTransport = {
      postMessage: (message) => vscodeApi.postMessage(message),
      onMessage: (listener) => {
        const handler = (event: MessageEvent): void => listener(event.data);
        window.addEventListener("message", handler);
        return () => window.removeEventListener("message", handler);
      },
    };
    mountGutterpressWebview(root, transport);
  }
}
