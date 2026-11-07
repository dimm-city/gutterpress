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
// Atomic writes for git metadata — see git-fs.ts. Drop-in for node:fs.
import { gitFs as fs } from "./git-fs.ts";
import path from "node:path";

import git, { type ReadCommitResult } from "isomorphic-git";

import type { ProjectCapabilities, ProjectSource } from "./project-source.ts";
import {
  capabilitiesFor,
  detectProjectSource,
  findEnclosingRepoDir,
  syncRemoteFor,
} from "./project-source.ts";
import { createFileLogger } from "./remote-auth/operation-log.ts";
import { EXTENSIONS_DIR, LEGACY_PLUGINS_DIR, VENDORED_NPM_DIR } from "./plugin-vendor.ts";

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
  /** Opaque version id (a commit SHA for the local-git provider). */
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

/** What every version operation says about a plain folder. */
export const NO_VERSION_HISTORY =
  "This book isn't keeping version history yet. Turn on version history first.";

const DEFAULT_AUTHOR = "gutterpress";
const DEFAULT_EMAIL = "noreply@gutterpress.local";
const DEFAULT_BRANCH = "main";
const SNAPSHOT_STAGING_MARKER = "gutterpress-snapshot-staging";

// ── Per-repo operation queue ─────────────────────────────────────────────────
// WHY: isomorphic-git has NO repo locking — two concurrent operations against
// the same `.git` (e.g. an auto-snapshot racing a user-initiated restore)
// interleave index/ref writes and can corrupt the repository. Every public
// operation on a project dir is therefore serialized through a simple promise
// chain keyed on the resolved dir. this same queue for
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
 * the SAME queue as snapshot/restore — one per-repo lock.
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
  // it. Without this, `repoQueues` keeps one permanent entry per
  // distinct project dir ever opened for the life of a long-running host. The
  // identity guard is the usual promise-cache pattern: a concurrent
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
 * Resolve once NO git operation is queued or running on any repo — including
 * ones chained while waiting. The desktop host awaits this before quitting so
 * an exit snapshot, backup or merge finishes instead of being killed between
 * its object and ref writes. Never rejects.
 */
export async function whenGitIdle(): Promise<void> {
  while (repoQueues.size > 0) {
    await Promise.all(repoQueues.values());
    // Let the settle handlers above reclaim their entries before re-checking.
    await Promise.resolve();
  }
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
 * surface (#15) — callers outside a lock should prefer the
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
 * as dirty (the WORKDIR-vs-STAGE-only check silently drops it).
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
        "This folder is already inside a book that keeps version history, so " +
          "Gutterpress won't start a separate one here.",
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
    return Promise.reject(new Error(NO_VERSION_HISTORY));
  }

  listHistory(): Promise<SnapshotEntry[]> {
    return Promise.resolve([]);
  }

  listHistoryPage(): Promise<HistoryPage> {
    return Promise.resolve({ entries: [], hasMore: false });
  }

  restore(): Promise<void> {
    return Promise.reject(new Error(NO_VERSION_HISTORY));
  }
}

/**
 * A walk back through a repo's history in the order `git.log` lists it (the
 * newest commit time first), visiting each commit once (#472). `git.log` has
 * no visited set: after a merge it lists a commit again, with everything older,
 * and the repeats used up a page. Starting the next page's log at the last id
 * also dropped the side of a merge that id does not descend from. Shared with
 * the online-only versions (`commitsAhead`, #477), which walks two tips at once.
 */
export interface HistoryWalk {
  /** Commits read but not listed yet, sorted so the newest is last. */
  tips: ReadCommitResult[];
  /** Every commit ever put in `tips`. */
  queued: Set<string>;
  /** `.git/shallow`: commits whose parents a shallow clone does not have. */
  shallow: Set<string>;
  /** Commits read ahead (see {@link nextInHistory}), not queued yet. */
  readAhead: Map<string, ReadCommitResult>;
}

/**
 * The walk behind the last history page, so "Show older versions" carries
 * on where it stopped instead of walking from the newest version again. Only
 * the next page of the same history continues it; any other request starts a
 * fresh walk, which gives the same answer. It holds parsed commits only,
 * never an object cache (see {@link GitCache}).
 */
let lastHistoryWalk: { dir: string; head: string; last: string; walk: HistoryWalk } | null = null;

/** A walk back from `heads` (the history of each of them, together). */
export async function startHistoryWalk(
  dir: string,
  cache: GitCache,
  heads: string[],
): Promise<HistoryWalk> {
  const shallow = await fs.promises
    .readFile(path.join(gitDirFor(dir), "shallow"), "utf8")
    .catch(() => "");
  const tips = await Promise.all(heads.map((oid) => git.readCommit({ fs, dir, cache, oid })));
  tips.sort((a, b) => a.commit.committer.timestamp - b.commit.committer.timestamp);
  return {
    tips,
    queued: new Set(heads),
    shallow: new Set(shallow.split("\n")),
    readAhead: new Map(),
  };
}

/**
 * The walk's next commit, newest first; undefined once the history is done.
 * `needed` is how many more commits the page needs, to bound a read-ahead
 * (none for 1: a caller that cannot tell how far it will go reads one by one).
 */
