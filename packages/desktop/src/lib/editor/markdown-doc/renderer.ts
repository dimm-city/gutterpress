/**
 * The markdown-it instance the EDITOR parses with.
 *
 * It is Gutterpress's own `createMarkdownRenderer()` — same plugins, same
 * `markers.js`, same `typographer`/`linkify` — with two editor-only core
 * rules added (`editor_entity_source`, `editor_tag_generated`).
 * `createMarkdownRenderer()` returns a FRESH instance per call, so adding
 * rules here cannot affect the instance the print path uses.
 *
 * ## Why the extra rule exists
 *
 * `markers.js` INJECTS content that the author never wrote — currently the
 * chapter-opener badge:
 *
 *     const opener = new state.Token('html_block', '', 0);
 *     opener.content = `<div class="chapter-opener" ...>C.01</div>\n`;
 *
 * By token type that is indistinguishable from raw HTML the author typed, so
 * the document model would absorb it and the serializer would write it back
 * into the `.md` file — materializing generated markup as source. Measured:
 * this turned `# Reading the Tides` into
 * `<div class="chapter-opener" data-chapter-label="C.01">C.01</div>` on a
 * second save.
 *
 * The discriminator is `token.map`. markdown-it gives every block token parsed
 * FROM SOURCE a source line range; a token synthesized during a core rule has
 * `map === null`. So: **content with no source position was not authored**.
 *
 * One carve-out: a map-less `html_block` carrying core-rule provenance
 * (`meta.gpCoreHunk` / `meta.gpCorePoison`, stamped by the cli differ around
 * plugin core rules) is a transform's replacement for CONSUMED authored
 * lines — the badge's invariant ("dropping is lossless because the generator
 * line is still in the document") does not hold for it. Those tokens belong
 * to the parser's adoption/refusal passes; retagging them here would delete
 * the author's only carrier of those lines on save. The retag predicate is
 * the exact complement of adoption's: map-less, stamp-less, poison-less.
 *
 * ## Retagged, not dropped
 *
 * Generated content is SHOWN — print shows it, and this editor's promise is
 * that text looks as it will print — so the rule retags it to `gp_generated`
 * rather than deleting it. That node is read-only in the view and serializes
 * to nothing, so it still cannot reach the author's file.
 *
 * The promise has one deliberate exception: typographer/linkify. The doc
 * model parses with both OFF (parser.ts `parse()`), because a doc built from
 * their output bakes `’`/`“”`/`–` and rewritten URLs into the author's bytes
 * on save. So the rich view shows the author's straight quotes and plain
 * dashes while print keeps typographer's output — the view is faithful to
 * STRUCTURE and generated content, and to the author's own text where print
 * would rewrite it. This instance's `render()` paths (preview, the semantic
 * gates) still run with both on.
 *
 * Retagging is what keeps the editor from carrying a SECOND copy of the
 * pipeline's rules. The view used to synthesize its own chapter-opener widget
 * from "does this @chapter have a label", which is not the pipeline's
 * condition — `markers.js` emits the opener only when a labelled chapter also
 * opens a `@page`. On a book whose chapters have no `@page` markers the
 * editor therefore invented an opener print does not have, showed its label
 * as stray body text, and pushed the chapter's own heading onto a second
 * page. Now there is one rule, in the pipeline, and the editor shows its
 * output wherever it lands.
 *
 * This is a rule about provenance, not a list of known-generated markup, so it
 * keeps working if `markers.js` starts injecting something else.
 */
import { createMarkdownRenderer, type LoadedPlugin } from "gutterpress/render";
import type MarkdownIt from "markdown-it";

export type { LoadedPlugin } from "gutterpress/render";

/**
 * `plugins` are the PROJECT'S manifest plugins — passed through to
 * `createMarkdownRenderer`, which applies them at the same pipeline position
 * the print path does (after the core plugins, before the source-metadata
 * rules). The editor must parse with the dialect that prints, and that
 * dialect includes the book's own plugins; see `$lib/editor/project-renderer`
 * for how the desktop obtains them on each side of the process boundary.
 */
export function createEditorRenderer(plugins?: LoadedPlugin[]): MarkdownIt {
  const md = createMarkdownRenderer(plugins && plugins.length > 0 ? plugins : undefined);

  // An authored HTML entity (`&quot;`) decodes to a `text_special` token,
  // and markdown-it's `text_join` then merges it into plain text — after
  // which the doc model cannot tell `&quot;` from a typed `"`. That
  // distinction is MEANING, not just bytes: typographer curls a typed quote
  // and leaves the entity alone, so a save that decodes the entity changes
  // the rendered page. `token.markup` still holds the authored bytes here,
  // so the entity is retagged onto the schema's verbatim inline carrier
  // (`html_inline`) before `text_join` erases it. Escapes (`\*`,
  // info === "escape") keep their text path: the serializer's own escaping
  // round-trips them, and an atom would make the character uneditable.
  //
  // HEADINGS are exempt. The schema's heading content is `(text | image)*`
  // (prosemirror-markdown's own spec), so an `html_inline` atom cannot live
  // there — and a node whose content the schema refuses is dropped WHOLE by
  // `createAndFill`, which silently deleted the entire heading on save.
  // Entities in a heading therefore stay on the decoded-text path: the
  // lesser, pre-retag loss (`# A &amp; B` saves as `# A & B`, rendering
  // unchanged) instead of a vanished heading. Admitting the atom into
  // heading content would be the larger change — every consumer of heading
  // text (outline, completions, serializer) assumes plain text there.
  md.core.ruler.before("text_join", "editor_entity_source", (state) => {
    let inHeading = false;
    for (const token of state.tokens) {
      if (token.type === "heading_open") {
        inHeading = true;
        continue;
      }
      if (token.type === "heading_close") {
        inHeading = false;
        continue;
      }
      if (inHeading || token.type !== "inline" || !token.children) continue;
      for (const child of token.children) {
        if (child.type !== "text_special" || child.info !== "entity") continue;
        child.type = "html_inline";
        child.content = child.markup;
      }
    }
    return true;
  });

  md.core.ruler.push("editor_tag_generated", (state) => {
    for (const token of state.tokens) {
      if (token.type !== "html_block" || token.map) continue;
      // Core-rule provenance means consumed authored source — the parser's
      // adoption (stamp) or refusal (poison) owns the token; see the header.
      const meta = token.meta as Record<string, unknown> | null;
      if (meta != null && typeof meta === "object" && ("gpCoreHunk" in meta || "gpCorePoison" in meta)) {
        continue;
      }
      token.type = "gp_generated";
    }
    return true;
  });

  // The retag must be invisible to anything that RENDERS with this instance
  // (the preflight's semantic comparison, the normalize planner's before/after
  // check): emit exactly what `html_block` would have. The type carries
  // provenance for the document model, not a different output.
  md.renderer.rules.gp_generated = (tokens, idx) => tokens[idx]!.content;

  return md;
}
