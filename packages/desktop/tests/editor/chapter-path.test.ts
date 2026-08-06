import { test, expect } from "bun:test";
import { chapterPath } from "../../src/lib/editor/chapter-path";

test("joins with a POSIX separator, stripping a trailing slash on dir", () => {
  expect(chapterPath("/proj/", "ch2.md")).toBe("/proj/ch2.md");
  expect(chapterPath("/proj", "ch2.md")).toBe("/proj/ch2.md");
});

test("converts internal forward slashes in the chapter id to the dir's separator", () => {
  expect(chapterPath("C:\\proj", "sub/ch2.md")).toBe("C:\\proj\\sub\\ch2.md");
  expect(chapterPath("C:\\proj\\", "sub/ch2.md")).toBe("C:\\proj\\sub\\ch2.md");
});

test("stays POSIX when dir has no backslashes", () => {
  expect(chapterPath("/proj", "sub/nested/ch3.md")).toBe("/proj/sub/nested/ch3.md");
});
