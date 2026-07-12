/**
 * ProjectSessionController (Phase 5c) — the single owner of the open project's
 * capability-classification session state that used to live inline in
 * `+page.svelte`.
 *
 * Centralises the `#12` classification wiring: on folder open the component
 * `reset()`s this state and awaits `classify(dir)` (C2: awaited so a picked
 * folder that isn't itself a book can retarget before any content surface
 * opens — see the C2 note below), whose chain never rejects and
 * populates `projectCapabilities`, derives `projectSubPath` (a book's path
 * relative to its repo root; "" when the book IS the repo root), persists the
 * re-detected source hint via ViewerPrefs, re-notifies the History tab, and —
 * only when the project is actually syncable — refreshes the remote
 * diagnosis. The template reads the public rune getters
 * (`projectCapabilities` / `projectSubPath`).
 *
 * Single-owner discipline mirrors `SyncController`
 * (`sync-controller.svelte.ts`) and `PageNavController`
 * (`page-nav-controller.svelte.ts`): the component reads the runes and calls the
 * intent methods.
 *
 * Host coupling is injected so this stays testable with fakes and PWA-clean
 * (§8 / ADR 0004): the host classify round-trip, the ViewerPrefs writer, and the
 * component fan-out callback (`refreshSyncDiag` → the SyncController).
 * `ProjectCapabilities` is a type-only import — ZERO `node:*` / lib value
 * imports.
 *
 * NOTE (deferred): the broader open/stop lifecycle and the rest of the session
 * runes (`currentDir` / `sourceMode` / `docTitle` / `currentFolderDisplayName` /
 * `currentUrl`) still live in `+page.svelte` — those ~130 references are
 * interleaved with buffer/leftPanel/pageNav side effects, so moving them
 * behaviour-preservingly is a separate item. This controller extracts the
 * cohesive, self-contained classification slice.
 *
 * C1 (repo-root sessions) added `repoRoot` / `books` / `activeBookDir`: when
 * the classified source is a `local-git-folder`, the host also returns the
 * list of books (manifest-containing folders) found inside that repo.
 * `activeBookDir` is derived from that list by {@link resolveActiveBookDir}.
 *
 * C2 (book switcher) makes `+page.svelte` `await` {@link classify} BEFORE
 * starting the preview/editor/watch pipeline, so a picked folder that isn't
 * itself a book (e.g. a bare multi-book repo root) retargets to
 * `activeBookDir` before any content surface opens. Switching books reuses
 * the same open path at the sibling book's folder — a full re-classify, not a
 * second code path — so `repoRoot`/`books`/capabilities end up identical
 * (same repo), matching the "session identity pinned to repoRoot" design.
 */

import type { ProjectCapabilities } from "../platform/contract";
import type { ProjectClassification, ProjectClassificationBook } from "../platform/dtos";

/** A book (manifest-containing folder) found inside a classified project's repo. */
export type ProjectBookEntry = ProjectClassificationBook;

/**
 * Resolve which book is "active" after opening `pickedDir` inside a repo whose
 * books (already sorted by `subPath`) are `books`. Mirrors the C1 design
 * decisions:
 *  - No repo, or the repo has no books at all: the picked folder stays active
 *    (today's single-folder behaviour, unchanged — no redirect).
 *  - Exactly one book in the repo: that book is always active, regardless of
 *    which folder was picked (a single-book repo, including a book living at
 *    the repo root, behaves identically to opening it directly today).
 *  - Multiple books: if the picked folder IS one of them, it stays active;
 *    otherwise (the bare repo root was picked) the first book alphabetically
 *    by `subPath` is active until the user switches (#C2).
 */
export function resolveActiveBookDir(
  pickedDir: string,
  repoRoot: string | undefined,
  books: ProjectBookEntry[],
): string {
  if (!repoRoot || books.length === 0) return pickedDir;
  if (books.length === 1) return books[0]!.path;
  const picked = books.find((b) => b.path === pickedDir);
  return picked ? picked.path : books[0]!.path;
}

export interface ProjectSessionDeps {
  /** Host round-trip: classify a project folder (source type + capabilities). */
  classifyProject: (dir: string) => Promise<ProjectClassification>;
  /** Persist the re-detected source hint (fire-and-forget on the component side). */
  setViewerPrefs: (prefs: Record<string, unknown>) => Promise<unknown>;
  /** Refresh the remote diagnosis for a syncable project (SyncController). */
  refreshSyncDiag: (dir: string) => void;
}

export class ProjectSessionController {
  // ── Public rune state (read by the template; mutated only via methods) ──────
  /** Capabilities of the open project's source (#12), or null before classify. */
  projectCapabilities = $state<ProjectCapabilities | null>(null);
  /** The book's path relative to its shared repo ("" for standalone projects). */
  projectSubPath = $state("");
  /** Root of the repo the open folder belongs to; null when there is no repo. */
  repoRoot = $state<string | null>(null);
  /** Books (manifest-containing folders) found inside `repoRoot`; [] when there is no repo. */
  books = $state<ProjectBookEntry[]>([]);
  /** The book the session currently targets, per {@link resolveActiveBookDir}. */
  activeBookDir = $state<string | null>(null);

  private deps: ProjectSessionDeps;

  // Call-generation guard (the EditorBuffer.loadGen pattern): opens can
  // overlap now that the start screen keeps the window interactive, and a
  // superseded open's classify response resolving AFTER the winner's must not
  // overwrite the shared session runes or persist the wrong projectSource.
  private classifyGen = 0;

  constructor(deps: ProjectSessionDeps) {
    this.deps = deps;
  }

  /**
   * Reset capability session state for a fresh open, before {@link classify}
   * repopulates it (mirrors the old inline reset at folder-open time). Also
   * invalidates any in-flight classify so its late result is dropped.
   */
  reset(): void {
    this.classifyGen++;
    this.projectCapabilities = null;
    this.projectSubPath = "";
    this.repoRoot = null;
    this.books = [];
    this.activeBookDir = null;
  }

  /**
   * Classify the opened folder (#12) so capability-gated actions (#13/#25) can
   * render, and (C2) resolve which book is active before any content pipeline
   * targets a folder. Returns the settled promise so a caller that needs the
   * resolved `activeBookDir` before opening the preview/editor/watch pipeline
   * (the folder picked may not itself be a book) can await it; a failure must
   * never block the preview — it only clears the capabilities.
   */
  classify(dir: string): Promise<void> {
    const gen = ++this.classifyGen;
    return this.deps
      .classifyProject(dir)
      .then((result) => {
        if (gen !== this.classifyGen) return; // superseded by a newer open
        this.projectCapabilities = result.capabilities;
        this.projectSubPath =
          result.source.type === "local-git-folder" ? (result.source.subPath ?? "") : "";
        this.repoRoot = result.repoRoot ?? null;
        this.books = result.books ?? [];
        this.activeBookDir = resolveActiveBookDir(dir, result.repoRoot, this.books);
        this.deps.setViewerPrefs({ projectSource: result.source }).catch(() => {});
        // Sync gate (#15 / ADR 0006 D4): the toolbar action appears only when
        // the diagnosis says the project is actually syncable. Local reads only.
        if (result.capabilities.canSync) {
          this.deps.refreshSyncDiag(dir);
        }
      })
      .catch(() => {
        if (gen !== this.classifyGen) return;
        this.projectCapabilities = null;
      });
  }
}
