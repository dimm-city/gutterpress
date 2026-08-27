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
 * immediately precedes `start` AND immediately follows `endExclusive`. The
 * FIRST matching spelling wins (canonical checked first, so `**text**`
 * toggles off as `**`, never accidentally treated as some other spelling).
 * No match at all falls through to toggle-ON with the canonical spelling.
 */
export function wrapInline(
  text: string,
  start: number,
  endExclusive: number,
  spec: WrapSpec,
): ComputedEdit {
  for (const marker of spec.spellings) {
    const len = marker.length;
    const before = text.slice(Math.max(0, start - len), start);
    const after = text.slice(endExclusive, Math.min(text.length, endExclusive + len));
    if (before === marker && after === marker) {
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
 * `wrapInline` uses, so `commandState(...).active` and what `wrapInline`
 * will actually do next never disagree.
 */
export function isWrapped(text: string, start: number, endExclusive: number, spec: WrapSpec): boolean {
  return spec.spellings.some((marker) => {
    const len = marker.length;
    const before = text.slice(Math.max(0, start - len), start);
    const after = text.slice(endExclusive, Math.min(text.length, endExclusive + len));
    return before === marker && after === marker;
  });
}
