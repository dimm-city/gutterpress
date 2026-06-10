/**
 * Project source classification (#12).
 *
 * Classifies an opened folder as one of three `ProjectSource` variants so the
 * viewer (and, later, the CLI) can decide which actions to surface — open,
 * enable version history, snapshot, view history, publish — WITHOUT exposing
 * Git terminology to non-technical authors.
 *
 * Scope for 0.4.0: detection uses ONLY Node `fs/promises` and a small regex
 * scan of `.git/config` + `.git/HEAD`. There is deliberately:
 *   - NO shell-out to the system `git` binary (CLAUDE.md §7).
 *   - NO `isomorphic-git` dependency yet — that lands in #13 when actual
 *     commit/log/restore operations are needed. The `.git` directory layout is
 *     simple enough to read directly for classification.
 *   - NO `managed-github` detection — the type variant exists for #15/#16 but
 *     `detectProjectSource` only ever returns `local-folder` or
 *     `local-git-folder`.
 *
 * Capability mapping (`capabilitiesFor`) is the single source of truth the UI
 * reads to enable/disable actions, so new source types slot in without
 * reworking callers.
 */
import { stat, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * The classified source of an opened project.
 *
 * `managed-github` is defined for #15/#16 (OAuth-backed GitHub projects) but is
 * never produced by {@link detectProjectSource} in this release.
 */
export type ProjectSource =
  | {
      type: "local-folder";
      path: string;
      /**
       * Nearest ANCESTOR directory that contains a `.git` (the folder itself
       * has none). Present when the project folder lives INSIDE an existing
       * Git repository — enabling version history here would `git init` a
       * nested shadow repo that silently detaches the folder from the outer
       * repo's tracking, so `capabilitiesFor` suppresses
       * `canEnableVersionHistory` when this is set.
       */
      enclosingRepoDir?: string;
    }
  | {
      type: "local-git-folder";
      path: string;
      hasRemote: boolean;
      remoteUrl?: string;
      branch?: string;
    }
  | {
      type: "managed-github";
      installationId: string;
      owner: string;
      repo: string;
      branch: string;
      rootPath?: string;
    };

/**
 * What the UI may offer for a given source. Derived purely from the source
 * type; no I/O. Drives which user-facing buttons (Enable Version History,
 * Save Snapshot, View History, Publish) are shown.
 */
export interface ProjectCapabilities {
  canRead: boolean;
  canWriteLocal: boolean;
  canEnableVersionHistory: boolean;
  canSnapshot: boolean;
  canViewHistory: boolean;
  canRestoreSnapshot: boolean;
  canPublish: boolean;
  canSync: boolean;
  authManagedByApp: boolean;
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Extract the `origin` (or first) remote URL from `.git/config` text.
 *
 * Handles the standard ini-ish layout produced by `git remote add`:
 *
 *   [remote "origin"]
 *       url = https://github.com/owner/repo.git
 *
 * Works for HTTPS and SSH (`git@github.com:owner/repo.git`) URLs. Prefers a
 * remote literally named `origin`; falls back to the first remote with a URL.
 * Returns `undefined` if there is no remote (defensive — never throws).
 */
export function parseRemoteUrl(configText: string): string | undefined {
  // Split into `[section ...]` blocks, keeping the header with its body.
  const sectionRe = /\[remote\s+"([^"]+)"\]([^[]*)/g;
  let firstUrl: string | undefined;
  let originUrl: string | undefined;
  let match: RegExpExecArray | null;
  while ((match = sectionRe.exec(configText)) !== null) {
    const name = match[1];
    const body = match[2] ?? "";
    const urlMatch = /^\s*url\s*=\s*(.+?)\s*$/m.exec(body);
    if (!urlMatch) continue;
    const url = urlMatch[1];
    if (!url) continue;
    if (firstUrl === undefined) firstUrl = url;
    if (name === "origin") {
      originUrl = url;
      break;
    }
  }
  return originUrl ?? firstUrl;
}

/**
 * Extract the current branch from `.git/HEAD` text.
 *
 * Normal repos store `ref: refs/heads/<branch>`. A detached HEAD stores a raw
 * commit hash — return `undefined` in that case (no meaningful branch name).
 */
export function parseHeadBranch(headText: string): string | undefined {
  const match = /^ref:\s*refs\/heads\/(.+?)\s*$/m.exec(headText);
  return match ? match[1] : undefined;
}

/**
 * Walk PARENT directories of `folderPath` looking for a `.git` directory
 * (the folder's own `.git` is the `local-git-folder` case, not this).
 * Returns the nearest enclosing repo root, or `undefined` when none exists.
 *
 * Stops at the user's home directory (a repo above `~` is OS/system tooling,
 * not the author's project) and at the filesystem root. Pure `node:fs` stats —
 * no git involvement — so the walk costs one `stat` per ancestor.
 */
export async function findEnclosingRepoDir(
  folderPath: string,
): Promise<string | undefined> {
  const home = path.resolve(os.homedir());
  let dir = path.resolve(folderPath);
  // Hard cap as a defensive bound against pathological path layouts.
  for (let i = 0; i < 64; i++) {
    const parent = path.dirname(dir);
    if (parent === dir) return undefined; // filesystem root reached
    dir = parent;
    if (await isDirectory(path.join(dir, ".git"))) return dir;
    if (dir === home) return undefined; // never scan above the user's home
  }
  return undefined;
}

/**
 * Classify a folder by inspecting it for a `.git` directory and, if present,
 * reading `.git/config` (for a remote) and `.git/HEAD` (for the branch).
 *
 * Pure Node-fs logic; never throws — any read error degrades gracefully (a
 * `.git` dir that can't be parsed still classifies as `local-git-folder` with
 * `hasRemote: false`). Never returns `managed-github`.
 */
export async function detectProjectSource(
  folderPath: string,
): Promise<ProjectSource> {
  const gitDir = path.join(folderPath, ".git");
  if (!(await isDirectory(gitDir))) {
    // No `.git` of its own — but it may sit INSIDE an existing repo, in which
    // case offering "Enable Version History" would create a nested shadow
    // repo (SWEEP-2). Record the enclosing root so capabilities can suppress
    // the offer and the UI can explain why.
    const enclosingRepoDir = await findEnclosingRepoDir(folderPath);
    return {
      type: "local-folder",
      path: folderPath,
      ...(enclosingRepoDir !== undefined ? { enclosingRepoDir } : {}),
    };
  }

  let remoteUrl: string | undefined;
  try {
    const configText = await readFile(path.join(gitDir, "config"), "utf8");
    remoteUrl = parseRemoteUrl(configText);
  } catch {
    remoteUrl = undefined;
  }

  let branch: string | undefined;
  try {
    const headText = await readFile(path.join(gitDir, "HEAD"), "utf8");
    branch = parseHeadBranch(headText);
  } catch {
    branch = undefined;
  }

  return {
    type: "local-git-folder",
    path: folderPath,
    hasRemote: remoteUrl !== undefined,
    ...(remoteUrl !== undefined ? { remoteUrl } : {}),
    ...(branch !== undefined ? { branch } : {}),
  };
}

/**
 * Map a {@link ProjectSource} to the actions the UI may offer. Pure; no I/O.
 *
 * - `local-folder`: read/write only; version history can be ENABLED (a later
 *   `git init`, #13/#25) but no snapshot/history/restore until then; no publish.
 *   EXCEPTION (SWEEP-2): when the folder sits inside an existing Git repo
 *   (`enclosingRepoDir` set), enabling is suppressed — a nested `git init`
 *   would shadow the outer repo's tracking of these files.
 * - `local-git-folder`: version history already on, so snapshot/history/restore
 *   are available. Publish is offered only when a remote exists (the app can
 *   push via the user's externally-configured Git auth — #16).
 * - `managed-github`: full app-managed read/write/version/publish/sync.
 */
export function capabilitiesFor(source: ProjectSource): ProjectCapabilities {
  switch (source.type) {
    case "local-folder":
      return {
        canRead: true,
        canWriteLocal: true,
        canEnableVersionHistory: source.enclosingRepoDir === undefined,
        canSnapshot: false,
        canViewHistory: false,
        canRestoreSnapshot: false,
        canPublish: false,
        canSync: false,
        authManagedByApp: false,
      };
    case "local-git-folder":
      return {
        canRead: true,
        canWriteLocal: true,
        canEnableVersionHistory: false,
        canSnapshot: true,
        canViewHistory: true,
        canRestoreSnapshot: true,
        canPublish: source.hasRemote,
        canSync: source.hasRemote,
        authManagedByApp: false,
      };
    case "managed-github":
      return {
        canRead: true,
        canWriteLocal: true,
        canEnableVersionHistory: false,
        canSnapshot: true,
        canViewHistory: true,
        canRestoreSnapshot: true,
        canPublish: true,
        canSync: true,
        authManagedByApp: true,
      };
  }
}
