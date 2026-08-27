import type { SourceEdit } from "../core/index.ts";

/**
 * Computes the smallest `[from, to)` replacement that turns `oldText` into
 * `newText`, expressed as a `SourceEdit` bound to `expectedVersion`.
 *
 * D3 (docs/plans/source-first-editor-enterprise-refactor.md): "A command
 * requiring multiple source changes must return one replacement spanning the
 * smallest safe common source range." A plain `<textarea>`'s native "input"
 * event only ever hands back the FULL new value, never a structured
 * before/after diff, so this is the mount's one and only translation from
 * "the user changed this box's text" to an explicit `SourceEdit` — every
 * keystroke, paste, cut, and IME commit funnels through here.
 *
 * The scan walks `oldText`/`newText` by index exactly the way
 * `String.prototype.slice` does (UTF-16 code units, D1) — a boundary that
 * happens to land inside a surrogate pair or combining mark is handled
 * identically to plain JS string slicing, never special-cased, matching
 * apply-edit.ts's own contract ("splitting a surrogate pair ... is neither
 * special-cased nor rejected").
 */
export function computeMinimalEdit(
  oldText: string,
  newText: string,
  expectedVersion: number,
): SourceEdit {
  const oldLen = oldText.length;
  const newLen = newText.length;
  const maxCommon = Math.min(oldLen, newLen);

  let prefix = 0;
  while (prefix < maxCommon && oldText.charCodeAt(prefix) === newText.charCodeAt(prefix)) {
    prefix++;
  }

  // Bounded by `maxCommon - prefix` so the prefix/suffix scans can never
  // overlap (e.g. oldText "aaa" -> newText "aaaa" must not let a naive
  // unbounded suffix scan walk back past where the prefix scan already
  // claimed).
  let suffix = 0;
  const maxSuffix = maxCommon - prefix;
  while (
    suffix < maxSuffix &&
    oldText.charCodeAt(oldLen - 1 - suffix) === newText.charCodeAt(newLen - 1 - suffix)
  ) {
    suffix++;
  }

  return {
    from: prefix,
    to: oldLen - suffix,
    insert: newText.slice(prefix, newLen - suffix),
    expectedVersion,
  };
}
