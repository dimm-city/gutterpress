import { describe, expect, test } from "bun:test";
import { bookOrder } from "../../src/lib/routes/book-order";
import type { ChapterStart } from "../../src/lib/preview-client";

// bookOrder is what Read mounts: the preview's chapter starts, one per source
// file the book paginated, turned into an ordered list of chapter paths and a
// page estimate per chapter. It replaced a derivation from the heading
// outline, which silently dropped every chapter without a Markdown heading.

const dir = "/books/field-guide";
const start = (chapter: string, page: number): ChapterStart => ({ chapter, page });

describe("bookOrder - the book as the preview paginated it", () => {
  test("a chapter without a heading is part of the book", () => {
    // The plugin-book fixture: 01-introduction.md opens with `@chapter` and
    // has no `#` heading at all, so the heading outline never names it.
    const starts = [start("01-introduction.md", 1), start("02-field-notes.md", 3), start("03-checklist.md", 6)];
    const book = bookOrder(dir, starts, 7);
    expect(book.chapters).toEqual([
      `${dir}/01-introduction.md`,
      `${dir}/02-field-notes.md`,
      `${dir}/03-checklist.md`,
    ]);
    expect(book.estimates).toEqual({
      [`${dir}/01-introduction.md`]: 2,
      [`${dir}/02-field-notes.md`]: 3,
      [`${dir}/03-checklist.md`]: 2,
    });
  });

  test("book order is the preview's order, not name order", () => {
    const starts = [start("zulu.md", 1), start("alpha.md", 4)];
    expect(bookOrder(dir, starts, 5).chapters).toEqual([`${dir}/zulu.md`, `${dir}/alpha.md`]);
  });

  test("a chapter reported more than once starts where it was first seen", () => {
    const starts = [start("a.md", 1), start("a.md", 3), start("b.md", 5)];
    const book = bookOrder(dir, starts, 6);
    expect(book.chapters).toEqual([`${dir}/a.md`, `${dir}/b.md`]);
    expect(book.estimates[`${dir}/a.md`]).toBe(4);
    expect(book.estimates[`${dir}/b.md`]).toBe(2);
  });

  test("every chapter is at least one page, even before its page is known", () => {
    // pageIndexOf() reports 0 for an element the viewer has not placed.
    const starts = [start("a.md", 0), start("b.md", 0)];
    expect(bookOrder(dir, starts, 0).estimates).toEqual({ [`${dir}/a.md`]: 1, [`${dir}/b.md`]: 1 });
  });

  test("an id that does not name a file inside the project is dropped", () => {
    const starts = [start("../outside.md", 1), start("/abs.md", 2), start("ok.md", 3)];
    expect(bookOrder(dir, starts, 3).chapters).toEqual([`${dir}/ok.md`]);
  });

  test("no chapters: an empty book, so the caller can fall back", () => {
    expect(bookOrder(dir, [], 0)).toEqual({ chapters: [], estimates: {} });
  });

  test("joins with the project directory's own separator", () => {
    const book = bookOrder("C:\\books\\guide", [start("ch/01.md", 1)], 1);
    expect(book.chapters).toEqual(["C:\\books\\guide\\ch\\01.md"]);
  });
});
