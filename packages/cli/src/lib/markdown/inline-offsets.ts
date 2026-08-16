/**
 * `inline_offsets` — pure (node-free) inline-level source coordinates.
 *
 * ## What this is for
 *
 * `source-range.ts` annotates every BLOCK with `data-source-range` (a line
 * range), which is enough to splice a whole block. It deliberately does not
 * descend into inline tokens — its header explains that they "carry no usable
 * per-token `map`" and that annotating them "would blur the intentional 'one
 * range per block' contract".
 *
 * That is the right contract for a menu action, which replaces a whole block
 * slice. It is not enough for TYPING, where a caret sits at some offset inside
 * a rendered `<p>` and the edit must become a character-range patch. ADR 0009
 * §"Editing precision is bounded by annotation coverage" names inline-level
 * ranges as "additive future work, not a redesign". This is that work.
 *
 * ## The coordinate, and why it is not a character offset
 *
 * markdown-it LF-normalizes its input before parsing, and CodeMirror normalizes
 * document line breaks, so a flat character offset computed here would not
 * index a CRLF buffer correctly — the same reason `source-range.ts` puts LINE
 * ranges on the wire. Every coordinate emitted here is therefore a
 * `line:column` pair (0-based line, 0-based UTF-16 column within that line),
 * which is EOL-invariant, and no segment ever spans a line break.
 *
 * ## The invariant that makes the map trustworthy
 *
 * A segment is emitted ONLY when the rendered text it covers is byte-identical
 * to the source text it points at:
 *
 *     rendered.slice(r, r + len) === sourceLine.slice(c, c + len)
 *
 * This is checked per segment, here, at build time. Anything that fails it is
 * dropped rather than guessed: typographer substitutions (`'` -> `’`, `...` ->
 * `…`), entity decoding, and markdown-it's normalization of blockquote and
 * list continuations all fail the check and simply do not produce coordinates.
 *
 * That is deliberate and it mirrors the decision `inline-source.ts` already
 * made when it computed `state.pos` and threw it away rather than "expose a
 * destructive edit coordinate when identity is not exact". A block whose
 * segments do not cover its whole rendered text is reported as partially
 * mapped; a consumer must treat an unmapped offset as not-directly-typeable
 * and fall back to editing that block's source.
 *
 * ## Security
 *
 * The emitted attribute is a destructive edit coordinate, so — exactly like
 * `data-gp-source-token` — an author must not be able to forge one through raw
 * HTML (`html: true` is on, with no allowlist). `SOURCE_OFFSETS_ATTR` is
 * registered in `inline-source.ts`'s `RESERVED_ATTRS` and stripped by the same
 * two-layer guard.
 */
import type MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";

/** Attribute carrying the block's rendered->source segment map. */
export const SOURCE_OFFSETS_ATTR = "data-gp-source-offsets";

/**
 * Shortest rendered run that may be located in the source by search.
 *
 * A one- or two-character run occurs almost everywhere, so matching one would
 * be a coin flip that the byte-equality check cannot catch — the source text
 * at a wrong `"e"` is still `"e"`. Runs below this length are simply left
 * unmapped, which degrades that offset to "not directly typeable" instead of
 * risking a patch at the wrong character.
 */
const MIN_RUN = 4;

/**
 * Fold the LENGTH-PRESERVING typographic substitutions back to their source
 * spelling, so a run containing them stays mappable.
 *
 * `typographer: true` is on in production (`renderer.ts`), and in ordinary
 * prose nearly every paragraph contains a contraction or a quoted phrase.
 * Comparing bytes naively made a single `don’t` break the surrounding run,
 * which cost roughly a third of all blocks their map.
 *
 * Only 1:1 replacements belong here, and that is what makes it safe: `'` -> `’`
 * and `"` -> `“`/`”` consume exactly one source character and produce exactly
 * one rendered character, so every offset after them is still exact. The
 * MANY-to-one replacements are deliberately absent — `...` -> `…` and `--` ->
 * `–` shift every following offset, so a run containing one must still break,
 * and does.
 */
function foldTypography(s: string): string {
  return s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
}

/**
 * One contiguous run where rendered text and source text are byte-identical.
 *
 * `rendered` is an offset into the block's rendered text content; `line`/`col`
 * locate the same run in the source. `len` never crosses a line break.
 */
export interface OffsetSegment {
  rendered: number;
  line: number;
  col: number;
  len: number;
}

/** Wire format: `rendered:line:col:len` per segment, comma separated. */
export function encodeSegments(segments: OffsetSegment[]): string {
  return segments.map((s) => `${s.rendered}:${s.line}:${s.col}:${s.len}`).join(",");
}

