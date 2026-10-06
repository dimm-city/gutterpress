import { describe, expect, test } from "bun:test";
import { BookPageNav } from "../../src/lib/routes/book-page-nav.svelte";

// Same $state shim as page-nav-controller.test: Bun imports the rune-bearing
// module without Svelte's compiler; the class only needs plain values here.
(globalThis as unknown as { $state?: <T>(value: T) => T }).$state ??= (value) => value;

describe("BookPageNav", () => {
  test("navigates relative to the synced page and clamps to the book", () => {
    const moves: number[] = [];
    const nav = new BookPageNav((page) => moves.push(page));
    nav.sync({ currentPage: 3, totalPages: 7 });
    expect(nav.pageOptions).toEqual([1, 2, 3, 4, 5, 6, 7]);
    nav.nextPage();
    nav.prevPage();
    nav.firstPage();
    nav.lastPage();
    nav.selectPage("5");
    nav.selectPage("99");
    nav.selectPage("abc");
    expect(moves).toEqual([4, 2, 1, 7, 5, 7]);
  });

  test("a book that has not laid out yet still answers page 1", () => {
    const moves: number[] = [];
    const nav = new BookPageNav((page) => moves.push(page));
    nav.nextPage();
    expect(moves).toEqual([1]);
  });
});
