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
 * nothing on its own. The text is the editor's, which breaks lines with
 * "\n" whatever the file on disk uses (the page normalizes before calling).
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
    const body = text.slice(pos, nl === -1 ? text.length : nl);
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

/**
 * The edit that replaces one block with the chosen text and no markers.
 * "Both" puts the two texts one after the other with a blank line between,
 * so two versions of a paragraph stay two paragraphs rather than running
 * together into one; a side that is empty adds nothing.
 */
export function resolveTwoVersions(block: TwoVersionsBlock, choice: TwoVersionsChoice): RangeEdit {
  let insert: string;
  if (choice === "yours") insert = block.yours;
  else if (choice === "online") insert = block.online;
  else if (!block.yours.trim() || !block.online.trim()) insert = block.yours + block.online;
  else {
    const gap = block.yours.endsWith("\n\n") || block.online.startsWith("\n") ? "" : "\n";
    insert = block.yours + gap + block.online;
  }
  return { from: block.from, to: block.to, insert };
}

/** One run of a side's text in the compare view, marked where it differs from the other side. */
export interface TextRun {
  text: string;
  changed: boolean;
}

/** Past this many words a side, the compare shows no word marks (the table would be too big). */
const WORD_DIFF_LIMIT = 400;

/**
 * The two texts as runs, with the words only one side has marked. A
 * near-identical pair — one word reworded in a long paragraph — is the
 * common case, and without this the author cannot see what differs.
 * Whitespace is never marked. Both sides come back unmarked when either is
 * too long to compare, so the view degrades to plain text, never hangs.
 */
export function markDifferences(yours: string, online: string): { yours: TextRun[]; online: TextRun[] } {
  const split = (s: string): string[] => s.split(/(\s+)/).filter((t) => t.length > 0);
  const a = split(yours);
  const b = split(online);
  const words = (tokens: string[]): number[] => tokens.map((t, i) => i).filter((i) => !/^\s+$/.test(tokens[i]!));
  const ai = words(a);
  const bi = words(b);
  const plain = { yours: [{ text: yours, changed: false }], online: [{ text: online, changed: false }] };
  if (ai.length > WORD_DIFF_LIMIT || bi.length > WORD_DIFF_LIMIT) return plain;
  // Longest common subsequence over the words (whitespace tokens ride along).
  const n = ai.length;
  const m = bi.length;
  const table = new Uint16Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * (m + 1) + j] =
        a[ai[i]!] === b[bi[j]!]
          ? table[(i + 1) * (m + 1) + j + 1]! + 1
          : Math.max(table[(i + 1) * (m + 1) + j]!, table[i * (m + 1) + j + 1]!);
    }
  }
  const keepA = new Set<number>();
  const keepB = new Set<number>();
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (a[ai[i]!] === b[bi[j]!]) {
      keepA.add(ai[i]!);
      keepB.add(bi[j]!);
      i++;
      j++;
    } else if (table[(i + 1) * (m + 1) + j]! >= table[i * (m + 1) + j + 1]!) i++;
    else j++;
  }
  // Two texts that share little are simply different texts: marking most
  // of every word says nothing, so the view shows them plain.
  if (keepA.size < ai.length * 0.4 || keepB.size < bi.length * 0.4) return plain;
  const runs = (tokens: string[], keep: Set<number>): TextRun[] => {
    const out: TextRun[] = [];
    tokens.forEach((t, i) => {
      const changed = !/^\s+$/.test(t) && !keep.has(i);
      const last = out[out.length - 1];
      if (last && last.changed === changed) last.text += t;
      else out.push({ text: t, changed });
    });
    return out;
  };
  return { yours: runs(a, keepA), online: runs(b, keepB) };
}

/** True when the two texts differ only in spacing or line breaks. */
export function differOnlyInSpacing(yours: string, online: string): boolean {
  const squash = (s: string): string => s.replace(/\s+/g, " ").trim();
  return yours !== online && squash(yours) === squash(online);
}
