import { MemoryDocumentHost } from "../../../src/core/index.ts";
import type {
  ApplyEditResult,
  DocumentSnapshot,
  EditorDocumentHost,
  SourceEdit,
} from "../../../src/core/index.ts";

/**
 * Test-only `EditorDocumentHost` whose `applyEdit` ALWAYS rejects with a
 * fixed `reason`, regardless of the edit submitted.
 *
 * Real typing in the fork surface `mountEditor` mounts (SFE-P2a) can never
 * organically produce an out-of-range edit either — `EditorModel`'s own
 * edit computation, converted by `../../../src/vscode-adapter/convert.ts`'s
 * `stringEditToSourceEdit`, always derives `[from, to)` from the model's own
 * valid replacement ranges — so ordinary typing can never exercise the
 * mount's `EDITOR_INVALID_RANGE` diagnostic path on its own. This host lets
 * a test exercise that path directly, against the real `EditorDocumentHost`
 * interface, without reaching into mount.ts's internals. `getSnapshot`,
 * `subscribe`, and `replaceExternal` behave like a real `MemoryDocumentHost`
 * (so re-render/version behavior is still observable); only `applyEdit` is
 * overridden.
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
