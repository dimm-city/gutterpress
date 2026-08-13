/**
 * `source_range` — pure (node-free) markdown-it core rule.
 *
 * Annotates every open block-level token (`*_open`, nesting === 1) and every
 * self-closing block token with a usable range (`fence`, `hr`, `html_block`,
 * plus this project's own `layout_page_break` / `layout_column_break`) with
 * `data-source-range="<start>:<end>"` — markdown-it's own `token.map`
 * semantics verbatim: 0-based line index, half-open `[start, end)`.
 *
 * Range source, in priority order:
 *   1. `token.map` — ordinary markdown blocks (paragraphs, headings, list
 *      items, blockquotes, table rows, fences, footnote definitions, …).
 *   2. `token.meta.line` — the 1-based marker line threaded onto
 *      `layout_*_open` / `layout_page_break` / `layout_column_break` tokens
 *      by `markdown-it-paged.js` (see that file's header and the
 *      `t.meta = …` assignment sites). Converted to the same half-open
 *      convention as `[line - 1, line)`.
 *
 * Both sources are rejected unless `Number.isFinite` — a malformed/missing
 * line (the `@continue`-drops-`__line` bug class) must skip the token, not
 * silently resolve to a `NaN`-derived or whole-document range. This is the
 * exact "fail wrong" this primitive exists to prevent downstream (see
 * `docs/inline-editing-plan.md` §1 principle 3, §2.6, ADR 0009).
 *
 * This rule is registered UNCONDITIONALLY, after any custom (manifest)
 * plugins have been applied — see `renderer.ts` — so it sees the final
 * token stream regardless of what plugins are or are not configured, and so
 * a user plugin's own core rules (which may add/rewrite tokens) are
 * annotated too.
 *
 * `state.tokens` is already ONE FLAT array covering every block nesting
 * depth (list items inside blockquotes, table rows, nested `@section`s, …) —
 * markdown-it's block-level parser never nests these via `token.children`,
 * so a single pass over `state.tokens` reaches every nesting level with no
 * recursion. `token.children` exists only on `inline` tokens, holding
 * text-level marks (`strong_open`, `em_open`, `link_open`, `code_inline`,
 * …); those carry no usable per-token `map` and are deliberately NOT
 * walked here — annotating them would do nothing (their own attrs are
 * never rendered; `Renderer.renderInline` renders only their children) and
 * would blur the intentional "one range per block" contract this primitive
 * promises consumers.
 *
 * Idempotency: uses `token.attrSet` (not `attrPush`) so a token re-rendered
 * on a shared `MarkdownIt` instance gets its attribute overwritten, never
 * duplicated.
 *
 * Deliberate gap (locked in by a negative test, see `renderer.test.ts`):
 * raw HTML blocks (`html_block`) DO retain `token.map` and so DO get
 * `data-source-range` set here — but markdown-it's own `html_block`
 * renderer rule (`return token.content`) discards `token.attrs` entirely,
 * so the attribute never reaches rendered output. Overriding that renderer
 * rule to wrap raw HTML in a synthetic element was rejected (own blast
 * radius); see `docs/inline-editing-plan.md` §2.6.
 */
import type { RuleCore } from "markdown-it/lib/parser_core.mjs";
import type Token from "markdown-it/lib/token.mjs";

/** The attribute this rule writes. Exported so tests/consumers don't hardcode the string. */
export const SOURCE_RANGE_ATTR = "data-source-range";
export const SOURCE_CHAPTER_ATTR = "data-chapter-src";

/**
 * Self-closing (nesting === 0) block token types with a usable range.
 * `fence` / `hr` / `html_block` are markdown-it's own self-closing block
 * tokens (they carry `token.map`). `layout_page_break` /
 * `layout_column_break` are this project's own self-closing tokens,
 * threaded with `token.meta.line` specifically so this rule can annotate
 * them — their custom renderer rules in markdown-it-paged.js were updated
 * to actually emit the attribute this rule sets (they bypass
 * `self.renderToken`, so an attr not named there is silently dropped); see
 * the comments at those renderer rules. Without this, the two "break"
 * marker kinds would be un-targetable by the future context menu's
 * "marker" kind (docs/inline-editing-plan.md §3.1's kind precedence
 * explicitly covers "layout wrapper/break").
 */
const SELF_CLOSING_BLOCK_TYPES = new Set<string>([
  "fence",
  "hr",
  "html_block",
  "layout_page_break",
  "layout_column_break",
]);

function isFiniteRangeTuple(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  );
}

/** Resolve a token's `[start, end)` range per the priority order documented above, or `null` if none is usable. */
function resolveRange(token: Token): [number, number] | null {
  if (isFiniteRangeTuple(token.map)) {
    return [token.map[0], token.map[1]];
  }

  const meta = token.meta as { line?: unknown } | null | undefined;
  const line = meta?.line;
  if (typeof line === "number" && Number.isFinite(line)) {
    return [line - 1, line];
  }

  return null;
}

function isAnnotationTarget(token: Token): boolean {
  if (token.nesting === 1) return true;
  return token.nesting === 0 && SELF_CLOSING_BLOCK_TYPES.has(token.type);
}

function annotateToken(token: Token, chapter: string | null): void {
  if (!isAnnotationTarget(token)) return;

  const range = resolveRange(token);
  if (!range) return;

  token.attrSet(SOURCE_RANGE_ATTR, `${range[0]}:${range[1]}`);
  if (chapter) token.attrSet(SOURCE_CHAPTER_ATTR, chapter);
}

/** The core rule itself — registered via `md.core.ruler.push("source_range", sourceRangeRule)` in renderer.ts. */
export const sourceRangeRule: RuleCore = (state) => {
  const chapter = typeof state.env?.sourceChapter === "string"
    ? state.env.sourceChapter
    : null;
  for (const token of state.tokens) {
    annotateToken(token, chapter);
  }
};

export default sourceRangeRule;
