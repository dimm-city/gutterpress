import { mountEditor, type EditorMount } from "../../../src/web/mount.ts";
import { MemoryDocumentHost } from "../../../src/core/index.ts";
import type { Diagnostic, EditorDocumentHost } from "../../../src/core/index.ts";
import { withFixedRejection } from "./rejecting-host.ts";
import { withCallCounting, withSubscriberCounting, type CallCountingHost } from "./counting-host.ts";
import { withDisposeOnFirstNotify } from "./self-disposing-host.ts";

/**
 * SFE-P2a Lane A — the browser-side scenario driver
 * `tests/web/mount.btest.ts` mounts and drives (via
 * `tests/browser-harness`'s `openHarnessSession`/`waitForHarnessReady`,
 * imported, never edited). Runs INSIDE the real browser; the Node-side test
 * drives it through `window.__gpMount` plus real Playwright keyboard input.
 *
 * Mirrors `tests/vscode-adapter/support/entry.ts`'s own single-instance
 * driver pattern closely (this lane may not write that file — a separate,
 * self-contained sibling, exactly as `tests/web/support/{counting-host,
 * rejecting-host}.ts` already mirror their `tests/vscode-adapter/support/`
 * counterparts for the same write-ownership reason) — but drives
 * `mountEditor` (this run's new adapter-backed shell), not
 * `createVscodeEditorAdapter` directly, and adds the instrumentation this
 * run's OWN new responsibility needs: `injectedStyleElementCount()` proves
 * the `<style>` elements `mountEditor` itself injects (not the adapter) are
 * cleaned up on dispose, and `MountOptions.keepHost` lets a test mount twice
 * on the SAME host (dispose, then remount) to prove no leaked wiring from
 * the first mount double-fires on the second.
 *
 * SFE-P2a round-2 repair: the primary host is always wrapped with
 * `withSubscriberCounting` (`counting-host.ts`) underneath `withCallCounting`
 * — composing both decorators around one `MemoryDocumentHost` — and
 * `activeSubscriberCount()` exposes the inner wrapper's count on the driver.
 * `mountSecond(text, { shareHost: true })` points the second mount at that
 * SAME composed host object instead of constructing its own `hostB`, which
 * is what lets `mount.btest.ts` reproduce the P1a "dispose on one mount does
 * not affect a second, independent mount on the SAME host" case directly
 * (subscriber count 2 -> 1 on A's dispose; B's surface still reachable via
 * `replaceExternal` and B's own keystroke) — see that test for the full
 * scenario. The pre-existing `mountSecond(text)` (no `shareHost`) still
 * constructs its own independent `hostB`, for the separate DOM/`<style>`
 * isolation proof.
 *
 * SFE-P3ab (Lane D): `getSelection()` exposes the PRIMARY mount's own new
 * `EditorMount.getSelection()` (`../mount.ts`) — a plain passthrough, no
 * new state — so `mount.btest.ts` can prove the accessor against real
 * keyboard-driven caret movement instead of asserting on the type alone.
 */

export interface MountOptions {
  readonly readonly?: boolean;
  readonly extraCss?: string;
  /** When set, the mounted host's `applyEdit` ALWAYS rejects with this
   * reason (see `rejecting-host.ts`) — used by the rejection-diagnostic
   * case. Mutually exclusive with `keepHost` (a rejecting host is never
   * reused across mounts in this driver's own test suite). */
  readonly rejectReason?: "stale" | "readonly" | "invalid-range";
  /** When true, reuse the PREVIOUS `mount()` call's host instead of
   * constructing a fresh one — the dispose-then-remount-on-the-same-host
   * scenario (`tests/vscode-adapter/support/entry.ts` has no equivalent;
   * its cases never remount at all). Ignored (a fresh host is still
   * created) on the very first `mount()` call, since there is no previous
   * host to reuse yet. */
  readonly keepHost?: boolean;
  /** When true, the host's synchronous success notification (fired from
   * INSIDE `applyEdit`, before it returns — see `self-disposing-host.ts`)
   * disposes this mount the FIRST time it fires, re-entrantly. Mutually
   * exclusive with `rejectReason`/`keepHost`. */
  readonly disposeOnFirstNotify?: boolean;
}

