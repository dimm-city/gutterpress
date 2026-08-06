/**
 * Line→offset resolution for `data-source-range` (inline-editing plan §2.3).
 *
 * PWA-clean (CLAUDE.md §8 / ADR 0004): zero `node:*` / `fs` / `path` / `url`
 * imports, zero runtime imports from `gutterpress`. This is a pure, unit-
 * testable module the SPA resolves a rendered block's `data-source-range`
 * against `buffer.content` at the moment it needs character offsets (menu
 * open, overlay open, commit) — never at render time, because line indices
 * (not char offsets) are what stays stable across LF/CRLF/lone-CR line
 * endings; see docs/inline-editing-plan.md §1 principle 4 / §2.6.
 */

/**
 * Build a line-start offset table for `text`, using the SAME line-break
 * regex markdown-it's `normalize` core rule effectively parses against
 * (`\r\n?|\n` — CRLF, lone CR, or LF all count as one line break).
 *
 * `starts[i]` is the character offset where 0-based line `i` begins;
 * `starts.length === ` (number of lines in `text`, counting a trailing
 * partial/empty line after a final newline as its own line-start entry).
 *
 * MUST use `/\r\n?|\n/g` verbatim — a naive `text.split("\n")` line table
 * breaks on lone-`\r` (old-Mac) line endings: markdown-it still parses such
 * a file into multiple lines, but a `\n`-only scanner sees one line, and
 * offsets resolved against it go out of bounds.
 */
export function buildLineStarts(text: string): number[] {
  const starts = [0];
  const re = /\r\n?|\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) starts.push(m.index + m[0].length);
  return starts;
}

/**
 * Resolve a `data-source-range` line range `[from, to)` (markdown-it's
 * `token.map` convention — 0-based, half-open) to a `[from, to)` CHARACTER
 * offset range in `text`, using the line-start table from
 * {@link buildLineStarts}.
 *
 * Clamps `to`: a line index at or past `starts.length` (the last block in a
 * file with no trailing newline; the last item of a list; a block
 * immediately followed by EOF) resolves to `text.length` rather than
 * indexing out of bounds.
 *
 * THROWS — does not clamp — on a malformed range: non-finite endpoints,
 * negative `from`, or `to < from`. A malformed range must abort the calling
 * action ("fail safe, not fail wrong" — plan §1 principle 3), never silently
 * "work" against the wrong slice of text.
 */
export function charRange(
  text: string,
  starts: number[],
  range: [number, number],
): [number, number] {
  const [from, to] = range;

  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    throw new Error(`charRange: non-finite range [${from}, ${to})`);
  }
  if (from < 0) {
    throw new Error(`charRange: negative start ${from}`);
  }
  if (to < from) {
    throw new Error(`charRange: inverted range [${from}, ${to})`);
  }

  const fromOffset = from < starts.length ? starts[from]! : text.length;
  const toOffset = to < starts.length ? starts[to]! : text.length;

  return [fromOffset, toOffset];
}
