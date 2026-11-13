import { describe, expect, test } from "bun:test";
import { clear, peek, update } from "../../src/lib/routes/online-view-cache";

describe("online-view-cache", () => {
  test("a book's last reads are kept and merged, so reopening the tab paints at once", () => {
    clear();
    expect(peek("/a")).toBeUndefined();
    update("/a", { page: { entries: [{ id: "1", message: "m", timestamp: 1, backedUp: true }], hasMore: false } });
    update("/a", { incoming: [] });
    update("/a", { changes: { "1": { files: [], more: 0 } } });
    const s = peek("/a")!;
    expect(s.page?.entries).toHaveLength(1);
    expect(s.incoming).toEqual([]);
    expect(Object.keys(s.changes)).toEqual(["1"]);
    expect(peek("/b")).toBeUndefined();
  });
});
