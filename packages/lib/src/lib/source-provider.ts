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
import { capabilitiesFor } from "./project-source.ts";

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
    // Already a git folder — initialising again is a no-op snapshot.
    await this.snapshot({
      projectDir: options.projectDir,
      message: options.initialMessage?.trim() || "Created project",
      authorName: options.authorName,
    }).catch(() => undefined);
    return this.source;
  }

  async snapshot(options: SnapshotOptions): Promise<SnapshotEntry> {
    const dir = options.projectDir;
    await stageAll(dir);
    const author = gitAuthor(options.authorName);
    const id = await git.commit({
      fs,
      dir,
      message: options.message,
      author,
    });
    return {
      id,
      message: options.message,
      timestamp: Date.now(),
      author: author.name,
    };
  }

  async listHistory(projectDir: string): Promise<SnapshotEntry[]> {
    const commits = await git.log({ fs, dir: projectDir });
    return commits.map((c) => ({
      id: c.oid,
      message: c.commit.message.trim(),
      timestamp: c.commit.author.timestamp * 1000,
      author: c.commit.author.name,
    }));
  }

  async restore(options: RestoreSnapshotOptions): Promise<void> {
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
