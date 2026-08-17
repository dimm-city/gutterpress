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
 * its own bullet), so the line count drifts. Serializing `doc(children[0..i])`
 * cannot drift — every child is whole — and the corpus confirms the result is
 * always a genuine prefix of the full document.
 */
function computeTable(doc: PMNode): BlockLine[] {
  const out: BlockLine[] = [];
  const children: PMNode[] = [];
  doc.forEach((child) => children.push(child));

  let pos = 0;
  let line = 1;
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    out.push({ pos, line });
    // Lines consumed by this child, plus the blank line the serializer puts
    // between blocks. Derived from the serializer itself, so a change to how
    // any node is written moves these numbers with it.
    const text = serializeDoc(doc.type.schema.nodes.doc!.create(null, [child])).replace(/\n+$/, "");
    line += countLines(text) + 1;
    pos += child.nodeSize;
  }
  return out;
}

/**
 * A line table for `doc`, memoized on the document itself.
 *
 * One entry, not a Map: consecutive calls are always about the current
 * document, and holding older documents would pin their whole node trees.
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

/** Drop the memo — for tests, so one document cannot leak into another. */
export function resetLineTableCache(): void {
  cachedDoc = null;
  cachedTable = [];
}
