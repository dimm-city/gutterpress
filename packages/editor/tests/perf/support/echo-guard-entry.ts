import { mountEditor, type EditorMount } from "../../../src/web/mount.ts";
import { MemoryDocumentHost } from "../../../src/core/index.ts";
import { withSnapshotCallCounting, type SnapshotCallCountingHost } from "./snapshot-call-counting-host.ts";

/**
 * SFE-P3d-sweep Lane D — D13 root-cause regression guard.
 *
 * Mounts the REAL `mountEditor` fork surface (same as `support/entry.ts`)
 * against a `MemoryDocumentHost` wrapped with
 * `withSnapshotCallCounting` (`snapshot-call-counting-host.ts`), so a Node
 * test can assert `getSnapshot()`'s call count directly — the discriminator
 * this lane's profiling used to confirm the echo-convergence mechanism
 * (`adapter.ts`'s `host.subscribe` handler) is what actually runs on every
 * ordinary accepted edit, not the "genuinely external" branch.
 *
 * `createVscodeEditorAdapter` calls `host.getSnapshot()` exactly ONCE, at
 * construction (`adapter.ts`: `let known: DocumentSnapshot =
 * host.getSnapshot();`) — every other read of the current snapshot uses the
 * adapter's own `known` local, updated directly from `applyEdit`'s return
 * value (`result.snapshot`) on the fast/matching-echo path. The ONLY other
 * places `host.getSnapshot()` is called are the two "genuinely
 * external/rejected" branches, both deferred to a `queueMicrotask` — see
 * that file's own long comment. So for N ordinary accepted keystrokes
 * against a document with NO external replacement ever happening (this
 * harness's whole scenario), the call count must stay at the single
 * mount-time call: any additional call proves the adapter took the slow,
 * "not recognized as our own echo" branch on an edit that unambiguously WAS
 * our own echo — the exact regression `echo-guard.btest.ts` exists to
 * catch, restated as an in-page counter so the Node-side test does not need
 * package internals (D5).
 */

export interface EchoGuardDriver {
  mount(text: string): void;
  dispose(): void;
  getSnapshotCallCount(): number;
  readonly containerSelector: string;
}

declare global {
  interface Window {
    // Distinct from every other browser test entry's global (see
    // `support/entry.ts`'s own comment on why this must be unique — every
    // entry's `declare global` merges into one TypeScript program).
    __gpEchoGuard: EchoGuardDriver;
    __gpReady?: boolean;
  }
}

const CONTAINER_ID = "gp-echo-guard-container";

let mountHandle: EditorMount | undefined;
let host: SnapshotCallCountingHost | undefined;

function mount(text: string): void {
  mountHandle?.dispose();
  document.getElementById(CONTAINER_ID)?.remove();

  const container = document.createElement("div");
  container.id = CONTAINER_ID;
  document.body.appendChild(container);

  host = withSnapshotCallCounting(new MemoryDocumentHost({ text, version: 0 }));
  mountHandle = mountEditor(container, host, {});
}

window.__gpEchoGuard = {
  mount,
  dispose(): void {
    mountHandle?.dispose();
    mountHandle = undefined;
    document.getElementById(CONTAINER_ID)?.remove();
  },
  getSnapshotCallCount: (): number => host?.getSnapshotCallCount() ?? 0,
  containerSelector: `#${CONTAINER_ID}`,
};
window.__gpReady = true;
