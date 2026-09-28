import { MemoryDocumentHost } from "../../../src/core/index.ts";
import type {
  ApplyEditResult,
  DocumentSnapshot,
  EditorDocumentHost,
  SourceEdit,
} from "../../../src/core/index.ts";

/**
 * SFE-P1b Lane A — test-only `EditorDocumentHost` whose `applyEdit` ALWAYS
 * rejects with a fixed `reason`, regardless of the edit submitted.
 *
 * Mirrors `tests/web/support/rejecting-host.ts`'s own pattern (P1a Lane B),
 * kept as this lane's own self-contained copy rather than a cross-lane
 * import — `tests/web/**` belongs to a different lane's write ownership,
 * and this run's write boundary is `tests/vscode-adapter/**` only.
 * `getSnapshot`, `subscribe`, and `replaceExternal` behave like a real
 * `MemoryDocumentHost`, so the adapter's revert-to-authoritative-snapshot
 * path (case: rejection) is exercised against the real `EditorDocumentHost`
 * interface, not a hand-rolled stub.
 */
export function withFixedRejection(
  reason: "stale" | "readonly" | "invalid-range",
  initial: DocumentSnapshot,
): EditorDocumentHost {
  const real = new MemoryDocumentHost(initial);
  return {
    getSnapshot: () => real.getSnapshot(),
    subscribe: (listener) => real.subscribe(listener),
    replaceExternal: (text) => real.replaceExternal(text),
    applyEdit(_edit: SourceEdit): ApplyEditResult {
      return { ok: false, reason, snapshot: real.getSnapshot() };
    },
  };
}

/**
 * SFE-P1b Lane A repair — a host that rejects exactly its FIRST `applyEdit`
 * call as `"stale"`, and in the course of producing that rejection also
 * fires a genuine `replaceExternal` — the two routes the adapter's
 * deferred-revert bug (`adapter.ts`'s rejection-path comment) had to close:
 *
 *   - `"sync"`: `replaceExternal` runs SYNCHRONOUSLY, before `applyEdit`
 *     returns the rejection — the host decides the edit is stale BECAUSE an
 *     external change landed underneath it (route (b): a host that calls
 *     `replaceExternal` synchronously inside `applyEdit`);
 *   - `"microtask"`: `replaceExternal` is scheduled via `queueMicrotask`
 *     DURING the `applyEdit` call, so it actually runs after `applyEdit`
 *     has returned the rejection but before the adapter's own revert
 *     microtask — the desktop file-watcher ordering (route (a): the host
 *     applies an authoritative external replacement in a microtask queued
 *     during `applyEdit`).
 *
 * Every `applyEdit` call after the first behaves like a real
 * `MemoryDocumentHost` (accepts a correctly-versioned edit) — this is what
 * lets a test prove the adapter resyncs `known`'s version correctly, not
 * just that the view eventually shows the right text: the NEXT keystroke
 * after the rejection+external-change must be ACCEPTED, not itself
 * rejected as stale.
 */
export function withRejectOnceThenExternalChange(
  mode: "sync" | "microtask",
  initial: DocumentSnapshot,
  externalText: string,
): EditorDocumentHost {
  const real = new MemoryDocumentHost(initial);
  let firstCall = true;
  return {
    getSnapshot: () => real.getSnapshot(),
    subscribe: (listener) => real.subscribe(listener),
    replaceExternal: (text) => real.replaceExternal(text),
    applyEdit(edit: SourceEdit): ApplyEditResult {
      if (!firstCall) return real.applyEdit(edit);
      firstCall = false;

      if (mode === "sync") {
        real.replaceExternal(externalText);
      } else {
        queueMicrotask(() => real.replaceExternal(externalText));
      }
      // The rejection's own snapshot: for "sync", `real`'s state already
      // reflects the external replacement (mirrors a real host that
      // discovered the concurrent change WHILE deciding the edit was
      // stale); for "microtask", the replacement has not run yet, so this
      // is still the pre-external snapshot — mirrors a host that returns
      // the rejection before its own async external-change plumbing fires.
      return { ok: false, reason: "stale", snapshot: real.getSnapshot() };
    },
  };
}
