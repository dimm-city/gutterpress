import type {
  ApplyEditResult,
  DocumentSnapshot,
  EditorDocumentHost,
  SourceEdit,
} from "../../../src/core/index.ts";

export interface CallCountingHost extends EditorDocumentHost {
  applyEditCallCount(): number;
  notificationCount(): number;
  /** The most recent `SourceEdit` submitted through `applyEdit`, or
   * `undefined` if none has been submitted yet — used to assert byte-exact
   * `[from, to)` edit locality directly against what the adapter actually
   * sent, rather than inferring it from before/after text alone. */
  lastSubmittedEdit(): SourceEdit | undefined;
}

/**
 * SFE-P1b Lane A — test-only `EditorDocumentHost` decorator that counts
 * `applyEdit` and `subscribe`-notification calls at the boundary and
 * records the most recent submitted `SourceEdit`. Used by:
 *   - case 1's locality assertions (`lastSubmittedEdit()`'s exact
 *     `[from, to)` + `insert`, not just before/after text);
 *   - case 2's browser test, to prove the adapter's external-replacement
 *     path "does not echo an edit back to the host" (SFE-P1b.md's behavior
 *     table, row 2) — a claim that requires observing `applyEdit`'s CALL
 *     COUNT, not just its return value.
 * Mirrors `tests/web/support/counting-host.ts`'s own pattern (P1a Lane B);
 * kept as this lane's own self-contained copy for the same write-ownership
 * reason `rejecting-host.ts`'s header documents.
 */
export function withCallCounting(host: EditorDocumentHost): CallCountingHost {
  let applyEditCalls = 0;
  let notifications = 0;
  let lastEdit: SourceEdit | undefined;
  return {
    getSnapshot: () => host.getSnapshot(),
    applyEdit(edit: SourceEdit): ApplyEditResult {
      applyEditCalls++;
      lastEdit = edit;
      return host.applyEdit(edit);
    },
    replaceExternal: (text) => host.replaceExternal(text),
    subscribe(listener: (snapshot: DocumentSnapshot) => void): () => void {
      return host.subscribe((snapshot) => {
        notifications++;
        listener(snapshot);
      });
    },
    applyEditCallCount: () => applyEditCalls,
    notificationCount: () => notifications,
    lastSubmittedEdit: () => lastEdit,
  };
}
