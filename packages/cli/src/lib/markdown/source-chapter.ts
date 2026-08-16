/**
 * `source_chapter` — pure (node-free) markdown-it core rule.
 *
 * Stamps every open block-level token (`*_open`, nesting === 1) and every
 * self-closing block token with `data-chapter-src="<file>"`, so the preview
 * frame can tell which source file any on-page block came from. That powers
 * scroll sync, the chapter-jump outline, and click-to-source.
 *
 * This rule is registered UNCONDITIONALLY, after any custom (manifest)
 * plugins have been applied — see `renderer.ts` — so it sees the final token
 * stream regardless of what plugins are configured, and a user plugin's own
 * core rules (which may add/rewrite tokens) are annotated too.
 *
 * `state.tokens` is already ONE FLAT array covering every block nesting depth
 * (list items inside blockquotes, table rows, nested `@section`s, …) —
 * markdown-it's block-level parser never nests these via `token.children`, so
 * a single pass reaches every level with no recursion. `token.children`
 * exists only on `inline` tokens, whose own attrs are never rendered.
 *
 * Idempotency: uses `token.attrSet` (not `attrPush`) so a token re-rendered
 * on a shared `MarkdownIt` instance gets its attribute overwritten, never
 * duplicated.
 *
 * This rule also used to emit `data-source-range="<start>:<end>"`, the
 * addressing primitive of the pre-galley editing surface (ADR 0009/0010).
 * The galley editor owns the document and addresses nodes by ProseMirror
 * position, so nothing read those ranges any more; the attribute and the
 * `token.map` / `token.meta.line` resolution behind it went with the surface
 * they served.
 */
import type { RuleCore } from "markdown-it/lib/parser_core.mjs";
import type Token from "markdown-it/lib/token.mjs";

/** The attribute this rule writes. Exported so tests/consumers don't hardcode the string. */
export const SOURCE_CHAPTER_ATTR = "data-chapter-src";

/**
 * Self-closing (nesting === 0) block token types worth stamping. `fence` /
 * `hr` / `html_block` are markdown-it's own; `layout_page_break` /
 * `layout_column_break` are this project's.
 */
const SELF_CLOSING_BLOCK_TYPES = new Set<string>([
  "fence",
  "hr",
  "html_block",
  "layout_page_break",
  "layout_column_break",
]);

function isAnnotationTarget(token: Token): boolean {
  if (token.nesting === 1) return true;
  return token.nesting === 0 && SELF_CLOSING_BLOCK_TYPES.has(token.type);
}

/** The core rule itself — registered via `md.core.ruler.push(...)` in renderer.ts. */
export const sourceChapterRule: RuleCore = (state) => {
  const chapter = typeof state.env?.sourceChapter === "string" ? state.env.sourceChapter : null;
  if (!chapter) return;
  for (const token of state.tokens) {
    if (isAnnotationTarget(token)) token.attrSet(SOURCE_CHAPTER_ATTR, chapter);
  }
};

export default sourceChapterRule;
