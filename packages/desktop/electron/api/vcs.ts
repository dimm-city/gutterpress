/**
 * Local version-history IPC handlers for the "vcs" capability (SFE-P5c2).
 * Ports `src/routes/api/vcs/{enable-version-history,save-snapshot,
 * restore-snapshot,list-snapshots-page}/+server.ts` verbatim (and, after
 * the 0.11.3 merge, upstream's `list-branches`/`switch-branch` routes for
 * #273's copy switching - see `vcsListBranches`/`vcsSwitchBranch`), including
 * `friendlyVcsError`'s security/UX error-filter classification (shared
 * module, `electron/server-bridge/friendly-errors.ts` — unchanged; only its
 * `{status, message}` result's STATUS is dropped here, since IPC has no
 * status concept and every real caller (`api.ts`'s `post()`, historically)
 * only ever read the message text — see `electron/api/validation.ts`'s
 * header for the same rationale applied to `fs:*`).
 *
 * SPECIAL WEIGHT (run note — the snapshot-before-restore safety guarantee):
 * `vcs:restoreSnapshot` delegates to the lib's `restoreVersionWithBackup`
 * (`packages/cli/src/lib/source-provider.ts`) exactly as the route did — a
 * restore first snapshots the CURRENT dirty working tree, so it can never
 * lose in-progress author work. That guarantee is implemented and
 * unit-tested inside `packages/cli` (out of this lane's write ownership;
 * see `source-provider.test.ts`'s `restoreVersionWithBackup` cases); this
 * handler's job is only to keep calling it with the same arguments the
 * route always did, so the guarantee's desktop entry point stays wired.
 * `vcs-ipc.test.ts` pins the ONE thing that lives on this side of the
 * boundary: a malformed/partial snapshot id is rejected BEFORE it can reach
 * the lib's checkout at all (same 40-hex-char guard the route used).
 */
import { basename } from "node:path";
import { friendlyVcsError } from "../server-bridge/friendly-errors";
import { getRecoveryHooks } from "../server-bridge/recovery-hooks";
import { getVcsHooks, type VcsHooks } from "../server-bridge/vcs-hooks";
import { gitIdentityArgs } from "./git-identity-args";
import { loadLib } from "./lib-loader";
import { requireProjectDir } from "./validation";
import type { SecureHandle } from "../server-bridge/secure-handle";

const SNAPSHOT_ID_RE = /^[0-9a-f]{40}$/i;

// Local type — do NOT import from contract.ts or the lib (keeps this module
// narrow to exactly what it calls, same as the deleted routes' local types).
interface LibModule {
  detectProjectSource: (dir: string) => Promise<unknown>;
  providerFor: (source: unknown) => {
    initVersionHistory: (opts: {
      projectDir: string;
      initialMessage?: string;
      authorName?: string;
      authorEmail?: string;
    }) => Promise<unknown>;
    snapshot: (opts: {
      projectDir: string;
      message: string;
      logFile?: string;
      authorName?: string;
      authorEmail?: string;
    }) => Promise<unknown>;
    listHistoryPage: (
      projectDir: string,
      opts: { limit?: number; before?: string },
    ) => Promise<unknown>;
  };
  capabilitiesFor: (source: unknown) => unknown;
  repoRootForSource: (source: unknown, fallbackDir: string) => string;
  restoreVersionWithBackup: (opts: {
    projectDir: string;
    id: string;
    authorName?: string;
    authorEmail?: string;
  }) => Promise<unknown>;
  listLocalBranches: (dir: string) => Promise<LocalBranches | null>;
  switchBranch: (opts: {
    projectDir: string;
    branch: string;
    authorName?: string;
    authorEmail?: string;
  }) => Promise<SwitchBranchResult>;
}

/** Mirrors the lib's `LocalBranches` (source-provider.ts) - the copies a project can switch between. */
interface LocalBranches {
  current: string | null;
  branches: string[];
  /** Subset of `branches` that has no local ref yet (created on switch). */
  remoteOnly: string[];
}

/** Mirrors the lib's `SwitchBranchResult`. */
interface SwitchBranchResult {
  current: string;
  changedFiles: string[];
}

