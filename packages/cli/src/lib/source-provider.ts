/**
 * Source / version-history provider (#12/#13/#25, governed by CLAUDE.md §7).
 *
 * `detectProjectSource` (`project-source.ts`) CLASSIFIES an opened folder. This
 * module is the OPERATIONS surface — init, snapshot, list history, restore —
 * that the new-project scaffold (#25) and the version-history UI (#13) drive.
 * It is the single abstraction both the CLI and the desktop call.
 *
 * NON-NEGOTIABLE (CLAUDE.md §7): every operation is backed by a **Node-native,
 * pure-JS** implementation (`isomorphic-git`) — NOT the system `git` binary,
 * NOT the GitHub CLI (`gh`), and with no expectation that the user has Git
 * installed (we do not bundle it). This keeps the `bun build --compile` CLI
 * binary and the packaged desktop fully self-contained.
 */
import * as fs from "node:fs";
import path from "node:path";

import git from "isomorphic-git";

import type { ProjectCapabilities, ProjectSource } from "./project-source.ts";
import {
  capabilitiesFor,
  detectProjectSource,
  findEnclosingRepoDir,
} from "./project-source.ts";
import { createFileLogger } from "./remote-auth/operation-log.ts";

const noopLogger: { debug(): void; info(): void; warn(): void; error(): void } = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * isomorphic-git object cache scoped to ONE operation and released with it.
 * NEVER hold one in module state: reading any object from a packfile loads
 * the ENTIRE pack into the cache (multi-GB RSS on large repos). See the
 * matching note in remote-auth/sync.ts.
 */
type GitCache = Record<string, unknown>;

/** One entry in a project's version history (a Git commit, abstracted). */
export interface SnapshotEntry {
  /** Opaque revision id (a commit SHA for the local-git provider). */
  id: string;
  /** Author-supplied or auto-generated snapshot message. */
  message: string;
  /** Epoch milliseconds the snapshot was taken. */
  timestamp: number;
  /** Display name recorded for the snapshot author, if any. */
  author?: string;
}

/** Inputs for initialising local version history on a folder (#25 default). */
export interface InitVersionHistoryOptions {
  projectDir: string;
  authorName?: string;
  authorEmail?: string;
  initialMessage?: string;
}

/** Inputs for taking a snapshot (commit) of the current working tree. */
export interface SnapshotOptions {
  projectDir: string;
  message: string;
  authorName?: string;
  authorEmail?: string;
  /**
   * Root of the Git repository the commit goes to. Defaults to `projectDir`.
   * When the project is a subfolder of a repo, this is the enclosing repo root
   * (the snapshot commits the whole tree — plain git, no per-folder scoping).
   */
  repoRoot?: string;
  /** Optional log file for debugging snapshot operations. */
  logFile?: string;
  /**
   * The CALLER's object cache, when the snapshot is one step of a longer
   * locked operation (sync). Committing rewrites `.git/index`, and
   * isomorphic-git's index cache invalidates on a stat comparison that can
   * miss a same-second rewrite of the same size — so a caller that keeps
   * using its own cache afterwards would keep reading the PRE-snapshot index.
   * That is not cosmetic: `git.checkout` derives STAGE from it, and a stale
   * STAGE makes an unmodified file look locally modified. Pass the cache and
   * the snapshot's own `git.add`/`git.commit` refresh it in place. Omit it
   * for standalone snapshots — they get a private cache, released on return.
   */
  cache?: GitCache;
}

/**
 * The git repo directory a project's operations run against. A project IS its
 * git repo: opening a subfolder of a multi-book repo just opens the repo, and
 * every operation (snapshot, history, restore, sync) runs on the repo root over
 * the WHOLE tree — plain git semantics, no per-book scoping. Defensive: older
 * persisted sources without `repoRoot` fall back to the project path.
 */
export function gitScopeFor(
  source: Extract<ProjectSource, { type: "local-git-folder" }>,
): string {
  return source.repoRoot || source.path;
}

/** Inputs for restoring the working tree to a prior snapshot. */
export interface RestoreSnapshotOptions {
  projectDir: string;
  id: string;
}

