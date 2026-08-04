/**
 * selection-search.ts — rendered-text → markdown-source matching for the
 * preview context menu's selection-formatting row (inline-editing plan §4.6,
 * PR 4).
 *
 * The preview only gives us RENDERED text (`selection.toString()`, carried
 * as `ContextTargetSelection.text` across the bridge). To wrap a selected
 * phrase in `**…**` (etc.) we must locate that text inside the block's
 * MARKDOWN SOURCE — a slice of the editor buffer. Rendered text and source
 * text differ in three ways, all handled here:
 *
 *   1. Whitespace — authors hard-wrap prose, so a selection spanning a
 *      source line break renders with a single space where the source has a
 *      `\n` (plus possible leading indentation on the continuation line).
 *   2. Typographer substitutions — `typographer: true` rewrites quotes,
 *      dashes, and a handful of ASCII sequences into Unicode glyphs.
 *   3. Inline formatting delimiters — `selection.toString()` never contains
 *      `**`/`_`/`` ` ``/link syntax, so a selection spanning an
 *      already-formatted span (e.g. "a **bold** word" rendering as
 *      "a bold word") can only be found in source once the delimiters are
 *      stripped from the search haystack.
 *
 * Pure string functions — zero DOM / `node:*` / lib value imports, testable
 * directly under `bun test` (CLAUDE.md §8 / ADR 0004).
 *
 * FAIL SAFE, NOT FAIL WRONG (plan §1 principle 3): every ambiguous case
 * (zero matches, multiple matches, un-reversible typographer collapses,
 * code/link syntax in the matched region, same-delimiter nesting) resolves
 * to "couldn't locate this text — disable the item", never a guessed edit.
 */

/** Reverse map of markdown-it's typographer substitutions, keyed one raw
 *  Unicode character at a time (each key below is exactly one character, so
 *  there is no overlap/ordering ambiguity between entries).
 *
 *  Sourced by reading `markdown-it@14.3.0`'s
 *  `lib/rules_core/replacements.mjs` and `lib/rules_core/smartquotes.mjs`
 *  directly (see the PR report for the full rule-by-rule derivation) against
 *  this project's renderer options (`html:true, linkify:true,
 *  typographer:true`, default `quotes: "“”‘’"` — no
 *  override in `renderer.ts`). There is NO NBSP rule in either file — do not
 *  add one.
 *
 *  Deliberately excluded (handled instead by {@link hasAmbiguousTypography}):
 *  the collapsed-punctuation rules (`\.{2,}` → `…`, `([?!]){4,}` → 3 copies,
 *  `,{2,}` → `,`) are one-to-many forward transforms — the *count* of the
 *  original run is unrecoverable from the rendered glyph, so reversing them
 *  would be a guess. Em/en dash and the scoped abbreviations, by contrast,
 *  are exactly one-to-one and safe to reverse deterministically. */
const TYPOGRAPHER_REVERSE: ReadonlyArray<readonly [string, string]> = [
  ["©", "(c)"], // ©
  ["™", "(tm)"], // ™
  ["®", "(r)"], // ®
  ["±", "+-"], // ±
  ["—", "---"], // — em dash
  ["–", "--"], // – en dash
  ["“", '"'], // “
  ["”", '"'], // ”
  ["‘", "'"], // ‘
  ["’", "'"], // ’ (also the mid-word apostrophe substitution)
];

const TYPOGRAPHER_LOOKUP = new Map(TYPOGRAPHER_REVERSE);

function isWhitespaceChar(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\r" || ch === "\n";
}

export interface NormalizeResult {
  normalized: string;
  /**
   * `indexMap[i]` is the raw-string offset that normalized position `i`
   * originated from. Length is always `normalized.length + 1` — the extra
   * trailing entry (`indexMap[normalized.length]`) is `raw.length`, so a
   * match ending at the normalized string's end resolves to the true end of
   * the raw string rather than being left undefined.
   */
  indexMap: number[];
}

