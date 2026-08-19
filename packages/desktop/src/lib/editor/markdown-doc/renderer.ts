/**
 * The markdown-it instance the EDITOR parses with.
 *
 * It is Gutterpress's own `createMarkdownRenderer()` — same plugins, same
 * `markers.js`, same `typographer`/`linkify` — with one editor-only core rule
 * added. `createMarkdownRenderer()` returns a FRESH instance per call, so
 * adding a rule here cannot affect the instance the print path uses.
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
 * ## Retagged, not dropped
 *
 * Generated content is SHOWN — print shows it, and this editor's promise is
 * that text looks as it will print — so the rule retags it to `gp_generated`
 * rather than deleting it. That node is read-only in the view and serializes
 * to nothing, so it still cannot reach the author's file.
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

  md.core.ruler.push("editor_tag_generated", (state) => {
    for (const token of state.tokens) {
      if (token.type === "html_block" && !token.map) token.type = "gp_generated";
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
