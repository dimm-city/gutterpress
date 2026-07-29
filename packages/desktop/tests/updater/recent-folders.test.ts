// ──────────────────────────────────────────────────────────────────────────
// recent-folders.test.ts — unit tests for the pure persistence transforms
// backing the Open Location modal (issue #10).
//
// These helpers are side-effect-free (no electron, no fs), so no electron mock
// or temp userData dir is required — we exercise the transforms directly.
// ──────────────────────────────────────────────────────────────────────────

import { describe, expect, test } from "bun:test";
import {
  upsertRecentFolder,
  removeRecentFolder,
  toggleFavoriteFolder,
  RECENT_FOLDERS_CAP,
  type RecentFolder,
  type FavoriteFolder,
} from "../../electron/recent-folders.js";

function rf(path: string, title = path, openedAt = "2026-06-06T00:00:00.000Z"): RecentFolder {
  return { path, title, openedAt };
}

describe("upsertRecentFolder", () => {
  test("adds a new folder to the front of an empty/undefined list", () => {
    const result = upsertRecentFolder(undefined, rf("/a"));
    expect(result).toEqual([rf("/a")]);
  });

  test("newest entry moves to front", () => {
    let list: RecentFolder[] = [];
    list = upsertRecentFolder(list, rf("/a"));
    list = upsertRecentFolder(list, rf("/b"));
    list = upsertRecentFolder(list, rf("/c"));
    expect(list.map((r) => r.path)).toEqual(["/c", "/b", "/a"]);
  });

  test("re-opening an existing path dedupes and moves it to front, refreshing title+openedAt", () => {
    let list: RecentFolder[] = [
      rf("/a", "A", "2026-01-01T00:00:00.000Z"),
      rf("/b", "B", "2026-01-01T00:00:00.000Z"),
    ];
    list = upsertRecentFolder(list, rf("/a", "A renamed", "2026-06-06T12:00:00.000Z"));
    expect(list.map((r) => r.path)).toEqual(["/a", "/b"]);
    expect(list[0]).toEqual(rf("/a", "A renamed", "2026-06-06T12:00:00.000Z"));
    // no duplicate
    expect(list.filter((r) => r.path === "/a").length).toBe(1);
  });

  test("caps the list at RECENT_FOLDERS_CAP (8), dropping the oldest", () => {
    let list: RecentFolder[] = [];
    for (let i = 0; i < 12; i++) {
      list = upsertRecentFolder(list, rf(`/p${i}`));
    }
    expect(list.length).toBe(RECENT_FOLDERS_CAP);
    expect(RECENT_FOLDERS_CAP).toBe(8);
    // newest-first: last inserted is /p11, oldest kept is /p4
    expect(list[0].path).toBe("/p11");
    expect(list[list.length - 1].path).toBe("/p4");
  });
});

describe("upsertRecentFolder — C2 lastActiveBook", () => {
  test("carries an optional lastActiveBook field through unchanged", () => {
    const entry: RecentFolder = { path: "/repo", title: "Repo", openedAt: "2026-07-05T00:00:00.000Z", lastActiveBook: "/repo/books/one" };
    const result = upsertRecentFolder(undefined, entry);
    expect(result).toEqual([entry]);
  });

  test("re-opening a different book in the same repo refreshes lastActiveBook", () => {
    let list: RecentFolder[] = [
      { ...rf("/repo"), lastActiveBook: "/repo/books/one" },
    ];
    list = upsertRecentFolder(list, { ...rf("/repo", "Repo", "2026-07-05T00:00:00.000Z"), lastActiveBook: "/repo/books/two" });
    expect(list.length).toBe(1);
    expect(list[0].lastActiveBook).toBe("/repo/books/two");
  });

  test("a standalone (non-git) entry has no lastActiveBook", () => {
    const result = upsertRecentFolder(undefined, rf("/standalone"));
    expect(result[0].lastActiveBook).toBeUndefined();
  });
});

describe("removeRecentFolder", () => {
  test("removes the matching path", () => {
    const list = [rf("/a"), rf("/b"), rf("/c")];
    expect(removeRecentFolder(list, "/b").map((r) => r.path)).toEqual(["/a", "/c"]);
  });

  test("is a no-op when path is absent", () => {
    const list = [rf("/a")];
    expect(removeRecentFolder(list, "/nope").map((r) => r.path)).toEqual(["/a"]);
  });

  test("handles undefined input", () => {
    expect(removeRecentFolder(undefined, "/a")).toEqual([]);
  });
});

describe("toggleFavoriteFolder", () => {
  test("adds when not present and reports favorited=true", () => {
    const res = toggleFavoriteFolder(undefined, { path: "/a", title: "A" });
    expect(res.favorited).toBe(true);
    expect(res.favorites).toEqual([{ path: "/a", title: "A" }]);
  });

  test("removes when present and reports favorited=false", () => {
    const start: FavoriteFolder[] = [
      { path: "/a", title: "A" },
      { path: "/b", title: "B" },
    ];
    const res = toggleFavoriteFolder(start, { path: "/a", title: "A" });
    expect(res.favorited).toBe(false);
    expect(res.favorites).toEqual([{ path: "/b", title: "B" }]);
  });

  test("toggling twice returns to the original state", () => {
    const start: FavoriteFolder[] = [];
    const once = toggleFavoriteFolder(start, { path: "/a", title: "A" });
    const twice = toggleFavoriteFolder(once.favorites, { path: "/a", title: "A" });
    expect(twice.favorited).toBe(false);
    expect(twice.favorites).toEqual([]);
  });

  test("does not store extra fields beyond path+title", () => {
    const res = toggleFavoriteFolder(undefined, {
      path: "/a",
      title: "A",
      // @ts-expect-error — extra field must be stripped
      openedAt: "2026-06-06T00:00:00.000Z",
    });
    expect(res.favorites[0]).toEqual({ path: "/a", title: "A" });
  });
});
