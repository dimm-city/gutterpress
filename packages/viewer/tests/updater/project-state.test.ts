// ──────────────────────────────────────────────────────────────────────────
// project-state.test.ts — unit tests for the pure per-project state transforms
// backing editor-state persistence (#43).
//
// Side-effect-free (no electron, no fs), so we exercise the transforms directly.
// ──────────────────────────────────────────────────────────────────────────

import { describe, expect, test } from "bun:test";
import {
  readProjectState,
  writeProjectState,
  migrateLegacyProjectState,
  type ProjectStateMap,
} from "../../electron/project-state.js";

describe("readProjectState", () => {
  test("returns null for an undefined map", () => {
    expect(readProjectState(undefined, "/a")).toBeNull();
  });

  test("returns null when the project key is absent", () => {
    expect(readProjectState({ "/b": { currentPage: 3 } }, "/a")).toBeNull();
  });

  test("returns the stored bucket for a present key", () => {
    const map: ProjectStateMap = { "/a": { currentPage: 5, viewMode: "single" } };
    expect(readProjectState(map, "/a")).toEqual({ currentPage: 5, viewMode: "single" });
  });
});

describe("writeProjectState", () => {
  test("creates a new bucket when none exists", () => {
    const out = writeProjectState(undefined, "/a", { currentPage: 2 });
    expect(out).toEqual({ "/a": { currentPage: 2 } });
  });

  test("merge-patches an existing bucket without clearing other fields", () => {
    const map: ProjectStateMap = { "/a": { currentPage: 5, viewMode: "single" } };
    const out = writeProjectState(map, "/a", { currentPage: 9 });
    expect(out["/a"]).toEqual({ currentPage: 9, viewMode: "single" });
  });

  test("opening project B never touches project A's bucket", () => {
    let map: ProjectStateMap = {};
    map = writeProjectState(map, "/a", { currentPage: 5, viewMode: "single" });
    map = writeProjectState(map, "/b", { currentPage: 1, viewMode: "two-column" });
    expect(map["/a"]).toEqual({ currentPage: 5, viewMode: "single" });
    expect(map["/b"]).toEqual({ currentPage: 1, viewMode: "two-column" });
  });

  test("ignores undefined patch values (never clears a field)", () => {
    const map: ProjectStateMap = { "/a": { currentPage: 5 } };
    const out = writeProjectState(map, "/a", { currentPage: undefined, viewMode: "single" });
    expect(out["/a"]).toEqual({ currentPage: 5, viewMode: "single" });
  });

  test("lastChapter and sidebarOpen round-trip through write→read", () => {
    let map: ProjectStateMap = {};
    map = writeProjectState(map, "/a", { lastChapter: "/a/ch1.md", sidebarOpen: false });
    const round = JSON.parse(JSON.stringify(map)) as ProjectStateMap;
    expect(readProjectState(round, "/a")).toEqual({
      lastChapter: "/a/ch1.md",
      sidebarOpen: false,
    });
  });
});

describe("migrateLegacyProjectState", () => {
  test("returns the existing map untouched when projectStates is present", () => {
    const existing: ProjectStateMap = { "/a": { currentPage: 7 } };
    expect(
      migrateLegacyProjectState({ projectStates: existing, currentPage: 1, lastProjectDir: "/a" }),
    ).toBe(existing);
  });

  test("seeds the last project's bucket from legacy top-level page/mode", () => {
    expect(
      migrateLegacyProjectState({
        lastProjectDir: "/a",
        currentPage: 4,
        viewMode: "single",
      }),
    ).toEqual({ "/a": { currentPage: 4, viewMode: "single" } });
  });

  test("returns undefined when there is no last project to key on", () => {
    expect(migrateLegacyProjectState({ currentPage: 4 })).toBeUndefined();
  });

  test("returns undefined when there is no legacy state to migrate", () => {
    expect(migrateLegacyProjectState({ lastProjectDir: "/a" })).toBeUndefined();
  });
});
