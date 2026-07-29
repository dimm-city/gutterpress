import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  invalidateDir,
  invalidateSubtree,
  collapseDir,
  renameExpanded,
} from "../../src/lib/components/file-tree-cache";
import { isPathAtOrUnder } from "../../src/lib/platform/paths";

// ── containment (now the shared isPathAtOrUnder, not a local copy) ──────

test("isPathAtOrUnder: the same path matches", () => {
  expect(isPathAtOrUnder("/proj/chapters", "/proj/chapters")).toBe(true);
});

test("isPathAtOrUnder: a nested path matches", () => {
  expect(isPathAtOrUnder("/proj/chapters/one.md", "/proj/chapters")).toBe(true);
  expect(isPathAtOrUnder("/proj/chapters/sub/deep.md", "/proj/chapters")).toBe(true);
});

test("isPathAtOrUnder: a sibling with a shared string prefix does NOT match", () => {
  // The exact bug class the fs-guard containment check exists to avoid —
  // "/proj/chapters2" is not inside "/proj/chapters".
  expect(isPathAtOrUnder("/proj/chapters2/one.md", "/proj/chapters")).toBe(false);
  expect(isPathAtOrUnder("/proj/chapters2", "/proj/chapters")).toBe(false);
});

test("isPathAtOrUnder: an unrelated path does not match", () => {
  expect(isPathAtOrUnder("/proj/styles/book.css", "/proj/chapters")).toBe(false);
});

// ── invalidateDir ────────────────────────────────────────────────────────

test("invalidateDir: drops exactly the named directory", () => {
  const cache = { "/proj/a": [1], "/proj/b": [2] };
  const next = invalidateDir(cache, "/proj/a");
  expect(next).toEqual({ "/proj/b": [2] });
});

test("invalidateDir: leaves descendant/sibling entries alone", () => {
  const cache = { "/proj/a": [1], "/proj/a/sub": [2], "/proj/a2": [3] };
  const next = invalidateDir(cache, "/proj/a");
  expect(next).toEqual({ "/proj/a/sub": [2], "/proj/a2": [3] });
});

test("invalidateDir: a no-op (identity) when the dir isn't cached", () => {
  const cache = { "/proj/b": [2] };
  const next = invalidateDir(cache, "/proj/a");
  expect(next).toBe(cache); // same reference — no unnecessary reassignment
});

test("invalidateDir: never mutates the input", () => {
  const cache = { "/proj/a": [1] };
  invalidateDir(cache, "/proj/a");
  expect(cache).toEqual({ "/proj/a": [1] });
});

// ── invalidateSubtree ────────────────────────────────────────────────────

test("invalidateSubtree: drops the dir and every cached descendant", () => {
  const cache = {
    "/proj/a": [1],
    "/proj/a/sub": [2],
    "/proj/a/sub/deep": [3],
    "/proj/b": [4],
  };
  const next = invalidateSubtree(cache, "/proj/a");
  expect(next).toEqual({ "/proj/b": [4] });
});

test("invalidateSubtree: does not drop a sibling with a shared string prefix", () => {
  const cache = { "/proj/a": [1], "/proj/a2": [2] };
  const next = invalidateSubtree(cache, "/proj/a");
  expect(next).toEqual({ "/proj/a2": [2] });
});

test("invalidateSubtree: a no-op (identity) when nothing in the subtree is cached", () => {
  const cache = { "/proj/b": [1] };
  const next = invalidateSubtree(cache, "/proj/a");
  expect(next).toBe(cache);
});

// ── collapseDir / renameExpanded ─────────────────────────────────────────

test("collapseDir: removes the dir from the expanded set", () => {
  const expanded = new Set(["/proj/a", "/proj/b"]);
  const next = collapseDir(expanded, "/proj/a");
  expect([...next]).toEqual(["/proj/b"]);
  expect(expanded.has("/proj/a")).toBe(true); // input untouched
});

