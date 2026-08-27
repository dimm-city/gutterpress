import type { StringEdit } from "@vscode/markdown-editor";
import type { SourceEdit } from "../core/index.ts";

/**
 * SFE-P1b Lane A — pure `StringEdit` -> D3 `SourceEdit` conversion.
 *
 * `@vscode/markdown-editor`'s `EditorModel` reports every edit it is about
 * to apply to itself as a `StringEdit` (`onWillApplySourceEdit`, see
 * adapter.ts) — an ordered, non-overlapping list of `StringReplacement`s,
 * each an exact `[start, endExclusive)` range plus its replacement text.
 * The D3 contract (docs/plans/source-first-editor-enterprise-refactor.md)
 * this package's `EditorDocumentHost.applyEdit` accepts is a SINGLE
 * `[from, to)` replacement, not a batch:
 *
 *   "A command requiring multiple source changes must return one
 *   replacement spanning the smallest safe common source range."
 *
 * `stringEditToSourceEdit` is that collapse: the combined range runs from
 * the FIRST replacement's `start` to the LAST replacement's `endExclusive`
 * (against `originalText` — the text as it stood immediately before this
 * edit, i.e. what the host's `expectedVersion` still describes), and the
 * combined `insert` string is built by walking the replacements in order,
 * copying each UNCHANGED gap between consecutive replacements verbatim from
 * `originalText` and splicing in each replacement's own `newText` between
 * gaps. The result is byte-identical to applying every replacement
 * individually, but expressed as the one `[from, to)` + `insert` D3 shape.
 *
 * Deliberately a pure, DOM-free, browser-free function — extracted here
 * specifically so the offset/gap-filling arithmetic is unit-testable
 * (tests/vscode-adapter/convert.test.ts) without a browser or the real
 * `EditorModel`/`EditorView`. `StringEdit`/`StringReplacement`/`OffsetRange`
 * are plain data classes with no DOM dependency (verified against the
 * package's own `dist/index.d.ts`), so importing the TYPE here does not
 * pull DOM types into this file's surface.
 */
export function stringEditToSourceEdit(
  originalText: string,
  edit: StringEdit,
  expectedVersion: number,
): SourceEdit {
  const replacements = edit.replacements;

  // `EditorModel.onWillApplySourceEdit` fires "immediately before a
  // model-owned source edit is applied" — an edit with zero replacements
  // changes nothing, so no real caller should ever reach here with one. If
  // it ever does (a future package version, a synthetic test event, ...),
  // collapse it to a genuine no-op SourceEdit (an empty insert at the
  // start of the document) rather than reading `replacements[0]` off an
  // empty array.
  if (replacements.length === 0) {
    return { from: 0, to: 0, insert: "", expectedVersion };
  }

  const first = replacements[0]!;
  const last = replacements[replacements.length - 1]!;
  const from = first.replaceRange.start;
  const to = last.replaceRange.endExclusive;

  let insert = "";
  let cursor = from;
  for (const replacement of replacements) {
    // The unchanged span between the previous replacement's end (or `from`,
    // for the first iteration) and this replacement's own start must be
    // copied through verbatim — it is real, untouched original text that
    // now falls INSIDE the combined [from, to) range.
    insert += originalText.slice(cursor, replacement.replaceRange.start);
    insert += replacement.newText;
    cursor = replacement.replaceRange.endExclusive;
  }

  return { from, to, insert, expectedVersion };
}