export interface GutterpressMountHarnessDriver {
  /** Mounts (disposing any previous instance first) and returns the CSS
   * selector for the container `mountEditor` was given. */
  mount(initialText: string, options?: MountOptions): string;
  /** Disposes the current mount, if any. Calling this more than once in a
   * row (with no intervening `mount()`) exercises `EditorMount.dispose()`'s
   * own idempotency directly, since `mountHandle` is never reset to
   * `undefined` here — only `mount()` replaces it. */
  dispose(): void;
  getHostText(): string;
  getHostVersion(): number;
  replaceExternal(text: string): void;
  applyEditCallCount(): number;
  diagnostics(): readonly Diagnostic[];
  /** Count of `<style data-gp-editor-css>` elements currently attached to
   * the document — mountEditor's own injected CSS, distinct from anything
   * the adapter/view itself owns. */
  injectedStyleElementCount(): number;
  /** ACTIVE subscriber count on the primary host (`withSubscriberCounting`,
   * SFE-P2a round-2 repair) — requires `mount()` to have been called at
   * least once. Used by the shared-host dispose-isolation case below to
   * prove disposing one mount unsubscribes exactly that one mount, not
   * every subscriber of a host shared with another live mount. */
  activeSubscriberCount(): number;
  /**
   * SFE-P3ab (Lane D) — passthrough to the current mount's own
   * `EditorMount.getSelection()`. `undefined` before `mount()` has been
   * called at all (nothing to read yet), matching that method's own
   * "no caret" contract rather than throwing — a real caller can legally
   * ask before ever mounting.
   */
  getSelection(): { readonly from: number; readonly to: number } | undefined;
  readonly containerSelector: string;

  /**
   * A SECOND `mountEditor` instance alongside whatever `mount()`/`dispose()`
   * above are doing — never touched by `mount()`'s "dispose any previous
   * instance first" behavior. Two independent scenarios, selected by
   * `options.shareHost`:
   *
   *  - `shareHost` false/omitted (default): a fully independent instance —
   *    own container AND own host — proving DOM/`<style>` isolation between
   *    two live mounts (case 7c in `input-a11y.btest.ts` mounts on two
   *    DIFFERENT hosts too, but never disposes one while asserting the
   *    other, and predates this run's own per-mount `<style>` injection
   *    entirely; see `mount.btest.ts`'s header for the correction).
   *  - `shareHost` true: mounts on the EXACT SAME host object the primary
   *    `mount()` call is using (own container, SHARED host) — the P1a
   *    "dispose on one mount does not affect a second, independent mount on
   *    the same host" case, reproduced directly against the real fork
   *    surface via `activeSubscriberCount()` above (round-1 reproduced only
   *    the separate-host DOM/style half; this closes the shared-host half).
   *    `initialText` is ignored in this mode — the shared host already has
   *    whatever text the primary `mount()` call set, mirroring
   *    `MountOptions.keepHost`'s own "initial text is ignored" convention.
   */
  mountSecond(initialText: string, options?: { readonly shareHost?: boolean }): string;
  disposeSecond(): void;
  getSecondHostText(): string;
  readonly secondContainerSelector: string;
}

declare global {
  interface Window {
    // A DISTINCT global name from `tests/vscode-adapter/support/entry.ts`'s
    // `window.__gp` and `tests/vscode-adapter/input-a11y/support/entry.ts`'s
    // `window.__gpA11y` — required, not stylistic: `src/web.tsconfig.json`'s
    // "include" pulls every browser test entry's `declare global` block into
    // ONE TypeScript program, and TypeScript merges same-named ambient
    // `Window` members (verified live in P1b: two different shapes for the
    // same name is a compile error).
    __gpMount: GutterpressMountHarnessDriver;
    __gpReady?: boolean;
  }
}

const CONTAINER_ID = "gp-mount-container";

let mountHandle: EditorMount | undefined;
let host: CallCountingHost | undefined;
// The SAME underlying object `host` above wraps one layer further in —
// exposes `activeSubscriberCount()` (SFE-P2a round-2 repair). Composing
// `withCallCounting(withSubscriberCounting(baseHost))` and keeping this
// separate reference is what lets `mountSecond(..., { shareHost: true })`
// mount a second, independent `EditorMount` onto the very same host `host`
// already wraps, while still being able to read the subscriber count that
// `CallCountingHost`'s own shape does not expose.
let subscriberCountingHost: (EditorDocumentHost & { activeSubscriberCount(): number }) | undefined;
let collectedDiagnostics: Diagnostic[] = [];

