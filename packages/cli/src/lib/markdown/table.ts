import type MarkdownIt from "markdown-it";
import type StateBlock from "markdown-it/lib/rules_block/state_block.mjs";
import { isSpace } from "markdown-it/lib/common/utils.mjs";
import type { LayoutWarning } from "./assemble";

/**
 * GFM tables, with one change to how a row is split into cells.
 *
 * This is markdown-it's own table rule (`lib/rules_block/table.mjs`, MIT,
 * Copyright (c) 2014 Vitaly Puzrin, Alex Kocharin), re-registered under the
 * same name with its `escapedSplit` replaced by {@link splitCells}:
 *
 *   - markdown-it splits a row at every unescaped `|` BEFORE any inline
 *     syntax is parsed (the GFM spec's rule), so a `|` inside a code span
 *     or a formula splits the cell, and the cells past the header's count
 *     are silently dropped. Here an inline span is opaque to the split: a
 *     code span always, and a `$…$` formula when the math feature is on
 *     (math.ts re-registers this rule with its own scanner). `\|` still
 *     escapes a pipe in plain cell text; inside a span nothing is touched,
 *     so `\|` in a formula is LaTeX's own `\|`.
 *   - a row with MORE cells than the header is reported
 *     (`table_extra_cells` on `env.layoutWarnings`, the channel Gutterpress's
 *     marker parser uses) instead of losing them without a word.
 *
 * Everything else is the upstream rule, verbatim where possible, so a table
 * renders and paginates exactly as before.
 */

/**
 * Where to resume scanning a row after the span that starts at `start`
 * (the character there is the span's opening delimiter): just past the
 * span, or just past the opening delimiter when it opens nothing. Always
 * greater than `start`.
 */
export type SpanScanner = (src: string, start: number, max: number) => number;

/** The scanners a row is split with, by the character code that opens each span. */
export type SpanScanners = Readonly<Record<number, SpanScanner>>;

/** A CommonMark code span: a run of backticks closed by a run of the same length. */
export const scanCodeSpan: SpanScanner = (src, start, max) => {
  let open = start;
  while (open < max && src.charCodeAt(open) === 0x60 /* ` */) open++;
  const length = open - start;
  let pos = open;
  while (pos < max) {
    if (src.charCodeAt(pos) !== 0x60) {
      pos++;
      continue;
    }
    let run = pos;
    while (run < max && src.charCodeAt(run) === 0x60) run++;
    if (run - pos === length) return run;
    pos = run;
  }
  return open;
};

/** What core splits with: code spans. The math feature adds `$` (math.ts). */
export const DEFAULT_SPANS: SpanScanners = { 0x60: scanCodeSpan };

function splitCells(str: string, spans: SpanScanners): string[] {
  const result: string[] = [];
  const max = str.length;
  let pos = 0;
  let lastPos = 0;
  let current = "";
  let isEscaped = false;

  while (pos < max) {
    const ch = str.charCodeAt(pos);
    if (ch === 0x7c /* | */) {
      if (!isEscaped) {
        // pipe separating cells, '|'
        result.push(current + str.substring(lastPos, pos));
        current = "";
        lastPos = pos + 1;
      } else {
        // escaped pipe, '\|'
        current += str.substring(lastPos, pos - 1);
        lastPos = pos;
      }
    } else if (!isEscaped && spans[ch]) {
      // an inline span: nothing inside it splits a cell
      pos = spans[ch]!(str, pos, max);
      continue;
    }

    isEscaped = ch === 0x5c /* \ */;
    pos++;
  }

  result.push(current + str.substring(lastPos));
  return result;
}

function getLine(state: StateBlock, line: number): string {
  const pos = state.bMarks[line]! + state.tShift[line]!;
  const max = state.eMarks[line]!;
  return state.src.slice(pos, max);
}

