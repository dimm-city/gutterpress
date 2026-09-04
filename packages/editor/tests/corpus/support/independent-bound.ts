import { expect } from "bun:test";
import type { EditorCommand } from "../../../src/core/commands.ts";
import type { SourceEdit } from "../../../src/core/contracts.ts";
import type { CommandSelection } from "./command-harness.ts";

/**
 * SFE-P2a round-1 repair — the genuinely INDEPENDENT upper-bound oracle
 * `locality.test.ts`'s original assertions were missing (finding: "the
 * edit-locality corpus cannot fail — its 'independent splice' oracle is
 * the host's own splice expression"). `spliceIndependently` (in
 * `command-harness.ts`) proves only `A === A`: it is byte-for-byte the same
 * `text.slice(0,from)+insert+text.slice(to)` formula `src/core/
 * apply-edit.ts` itself applies, so no edit — however wide — could ever
 * fail that check. This module is a SEPARATE, hand-written line scanner
 * (deliberately not importing `src/web/standard/line-utils.ts`) that
 * computes, per command family, the WIDEST range that command's own
 * documented contract allows an edit to touch, and asserts the actual
 * edit fits inside it. A sabotaged command that widened every edit to
 * `{from: 0, to: text.length, insert: <full rewritten document>}` (the
 * G-12 sabotage demonstration used to prove the original assertions were
 * dead) fails EVERY bound below except `set-heading`'s and `insert-link`/
 * `insert-image`'s on a single-line fixture — a real, demonstrated
 * regression catch, not a restatement of the implementation under test.
 */

function lineStart(text: string, offset: number): number {
  let i = offset;
  while (i > 0 && text.charAt(i - 1) !== "\n") i--;
  return i;
}

function lineEnd(text: string, offset: number): number {
  let i = offset;
  while (i < text.length && text.charAt(i) !== "\n") i++;
  return i;
}

const WRAP_MAX_MARKER_LEN: Partial<Record<EditorCommand["kind"], number>> = {
  "toggle-bold": 2, // "**" / "__"
  "toggle-italic": 1, // "*" / "_"
  "toggle-strike": 2, // "~~"
  "toggle-inline-code": 1, // "`"
};

/**
 * Asserts `edit` falls within the widest range `command`'s own documented
 * contract permits for a selection `[start, endExclusive)` against the
 * PRE-edit `text` — computed independently of every module under test.
 *
 * Bound tightness by family (see each module's own header for why):
 *  - Wrap toggles (bold/italic/strike/inline-code): `wrapInline` only ever
 *    reaches `maxMarkerLen` characters beyond either selection boundary.
 *  - `toggle-blockquote`, `toggle-code-block`, and `toggle-list`
 *    bullet/task: EXACT — these never extend past the touched lines'
 *    own span (`blockquote.ts`/`code-block.ts`/`list.ts`'s
 *    `toggleFixedMarker`), so `edit.from`/`edit.to` must equal the
 *    independently-scanned line boundaries precisely.
 *  - `toggle-list` ordered: MAY legitimately extend into a directly
 *    adjacent pre-existing numbered run (`list.ts`'s `toggleOrdered` doc
 *    comment) — bounded to "still line-aligned", not exact equality.
 *  - `insert-link`/`insert-image`: EXACT — always `[start, endExclusive)`.
 *  - `insert-horizontal-rule`/`insert-table`: EXACT — always the single
 *    point `lineEnd(start)` (a caret insertion, `from === to`).
 *  - `set-heading`: bounded to the caret's own line plus AT MOST one
 *    adjacent line either direction (the setext pair's text/underline
 *    line, whichever the caret is not directly on).
 */
