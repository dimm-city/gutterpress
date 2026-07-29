/**
 * Project source classification (#12).
 *
 * Classifies an opened folder as one of three `ProjectSource` variants so the
 * desktop (and, later, the CLI) can decide which actions to surface — open,
 * enable version history, snapshot, view history, sync — WITHOUT exposing
 * Git terminology to non-technical authors.
 *
 * Detection notes:
 *   - NO shell-out to the system `git` binary (CLAUDE.md §7).
 *   - Remote/branch are read via isomorphic-git (`listRemotes`/`currentBranch`)
 *     — the SAME machinery the sync engine uses — so detection and transport
 *     can never disagree about "has a remote". (An earlier hand-rolled regex
 *     over `.git/config` diverged from the engine on case-variant sections,
 *     multi-value `url =` entries, gitfile layouts, and IPv6 URLs — each
 *     divergence surfaced as a repo the engine could sync that the UI called
 *     unsyncable, or vice versa.)
 *   - A `.git` FILE (a `gitdir:` pointer — `git worktree` checkouts and
 *     submodules) counts as a repo of its own; isomorphic-git resolves the
 *     indirection internally for all reads.
 *   - NO `managed-github` detection — the type variant exists for #15/#16 but
 *     `detectProjectSource` only ever returns `local-folder` or
 *     `local-git-folder`.
 *
 * Capability mapping (`capabilitiesFor`) is the single source of truth the UI
 * reads to enable/disable actions, so new source types slot in without
 * reworking callers.
 */
import * as fs from "node:fs";
import { stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import git from "isomorphic-git";

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
    }
  | {
      type: "local-git-folder";
      path: string;
      /**
       * Root of the Git repository that holds this project's history. For a
       * project that IS the repository root this equals `path`. For a book
       * folder that lives INSIDE a larger repository (a multi-book monorepo)
       * this is the enclosing repository root — the project USES that repo's
       * history, scoped to its own subfolder, rather than being told to move.
       */
      repoRoot: string;
      /**
       * Project directory relative to `repoRoot`, in canonical forward-slash
       * form (`"books/field-guide"`). Empty string when the project is the
       * repository root itself. Records WHERE the opened folder sits inside
       * the repo — it does not scope anything: history/snapshot/restore/sync
       * operate on the whole repo at `repoRoot` ("a project is its git repo"),
       * never on just this subfolder.
       */
      subPath: string;
      hasRemote: boolean;
      remoteUrl?: string;
      branch?: string;
    }
  | {
      type: "managed-github";
      owner: string;
      repo: string;
      branch: string;
      rootPath?: string;
    };

/**
 * What the UI may offer for a given source. Derived purely from the source
 * type; no I/O.
 *
 * NOTE (audit D5): today the desktop only reads `canSnapshot` (it gates the
 * StatusBar "Version history" affordance). The other flags —
 * `canEnableVersionHistory`, `canViewHistory`, `canRestoreSnapshot`, `canRead`,
 * `canWriteLocal`, `authManagedByApp` — are computed and part of the DTO but
 * not yet wired to UI gating; they are staging for the version-history feature
 * (#13). Don't assume a button is driven by one of these until you find its
 * reader.
 *
 * Deliberately NO `canSync` here: syncability is a credential-aware question
 * only `diagnoseProjectRemote().canSync` (remote-auth/diagnose.ts) can answer.
 * This interface used to carry a second, weaker `canSync` (= hasRemote, any
 * protocol, no credential check), and the two same-named-but-different gates
 * were a recurring source of contradictory sync behavior. Remote PRESENCE, for
 * display purposes, lives on the classification itself (`source.hasRemote`).
 */
export interface ProjectCapabilities {
  canRead: boolean;
  canWriteLocal: boolean;
  canEnableVersionHistory: boolean;
  canSnapshot: boolean;
  canViewHistory: boolean;
  canRestoreSnapshot: boolean;
  authManagedByApp: boolean;
}

/**
 * The remote a project syncs against: `origin` when one exists, else the first
 * remote. Pure pick over a `listRemotes` result — see {@link syncRemoteFor}
 * for the I/O helper detection and the sync transport share.
 */
export function pickSyncRemote<T extends { remote: string; url?: string }>(
  remotes: T[],
): T | undefined {
  return remotes.find((r) => r.remote === "origin") ?? remotes[0];
}

/**
 * THE one answer to "which remote does this repo sync against, and what's its
 * URL" — shared by detection (`detectProjectSource`) and the sync transport
 * (`resolveTransport`), so the two layers can never disagree about whether a
 * remote exists (each divergence shipped as a repo the engine could sync that
 * the UI called local-only, or vice versa).
 *
 * `listRemotes` scans `[remote "…"]` sections case-SENSITIVELY, but git itself
 * (and isomorphic-git's own fetch/push, via config `get`) treats section names
 * case-INSENSITIVELY — so a hand-edited `[Remote "origin"]` IS syncable by the
 * engine while being invisible to `listRemotes`. The `getConfig` fallback
 * covers exactly that: it uses the same case-insensitive, last-value-wins
 * lookup the engine's transport uses. Never throws.
 */
export async function syncRemoteFor(
  dir: string,
): Promise<{ remote: string; url: string } | undefined> {
  try {
    const remotes = await git.listRemotes({ fs, dir });
    const picked = pickSyncRemote(remotes);
    if (picked?.url) return picked;
  } catch {
    // fall through to the config lookup
  }
  try {
    const url = (await git.getConfig({ fs, dir, path: "remote.origin.url" })) as
      | string
      | undefined;
    if (url) return { remote: "origin", url };
  } catch {
    // no readable config → no remote
  }
  return undefined;
}

