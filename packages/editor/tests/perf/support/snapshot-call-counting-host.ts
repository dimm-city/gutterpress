import type {
  ApplyEditResult,
  DocumentSnapshot,
  EditorDocumentHost,
  SourceEdit,
} from "../../../src/core/index.ts";

export interface SnapshotCallCountingHost extends EditorDocumentHost {
  /** Number of `getSnapshot()` calls observed so far. */
  getSnapshotCallCount(): number;
}

/**
 * SFE-P3d-sweep Lane D — D13 root-cause regression guard support.
 *
 * Test-only `EditorDocumentHost` decorator counting `getSnapshot()` calls
 * at the boundary. Deliberately its own small file rather than an addition
 * to `tests/vscode-adapter/support/counting-host.ts` (that file is another
 * lane's — keeping this one separate avoids any write-ownership overlap;
 * see `echo-guard.btest.ts` for why `getSnapshot()` specifically is the
 * signal this lane needs.
 *
 * Mirrors `tests/vscode-adapter/support/counting-host.ts`'s own shape and
 * write-ownership rationale (that file's own header cites
 * `tests/web/support/counting-host.ts`, P1a Lane B, for the same pattern).
 */
export function withSnapshotCallCounting(host: EditorDocumentHost): SnapshotCallCountingHost {
  let getSnapshotCalls = 0;
  return {
    getSnapshot(): DocumentSnapshot {
      getSnapshotCalls++;
      return host.getSnapshot();
    },
    applyEdit(edit: SourceEdit): ApplyEditResult {
      return host.applyEdit(edit);
    },
    replaceExternal: (text: string): void => host.replaceExternal(text),
    subscribe(listener: (snapshot: DocumentSnapshot) => void): () => void {
      return host.subscribe(listener);
    },
    getSnapshotCallCount: (): number => getSnapshotCalls,
  };
}
