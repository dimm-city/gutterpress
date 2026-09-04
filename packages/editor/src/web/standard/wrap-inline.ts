/**
 * Inline-wrap toggle math for `toggle-bold` / `toggle-italic` / `toggle-strike`
 * / `toggle-inline-code` (SFE-P2a Lane B, run spec "Command list" +
 * "Toggle semantics"). Pure string math against the CURRENT snapshot text —
 * no DOM, no host (D2/D3).
 *
 * One function (`wrapInline`) covers all four combinations of {caret-only,
 * non-empty selection} x {toggle-on, toggle-off} — see its own doc comment
 * for why the four cases collapse into one code path.
 */

/** The `[from, to)` replacement a wrap/unwrap computes, before
 *  `expectedVersion` is attached by the caller (the dispatcher in
 *  `apply-command.ts`, which is the one place `snapshot.version` is read). */
export interface ComputedEdit {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

export interface WrapSpec {
  /** Spelling `wrapInline` writes on toggle-ON. */
  readonly canonical: string;
  /**
   * Every spelling `wrapInline` recognizes for toggle-OFF detection,
   * canonical FIRST. Run spec ("Toggle semantics"): "toggle-off removes
   * exactly ... the exact spelling that is present, e.g. `__bold__` vs
   * `**bold**`" — a command whose author-facing family has more than one
   * live Markdown spelling (bold: `**`/`__`; italic: `*`/`_`) must detect
   * and remove WHICHEVER one actually wraps the selection, not just the
   * canonical one. Strikethrough and inline code have no second common
   * spelling in Gutterpress's supported dialect, so their spec lists a
   * single entry.
   */
  readonly spellings: readonly string[];
}

export const BOLD_SPEC: WrapSpec = { canonical: "**", spellings: ["**", "__"] };
export const ITALIC_SPEC: WrapSpec = { canonical: "*", spellings: ["*", "_"] };
export const STRIKE_SPEC: WrapSpec = { canonical: "~~", spellings: ["~~"] };
export const INLINE_CODE_SPEC: WrapSpec = { canonical: "`", spellings: ["`"] };

/**
 * `*`/`_` are single-character, REPEATABLE emphasis markers: a run of TWO of
 * either is a completely different, longer marker (`**`/`__`, this module's
 * own `BOLD_SPEC` canonical/alt spellings) — not two overlapping matches of
 * the one-character spelling. Detecting only the ONE marker character
 * immediately outside a selection cannot tell "wrapped by `*`" from
 * "wrapped by `**`, and this is just its outer half" apart; see
 * `matchesSpelling`'s use of this below.
 */
function isEmphasisChar(marker: string): boolean {
  return marker === "*" || marker === "_";
}

/** Count of consecutive `char` characters in `text`, starting at `boundary`
 *  and moving in `direction` (`-1`: scan backward from `boundary - 1`,
 *  toward document start; `1`: scan forward from `boundary`, toward
 *  document end). Used only for the emphasis-run parity check below. */
function runLength(text: string, boundary: number, direction: -1 | 1, char: string): number {
  let count = 0;
  let i = direction === -1 ? boundary - 1 : boundary;
  while (i >= 0 && i < text.length && text[i] === char) {
    count++;
    i += direction;
  }
  return count;
}

/**
 * Whether `marker` (length `len`) sits immediately outside `[start,
 * endExclusive)` on BOTH sides — the shared "is this spelling the wrap
 * here" check `wrapInline` and `isWrapped` both need, kept in exactly one
 * place so they can never disagree (see `isWrapped`'s own doc comment).
 *
 * For a repeatable single-character spelling (`*`/`_`), matching just the
 * one adjacent character is not enough: a run of `*`/`_` touching the
 * selection may be longer than one, and Markdown groups a same-character
 * run into COMPLETE `**`/`__`-style PAIRS from the outside in, with at most
 * one single character left over closest to the content. An EVEN-length run
 * (2, 4, ...) has nothing left over — the boundary belongs entirely to the
 * longer marker family (`**`/`__`, a DIFFERENT command's canonical
 * spelling), never to this one-character spelling. An ODD-length run (1, 3,
 * ...) leaves exactly the innermost character for this spelling, with the
 * rest forming complete pairs untouched by this match. Without this check,
 * `toggle-italic` misread `**bold**`'s outer `*` half (a run of 2, entirely
 * bold's) as its own `*` wrap and toggled it OFF, destroying the author's
 * bold (see this function's callers' regression tests). `***x***`
 * (bold+italic together, a run of 3) still toggles italic correctly: the
 * innermost `*` is a legitimate 1-length leftover, so it matches, and
 * stripping it leaves the complete `**` pair (bold) untouched.
 */
function matchesSpelling(text: string, start: number, endExclusive: number, marker: string): boolean {
  const len = marker.length;
  const before = text.slice(Math.max(0, start - len), start);
  const after = text.slice(endExclusive, Math.min(text.length, endExclusive + len));
  if (before !== marker || after !== marker) return false;
  if (isEmphasisChar(marker)) {
    const beforeRun = runLength(text, start, -1, marker);
    const afterRun = runLength(text, endExclusive, 1, marker);
    if (beforeRun % 2 === 0 || afterRun % 2 === 0) return false;
  }
  return true;
}

/**
 * Computes the wrap/unwrap edit for `[start, endExclusive)` under `spec`.
 *
 * Caret-only convention (run spec: "caret-only (empty selection): insert
 * the delimiter pair and note the caret-inside convention in the returned
 * edit's insert, documented per command"): when `start === endExclusive`,
 * the four cases below still apply correctly because `text.slice(start,
 * endExclusive)` is `""` — toggle-ON degenerates to inserting
 * `canonical + "" + canonical` (the delimiter pair with nothing between —
 * "caret between the two markers" is the resulting document shape once the
 * caller places its cursor at `edit.from + spec.canonical.length`, which
 * every mapped caller in this run does), and toggle-OFF still fires when the
 * caret sits directly between an already-adjacent marker pair (mirrors
 * desktop `toolbar-actions.ts`'s pre-existing "don't pile up marker debris
 * on repeated empty-selection toggles" fix — see `toggleInlineWrap`'s own
 * header comment there) — this is exactly the idempotence the run spec
 * calls out as "THE critical assertion": toggle-on then toggle-off, both at
 * the same caret position, restores the original bytes.
 *
 * One loop over `spec.spellings` handles both toggle directions and both
 * selection shapes: for each candidate spelling, check whether it
 * immediately precedes `start` AND immediately follows `endExclusive` (via
 * `matchesSpelling`, which also rejects a single-character spelling that is
 * really the outer half of a LONGER same-character marker — see its own doc
 * comment). The FIRST matching spelling wins (canonical checked first, so
 * `**text**` toggles off as `**`, never accidentally treated as some other
 * spelling). No match at all falls through to toggle-ON with the canonical
 * spelling.
 */
export function wrapInline(
  text: string,
  start: number,
  endExclusive: number,
  spec: WrapSpec,
): ComputedEdit {
  for (const marker of spec.spellings) {
    if (matchesSpelling(text, start, endExclusive, marker)) {
      const len = marker.length;
      return { from: start - len, to: endExclusive + len, insert: text.slice(start, endExclusive) };
    }
  }
  return {
    from: start,
    to: endExclusive,
    insert: spec.canonical + text.slice(start, endExclusive) + spec.canonical,
  };
}

/**
 * Whether `[start, endExclusive)` is CURRENTLY wrapped by one of `spec`'s
 * recognized spellings — the `active` half of `commandState` for a wrap
 * command. Documented precision limit (run spec: "document precision
 * limits honestly, e.g. bold-active detection inside nested emphasis is
 * best-effort"): this checks only the marker pair immediately adjacent to
 * the selection boundaries, exactly what `wrapInline` itself inspects to
 * decide toggle direction — it does not parse surrounding Markdown to
 * confirm the marker pair is a semantically valid emphasis span (e.g. it
 * cannot distinguish `**bold**` from a `**` that is part of unrelated
 * surrounding punctuation). This is deliberately the SAME detection
 * `wrapInline` uses (`matchesSpelling`, shared verbatim — including its
 * longer-run rejection for `*`/`_`, so `**bold**` never reports
 * `toggle-italic` as active either), so `commandState(...).active` and what
 * `wrapInline` will actually do next never disagree.
 */
export function isWrapped(text: string, start: number, endExclusive: number, spec: WrapSpec): boolean {
  return spec.spellings.some((marker) => matchesSpelling(text, start, endExclusive, marker));
}
