import type { ApplyEditResult, DocumentSnapshot, SourceEdit } from "./contracts.ts";

export interface ApplyEditOptions {
  readonly readonly?: boolean;
}

/**
 * Pure implementation of the D3 source-edit contract.
 *
 * Binding check order — readonly -> stale -> invalid-range — documented
 * here because D3 requires every host to reject an edit identically, and
 * the only way to guarantee that is for every host to share this one
 * implementation rather than re-deriving the order independently:
 *
 *   1. readonly FIRST: a readonly host rejects any edit attempt before
 *      considering whether the edit itself would otherwise have been
 *      accepted, so a readonly document never leaks information (via a
 *      different rejection reason) about what it would have done had it
 *      been writable.
 *   2. stale SECOND: an edit against a superseded `expectedVersion` is
 *      rejected before its range is validated, so a caller racing against
 *      concurrent edits gets a uniform "stale" reason rather than a
 *      version-dependent range verdict computed against text it no longer
 *      matches.
 *   3. invalid-range LAST: only once the host is writable and the version
 *      is current do we validate `[from, to)` against the CURRENT text.
 *
 * On any rejection the returned snapshot is the CURRENT, unchanged snapshot
 * (D3: "A stale or invalid edit changes nothing and returns the current
 * snapshot") — never a partial application, never the caller's proposed
 * edit.
 */
export function applyEdit(
  snapshot: DocumentSnapshot,
  edit: SourceEdit,
  options?: ApplyEditOptions,
): ApplyEditResult {
  // Read every field exactly once, up front. `edit` and `snapshot` are not
  // trusted to be plain data — a hostile or merely buggy caller can back
  // `from`/`to`/`insert`/`expectedVersion`/`text`/`version` with accessors
  // that return different values on each read (the same TOCTOU threat
  // validate.ts's own header names as its reason for rejecting accessors).
  // Validating and then re-reading via `edit.from`/`edit.to` would let such
  // an object pass validation against one pair of values and splice against
  // another. Binding every field to a local here closes that gap: every
  // check below and the splice itself observe the same snapshot of values.
  const { from, to, insert, expectedVersion } = edit;
  const { text: currentText, version: currentVersion } = snapshot;

  if (options?.readonly) {
    return { ok: false, reason: "readonly", snapshot };
  }

  if (expectedVersion !== currentVersion) {
    return { ok: false, reason: "stale", snapshot };
  }

  if (!isValidRange(from, to, currentText.length)) {
    return { ok: false, reason: "invalid-range", snapshot };
  }

  // UTF-16 code-unit semantics by construction: this is exactly
  // `String.prototype.slice`, so splitting a surrogate pair or a combining
  // mark is neither special-cased nor rejected — it behaves exactly as
  // plain JavaScript string slicing at these offsets would (D1: offsets are
  // JS/VS Code UTF-16 code-unit offsets).
  const text = currentText.slice(0, from) + insert + currentText.slice(to);

  return {
    ok: true,
    snapshot: { text, version: currentVersion + 1 },
  };
}

/**
 * `0 <= from <= to <= textLength` (D3), with every field required to be a
 * finite integer. `Number.isInteger` alone rejects NaN, +/-Infinity, and
 * any non-integer (fractional) value, so it covers "negative, NaN,
 * non-integer, non-finite" in one guard; the explicit `< 0` and `from > to`
 * / `to > textLength` checks then cover the remaining D3 range rule.
 */
function isValidRange(from: number, to: number, textLength: number): boolean {
  if (!Number.isInteger(from) || !Number.isInteger(to)) return false;
  if (from < 0 || to < 0) return false;
  if (from > to) return false;
  if (to > textLength) return false;
  return true;
}