/** Paging inputs for {@link SourceProvider.listHistoryPage}. */
export interface ListHistoryOptions {
  /** Max entries per page (clamped to [1, 500]; default {@link HISTORY_PAGE_LIMIT}). */
  limit?: number;
  /**
   * Continuation cursor: the `id` of the LAST entry of the previous page.
   * The returned page starts strictly after it (newest-first order).
   */
  before?: string;
}

/** One page of version history (see {@link SourceProvider.listHistoryPage}). */
export interface HistoryPage {
  entries: SnapshotEntry[];
  /** True when older entries exist past this page (pass the last id as `before`). */
  hasMore: boolean;
}

/** Default history page size. Bounds the commit walk on huge repositories. */
export const HISTORY_PAGE_LIMIT = 100;

/**
 * The version-control operations a project source can perform. Implementations
 * are selected by `ProjectSource.type` (see {@link providerFor}).
 */
export interface SourceProvider {
  readonly source: ProjectSource;
  readonly capabilities: ProjectCapabilities;
  initVersionHistory(options: InitVersionHistoryOptions): Promise<ProjectSource>;
  snapshot(options: SnapshotOptions): Promise<SnapshotEntry>;
  /**
   * Newest-first history, BOUNDED to the default page size. A convenience
   * wrapper over {@link listHistoryPage} — use that for "load more" paging.
   */
  listHistory(projectDir: string): Promise<SnapshotEntry[]>;
  /** One page of newest-first history with a `before`-cursor continuation. */
  listHistoryPage(projectDir: string, options?: ListHistoryOptions): Promise<HistoryPage>;
  restore(options: RestoreSnapshotOptions): Promise<void>;
}

const DEFAULT_AUTHOR = "gutterpress";
const DEFAULT_EMAIL = "noreply@gutterpress.local";
const DEFAULT_BRANCH = "main";
const SNAPSHOT_STAGING_MARKER = "gutterpress-snapshot-staging";

// ── Per-repo operation queue ─────────────────────────────────────────────────
// WHY: isomorphic-git has NO repo locking — two concurrent operations against
// the same `.git` (e.g. an auto-snapshot racing a user-initiated restore)
// interleave index/ref writes and can corrupt the repository. Every public
// operation on a project dir is therefore serialized through a simple promise
// chain keyed on the resolved dir. ADR 0006 D2 requires this same queue for
// the future fetch/push surface (#15/#16), so keep it here, not in callers.
const repoQueues = new Map<string, Promise<unknown>>();

/**
 * Resolve the lock-map key for a project dir: the REAL (symlink-resolved)
 * path when possible, falling back to the plain resolved path when
 * `realpathSync` can't run (e.g. the dir doesn't exist yet, such as the
 * target of `git init`). Without this, two different-looking paths to the
 * SAME repo (e.g. one traversing a symlink) would get separate queues and
 * could interleave writes against the same `.git` — the exact corruption
 * this lock exists to prevent.
 */