export function decodeSegments(value: string): OffsetSegment[] {
  const out: OffsetSegment[] = [];
  if (!value) return out;
  for (const part of value.split(",")) {
    const bits = part.split(":");
    if (bits.length !== 4) continue;
    const nums = bits.map((n) => Number(n));
    if (!nums.every((n) => Number.isFinite(n) && n >= 0)) continue;
    const [rendered, line, col, len] = nums as [number, number, number, number];
    out.push({ rendered, line, col, len });
  }
  return out;
}

/**
 * Map a rendered-text offset to a source `{line, col}`, or `null` when that
 * offset is not covered by an exact segment.
 *
 * `null` is a first-class answer and means "not directly typeable here" — the
 * consumer must degrade to editing the block's source, never guess.
 */
export function mapRenderedOffset(
  segments: OffsetSegment[],
  rendered: number,
): { line: number; col: number } | null {
  for (const s of segments) {
    // End-inclusive: a caret sitting at the very end of a run is still exactly
    // located (it is the insertion point after the last mapped character).
    if (rendered >= s.rendered && rendered <= s.rendered + s.len) {
      return { line: s.line, col: s.col + (rendered - s.rendered) };
    }
  }
  return null;
}

/** Total rendered characters covered by exact segments. */
export function mappedLength(segments: OffsetSegment[]): number {
  return segments.reduce((n, s) => n + s.len, 0);
}

/** Byte offsets of the start of each line in `src`. */
function lineStarts(src: string): number[] {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") starts.push(i + 1);
  return starts;
}

function lineColOf(starts: number[], offset: number): { line: number; col: number } {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo, col: offset - starts[lo]! };
}

/**
 * Build the segment map for one block.
 *
 * `inlineSrc` is the inline token's own `content` — markdown-it's NORMALIZED
 * view of the block, which for a blockquote or a list continuation has had its
 * markers stripped and is therefore NOT a literal slice of the file. We locate
 * it in the document to recover file coordinates, and refuse when that
 * identity is not exact: `indexOf` must find it, and `lastIndexOf` must agree,
 * so an ambiguous match produces no coordinates at all.
 */
export function buildSegments(
  docSrc: string,
  starts: number[],
  inlineToken: Token,
  blockStartOffset: number,
  blockEndOffset: number = docSrc.length,
): OffsetSegment[] {
  const children = inlineToken.children ?? [];
  const inlineSrc = inlineToken.content;
  if (!inlineSrc) return [];

  // Search ONLY within the block's own lines. Scoping matters twice over:
  // it is where our content actually is, and it is what makes the ambiguity
  // check below meaningful. Checking the whole document instead refused any
  // block whose text recurs elsewhere in the book — a table cell reading
  // `Field` or a heading reading `Publishing` — which is most short cells in a
  // reference-style book.
  const window = docSrc.slice(blockStartOffset, blockEndOffset);
  const rel = window.indexOf(inlineSrc);
  if (rel < 0) return [];
  if (window.indexOf(inlineSrc, rel + 1) >= 0) {
    // Genuinely ambiguous WITHIN this block — we cannot prove which occurrence
    // is ours, so emit nothing rather than pick.
    return [];
  }
  const at = blockStartOffset + rel;

  const segments: OffsetSegment[] = [];
  let rendered = 0;
  // Cursor into `inlineSrc`. Text tokens appear in source order, so scanning
  // forward from the cursor finds each one's origin without needing to track
  // positions during parsing. Locating them this way (rather than by
  // instrumenting every inline rule) keeps plugin rules untouched, and it is
  // no less safe: every candidate is byte-verified below before it is emitted.
  let cursor = 0;
  for (const child of children) {
    // Non-text inline tokens contribute no rendered characters we can map.
    // `code_inline` is deliberately excluded — its rendered form has had the
    // backtick fence stripped, so it is not a literal slice of the source —
    // but it still advances the rendered offset.
    if (child.type === "code_inline") {
      rendered += child.content.length;
      continue;
    }
    const text = child.type === "text" ? child.content : "";
    if (!text) continue;

    // Map MAXIMAL RUNS rather than the whole token at once.
    //
    // `text_collapse` merges adjacent text tokens, so a single character whose
    // rendered form differs from the source — a markdown escape (`\*` -> `*`),
    // a decoded entity, a typographer substitution — would otherwise make the
    // entire token unfindable and cost the whole block its map. Taking the
    // longest run that still occurs at or after the cursor, then continuing
    // after it, keeps everything around such a character mappable.
    //
    // Always preferring the LONGEST available run, combined with a
    // forward-only cursor, is what keeps this from matching the wrong
    // occurrence; runs shorter than MIN_RUN are dropped rather than risked.
    // Both sides are folded before searching. `foldTypography` is 1:1, so an
    // index into the folded string is the same index in the original.
    const foldedSrc = foldTypography(inlineSrc);
    const foldedText = foldTypography(text);
    let i = 0;
    while (i < text.length) {
      let foundAt = -1;
      let runLen = 0;
      for (let len = text.length - i; len >= MIN_RUN; len--) {
        const idx = foldedSrc.indexOf(foldedText.slice(i, i + len), cursor);
        if (idx >= 0) {
          foundAt = idx;
          runLen = len;
          break;
        }
      }
      if (foundAt < 0) {
        i += 1; // unmappable character — emit nothing, keep the offset moving
        continue;
      }
      cursor = foundAt + runLen;

      // Split at line breaks so no segment crosses one, then keep only the
      // pieces where rendered and source agree byte for byte.
      let srcOff = at + foundAt;
      let renOff = rendered + i;
      let remaining = text.slice(i, i + runLen);
      while (remaining.length) {
        const { line, col } = lineColOf(starts, srcOff);
        const lineEnd = line + 1 < starts.length ? starts[line + 1]! - 1 : docSrc.length;
        const room = Math.max(0, lineEnd - srcOff);
        const take = Math.min(remaining.length, room);
        if (take <= 0) break;
        const chunk = remaining.slice(0, take);
        // The verification folds too — otherwise it would reject the very runs
        // the search just accepted. Folding is length-preserving, so this
        // still proves the coordinate is exact.
        if (foldTypography(docSrc.slice(srcOff, srcOff + take)) === foldTypography(chunk)) {
          segments.push({ rendered: renOff, line, col, len: take });
        }
        // A chunk that does NOT match is simply not emitted — that offset range
        // becomes unmapped and the block is reported as partially mapped.
        srcOff += take;
        renOff += take;
        remaining = remaining.slice(take);
        if (remaining.length) srcOff += 1; // step over the newline
      }
      i += runLen;
    }
    rendered += text.length;
  }
  return segments;
}

