/**
 * The Online tab's summaries (routes/version-timeline.ts): the Waiting rows
 * (automatic runs folded, file names as written) and the Saved versions
 * summary (today's automatic versions, the newest named ones).
 */
import { describe, expect, test } from "bun:test";
import { savedSummary, waitingRows, whenRange, type ChangedFiles } from "../../src/lib/routes/version-timeline";
import type { SnapshotEntry } from "../../src/lib/api";

const MIN = 60_000;
// Noon local time, so a run of minutes never crosses midnight.
const NOW = new Date(2026, 10, 12, 12, 0).getTime();
const v = (id: string, minutesAgo: number, message = "Automatic version", author?: string): SnapshotEntry => ({ id, message, timestamp: NOW - minutesAgo * MIN, ...(author ? { author } : {}) });
const files = (...paths: string[]): ChangedFiles => ({ files: paths.map((path) => ({ path, hint: "1 paragraph changed" })), more: 0 });

describe("waitingRows", () => {
  test("consecutive automatic versions fold into one row with every file they touched; a named one stands alone", () => {
    const entries = [v("a3", 1), v("a2", 2), v("a1", 4), v("n", 6, "New opening paragraph"), v("b1", 9)];
    const changes: Record<string, ChangedFiles> = { a3: files("ch19.md"), a2: files("ch05.md", "ch19.md"), a1: files("ch05.md"), n: files("ch14.md"), b1: files("ch04.md") };
    const rows = waitingRows(entries, (e) => changes[e.id]);
    expect(rows.map((r) => [r.id, r.title, r.count, r.named])).toEqual([
      ["a3", "3 automatic versions", 3, false],
      ["n", "New opening paragraph", 1, true],
      ["b1", "Automatic version", 1, false],
    ]);
    expect(rows[0]).toMatchObject({ files: ["ch19.md", "ch05.md"], more: 0, partial: false, from: NOW - 4 * MIN, to: NOW - MIN });
    expect(rows[0]!.hint).toBeUndefined();
    // One version of one file says how much changed.
    expect(rows[1]).toMatchObject({ files: ["ch14.md"], hint: "1 paragraph changed" });
  });

  test("file names stay as written, a few at most, with the rest counted", () => {
    const [row] = waitingRows([v("x", 1)], () => ({ files: ["images/plate-1.png", "images/plate-2.png", "images/plate-3.png", "images/plate-4.png"].map((path) => ({ path })), more: 7 }));
    expect(row).toMatchObject({ files: ["images/plate-1.png", "images/plate-2.png", "images/plate-3.png"], more: 8 });
  });

  test("versions not looked at yet mark the row partial; runs split by author", () => {
    const rows = waitingRows([v("g2", 1, "Automatic version", "Grace"), v("g1", 2, "Automatic version", "Grace"), v("m", 3, "Automatic version", "Ada")], (e) => (e.id === "g2" ? files("ch07.md") : undefined));
    expect(rows.map((r) => [r.title, r.author, r.partial])).toEqual([
      ["2 automatic versions", "Grace", true],
      ["Automatic version", "Ada", true],
    ]);
  });

  test("the default note of Save a version is not a name (no star)", () => {
    expect(waitingRows([v("s", 1, "Saved a version")], () => undefined)[0]).toMatchObject({ title: "Version saved by you", named: false });
  });
});

describe("savedSummary", () => {
  test("today's automatic versions in one line, and the newest named versions", () => {
    const entries = [v("a2", 5), v("n1", 10, "New opening paragraph"), v("a1", 30), v("n2", 60 * 26, "Sent to printer"), v("a0", 60 * 27)];
    const s = savedSummary({ entries, hasMore: false }, NOW);
    expect(s.today).toEqual({ count: 2, atLeast: false, from: NOW - 30 * MIN, to: NOW - 5 * MIN });
    expect(s.named.map((e) => e.id)).toEqual(["n1", "n2"]);
  });

  test("a page that ends inside today says 'at least'", () => {
    expect(savedSummary({ entries: [v("a2", 5), v("a1", 6)], hasMore: true }, NOW).today?.atLeast).toBe(true);
  });

  test("no automatic version today, no line", () => {
    expect(savedSummary({ entries: [v("n", 5, "Named")], hasMore: false }, NOW).today).toBeNull();
  });
});

describe("whenRange", () => {
  test("a time today, a range today, and another day's range", () => {
    const at = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    expect(whenRange(NOW - MIN, NOW - MIN, NOW)).toBe(at(NOW - MIN));
    expect(whenRange(NOW - 15 * MIN, NOW - MIN, NOW)).toBe(`${at(NOW - 15 * MIN)}–${at(NOW - MIN)}`);
    expect(whenRange(NOW - 24 * 60 * MIN - 5 * MIN, NOW - 24 * 60 * MIN, NOW)).toBe(`Yesterday, ${at(NOW - 24 * 60 * MIN - 5 * MIN)}–${at(NOW - 24 * 60 * MIN)}`);
  });
});
