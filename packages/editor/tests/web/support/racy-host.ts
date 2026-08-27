import type { ApplyEditResult, EditorDocumentHost, SourceEdit } from "../../../src/core/index.ts";

/**
 * Test-only `EditorDocumentHost` decorator that deterministically
 * reproduces the run spec's "Stale edit (`expectedVersion` mismatch)"
 * behavior-table row — an external replacement landing between the mount's
 * read of the current version and its submission of an edit against that
 * version — in a single-threaded test, with no timers and no real
 * concurrency.
 *
 * Why this is needed rather than just calling `host.replaceExternal(...)`
 * directly from a test: `mountEditor` subscribes to the host and resyncs
 * its own cached `{ text, version }` synchronously on EVERY notification
 * (D2/D7 — "External changes replace or patch the authoritative snapshot,
 * then update mounted views"). That means a plain, single-mount,
 * single-threaded test can never observe staleness through the mount's
 * ordinary flow: any `replaceExternal` call the test makes BEFORE
 * triggering an "input" event is already reflected in the mount's cached
 * version by the time that input event's handler runs, so the edit it
 * submits is never stale — which is correct, intended behavior, not a gap.
 *
 * This wrapper instead injects the interleaving at the one seam that
 * matters: `applyEdit` — the call `mountEditor`'s "submit" step makes. The
 * FIRST time `applyEdit` is called (i.e. once the mount has already done
 * its "read" — captured the version it's about to submit against — and is
 * now submitting), this wrapper first calls the real host's
 * `replaceExternal(interleavedText)` (simulating another actor's change
 * landing first, which also synchronously notifies the mount's subscriber
 * and resyncs its DISPLAY — but not the `expectedVersion` already baked
 * into the edit object the mount is mid-call with), THEN forwards the
 * caller's original edit — now stale relative to the version
 * `replaceExternal` just produced — to the real host. `getSnapshot`,
 * `subscribe`, and `replaceExternal` all delegate directly.
 */
export function wrapWithOneTimeInterleavedReplacement(
  host: EditorDocumentHost,
  interleavedText: string,
): EditorDocumentHost {
  let armed = true;
  return {
    getSnapshot: () => host.getSnapshot(),
    subscribe: (listener) => host.subscribe(listener),
    replaceExternal: (text) => host.replaceExternal(text),
    applyEdit(edit: SourceEdit): ApplyEditResult {
      if (armed) {
        armed = false;
        host.replaceExternal(interleavedText);
      }
      return host.applyEdit(edit);
    },
  };
}
