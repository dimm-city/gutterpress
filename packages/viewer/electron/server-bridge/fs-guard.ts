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
 * `copy-file`'s `src` is EXEMPT from both allow-lists for a different reason
 * than the read-only exemptions above: the editor's "insert image" /
 * media-panel "import" flows need to copy an author-picked file from
 * ANYWHERE on disk INTO the project, so `src` can't be confined to a project
 * root the way `dest` is. That used to be "enforced" by nothing but a
 * docstring asserting `src` "came from a native file dialog" — a same-origin
 * script could just POST an arbitrary `src` and the route would copy it in
 * no questions asked (P1 review). `src` outside the project is now gated by
 * a SEPARATE mechanism, not this module's root allow-lists: `fs/copy-file`
 * (and `media/import-image`, the other route with the same shape) require a
 * `src` outside the project to be a one-time "picked-file" capability —
 * registered ONLY when `dialog:pickImageFile[s]` hands back a path the
 * native dialog itself just returned, and consumed on first use. See
 * `./picked-files.ts`. Only `dest` (what actually gets written) is confined
 * by THIS module's allow-lists.
 */
import path from "node:path";
import { realpath, lstat, readlink } from "node:fs/promises";
import { getHostServices } from "./host-services";

/**
 * True if `candidate` (an absolute path) IS `root`, or is nested under it.
 * Never a bare `startsWith(root)` — that would let a sibling directory with a
 * shared prefix (`/home/u/proj2` against a `/home/u/proj` root) match.
 *
 * Purely LEXICAL (`path.resolve`, no filesystem access) — it does not follow
 * symlinks. Callers making an authorization decision must canonicalize both
 * sides first with {@link isWithinRootCanonical}/{@link isWithinAnyRootCanonical};
 * this function remains the final separator-aware string compare either way.
 */
export function isWithinRoot(candidate: string, root: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  return (
    resolvedCandidate === resolvedRoot ||
    resolvedCandidate.startsWith(resolvedRoot + path.sep)
  );
}

/** True if `candidate` is within ANY of `roots`. Lexical only — see {@link isWithinRoot}. */
export function isWithinAnyRoot(candidate: string, roots: readonly string[]): boolean {
  return roots.some((root) => isWithinRoot(candidate, root));
}

/**
 * Resolve `p` to its canonical (symlink-free) form, tolerating a tail that
 * doesn't exist on disk yet — e.g. a write/create target whose parent
 * directories exist but whose final segment(s) don't.
 *
 * `fs.realpath` throws `ENOENT` (or `ENOTDIR`, if a path component that
 * should be a directory turns out to be a file) on any non-existent
 * component, so a create/write target can't be realpath'd directly. This
 * walks up from `p` until it finds the deepest EXISTING ancestor, realpaths
 * THAT ancestor (following any symlinks in it), then re-appends the
 * non-existent tail segments unchanged.
 *
 * This is what makes containment checks symlink-safe for both reads (the
 * whole path already exists) and writes/creates (the parent exists, the leaf
 * doesn't yet): a project-local symlink pointing outside the project no
 * longer fools the containment check, because it runs on the REAL target
 * directory, not the lexical alias path.
 *
 * DANGLING SYMLINKS (fix round 2): `fs.realpath` reports ENOENT both for "no
 * entry exists here at all" AND for "an entry exists here as a symlink whose
 * ultimate target doesn't exist" — those are NOT the same thing. If we always
 * treated the failing component's basename as an inert non-existent tail
 * segment, a project-local DANGLING symlink (e.g.
 * `projectDir/evil -> /home/victim/victimdir/planted.txt`, where
 * `victimdir` exists but `planted.txt` doesn't yet) would canonicalize to
 * `projectDir/evil` — INSIDE the project — even though a subsequent
 * `open(path, "w")` on that same symlink creates `planted.txt` OUTSIDE the
 * project. So before falling through to the tail-accumulation path, `lstat`
 * the failing component: if it exists as a symlink, resolve it via
 * `readlink` (relative to its own realpath'd parent) and keep resolving from
 * there — only genuinely-absent components fall through to the lexical tail.
 */
export async function realpathTolerant(p: string): Promise<string> {
  return realpathTolerantAt(path.resolve(p), [], 0);
}

// Bounds the recursion driven by chains of dangling symlinks (including a
// cycle of dangling links pointing at each other, which — unlike a cycle of
// REAL symlinks — `fs.realpath` can't detect via ELOOP, because it never
// gets far enough to notice a loop; every hop 404s first). 40 mirrors the
// typical OS symlink-hop limit (Linux's `MAXSYMLINKS`).
const MAX_SYMLINK_DEPTH = 40;

async function realpathTolerantAt(
  target: string,
  trailingTail: readonly string[],
  depth: number,
): Promise<string> {
  const tail: string[] = [...trailingTail];
  let current = target;
  for (;;) {
    try {
      const real = await realpath(current);
      return tail.length ? path.join(real, ...tail) : real;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw e;

      let linkStat: Awaited<ReturnType<typeof lstat>> | null = null;
      try {
        linkStat = await lstat(current);
      } catch (lstatErr) {
        const lstatCode = (lstatErr as NodeJS.ErrnoException)?.code;
        if (lstatCode !== "ENOENT" && lstatCode !== "ENOTDIR") throw lstatErr;
        linkStat = null; // genuinely nothing here — fall through to the tail path below
      }

      if (linkStat?.isSymbolicLink()) {
        if (depth >= MAX_SYMLINK_DEPTH) {
          throw Object.assign(
            new Error(`realpathTolerant: too many levels of symbolic links resolving ${target}`),
            { code: "ELOOP" },
          );
        }
        const parent = path.dirname(current);
        const realParent = parent === current ? current : await realpathTolerantAt(parent, [], depth + 1);
        const linkTarget = await readlink(current);
        const resolvedTarget = path.isAbsolute(linkTarget) ? linkTarget : path.join(realParent, linkTarget);
        // Keep resolving from the link's target, carrying the same trailing
        // tail (segments after `current` that were already peeled off).
        return realpathTolerantAt(path.resolve(resolvedTarget), tail, depth + 1);
      }

      const parent = path.dirname(current);
      if (parent === current) return target; // hit the fs root; give up, lexical fallback
      tail.unshift(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Symlink-safe version of {@link isWithinAnyRoot}: canonicalizes `candidate`
 * and each `root` (see {@link realpathTolerant}) before the separator-aware
 * containment compare, so a project-local symlink aliasing an outside
 * directory — or a symlinked project root itself — can no longer pass as
 * "inside". Use for any check that GATES a filesystem read/write; use the
 * plain lexical {@link isWithinAnyRoot} only for non-authorization decisions
 * (e.g. "should this write trigger an auto-snapshot debounce").
 */
export async function isWithinAnyRootCanonical(
  candidate: string,
  roots: readonly string[],
): Promise<boolean> {
  if (roots.length === 0) return false;
  const canonCandidate = await realpathTolerant(candidate);
  for (const root of roots) {
    const canonRoot = await realpathTolerant(root);
    if (isWithinRoot(canonCandidate, canonRoot)) return true;
  }
  return false;
}

/** Symlink-safe version of {@link isWithinRoot} — see {@link isWithinAnyRootCanonical}. */
export async function isWithinRootCanonical(candidate: string, root: string): Promise<boolean> {
  return isWithinAnyRootCanonical(candidate, [root]);
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