export async function nextInHistory(
  dir: string,
  walk: HistoryWalk,
  cache: GitCache,
  needed: number,
): Promise<ReadCommitResult | undefined> {
  const commit = walk.tips.pop();
  if (!commit || walk.shallow.has(commit.oid)) return commit;
  for (const oid of commit.commit.parent) {
    if (walk.queued.has(oid)) continue;
    // Down to one line (a book with one author is one line throughout): read
    // the rest of the page with one git.log call. One readCommit per commit
    // stats the .git folder each time, which made a page about 1.5x as slow.
    const oneLine = walk.tips.length === 0 && commit.commit.parent.length === 1;
    if (needed > 1 && oneLine && !walk.readAhead.has(oid)) {
      for (const c of await git.log({ fs, dir, cache, ref: oid, depth: needed })) {
        if (!walk.queued.has(c.oid)) walk.readAhead.set(c.oid, c);
      }
    }
    walk.queued.add(oid);
    walk.tips.push(walk.readAhead.get(oid) ?? (await git.readCommit({ fs, dir, cache, oid })));
    walk.readAhead.delete(oid);
  }
  // The order git.log uses: a stable sort by commit time, newest taken first.
  walk.tips.sort((a, b) => a.commit.committer.timestamp - b.commit.committer.timestamp);
  return commit;
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
   * LOCK-FREE by design: reading commits is a pure read (HEAD resolved once,
   * then a walk over immutable commits), so it can never corrupt the repo
   * and doesn't need the per-repo write queue. Taking the lock here would
   * queue the History dialog behind a running auto-snapshot of a large
   * working tree — a multi-second stall for a read-only view.
   */
  async listHistoryPage(
    _projectDir: string,
    options: ListHistoryOptions = {},
  ): Promise<HistoryPage> {
    const dir = this.dir;
    const limit = Math.min(500, Math.max(1, options.limit ?? HISTORY_PAGE_LIMIT));
    const before = options.before;
    const cache: GitCache = {}; // per-call cache — never pin packfile buffers across calls
    try {
      // Whole-repo history (a project is its git repo), walked from HEAD.
      const head = await git.resolveRef({ fs, dir, ref: "HEAD" });
      let walk: HistoryWalk;
      const saved = lastHistoryWalk;
      if (before && saved?.dir === dir && saved.head === head && saved.last === before) {
        walk = saved.walk;
        lastHistoryWalk = null;
      } else {
        walk = await startHistoryWalk(dir, cache, [head]);
        if (before) {
          // No saved walk to carry on (asked out of turn, or HEAD moved): walk
          // to the cursor. A garbage/expired one must not crash the view.
          let c: ReadCommitResult | undefined;
          do {
            c = await nextInHistory(dir, walk, cache, limit);
          } while (c && c.oid !== before);
          if (!c) return { entries: [], hasMore: false };
        }
      }
      const entries: SnapshotEntry[] = [];
      while (entries.length < limit) {
        const c = await nextInHistory(dir, walk, cache, limit - entries.length);
        if (!c) break;
        entries.push({
          id: c.oid,
          message: c.commit.message.trim(),
          timestamp: c.commit.author.timestamp * 1000,
          author: c.commit.author.name,
        });
      }
      // Every commit still queued is one not shown yet: hasMore is exact.
      const hasMore = walk.tips.length > 0;
      lastHistoryWalk = hasMore ? { dir, head, last: entries.at(-1)!.id, walk } : null;
      return { entries, hasMore };
    } catch (e) {
      // A cursor whose commit is gone must not crash the history view.
      if (before && (e as { code?: string })?.code === "NotFoundError") {
        return { entries: [], hasMore: false };
      }
      throw e;
    }
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
 * Exported for the sync surface (#15): `syncProject` holds
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
  // Never save a half-switched tree as a version: put it right first.
  await repairInterruptedSwitchUnlocked(dir);
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
      "Nothing new to save — your last version already has everything.",
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
  // A newer saved version may free old repair copies (#508).
  await pruneRepairCopiesUnlocked(dir).catch(() => undefined);
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
  return e instanceof Error && /nothing new to save/i.test(e.message);
}

/** What "Save a version" would capture in the open book right now. */
export interface UnversionedChanges {
  /**
   * Files of THIS book (its folder inside the repo) that changed since the
   * last version — writer work only: app-written files (the vendored plugin
   * folder) are not counted.
   */
  changedFiles: number;
  /**
   * A previous version attempt died after staging (its crash marker is still
   * present), so the index may hold work HEAD doesn't have even when the
   * working tree looks clean. The count can't be trusted to be 0 then.
   */
  stale: boolean;
}

/**
 * How many files of the open book changed since the last version (snapshot).
 * `null` when the project has no version history (a plain folder). Uses the
 * same workdir-vs-index walk a snapshot uses to decide "nothing new to save".
 * A book inside a larger repo (`subPath`) is counted on its own folder only.
 * Queued behind the repo lock so it never reads the index mid-snapshot;
 * otherwise a lock-free walk that reads no history.
 */
export async function countUnversionedChanges(
  projectDir: string,
): Promise<UnversionedChanges | null> {
  const source = await detectProjectSource(projectDir);
  if (source.type !== "local-git-folder") return null;
  const dir = gitScopeFor(source);
  const bookPrefix = source.subPath ? `${source.subPath.replace(/\/+$/, "")}/` : "";
  // The vendored npm trees (the current folder and the one older books used).
  const appWritten = [EXTENSIONS_DIR, LEGACY_PLUGINS_DIR].map((d) => `${bookPrefix}${d}/${VENDORED_NPM_DIR}/`);
  return withRepoLock(dir, async () => {
    // Opening a book lands here: a half-done switch is put right before it is counted.
    await repairInterruptedSwitchUnlocked(dir);
    const { adds, removes } = await listWorkdirChanges(dir);
    const mine = new Set(
      [...adds, ...removes].filter((f) => f.startsWith(bookPrefix) && !appWritten.some((p) => f.startsWith(p))),
    );
    return { changedFiles: mine.size, stale: fs.existsSync(snapshotStagingMarkerPath(dir)) };
  });
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
        "Managed GitHub books are not supported yet (#15/#16).",
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

// ── Interrupted switch journal ───────────────────────────────────────────────
//
// A revision switch (and a restore) rewrites the working tree in several steps
// that git cannot make atomic. The journal says one is under way; it lives in
// the git directory, is written by rename (never torn) after the safety
// version holds everything, and is removed only once the tree is settled. If
// it is still there at the next look, the app died mid-way, and
// {@link repairInterruptedSwitch} puts the book back to the saved version.
// Before it overwrites anything, the repair keeps a copy of the tree as it is
// then on a side ref (nothing written after the journal can be lost), and it
// deletes only what it can show the half-done move itself wrote.

const SWITCH_JOURNAL = "gutterpress-switch.json";
const SWITCH_NOTICE = "gutterpress-switch-notice.json";
/** Side refs holding a copy of the tree taken just before a repair overwrote it. */
export const BEFORE_REPAIR_REF_PREFIX = "refs/gutterpress/before-repair-";

interface SwitchJournal {
  kind: "switch" | "restore";
  /** The version the book was on (it holds everything: saved before the journal). */
  from: string;
  /** The revision the book was on, when it was on one. */
  fromBranch?: string;
  /** The version being moved to. */
  to: string;
  /** The revision being moved to (a switch only). */
  branch?: string;
  /** When the move began (ms). */
  startedAt?: number;
  /** Ref of the copy of the tree a repair kept for this switch (so a retry reuses it). */
  keptCopy?: string;
  /** Folders that held the target's new files before the move, so they are not the move's to remove. */
  preexistingDirs?: string[];
}

const switchJournalPath = (dir: string): string => path.join(gitDirFor(dir), SWITCH_JOURNAL);
const switchNoticePath = (dir: string): string => path.join(gitDirFor(dir), SWITCH_NOTICE);

function writeAtomically(file: string, text: string, durable = false): void {
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeSync(fd, text);
    if (durable) fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
  if (durable) {
    try {
      const d = fs.openSync(path.dirname(file), "r");
      fs.fsyncSync(d);
      fs.closeSync(d);
    } catch {
      // directories cannot be synced everywhere; the rename is atomic regardless
    }
  }
}

/** Files the target version has and the saved one does not. */
async function targetOnlyFiles(dir: string, from: string, to: string, cache: GitCache): Promise<string[]> {
  const found: string[] = [];
  await git
    .walk({
      fs,
      dir,
      cache,
      trees: [git.TREE({ ref: from }), git.TREE({ ref: to })],
      map: async (filepath, [a, b]) => {
        if (filepath === "." || a || !b) return;
        if ((await b.type()) === "blob") found.push(filepath);
      },
    })
    .catch(() => undefined); // target version unreadable: nothing to sweep
  return found;
}

const ancestorsOf = (file: string): string[] => {
  const out: string[] = [];
  for (let d = path.posix.dirname(file); d !== "." && d !== "/"; d = path.posix.dirname(d)) out.push(d);
  return out;
};

async function beginSwitchJournal(dir: string, journal: Pick<SwitchJournal, "kind" | "to" | "branch">): Promise<void> {
  const from = await git.resolveRef({ fs, dir, ref: "HEAD" }).catch(() => undefined);
  if (!from) return; // no version to go back to
  const fromBranch = (await git.currentBranch({ fs, dir }).catch(() => undefined)) || undefined;
  const preexisting = new Set<string>();
  for (const f of await targetOnlyFiles(dir, from, journal.to, {})) {
    for (const d of ancestorsOf(f)) if (fs.existsSync(path.join(dir, d))) preexisting.add(d);
  }
  const full: SwitchJournal = {
    ...journal,
    from,
    fromBranch,
    startedAt: Date.now(),
    preexistingDirs: [...preexisting],
  };
  writeAtomically(switchJournalPath(dir), JSON.stringify(full), true);
}

const endSwitchJournal = (dir: string): void => fs.rmSync(switchJournalPath(dir), { force: true });

/** Remove `file`'s parent folders while they are empty and were not there before the move. */
function pruneNewEmptyDirs(dir: string, file: string, keep: Set<string>): void {
  for (const d of ancestorsOf(file)) {
    if (keep.has(d)) return;
    try {
      fs.rmdirSync(path.join(dir, d)); // throws unless empty
    } catch {
      return;
    }
  }
}

/**
 * Keep a copy of the whole tree (tracked and untracked, not ignored) as a commit
 * on a side ref, so a forced rollback can never lose what was written after the
 * journal. Returns the ref, or `undefined` when the tree already equals `from`.
 */
async function keepTreeBeforeRepair(
  dir: string,
  from: string,
  to: string,
  fromBranch: string | undefined,
  cache: GitCache,
  prior?: string,
): Promise<string | undefined> {
  const ref = `${BEFORE_REPAIR_REF_PREFIX}${new Date().toISOString().replace(/[^0-9]/g, "")}`;
  const changes = await listWorkdirChanges(dir, cache);
  await stageChanges(dir, changes, cache);
  const author = await resolveGitAuthor(dir);
  const id = await git.commit({
    fs,
    dir,
    cache,
    ref,
    // `from` is the saved version; `to` lets a later restore tell the author's
    // files from the ones the half-done move wrote.
    parent: to === from ? [from] : [from, to],
    message: `Kept before repairing an interrupted switch${fromBranch ? `\n\nRevision: ${fromBranch}` : ""}`,
    author,
  });
  const [kept, saved] = await Promise.all([
    git.readCommit({ fs, dir, cache, oid: id }),
    git.readCommit({ fs, dir, cache, oid: from }),
  ]);
  if (kept.commit.tree === saved.commit.tree) {
    await git.deleteRef({ fs, dir, ref });
    return undefined;
  }
  // A retry of the same repair: the tree is what the earlier try already kept.
  if (prior) {
    const earlier = await git
      .resolveRef({ fs, dir, ref: prior })
      .then((oid) => git.readCommit({ fs, dir, cache, oid }))
      .catch(() => undefined);
    if (earlier && earlier.commit.tree === kept.commit.tree) {
      await git.deleteRef({ fs, dir, ref });
      return prior;
    }
  }
  // Staging was only to take the copy: put every staged path back to what the
  // saved version has, so the index never claims an edit is already saved (a
  // forced checkout does that too, but "keep files as they are" does not run one).
  for (const f of [...changes.adds, ...changes.removes]) {
    await git.resetIndex({ fs, dir, cache, filepath: f });
  }
  return ref;
}

/**
 * Finish an interrupted switch or restore (caller holds the repo lock): a
 * switch whose revision is already open is simply done; anything else is rolled
 * back, by forcing the saved version over the tree and removing the files and
 * folders the half-done move created. Returns the message for the author, or
 * `null` when nothing was pending. The message is also kept for
 * {@link takeSwitchRepairNotice}.
 */
export async function repairInterruptedSwitchUnlocked(dir: string): Promise<string | null> {
  if (!fs.existsSync(switchJournalPath(dir))) return null;
  let journal: SwitchJournal | undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(switchJournalPath(dir), "utf8"));
    if (typeof parsed?.from === "string" && typeof parsed?.to === "string") journal = parsed;
  } catch {
    // handled below
  }
  const cache: GitCache = {};
  const unreadable = !journal;
  if (!journal) {
    // Unreadable: the book was clean at HEAD when a move began, so HEAD is the
    // version to go back to. Nothing is deleted without knowing what the move wrote.
    const head = await git.resolveRef({ fs, dir, ref: "HEAD" });
    journal = {
      kind: "switch",
      from: head,
      to: head,
      fromBranch: (await git.currentBranch({ fs, dir }).catch(() => undefined)) || undefined,
    };
  }
  const what = journal.kind === "restore" ? "Restoring a version" : "Switching revisions";
  const open = await git.currentBranch({ fs, dir }).catch(() => undefined);
  let message: string;
  if (!unreadable && journal.kind === "switch" && journal.branch && open === journal.branch) {
    message = `Switching to "${journal.branch}" was interrupted after it had finished, so nothing needed fixing.`;
  } else {
    const kept = await keepTreeBeforeRepair(dir, journal.from, journal.to, journal.fromBranch, cache, journal.keptCopy);
    if (kept && !unreadable && kept !== journal.keptCopy) {
      // Written before the checkout, so a checkout that fails still leaves the journal naming its copy.
      journal.keptCopy = kept;
      writeAtomically(switchJournalPath(dir), JSON.stringify(journal), true);
    }
    await git.checkout({ fs, dir, cache, ref: journal.fromBranch ?? journal.from, force: true });
    const left: string[] = [];
    if (!unreadable) {
      const keep = new Set(journal.preexistingDirs ?? []);
      for (const f of await targetOnlyFiles(dir, journal.from, journal.to, cache)) {
        const abs = path.join(dir, f);
        let st: ReturnType<typeof fs.lstatSync> | undefined;
        try {
          st = fs.lstatSync(abs);
        } catch {
          // never written
        }
        if (st) {
          // Delete only what the half-done move wrote: the target's own bytes,
          // or a file touched since it began. Anything else is the author's.
          let mine = false;
          if (st.isFile()) {
            const sameBytes = await git
              .hashBlob({ object: fs.readFileSync(abs) })
              .then(async ({ oid }) => {
                const b = await git.readBlob({ fs, dir, cache, oid: journal!.to, filepath: f }).catch(() => undefined);
                return b?.oid === oid;
              });
            mine = sameBytes || st.mtimeMs >= (journal.startedAt ?? Infinity);
          }
          if (mine) fs.rmSync(abs, { force: true });
          else left.push(f);
        }
        pruneNewEmptyDirs(dir, f, keep);
      }
    }
    message =
      `${what} was interrupted (the app closed part-way), so the book was put back ` +
      `exactly as it was before${journal.fromBranch ? `, on "${journal.fromBranch}"` : ""}. ` +
      "Nothing you wrote before then was lost; do it again when you're ready.";
    if (unreadable) message += " The record of the interrupted change could not be read, so any leftover files from it were kept.";
    if (kept) {
      message +=
        " A copy of the files as they were before this repair was kept. Book setup → Revisions lists it, " +
        "where you can put back the files you changed or discard it.";
    }
    if (left.length) {
      message += ` These files were left alone because they may be yours: ${left.slice(0, 10).join(", ")}${left.length > 10 ? ` and ${left.length - 10} more` : ""}.`;
    }
  }
  writeAtomically(switchNoticePath(dir), JSON.stringify({ message }));
  endSwitchJournal(dir);
  return message;
}

/** Repair an interrupted switch or restore, queued behind the repo lock. */
export async function repairInterruptedSwitch(projectDir: string): Promise<string | null> {
  const source = await detectProjectSource(projectDir);
  if (source.type !== "local-git-folder") return null;
  const dir = gitScopeFor(source);
  if (!fs.existsSync(switchJournalPath(dir))) return null;
  return withRepoLock(dir, () => repairInterruptedSwitchUnlocked(dir));
}

/** The message left by a repair, once: read it, then clear it. */
export async function takeSwitchRepairNotice(projectDir: string): Promise<string | null> {
  const source = await detectProjectSource(projectDir);
  if (source.type !== "local-git-folder") return null;
  const file = switchNoticePath(gitScopeFor(source));
  try {
    const { message } = JSON.parse(fs.readFileSync(file, "utf8"));
    fs.rmSync(file, { force: true });
    return typeof message === "string" ? message : null;
  } catch {
    return null;
  }
}

/** A switch the app could not finish putting right, for the author to settle. */
export interface UnfinishedSwitch {
  /** Plain words: what is wrong and where to go. */
  message: string;
  /** Id of the copy of the files kept for this switch, when there is one. */
  copy?: string;
}

function readJournalFile(dir: string): SwitchJournal | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(switchJournalPath(dir), "utf8"));
    return typeof parsed?.from === "string" && typeof parsed?.to === "string" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The switch still unresolved in this book (its journal is there), or `null`.
 * A build of that tree would run on files from two revisions mixed together and
 * could still make a PDF that looks fine, so builds stop (#507).
 */
export async function unfinishedSwitchState(projectDir: string): Promise<UnfinishedSwitch | null> {
  const source = await detectProjectSource(projectDir);
  if (source.type !== "local-git-folder") return null;
  const dir = gitScopeFor(source);
  if (!fs.existsSync(switchJournalPath(dir))) return null;
  const kept = readJournalFile(dir)?.keptCopy;
  const copy =
    kept && kept.startsWith(BEFORE_REPAIR_REF_PREFIX) && (await git.resolveRef({ fs, dir, ref: kept }).catch(() => null))
      ? kept.slice(BEFORE_REPAIR_REF_PREFIX.length)
      : undefined;
  return {
    message:
      "This book is part-way through switching revisions, so its files may be a mix of two revisions and " +
      "it can't be built or saved yet. In Gutterpress, Book setup → Revisions says how to put it right.",
    ...(copy ? { copy } : {}),
  };
}

/**
 * What a build refuses with while a switch is unresolved, or `null`. `cli` adds
 * the saved copy's ref for someone working from the command line; the app never
 * shows it.
 */
export async function unfinishedSwitchMessage(projectDir: string, options: { cli?: boolean } = {}): Promise<string | null> {
  const state = await unfinishedSwitchState(projectDir);
  if (!state) return null;
  return options.cli && state.copy
    ? `${state.message} Your files were kept as "${BEFORE_REPAIR_REF_PREFIX}${state.copy}" (git checkout ${BEFORE_REPAIR_REF_PREFIX}${state.copy} -- .).`
    : state.message;
}

/**
 * "Keep files as they are": the author accepts the book as the half-done move
 * left it. A copy is kept first (unless this switch already has one), then the
 * journal is cleared so the book can be built and saved again. A later save
 * records the files as they stand.
 */
export async function keepUnfinishedSwitchAsIs(projectDir: string): Promise<void> {
  const source = await detectProjectSource(projectDir);
  if (source.type !== "local-git-folder") return;
  const dir = gitScopeFor(source);
  await withRepoLock(dir, async () => {
    if (!fs.existsSync(switchJournalPath(dir))) return;
    const journal = readJournalFile(dir);
    const head = await git.resolveRef({ fs, dir, ref: "HEAD" });
    await keepTreeBeforeRepair(
      dir,
      journal?.from ?? head,
      journal?.to ?? head,
      journal?.fromBranch,
      {},
      journal?.keptCopy,
    );
    endSwitchJournal(dir);
  });
}

// ── Repair copies (#508) ─────────────────────────────────────────────────────
//
// Each repair that overwrites files first keeps them on refs/gutterpress/
// before-repair-<time>: a commit on the version the book was on (`from`) and,
// as a second parent, the revision being moved to. The files the author changed
// are the ones that differ from both; the rest is the half-done move. Copies
// live only in the book's git folder: a push names the revision it sends (never
// a wildcard), so they never go online, and the revision list reads refs/heads
// only. A copy is "saved" once those files are in the recent history of the open
// revision; only saved copies are ever pruned, and the author can restore files
// from one or discard it.

/** A kept copy of the files from just before a repair. */
export interface RepairCopy {
  /** The time stamp in the ref's name; what the restore and discard calls take. */
  id: string;
  /** When the copy was taken (ms). */
  savedAt: number;
  /** The files the author changed are all in the open revision's history already. */
  saved: boolean;
  /** The revision the book was on when the copy was taken. */
  revision?: string;
}

/** Most saved repair copies kept, and the age after which an older saved one may be dropped. */
export const REPAIR_COPY_KEEP = 5;
export const REPAIR_COPY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** How many recent versions of the open revision count as "in history". */
const REPAIR_COPY_HISTORY_DEPTH = 50;

/** Message recorded on the version made when files are put back from a copy. */
export const RESTORED_COPY_MESSAGE = "Restored files from a saved copy";

interface RepairCopyRef extends Omit<RepairCopy, "saved"> {
  ref: string;
  oid: string;
  parents: string[];
}

/** Repair copies, newest first. */
async function readRepairCopies(dir: string): Promise<RepairCopyRef[]> {
  const names = await git.listRefs({ fs, dir, filepath: "refs/gutterpress" }).catch(() => [] as string[]);
  const prefix = BEFORE_REPAIR_REF_PREFIX.slice("refs/gutterpress/".length);
  const found = await Promise.all(
    names
      .filter((n) => n.startsWith(prefix))
      .map(async (n): Promise<RepairCopyRef | null> => {
        const ref = `refs/gutterpress/${n}`;
        try {
          const oid = await git.resolveRef({ fs, dir, ref });
          const { commit } = await git.readCommit({ fs, dir, oid });
          const revision = /^Revision: (.+)$/m.exec(commit.message)?.[1];
          return {
            id: n.slice(prefix.length),
            ref,
            oid,
            parents: commit.parent,
            savedAt: commit.committer.timestamp * 1000,
            ...(revision ? { revision } : {}),
          };
        } catch {
          return null; // a ref whose commit is gone: nothing to show
        }
      }),
  );
  return found.filter((c): c is RepairCopyRef => c !== null).sort((a, b) => b.savedAt - a.savedAt);
}

/** The files in a copy that are the author's: not as the saved version had them and not as the move wrote them. */
async function changedInCopy(dir: string, copy: RepairCopyRef): Promise<Array<{ path: string; oid: string }>> {
  const from = copy.parents[0];
  if (!from) return [];
  const to = copy.parents[1] ?? from;
  const found: Array<{ path: string; oid: string }> = [];
  await git.walk({
    fs,
    dir,
    cache: {},
    trees: [git.TREE({ ref: copy.oid }), git.TREE({ ref: from }), git.TREE({ ref: to })],
    map: async (filepath, [c, f, t]) => {
      if (filepath === "." || !c || (await c.type()) !== "blob") return;
      const oid = await c.oid();
      if (oid === (await f?.oid()) || oid === (await t?.oid())) return;
      found.push({ path: filepath, oid });
    },
  });
  return found;
}

/** Every changed file is in a recent version of the open revision with exactly these bytes. */
async function filesAreInHistory(dir: string, files: Array<{ path: string; oid: string }>): Promise<boolean> {
  if (!files.length) return true;
  const log = await git.log({ fs, dir, depth: REPAIR_COPY_HISTORY_DEPTH }).catch(() => []);
  for (const f of files) {
    let found = false;
    for (const entry of log) {
      const blob = await git.readBlob({ fs, dir, oid: entry.oid, filepath: f.path }).catch(() => undefined);
      if (blob?.oid === f.oid) {
        found = true;
        break;
      }
    }
    if (!found) return false;
  }
  return true;
}

/**
 * Drop old repair copies (caller holds the repo lock). Only a copy whose files
 * are already in the history is ever dropped, and then only beyond the newest
 * few or past the age limit. One holding files saved nowhere else stays.
 */
export async function pruneRepairCopiesUnlocked(dir: string, now = Date.now()): Promise<void> {
  const copies = await readRepairCopies(dir);
  const saved: RepairCopyRef[] = [];
  for (const c of copies) if (await filesAreInHistory(dir, await changedInCopy(dir, c))) saved.push(c);
  for (const [i, c] of saved.entries()) {
    if (i >= REPAIR_COPY_KEEP || now - c.savedAt > REPAIR_COPY_MAX_AGE_MS) await git.deleteRef({ fs, dir, ref: c.ref });
  }
}

/** The book's repair copies, newest first (empty for a plain folder). A read: nothing is pruned here. */
export async function listRepairCopies(projectDir: string): Promise<RepairCopy[]> {
  const source = await detectProjectSource(projectDir);
  if (source.type !== "local-git-folder") return [];
  const dir = gitScopeFor(source);
  return Promise.all(
    (await readRepairCopies(dir)).map(async ({ id, savedAt, revision, ...c }) => ({
      id,
      savedAt,
      saved: await filesAreInHistory(dir, await changedInCopy(dir, { id, savedAt, revision, ...c })),
      ...(revision ? { revision } : {}),
    })),
  );
}

const REPAIR_COPY_ID = /^\d{8,20}$/;

async function repairCopyFor(projectDir: string, id: string) {
  const source = await detectProjectSource(projectDir);
  if (source.type !== "local-git-folder") throw new Error(NO_VERSION_HISTORY);
  const dir = gitScopeFor(source);
  const copy = REPAIR_COPY_ID.test(id) ? (await readRepairCopies(dir)).find((c) => c.id === id) : undefined;
  if (!copy) throw new Error("That saved copy is no longer there.");
  return { source, dir, copy };
}

/**
 * Put back the files the author changed that a repair kept (not the half-done
 * move's files), then save them as a version, so they are in the history and
 * the index agrees with the files. Work not yet saved is saved first. The
 * copy stays until it is discarded or pruned.
 */
export async function restoreRepairCopy(
  options: Omit<RestoreVersionOptions, "id"> & { id: string },
): Promise<RestoreVersionResult & { files: number }> {
  const { projectDir, authorName, authorEmail } = options;
  const { source, dir, copy } = await repairCopyFor(projectDir, options.id);
  const provider = new LocalGitSourceProvider(source);
  return withRepoLock(dir, async () => {
    await repairInterruptedSwitchUnlocked(dir).catch(() => undefined);
    if (fs.existsSync(switchJournalPath(dir))) {
      throw new Error(
        "This book is still part-way through switching revisions. Put that right first (Book setup → Revisions), then restore from the copy.",
      );
    }
    const files = await changedInCopy(dir, copy);
    if (!files.length) throw new Error("That copy holds no files you changed, so there is nothing to put back.");
    const save = async (message: string): Promise<string | undefined> => {
      try {
        return (await provider.snapshotUnlocked({ projectDir, message, authorName, authorEmail })).id;
      } catch (e) {
        if (isNoChangesError(e)) return undefined;
        throw e;
      }
    };
    const backupId = (await hasPendingChanges(dir)) ? await save(RESTORE_BACKUP_MESSAGE) : undefined;
    for (const f of files) {
      const abs = path.join(dir, f.path);
      if (path.relative(dir, abs).startsWith("..")) continue;
      const { blob } = await git.readBlob({ fs, dir, oid: f.oid });
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, blob);
    }
    const restoredId = (await save(RESTORED_COPY_MESSAGE)) ?? (await git.resolveRef({ fs, dir, ref: "HEAD" }));
    return { restoredId, backupId, files: files.length };
  });
}

