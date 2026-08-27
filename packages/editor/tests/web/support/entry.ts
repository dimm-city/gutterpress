import { mountEditor, type EditorMount } from "../../../src/web/mount.ts";
import { MemoryDocumentHost } from "../../../src/core/index.ts";
import type { Diagnostic, EditorDocumentHost } from "../../../src/core/index.ts";
import { withFixedRejection } from "./rejecting-host.ts";
import { withCallCounting, type CallCountingHost } from "./counting-host.ts";

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
    const baseHost: EditorDocumentHost = options.rejectReason
      ? withFixedRejection(options.rejectReason, { text: initialText, version: 0 })
      : new MemoryDocumentHost({ text: initialText, version: 0 });
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
};
window.__gpReady = true;
