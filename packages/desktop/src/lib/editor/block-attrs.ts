/**
 * block-attrs — token-preserving editing of a MARKER BLOCK's properties
 * (`@section …`, `@skill`, `@gear …`, any marker line), the sibling of
 * `image-classes.ts` for the Block properties dialog.
 *
 * Four facets, each a small edit that leaves every other byte of the file
 * alone:
 *
 *   - **Classes** — a modifier class (`.gp-no-break`, a plugin's
 *     `.dc-avoid-split`) is added to or removed from the marker line. The line
 *     is tokenized exactly the way core's `parseMarkerLine` tokenizes it
 *     (whitespace-split, quotes respected, one layer of markdown-it-attrs
 *     braces per token), so the compact `.cls` and brace `{.cls}` spellings,
 *     `#id`, `key=value`, a quoted `label="…"` and the variant word all
 *     survive untouched and in order. Only the one class token changes.
 *   - **Break before** — a `@page-break` line directly above the block.
 *   - **Columns** — the block's content wrapped in `@columns N` … `@end-columns`.
 *
 * Which classes are on offer is NOT decided here: the caller passes class
 * names, so core's vocabulary and every plugin's catalog use one code path.
 *
 * PWA-clean and Svelte-free (CLAUDE.md §8): pure strings in, pure strings out,
 * directly `bun test`-able. The result of an edit is a minimal LINE patch
 * (`range`/`expected`/`replacement`), the exact shape the commit engine and the
 * source editor both apply.
 */

// ── Lines ────────────────────────────────────────────────────────────────────

interface SourceLine {
  text: string;
  /** The line break that ends this line ("" on the last line). */
  eol: string;
}

/**
 * Split on the same line breaks markdown-it and `source-range.ts` use
 * (`\r\n?|\n`), keeping each break with its line. The last entry is the text
 * after the final break (possibly empty), so entry `i` starts where
 * `buildLineStarts()[i]` does.
 */
function splitLines(source: string): SourceLine[] {
  const lines: SourceLine[] = [];
  const re = /\r\n?|\n/g;
  let from = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    lines.push({ text: source.slice(from, m.index), eol: m[0] });
    from = m.index + m[0].length;
  }
  lines.push({ text: source.slice(from), eol: "" });
  return lines;
}

function joinLines(lines: readonly SourceLine[]): string {
  return lines.map((l) => l.text + l.eol).join("");
}

/** The document's own line break, so inserted lines match it. */
function documentEol(lines: readonly SourceLine[]): string {
  return lines.find((l) => l.eol)?.eol ?? "\n";
}

const isBlank = (line: SourceLine): boolean => line.text.trim() === "";

/**
 * Lines inside a fenced code block (fence lines included): a `@section` shown
 * in a ``` example is not a marker. CommonMark fences: 3+ backticks or tildes,
 * closed by at least as many of the same character.
 */