// Limit the amount of empty autocompleted cells in a table,
// see https://github.com/markdown-it/markdown-it/issues/1000,
//
// Both pulldown-cmark and commonmark-hs limit the number of cells this way to ~200k.
// We set it to 65k, which can expand user input by a factor of x370
// (256x256 square is 1.8kB expanded into 650kB).
const MAX_AUTOCOMPLETED_CELLS = 0x10000;

function warnExtraCells(env: { layoutWarnings?: LayoutWarning[] }, line: number, cells: number, columns: number): void {
  if (!env.layoutWarnings) env.layoutWarnings = [];
  const extra = cells - columns;
  env.layoutWarnings.push({
    line: line + 1,
    type: "table_extra_cells",
    message:
      `This row has ${cells} cells but the table has ${columns} columns, so its last ` +
      `${extra === 1 ? "cell is" : `${extra} cells are`} left out. ` +
      "A | inside a cell splits it: write \\| for a literal one.",
  });
}

function tableRule(spans: SpanScanners) {
  return function table(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
    // should have at least two lines
    if (startLine + 2 > endLine) return false;

    let nextLine = startLine + 1;

    if (state.sCount[nextLine]! < state.blkIndent) return false;

    // if it's indented more than 3 spaces, it should be a code block
    if (state.sCount[nextLine]! - state.blkIndent >= 4) return false;

    // first character of the second line should be '|', '-', ':',
    // and no other characters are allowed but spaces;
    // basically, this is the equivalent of /^[-:|][-:|\s]*$/ regexp

    let pos = state.bMarks[nextLine]! + state.tShift[nextLine]!;
    if (pos >= state.eMarks[nextLine]!) return false;

    const firstCh = state.src.charCodeAt(pos++);
    if (firstCh !== 0x7c /* | */ && firstCh !== 0x2d /* - */ && firstCh !== 0x3a /* : */) return false;

    if (pos >= state.eMarks[nextLine]!) return false;

    const secondCh = state.src.charCodeAt(pos++);
    if (secondCh !== 0x7c /* | */ && secondCh !== 0x2d /* - */ && secondCh !== 0x3a /* : */ && !isSpace(secondCh)) {
      return false;
    }

    // if first character is '-', then second character must not be a space
    // (due to parsing ambiguity with list)
    if (firstCh === 0x2d /* - */ && isSpace(secondCh)) return false;

    while (pos < state.eMarks[nextLine]!) {
      const ch = state.src.charCodeAt(pos);

      if (ch !== 0x7c /* | */ && ch !== 0x2d /* - */ && ch !== 0x3a /* : */ && !isSpace(ch)) return false;

      pos++;
    }

    let lineText = getLine(state, startLine + 1);
    let columns = lineText.split("|");
    const aligns: string[] = [];
    for (let i = 0; i < columns.length; i++) {
      const t = columns[i]!.trim();
      if (!t) {
        // allow empty columns before and after table, but not in between columns;
        // e.g. allow ` |---| `, disallow ` ---||--- `
        if (i === 0 || i === columns.length - 1) {
          continue;
        } else {
          return false;
        }
      }

      if (!/^:?-+:?$/.test(t)) return false;
      if (t.charCodeAt(t.length - 1) === 0x3a /* : */) {
        aligns.push(t.charCodeAt(0) === 0x3a /* : */ ? "center" : "right");
      } else if (t.charCodeAt(0) === 0x3a /* : */) {
        aligns.push("left");
      } else {
        aligns.push("");
      }
    }

    lineText = getLine(state, startLine).trim();
    if (lineText.indexOf("|") === -1) return false;
    if (state.sCount[startLine]! - state.blkIndent >= 4) return false;
    columns = splitCells(lineText, spans);
    if (columns.length && columns[0] === "") columns.shift();
    if (columns.length && columns[columns.length - 1] === "") columns.pop();

    // header row will define an amount of columns in the entire table,
    // and align row should be exactly the same (the rest of the rows can differ)
    const columnCount = columns.length;
    if (columnCount === 0 || columnCount !== aligns.length) return false;

    if (silent) return true;

    const oldParentType = state.parentType;
    state.parentType = "table" as StateBlock["parentType"];

    // use 'blockquote' lists for termination because it's
    // the most similar to tables
    const terminatorRules = state.md.block.ruler.getRules("blockquote");

    const token_to = state.push("table_open", "table", 1);
    const tableLines: [number, number] = [startLine, 0];
    token_to.map = tableLines;

    const token_tho = state.push("thead_open", "thead", 1);
    token_tho.map = [startLine, startLine + 1];

    const token_htro = state.push("tr_open", "tr", 1);
    token_htro.map = [startLine, startLine + 1];

    for (let i = 0; i < columns.length; i++) {
      const token_ho = state.push("th_open", "th", 1);
      if (aligns[i]) {
        token_ho.attrs = [["style", "text-align:" + aligns[i]]];
      }

      const token_il = state.push("inline", "", 0);
      token_il.content = columns[i]!.trim();
      token_il.children = [];

      state.push("th_close", "th", -1);
    }

    state.push("tr_close", "tr", -1);
    state.push("thead_close", "thead", -1);

    let tbodyLines: [number, number] | undefined;
    let autocompletedCells = 0;

    for (nextLine = startLine + 2; nextLine < endLine; nextLine++) {
      if (state.sCount[nextLine]! < state.blkIndent) break;

      let terminate = false;
      for (let i = 0, l = terminatorRules.length; i < l; i++) {
        if (terminatorRules[i]!(state, nextLine, endLine, true)) {
          terminate = true;
          break;
        }
      }

      if (terminate) break;
      lineText = getLine(state, nextLine).trim();
      if (!lineText) break;
      if (state.sCount[nextLine]! - state.blkIndent >= 4) break;
      columns = splitCells(lineText, spans);
      if (columns.length && columns[0] === "") columns.shift();
      if (columns.length && columns[columns.length - 1] === "") columns.pop();

      if (columns.length > columnCount) {
        warnExtraCells(state.env, nextLine, columns.length, columnCount);
      }

      // note: autocomplete count can be negative if user specifies more columns than header,
      // but that does not affect intended use (which is limiting expansion)
      autocompletedCells += columnCount - columns.length;
      if (autocompletedCells > MAX_AUTOCOMPLETED_CELLS) break;

      if (nextLine === startLine + 2) {
        const token_tbo = state.push("tbody_open", "tbody", 1);
        token_tbo.map = tbodyLines = [startLine + 2, 0];
      }

      const token_tro = state.push("tr_open", "tr", 1);
      token_tro.map = [nextLine, nextLine + 1];

      for (let i = 0; i < columnCount; i++) {
        const token_tdo = state.push("td_open", "td", 1);
        if (aligns[i]) {
          token_tdo.attrs = [["style", "text-align:" + aligns[i]]];
        }

        const token_il = state.push("inline", "", 0);
        token_il.content = columns[i] ? columns[i]!.trim() : "";
        token_il.children = [];

        state.push("td_close", "td", -1);
      }
      state.push("tr_close", "tr", -1);
    }

    if (tbodyLines) {
      state.push("tbody_close", "tbody", -1);
      tbodyLines[1] = nextLine;
    }

    state.push("table_close", "table", -1);
    tableLines[1] = nextLine;

    state.parentType = oldParentType;
    state.line = nextLine;
    return true;
  };
}

/**
 * Replace markdown-it's table rule with the span-aware one. Core applies it
 * with code spans; a feature that adds an inline span (math) applies it
 * again with its own scanner added, and the later registration wins.
 * `at` resets the rule's `alt` chains, so upstream's are given again: a
 * table may interrupt a paragraph.
 */
export function gpTable(md: MarkdownIt, options?: { spans?: SpanScanners }): void {
  md.block.ruler.at("table", tableRule(options?.spans ?? DEFAULT_SPANS), { alt: ["paragraph", "reference"] });
}
