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
 * `map === null`. So: **content with no source position was not authored**,
 * and must not enter the document model.
 *
 * This is a rule about provenance, not a list of known-generated markup, so it
 * keeps working if `markers.js` starts injecting something else.
 */
import { createMarkdownRenderer } from "gutterpress/render";
import type MarkdownIt from "markdown-it";

export function createEditorRenderer(): MarkdownIt {
  const md = createMarkdownRenderer();

  md.core.ruler.push("editor_drop_generated", (state) => {
    state.tokens = state.tokens.filter(
      (token) => !(token.type === "html_block" && !token.map),
    );
    return true;
  });

  return md;
}