function repoLockKey(projectDir: string): string {
  const resolved = path.resolve(projectDir);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

/**
 * Run `fn` exclusively per resolved project dir (FIFO promise chaining).
 * Exported for the remote-clone surface (#15) so clone/fetch operations share
 * the SAME queue as snapshot/restore — ADR 0006 D2 requires one per-repo lock.
 */
export function withRepoLock<T>(projectDir: string, fn: () => Promise<T>): Promise<T> {
  const key = repoLockKey(projectDir);
  const prev = repoQueues.get(key) ?? Promise.resolve();
  // Chain regardless of the previous op's outcome; a failure must not jam the queue.
  const run = prev.then(fn, fn);
  // Park the chain tail, swallowing its rejection so the map never holds a
  // rejected promise that would surface as an unhandled rejection.
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  repoQueues.set(key, tail);
  // Reclaim the entry once this tail settles IF nothing newer was chained after
  // it (audit B4). Without this, `repoQueues` kept one permanent entry per
  // distinct project dir ever opened for the life of a long-running host. The
  // identity guard is the same pattern browser-pool.ts uses: a concurrent
  // withRepoLock for the same key replaces the map value, so `get(key) === tail`
  // is only true when this was the last queued op. A still-queued op holds its
  // OWN `prev` reference captured above, so deleting the map entry never affects
  // an op that already enqueued — deletion only happens on a fully-settled,
  // idle chain, which a new op correctly restarts from `Promise.resolve()`.
  void tail.then(() => {
    if (repoQueues.get(key) === tail) repoQueues.delete(key);
  });
  return run;
}

/**
 * Test-only: current number of live per-repo lock queues. Lets tests assert the
 * B4 reclamation actually happens (the map returns to empty once every queued
 * op settles) without exporting the map itself. Same test-hook convention as
 * plugins.ts's `__resetPathPluginCacheForTests`.
 */
export function __repoLockQueueSizeForTests(): number {
  return repoQueues.size;
}

/**
 * Resolve the commit author identity from an optional display name.
 */
function gitAuthor(name?: string, email?: string): { name: string; email: string } {
  const n = (name ?? "").trim();
  const e = (email ?? "").trim();
  return { name: n || DEFAULT_AUTHOR, email: e || DEFAULT_EMAIL };
}

async function readGitAuthor(dir: string): Promise<{ name?: string; email?: string }> {
  const [name, email] = await Promise.all([
    git.getConfig({ fs, dir, path: "user.name" }).catch(() => undefined),
    git.getConfig({ fs, dir, path: "user.email" }).catch(() => undefined),
  ]);
  return {
    name: typeof name === "string" ? name : undefined,
    email: typeof email === "string" ? email : undefined,
  };
}

/**
 * Resolve the author for a commit in `dir`, PER FIELD: caller-supplied →
 * existing repo config (`user.name` / `user.email`) → the gutterpress default.
 *
 * This is the ONE author-resolution rule for every commit gutterpress writes —
 * snapshots, merge commits, conflict resolutions, and recovery rescue commits
 * alike. Do NOT call `gitAuthor` directly at a commit site: it skips the repo
 * config, so a partially configured identity (say a name in Settings, an email
 * in `.git/config`) would produce one identity for the snapshot and a
 * different, defaulted one for the merge commit of the SAME sync.
 */
export async function resolveGitAuthor(dir: string, name?: string, email?: string): Promise<{ name: string; email: string }> {
  const existing = await readGitAuthor(dir);
  return gitAuthor(name || existing.name, email || existing.email);
}

/** Workdir-vs-index differences, as `git add -A` staging lists. */
export interface WorkdirChanges {
  /** New or modified files to `git.add`. */
  adds: string[];
  /** Deleted files to `git.remove`. */
  removes: string[];
}

/**
 * List workdir-vs-index differences with the library's `git.walk` over the
 * `WORKDIR` and `STAGE` walkers — deliberately NO `TREE` (HEAD) walker, so a
 * snapshot check never reads historical packfiles (multi-GB RSS on large
 * repos). Whole-tree (a project is its git repo). Honours `.gitignore` for
 * untracked paths (which also prunes `.git` itself — `isIgnored` always
 * ignores it), exactly like `statusMatrix` does.
 */
export async function listWorkdirChanges(
  dir: string,
  cache: GitCache = {},
): Promise<WorkdirChanges> {
  const adds: string[] = [];
  const removes: string[] = [];
  await git.walk({
    fs,
    dir,
    cache,
    trees: [git.WORKDIR(), git.STAGE()],
    map: async (filepath, [workdir, stage]) => {
      if (filepath === ".") return;
      // Untracked paths respect .gitignore (returning null prunes the
      // subtree, so ignored directories are never descended into). The
      // `.git-damaged` prefix rides the same skip: pre-0.10.1 repairs parked
      // the damaged `.git` backup INSIDE the project as `.git-damaged-<stamp>`,
      // and a book still carrying one must never have that object store
      // committed by a snapshot (0.10.1 writes the backup to the OS temp dir).
      if (
        !stage &&
        workdir &&
        (filepath.startsWith(".git-damaged") ||
          (await git.isIgnored({ fs, dir, filepath })))
      ) {
        return null;
      }
      const [wType, sType] = await Promise.all([
        workdir ? workdir.type() : Promise.resolve(undefined),
        stage ? stage.type() : Promise.resolve(undefined),
      ]);
      if (wType === "tree" || sType === "tree") {
        // Recurse into directories; record a file⇄folder swap's blob side.
        if (sType === "blob") removes.push(filepath);
        else if (wType === "blob") adds.push(filepath);
        return;
      }
      if (wType === "blob" && !sType) {
        adds.push(filepath); // new file
      } else if (!wType && sType === "blob") {
        removes.push(filepath); // deleted file
      } else if (wType === "blob" && sType === "blob") {
        // Two-phase change detection:
        //   Phase 1 (fast path): the WORKDIR walker reuses the index oid when
        //   stats match, so a stat mismatch (different size or mtime) means
        //   the file definitely changed — no file read needed.
        //   Phase 2 (racy-index guard): when stats match, the walker returns
        //   the cached index oid without rehashing, so a same-byte-length edit
        //   within the same second is invisible. Read and hash the actual file
        //   content to catch it. This only runs for files whose stats match,
        //   so unchanged files with drifted stats (the common "definitely
        //   changed" case) stay on the fast path.
        const workdirOid = await workdir!.oid();
        const stageOid = await stage!.oid();
        if (workdirOid !== stageOid) {
          adds.push(filepath);
        } else {
          const fileBytes = await fs.promises.readFile(path.join(dir, filepath as string));
          const { oid: actualOid } = await git.hashBlob({ object: fileBytes });
          if (actualOid !== stageOid) adds.push(filepath);
        }
      }
      // "special"/"commit" entries (sockets, submodules) are skipped.
      return;
    },
  });
  return { adds, removes };
}

/**
 * Apply a {@link WorkdirChanges} diff to the index (`git add -A` semantics).
 * Exported so callers that already computed a `WorkdirChanges` via
 * {@link listWorkdirChanges} (e.g. the detached-HEAD recovery handler) can
 * stage it without re-walking the tree or falling back to `git.statusMatrix`,
 * which loads whole packfiles into memory on large repos.
 */
export async function stageChanges(
  dir: string,
  changes: WorkdirChanges,
  cache: GitCache,
): Promise<void> {
  if (changes.adds.length > 0) {
    await git.add({ fs, dir, cache, filepath: changes.adds });
  }
  for (const filepath of changes.removes) {
    await git.remove({ fs, dir, cache, filepath });
  }
}

/**
 * True when the working tree differs from the index (added/modified/deleted
 * files). Used to skip empty snapshots. Exported (lock-free) for the sync
 * surface (#15, ADR 0006 D5) — callers outside a lock should prefer the
 * provider operations.
 */
export async function hasPendingChanges(
  dir: string,
  cache: GitCache = {},
): Promise<boolean> {
  const { adds, removes } = await listWorkdirChanges(dir, cache);
  return adds.length > 0 || removes.length > 0;
}

/**
 * True when the working tree has ANY uncommitted change relative to HEAD —
 * both WORKDIR-vs-STAGE (unstaged edits) AND STAGE-vs-HEAD (staged-but-
 * uncommitted). This matches `git status --porcelain`'s notion of "dirty".
 *
 * Distinct from {@link hasPendingChanges} (WORKDIR-vs-STAGE only, the hot
 * sync-check path per the sync-simplicity mandate): this is for build
 * *provenance* — the build fingerprint records whether the tree was clean at
 * build time, where a `git add`-ed-but-not-committed change must still count
 * as dirty (the old `git status --porcelain` fingerprint reported it; the
 * WORKDIR-vs-STAGE-only check silently dropped it).
 */
export async function hasUncommittedChanges(
  dir: string,
  cache: GitCache = {},
): Promise<boolean> {
  if (await hasPendingChanges(dir, cache)) return true;
  // A HEAD is guaranteed to exist at the fingerprint call site (it resolves
  // HEAD first); stageMatchesHead returns false for a repo with no commit,
  // which correctly reads as "dirty" (staged content, nothing committed yet).
  return !(await stageMatchesHead(dir, cache));
}

/**
 * True when the INDEX (STAGE) is byte-identical to the tip commit's tree.
 * Deliberately NOT used on the hot sync-check path (that's `hasPendingChanges`
 * / `listWorkdirChanges`, WORKDIR-vs-STAGE only, per the sync-simplicity
 * mandate) — this reads the TREE walker, which is only safe here because it
 * runs solely on the rare stale-staging-marker recovery path, at most once per
 * crash, never on every sync check.
 */
async function stageMatchesHead(dir: string, cache: GitCache): Promise<boolean> {
  let headOid: string;
  try {
    headOid = await git.resolveRef({ fs, dir, ref: "HEAD" });
  } catch {
    return false; // no commit yet — nothing for the stage to "match"
  }
  let differs = false;
  await git.walk({
    fs,
    dir,
    cache,
    trees: [git.TREE({ ref: headOid }), git.STAGE()],
    map: async (filepath, [tree, stage]) => {
      if (differs || filepath === ".") return differs ? null : undefined;
      const [tType, sType] = await Promise.all([
        tree ? tree.type() : Promise.resolve(undefined),
        stage ? stage.type() : Promise.resolve(undefined),
      ]);
      if (tType === "tree" || sType === "tree") return; // recurse
      if (!tType !== !sType) {
        differs = true; // present on only one side
        return null;
      }
      if (!tType || !sType) return; // both absent
      const [tOid, sOid] = await Promise.all([tree!.oid(), stage!.oid()]);
      if (tOid !== sOid) differs = true;
      return null;
    },
  });
  return !differs;
}

/**
 * `local-folder` provider: no version history. `initVersionHistory` is the one
 * op that "upgrades" the folder to a `local-git-folder`; the read/restore verbs
 * reject (a plain folder has no history). After init the caller should
 * re-classify via `detectProjectSource`.
 */
class LocalFolderSourceProvider implements SourceProvider {
  readonly source: ProjectSource;
  readonly capabilities: ProjectCapabilities;
  constructor(source: ProjectSource) {
    this.source = source;
    this.capabilities = capabilitiesFor(source);
  }

  async initVersionHistory(
    options: InitVersionHistoryOptions,
  ): Promise<ProjectSource> {
    const dir = options.projectDir;
    // Defense in depth for the one TRUE conflict case: a `git init` INSIDE an
    // existing repository would create a nested shadow repo that silently
    // detaches these files from the outer repo's tracking. Classification now
    // maps such folders to `local-git-folder` (they USE the enclosing repo's
    // history), so the UI never offers this path — but a stale/hand-built
    // source must still never nest a repo.
    if ((await findEnclosingRepoDir(dir)) !== undefined) {
      throw new Error(
        "This folder is already inside a versioned project, so gutterpress " +
          "won't create a separate history here.",
      );
    }
    return withRepoLock(dir, async () => {
      const cache: GitCache = {};
      await git.init({ fs, dir, defaultBranch: DEFAULT_BRANCH });
      await stageChanges(dir, await listWorkdirChanges(dir, cache), cache);
      await git.commit({
        fs,
        dir,
        cache,
        message: options.initialMessage?.trim() || "Created project",
        author: await resolveGitAuthor(dir, options.authorName, options.authorEmail),
      });
      return {
        type: "local-git-folder",
        path: dir,
        repoRoot: dir,
        subPath: "",
        hasRemote: false,
        branch: DEFAULT_BRANCH,
      };
    });
  }

  snapshot(): Promise<SnapshotEntry> {
    return Promise.reject(
      new Error(
        "This project has no version history yet. Enable version history first.",
      ),
    );
  }

  listHistory(): Promise<SnapshotEntry[]> {
    return Promise.resolve([]);
  }

  listHistoryPage(): Promise<HistoryPage> {
    return Promise.resolve({ entries: [], hasMore: false });
  }

  restore(): Promise<void> {
    return Promise.reject(
      new Error(
        "This project has no version history yet. Enable version history first.",
      ),
    );
  }
}

/**
 * `local-git-folder` provider: backed entirely by `isomorphic-git` against the
 * project's `.git` directory (pure JS, no system git).
 */
class LocalGitSourceProvider implements SourceProvider {
  readonly source: ProjectSource;
  readonly capabilities: ProjectCapabilities;
  /** The git repo root every operation runs against (whole tree). */
  private readonly dir: string;
  constructor(source: Extract<ProjectSource, { type: "local-git-folder" }>) {
    this.source = source;
    this.capabilities = capabilitiesFor(source);
    this.dir = gitScopeFor(source);
  }

  async initVersionHistory(
    options: InitVersionHistoryOptions,
  ): Promise<ProjectSource> {
    // Already a git folder — initialising again is a no-op snapshot. A clean
    // tree is expected here (nothing to save), so swallow ONLY the known
    // "no changes" rejection; real errors (corrupt repo, fs failures) must
    // surface to the caller.
    try {
      await this.snapshot({
        projectDir: options.projectDir,
        message: options.initialMessage?.trim() || "Created project",
        authorName: options.authorName,
        authorEmail: options.authorEmail,
      });
    } catch (e) {
      if (!isNoChangesError(e)) throw e;
    }
    return this.source;
  }

  snapshot(options: SnapshotOptions): Promise<SnapshotEntry> {
    return withRepoLock(this.dir, () => this.snapshotUnlocked(options));
  }

  /** Lock-free snapshot impl — callers must already hold the repo lock. */
  snapshotUnlocked(options: SnapshotOptions): Promise<SnapshotEntry> {
    return snapshotWorkingTreeUnlocked({ ...options, repoRoot: this.dir });
  }

  async listHistory(projectDir: string): Promise<SnapshotEntry[]> {
    return (await this.listHistoryPage(projectDir)).entries;
  }

  /**
   * LOCK-FREE by design: `git.log` is a pure read (refs resolved once, then
   * an object walk over immutable commits/trees), so it can never corrupt
   * the repo and doesn't need the per-repo write queue. Taking the lock here
   * used to queue the History dialog behind a running auto-snapshot of a
   * large working tree — a multi-second stall for a read-only view.
   */
  async listHistoryPage(
    _projectDir: string,
    options: ListHistoryOptions = {},
  ): Promise<HistoryPage> {
    const dir = this.dir;
    const limit = Math.min(500, Math.max(1, options.limit ?? HISTORY_PAGE_LIMIT));
    const before = options.before;
    // Whole-repo history (a project is its git repo). `depth` bounds the walk;
    // continuation starts AT the cursor commit (dropped below). `limit + 2`
    // guarantees that after dropping the cursor at least `limit + 1` entries
    // remain whenever older history exists, so `hasMore` can never read false
    // at a page boundary that still has older entries.
    let commits;
    try {
      commits = await git.log({
        fs,
        dir,
        cache: {}, // per-call cache — never pin packfile buffers across calls
        depth: limit + 2,
        ...(before ? { ref: before } : {}),
      });
    } catch (e) {
      // A garbage/expired cursor must not crash the history view.
      if (before && (e as { code?: string })?.code === "NotFoundError") {
        return { entries: [], hasMore: false };
      }
      throw e;
    }
    // isomorphic-git's log can emit a shared ancestor ONCE PER PARENT after a
    // merge when commit timestamps tie (observed: post-pull merge commits made
    // within the same second). The UI keys its list on the id — dedupe here.
    const seen = new Set<string>();
    let filtered = commits.filter((c) => {
      if (c.oid === before || seen.has(c.oid)) return false;
      seen.add(c.oid);
      return true;
    });
    const hasMore = filtered.length > limit;
    if (hasMore) filtered = filtered.slice(0, limit);
    return {
      entries: filtered.map((c) => ({
        id: c.oid,
        message: c.commit.message.trim(),
        timestamp: c.commit.author.timestamp * 1000,
        author: c.commit.author.name,
      })),
      hasMore,
    };
  }

  restore(options: RestoreSnapshotOptions): Promise<void> {
    return withRepoLock(this.dir, () => this.restoreUnlocked(options));
  }

  /** Lock-free restore impl — callers must already hold the repo lock. */
  async restoreUnlocked(options: RestoreSnapshotOptions): Promise<void> {
    // Restore the WHOLE working tree to the given commit, keeping HEAD on its
    // branch (a non-destructive "restore files to this point" — does not
    // rewrite history). `force` overwrites the working tree with the snapshot.
    await git.checkout({
      fs,
      dir: this.dir,
      cache: {}, // per-call cache — never pin packfile buffers across calls
      ref: options.id,
      force: true,
      noUpdateHead: true,
    });
  }
}

/**
 * Lock-free snapshot of the full working tree (stage everything + commit).
 *
 * Exported for the sync surface (#15, ADR 0006 D5): `syncProject` holds
 * the per-repo lock for snapshot → fetch → merge → push as ONE sequence, so it
 * needs the lock-free internal rather than `provider.snapshot()` (taking the
 * per-method lock inside the sync lock would deadlock the FIFO queue).
 * Callers outside a lock should use `providerFor(source).snapshot()`.
 */
export async function snapshotWorkingTreeUnlocked(
  options: SnapshotOptions,
): Promise<SnapshotEntry> {
  const dir = options.repoRoot ?? options.projectDir;
  const logger = options.logFile
    ? createFileLogger(options.logFile, "snapshot")
    : noopLogger;
  // One object cache for this snapshot operation only (diff + stage +
  // commit share it), released when the operation returns — unless the
  // caller supplied its own, in which case we use that so its index view
  // stays coherent past our commit (see SnapshotOptions.cache).
  const cache: GitCache = options.cache ?? {};
  // Crash-window marker: staging (git.add/remove) and git.commit are two
  // separate writes. A crash between them leaves the index matching the
  // workdir with NO commit — and because the changes walk compares
  // WORKDIR↔STAGE only, every later snapshot would report "nothing to save"
  // while the edits sit staged-but-uncommitted, invisible, forever. The
  // marker (written before staging, removed after commit) makes that state
  // detectable: if it survives into a later snapshot, commit what is staged
  // even though the walk sees no new changes.
  const stagingMarker = snapshotStagingMarkerPath(dir);
  const staleStaging = fs.existsSync(stagingMarker);
  // ONE walk decides both "anything to save?" and what to stage.
  const changes = await listWorkdirChanges(dir, cache);
  const workdirClean = changes.adds.length === 0 && changes.removes.length === 0;
  if (workdirClean && !staleStaging) {
    logger.debug("snapshot", "no changes — skipping");
    throw new Error(
      "No changes since the last snapshot — there is nothing new to save.",
    );
  }
  // A stale marker with a clean WORKDIR↔STAGE walk is ambiguous: either (a)
  // the marker outlived a commit that actually succeeded (crash landed
  // between `git.commit` returning and the `fs.rmSync` below), in which case
  // the index already equals HEAD and committing again would create a
  // duplicate, empty "Snapshot" entry (isomorphic-git has no empty-commit
  // guard) — or (b) the crash landed between staging and commit, in which
  // case the index holds real staged work that HEAD doesn't have yet (the
  // case the marker exists to recover, handled below). STAGE-vs-TREE(HEAD)
  // is the only way to tell them apart; it's safe to read here because this
  // branch only runs on the rare marker-recovery path, never the hot
  // sync-check path (which stays WORKDIR/STAGE-only per the sync-simplicity
  // mandate).
  if (workdirClean && staleStaging && (await stageMatchesHead(dir, cache))) {
    logger.debug("snapshot", "stale marker outlived a completed commit — clearing, not recommitting");
    fs.rmSync(stagingMarker, { force: true });
    const [head] = await git.log({ fs, dir, cache, depth: 1 });
    // stageMatchesHead only returns true when HEAD exists, so `head` is defined.
    return {
      id: head!.oid,
      message: head!.commit.message.trim(),
      timestamp: head!.commit.author.timestamp * 1000,
      author: head!.commit.author.name,
    };
  }
  logger.info("snapshot", "committing", {
    adds: changes.adds.length,
    removes: changes.removes.length,
    ...(staleStaging ? { recoveredStaleStaging: true } : {}),
  });
  fs.writeFileSync(stagingMarker, "");
  await stageChanges(dir, changes, cache);
  const author = await resolveGitAuthor(dir, options.authorName, options.authorEmail);
  const id = await git.commit({
    fs,
    dir,
    cache,
    message: options.message,
    author,
  });
  fs.rmSync(stagingMarker, { force: true });
  // Canonical timestamp comes from the committed object itself (matching
  // what listHistory reads back), not the wall clock at return time.
  const [head] = await git.log({ fs, dir, cache, depth: 1 });
  return {
    id,
    message: options.message,
    timestamp: head ? head.commit.author.timestamp * 1000 : Date.now(),
    author: author.name,
  };
}

/**
 * True for the friendly "nothing new to save" rejection from `snapshot()`.
 * Exported (RC1-3) so the auto-snapshot scheduler in the desktop host can
 * swallow the expected clean-tree rejection without string-matching itself.
 */
export function isNoChangesError(e: unknown): boolean {
  return e instanceof Error && /no changes since the last snapshot/i.test(e.message);
}

/**
 * Select the {@link SourceProvider} implementation for a classified source.
 * `managed-github` (#15/#16) is not implemented yet — it throws if reached.
 */
export function providerFor(source: ProjectSource): SourceProvider {
  switch (source.type) {
    case "local-folder":
      return new LocalFolderSourceProvider(source);
    case "local-git-folder":
      return new LocalGitSourceProvider(source);
    case "managed-github":
      throw new Error(
        "Managed GitHub projects are not supported yet (#15/#16).",
      );
  }
}

/** Resolve the `.git` directory path for a project (used by callers/tests). */
export function gitDirFor(projectDir: string): string {
  return path.join(projectDir, ".git");
}

/** Marker written before staging and removed after commit; presence means a prior snapshot may have died after staging. */
export function snapshotStagingMarkerPath(projectDir: string): string {
  return path.join(gitDirFor(projectDir), SNAPSHOT_STAGING_MARKER);
}

// ── Safe restore (#13) ────────────────────────────────────────────────────────

/** Inputs for {@link restoreVersionWithBackup}. */
export interface RestoreVersionOptions {
  projectDir: string;
  /** Snapshot id (commit SHA) to restore the working tree to. */
  id: string;
  /** Identity recorded on the automatic pre-restore safety snapshot. */
  authorName?: string;
  authorEmail?: string;
}

/** Result of {@link restoreVersionWithBackup}. */
export interface RestoreVersionResult {
  /** The snapshot id the working tree was restored to. */
  restoredId: string;
  /**
   * Id of the automatic safety snapshot taken of the pre-restore state, or
   * `undefined` when the working tree was already clean (its state is already
   * the latest snapshot, so no backup was needed).
   */
  backupId?: string;
}

/** Message recorded on the automatic pre-restore safety snapshot. */
export const RESTORE_BACKUP_MESSAGE =
  "Automatic backup before restoring an earlier version";

// ── Automatic snapshots (RC1-3) ───────────────────────────────────────────────

/**
 * Message recorded on every host-scheduled automatic snapshot. The desktop's
 * history UI groups consecutive entries carrying EXACTLY this message, so the
 * string is a contract — change it only with a matching UI update.
 */
export const AUTO_SNAPSHOT_MESSAGE = "Automatic snapshot";

// Host-timer cadence policy (auto-snapshot / auto-sync delays, isGitInternalPath)
// lives in `host-policy.ts` — a cohesive, Git-free policy module the CLI and
// desktop both consume. This file owns SourceProvider operations only.

/**
 * Restore the working tree to a prior snapshot SAFELY (#13): if the current
 * state has unsaved-to-history changes, an automatic safety snapshot is
 * committed FIRST, so a restore can never lose work — the pre-restore state
 * stays reachable through the same View History UI. This is the operation the
 * desktop's "Restore Version" action calls; the raw `provider.restore()` is the
 * low-level primitive.
 *
 * Pure isomorphic-git via the provider layer (CLAUDE.md §7). Throws when the
 * folder has no version history.
 */
export async function restoreVersionWithBackup(
  options: RestoreVersionOptions,
): Promise<RestoreVersionResult> {
  const { projectDir, id, authorName, authorEmail } = options;
  const source = await detectProjectSource(projectDir);
  if (source.type !== "local-git-folder") {
    throw new Error(
      "This project has no version history yet. Enable version history first.",
    );
  }
  const provider = new LocalGitSourceProvider(source);
  const repoDir = gitScopeFor(source);
  // One lock span for the whole backup+restore sequence so nothing can slip
  // in between the safety snapshot and the restore (uses the providers'
  // *Unlocked internals — taking the per-method lock here would deadlock).
  // Lock + pending-check key on the repo root (whole tree).
  return withRepoLock(repoDir, async () => {
    let backupId: string | undefined;
    if (await hasPendingChanges(repoDir)) {
      const backup = await provider.snapshotUnlocked({
        projectDir,
        message: RESTORE_BACKUP_MESSAGE,
        authorName,
        authorEmail,
      });
      backupId = backup.id;
    }
    try {
      await provider.restoreUnlocked({ projectDir, id });
    } catch (cause) {
      // The restore itself failed AFTER any safety snapshot was committed.
      // Tell the author their work is safe — the backup is already in their
      // version history — and keep the underlying failure on `cause`.
      throw new Error(
        backupId
          ? "The restore could not be completed, but your work is safe — it was " +
            `automatically saved as a backup snapshot (${backupId.slice(0, 7)}) ` +
            "and appears in your version history."
          : "The restore could not be completed. Your project files were not changed.",
        { cause },
      );
    }
    return { restoredId: id, backupId };
  });
}
