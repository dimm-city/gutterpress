/**
 * PageNavController (Phase 5) — the single owner of the page-navigation FSM that
 * used to live inline in `+page.svelte`.
 *
 * Centralises the paged-preview toolbar surface: the live `currentPage` /
 * `totalPages`, the inline page-number edit state (`pageEditing` /
 * `pageEditValue`), the `restoringSavedState` persist guard, and every intent
 * that drives the host preview client — sync on push events, first/prev/next/
 * last navigation, direct goto, the edit begin/cancel/commit cycle, and the
 * per-project saved-page restore.
 *
 * Single-owner discipline mirrors `ExportController`
 * (`export/export-controller.svelte.ts`) and `UpdateController`
 * (`update/update-controller.svelte.ts`): the component reads the public rune
 * getters and calls the intent methods.
 *
 * Host coupling is injected so this stays testable with fakes and PWA-clean
 * (§8 / ADR 0004): the live preview client, the `isRendering` / `viewMode`
 * accessors, the two persist sinks (`savePrefs` = the guarded component
 * writer used by `syncPageState`; `savePageDirect` = the unguarded per-project
 * write used only by `restoreProjectPage`), and an optional `onBeginEdit` hook
 * (the component wires input focus through it). Type-only import of `PageState`
 * — ZERO `node:*` / lib value imports.
 */

import type { PageState } from "./page-types";

/** Minimal host-command client surface the controller drives. */
export interface PageNavClient {
  call<T>(cmd: string, args?: unknown[]): Promise<T>;
}

export interface PageNavDeps {
  /** The live preview client, or undefined when no document is loaded. */
  client: () => PageNavClient | undefined;
  /** True while a render is in flight (navigation is suppressed). */
  isRendering: () => boolean;
  /** Current preview view mode, passed to prev/next as their sole arg. */
  viewMode: () => "single" | "two-column";
  /** Guarded component writer — persists {currentPage} on normal syncs. */
  savePrefs: (patch: Partial<PageState>) => void;
  /** Unguarded per-project write — used only on the restore path. */
  savePageDirect: (page: number) => void;
  /** Fired when an inline page edit begins (component focuses the input). */
  onBeginEdit?: () => void;
}

export class PageNavController {
  // ── Public rune state (read by the template; mutated only via methods) ──────
  /** The 1-based page currently shown in the preview. */
  currentPage = $state(1);
  /** Total page count of the rendered document (0 before first render). */
  totalPages = $state(0);
  /** True while the inline page-number input is open. */
  pageEditing = $state(false);
  /** The in-progress inline page-number input value. */
  pageEditValue = $state("1");
  /** Guard set while a saved-page restore round-trip is in flight. */
  restoringSavedState = $state(false);

  private deps: PageNavDeps;

  constructor(deps: PageNavDeps) {
    this.deps = deps;
  }

  /** Fold a host page-state push into the runes and persist the new page. */
  syncPageState(state: PageState | undefined): void {
    if (!state) return;
    this.currentPage = state.currentPage ?? this.currentPage;
    this.totalPages = state.totalPages ?? this.totalPages;
    if (!this.pageEditing) this.pageEditValue = String(this.currentPage);
    this.deps.savePrefs({ currentPage: this.currentPage });
  }

  /** Restore this project's saved page without tripping the persist guard. */
  restoreProjectPage(page: number): void {
    const client = this.deps.client();
    if (!client || this.deps.isRendering()) return;
    this.restoringSavedState = true;
    client
      .call<PageState>("goToPage", [page])
      .then((state) => {
        this.currentPage = state.currentPage ?? this.currentPage;
        this.totalPages = state.totalPages ?? this.totalPages;
        if (!this.pageEditing) this.pageEditValue = String(this.currentPage);
        this.deps.savePageDirect(this.currentPage);
      })
      .catch(() => {})
      .finally(() => {
        this.restoringSavedState = false;
      });
  }

  /** Issue a host navigation command and fold its returned page-state. */
  runPageCommand(cmd: string, args: unknown[] = []): void {
    const client = this.deps.client();
    if (!client || this.deps.isRendering()) return;
    client
      .call<PageState>(cmd, args)
      .then((s) => this.syncPageState(s))
      .catch(() => {});
  }

  gotoPage(n: number): void {
    this.runPageCommand("goToPage", [n]);
  }

  beginPageEdit(): void {
    if (this.deps.isRendering()) return;
    this.pageEditing = true;
    this.pageEditValue = String(this.currentPage);
    this.deps.onBeginEdit?.();
  }

  cancelPageEdit(): void {
    this.pageEditing = false;
    this.pageEditValue = String(this.currentPage);
  }

  commitPageEdit(): void {
    const next = Number(this.pageEditValue);
    if (Number.isFinite(next)) {
      const clamped = Math.max(1, Math.min(this.totalPages || 1, Math.round(next)));
      this.gotoPage(clamped);
    }
    this.pageEditing = false;
  }

  firstPage(): void {
    this.runPageCommand("firstPage");
  }
  prevPage(): void {
    this.runPageCommand("prevPage", [this.deps.viewMode()]);
  }
  nextPage(): void {
    this.runPageCommand("nextPage", [this.deps.viewMode()]);
  }
  lastPage(): void {
    this.runPageCommand("lastPage");
  }
}
