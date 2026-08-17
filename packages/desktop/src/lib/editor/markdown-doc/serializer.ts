/**
 * ProseMirror doc -> markdown.
 *
 * `prosemirror-markdown`'s `MarkdownSerializer` with rules for the nodes
 * `schema.ts` adds. It replaces the postmortem's hand-written 1,226-line
 * DOM->markdown serializer rather than re-deriving it: the input here is a
 * ProseMirror document, not scraped DOM, so there is nothing to reverse
 * engineer.
 *
 * OUTPUT IS CANONICAL, NOT BYTE-PRESERVING. Saving may change bullet
 * characters, emphasis markers and wrapping — the same thing Typora, Milkdown
 * and HackMD do. That decision is what makes this component small; the
 * property it must uphold instead is the FIXPOINT: serializing an
 * already-normalized document must return it unchanged. See
 * `roundtrip.test.ts`.
 *
 * The one exception is the layout markers, which round-trip verbatim from the
 * `marker` attribute — their authored form is not recoverable from the token
 * attributes (see `schema.ts`).
 */
import { MarkdownSerializer, defaultMarkdownSerializer } from "prosemirror-markdown";
import type { Node as PMNode } from "prosemirror-model";
import type { MarkdownSerializerState } from "prosemirror-markdown";
import { gutterpressSchema } from "./schema";

/** Emit a layout wrapper's authored marker line, then its children. */
function layoutWrapper(closing?: string) {
  return (state: MarkdownSerializerState, node: PMNode) => {
    const marker = (node.attrs.marker as string) || "";
    if (marker) {
      // The marker is a line in its own right, not a block wrapping the
      // children, so close it as its own block — that yields the marker line
      // plus the blank line that must follow it before the content starts.
      // (`flushClose` would be the direct way to say this but is not part of
      // `MarkdownSerializerState`'s public API.)
      state.write(marker.trim());
      state.closeBlock(node);
    }
    state.renderContent(node);
    if (closing) {
      state.write(closing);
      state.closeBlock(node);
    }
  };
}

function layoutAtom(state: MarkdownSerializerState, node: PMNode) {
  state.write((node.attrs.marker as string).trim() || "");
  state.closeBlock(node);
}

/**
 * Inline content of a table cell, as markdown.
 *
 * Serializes the cell's content as a one-paragraph document rather than
 * walking its children by hand. The hand-written version silently DROPPED
 * every mark: `` `--pdf` `` came back out as bare `--pdf`, which the next
 * parse then fed to `typographer` and turned into `–pdf`. The corpus
 * fixpoint gate caught that on its first run across 6 files.
 *
 * Reusing the serializer means bold, emphasis, code, links and images inside
 * cells are handled by the same rules as everywhere else, for free.
 */
function cellText(node: PMNode): string {
  const paragraph = gutterpressSchema.nodes.paragraph!.create(null, node.content);
  const doc = gutterpressSchema.nodes.doc!.create(null, [paragraph]);
  return (
    gutterpressMarkdownSerializer
      .serialize(doc)
      .replace(/\n+$/, "")
      // A newline inside a cell would end the row.
      .replace(/\n/g, " ")
      // Escape only pipes that are not already escaped, so a round trip does
      // not accumulate backslashes.
      .replace(/(?<!\\)\|/g, "\\|")
  );
}

export const gutterpressMarkdownSerializer = new MarkdownSerializer(
  {
    ...defaultMarkdownSerializer.nodes,

    // ── Gutterpress layout ───────────────────────────────────────────────
    // `@chapter` / `@page` / `@spread` are open-ended in the source: they run
    // until the next marker or EOF, so they have no closing line. Only
    // `@section` has an explicit terminator.
    gp_chapter: layoutWrapper(),
    gp_spread: layoutWrapper(),
    gp_page: layoutWrapper(),
    gp_section: layoutWrapper("@end-section"),
    gp_page_break: layoutAtom,
    gp_column_break: layoutAtom,

    // ── raw HTML, verbatim ───────────────────────────────────────────────
    html_block(state, node) {
      state.write((node.attrs.html as string).replace(/\n+$/, ""));
      state.closeBlock(node);
    },
    html_inline(state, node) {
      state.text(node.attrs.html as string, false);
    },

    // ── tables ───────────────────────────────────────────────────────────
    table(state, node) {
      node.forEach((section) => state.render(section, node, 0));
      state.closeBlock(node);
    },
    table_head(state, node) {
      const row = node.firstChild;
      if (!row) return;
      const cells: string[] = [];
      const aligns: (string | null)[] = [];
      row.forEach((cell) => {
        cells.push(cellText(cell));
        aligns.push((cell.attrs.align as string | null) ?? null);
      });
      state.write(`| ${cells.join(" | ")} |\n`);
      state.write(
        `|${aligns
          .map((a) => (a === "center" ? ":---:" : a === "right" ? "---:" : a === "left" ? ":---" : "---"))
          .map((s) => ` ${s} `)
          .join("|")}|\n`,
      );
    },
    table_body(state, node) {
      node.forEach((row) => {
        const cells: string[] = [];
        row.forEach((cell) => cells.push(cellText(cell)));
        state.write(`| ${cells.join(" | ")} |\n`);
      });
    },
    table_row() {
      /* handled by table_head / table_body */
    },
    table_cell() {
      /* handled by table_head / table_body */
    },
    table_header() {
      /* handled by table_head / table_body */
    },
  },
  defaultMarkdownSerializer.marks,
);

export function serializeDoc(doc: PMNode): string {
  const out = gutterpressMarkdownSerializer.serialize(doc);
  // Files end with exactly one newline.
  return `${out.replace(/\n+$/, "")}\n`;
}