/**
 * Delete a repair copy. One whose files are saved nowhere else is refused
 * unless `unsaved` says the author chose to lose them.
 */
export async function discardRepairCopy(projectDir: string, id: string, options: { unsaved?: boolean } = {}): Promise<void> {
  const { dir, copy } = await repairCopyFor(projectDir, id);
  await withRepoLock(dir, async () => {
    if (!options.unsaved && !(await filesAreInHistory(dir, await changedInCopy(dir, copy)))) {
      throw new Error(
        "That copy holds files that aren't saved anywhere else. Put them back first, or choose to discard them anyway.",
      );
    }
    await git.deleteRef({ fs, dir, ref: copy.ref });
  });
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
export const RESTORE_BACKUP_MESSAGE = "Automatic version before restoring";

// ── Automatic snapshots (RC1-3) ───────────────────────────────────────────────

/**
 * Message recorded on every host-scheduled automatic snapshot. The desktop's
 * history UI groups consecutive entries carrying EXACTLY this message, so the
 * string is a contract — change it only with a matching UI update.
 */
export const AUTO_SNAPSHOT_MESSAGE = "Automatic version";

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
  if (source.type !== "local-git-folder") throw new Error(NO_VERSION_HISTORY);
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
      await beginSwitchJournal(repoDir, { kind: "restore", to: id });
      await provider.restoreUnlocked({ projectDir, id });
      endSwitchJournal(repoDir);
    } catch (cause) {
      await repairInterruptedSwitchUnlocked(repoDir).catch(() => undefined);
      // The restore itself failed AFTER any safety snapshot was committed.
      // Tell the author their work is safe — the backup is already in their
      // version history — and keep the underlying failure on `cause`.
      throw new Error(
        backupId
          ? "Going back to that version didn't finish, but your work is safe — it was " +
            "saved as an automatic version and appears in your version history."
          : "Going back to that version didn't finish. Your book files were not changed.",
        { cause },
      );
    }
    return { restoredId: id, backupId };
  });
}

