/**
 * two-versions.ts — finds the passages a sync left with TWO versions in the
 * open file, and builds the one edit that keeps the author's choice.
 *
 * When a sync finds a passage edited both here and online, the converge
 * merge (lib `remote-auth/converge-merge.ts`) keeps both versions in the
 * file inside standard conflict markers:
 *
 *     <<<<<<< your version
 *     …the passage as edited on this computer…
 *     =======
 *     …the passage as edited online…
 *     >>>>>>> online version
 *
 * The lib's `source.sync.merge-markers` check reports each block from the
 * file on disk, one Problems entry per block. This module reads the EDITOR
 * BUFFER instead: that is the text the author is looking at and the text a
 * choice rewrites, and the panel needs the two texts, not just a line, to
 * show them side by side. The renderer may not value-import the lib
 * (CLAUDE.md §8), so the two sentinel lines are spelled here as well;
 * `tests/editor/two-versions.test.ts` pins them to the merge's REAL output so
 * the two cannot drift apart.
 *
 * Matching is as EXACT as the check's: only the two fixed labels open and
 * close a block. A bare `=======` is setext-heading markdown and means
 * nothing on its own. CRLF files are read as the merge wrote them.
 *
 * Pure: strings in, offsets out. A choice is ONE range replacement, so the
 * editor applies it as a single undoable transaction — undo puts both
 * versions and the markers back.
 */

/** The exact sentinel lines converge-merge writes. Byte-match — never loosen. */
const OPEN_SENTINEL = "<<<<<<< your version";
const MID_SENTINEL = "=======";
const CLOSE_SENTINEL = ">>>>>>> online version";

export type TwoVersionsChoice = "yours" | "online" | "both";

export interface TwoVersionsBlock {
  /** 1-based line of the `<<<<<<< your version` line — the line Problems reports. */
  line: number;
  /** Offset where the opening sentinel line starts. */
  from: number;
  /** Offset just past the closing sentinel line (its line break included). */
  to: number;
  /** The passage as edited on this computer, line breaks included. */
  yours: string;
  /** The passage as edited online, line breaks included. */
  online: string;
}

export interface RangeEdit {
  from: number;
  to: number;
  insert: string;
}

/**
 * Every well-formed block in `text`, in document order. A half-deleted
 * family (an opener with no closer, a closer with no opener, or no `=======`
 * between them) is not a block: nothing is offered for it, and the check's
 * own "leftover marker" finding still points the author at it.
 */
export function findTwoVersions(text: string): TwoVersionsBlock[] {
  // Cheap probe: the panel re-reads the buffer on every keystroke, and a
  // healthy file never contains the opener.
  if (!text.includes(OPEN_SENTINEL)) return [];
  const blocks: TwoVersionsBlock[] = [];
  let open: { line: number; from: number; yoursFrom: number } | null = null;
  let mid: { yoursTo: number; onlineFrom: number } | null = null;
  let line = 0;
  let pos = 0;
  while (pos < text.length) {
    line++;
    const nl = text.indexOf("\n", pos);
    const next = nl === -1 ? text.length : nl + 1;
    let end = nl === -1 ? text.length : nl;
    if (end > pos && text[end - 1] === "\r") end--;
    const body = text.slice(pos, end);
    if (body === OPEN_SENTINEL) {
      open = { line, from: pos, yoursFrom: next };
      mid = null;
    } else if (open && !mid && body === MID_SENTINEL) {
      mid = { yoursTo: pos, onlineFrom: next };
    } else if (open && body === CLOSE_SENTINEL) {
      if (mid) {
        blocks.push({
          line: open.line,
          from: open.from,
          to: next,
          yours: text.slice(open.yoursFrom, mid.yoursTo),
          online: text.slice(mid.onlineFrom, pos),
        });
      }
      open = null;
      mid = null;
    }
    pos = next;
  }
  return blocks;
}

/** The edit that replaces one block with the chosen text and no markers. */
export function resolveTwoVersions(block: TwoVersionsBlock, choice: TwoVersionsChoice): RangeEdit {
  const insert =
    choice === "yours" ? block.yours : choice === "online" ? block.online : block.yours + block.online;
  return { from: block.from, to: block.to, insert };
}

/**
 * The edits that settle EVERY block in `text` the same way, last block
 * first, so applying them one after another never shifts an edit still to
 * come.
 */
export function resolveAllTwoVersions(text: string, choice: TwoVersionsChoice): RangeEdit[] {
  return findTwoVersions(text)
    .map((block) => resolveTwoVersions(block, choice))
    .reverse();
}
