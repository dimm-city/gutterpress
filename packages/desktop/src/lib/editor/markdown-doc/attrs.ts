/**
 * `markdown-it-attrs` braces — `{.gp-bleed}`, `{#custom-id}` — carried through
 * the document model.
 *
 * WHY THIS EXISTS: without it they were silently DROPPED.
 * `![Art](art.jpg){.gp-bleed}` came back as `![Art](art.jpg)`, and
 * `# Heading {#custom-id}` lost its anchor — destroying image positioning and
 * every internal cross-reference target in a book. There are 28 live
 * occurrences across the first-party corpus, on exactly two constructs
 * (18 heading ids, 10 image classes), and `.gp-*` IS the author utility
 * vocabulary CLAUDE.md §6 defines.
 *
 * The fixpoint gate could not catch this: an attribute lost on the FIRST
 * normalization is perfectly stable on the second, so `normalize(normalize(x))
 * === normalize(x)` held while content was going missing. That is the
 * postmortem's failure shape — a gate that reads as proof and is not — so the
 * corpus test now also asserts SEMANTIC PRESERVATION (the rendered HTML of the
 * original and of the normalized text must match), which is what actually
 * catches loss.
 *
 * Emission is canonical (classes, then id, then other keys alphabetically)
 * rather than as-authored. That is consistent with the rest of the serializer
 * and is what keeps it fixpoint-stable — re-parsing canonical output yields
 * the same attribute set, so a second pass produces the same string.
 */
import type Token from "markdown-it/lib/token.mjs";

/** Attributes the node type models itself, and which must NOT be re-emitted. */
const OWNED: Record<string, readonly string[]> = {
  image: ["src", "alt", "title"],
  heading: [],
  link: ["href", "title"],
  // A fence's language lives in `tok.info`, not in `attrs`, so nothing here is
  // owned — `{.line-numbers}` is all the author's.
  code_block: [],
};

/**
 * Attributes added by the pipeline rather than the author.
 *
 * `data-source-range` is injected by a core rule (ADR 0009) and
 * `data-chapter-label` is PROPAGATED from an enclosing chapter — neither was
 * written by the author, so echoing them back into the file would invent
 * source the author never typed.
 *
 * `aria-hidden` was on this list and should not have been. The pipeline does
 * emit it — but only on the `layout_page_break` / `layout_column_break` marker
 * atoms, which carry it from `markers.js` and never route through
 * `extraAttrs()` at all. On the two node types this filter actually runs for,
 * headings and images, `aria-hidden` can only have come from the author, and
 * `![Decorative](border.png){aria-hidden="true"}` — the standard way to hide a
 * decorative image from a screen reader — was being deleted on save. Filtering
 * by NAME cannot tell an internal key from a plausible authored one; the
 * remaining two are `data-` prefixed and specific enough to be safe.
 */
const GENERATED = /^(data-source-range|data-chapter-label)$/;

export type ExtraAttrs = Record<string, string>;

/** The author-written attributes on a token, or null if there are none. */
export function extraAttrs(token: Token, nodeType: string): ExtraAttrs | null {
  if (!token.attrs || token.attrs.length === 0) return null;
  const owned = OWNED[nodeType] ?? [];
  const out: ExtraAttrs = {};
  let found = false;
  for (const [key, value] of token.attrs) {
    if (owned.includes(key) || GENERATED.test(key)) continue;
    out[key] = value;
    found = true;
  }
  return found ? out : null;
}

/**
 * Render attributes back to a `{...}` brace block, or "" when there are none.
 *
 * Note the leading space is NOT included — callers place it, because an image
 * takes `![a](b){.c}` with no space while a heading takes `# H {#id}` with one.
 */
export function attrsToBraces(attrs: ExtraAttrs | null | undefined): string {
  if (!attrs) return "";
  const parts: string[] = [];
  const classes = attrs.class?.trim();
  if (classes) for (const c of classes.split(/\s+/)) parts.push(`.${c}`);
  if (attrs.id) parts.push(`#${attrs.id}`);
  for (const key of Object.keys(attrs).sort()) {
    if (key === "class" || key === "id") continue;
    parts.push(`${key}=${quoteValue(attrs[key]!)}`);
  }
  return parts.length ? `{${parts.join(" ")}}` : "";
}

/**
 * A `key=value` value, quoted when it has to be.
 *
 * `markdown-it-attrs` splits an unquoted value at whitespace, so writing one
 * bare did not merely look untidy — it silently corrupted the attribute AND
 * invented a new one. `{data-note="two words"}` came back as
 * `{data-note=two words}`, which re-parses as `data-note="two"` plus an empty
 * `words=""`. Quoting is the whole fix; the escape is for a value that
 * contains a quote of its own.
 */
function quoteValue(value: string): string {
  if (value === "") return '""';
  if (!/[\s"'=}]/.test(value)) return value;
  return `"${value.replace(/"/g, "&quot;")}"`;
}