// ── Revisions (#273, #448) ───────────────────────────────────────────────────
//
// A book can hold several revisions of itself (git branches): separate lines of
// work such as "Second edition". Book setup → Online copy lists them, says where
// each is kept, and starts, switches, renames and deletes them. A revision counts
// whether or not it exists on this computer yet: one that so far lives only in
// the online copy is switched to by creating the local branch from it, which is
// what `git checkout <name>` does for a remote-tracking branch.
//
// The author-facing word is "revision"; "branch" stays in this module and the
// route names only. Renaming and deleting live in remote-auth/revisions.ts: they
// change the online copy too, so they need its transport.

/**
 * One revision (git branch) of a book, as the author sees it (#448): where it
 * is kept, and whether this computer has versions the online copy lacks.
 */
export interface Revision {
  name: string;
  /** The revision open on this computer. */
  current: boolean;
  /** On this computer and in the online copy; only on this computer; only in the online copy. */
  where: "online" | "this-computer" | "online-only";
  /** `where === "online"` and this computer has versions the online copy lacks (refs only, no network). */
  notBackedUp: boolean;
}

/** The book's revisions, sorted by name, and which one is open (`null` on a detached/unborn HEAD). */
export interface RevisionList {
  current: string | null;
  revisions: Revision[];
  /** Copies of the files kept just before a repair overwrote them (#508), newest first. */
  repairCopies: RepairCopy[];
}

