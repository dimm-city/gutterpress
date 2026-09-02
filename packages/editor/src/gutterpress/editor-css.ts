/**
 * CSS the Gutterpress mount always injects (before any host `extraCss`):
 * marker chips (`render-chip.ts`) and the container wrappers the fork's
 * `groupBlocks` hook mounts (`provider.ts`). The chip is a compact,
 * editable declaration bar; the wrapper carries the exact classes and
 * attributes the print pipeline emits (`.section`, `.page`, `data-page`,
 * …) so a book's own stylesheet styles the editor the way it styles the
 * PDF.
 */
export const GUTTERPRESS_EDITOR_CSS = `
.md-block.gp-block-chip {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.15em 0.7em;
  margin: 0.5em 0 0.35em;
  padding: 0.15em 0.6em;
  border-left: 3px solid #4c6ef5;
  border-radius: 0 4px 4px 0;
  background: rgba(76, 110, 245, 0.07);
  color: #3b4252;
  font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.gp-block-chip__kind {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #4c6ef5;
}
.gp-block-chip__source {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.gp-block-chip__attrs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35em;
}
.gp-block-chip__attr {
  padding: 0 0.4em;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.07);
  font-size: 11px;
  overflow-wrap: anywhere;
}
.gp-block-chip--end-section,
.gp-block-chip--page-break,
.gp-block-chip--column-break {
  border-left-color: #94a3b8;
  background: rgba(148, 163, 184, 0.12);
}
.gp-block-chip--end-section .gp-block-chip__kind,
.gp-block-chip--page-break .gp-block-chip__kind,
.gp-block-chip--column-break .gp-block-chip__kind {
  color: #64748b;
}
.gp-block-chip__source--inert {
  flex-basis: 100%;
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.gp-block-chip--plugin-region,
.gp-block-chip--raw-html {
  display: block;
  padding: 0;
  border-left: 0;
  background: none;
  font: inherit;
  color: inherit;
}
.gp-block-chip--plugin-region > .gp-block-chip__kind,
.gp-block-chip--raw-html > .gp-block-chip__kind,
.gp-block-chip--plugin-region > .gp-block-chip__source--inert,
.gp-block-chip--raw-html > .gp-block-chip__source--inert,
.gp-block-chip--plugin-region > .gp-block-chip__attrs,
.gp-block-chip--raw-html > .gp-block-chip__attrs {
  display: none;
}
.gp-block-chip__rendered {
  display: contents;
}
/* A break marker is a real forced break in the book, so it must be one here
   too: the chip stands in for the pipeline's own gp-page-break /
   gp-column-break element (which MARKER_CSS hides), and carries that
   element's break behaviour instead of hiding with it. Without this the
   editor simply ignores the break markers and paginates differently from
   the page. */
.md-block.gp-block-chip--page-break {
  break-before: page;
}
.md-block.gp-block-chip--column-break {
  break-after: column;
}

/* Locked (reading) view: a MARKER chip is an authoring affordance and takes
   vertical space the printed page does not, so the locked view drops it and
   paginates exactly like the book (proved by
   packages/desktop/tests/integration/editor-preview-parity.mjs). A
   plugin-region / raw-html chip is NOT dropped: what it shows is the
   pipeline's own rendered output, which does print. */
.md-editor.md-readonly
  .gp-block-chip:not(.gp-block-chip--plugin-region):not(.gp-block-chip--raw-html) {
  display: none;
}
.md-block-group {
  position: relative;
}
.md-block-group.page,
.md-block-group.spread {
  margin: 0.75em 0;
  padding: 0.5em 0.75em;
  outline: 1px dashed rgba(76, 110, 245, 0.35);
  outline-offset: 2px;
}
`;