function fenceMask(lines: readonly SourceLine[]): boolean[] {
  const mask = lines.map(() => false);
  let open: { char: string; length: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]!.text;
    if (open) {
      mask[i] = true;
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(text);
      if (close && close[1]![0] === open.char && close[1]!.length >= open.length) open = null;
    } else {
      const start = /^ {0,3}(`{3,}|~{3,})/.exec(text);
      if (start) {
        mask[i] = true;
        open = { char: start[1]![0]!, length: start[1]!.length };
      }
    }
  }
  return mask;
}

// ── The marker line ──────────────────────────────────────────────────────────

/** One whitespace-delimited argument of a marker line, by position in the line. */
interface MarkerToken {
  /** Span of the whole token (quotes and braces included). */
  start: number;
  end: number;
  /** Span without ONE leading `{` and ONE trailing `}` — the part the parser reads. */
  bodyStart: number;
  bodyEnd: number;
  /** The token opens / closes a markdown-it-attrs brace group. */
  opens: boolean;
  closes: boolean;
}

interface MarkerLine {
  text: string;
  /** Marker name without `@` (`section`, `end-section`, `skill`). */
  name: string;
  /** Offset just past the `@name` head. */
  headEnd: number;
  tokens: MarkerToken[];
}

/**
 * Tokenize a marker line the way `parseMarkerLine` does: split on whitespace,
 * except inside quotes (opened by any `"`/`'`, closed by the same character).
 * The offsets point into the ORIGINAL text, so an edit can splice exactly one
 * token and leave the rest of the line byte-for-byte alone.
 */
export function parseMarkerLine(text: string): MarkerLine | null {
  const lead = /^\s*/.exec(text)![0].length;
  if (text[lead] !== "@") return null;
  const spans: Array<[number, number]> = [];
  let quote = "";
  let tokenStart = -1;
  for (let i = lead; i <= text.length; i++) {
    const ch = text[i];
    const space = ch === undefined || (!quote && /\s/.test(ch));
    if (space) {
      if (tokenStart >= 0) spans.push([tokenStart, i]);
      tokenStart = -1;
      continue;
    }
    if (tokenStart < 0) tokenStart = i;
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    }
  }
  const [head, ...rest] = spans;
  if (!head) return null;
  const name = text.slice(head[0] + 1, head[1]);
  if (!/^[A-Za-z][\w-]*$/.test(name)) return null;
  const tokens: MarkerToken[] = rest.map(([start, end]) => {
    const raw = text.slice(start, end);
    const opens = raw.startsWith("{");
    const closes = raw.endsWith("}");
    // A token that is nothing but braces has no body the parser would read
    // (it leaves such a token as written), so it is opaque to every edit.
    const bodyLength = raw.length - (opens ? 1 : 0) - (closes ? 1 : 0);
    if (bodyLength <= 0) {
      return { start, end, bodyStart: start, bodyEnd: end, opens: false, closes: false };
    }
    return {
      start,
      end,
      bodyStart: start + (opens ? 1 : 0),
      bodyEnd: end - (closes ? 1 : 0),
      opens,
      closes,
    };
  });
  return { text, name, headEnd: head[1], tokens };
}

/** A marker line a block can be edited through: not a closer, break or `@continue`. */
export function isBlockMarkerName(name: string): boolean {
  return !(name.startsWith("end-") || name === "page-break" || name === "column-break" || name === "continue");
}

const body = (m: MarkerLine, t: MarkerToken): string => m.text.slice(t.bodyStart, t.bodyEnd);

/** `class=a,b` / `class="a b"` → its words, or null when the token is not a class attribute. */
function classAttrWords(raw: string): string[] | null {
  if (!raw.startsWith("class=")) return null;
  const value = raw.slice("class=".length).replace(/^(["'])(.*)\1$/, "$2");
  return value.split(/[,\s]+/).filter(Boolean);
}

/** Every class the marker line writes: `.cls` tokens and `class=` values, in order. */
export function markerLineClasses(text: string): string[] {
  const marker = parseMarkerLine(text);
  if (!marker) return [];
  const out: string[] = [];
  for (const token of marker.tokens) {
    const raw = body(marker, token);
    if (raw.startsWith(".")) {
      if (raw.length > 1) out.push(raw.slice(1));
    } else {
      out.push(...(classAttrWords(raw) ?? []));
    }
  }
  return out;
}

export function markerLineHasClass(text: string, cls: string): boolean {
  return markerLineClasses(text).includes(cls);
}

function splice(text: string, from: number, to: number, insert: string): string {
  return text.slice(0, from) + insert + text.slice(to);
}

/** Start of the whitespace run that ends at `at`. */
function whitespaceBefore(text: string, at: number): number {
  let i = at;
  while (i > 0 && /\s/.test(text[i - 1]!)) i--;
  return i;
}

/** Remove one `.cls` token (or class word), keeping the brace group around it intact. */
function removeClassToken(marker: MarkerLine, index: number, cls: string): string {
  const { text, tokens } = marker;
  const token = tokens[index]!;
  const raw = body(marker, token);

  if (!raw.startsWith(".")) {
    // class="a b": drop the one word and its separator; drop the attribute when none is left.
    const value = raw.slice("class=".length);
    const quote = /^["']/.test(value) ? value[0]! : "";
    const inner = quote ? value.slice(1, quote && value.endsWith(quote) ? -1 : undefined) : value;
    const parts = inner.split(/([,\s]+)/);
    const at = parts.findIndex((p, i) => i % 2 === 0 && p === cls);
    if (at === -1) return text;
    const words = parts.filter((_, i) => i % 2 === 0).filter(Boolean);
    if (words.length === 1) return removeWholeToken(marker, index);
    // Remove the word with the separator before it (after it, when it is first).
    if (at > 0) parts.splice(at - 1, 2);
    else parts.splice(at, 2);
    return splice(text, token.bodyStart, token.bodyEnd, `class=${quote}${parts.join("")}${quote}`);
  }
  return removeWholeToken(marker, index);
}

function removeWholeToken(marker: MarkerLine, index: number): string {
  const { text, tokens } = marker;
  const token = tokens[index]!;
  if (token.opens && token.closes) {
    // `{.cls}`: the whole group goes.
    return splice(text, whitespaceBefore(text, token.start), token.end, "");
  }
  if (token.opens) {
    // `{.cls .b}`: keep the `{`, drop the word and the space after it → `{.b}`.
    const next = tokens[index + 1];
    const to = next ? next.start : token.end;
    return splice(text, token.bodyStart, to, "");
  }
  // Plain or closing token: drop it with the space before it; a closing `}` stays.
  const from = whitespaceBefore(text, token.bodyStart - (token.opens ? 1 : 0));
  return splice(text, from, token.bodyEnd, "");
}

/**
 * Add (`on`) or remove (`!on`) one class on a marker line. Adding a class that
 * is already written is a no-op, as is removing one that is not, so a toggle
 * repeated is a toggle undone and re-applying a dialog never rewrites the line.
 *
 * A new class goes at the end of the line — inside the closing brace when the
 * line already ends a `{…}` group, so a `{.a .b}` author keeps writing braces.
 */
export function setMarkerLineClass(text: string, cls: string, on: boolean): string {
  let marker = parseMarkerLine(text);
  if (!marker || !/^[A-Za-z_][\w-]*$/.test(cls)) return text;
  if (!on) {
    // Remove every spelling of it, last first so earlier offsets stay valid.
    for (let i = marker.tokens.length - 1; i >= 0; i--) {
      const raw = body(marker, marker.tokens[i]!);
      const writes = raw === `.${cls}` || classAttrWords(raw)?.includes(cls);
      if (!writes) continue;
      text = removeClassToken(marker, i, cls);
      marker = parseMarkerLine(text);
      if (!marker) return text;
    }
    return text;
  }
  if (markerLineHasClass(text, cls)) return text;
  const last = marker.tokens[marker.tokens.length - 1];
  if (!last) return splice(text, marker.headEnd, marker.headEnd, ` .${cls}`);
  const insideGroup = last.closes && marker.tokens.some((t) => t.opens);
  return insideGroup
    ? splice(text, last.bodyEnd, last.bodyEnd, ` .${cls}`)
    : splice(text, last.end, last.end, ` .${cls}`);
}

// ── @columns count ───────────────────────────────────────────────────────────

export const COLUMN_COUNTS = [1, 2, 3, 4, 5] as const;

/** The bare word of a marker line (its variant / name): the first token that is not `.`, `#` or `key=`. */
function bareTokenIndex(marker: MarkerLine): number {
  return marker.tokens.findIndex((t) => {
    const raw = body(marker, t);
    return raw !== "" && !raw.includes("=") && !raw.startsWith(".") && !raw.startsWith("#");
  });
}

/**
 * The column count a `@columns` line asks for: its bare word when that is
 * 1–5, 2 for a bare `@columns` (core's default), null for anything else.
 */
export function columnsLineCount(text: string): number | null {
  const marker = parseMarkerLine(text);
  if (!marker || marker.name !== "columns") return null;
  const at = bareTokenIndex(marker);
  if (at === -1) return 2;
  const word = body(marker, marker.tokens[at]!);
  return /^[1-5]$/.test(word) ? Number(word) : null;
}

/** Set a `@columns` line's count, keeping its classes, id and attributes. */
export function setColumnsLineCount(text: string, count: number): string {
  const marker = parseMarkerLine(text);
  if (!marker || marker.name !== "columns" || !COLUMN_COUNTS.includes(count as 1)) return text;
  if (columnsLineCount(text) === count) return text;
  const at = bareTokenIndex(marker);
  if (at === -1) return splice(text, marker.headEnd, marker.headEnd, ` ${count}`);
  const token = marker.tokens[at]!;
  return splice(text, token.bodyStart, token.bodyEnd, String(count));
}

// ── Block structure ──────────────────────────────────────────────────────────

function markerAt(lines: readonly SourceLine[], mask: readonly boolean[], i: number): MarkerLine | null {
  return mask[i] ? null : parseMarkerLine(lines[i]!.text);
}

/**
 * The line that closes the block opened at `open` (`@end-<name>`), counting
 * nested openers of the same name, or null when the block has no explicit end.
 */
function findBlockEnd(
  lines: readonly SourceLine[],
  mask: readonly boolean[],
  open: number,
  name: string,
): number | null {
  let depth = 1;
  for (let i = open + 1; i < lines.length; i++) {
    const marker = markerAt(lines, mask, i);
    if (!marker) continue;
    if (marker.name === name) depth++;
    else if (marker.name === `end-${name}` && --depth === 0) return i;
  }
  return null;
}

/** Indexes of the `@page-break` lines directly above `line`, blank lines between them allowed. */
function breaksAbove(lines: readonly SourceLine[], mask: readonly boolean[], line: number): number[] {
  const found: number[] = [];
  for (let i = line - 1; i >= 0; i--) {
    if (isBlank(lines[i]!)) continue;
    if (markerAt(lines, mask, i)?.name !== "page-break") break;
    found.push(i);
  }
  return found.reverse();
}

export type ColumnsState =
  /** The block cannot hold a columns run; `reason` says why, for the dialog. */
  | { kind: "unavailable"; reason: string }
  /** Nothing wraps the block's content. */
  | { kind: "none" }
  /** `@columns N` … `@end-columns` wraps all of the block's content (`count` null: an unrecognized count word). */
  | { kind: "wrapped"; count: number | null }
  /** The content has its own `@columns` run(s) that do not wrap all of it. */
  | { kind: "partial" };

export interface BlockInfo {
  /** 0-based marker line. */
  line: number;
  /** Marker name without `@`. */
  name: string;
  classes: string[];
  breakBefore: boolean;
  columns: ColumnsState;
}

export interface BlockOptions {
  /** The marker emits one element and closes itself (no `@end-<name>`): it has no content to put in columns. */
  selfClosing?: boolean;
}

interface Located {
  lines: SourceLine[];
  mask: boolean[];
  marker: MarkerLine;
  /** Index of the closing `@end-<name>` line, or null. */
  end: number | null;
}

function locate(source: string, line: number, opts: BlockOptions): Located | null {
  const lines = splitLines(source);
  if (!Number.isInteger(line) || line < 0 || line >= lines.length) return null;
  const mask = fenceMask(lines);
  const marker = markerAt(lines, mask, line);
  if (!marker || !isBlockMarkerName(marker.name)) return null;
  const end = opts.selfClosing ? null : findBlockEnd(lines, mask, line, marker.name);
  return { lines, mask, marker, end };
}

function columnsState(at: Located, line: number, opts: BlockOptions): ColumnsState {
  const { lines, mask, marker, end } = at;
  if (marker.name === "columns") return { kind: "unavailable", reason: "This marker is the columns run itself." };
  if (opts.selfClosing) return { kind: "unavailable", reason: `@${marker.name} has no content to put in columns.` };
  if (end === null) return { kind: "unavailable", reason: `Add an @end-${marker.name} line to put its content in columns.` };

  let first = -1;
  let last = -1;
  for (let i = line + 1; i < end; i++) {
    if (isBlank(lines[i]!)) continue;
    if (first === -1) first = i;
    last = i;
  }
  if (first === -1) return { kind: "none" };

  const inner: number[] = [];
  for (let i = first; i <= last; i++) if (markerAt(lines, mask, i)?.name === "columns") inner.push(i);
  if (inner.length === 0) return { kind: "none" };
  if (inner[0] === first && findBlockEnd(lines, mask, first, "columns") === last) {
    // The wrapper covers the content; a second run inside it is its own business.
    return { kind: "wrapped", count: columnsLineCount(lines[first]!.text) };
  }
  return { kind: "partial" };
}

/**
 * What the Block properties dialog shows for the marker on `line` (0-based) of
 * `source`, or null when that line is not a marker a block can be edited
 * through (a closer, a break, text, a line inside a code fence).
 */
export function readBlock(source: string, line: number, opts: BlockOptions = {}): BlockInfo | null {
  const at = locate(source, line, opts);
  if (!at) return null;
  return {
    line,
    name: at.marker.name,
    classes: markerLineClasses(at.lines[line]!.text),
    breakBefore: breaksAbove(at.lines, at.mask, line).length > 0,
    columns: columnsState(at, line, opts),
  };
}

// ── Edits ────────────────────────────────────────────────────────────────────

/** What the dialog changes. Omitted facets are left exactly as written. */
export interface BlockChanges {
  /** Class → wanted on the marker line. Classes not listed are never touched. */
  classes?: Readonly<Record<string, boolean>>;
  breakBefore?: boolean;
  /** 1–5 wraps the block's content in `@columns N` (or changes N); null removes the wrapper. */
  columns?: number | null;
}

/** A minimal LINE patch: `range` is the half-open 0-based line range `expected` came from. */
export interface LinePatch {
  range: [number, number];
  expected: string;
  replacement: string;
}

export type BlockEditResult =
  | { ok: true; patch: LinePatch | null }
  | { ok: false; reason: string };

/** The smallest line patch turning `before` into `after`; null when they are the same. */
function diffLines(before: readonly SourceLine[], after: readonly SourceLine[]): LinePatch | null {
  const same = (a: SourceLine, b: SourceLine): boolean => a.text === b.text && a.eol === b.eol;
  let head = 0;
  while (head < before.length && head < after.length && same(before[head]!, after[head]!)) head++;
  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    same(before[before.length - 1 - tail]!, after[after.length - 1 - tail]!)
  ) tail++;
  const oldEnd = before.length - tail;
  const newEnd = after.length - tail;
  if (head === oldEnd && head === newEnd) return null;
  return {
    range: [head, oldEnd],
    expected: joinLines(before.slice(head, oldEnd)),
    replacement: joinLines(after.slice(head, newEnd)),
  };
}

function wrapInColumns(lines: SourceLine[], open: number, end: number, count: number, eol: string): void {
  let first = -1;
  let last = -1;
  for (let i = open + 1; i < end; i++) {
    if (isBlank(lines[i]!)) continue;
    if (first === -1) first = i;
    last = i;
  }
  if (first === -1) {
    lines.splice(open + 1, 0,
      { text: `@columns ${count}`, eol },
      { text: "", eol },
      { text: "@end-columns", eol },
    );
    return;
  }
  // Below first, so the upper index stays valid.
  lines.splice(last + 1, 0, { text: "", eol }, { text: "@end-columns", eol });
  lines.splice(first, 0, { text: `@columns ${count}`, eol }, { text: "", eol });
}

function unwrapColumns(lines: SourceLine[], open: number, end: number): void {
  let first = -1;
  let last = -1;
  for (let i = open + 1; i < end; i++) {
    if (isBlank(lines[i]!)) continue;
    if (first === -1) first = i;
    last = i;
  }
  const drop = new Set<number>([first, last]);
  // The blank lines wrapping added around the run go with it.
  if (first + 1 < last && isBlank(lines[first + 1]!)) drop.add(first + 1);
  if (last - 1 > first && isBlank(lines[last - 1]!)) drop.add(last - 1);
  for (const i of [...drop].sort((a, b) => b - a)) lines.splice(i, 1);
}

/**
 * Plan the edit that applies `changes` to the marker on `line` of `source`.
 * `{ ok: true, patch: null }` means the block already reads that way — the
 * dialog was confirmed unchanged, or each toggle was already in the wanted
 * state — so there is nothing to write.
 */
export function planBlockEdit(
  source: string,
  line: number,
  changes: BlockChanges,
  opts: BlockOptions = {},
): BlockEditResult {
  const at = locate(source, line, opts);
  if (!at) return { ok: false, reason: "This line is not a marker." };
  const before = at.lines;
  const lines = before.map((l) => ({ ...l }));
  const eol = documentEol(lines);
  let marker = line;

  if (changes.columns !== undefined) {
    const state = columnsState(at, line, opts);
    const want = changes.columns;
    if (want !== null && !COLUMN_COUNTS.includes(want as 1)) {
      return { ok: false, reason: "Columns must be 1 to 5." };
    }
    if (state.kind === "unavailable") {
      if (want !== null) return { ok: false, reason: state.reason };
    } else if (state.kind === "partial") {
      return { ok: false, reason: "This block has its own @columns run; change it in the source." };
    } else if (state.kind === "none") {
      if (want !== null) wrapInColumns(lines, line, at.end!, want, eol);
    } else if (want === null) {
      unwrapColumns(lines, line, at.end!);
    } else {
      const first = lines.findIndex((l, i) => i > line && !isBlank(l));
      lines[first]!.text = setColumnsLineCount(lines[first]!.text, want);
    }
  }

  for (const [cls, on] of Object.entries(changes.classes ?? {})) {
    lines[marker]!.text = setMarkerLineClass(lines[marker]!.text, cls, on);
  }

  if (changes.breakBefore !== undefined) {
    const mask = fenceMask(lines);
    const above = breaksAbove(lines, mask, marker);
    if (changes.breakBefore && above.length === 0) {
      lines.splice(marker, 0, { text: "@page-break", eol }, { text: "", eol });
      marker += 2;
    } else if (!changes.breakBefore && above.length > 0) {
      // The break lines and the blank lines between them and the block go; blank lines above stay.
      lines.splice(above[0]!, marker - above[0]!);
      marker = above[0]!;
    }
  }

  return { ok: true, patch: diffLines(before, lines) };
}
