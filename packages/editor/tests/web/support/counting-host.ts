import type {
  ApplyEditResult,
  DocumentSnapshot,
  EditorDocumentHost,
  SourceEdit,
} from "../../../src/core/index.ts";

/**
 * Test-only `EditorDocumentHost` decorator that counts ACTIVE subscribers.
 *
 * `MemoryDocumentHost` (packages/editor/src/core/memory-host.ts) keeps its
 * listener set in a private field by design — D7 hosts own their own
 * bookkeeping, and nothing in the D3/D7 contract requires exposing a
 * subscriber count. A dispose/leak-detection test still needs to observe
 * "did `dispose()` actually unsubscribe," so this wrapper counts
 * `subscribe`/unsubscribe calls at the boundary instead of reaching into
 * `MemoryDocumentHost`'s private state. Every other member delegates
 * directly to the wrapped host, unchanged.
 */
export function withSubscriberCounting(
  host: EditorDocumentHost,
): EditorDocumentHost & { activeSubscriberCount(): number } {
  let count = 0;
  return {
    getSnapshot: () => host.getSnapshot(),
    applyEdit: (edit) => host.applyEdit(edit),
    replaceExternal: (text) => host.replaceExternal(text),
    subscribe(listener: (snapshot: DocumentSnapshot) => void): () => void {
      count++;
      const realUnsubscribe = host.subscribe(listener);
      let unsubscribed = false;
      return () => {
        if (unsubscribed) return;
        unsubscribed = true;
        count--;
        realUnsubscribe();
      };
    },
    activeSubscriberCount: () => count,
  };
}

export interface CallCountingHost extends EditorDocumentHost {
  applyEditCallCount(): number;
}

/**
 * SFE-P2a Lane A — test-only `EditorDocumentHost` decorator that counts
 * `applyEdit` calls at the boundary. Used by `tests/web/mount.btest.ts`'s
 * "dispose then remount on the same host" case to prove a keypress on the
 * REMOUNTED surface reaches the host exactly once — if the disposed mount's
 * wiring had leaked, the same keypress would be double-counted.
 *
 * Mirrors `tests/vscode-adapter/support/counting-host.ts`'s own
 * `withCallCounting` (P1b Lane A); kept as this lane's own self-contained
 * copy for the same write-ownership reason `rejecting-host.ts`'s header
 * documents (this lane may not write `tests/vscode-adapter/**`). Only the
 * single member this suite actually needs is included — see that sibling
 * file for the fuller shape (`notificationCount`, `lastSubmittedEdit`) a
 * future case here can add if it ever needs them too.
 */
export function withCallCounting(host: EditorDocumentHost): CallCountingHost {
  let applyEditCalls = 0;
  return {
    getSnapshot: () => host.getSnapshot(),
    applyEdit(edit: SourceEdit): ApplyEditResult {
      applyEditCalls++;
      return host.applyEdit(edit);
    },
    replaceExternal: (text) => host.replaceExternal(text),
    subscribe: (listener) => host.subscribe(listener),
    applyEditCallCount: () => applyEditCalls,
  };
}
