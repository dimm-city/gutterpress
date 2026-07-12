/**
 * Shared fs-route project-scoping guard (ARCH review #37).
 *
 * Before this module, `/api/fs/{read-file,write-file,list-dir,stat-file,
 * copy-file}` accepted any absolute path — the only guard was `isAbsolute`.
 * Any code that can issue a same-origin fetch inside the renderer (a preview
 * XSS, a malicious plugin-injected script, a compromised dependency) could
 * read or overwrite arbitrary files on disk. `write-file` already computed a
 * `path.resolve(watchedDir)` + `startsWith(root + sep)` containment test, but
 * only to decide whether to schedule an auto-snapshot — never to authorize
 * the write. This module promotes that same containment test to a shared
 * authorization guard consumed by all five routes (see
 * `src/routes/api/_lib/fs-guard.ts`'s `requireWithinProjectRoot`, the one
 * place that actually throws).
 *
 * ## Policy
 *
 * `projectRoots()` is the currently-open project. It is sourced from BOTH:
 *   - the active preview's resolved input dir, set the instant `api:preview`
 *     resolves (main.ts's `activePreview`), and
 *   - the folder watcher's tracked dir, set slightly later once the renderer
 *     calls `fs:watchFolder` (`folderWatch.getWatchedDir()`).
 * Both are included because the SPA's own open-project sequence
 * (`routes/+page.svelte`) lists/reads the NEW project's files
 * (`ensureEditorFile`, the manifest-detection `listDir`) BEFORE it calls
 * `startFolderWatch` — gating on the watcher alone would 403 every
 * "open a different project" flow during that window. Once a project closes,
 * both go back to empty, so a stray fs-route call from the SPA with no
 * project open is rejected rather than falling back to "anywhere".
 *
 * `readOnlyRoots()` extends the read paths (`fs/read-file` and `log/read`),
 * with directories that are legitimately read from outside the open project
 * but must never be a write-file/list-dir/stat-file/copy-file-`dest` target:
 *   - the crash-recovery sidecar dir under `userData/recovery/` —
 *     `+page.svelte`'s `restoreRecovery` reads a snapshot's absolute
 *     `recoveryPath` (returned by `recovery:list`) through the generic
 *     `fs/read-file` route rather than a dedicated recovery-read route; and
 *   - the operation-log dir under `userData/logs/` — `ProjectActivityView` /
 *     the operation-log dialog read the per-project `.log` file through the
 *     `log/read` route. App-managed and non-sensitive.
 *
 * `copy-file`'s `src` is DELIBERATELY EXEMPT from both allow-lists — see the
 * comment on `src/routes/api/fs/copy-file/+server.ts`'s `validate`. The
 * editor's "insert image" / media-panel "import" flows pick `src` via a
 * native OS file dialog (`dialog:pickImageFile[s]`); the whole point of the
 * route is copying a file the author chose from ANYWHERE on disk into the
 * project. Only `dest` (what actually gets written) is confined.
 */
import path from "node:path";
import { getHostServices } from "./host-services";

/**
 * True if `candidate` (an absolute path) IS `root`, or is nested under it.
 * Never a bare `startsWith(root)` — that would let a sibling directory with a
 * shared prefix (`/home/u/proj2` against a `/home/u/proj` root) match.
 */
export function isWithinRoot(candidate: string, root: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  return (
    resolvedCandidate === resolvedRoot ||
    resolvedCandidate.startsWith(resolvedRoot + path.sep)
  );
}

/** True if `candidate` is within ANY of `roots`. */
export function isWithinAnyRoot(candidate: string, roots: readonly string[]): boolean {
  return roots.some((root) => isWithinRoot(candidate, root));
}

export interface FsGuardHooks {
  /**
   * Every directory the generic fs routes may currently read/write under.
   * Empty when no project is open — every check then fails closed instead of
   * falling back to "anywhere".
   */
  projectRoots(): string[];
  /**
   * Extra directories allowed for READS ONLY, layered on top of
   * {@link projectRoots}. Never a legal write-file/list-dir/stat-file/
   * copy-file-`dest` target.
   */
  readOnlyRoots(): string[];
}

/** The live `FsGuardHooks` slice of the collapsed host object (ARCH #31), or null before `registerHostServices` runs. */
export function getFsGuardHooks(): FsGuardHooks | null {
  return getHostServices()?.fsGuard ?? null;
}