/** Rendered text content of a block's inline token, as the DOM will show it. */
export function renderedTextOf(inlineToken: Token): string {
  let out = "";
  for (const child of inlineToken.children ?? []) {
    if (child.type === "text") out += child.content;
    else if (child.type === "code_inline") out += child.content;
  }
  return out;
}

/**
 * Register the rule. Runs as a CORE rule after inline parsing so it sees final
 * token content, and before `source_range` so the block token still exists.
 */
export function registerInlineOffsets(md: MarkdownIt): void {
  md.core.ruler.push("inline_offsets", (state) => {
    const docSrc = state.src;
    const starts = lineStarts(docSrc);
    const tokens = state.tokens;

    for (let i = 0; i < tokens.length; i++) {
      const inline = tokens[i]!;
      if (inline.type !== "inline") continue;
      // The nearest preceding open block token owns the rendered element —
      // but it must be one that actually RENDERS. In a tight list markdown-it
      // emits `paragraph_open` with `hidden: true`; attributes set on it are
      // dropped, so the map would silently never reach the HTML. Skip hidden
      // tokens and land on `list_item_open` instead.
      let owner: Token | undefined;
      for (let j = i - 1; j >= 0; j--) {
        const candidate = tokens[j]!;
        if (candidate.nesting !== 1 || candidate.hidden) continue;
        owner = candidate;
        break;
      }
      if (!owner) continue;
      // The element that OWNS the attribute is not always the one that knows
      // where it came from. markdown-it gives `<td>`/`<th>` no `token.map` (a
      // gap `source-range.ts` documents), and in a reference-heavy book that
      // is most of the text — 267 of the user guide's unmapped blocks were
      // table cells. Their enclosing `tr_open` does carry a map, and it is a
      // single line, so it is a perfectly good search space for the cell's
      // content. Fall back to the nearest preceding token that has one.
      let located = owner.map ? owner : undefined;
      if (!located) {
        for (let j = i - 1; j >= 0; j--) {
          if (tokens[j]!.map) {
            located = tokens[j];
            break;
          }
        }
      }
      if (!located?.map) continue;
      // Drop any author-supplied value FIRST, whether or not we go on to set
      // our own. `markdown-it-attrs` lets an author write
      // `{data-gp-source-offsets=0:0:0:9}` on a block; on a block we do not map
      // (raw HTML, an unmappable construct) a forged coordinate would otherwise
      // survive and steer a splice. Raw-HTML forgery is stripped separately by
      // `inline-source.ts`'s `stripReservedRawHtmlAttrs`.
      if (owner.attrs) {
        owner.attrs = owner.attrs.filter(
          ([name]) => name.toLowerCase() !== SOURCE_OFFSETS_ATTR,
        );
      }
      const blockStart = starts[located.map[0]] ?? 0;
      const blockEnd = starts[located.map[1]] ?? docSrc.length;
      const segments = buildSegments(docSrc, starts, inline, blockStart, blockEnd);
      if (!segments.length) continue;
      owner.attrSet(SOURCE_OFFSETS_ATTR, encodeSegments(segments));
    }
  });
}
