/**
 * Gutterpress document model for rich-text editing.
 *
 * markdown --(markdown-it, OUR instance)--> ProseMirror doc --> markdown.
 *
 * The parser is `prosemirror-markdown` configured with Gutterpress's own
 * markdown-it pipeline, so there is exactly one markdown dialect in the
 * product. Output is CANONICAL rather than byte-preserving; the property that
 * replaces byte identity is the fixpoint (`isFixpoint` below).
 */
export { gutterpressSchema, type GutterpressSchema } from "./schema";
export { createDocParser, canEditRichly } from "./parser";
export { createEditorRenderer } from "./renderer";
export { gutterpressMarkdownSerializer, serializeDoc } from "./serializer";

import type MarkdownIt from "markdown-it";
import { createDocParser } from "./parser";
import { createEditorRenderer } from "./renderer";
import { serializeDoc } from "./serializer";

/**
 * Normalize markdown by running it through the document model once.
 *
 * Defaults to `createEditorRenderer()` — the print pipeline plus the
 * provenance filter that keeps generated content (the injected
 * `.chapter-opener` badge) out of the document model. Passing a bare
 * `createMarkdownRenderer()` would let that badge be written back into the
 * author's file.
 */
export function normalize(md: MarkdownIt = createEditorRenderer(), text = ""): string {
  return serializeDoc(createDocParser(md).parse(text));
}

/**
 * Does normalizing an already-normalized document change it?
 *
 * This is the gate that replaces byte identity with the author's original.
 * It compares SOURCE to SOURCE — deliberately not rendered HTML. Comparing
 * HTML would be structurally blind, because markdown-it applies `typographer`
 * and `linkify` BEFORE the ProseMirror document exists, so the comparison
 * would pass no matter how lossy the serializer is. That is the postmortem's
 * `BYTE_IDENTICAL_MIN = 0.8` failure in a new costume.
 */
export function isFixpoint(md: MarkdownIt, text: string): { ok: boolean; normalized: string; second: string } {
  const normalized = normalize(md, text);
  const second = normalize(md, normalized);
  return { ok: normalized === second, normalized, second };
}
