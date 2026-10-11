import type { EditorDocumentHost } from "../../../src/core/index.ts";

/**
 * Test-only `EditorDocumentHost` decorator whose subscribed listener
 * disposes the mount, SYNCHRONOUSLY, the FIRST time the host notifies —
 * before forwarding to the real listener.
 *
 * `MemoryDocumentHost.applyEdit` (`src/core/memory-host.ts`) notifies every
 * subscriber synchronously on success, BEFORE `applyEdit` itself returns to
 * its caller. `mountEditor`'s own internal wiring is the host's ONLY
 * subscriber in this driver. So: a real keystroke drives the mount's own
 * `host.applyEdit(edit)` call; that call's synchronous success notification
 * fires back into the mount's own listener; if THAT listener disposes the
 * mount, the mount is torn down re-entrantly, from inside the very
 * `applyEdit` call stack it itself started — the SFE-P2a round-1 repair's
 * reproduction of the P1a "a re-entrant host notification that disposes the
 * mount during applyEdit does not resurrect DOM or fire diagnostics" case
 * against the real fork surface (its own coverage was dropped when
 * `tests/web/support/racy-host.ts` was deleted with this run's mount swap,
 * and the moved-assertion table incorrectly claimed it was superseded —
 * see `mount.btest.ts`'s own header for the correction).
 */
export function withDisposeOnFirstNotify(
  host: EditorDocumentHost,
  disposeMount: () => void,
): EditorDocumentHost {
  let fired = false;
  return {
    getSnapshot: () => host.getSnapshot(),
    applyEdit: (edit) => host.applyEdit(edit),
    replaceExternal: (text) => host.replaceExternal(text),
    subscribe(listener) {
      return host.subscribe((snapshot) => {
        if (!fired) {
          fired = true;
          disposeMount();
        }
        listener(snapshot);
      });
    },
  };
}
