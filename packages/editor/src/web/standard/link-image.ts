/**
 * `insert-link {href, text?}` / `insert-image {src, alt?}` (SFE-P2a Lane B,
 * run spec "Command list": "insert-link/insert-image insert
 * [text](href)/![alt](src) at the caret or wrap the selection as the
 * text").
 *
 * Caret-only convention (documented per this run's general rule): when
 * `text`/`alt` is omitted, a non-empty CURRENT selection supplies it
 * (wrapping the selection as the link/image text, per the spec sentence
 * above); an empty selection with no override falls back to a generic
 * placeholder (`"text"`/`""`) rather than refusing — the caller is expected
 * to supply `text`/`alt` explicitly whenever it has one (e.g. desktop's
 * `toolbar-actions.ts` mapping for `insert-link` always passes an explicit
 * `text`, matching its own pre-existing `applyLink` placeholder exactly —
 * see this run's report for the mapping).
 */
import type { ComputedEdit } from "./wrap-inline.ts";

const DEFAULT_LINK_TEXT = "text";

export function computeInsertLink(
  text: string,
  start: number,
  endExclusive: number,
  href: string,
  overrideText?: string,
): ComputedEdit {
  const selected = text.slice(start, endExclusive);
  const linkText = overrideText ?? (selected.length > 0 ? selected : DEFAULT_LINK_TEXT);
  return { from: start, to: endExclusive, insert: `[${linkText}](${href})` };
}

export function computeInsertImage(
  text: string,
  start: number,
  endExclusive: number,
  src: string,
  overrideAlt?: string,
): ComputedEdit {
  const selected = text.slice(start, endExclusive);
  const alt = overrideAlt ?? (selected.length > 0 ? selected : "");
  return { from: start, to: endExclusive, insert: `![${alt}](${src})` };
}