test("collapseDir: a no-op when the dir isn't expanded, but still returns a fresh Set", () => {
  const expanded = new Set(["/proj/b"]);
  const next = collapseDir(expanded, "/proj/a");
  expect(next).not.toBe(expanded);
  expect([...next]).toEqual(["/proj/b"]);
});

test("renameExpanded: re-keys an expanded folder from its old path to its new one", () => {
  const expanded = new Set(["/proj/old", "/proj/other"]);
  const next = renameExpanded(expanded, "/proj/old", "/proj/new");
  expect([...next].sort()).toEqual(["/proj/new", "/proj/other"]);
});

test("renameExpanded: a no-op (fresh copy) when the old dir wasn't expanded", () => {
  const expanded = new Set(["/proj/other"]);
  const next = renameExpanded(expanded, "/proj/old", "/proj/new");
  expect([...next]).toEqual(["/proj/other"]);
});

// ── Regression: renaming an EXPANDED folder must refetch its children ─────
//
// Fix-round-1 finding: `renameExpanded` correctly re-keys the `expanded` Set
// from oldPath -> newPath, but re-keying alone does NOT repopulate
// `childrenByPath` for the new key (the same commit's `invalidateSubtree`
// call drops the OLD path's cached listing). Combined, an expanded folder
// that gets renamed had a key in `expanded` with nothing in
// `childrenByPath` for it, so FileTree's template fell through to its
// `(childrenByPath[newPath] ?? []).length === 0` branch and rendered the
// folder as "Empty" until the user manually collapsed and re-expanded it.
//
// FileTree.svelte can't be mounted in this harness (no Svelte component
// test runner is wired up here — see file-tree-open-file-rename-delete.test.ts's
// header comment on the same limitation), so — mirroring that file's
// "wiring check" convention — this pins the exact fix by reading
// commitRename's real source and asserting the correct ORDER of
// operations: `wasExpanded` must be captured from the pre-rename `expanded`
// Set BEFORE it is re-keyed (capturing it after would always read `false`,
// since the Set no longer has `oldPath` as a member), and the refetch must
// fire only when the folder actually was expanded.
test("FileTree.svelte's commitRename captures wasExpanded BEFORE re-keying expanded, and refetches the new path's children when it was expanded", () => {
  const root = path.resolve(import.meta.dir, "../..");
  const source = readFileSync(path.join(root, "src/lib/components/FileTree.svelte"), "utf8");

  const isDirBlockMatch = source.match(/if \(isDir\) \{([\s\S]*?)\n\s*\}\n\s*onFileRenamed/);
  expect(isDirBlockMatch).not.toBeNull();
  const block = isDirBlockMatch![1];

  const wasExpandedIdx = block.indexOf("const wasExpanded = expanded.has(oldPath)");
  const renameExpandedIdx = block.indexOf("expanded = renameExpanded(expanded, oldPath, result.path)");
  const refetchIdx = block.indexOf("if (wasExpanded) void loadChildren(result.path)");

  expect(wasExpandedIdx).toBeGreaterThan(-1);
  expect(renameExpandedIdx).toBeGreaterThan(-1);
  expect(refetchIdx).toBeGreaterThan(-1);

  // Capture must happen on the ORIGINAL Set, before it's replaced.
  expect(wasExpandedIdx).toBeLessThan(renameExpandedIdx);
  // The refetch decision reads the captured boolean, not the live Set, so it
  // can safely come after the re-key — but it must still exist in the block.
  expect(refetchIdx).toBeGreaterThan(renameExpandedIdx);
});

test("isPathAtOrUnder: a Windows child matches its backslash-separated parent", () => {
  // The local copy this replaced appended only "/" when `dir` had no trailing
  // separator, so on Windows the subtree's cached listings were never
  // invalidated after a rename/delete.
  expect(isPathAtOrUnder("C:\\Users\\proj\\chapters\\ch1.md", "C:\\Users\\proj")).toBe(true);
});