/**
 * Turn a plain local-folder project into a versioned one (CLAUDE.md §7's
 * escape hatch). No SPA action calls this yet (ported as-is from the route,
 * which itself carried the same note) — retained ahead of the surfaced
 * Settings action.
 */
export async function vcsEnableVersionHistory(rawProjectDir: unknown): Promise<unknown> {
  const projectDir = await requireProjectDir(rawProjectDir, "vcs:enableVersionHistory");
  try {
    const lib = (await loadLib()) as unknown as LibModule;
    const source = await lib.detectProjectSource(projectDir);
    await lib.providerFor(source).initVersionHistory({
      projectDir,
      initialMessage: "Initial snapshot",
      ...(await gitIdentityArgs()),
    });
    // Re-classify so the renderer gets the upgraded source + capabilities.
    const upgraded = await lib.detectProjectSource(projectDir);
    return { source: upgraded, capabilities: lib.capabilitiesFor(upgraded) };
  } catch (e) {
    throw new Error(friendlyVcsError(e, "enableVersionHistory", "vcs/enable-version-history").message);
  }
}

/**
 * Save a snapshot of the project's current working tree. The log identifies
 * the REPO, not the opened book: a snapshot commits the whole repository,
 * so a monorepo's books share one log file.
 */
export async function vcsSaveSnapshot(rawProjectDir: unknown, rawMessage?: unknown): Promise<unknown> {
  // Hooks-availability is checked BEFORE validation, matching the deleted
  // route's `defineRoute({ hooks, validate, call })` order exactly.
  const hooks = getVcsHooks<LibModule>() as VcsHooks<LibModule> | null;
  if (!hooks) throw new Error("VCS hooks not registered");
  const projectDir = await requireProjectDir(rawProjectDir, "vcs:saveSnapshot");
  const message =
    typeof rawMessage === "string" && rawMessage.trim() ? rawMessage.trim() : "Saved snapshot";
  try {
    const lib = await hooks.loadLib();
    const source = await lib.detectProjectSource(projectDir);
    const repoRoot = lib.repoRootForSource(source, projectDir);
    return await lib.providerFor(source).snapshot({
      projectDir,
      message,
      ...(await gitIdentityArgs()),
      logFile: hooks.operationLogPath(basename(repoRoot)),
    });
  } catch (e) {
    throw new Error(friendlyVcsError(e, "saveSnapshot", "vcs/save-snapshot").message);
  }
}

/**
 * Restore the project to a prior snapshot. Safety contract (#13 / ADR 0006
 * §D5): the lib snapshots the CURRENT state before restoring, so a restore
 * can never lose the author's in-progress work.
 */
export async function vcsRestoreSnapshot(rawProjectDir: unknown, rawId: unknown): Promise<unknown> {
  const projectDir = await requireProjectDir(rawProjectDir, "vcs:restoreSnapshot");
  // Snapshot ids are full commit SHAs — reject anything else before it
  // reaches the lib (a partial/garbage ref must never hit checkout).
  if (typeof rawId !== "string" || !SNAPSHOT_ID_RE.test(rawId)) {
    throw new Error("vcs:restoreSnapshot requires a valid snapshot id");
  }
  try {
    const lib = (await loadLib()) as unknown as LibModule;
    return await lib.restoreVersionWithBackup({
      projectDir,
      id: rawId,
      ...(await gitIdentityArgs()),
    });
  } catch (e) {
    throw new Error(friendlyVcsError(e, "restoreSnapshot", "vcs/restore-snapshot").message);
  }
}

/** Page through the project's snapshot history, newest first. */
export async function vcsListSnapshotsPage(
  rawProjectDir: unknown,
  rawLimit?: unknown,
  rawBefore?: unknown,
): Promise<unknown> {
  const projectDir = await requireProjectDir(rawProjectDir, "vcs:listSnapshotsPage");
  // Validate the continuation cursor before it reaches the lib (it is used
  // as a git ref); a malformed cursor must never become a ref query.
  if (rawBefore !== undefined && (typeof rawBefore !== "string" || !SNAPSHOT_ID_RE.test(rawBefore))) {
    throw new Error("vcs:listSnapshotsPage requires a valid snapshot id cursor");
  }
  try {
    const lib = (await loadLib()) as unknown as LibModule;
    const source = await lib.detectProjectSource(projectDir);
    return await lib.providerFor(source).listHistoryPage(projectDir, {
      ...(typeof rawLimit === "number" ? { limit: rawLimit } : {}),
      ...(typeof rawBefore === "string" ? { before: rawBefore } : {}),
    });
  } catch (e) {
    throw new Error(friendlyVcsError(e, "listSnapshotsPage", "vcs/list-snapshots-page").message);
  }
}

