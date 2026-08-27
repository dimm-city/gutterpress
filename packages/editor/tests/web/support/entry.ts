import { mountEditor, type EditorMount } from "../../../src/web/mount.ts";
import { MemoryDocumentHost } from "../../../src/core/index.ts";
import type { Diagnostic, EditorDocumentHost } from "../../../src/core/index.ts";
import { withFixedRejection } from "./rejecting-host.ts";
import { withCallCounting, type CallCountingHost } from "./counting-host.ts";
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
  readonly containerSelector: string;

  /**
   * A SECOND, fully independent `mountEditor` instance (own container, own
   * host) alongside whatever `mount()`/`dispose()` above are doing — never
   * touched by `mount()`'s "dispose any previous instance first" behavior.
   * Exists ONLY to prove dispose isolation between two LIVE mounts sharing
   * one document (the P1a "dispose on one mount does not affect a second,
   * independent mount" case, whose replacement — case 7c in
   * `input-a11y.btest.ts` — mounts on two DIFFERENT hosts but never disposes
   * one while asserting the other, and predates this run's own per-mount
   * `<style>` injection entirely; see `mount.btest.ts`'s header for the
   * correction).
   */
  mountSecond(initialText: string): string;
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
    host = withCallCounting(baseHost);
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

// ── A second, fully independent mount — never touched by mount()/dispose()
// above — for the dispose-ISOLATION case (two live mounts sharing one
// document; disposing one must not affect the other's DOM, styles, or
// host). Deliberately its own separate container/host/handle, not folded
// into the primary A-side state above.
const CONTAINER_ID_B = "gp-mount-container-b";
let mountHandleB: EditorMount | undefined;
let hostB: EditorDocumentHost | undefined;

function mountSecond(initialText: string): string {
  mountHandleB?.dispose();
  document.getElementById(CONTAINER_ID_B)?.remove();

  hostB = new MemoryDocumentHost({ text: initialText, version: 0 });
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
  containerSelector: `#${CONTAINER_ID}`,

  mountSecond,
  disposeSecond(): void {
    mountHandleB?.dispose();
  },
  getSecondHostText: () => requireHostB().getSnapshot().text,
  secondContainerSelector: `#${CONTAINER_ID_B}`,
};
window.__gpReady = true;
