/**
 * Source / version-history provider (#12/#13/#25, governed by CLAUDE.md §7).
 *
 * `detectProjectSource` (`project-source.ts`) CLASSIFIES an opened folder. This
 * module is the OPERATIONS surface — init, snapshot, list history, restore —
 * that the new-project scaffold (#25) and the version-history UI (#13) drive.
 * It is the single abstraction both the CLI and the viewer call.
 *
 * NON-NEGOTIABLE (CLAUDE.md §7): every operation is backed by a **Node-native,
 * pure-JS** implementation (`isomorphic-git`) — NOT the system `git` binary,
 * NOT the GitHub CLI (`gh`), and with no expectation that the user has Git
 * installed (we do not bundle it). This keeps the `bun build --compile` CLI
 * binary and the packaged viewer fully self-contained.
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
  initialMessage?: string;
}

/** Inputs for taking a snapshot (commit) of the current working tree. */
export interface SnapshotOptions {
  projectDir: string;
  message: string;
  authorName?: string;
  /**
   * Root of the Git repository the commit goes to. Defaults to `projectDir`.
   * For a book subfolder of a larger repo this is the enclosing repo root.
   */
  repoRoot?: string;
  /**
   * When set (non-empty), the snapshot stages ONLY paths under this
   * repo-relative folder — changes elsewhere in the repository (other books)
   * stay out of this project's snapshots.
   */
  subPath?: string;
}

/**
 * Resolve the repo root + subfolder scope for a classified source. For a
 * repo-root project `dir === source.path` and `subPath` is "". Defensive:
 * older persisted sources without `repoRoot` fall back to the project path.
 */
export function gitScopeFor(
  source: Extract<ProjectSource, { type: "local-git-folder" }>,
): { dir: string; subPath: string } {
  return { dir: source.repoRoot || source.path, subPath: source.subPath || "" };
}

/** Inputs for restoring the working tree to a prior snapshot. */
export interface RestoreSnapshotOptions {
  projectDir: string;
  id: string;
}

/**
 * The version-control operations a project source can perform. Implementations
 * are selected by `ProjectSource.type` (see {@link providerFor}).
 */
export interface SourceProvider {
  readonly source: ProjectSource;
  readonly capabilities: ProjectCapabilities;
  initVersionHistory(options: InitVersionHistoryOptions): Promise<ProjectSource>;
  snapshot(options: SnapshotOptions): Promise<SnapshotEntry>;
  listHistory(projectDir: string): Promise<SnapshotEntry[]>;
  restore(options: RestoreSnapshotOptions): Promise<void>;
}

const DEFAULT_AUTHOR = "print-md";
const DEFAULT_EMAIL = "noreply@print-md.local";
const DEFAULT_BRANCH = "main";

// ── Per-repo operation queue ─────────────────────────────────────────────────
// WHY: isomorphic-git has NO repo locking — two concurrent operations against
// the same `.git` (e.g. an auto-snapshot racing a user-initiated restore)
// interleave index/ref writes and can corrupt the repository. Every public
// operation on a project dir is therefore serialized through a simple promise
// chain keyed on the resolved dir. ADR 0006 D2 requires this same queue for
// the future fetch/push surface (#15/#16), so keep it here, not in callers.
const repoQueues = new Map<string, Promise<unknown>>();

/**
 * Run `fn` exclusively per resolved project dir (FIFO promise chaining).
 * Exported for the remote-clone surface (#15) so clone/fetch operations share
 * the SAME queue as snapshot/restore — ADR 0006 D2 requires one per-repo lock.
 */
export function withRepoLock<T>(projectDir: string, fn: () => Promise<T>): Promise<T> {
  const key = path.resolve(projectDir);
  const prev = repoQueues.get(key) ?? Promise.resolve();
  // Chain regardless of the previous op's outcome; a failure must not jam the queue.
  const run = prev.then(fn, fn);
  // Park the chain tail, swallowing its rejection so the map never holds a
  // rejected promise that would surface as an unhandled rejection.
  repoQueues.set(
    key,
    run.catch(() => undefined),
  );
  return run;
}

/**
 * Resolve the commit author identity from an optional display name (exported
 * for the sync surface so merge commits carry the same identity as
 * snapshots).
 */
export function gitAuthor(name?: string): { name: string; email: string } {
  const n = (name ?? "").trim();
  return { name: n || DEFAULT_AUTHOR, email: DEFAULT_EMAIL };
}

/**
 * Stage every working-tree path (added/modified/removed) so the next commit
 * captures the full tree — or, when `subPath` is set, only the tree under
 * that repo-relative folder (book-subfolder scoping). Honours `.gitignore`.
 */
async function stageAll(dir: string, subPath?: string): Promise<void> {
  const status = await git.statusMatrix({
    fs,
    dir,
    ...(subPath ? { filepaths: [subPath] } : {}),
  });
  await Promise.all(
    status.map(([filepath, , worktreeStatus]) =>
      worktreeStatus === 0
        ? git.remove({ fs, dir, filepath })
        : git.add({ fs, dir, filepath }),
    ),
  );
}

