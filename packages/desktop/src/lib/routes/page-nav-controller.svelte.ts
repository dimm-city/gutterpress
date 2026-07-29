/**
 * PageNavController (Phase 5) — the single owner of the page-navigation FSM that
 * used to live inline in `+page.svelte`.
 *
 * Centralises the paged-preview toolbar surface: the live `currentPage` /
 * `totalPages`, the `restoringSavedState` persist guard, and every intent that
 * drives the host preview client — sync on push events, first/prev/next/last
 * navigation, direct goto, the page `<select>`'s `selectPage`, and the
 * per-project saved-page restore.
 *
 * The old inline page-number edit cycle (`pageEditing`/`pageEditValue` +
 * begin/cancel/commit) was retired with the toolbar refactor: the toolbar now
 * renders a native `<select>` with one option per page (`pageOptions`), so the
 * only "edit" intent left is `selectPage`.
 *
 * Single-owner discipline mirrors `ExportController`
 * (`export/export-controller.svelte.ts`) and `UpdateController`
 * (`update/update-controller.svelte.ts`): the component reads the public rune
 * getters and calls the intent methods.
 *
 * Host coupling is injected so this stays testable with fakes and PWA-clean
 * (§8 / ADR 0004): the live preview client, the `isRendering` / `viewMode`
 * accessors, and the two persist sinks (`savePrefs` = the guarded component
 * writer used by `syncPageState`; `savePageDirect` = the unguarded per-project
 * write used only by `restoreProjectPage`). Type-only import of `PageState`
 * — ZERO `node:*` / lib value imports.
 */

import type { PageState } from "./page-types";

/** Minimal host-command client surface the controller drives. */
interface PageNavClient {
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
}

export class PageNavController {
  // ── Public rune state (read by the template; mutated only via methods) ──────
  /** The 1-based page currently shown in the preview. */
  currentPage = $state(1);
  /** Total page count of the rendered document (0 before first render). */
  totalPages = $state(0);
  /** Guard set while a saved-page restore round-trip is in flight. */
  restoringSavedState = $state(false);

  private deps: PageNavDeps;

  constructor(deps: PageNavDeps) {
    this.deps = deps;
  }

  /** Every navigable page, 1..totalPages — the page `<select>`'s options.
   * Empty before the first render. Reads the `totalPages` rune, so templates
   * consuming it stay reactive. */
  get pageOptions(): number[] {
    return Array.from({ length: this.totalPages }, (_, i) => i + 1);
  }

  /** Fold a host page-state push into the runes and persist the new page. */
  syncPageState(state: PageState | undefined): void {
    if (!state) return;
    this.currentPage = state.currentPage ?? this.currentPage;
    this.totalPages = state.totalPages ?? this.totalPages;
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

  /** The page `<select>` intent: navigate to the chosen page. Accepts the raw
   * string value a change event carries; ignores non-numeric input and clamps
   * into [1, totalPages||1]. */
  selectPage(value: number | string): void {
    const next = Number(value);
    if (!Number.isFinite(next)) return;
    const clamped = Math.max(1, Math.min(this.totalPages || 1, Math.round(next)));
    this.gotoPage(clamped);
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