/**
 * Collapse whitespace + reverse typographer substitutions + optionally
 * strip inline formatting delimiters, producing a normalized string plus an
 * index map from normalized offsets back to raw offsets (plan §4.6).
 *
 * Order of operations at each raw position (first match wins): typographer
 * reverse (single raw char → one-or-more normalized chars) → whitespace run
 * collapse (`[ \t\r\n]+` → one space) → delimiter strip (`stripDelimiters`
 * only: `**`, `__`, `*`, `_` unconditionally; `~~` only as a pair — a lone
 * `~` is not a valid strikethrough delimiter and is left alone) → verbatim
 * copy.
 *
 * Delimiter stripping is deliberately unconditional per-character (it does
 * not distinguish an intraword `_` from a real emphasis delimiter): this can
 * only make the search MISS a match it should have found (a safe
 * degrade — "couldn't locate uniquely"), never manufacture a match at the
 * wrong location, because {@link findUniqueRange}'s uniqueness check is the
 * final backstop either way.
 */
export function normalizeForSearch(
  raw: string,
  opts: { stripDelimiters: boolean },
): NormalizeResult {
  let normalized = "";
  const indexMap: number[] = [];
  const n = raw.length;
  let i = 0;

  while (i < n) {
    const ch = raw[i]!;

    const typo = TYPOGRAPHER_LOOKUP.get(ch);
    if (typo !== undefined) {
      for (let k = 0; k < typo.length; k++) {
        normalized += typo[k];
        indexMap.push(i);
      }
      i += 1;
      continue;
    }

    if (isWhitespaceChar(ch)) {
      const start = i;
      while (i < n && isWhitespaceChar(raw[i]!)) i++;
      normalized += " ";
      indexMap.push(start);
      continue;
    }

    if (opts.stripDelimiters) {
      if (ch === "~" && raw[i + 1] === "~") {
        i += 2;
        continue;
      }
      if (ch === "*" || ch === "_") {
        i += 1;
        continue;
      }
    }

    normalized += ch;
    indexMap.push(i);
    i += 1;
  }

  indexMap.push(n);
  return { normalized, indexMap };
}

/**
 * Case-SENSITIVE search of `needleNormalized` in `haystack.normalized`.
 * Returns the raw `[from, to)` range (resolved through `haystack.indexMap`)
 * iff EXACTLY ONE match exists. The search is overlap-aware (advances by 1,
 * not by needle length) so overlapping or substring/superstring duplicate
 * occurrences both count toward ambiguity — neither is deduplicated or
 * treated as a special case. Zero or 2+ matches → `null` (ambiguous).
 */
export function findUniqueRange(
  needleNormalized: string,
  haystack: NormalizeResult,
): [number, number] | null {
  if (!needleNormalized) return null;
  const { normalized, indexMap } = haystack;

  let firstIdx = -1;
  let idx = normalized.indexOf(needleNormalized);
  let count = 0;
  while (idx !== -1) {
    count++;
    if (count === 1) firstIdx = idx;
    if (count > 1) break; // ambiguous — no need to keep scanning
    idx = normalized.indexOf(needleNormalized, idx + 1);
  }
  if (count !== 1) return null;

  const start = firstIdx;
  const end = start + needleNormalized.length;
  const rawFrom = indexMap[start];
  const rawTo = indexMap[end];
  if (rawFrom === undefined || rawTo === undefined) return null;
  return [rawFrom, rawTo];
}

/**
 * True when `text` (the RENDERED selection text, before normalization)
 * contains a collapsed-punctuation artifact that cannot be safely reversed:
 * the forward transforms (`\.{2,}` → `…`, downgraded to literal `..` after
 * `?`/`!`; `([?!]){4,}` → 3 copies of one char; `,{2,}` → a single `,`) are
 * one-to-many, so the original run length is unrecoverable from the
 * rendered glyph alone. Any occurrence in the needle marks the whole search
 * ambiguous (plan §4.6) — callers must check this BEFORE searching, not
 * guess an expansion.
 */