/** Inputs for {@link switchBranch}. */
export interface SwitchBranchOptions {
  projectDir: string;
  /** Branch name to check out — local, or one that so far exists only on a remote. */
  branch: string;
  /** Identity recorded on the automatic pre-switch safety version, if one is taken. */
  authorName?: string;
  authorEmail?: string;
}

/** Result of a successful {@link switchBranch}. */
export interface SwitchBranchResult {
  /** The branch now checked out (equals `options.branch`). */
  current: string;
  /**
   * Absolute paths of every file the checkout added, removed, or changed the
   * content of (a diff of the old HEAD's tree against the new branch's tree,
   * computed before the checkout runs). The host uses this to drop crash-
   * recovery drafts for these paths — see recovery.ts's header: a draft taken
   * on the revision just left behind must never be offered over a DIFFERENT
   * revision's version of the same file.
   */
  changedFiles: string[];
}

/** Version message for the safety version {@link switchBranch} and {@link createRevision} save when the working tree has unsaved work. */
export const SWITCH_BRANCH_SNAPSHOT_MESSAGE = "Saved before switching revision";

/** Where each revision of a book is, read from refs only (no network, no history walk). */
export interface RevisionRefs {
  /** The revision HEAD points to, or `null` on a detached/unborn HEAD. */
  current: string | null;
  /** Revision name → tip, for `refs/heads/*`. */
  local: Map<string, string>;
  /** Revision name → the online copy's tip as this computer last saw it, for the sync remote's tracking refs. Empty without a remote. */
  online: Map<string, string>;
}

