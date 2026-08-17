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
};

/**
 * Attributes added by the pipeline rather than the author.
 *
 * `data-source-range` is injected by a core rule (ADR 0009) and
 * `data-chapter-label` is PROPAGATED from an enclosing chapter — neither was
 * written by the author, so echoing them back into the file would invent
 * source the author never typed.
 */
const GENERATED = /^(data-source-range|data-chapter-label|aria-hidden)$/;

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
    parts.push(`${key}=${attrs[key]}`);
  }
  return parts.length ? `{${parts.join(" ")}}` : "";
}
