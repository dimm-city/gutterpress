import type {
  ApplyEditResult,
  DocumentSnapshot,
  EditorDocumentHost,
  SourceEdit,
} from "../../../../src/core/index.ts";

export interface TrackingHost extends EditorDocumentHost {
  applyEditCallCount(): number;
  /** The most recent `SourceEdit` submitted through `applyEdit`, or
   * `undefined` if none has been submitted yet — used for case 8's
   * byte-exact clipboard/composition locality assertions, the same way
   * Lane A's `counting-host.ts` uses it for case 1. */
  lastSubmittedEdit(): SourceEdit | undefined;
  /**
   * How many listeners are CURRENTLY subscribed (incremented by `subscribe`,
   * decremented when the returned unsubscribe function is called; calling
   * it twice does not double-decrement). Case 8's disposal proof needs this,
   * not just a lifetime notification count: "the host subscriber count
   * returns to baseline" means the adapter's own `host.subscribe` listener
   * was actually removed on `dispose()`, not merely that it stopped firing.
   */
  activeSubscriberCount(): number;
}

/**
 * SFE-P1b Lane B — test-only `EditorDocumentHost` decorator that tracks
 * `applyEdit` calls and ACTIVE (not merely lifetime) `subscribe` count.
 *
 * A self-contained copy of the same pattern Lane A's
 * `tests/vscode-adapter/support/counting-host.ts` uses (that file itself
 * documents why it is its own copy rather than an import from
 * `tests/web/support/counting-host.ts`: cross-lane test-support files are
 * not imported across a write-ownership boundary in this codebase's
 * established convention). This copy adds `activeSubscriberCount`, which
 * neither existing counting-host needs, because only this lane's case 8
 * disposal proof ("host subscriber count returns to baseline") requires
 * observing subscription COUNT, not just notification count.
 */
export function withTracking(host: EditorDocumentHost): TrackingHost {
  let applyEditCalls = 0;
  let lastEdit: SourceEdit | undefined;
  let activeSubscribers = 0;

  return {
    getSnapshot: () => host.getSnapshot(),
    applyEdit(edit: SourceEdit): ApplyEditResult {
      applyEditCalls++;
      lastEdit = edit;
      return host.applyEdit(edit);
    },
    replaceExternal: (text) => host.replaceExternal(text),
    subscribe(listener: (snapshot: DocumentSnapshot) => void): () => void {
      activeSubscribers++;
      const unsubscribe = host.subscribe(listener);
      let unsubscribed = false;
      return () => {
        if (unsubscribed) return;
        unsubscribed = true;
        activeSubscribers--;
        unsubscribe();
      };
    },
    applyEditCallCount: () => applyEditCalls,
    lastSubmittedEdit: () => lastEdit,
    activeSubscriberCount: () => activeSubscribers,
  };
}