export async function readRevisionRefs(dir: string): Promise<RevisionRefs> {
  const [names, current, remote] = await Promise.all([
    git.listBranches({ fs, dir }),
    // An unborn/detached HEAD (no commits yet, or a mid-restore artifact) has
    // no current branch name — treat that as "unknown" rather than throwing.
    git.currentBranch({ fs, dir, fullname: false }).catch(() => undefined),
    syncRemoteFor(dir),
  ]);
  const tips = async (branches: string[], prefix: string) =>
    new Map(
      await Promise.all(
        branches.map(
          async (name) => [name, await git.resolveRef({ fs, dir, ref: `${prefix}${name}` })] as const,
        ),
      ),
    );
  // The remote's own HEAD pointer is a symref, not a revision.
  const onlineNames = remote
    ? (await git.listBranches({ fs, dir, remote: remote.remote }).catch(() => [] as string[])).filter(
        (name) => name !== "HEAD",
      )
    : [];
  return {
    current: current ?? null,
    local: await tips(names, "refs/heads/"),
    online: await tips(onlineNames, `refs/remotes/${remote?.remote}/`),
  };
}

/** Longest history walk a comparison between two tips makes before it gives up and answers "not provably". */
const ANCESTRY_DEPTH = 1000;

/**
 * True when every version of `tip` is also in `inTip` (it is `inTip`, or an
 * earlier version of it). Tips are compared first; the walk is bounded (see the
 * note in remote-auth/sync.ts on unbounded `isDescendent` walks), and a walk
 * that runs out or meets a missing object answers false.
 */
