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
import { capabilitiesFor, detectProjectSource } from "./project-source.ts";

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

/** Run `fn` exclusively per resolved project dir (FIFO promise chaining). */
function withRepoLock<T>(projectDir: string, fn: () => Promise<T>): Promise<T> {
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

function gitAuthor(name?: string): { name: string; email: string } {
  const n = (name ?? "").trim();
  return { name: n || DEFAULT_AUTHOR, email: DEFAULT_EMAIL };
}

/**
 * Stage every working-tree path (added/modified/removed) so the next commit
 * captures the full tree. Honours `.gitignore`.
 */
async function stageAll(dir: string): Promise<void> {
  const status = await git.statusMatrix({ fs, dir });
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
 * NOTE: `statusMatrix`'s default `ignored: false` is REQUIRED behavior here —
 * gitignored files must stay invisible to version history (they are user
 * state, never snapshotted). Do not "optimize" this to `ignored: true`.
 */
async function hasPendingChanges(dir: string): Promise<boolean> {
  const status = await git.statusMatrix({ fs, dir });
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

  initVersionHistory(
    options: InitVersionHistoryOptions,
  ): Promise<ProjectSource> {
    const dir = options.projectDir;
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
  constructor(source: ProjectSource) {
    this.source = source;
    this.capabilities = capabilitiesFor(source);
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
    return withRepoLock(options.projectDir, () => this.snapshotUnlocked(options));
  }

  /** Lock-free snapshot impl — callers must already hold the repo lock. */
  async snapshotUnlocked(options: SnapshotOptions): Promise<SnapshotEntry> {
    const dir = options.projectDir;
    if (!(await hasPendingChanges(dir))) {
      throw new Error(
        "No changes since the last snapshot — there is nothing new to save.",
      );
    }
    await stageAll(dir);
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

  listHistory(projectDir: string): Promise<SnapshotEntry[]> {
    return withRepoLock(projectDir, async () => {
      const commits = await git.log({ fs, dir: projectDir });
      return commits.map((c) => ({
        id: c.oid,
        message: c.commit.message.trim(),
        timestamp: c.commit.author.timestamp * 1000,
        author: c.commit.author.name,
      }));
    });
  }

  restore(options: RestoreSnapshotOptions): Promise<void> {
    return withRepoLock(options.projectDir, () => this.restoreUnlocked(options));
  }

  /** Lock-free restore impl — callers must already hold the repo lock. */
  async restoreUnlocked(options: RestoreSnapshotOptions): Promise<void> {
    // Restore the working tree to the given commit, keeping HEAD on its branch
    // (a non-destructive "restore files to this point" — does not rewrite
    // history). `force` overwrites the working tree with the snapshot contents.
    await git.checkout({
      fs,
      dir: options.projectDir,
      ref: options.id,
      force: true,
      noUpdateHead: true,
    });
  }
}

/** True for the friendly "nothing new to save" rejection from `snapshot()`. */
function isNoChangesError(e: unknown): boolean {
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
  // One lock span for the whole backup+restore sequence so nothing can slip
  // in between the safety snapshot and the restore (uses the providers'
  // *Unlocked internals — taking the per-method lock here would deadlock).
  return withRepoLock(projectDir, async () => {
    let backupId: string | undefined;
    if (await hasPendingChanges(projectDir)) {
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
