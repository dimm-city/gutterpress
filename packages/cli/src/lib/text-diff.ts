/**
 * text-diff.ts — a small two-way sequence diff for the Versions view.
 *
 * Two readers: the what-changed hint on a version card ("3 paragraphs
 * changed") and the side-by-side file compare (lines aligned, changed ones
 * marked). Myers' O(ND) algorithm over any array, with a budget: when two
 * texts have almost nothing in common the edit script is as long as both
 * texts and the trace would grow with its square, so past the budget the
 * result is "everything after the common ends changed" — honest for the
 * hint, readable in the compare view, and bounded in memory. Pure, no I/O.
 */

export type DiffOp<T> =
  | { kind: "equal"; a: T; b: T }
  | { kind: "delete"; a: T }
  | { kind: "insert"; b: T };

/** Past this many edits the diff stops looking for common lines. */
const EDIT_BUDGET = 1500;

export function diffSequences<T>(a: readonly T[], b: readonly T[]): DiffOp<T>[] {
  // Common head and tail first: the usual edit touches a few lines in the
  // middle of a long file, and trimming keeps the search tiny.
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const ops: DiffOp<T>[] = [];
  for (let i = 0; i < head; i++) ops.push({ kind: "equal", a: a[i]!, b: b[i]! });
  const middle = myers(a.slice(head, a.length - tail), b.slice(head, b.length - tail));
  ops.push(...middle);
  for (let i = tail; i > 0; i--) ops.push({ kind: "equal", a: a[a.length - i]!, b: b[b.length - i]! });
  return ops;
}

function myers<T>(a: T[], b: T[]): DiffOp<T>[] {
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return [];
  const max = n + m;
  const offset = max;
  let v = new Int32Array(2 * max + 2);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= Math.min(max, EDIT_BUDGET); d++) {
    trace.push(v);
    const next = new Int32Array(v);
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)) x = v[offset + k + 1]!;
      else x = v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      next[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
    v = next;
    if (found >= 0) break;
  }
  if (found < 0) {
    // Over budget: report the whole middle as replaced.
    return [...a.map((x): DiffOp<T> => ({ kind: "delete", a: x })), ...b.map((y): DiffOp<T> => ({ kind: "insert", b: y }))];
  }
  // Walk the trace back from (n, m) to (0, 0), emitting ops in reverse.
  const reversed: DiffOp<T>[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const prev = trace[d]!;
    const k = x - y;
    let prevK: number;
    if (k === -d || (k !== d && prev[offset + k - 1]! < prev[offset + k + 1]!)) prevK = k + 1;
    else prevK = k - 1;
    const prevX = prev[offset + prevK]!;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      reversed.push({ kind: "equal", a: a[x]!, b: b[y]! });
    }
    if (x === prevX) {
      y--;
      reversed.push({ kind: "insert", b: b[y]! });
    } else {
      x--;
      reversed.push({ kind: "delete", a: a[x]! });
    }
  }
  while (x > 0 && y > 0) {
    x--;
    y--;
    reversed.push({ kind: "equal", a: a[x]!, b: b[y]! });
  }
  return reversed.reverse();
}

/**
 * How many items changed, counting an edited item once: each run of
 * deletes and inserts counts as the larger of the two, so a reworded
 * paragraph is "1 paragraph changed", not a removal plus an addition.
 */
export function countChanged<T>(ops: readonly DiffOp<T>[]): number {
  let total = 0;
  let deletes = 0;
  let inserts = 0;
  const flush = () => {
    total += Math.max(deletes, inserts);
    deletes = 0;
    inserts = 0;
  };
  for (const op of ops) {
    if (op.kind === "equal") flush();
    else if (op.kind === "delete") deletes++;
    else inserts++;
  }
  flush();
  return total;
}

/** One row of the side-by-side compare: a line on each side, or a gap. */
export interface CompareRow {
  then: string | null;
  now: string | null;
  changed: boolean;
}

/**
 * Lay a line diff out as two aligned columns: equal lines share a row;
 * within a changed run the removed and added lines pair up in order and
 * the longer side's extra lines face a gap.
 */
export function alignRows(ops: readonly DiffOp<string>[]): CompareRow[] {
  const rows: CompareRow[] = [];
  let deletes: string[] = [];
  let inserts: string[] = [];
  const flush = () => {
    const count = Math.max(deletes.length, inserts.length);
    for (let i = 0; i < count; i++) {
      rows.push({ then: deletes[i] ?? null, now: inserts[i] ?? null, changed: true });
    }
    deletes = [];
    inserts = [];
  };
  for (const op of ops) {
    if (op.kind === "equal") {
      flush();
      rows.push({ then: op.a, now: op.b, changed: false });
    } else if (op.kind === "delete") deletes.push(op.a);
    else inserts.push(op.b);
  }
  flush();
  return rows;
}

/** Split into lines for diffing; a CR before the break is not content. */
export function textLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
  // A trailing line break ends the last line; it does not start an empty one.
  if (lines[lines.length - 1] === "" ) lines.pop();
  return lines;
}