/**
 * True when the working tree differs from HEAD (added/modified/deleted files).
 * Used to skip empty snapshots: committing with nothing changed would create an
 * empty commit that pollutes the author-facing history list.
 *
 * Exported (lock-free) for the sync surface (#15, ADR 0006 D5): sync
 * holds the repo lock for its whole sequence and needs the same "anything to
 * snapshot?" check the snapshot op uses. Callers outside a lock should prefer
 * the provider operations.
 *
 * NOTE: `statusMatrix`'s default `ignored: false` is REQUIRED behavior here —
 * gitignored files must stay invisible to version history (they are user
 * state, never snapshotted). Do not "optimize" this to `ignored: true`.
 */
export async function hasPendingChanges(
  dir: string,
  subPath?: string,
): Promise<boolean> {
  const status = await git.statusMatrix({
    fs,
    dir,
    ...(subPath ? { filepaths: [subPath] } : {}),
  });
  // Row shape: [filepath, headStatus, worktreeStatus, stageStatus].
  // Unchanged-and-tracked is [_, 1, 1, 1]; anything else is a pending change.
  return status.some(
    ([, head, worktree, stage]) => !(head === 1 && worktree === 1 && stage === 1),
  );
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
        "This folder is already inside a versioned project, so print-md " +
          "won't create a separate history here.",
      );
    }
    return withRepoLock(dir, async () => {
      await git.init({ fs, dir, defaultBranch: DEFAULT_BRANCH });
      await stageAll(dir);
      await git.commit({
        fs,
        dir,
        message: options.initialMessage?.trim() || "Created project",
        author: gitAuthor(options.authorName),
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
  /** Repo root + subfolder scope every git operation runs against. */
  private readonly scope: { dir: string; subPath: string };
  constructor(source: Extract<ProjectSource, { type: "local-git-folder" }>) {
    this.source = source;
    this.capabilities = capabilitiesFor(source);
    this.scope = gitScopeFor(source);
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
      });
    } catch (e) {
      if (!isNoChangesError(e)) throw e;
    }
    return this.source;
  }

  snapshot(options: SnapshotOptions): Promise<SnapshotEntry> {
    // Lock keys on the REPO ROOT, so two books in the same repo serialize.
    return withRepoLock(this.scope.dir, () => this.snapshotUnlocked(options));
  }

  /** Lock-free snapshot impl — callers must already hold the repo lock. */
  snapshotUnlocked(options: SnapshotOptions): Promise<SnapshotEntry> {
    return snapshotWorkingTreeUnlocked({
      ...options,
      repoRoot: this.scope.dir,
      ...(this.scope.subPath ? { subPath: this.scope.subPath } : {}),
    });
  }

  listHistory(_projectDir: string): Promise<SnapshotEntry[]> {
    const { dir, subPath } = this.scope;
    return withRepoLock(dir, async () => {
      // Subfolder projects list only commits that TOUCHED their folder.
      // isomorphic-git's `log({ filepath })` resolves the tree oid at the
      // path per commit and emits a commit whenever that oid changes — this
      // works for directories, walking each commit once. `force: true` keeps
      // the walk alive past commits where the folder doesn't exist yet
      // (instead of throwing NotFoundError).
      const commits = await git.log({
        fs,
        dir,
        ...(subPath ? { filepath: subPath, force: true } : {}),
      });
      return commits.map((c) => ({
        id: c.oid,
        message: c.commit.message.trim(),
        timestamp: c.commit.author.timestamp * 1000,
        author: c.commit.author.name,
      }));
    });
  }

  restore(options: RestoreSnapshotOptions): Promise<void> {
    return withRepoLock(this.scope.dir, () => this.restoreUnlocked(options));
  }

  /** Lock-free restore impl — callers must already hold the repo lock. */
  async restoreUnlocked(options: RestoreSnapshotOptions): Promise<void> {
    // Restore the working tree to the given commit, keeping HEAD on its branch
    // (a non-destructive "restore files to this point" — does not rewrite
    // history). `force` overwrites the working tree with the snapshot contents.
    // Subfolder projects restore ONLY their own paths — sibling books in the
    // same repository are never touched.
    const { dir, subPath } = this.scope;
    await git.checkout({
      fs,
      dir,
      ref: options.id,
      force: true,
      noUpdateHead: true,
      ...(subPath ? { filepaths: [subPath] } : {}),
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
  // The commit goes to the repo root; `subPath` (book subfolder of a larger
  // repo) limits what is considered/staged to the project's own folder.
  const dir = options.repoRoot ?? options.projectDir;
  const subPath = options.subPath || undefined;
  if (!(await hasPendingChanges(dir, subPath))) {
    throw new Error(
      "No changes since the last snapshot — there is nothing new to save.",
    );
  }
  await stageAll(dir, subPath);
  const author = gitAuthor(options.authorName);
  const id = await git.commit({
    fs,
    dir,
    message: options.message,
    author,
  });
  // Canonical timestamp comes from the committed object itself (matching
  // what listHistory reads back), not the wall clock at return time.
  const [head] = await git.log({ fs, dir, depth: 1 });
  return {
    id,
    message: options.message,
    timestamp: head ? head.commit.author.timestamp * 1000 : Date.now(),
    author: author.name,
  };
}

/**
 * True for the friendly "nothing new to save" rejection from `snapshot()`.
 * Exported (RC1-3) so the auto-snapshot scheduler in the viewer host can
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

// ── Safe restore (#13) ────────────────────────────────────────────────────────

/** Inputs for {@link restoreVersionWithBackup}. */
export interface RestoreVersionOptions {
  projectDir: string;
  /** Snapshot id (commit SHA) to restore the working tree to. */
  id: string;
  authorName?: string;
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
 * Message recorded on every host-scheduled automatic snapshot. The viewer's
 * history UI groups consecutive entries carrying EXACTLY this message, so the
 * string is a contract — change it only with a matching UI update.
 */
export const AUTO_SNAPSHOT_MESSAGE = "Automatic snapshot";

/** User-facing auto-snapshot policy (mirrors the viewer's settings group). */
export interface AutoSnapshotPolicy {
  /** Master switch — automatic snapshots default ON. */
  autoSnapshot: boolean;
  /** Minutes of quiet after the last edit before a snapshot fires. */
  autoSnapshotMinutes: number;
}

/** Cadence bounds: never below 5 minutes (commit-per-keystroke guard), never
 * above a day (a longer value means the user effectively wants it off). */
export const AUTO_SNAPSHOT_MIN_MINUTES = 5;
export const AUTO_SNAPSHOT_MAX_MINUTES = 24 * 60;
export const AUTO_SNAPSHOT_DEFAULT_MINUTES = 10;

/**
 * Resolve the debounce delay (ms) for the host's auto-snapshot timer, or
 * `null` when automatic snapshots are disabled. Pure — the testable core of
 * the trigger policy (the timer itself lives in the Electron main process).
 *
 * Defensive about persisted settings: a missing policy means "defaults"
 * (enabled, 10 min); a non-finite/absurd minutes value falls back to the
 * default and is then clamped into [5, 1440].
 */
export function autoSnapshotDelayMs(
  policy: Partial<AutoSnapshotPolicy> | undefined,
): number | null {
  const enabled = policy?.autoSnapshot ?? true;
  if (!enabled) return null;
  const raw = policy?.autoSnapshotMinutes;
  const minutes =
    typeof raw === "number" && Number.isFinite(raw) && raw > 0
      ? raw
      : AUTO_SNAPSHOT_DEFAULT_MINUTES;
  const clamped = Math.min(
    AUTO_SNAPSHOT_MAX_MINUTES,
    Math.max(AUTO_SNAPSHOT_MIN_MINUTES, minutes),
  );
  return clamped * 60_000;
}

/**
 * True when a changed path is internal Git state (any `.git` segment). The
 * host's project watcher and auto-snapshot triggers must IGNORE these: the
 * automatic snapshot itself writes under `.git`, and treating that as a
 * content change would re-trigger preview reloads / re-arm the timer forever.
 * Accepts absolute paths, relative paths, or bare basenames.
 */
export function isGitInternalPath(p: string): boolean {
  return p.split(/[\\/]+/).some((segment) => segment === ".git");
}

/**
 * Restore the working tree to a prior snapshot SAFELY (#13): if the current
 * state has unsaved-to-history changes, an automatic safety snapshot is
 * committed FIRST, so a restore can never lose work — the pre-restore state
 * stays reachable through the same View History UI. This is the operation the
 * viewer's "Restore Version" action calls; the raw `provider.restore()` is the
 * low-level primitive.
 *
 * Pure isomorphic-git via the provider layer (CLAUDE.md §7). Throws when the
 * folder has no version history.
 */
export async function restoreVersionWithBackup(
  options: RestoreVersionOptions,
): Promise<RestoreVersionResult> {
  const { projectDir, id, authorName } = options;
  const source = await detectProjectSource(projectDir);
  if (source.type !== "local-git-folder") {
    throw new Error(
      "This project has no version history yet. Enable version history first.",
    );
  }
  const provider = new LocalGitSourceProvider(source);
  const scope = gitScopeFor(source);
  // One lock span for the whole backup+restore sequence so nothing can slip
  // in between the safety snapshot and the restore (uses the providers'
  // *Unlocked internals — taking the per-method lock here would deadlock).
  // Lock + pending-check key on the repo root, scoped to the book's subPath.
  return withRepoLock(scope.dir, async () => {
    let backupId: string | undefined;
    if (await hasPendingChanges(scope.dir, scope.subPath || undefined)) {
      const backup = await provider.snapshotUnlocked({
        projectDir,
        message: RESTORE_BACKUP_MESSAGE,
        authorName,
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
