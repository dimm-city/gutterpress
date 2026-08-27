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