export async function isContained(
  dir: string,
  tip: string,
  inTip: string,
  cache: GitCache,
): Promise<boolean> {
  if (tip === inTip) return true;
  return git
    .isDescendent({ fs, dir, cache, oid: inTip, ancestor: tip, depth: ANCESTRY_DEPTH })
    .catch(() => false);
}

/**
 * The book's revisions and where each is kept, for a `local-git-folder`
 * project; `null` for any other source (nothing to switch between — the caller
 * hides the whole control rather than showing an error).
 *
 * Reads refs only: "online" is what this computer last heard from the online
 * copy (the refresh fetch keeps it current), so this never touches the network.
 */
export async function listRevisions(dir: string): Promise<RevisionList | null> {
  const source = await detectProjectSource(dir);
  if (source.type !== "local-git-folder") return null;
  const repoDir = gitScopeFor(source);
  const { current, local, online } = await readRevisionRefs(repoDir);
  const cache: GitCache = {};
  const names = [...new Set([...local.keys(), ...online.keys()])].sort((a, b) => a.localeCompare(b));
  const revisions = await Promise.all(
    names.map(async (name): Promise<Revision> => {
      const here = local.get(name);
      const there = online.get(name);
      return {
        name,
        current: name === current,
        where: here && there ? "online" : here ? "this-computer" : "online-only",
        notBackedUp: Boolean(here && there && !(await isContained(repoDir, here, there, cache))),
      };
    }),
  );
  return { current, revisions, repairCopies: await listRepairCopies(dir) };
}

/** A revision name as the author typed it, made usable: trimmed, spaces become hyphens. */
export function revisionNameFrom(input: string): string {
  return input.trim().replace(/\s+/g, "-");
}