export function assertEditWithinIndependentBound(
  command: EditorCommand,
  text: string,
  selection: CommandSelection,
  edit: SourceEdit,
): void {
  const { start, endExclusive } = selection;

  switch (command.kind) {
    case "toggle-bold":
    case "toggle-italic":
    case "toggle-strike":
    case "toggle-inline-code": {
      const maxLen = WRAP_MAX_MARKER_LEN[command.kind]!;
      expect(edit.from).toBeGreaterThanOrEqual(start - maxLen);
      expect(edit.to).toBeLessThanOrEqual(endExclusive + maxLen);
      return;
    }
    case "toggle-blockquote":
    case "toggle-code-block": {
      expect(edit.from).toBe(lineStart(text, start));
      expect(edit.to).toBe(lineEnd(text, endExclusive));
      return;
    }
    case "toggle-list": {
      if (command.variant === "ordered") {
        expect(edit.from === 0 || text.charAt(edit.from - 1) === "\n").toBe(true);
        expect(edit.to === text.length || text.charAt(edit.to) === "\n").toBe(true);
      } else {
        expect(edit.from).toBe(lineStart(text, start));
        expect(edit.to).toBe(lineEnd(text, endExclusive));
      }
      return;
    }
    case "insert-link":
    case "insert-image": {
      expect(edit.from).toBe(start);
      expect(edit.to).toBe(endExclusive);
      return;
    }
    case "insert-horizontal-rule":
    case "insert-table": {
      const point = lineEnd(text, start);
      expect(edit.from).toBe(point);
      expect(edit.to).toBe(point);
      return;
    }
    case "set-heading": {
      const caretLineStart = lineStart(text, start);
      const caretLineEnd = lineEnd(text, start);
      const prevStart = caretLineStart > 0 ? lineStart(text, caretLineStart - 1) : caretLineStart;
      const nextEnd = caretLineEnd < text.length ? lineEnd(text, caretLineEnd + 1) : caretLineEnd;
      expect(edit.from).toBeGreaterThanOrEqual(prevStart);
      expect(edit.to).toBeLessThanOrEqual(nextEnd);
      return;
    }
  }
}

/**
 * A fixed, deterministic set of selection SHAPES beyond whole-document
 * (finding: "every case uses a whole-document selection" — 232 of 304
 * cases had `edit.from === 0 && edit.to === text.length`, collapsing the
 * locality checks to `startsWith("")`/`endsWith("")`). Not every shape
 * exists in every fixture (a one-line fixture offers no cross-line
 * selection); callers get back only the shapes this particular `text`
 * actually supports.
 */
export interface SelectionVariant {
  readonly label: string;
  readonly selection: CommandSelection;
}

export function selectionVariants(text: string): readonly SelectionVariant[] {
  const len = text.length;
  const lines: Array<{ start: number; end: number }> = [];
  let start = 0;
  for (let i = 0; i <= len; i++) {
    if (i === len || text.charAt(i) === "\n") {
      lines.push({ start, end: i });
      start = i + 1;
    }
  }

  const variants: SelectionVariant[] = [
    { label: "caret at document start", selection: { start: 0, endExclusive: 0 } },
    { label: "caret at document end", selection: { start: len, endExclusive: len } },
    { label: "whole document", selection: { start: 0, endExclusive: len } },
  ];

  const midLine = lines[Math.floor(lines.length / 2)];
  if (midLine) {
    const caret = Math.floor((midLine.start + midLine.end) / 2);
    variants.push({ label: "caret mid-document", selection: { start: caret, endExclusive: caret } });
  }

  const interiorLine = lines.find((l) => l.end - l.start >= 3);
  if (interiorLine) {
    variants.push({
      label: "selection strictly inside one line's interior",
      selection: { start: interiorLine.start + 1, endExclusive: interiorLine.end - 1 },
    });
  }

  for (let i = 0; i < lines.length - 1; i++) {
    const a = lines[i]!;
    const b = lines[i + 1]!;
    if (a.end > a.start && b.end > b.start) {
      variants.push({
        label: "selection crossing a line boundary",
        selection: {
          start: a.start + Math.floor((a.end - a.start) / 2),
          endExclusive: b.start + Math.ceil((b.end - b.start) / 2),
        },
      });
      break;
    }
  }

  return variants;
}
