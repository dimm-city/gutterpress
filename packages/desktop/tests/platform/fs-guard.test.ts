import { test, expect } from "bun:test";
import { isWithinRoot, isWithinAnyRoot } from "../../electron/server-bridge/fs-guard";

// ARCH review #37: pure containment logic the fs-route project-scoping guard
// is built on. This is write-file's pre-existing
// `path.resolve(watchedDir) + startsWith(root + sep)` test, promoted to a
// shared, directly-tested helper (previously only exercised indirectly, and
// only for the snapshot decision, never for authorization).

test("isWithinRoot: a path nested under the root is allowed", () => {
  expect(isWithinRoot("/home/u/proj/chapter-01.md", "/home/u/proj")).toBe(true);
  expect(isWithinRoot("/home/u/proj/sub/dir/file.css", "/home/u/proj")).toBe(true);
});

test("isWithinRoot: the root itself is allowed", () => {
  expect(isWithinRoot("/home/u/proj", "/home/u/proj")).toBe(true);
});

test("isWithinRoot: a sibling directory with a shared string prefix is REJECTED", () => {
  // The critical regression this guards against: a naive `startsWith(root)`
  // (no separator) would let "/home/u/proj2" match a "/home/u/proj" root.
  expect(isWithinRoot("/home/u/proj2/file.md", "/home/u/proj")).toBe(false);
  expect(isWithinRoot("/home/u/proj2", "/home/u/proj")).toBe(false);
});

test("isWithinRoot: an unrelated path outside the root is rejected", () => {
  expect(isWithinRoot("/etc/passwd", "/home/u/proj")).toBe(false);
  expect(isWithinRoot("/home/u/other", "/home/u/proj")).toBe(false);
});

test("isWithinRoot: a parent of the root is rejected (not the reverse containment)", () => {
  expect(isWithinRoot("/home/u", "/home/u/proj")).toBe(false);
});

test("isWithinRoot: relative segments and trailing slashes normalize before comparing", () => {
  expect(isWithinRoot("/home/u/proj/../proj/file.md", "/home/u/proj")).toBe(true);
  expect(isWithinRoot("/home/u/proj/file.md", "/home/u/proj/")).toBe(true);
});

test("isWithinAnyRoot: true when the candidate is under ANY listed root", () => {
  expect(isWithinAnyRoot("/home/u/proj/file.md", ["/home/u/other", "/home/u/proj"])).toBe(true);
});

test("isWithinAnyRoot: false when the candidate is under NONE of the listed roots", () => {
  expect(isWithinAnyRoot("/home/u/proj2/file.md", ["/home/u/other", "/home/u/proj"])).toBe(false);
});

test("isWithinAnyRoot: false (fails closed) against an empty root list", () => {
  expect(isWithinAnyRoot("/home/u/proj/file.md", [])).toBe(false);
});