function mount(initialText: string, options: MountOptions = {}): string {
  // `EditorMount.dispose()` is idempotent by contract (see mount.ts), so
  // calling it here even when the previous mount was already disposed by
  // the caller is always safe.
  mountHandle?.dispose();
  document.getElementById(CONTAINER_ID)?.remove();
  collectedDiagnostics = [];

  if (!options.keepHost || !host) {
    let baseHost: EditorDocumentHost = options.rejectReason
      ? withFixedRejection(options.rejectReason, { text: initialText, version: 0 })
      : new MemoryDocumentHost({ text: initialText, version: 0 });
    if (options.disposeOnFirstNotify) {
      // `mountHandle` is reassigned just below, AFTER this host is
      // constructed and handed to `mountEditor` — but the re-entrant
      // dispose only ever fires from a LATER, real keystroke (this
      // scenario's whole point), by which time `mountHandle` already holds
      // the live instance this closure needs to tear down.
      baseHost = withDisposeOnFirstNotify(baseHost, () => mountHandle?.dispose());
    }
    subscriberCountingHost = withSubscriberCounting(baseHost);
    host = withCallCounting(subscriberCountingHost);
  }

  const container = document.createElement("div");
  container.id = CONTAINER_ID;
  document.body.appendChild(container);

  mountHandle = mountEditor(container, host, {
    readonly: options.readonly ?? false,
    extraCss: options.extraCss,
    onDiagnostic: (diagnostic) => collectedDiagnostics.push(diagnostic),
  });

  return `#${CONTAINER_ID}`;
}

function requireHost(): CallCountingHost {
  if (!host) throw new Error("gp mount harness: mount() has not been called yet");
  return host;
}

function requireSubscriberCountingHost(): EditorDocumentHost & { activeSubscriberCount(): number } {
  if (!subscriberCountingHost) throw new Error("gp mount harness: mount() has not been called yet");
  return subscriberCountingHost;
}

// ── A second mount — never touched by mount()/dispose() above — for the
// dispose-ISOLATION cases (two live mounts up at once; disposing one must
// not affect the other's DOM, styles, or host). Deliberately its own
// separate container/handle, not folded into the primary A-side state
// above. `hostB` is either its OWN independent host (default) or, with
// `shareHost: true`, an ALIAS of the exact same object `host` above already
// points at — see `mountSecond`'s own JSDoc on the driver interface for
// which scenario each mode proves.
const CONTAINER_ID_B = "gp-mount-container-b";
let mountHandleB: EditorMount | undefined;
let hostB: EditorDocumentHost | undefined;

function mountSecond(initialText: string, options: { readonly shareHost?: boolean } = {}): string {
  mountHandleB?.dispose();
  document.getElementById(CONTAINER_ID_B)?.remove();

  hostB = options.shareHost
    ? requireHost()
    : new MemoryDocumentHost({ text: initialText, version: 0 });
  const container = document.createElement("div");
  container.id = CONTAINER_ID_B;
  document.body.appendChild(container);
  mountHandleB = mountEditor(container, hostB, {});

  return `#${CONTAINER_ID_B}`;
}

function requireHostB(): EditorDocumentHost {
  if (!hostB) throw new Error("gp mount harness: mountSecond() has not been called yet");
  return hostB;
}

window.__gpMount = {
  mount,
  dispose(): void {
    mountHandle?.dispose();
  },
  getHostText: () => requireHost().getSnapshot().text,
  getHostVersion: () => requireHost().getSnapshot().version,
  replaceExternal: (text: string) => requireHost().replaceExternal(text),
  applyEditCallCount: () => requireHost().applyEditCallCount(),
  diagnostics: () => collectedDiagnostics.slice(),
  injectedStyleElementCount: () =>
    document.querySelectorAll("style[data-gp-editor-css]").length,
  activeSubscriberCount: () => requireSubscriberCountingHost().activeSubscriberCount(),
  getSelection: () => mountHandle?.getSelection(),
  containerSelector: `#${CONTAINER_ID}`,

  mountSecond,
  disposeSecond(): void {
    mountHandleB?.dispose();
  },
  getSecondHostText: () => requireHostB().getSnapshot().text,
  secondContainerSelector: `#${CONTAINER_ID_B}`,
};
window.__gpReady = true;
