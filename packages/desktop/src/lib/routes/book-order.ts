import { chapterPath, isSafeChapterId } from "$lib/editor/chapter-path";
import type { ChapterStart } from "$lib/preview-client";

/** What Read mounts: the book's chapters in order, and how tall each is until it lays out. */
export interface BookOrder {
  /** Absolute chapter paths in book order. */
  chapters: string[];
  /** Estimated page count per chapter path, from where the next chapter starts. */
  estimates: Record<string, number>;
}

/**
 * The book as the preview paginated it, from where each chapter starts.
 *
 * Read used to take its chapter list from the preview's heading outline, and
 * a chapter without a Markdown heading (one that opens with `@chapter` and
 * body text, say) never mounted. `getChapters()` reports every source file
 * the preview rendered, in book order, so a chapter is in the book whether
 * or not it has a heading. A chapter reported more than once starts where
 * it was first seen. Ids that do not name a file inside the project are
 * dropped.
 *
 * Pure: no runes, no DOM, so the shape of the book is unit-testable.
 */
export function bookOrder(dir: string, starts: readonly ChapterStart[], totalPages: number): BookOrder {
  const firstPage = new Map<string, number>();
  for (const start of starts) {
    if (!isSafeChapterId(start.chapter) || firstPage.has(start.chapter)) continue;
    firstPage.set(start.chapter, start.page);
  }
  const order = [...firstPage.entries()];
  const chapters: string[] = [];
  const estimates: Record<string, number> = {};
  order.forEach(([chapter, page], i) => {
    const path = chapterPath(dir, chapter);
    const next = order[i + 1]?.[1] ?? totalPages + 1;
    chapters.push(path);
    estimates[path] = Math.max(1, next - page);
  });
  return { chapters, estimates };
}