export function hasAmbiguousTypography(text: string): boolean {
  return (
    /…/.test(text) || // … ellipsis (2+ dots elsewhere in the run)
    /[?!]\.\./.test(text) || // ellipsis downgraded to ".." after ? or !
    /!!!/.test(text) || // 4+ "!" collapsed to exactly 3
    /\?\?\?/.test(text) || // 4+ "?" collapsed to exactly 3
    /,/.test(text) // 2+ "," collapsed to a single ","
  );
}

/**
 * True when `matchedRawText` (the matched region of the RAW SOURCE, not the
 * normalized search text) contains a backtick or `[…](` link syntax. Code
 * spans render escaped text and link text/URL duality is ambiguous — plan
 * §4.6 says never fuzzy-match those; every formatting action is disabled
 * when this is true, not just "Inline code" / "Make link…".
 *
 * This alone is NOT sufficient as the guardrail — see
 * {@link touchesStructuralSyntax} for why a match can land entirely INSIDE a
 * code span or link without this ever seeing a backtick/bracket. Exported
 * for direct unit coverage of the literal-substring case.
 */
export function hasBacktickOrLinkSyntax(matchedRawText: string): boolean {
  return /`/.test(matchedRawText) || /\[[^\]]*\]\(/.test(matchedRawText);
}

/**
 * True when the `[start, end)` raw region — matched inside `blockSlice` —
 * is a code span or markdown link, OR falls entirely INSIDE one, even when
 * neither delimiter is present in the matched text itself.
 *
 * This is the load-bearing half of the backtick/link guardrail (plan §4.6):
 * backticks are deliberately NOT part of {@link normalizeForSearch}'s
 * delimiter-stripping set (a code span's rendered text is not guaranteed to
 * round-trip through its raw form the way `**`/`_`/`~~` emphasis runs are —
 * escaping differences are possible), so a substring search naturally finds
 * ZERO matches for any selection that crosses a code-span/link BOUNDARY —
 * {@link hasBacktickOrLinkSyntax} alone already blocks those, because the
 * matched text includes the backtick or bracket.
 *
 * But a selection landing entirely WITHIN a code span's or link's visible
 * text (e.g. selecting just "code" out of `` `code` ``, or just "hello" out
 * of `[hello](url)`) DOES match as a plain substring — the delimiters are
 * immediately adjacent to, not inside, `[start, end)` — and
 * {@link hasBacktickOrLinkSyntax} would see no backtick/bracket in the
 * matched text and wave it through. Wrapping that inner text in `**…**`
 * would silently corrupt the code span (backticks never parse nested
 * markdown — the visible result would literally show `**code**` as code,
 * not bold) or, for links, nest an invalid link inside a link's text. This
 * is exactly the "wrong region match slips past a guardrail" failure class
 * plan §1 principle 3 exists to prevent — REVIEW THIS FUNCTION CAREFULLY.
 *
 * Code-span detection pairs backtick runs `` `+ `` two at a time (open,
 * close) in document order — a simple proxy for CommonMark's actual
 * same-length-fence-matching rule. A mismatched-length pairing only makes
 * this MORE conservative (flags a false positive), never less (plan §1
 * principle 3 — a missed block would be the dangerous direction, not an
 * extra one). Link-text detection blocks landing anywhere inside `[text](`
 * even though nesting bold/italic in link text is valid CommonMark —
 * uniform, conservative treatment matching the code-span case, because
 * "Make link…" specifically would create an invalid nested link there.
 */
export function touchesStructuralSyntax(blockSlice: string, start: number, end: number): boolean {
  if (hasBacktickOrLinkSyntax(blockSlice.slice(start, end))) return true;

  const codeRunRe = /`+/g;
  const runs: Array<[number, number]> = [];
  let m: RegExpExecArray | null;
  while ((m = codeRunRe.exec(blockSlice))) runs.push([m.index, m.index + m[0].length]);
  for (let i = 0; i + 1 < runs.length; i += 2) {
    const openEnd = runs[i]![1];
    const closeStart = runs[i + 1]![0];
    if (start < closeStart && end > openEnd) return true;
  }

  const linkRe = /\[([^\]]*)\]\(/g;
  while ((m = linkRe.exec(blockSlice))) {
    const textStart = m.index + 1;
    const textEnd = textStart + m[1]!.length;
    if (start < textEnd && end > textStart) return true;
  }

  return false;
}

export type FormatKind = "bold" | "italic" | "strike" | "code";

/**
 * True when `matchedRawText` already contains the SAME delimiter the
 * caller is about to wrap it in — nesting identical emphasis is invalid
 * markdown (plan §4.6). A DIFFERENT delimiter is fine and is not checked
 * here: bolding `a *b* c` → `**a *b* c**` is valid, so `hasSameDelimiter`
 * for `"bold"` only looks for `**`/`__`, never a lone `*`/`_`.
 */
export function hasSameDelimiter(matchedRawText: string, kind: FormatKind): boolean {
  switch (kind) {
    case "bold":
      return /\*\*|__/.test(matchedRawText);
    case "italic":
      // A standalone single `*` or `_` — i.e. not immediately adjacent to
      // another copy of itself, which would make it part of a `**`/`__` run
      // instead (bold, a DIFFERENT delimiter, and not a conflict here).
      return (
        /(?:^|[^*])\*(?:[^*]|$)/.test(matchedRawText) ||
        /(?:^|[^_])_(?:[^_]|$)/.test(matchedRawText)
      );
    case "strike":
      return /~~/.test(matchedRawText);
    case "code":
      return /`/.test(matchedRawText);
  }
}

