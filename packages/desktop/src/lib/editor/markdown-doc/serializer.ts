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
import { attrsToBraces, type ExtraAttrs } from "./attrs";

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

const gutterpressMarkdownSerializer = new MarkdownSerializer(
  {
    ...defaultMarkdownSerializer.nodes,

    // ── markdown-it-attrs braces ─────────────────────────────────────────
    // `{#custom-id}` / `{.gp-bleed}`. These were being DROPPED, which broke
    // image positioning and every internal cross-reference target. The
    // fixpoint gate could not see it (a loss on pass one is stable on pass
    // two); the corpus test's semantic-preservation check is what catches it.
    heading(state, node) {
      state.write(`${state.repeat("#", node.attrs.level as number)} `);
      state.renderInline(node, false);
      const braces = attrsToBraces(node.attrs.attrs as ExtraAttrs | null);
      if (braces) state.write(` ${braces}`);
      state.closeBlock(node);
    },
    image(state, node) {
      const alt = state.esc((node.attrs.alt as string) || "");
      const src = (node.attrs.src as string).replace(/[\(\)]/g, "\\$&");
      const title = node.attrs.title
        ? ` "${(node.attrs.title as string).replace(/"/g, '\\"')}"`
        : "";
      state.write(`![${alt}](${src}${title})${attrsToBraces(node.attrs.attrs as ExtraAttrs | null)}`);
    },
    /**
     * A fence, with its braces.
     *
     * Same shape as the default rule — including the grow-the-fence trick that
     * keeps a fence longer than any backtick run inside it — plus the
     * `{.line-numbers}` the default has nowhere to put.
     */
    code_block(state, node) {
      const runs = node.textContent.match(/`{3,}/gm);
      const fence = runs ? `${runs.sort().slice(-1)[0]}\`` : "```";
      const braces = attrsToBraces(node.attrs.attrs as ExtraAttrs | null);
      state.write(`${fence}${(node.attrs.params as string) || ""}${braces ? ` ${braces}` : ""}\n`);
      state.text(node.textContent, false);
      state.write("\n");
      state.write(fence);
      state.closeBlock(node);
    },

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
  {
    ...defaultMarkdownSerializer.marks,
    /**
     * The default link rule, plus its `markdown-it-attrs` braces.
     *
     * Delegates the hard part — the `<autolink>` vs `[text](href "title")`
     * decision, which turns on a private `isPlainURL` helper — and appends
     * the braces the default has nowhere to put.
     */
    link: {
      ...defaultMarkdownSerializer.marks.link,
      close(state, mark, parent, index) {
        const inner = defaultMarkdownSerializer.marks.link.close;
        const base =
          typeof inner === "function" ? inner(state, mark, parent, index) : String(inner);
        return base + attrsToBraces(mark.attrs.attrs as ExtraAttrs | null);
      },
    },
    strikethrough: {
      open: "~~",
      close: "~~",
      mixable: true,
      expelEnclosingWhitespace: true,
    },
  },
);

/**
 * One-slot memo, keyed on document identity.
 *
 * Safe because ProseMirror documents are immutable — the same object always
 * serializes to the same string. Worth having because one keystroke can ask
 * for the serialization more than once: `dispatchTransaction` serializes for
 * `onChange`, and a caret that scrolls into view then hits `lineForPos`,
 * whose line table starts from `serializeDoc(doc)` of the very same doc
 * (measured: 1.3ms + 3.1ms duplicated per such keystroke on a 22KB chapter,
 * super-linear in file size). One slot, not a WeakMap: consecutive callers
 * are always about the current document, and holding older docs would pin
 * their whole node trees — the same reasoning as `rich-lines.ts`'s cache.
 */
let lastDoc: PMNode | null = null;
let lastOut = "";

export function serializeDoc(doc: PMNode): string {
  if (doc === lastDoc) return lastOut;
  const out = gutterpressMarkdownSerializer.serialize(doc);
  // Files end with exactly one newline.
  lastDoc = doc;
  lastOut = `${out.replace(/\n+$/, "")}\n`;
  return lastOut;
}

/** Drop the memo — called from the editor's `destroy()` so a closed file's
 * document tree is not pinned by the slot. Never needed for correctness:
 * the key is object identity, so the slot cannot go stale. */
export function resetSerializeCache(): void {
  lastDoc = null;
  lastOut = "";
}
