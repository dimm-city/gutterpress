import { test, expect } from "bun:test";
import { basenameOf, fileRef, isPathAtOrUnder } from "../../src/lib/platform/paths";

// basenameOf is the single shared, PWA-clean (no node:path) basename helper used
// by the adapter, +page.svelte, and the editor/conflict components (#61). It must
// match the adapter's prior local `basename()` behaviour exactly.
test("basenameOf returns the last non-empty segment for POSIX paths", () => {
  expect(basenameOf("/proj/chapters/01-intro.md")).toBe("01-intro.md");
  expect(basenameOf("01-intro.md")).toBe("01-intro.md");
});

test("basenameOf splits on Windows backslashes", () => {
  expect(basenameOf("C:\\Users\\me\\book\\02-rules.md")).toBe("02-rules.md");
  expect(basenameOf("book\\02-rules.md")).toBe("02-rules.md");
});

test("basenameOf ignores trailing separators (filter(Boolean))", () => {
  expect(basenameOf("/proj/book/")).toBe("book");
  expect(basenameOf("C:\\Users\\me\\book\\")).toBe("book");
});

test("basenameOf falls back to the input when there is no segment", () => {
  expect(basenameOf("")).toBe("");
  expect(basenameOf("/")).toBe("/");
});

// fileRef is the host-neutral file-identity factory (#61), analogous to the
// FolderRef wrapping in the adapter: key = the host path/handle id, displayName =
// the precomputed basename so the UI never splits a path itself.
test("fileRef wraps a path into { key, displayName: basename }", () => {
  expect(fileRef("/proj/assets/cover.png")).toEqual({
    key: "/proj/assets/cover.png",
    displayName: "cover.png",
  });
  expect(fileRef("C:\\proj\\assets\\cover.png")).toEqual({
    key: "C:\\proj\\assets\\cover.png",
    displayName: "cover.png",
  });
});

// isPathAtOrUnder underpins +page.svelte's FileTree rename/delete handlers
// (code-review): a renamed/deleted DIRECTORY must be treated as affecting an
// open file nested inside it, while a sibling with a shared string prefix must
// NOT match.
test("isPathAtOrUnder: an exact path matches", () => {
  expect(isPathAtOrUnder("/proj/ch1.md", "/proj/ch1.md")).toBe(true);
});

test("isPathAtOrUnder: a file nested under a directory matches (POSIX and Windows)", () => {
  expect(isPathAtOrUnder("/proj/part1/ch1.md", "/proj/part1")).toBe(true);
  expect(isPathAtOrUnder("C:\\proj\\part1\\ch1.md", "C:\\proj\\part1")).toBe(true);
});

test("isPathAtOrUnder: a sibling with a shared string prefix does NOT match", () => {
  expect(isPathAtOrUnder("/proj/part10/ch1.md", "/proj/part1")).toBe(false);
  expect(isPathAtOrUnder("/a/proj2/ch1.md", "/a/proj")).toBe(false);
});

test("isPathAtOrUnder: an unrelated path does NOT match", () => {
  expect(isPathAtOrUnder("/other/ch1.md", "/proj/part1")).toBe(false);
});