/**
 * What sits at `<dir>/.git`: a directory (standard repo), a file (a `gitdir:`
 * pointer — worktree/submodule checkout), or nothing.
 */
async function gitEntryKind(dir: string): Promise<"dir" | "file" | "none"> {
  try {
    const s = await stat(path.join(dir, ".git"));
    return s.isDirectory() ? "dir" : "file";
  } catch {
    return "none";
  }
}

/**
 * Walk PARENT directories of `folderPath` looking for a `.git` directory
 * (the folder's own `.git` is the `local-git-folder` case, not this).
 * Returns the nearest enclosing repo root, or `undefined` when none exists.
 *
 * Stops at the user's home directory — a repo AT or ABOVE `~` is OS/system
 * tooling (e.g. a dotfiles repo), not the author's project, and must never
 * become the `repoRoot` for a bare folder the author opens under home (that
 * would scope snapshot/restore/sync to the entire home directory). The home
 * check runs BEFORE the `.git` probe on each ancestor so home itself is never
 * treated as an enclosing repo, even if it happens to have a `.git` dir.
 * Pure `node:fs` stats — no git involvement — so the walk costs one `stat`
 * per ancestor.
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
    if (dir === home) return undefined; // never treat home as an enclosing repo
    if ((await gitEntryKind(dir)) !== "none") return dir;
  }
  return undefined;
}

/**
 * Read the sync remote's URL + current branch for the repo checked out at
 * `dir`, via isomorphic-git (which resolves `.git`-file indirection itself).
 * Never throws — any failure degrades to "no remote / no branch".
 */
async function readRepoInfo(dir: string): Promise<{
  remoteUrl?: string;
  branch?: string;
}> {
  const remoteUrl = (await syncRemoteFor(dir))?.url;

  let branch: string | undefined;
  try {
    branch = (await git.currentBranch({ fs, dir })) || undefined;
  } catch {
    branch = undefined;
  }
  return { remoteUrl, branch };
}

/** Project dir relative to the repo root, canonical forward-slash form. */
export function repoSubPath(repoRoot: string, folderPath: string): string {
  const rel = path.relative(path.resolve(repoRoot), path.resolve(folderPath));
  return rel.split(path.sep).join("/");
}

/**
 * Classify a folder by inspecting it for a `.git` directory and, if present,
 * reading `.git/config` (for a remote) and `.git/HEAD` (for the branch).
 *
 * A folder WITHOUT its own `.git` that sits inside an enclosing repository
 * (a book subfolder of a multi-book monorepo) classifies as
 * `local-git-folder` too: it USES the enclosing repo's history, scoped to
 * `subPath`. Only a folder with no repo anywhere above it is `local-folder`.
 *
 * Pure Node-fs logic; never throws — any read error degrades gracefully (a
 * `.git` dir that can't be parsed still classifies as `local-git-folder` with
 * `hasRemote: false`). Never returns `managed-github`.
 */
export async function detectProjectSource(
  folderPath: string,
): Promise<ProjectSource> {
  // A `.git` DIRECTORY is a standard checkout; a `.git` FILE is a `gitdir:`
  // pointer — a `git worktree` checkout or a submodule. Either way THIS folder
  // is the checkout the author works in, so it is its own repoRoot. (A
  // submodule must never resolve to the enclosing superproject: that pointed
  // snapshot/restore/sync at the WRONG repository — restore force-checked-out
  // the whole superproject tree.)
  if ((await gitEntryKind(folderPath)) !== "none") {
    const { remoteUrl, branch } = await readRepoInfo(folderPath);
    return {
      type: "local-git-folder",
      path: folderPath,
      repoRoot: folderPath,
      subPath: "",
      hasRemote: remoteUrl !== undefined,
      ...(remoteUrl !== undefined ? { remoteUrl } : {}),
      ...(branch !== undefined ? { branch } : {}),
    };
  }

  // No `.git` of its own — but it may sit INSIDE an existing repo (a book
  // subfolder of a larger monorepo). The project then shares the enclosing
  // repo's whole-repo history; `subPath` only records where it sits, it does
  // not scope any operation.
  const enclosingRepoDir = await findEnclosingRepoDir(folderPath);
  if (enclosingRepoDir !== undefined) {
    const { remoteUrl, branch } = await readRepoInfo(enclosingRepoDir);
    return {
      type: "local-git-folder",
      path: folderPath,
      repoRoot: enclosingRepoDir,
      subPath: repoSubPath(enclosingRepoDir, folderPath),
      hasRemote: remoteUrl !== undefined,
      ...(remoteUrl !== undefined ? { remoteUrl } : {}),
      ...(branch !== undefined ? { branch } : {}),
    };
  }

  return { type: "local-folder", path: folderPath };
}

/**
 * Map a {@link ProjectSource} to the actions the UI may offer. Pure; no I/O.
 *
 * - `local-folder`: read/write only; version history can be ENABLED (a later
 *   `git init`, #13/#25) but no snapshot/history/restore until then.
 * - `local-git-folder`: version history already on, so snapshot/history/restore
 *   are available — including book subfolders of a larger repo (`subPath`
 *   non-empty), which share the enclosing repo's whole-repo history (`subPath`
 *   is where the folder sits, not a scope).
 * - `managed-github`: full app-managed read/write/version history.
 *
 * Syncability is deliberately NOT answered here — see the interface doc
 * comment: `diagnoseProjectRemote().canSync` is the one sync gate.
 */
export function capabilitiesFor(source: ProjectSource): ProjectCapabilities {
  switch (source.type) {
    case "local-folder":
      return {
        canRead: true,
        canWriteLocal: true,
        canEnableVersionHistory: true,
        canSnapshot: false,
        canViewHistory: false,
        canRestoreSnapshot: false,
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
        authManagedByApp: true,
      };
  }
}