/** Wrap `text` in the markdown delimiter pair for `kind`. */
export function wrapDelimiter(text: string, kind: FormatKind): string {
  switch (kind) {
    case "bold":
      return `**${text}**`;
    case "italic":
      return `*${text}*`;
    case "strike":
      return `~~${text}~~`;
    case "code":
      return `\`${text}\``;
  }
}

export interface SelectionMatch {
  /** Raw offset in `blockSlice` where the matched region starts. */
  start: number;
  /** Raw offset in `blockSlice` where the matched region ends (exclusive). */
  end: number;
  /** `blockSlice.slice(start, end)` — the exact raw source text matched. */
  matchedText: string;
}

/**
 * Locate the rendered `selectionText` inside `blockSlice` (the block's raw
 * markdown source), applying whitespace collapse, typographer reversal, and
 * delimiter stripping on the source side (plan §4.6). Returns `null` when
 * the match is ambiguous for any reason: empty/whitespace-only selection,
 * an unreversible collapsed-punctuation artifact in the rendered text
 * ({@link hasAmbiguousTypography}), or zero/multiple matches
 * ({@link findUniqueRange}).
 *
 * Does NOT apply the backtick/link-syntax or same-delimiter guardrails —
 * those depend on which formatting action is being offered and are the
 * caller's responsibility (menu-item construction), checked against the
 * returned `matchedText`.
 */
export function locateSelectionInSource(
  blockSlice: string,
  selectionText: string,
): SelectionMatch | null {
  if (!selectionText.trim()) return null;
  if (hasAmbiguousTypography(selectionText)) return null;

  const haystack = normalizeForSearch(blockSlice, { stripDelimiters: true });
  const needle = normalizeForSearch(selectionText, { stripDelimiters: false }).normalized;
  const range = findUniqueRange(needle, haystack);
  if (!range) return null;

  const [start, end] = range;
  return { start, end, matchedText: blockSlice.slice(start, end) };
}