// What git refuses in a branch name (check-ref-format), plus "/" so one name can
// never be a folder of another, and the characters Windows refuses in a file name.
const UNUSABLE_REVISION_NAME = /[\u0000- \u007f~^:?*[\\/<>"|]|\.\.|@\{|^[-.]|\.$|\.lock$|^@$/;
const REVISION_NAME_MAX = 100;

/**
 * Refuse, in plain words, a name a new revision can't have: empty, one git
 * refuses, or one already used on this computer or in the online copy (letters
 * compared without case, so two names never collide on a case-insensitive disk).
 * `name` is already through {@link revisionNameFrom}.
 */
export async function assertFreeRevisionName(repoDir: string, name: string): Promise<void> {
  if (!name) throw new Error("Give the revision a name.");
  if (name.length > REVISION_NAME_MAX || UNUSABLE_REVISION_NAME.test(name)) {
    throw new Error(
      `"${name}" can't be a revision name. Use plain words, numbers and dashes, up to ${REVISION_NAME_MAX} characters.`,
    );
  }
  const { local, online } = await readRevisionRefs(repoDir);
  const taken = (names: Iterable<string>) => [...names].find((n) => n.toLowerCase() === name.toLowerCase());
  const here = taken(local.keys());
  if (here) throw new Error(`There's already a revision called "${here}". Pick a different name.`);
  const there = taken(online.keys());
  if (there) {
    throw new Error(
      `"${there}" is already a revision in the online copy. Switch to it, or pick a different name.`,
    );
  }
}

/** Inputs for {@link createRevision}. */
export interface CreateRevisionOptions {
  projectDir: string;
  /** The name as typed; spaces become hyphens (see {@link revisionNameFrom}). */
  name: string;
  /** Identity recorded on the safety version, if one is taken. */
  authorName?: string;
  authorEmail?: string;
}

/**
 * Save a version of unsaved work, so nothing the author typed is lost (the
 * clean-tree rejection is expected and swallowed). Caller holds the repo lock.
 */
async function saveUnsavedWork(
  options: { projectDir: string; repoDir: string; authorName?: string; authorEmail?: string },
  cache: GitCache,
): Promise<void> {
  try {
    await snapshotWorkingTreeUnlocked({
      projectDir: options.projectDir,
      repoRoot: options.repoDir,
      message: SWITCH_BRANCH_SNAPSHOT_MESSAGE,
      authorName: options.authorName,
      authorEmail: options.authorEmail,
      cache,
    });
  } catch (e) {
    if (!isNoChangesError(e)) throw e;
  }
}

/**
 * Start a new revision from what the book is now, and open it. Unsaved work is
 * saved as a version first, so the new revision starts from it. The revision
 * goes online with the next backup, which sends the open revision.
 */
export async function createRevision(options: CreateRevisionOptions): Promise<{ current: string }> {
  const { projectDir, authorName, authorEmail } = options;
  const source = await detectProjectSource(projectDir);
  if (source.type !== "local-git-folder") throw new Error(NO_VERSION_HISTORY);
  const repoDir = gitScopeFor(source);
  const name = revisionNameFrom(options.name);
  return withRepoLock(repoDir, async () => {
    await assertFreeRevisionName(repoDir, name);
    await saveUnsavedWork({ projectDir, repoDir, authorName, authorEmail }, {});
    await git.branch({ fs, dir: repoDir, ref: name, checkout: true });
    return { current: name };
  });
}

/**
 * Resolve a revision name to the version it points at, and the remote it came
 * from when it has no local ref yet.
 *
 * `resolveRef`'s search path is `<ref>`, `refs/<ref>`, `refs/tags/<ref>`,
 * `refs/heads/<ref>`, `refs/remotes/<ref>`, `refs/remotes/<ref>/HEAD` — note
 * that it never reaches `refs/remotes/<remote>/<ref>`. A revision that has only
 * ever existed online therefore has to be looked up per-remote.
 */
async function resolveRevision(
  repoDir: string,
  branch: string,
): Promise<{ oid: string; remote?: string }> {
  const local = await git
    .resolveRef({ fs, dir: repoDir, ref: `refs/heads/${branch}` })
    .catch(() => undefined);
  if (local) return { oid: local };
  const remotes = await git.listRemotes({ fs, dir: repoDir }).catch(() => []);
  for (const { remote } of remotes) {
    const oid = await git
      .resolveRef({ fs, dir: repoDir, ref: `refs/remotes/${remote}/${branch}` })
      .catch(() => undefined);
    if (oid) return { oid, remote };
  }
  throw new Error(
    `Couldn't find a revision named "${branch}" — it may have been renamed or deleted.`,
  );
}

/**
 * True when isomorphic-git's checkout refused to overwrite a working-tree
 * file whose content moved after the pre-switch snapshot below. Same
 * predicate as remote-auth/converge-merge.ts's `isCheckoutConflict` —
 * duplicated rather than imported to avoid a source-provider ⇄ remote-auth
 * import cycle for a one-line `.code` check.
 */
function isCheckoutConflictError(e: unknown): boolean {
  return (e as { code?: string })?.code === "CheckoutConflictError";
}

/**
 * Repo-root-relative paths that differ (added, removed, or modified) between
 * two commits. Used by {@link switchBranch} to report which files the
 * checkout is about to move out from under any crash-recovery draft.
 * Deliberately TREE-vs-TREE only (immutable commits), unlike
 * {@link listWorkdirChanges}'s WORKDIR/STAGE walk.
 */
async function diffCommitPaths(
  dir: string,
  fromOid: string,
  toOid: string,
  cache: GitCache,
): Promise<string[]> {
  const changed: string[] = [];
  await git.walk({
    fs,
    dir,
    cache,
    trees: [git.TREE({ ref: fromOid }), git.TREE({ ref: toOid })],
    map: async (filepath, [from, to]) => {
      if (filepath === ".") return;
      const [fType, tType] = await Promise.all([
        from ? from.type() : Promise.resolve(undefined),
        to ? to.type() : Promise.resolve(undefined),
      ]);
      if (fType === "tree" || tType === "tree") return; // recurse
      if (!fType && !tType) return;
      if (!fType || !tType) {
        changed.push(filepath); // added on one side, absent on the other
        return;
      }
      const [fOid, tOid] = await Promise.all([from!.oid(), to!.oid()]);
      if (fOid !== tOid) changed.push(filepath);
    },
  });
  return changed;
}

/**
 * Switch the project's working tree to another revision (git branch).
 *
 * Safety, in order (see the issue's "what the switch has to take care of"):
 *  1. If the working tree has unsaved work, save a version of it first (so
 *     nothing the author typed is lost); the expected "nothing new" rejection
 *     is tolerated.
 *  2. Check out the target branch WITHOUT `force` — isomorphic-git then
 *     refuses (CheckoutConflictError) rather than silently overwriting a
 *     working-tree file that moved after the version above, which is
 *     reported as a friendly error instead of a forced checkout.
 *  3. Report every path the checkout touched so the host can drop stale
 *     crash-recovery drafts for them (see {@link SwitchBranchResult}).
 *
 * Pause/resume of the auto-snapshot/auto-sync host timers around the
 * checkout, and refreshing the open editor/file-tree/preview afterwards, are
 * host (desktop) responsibilities — this function only does the git work.
 */
export async function switchBranch(
  options: SwitchBranchOptions,
): Promise<SwitchBranchResult> {
  const { projectDir, branch, authorName, authorEmail } = options;
  const source = await detectProjectSource(projectDir);
  if (source.type !== "local-git-folder") throw new Error(NO_VERSION_HISTORY);
  const repoDir = gitScopeFor(source);
  return withRepoLock(repoDir, async () => {
    const cache: GitCache = {};
    await saveUnsavedWork({ projectDir, repoDir, authorName, authorEmail }, cache);
    const fromOid = await git
      .resolveRef({ fs, dir: repoDir, ref: "HEAD" })
      .catch(() => undefined);
    // A revision that exists only on a remote resolves through its remote ref;
    // checkout then creates the local branch and sets it to track the remote
    // one, which is isomorphic-git's documented behaviour for a ref with no
    // local branch. `remote` is passed explicitly so a remote that isn't
    // named "origin" works too — checkout would otherwise assume origin.
    const { oid: toOid, remote } = await resolveRevision(repoDir, branch);
    // Everything is saved above, so the tree is clean here: the journal lets a
    // crash from this point on be undone (repairInterruptedSwitch).
    await beginSwitchJournal(repoDir, { kind: "switch", to: toOid, branch });
    try {
      await git.checkout({
        fs,
        dir: repoDir,
        cache,
        ref: branch,
        force: false,
        ...(remote ? { remote } : {}),
      });
    } catch (e) {
      if (isCheckoutConflictError(e)) {
        // Refused before any file moved: nothing to undo, and a forced
        // rollback would overwrite the very file that changed.
        endSwitchJournal(repoDir);
        throw new Error(
          "Couldn't switch revisions — some files changed on disk right as the switch " +
            "started. Try again.",
          { cause: e },
        );
      }
      // Failed part-way (disk full, unreadable file...): put the book back.
      await repairInterruptedSwitchUnlocked(repoDir).catch(() => undefined);
      throw e;
    }
    endSwitchJournal(repoDir);
    const changedPaths =
      fromOid && fromOid !== toOid
        ? await diffCommitPaths(repoDir, fromOid, toOid, cache)
        : [];
    return {
      current: branch,
      changedFiles: changedPaths.map((p) => path.join(repoDir, p)),
    };
  });
}