/**
 * The project's local copies (git branches) and which one is open, for
 * Settings -> Saving's copy picker (#273). `null` means the source has nothing
 * to switch between (not a `local-git-folder`) - the Saving row hides on
 * that, so it passes straight through rather than becoming an error.
 */
export async function vcsListBranches(rawProjectDir: unknown): Promise<LocalBranches | null> {
  const hooks = getVcsHooks<LibModule>() as VcsHooks<LibModule> | null;
  if (!hooks) throw new Error("VCS hooks not registered");
  const projectDir = await requireProjectDir(rawProjectDir, "vcs:listBranches");
  try {
    const lib = await hooks.loadLib();
    return await lib.listLocalBranches(projectDir);
  } catch (e) {
    throw new Error(friendlyVcsError(e, "listLocalBranches", "vcs/list-branches").message);
  }
}

/**
 * Switch the project's working tree to another local copy (#273). The lib
 * takes a version of any in-progress edit first, so nothing is lost.
 *
 * The auto-snapshot/auto-sync host timers are paused around the checkout
 * (see `VcsHooks.pauseTimers`) so neither fires against the mid-switch
 * working tree or the wrong branch, and always resumed, success or failure.
 * Crash-recovery drafts are keyed by absolute file path, not by copy - the
 * entries for every file the checkout changed are dropped afterwards so a
 * draft taken on the copy just left behind can never be offered over the NEW
 * copy's version of the same file (recovery.ts's header documents the rule).
 * That clear is best-effort: a failure there never turns an already-
 * successful switch into a reported error.
 */
export async function vcsSwitchBranch(rawProjectDir: unknown, rawBranch: unknown): Promise<SwitchBranchResult> {
  const hooks = getVcsHooks<LibModule>() as VcsHooks<LibModule> | null;
  if (!hooks) throw new Error("VCS hooks not registered");
  const projectDir = await requireProjectDir(rawProjectDir, "vcs:switchBranch");
  if (typeof rawBranch !== "string" || !rawBranch.trim()) {
    throw new Error("vcs:switchBranch requires a branch name");
  }
  const branch = rawBranch.trim();
  let result: SwitchBranchResult;
  try {
    const lib = await hooks.loadLib();
    hooks.pauseTimers?.(projectDir);
    try {
      result = await lib.switchBranch({ projectDir, branch, ...(await gitIdentityArgs()) });
    } finally {
      hooks.resumeTimers?.(projectDir);
    }
  } catch (e) {
    throw new Error(friendlyVcsError(e, "switchBranch", "vcs/switch-branch").message);
  }
  const recovery = getRecoveryHooks();
  if (recovery) {
    await Promise.all(result.changedFiles.map((filePath) => recovery.clear(filePath).catch(() => {})));
  }
  return result;
}

/** Register the vcs:* IPC channels (SFE-P6b). */
export function registerVcsHandlers(secureHandle: SecureHandle): void {
  secureHandle("vcs:enableVersionHistory", (_e, projectDir: unknown) =>
    vcsEnableVersionHistory(projectDir),
  );
  secureHandle("vcs:listSnapshotsPage", (_e, projectDir: unknown, limit?: unknown, before?: unknown) =>
    vcsListSnapshotsPage(projectDir, limit, before),
  );
  secureHandle("vcs:restoreSnapshot", (_e, projectDir: unknown, id: unknown) =>
    vcsRestoreSnapshot(projectDir, id),
  );
  secureHandle("vcs:saveSnapshot", (_e, projectDir: unknown, message?: unknown) =>
    vcsSaveSnapshot(projectDir, message),
  );
  secureHandle("vcs:listBranches", (_e, projectDir: unknown) => vcsListBranches(projectDir));
  secureHandle("vcs:switchBranch", (_e, projectDir: unknown, branch: unknown) =>
    vcsSwitchBranch(projectDir, branch),
  );
}
