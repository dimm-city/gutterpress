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
 * relative to its repo root; "" when the book IS the repo root), and persists
 * the re-detected source hint via DesktopPrefs. The template reads the public
 * rune getters (`projectCapabilities` / `projectSubPath`). The remote
 * diagnosis is deliberately NOT refreshed from here — the lifecycle controller
 * does it after `currentDir` is assigned, so the SyncController's stale-guard
 * can actually accept the result (see the NOTE in classify()).
 *
 * Single-owner discipline mirrors `SyncController`
 * (`sync-controller.svelte.ts`) and `PageNavController`
 * (`page-nav-controller.svelte.ts`): the component reads the runes and calls the
 * intent methods.
 *
 * Host coupling is injected so this stays testable with fakes and PWA-clean
 * (§8 / ADR 0004): the host classify round-trip and the DesktopPrefs writer.
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
 * Normalize a path for comparison: collapse `.`/`..`, unify separators, drop a
 * trailing separator. Deliberately string-only — this module is in the SPA and
 * must stay free of `node:path` (§8), and the paths it compares always come
 * from the same host, so they share a separator convention.
 */
function normalizeDirPath(dir: string): string {
  const unified = dir.replace(/\\/g, "/");
  const isAbs = unified.startsWith("/");
  const drive = /^[A-Za-z]:/.exec(unified)?.[0] ?? "";
  const out: string[] = [];
  for (const segment of unified.slice(drive.length).split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (out.length > 0) out.pop();
      continue;
    }
    out.push(segment);
  }
  const joined = out.join("/");
  if (drive) return `${drive}/${joined}`.replace(/\/$/, "") || `${drive}/`;
  return isAbs ? `/${joined}` : joined;
}

/** True if `candidate` IS `root` or sits under it — separator-aware, so `/a/b2` is not inside `/a/b`. */
function isSameOrInside(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(root.endsWith("/") ? root : `${root}/`);
}

/**
 * Resolve which book is "active" after opening `pickedDir` inside a repo whose
 * books (already sorted by `subPath`) are `books`. Mirrors the C1 design
 * decisions:
 *  - No repo, or the repo has no books at all: the picked folder stays active
 *    (today's single-folder behaviour, unchanged — no redirect).
 *  - Exactly one book in the repo: that book is always active, regardless of
 *    which folder was picked (a single-book repo, including a book living at
 *    the repo root, behaves identically to opening it directly today).
 *  - Multiple books: the book that CONTAINS the picked folder is active — the
 *    deepest one, so nested books resolve to the innermost; otherwise (the bare
 *    repo root, or a repo-level folder like `shared/` that belongs to no book)
 *    the first book alphabetically by `subPath` is active until the user
 *    switches (#C2).
 *
 * The containment match replaced an exact `===` compare (2026-07-29 audit).
 * That compare made the `books[0]` fallback — documented as "the bare repo root
 * was picked" — fire for ANY non-identical string, so opening a folder INSIDE
 * book B, or B's own path spelled with a trailing slash, silently opened book A
 * instead of the book the author pointed at. Matching is separator-aware, so a
 * prefix sibling (`/repo/beta2` against a `/repo/beta` book) is not "inside" it.
 */
export function resolveActiveBookDir(
  pickedDir: string,
  repoRoot: string | undefined,
  books: ProjectBookEntry[],
): string {
  if (!repoRoot || books.length === 0) return pickedDir;
  if (books.length === 1) return books[0]!.path;
  const picked = normalizeDirPath(pickedDir);
  let best: ProjectBookEntry | undefined;
  let bestLength = -1;
  for (const book of books) {
    const candidate = normalizeDirPath(book.path);
    if (!isSameOrInside(picked, candidate)) continue;
    // Deepest match wins, so a book nested inside another resolves to the inner.
    if (candidate.length > bestLength) {
      best = book;
      bestLength = candidate.length;
    }
  }
  return (best ?? books[0]!).path;
}

export interface ProjectSessionDeps {
  /** Host round-trip: classify a project folder (source type + capabilities). */
  classifyProject: (dir: string) => Promise<ProjectClassification>;
  /** Persist the re-detected source hint (fire-and-forget on the component side). */
  setDesktopPrefs: (prefs: Record<string, unknown>) => Promise<unknown>;
}

export class ProjectSessionController {
  // ── Public rune state (read by the template; mutated only via methods) ──────
  /** Capabilities of the open project's source (#12), or null before classify. */
  projectCapabilities = $state<ProjectCapabilities | null>(null);
  /** The book's path relative to its shared repo ("" for standalone projects). */
  projectSubPath = $state("");
  /**
   * Whether the open project's git repo has a configured remote (any protocol),
   * regardless of whether Gutterpress can auto-sync to it. Distinguishes a project
   * that HAS an online copy but isn't Gutterpress-synced (SSH remote, or an HTTPS
   * remote with no stored credential) from a purely local one — so the status
   * bar's "Online copy" row never wrongly reads "Kept on this computer" when a
   * remote is in fact configured (user feedback). False for non-git folders.
   */
  projectHasRemote = $state(false);
  /** Root of the repo the open folder belongs to; null when there is no repo. */
  repoRoot = $state<string | null>(null);
  /** Books (manifest-containing folders) found inside `repoRoot`; [] when there is no repo. */
  books = $state<ProjectBookEntry[]>([]);
  /** The book the session currently targets, per {@link resolveActiveBookDir}. */
  activeBookDir = $state<string | null>(null);
  /** Manifest presence for the active target; drives the loose-folder setup banner. */
  activeBookHasManifest = $state(true);

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
    this.projectHasRemote = false;
    this.repoRoot = null;
    this.books = [];
    this.activeBookDir = null;
    this.activeBookHasManifest = true;
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
        this.projectHasRemote =
          result.source.type === "local-git-folder" ? result.source.hasRemote : false;
        this.repoRoot = result.repoRoot ?? null;
        this.books = result.books ?? [];
        this.activeBookDir = resolveActiveBookDir(dir, result.repoRoot, this.books);
        this.activeBookHasManifest =
          this.books.some((book) => book.path === this.activeBookDir) ||
          (this.activeBookDir === dir && result.hasManifest);
        this.deps.setDesktopPrefs({ projectSource: result.source }).catch(() => {});
        // NOTE: the remote diagnosis (SyncController.refreshSyncDiag) is NOT
        // fired from here anymore. It used to be, and was silently discarded
        // on essentially every open: refreshSyncDiag's stale-guard compares
        // against lifecycle.currentDir, which is only assigned AFTER the
        // (seconds-long) preview start — while the diagnosis (millisecond fs
        // reads) resolved first and failed the compare. Worse, it was keyed to
        // the PICKED dir while currentDir becomes the retargeted activeBookDir.
        // The lifecycle controller now refreshes it right after currentDir is
        // assigned, keyed to the same targetDir (see openFolder).
      })
      .catch(() => {
        if (gen !== this.classifyGen) return;
        this.projectCapabilities = null;
      });
  }
}
