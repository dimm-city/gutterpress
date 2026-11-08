import { describe, expect, test } from "bun:test";
import { clear, peek, plainFileName, update } from "../../src/lib/routes/online-view-cache";

describe("online-view-cache", () => {
  test("a book's last lists are kept and merged, so reopening the tab paints at once", () => {
    clear();
    expect(peek("/a")).toBeUndefined();
    update("/a", { recent: [{ id: "1", message: "m", timestamp: 1, backedUp: true }] });
    update("/a", { incoming: [] });
    const s = peek("/a")!;
    expect(s.recent).toHaveLength(1);
    expect(s.incoming).toEqual([]);
    expect(peek("/b")).toBeUndefined();
  });

  test("file names are plain words", () => {
    expect(plainFileName("chapters/02-the-river.md")).toBe("The river");
    expect(plainFileName("manifest.yaml")).toBe("Manifest");
    expect(plainFileName("images/cover_art.png")).toBe("Cover art");
  });
});
