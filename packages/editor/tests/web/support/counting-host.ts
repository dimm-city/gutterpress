import type { DocumentSnapshot, EditorDocumentHost } from "../../../src/core/index.ts";

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
