/**
 * Source line numbers for a ProseMirror document.
 *
 * A document tree has no lines; the editor→preview sync, "go to source" and
 * the Problems panel all speak in them. The mapping has to be DERIVED, and
 * the way it is derived matters:
 *
 * NOT by storing `token.map` on nodes at parse time. That drifts the instant
 * the author types — every line number below an inserted paragraph is wrong,
 * silently, and nothing tells you.
 *
 * Instead, serialize a prefix of the document and count the lines. The
 * serializer is the same one that writes the file, so a block's line number is
 * BY CONSTRUCTION the line it will occupy on disk. Verified on the real corpus:
 * `serialize(doc(children[0..i]))` is always a prefix of `serialize(doc)`.
 *
 * Cost is one serialization per block, so the table is built lazily — only
 * when something actually asks for a line — and memoized on the document
 * identity. Typing invalidates it (a new doc), but typing does not ask: the
 * caret listener fires only on a deliberate move, and scrolling does not
 * change the document.
 */
import type { Node as PMNode } from "prosemirror-model";
import { serializeDoc } from "./markdown-doc";
import { buildLineStarts } from "./source-range";

export interface BlockLine {
  /** Document position of the block. */
  pos: number;
  /** 1-based first source line of the block. */
  line: number;
}

const countLines = (text: string) => text.split("\n").length;

/**
 * Each TOP-LEVEL block, with the source line it starts on.
 *
 * Top-level only, and built from whole sub-documents rather than `doc.cut()`.
 * That is not a granularity compromise — measured on the user guide it is one
 * entry per ~4.5 source lines, and the preview interpolates between annotated
 * blocks anyway (`preview-interface.js`'s `resolveLinePosition`). It is a
 * CORRECTNESS choice: `cut()` slices through open nodes and the fragment it
 * leaves serializes differently from the real prefix (a half-open list emits
 * its own bullet), so the line count drifts.
 *
 * Each block is LOCATED in the real saved text rather than having its start
 * line accumulated. Accumulating meant assuming exactly one blank line between
 * blocks, and `prosemirror-markdown` does not always write one: two adjacent
 * lists of the same shape — what you get from using the list command twice in
 * a row — are separated by TWO, or re-parsing would merge them into one list.
 * Every line after such a pair was then reported one early, silently, in every
 * "go to source" jump and preview scroll sync.
 *
 * Locating is also what keeps this honest in general: it is measured against
 * the bytes `serializeDoc` actually produces, so any future change to how a
 * node is written moves these numbers with it instead of invalidating an
 * assumption recorded here. One full serialization plus one per child, with
 * the search cursor only moving forward — linear, not the quadratic cost of
 * serializing a growing prefix per block.
 */
function computeTable(doc: PMNode): BlockLine[] {
  const out: BlockLine[] = [];
  const children: PMNode[] = [];
  doc.forEach((child) => children.push(child));

  const docType = doc.type.schema.nodes.doc!;
  const full = serializeDoc(doc);
  // Line number of every offset in `full`. The canonical line-start table
  // (shared with `source-range.ts`) plus an upper-bound scan replaces a
  // per-block `full.slice(0, offset)` re-count, which scanned
  // O(blocks x bytes) — ~9MB per table build on an 88KB single-file book.
  const starts = buildLineStarts(full);
  const lineAt = (offset: number) => {
    let line = 1;
    while (line < starts.length && starts[line]! <= offset) line++;
    return line;
  };

  let pos = 0;
  let cursor = 0;
  let fallbackLine = 1;
  for (const child of children) {
    const text = serializeDoc(docType.create(null, [child])).replace(/\n+$/, "");
    const at = text ? full.indexOf(text, cursor) : -1;
    if (at === -1) {
      // A block whose standalone spelling is not a literal substring of the
      // document's. Nothing observed does this, but guessing a position would
      // be worse than an approximate one: keep the old accumulate-and-hope
      // number for this block and let the next locatable block resynchronize.
      out.push({ pos, line: fallbackLine });
      fallbackLine += countLines(text) + 1;
    } else {
      const line = lineAt(at);
      out.push({ pos, line });
      cursor = at + text.length;
      fallbackLine = line + countLines(text) + 1;
    }
    pos += child.nodeSize;
  }
  return out;
}

/**
 * A line table for `doc`, memoized on the document itself.
 *
 * One entry, not a Map: consecutive calls are always about the current
 * document, and holding older documents would pin their whole node trees.
 *
 * Module-level rather than per-editor, which assumes one mounted rich editor —
 * true today, and the host unmounts one surface before mounting the other. It
 * is safe rather than merely convenient: the entry is keyed on document
 * IDENTITY, so a second editor can never be handed the first one's lines, it
 * would only miss and recompute. If two ever coexist, move this onto the
 * handle `mountRichEditor()` returns.
 */
let cachedDoc: PMNode | null = null;
let cachedTable: BlockLine[] = [];

export function lineTable(doc: PMNode): BlockLine[] {
  if (cachedDoc === doc) return cachedTable;
  cachedDoc = doc;
  cachedTable = computeTable(doc);
  return cachedTable;
}

/** The document position of the block containing 1-based source `line`. */
export function posForLine(doc: PMNode, line: number): number | null {
  const table = lineTable(doc);
  if (table.length === 0) return null;
  let best = table[0]!;
  for (const entry of table) {
    if (entry.line <= line) best = entry;
    else break;
  }
  return best.pos;
}

/** The 1-based source line of the block at or before document position `pos`. */
export function lineForPos(doc: PMNode, pos: number): number {
  const table = lineTable(doc);
  let best = 1;
  for (const entry of table) {
    if (entry.pos <= pos) best = entry.line;
    else break;
  }
  return best;
}

/** Drop the memo — called from `destroy()` so a closed file's document
 * tree is not pinned, and from tests so one document cannot leak into
 * another. */
export function resetLineTableCache(): void {
  cachedDoc = null;
  cachedTable = [];
}
