/**
 * BookPageNav — page navigation for the UNLOCKED book (the paged editor).
 *
 * The preview's `PageNavController` drives the preview iframe through its
 * client. While the book is unlocked the pages on screen are the editor's,
 * so the same toolbar needs a controller that reads the editor's page state
 * and asks IT to move. Same public surface (`PageNavSurface`), so
 * `PreviewToolbar` cannot tell the two apart.
 *
 * Page numbers here are the book-wide folios the editor paints on its
 * sheets (`data-page`, continuing across chapters), which is also what the
 * preview's page picker shows for the same book.
 */
import type { PageNavSurface } from "./page-nav-controller.svelte";

export interface BookPageState {
  currentPage: number;
  totalPages: number;
}

export class BookPageNav implements PageNavSurface {
  currentPage = $state(1);
  totalPages = $state(0);

  private readonly go: (page: number) => void;

  constructor(go: (page: number) => void) {
    this.go = go;
  }

  get pageOptions(): number[] {
    return Array.from({ length: this.totalPages }, (_, i) => i + 1);
  }

  /** The editor's page state changed (a scroll, a chapter laid out). */
  sync(state: BookPageState): void {
    this.currentPage = state.currentPage;
    this.totalPages = state.totalPages;
  }

  gotoPage(n: number): void {
    const clamped = Math.max(1, Math.min(this.totalPages || 1, Math.round(n)));
    this.go(clamped);
  }

  selectPage(value: number | string): void {
    const next = Number(value);
    if (!Number.isFinite(next)) return;
    this.gotoPage(next);
  }

  firstPage(): void {
    this.gotoPage(1);
  }
  prevPage(): void {
    this.gotoPage(this.currentPage - 1);
  }
  nextPage(): void {
    this.gotoPage(this.currentPage + 1);
  }
  lastPage(): void {
    this.gotoPage(this.totalPages);
  }
}
