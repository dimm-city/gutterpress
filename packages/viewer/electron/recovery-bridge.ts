/**
 * recovery-bridge.ts — Host-side helper for sync recovery.
 *
 * Keeps electron/main.ts diff small by extracting:
 *  1. The pending-confirm resolver map + ConfirmationGate bridge
 *  2. buildRecoveryContext() — resolves RecoveryContext from a projectDir
 *  3. classifyFromHealth() — synthetic SyncErrorKind from RepoHealth alone
 *     (used by the preflight path that has no thrown error to classify)
 *  4. getConflictPreviewImpl() — reads yours/theirs text for a conflicted file
 *
 * NEVER imported by the renderer. Node/lib-side only.
 *
 * NOTE: The lib module is declared as `declare module "@dimm-city/print-md-lib"`
 * (no .d.ts yet), so we CANNOT use the lib's TypeScript types here. All types
 * for the lib's surface are defined locally below, structurally compatible with
 * the runtime values the lib returns.
 */

import path from "node:path";
import fs from "node:fs";
import { readFile } from "node:fs/promises";
import type { BrowserWindow } from "electron";
import type { HostCredential } from "./credential-store";

// ── Local type mirrors for the lib recovery surface ───────────────────────────
// These mirror the lib's types but are defined locally because the lib has no
// .d.ts yet (types.d.ts declares `declare module "@dimm-city/print-md-lib"`).

export interface RepairConfirmation {
  repair: string;
  risk: "none" | "low" | "medium" | "high";
  summary: string;
  backupZipPath: string;
  willChangeLocalFiles: boolean;
  willChangeGitMetadata: boolean;
  willChangeRemote: boolean;
  canBeUndoneFromBackup: boolean;
}

export interface ConfirmationGate {
  confirmRepair(req: RepairConfirmation): Promise<boolean>;
}

export interface RepoHealth {
  hasGitDir: boolean;
  currentBranch?: string;
  isDetachedHead: boolean;
  hasStaleLock: boolean;
  lockAgeMs?: number;
  hasInterruptedMerge: boolean;
  hasInterruptedRebase: boolean;
  hasInterruptedCherryPick: boolean;
  hasLocalChanges: boolean;
}

export type SyncErrorKind =
  | "non_fast_forward"
  | "merge_conflict"
  | "binary_conflict"
  | "auth_required"
  | "network_unavailable"
  | "detached_head"
  | "stale_lock"
  | "corrupt_index"
  | "missing_git_dir"
  | "missing_or_corrupt_objects"
  | "unrelated_histories"
  | "wrong_remote_or_branch"
  | "unknown";

export interface RecoveryContext {
  projectDir: string;
  repoDir: string;
  branch: string;
  remoteUrl?: string;
  repoSlug: string;
  credential?: HostCredential;
  tokenStore?: TokenStore;
  authorName?: string;
  confirmation: ConfirmationGate;
}

export interface ConflictFile {
  path: string;
  kind: "both-edited" | "you-deleted" | "online-deleted";
}

export interface TokenStore {
  get(host: string): Promise<HostCredential | null>;
  /**
   * Clear a stored credential for a host. Required by recover-auth (it deletes
   * the rejected credential on an `auth` outcome) — without it in this contract,
   * wiring a get-only store would silently skip the credential clear.
   */
  delete(host: string): Promise<void>;
}

// ── Pending confirm resolver map ──────────────────────────────────────────────

interface PendingConfirm {
  projectDir: string;
  resolve: (approved: boolean) => void;
}

const pendingConfirms = new Map<string, PendingConfirm>();

let _mainWindow: BrowserWindow | null = null;

/** Register the main window so recovery-bridge can send IPC push events. */
export function setRecoveryBridgeWindow(win: BrowserWindow | null): void {
  _mainWindow = win;
}

/**
 * Handle the renderer's response to a recovery:confirm-request.
 * Called from `ipcMain.handle('recovery:confirm-response', ...)`.
 */
export function handleConfirmResponse(requestId: string, approved: boolean): boolean {
  const pending = pendingConfirms.get(requestId);
  if (!pending) return false;
  pending.resolve(approved);
  pendingConfirms.delete(requestId);
  return true;
}

/**
 * Resolve all pending confirm requests with `false` (e.g. when the window closes).
 * Called from the `window.on('closed', ...)` handler in main.ts.
 */
export function rejectAllPendingConfirms(): void {
  for (const { resolve } of pendingConfirms.values()) {
    resolve(false);
  }
  pendingConfirms.clear();
}

/**
 * Default timeout for a pending renderer confirmation (ms).
 * If the renderer never responds (crash, dialog bug, missing window 'closed'
 * event), resolve false so lib.recover() returns and inFlight is released.
 */
const CONFIRM_TIMEOUT_MS = 60_000; // 60 s

/**
 * Build a ConfirmationGate that bridges the lib's synchronous confirmation
 * interface to the Electron IPC round-trip. When the lib calls
 * `gate.confirmRepair(req)`, we:
 *   1. Generate a requestId
 *   2. Supersede any existing pending confirm for this projectDir
 *   3. Push 'recovery:confirm-request' to the renderer
 *   4. Return a Promise that resolves when the renderer calls
 *      ipcMain.handle('recovery:confirm-response', ...) OR after CONFIRM_TIMEOUT_MS
 *      (resolves false — the default-safe result).
 */
export function hostConfirmationGate(
  projectDir: string,
  timeoutMs = CONFIRM_TIMEOUT_MS,
): ConfirmationGate {
  return {
    confirmRepair(req: RepairConfirmation): Promise<boolean> {
      return new Promise<boolean>((resolve) => {
        // Supersede any stale pending confirm for this project
        for (const [id, pending] of pendingConfirms.entries()) {
          if (pending.projectDir === projectDir) {
            pending.resolve(false);
            pendingConfirms.delete(id);
          }
        }

        const requestId = `rcvr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        pendingConfirms.set(requestId, { projectDir, resolve });

        // Send to renderer
        _mainWindow?.webContents.send("recovery:confirm-request", {
          requestId,
          projectDir,
          confirmation: req,
        });

        // Safety timeout: if the renderer never answers (crash / dialog bug /
        // missing window-close event), default-safe to false and clear the
        // pending entry so inFlight is never permanently wedged.
        const timer = setTimeout(() => {
          if (pendingConfirms.has(requestId)) {
            console.warn(
              `[recovery-bridge] confirmRepair timed out after ${timeoutMs}ms for project ${projectDir} (requestId=${requestId}); defaulting to false`,
            );
            pendingConfirms.delete(requestId);
            resolve(false);
          }
        }, timeoutMs);
        // Allow the Node event loop to exit without waiting for the timer.
        if (typeof (timer as ReturnType<typeof setTimeout>).unref === "function") {
          (timer as ReturnType<typeof setTimeout> & { unref(): void }).unref();
        }
      });
    },
  };
}

// ── buildRecoveryContext ──────────────────────────────────────────────────────

interface LibForContext {
  // Canonical repo-root resolution — the SAME the sync path uses. Do NOT use
  // findEnclosingRepoDir here: it is ancestor-only (it skips the project's own
  // .git), so for a project that IS its own repo root it returns a parent repo
  // (e.g. ~/.git) — and the backup would then zip the entire HOME directory and
  // OOM. detectProjectSource returns the project's OWN repoRoot.
  detectProjectSource(dir: string): Promise<{ type: string; path?: string; repoRoot?: string }>;
  diagnoseProjectRemote(
    dir: string,
    opts?: { tokenStore?: { get(host: string): Promise<HostCredential | null> } },
  ): Promise<{ branch?: string; remoteUrl?: string }>;
}

/**
 * Build a RecoveryContext for a projectDir. Reuses the lib helpers and the
 * electronTokenStore that the orchestrator already calls for canSync checks.
 *
 * Never puts a credential on the returned context unless the host can resolve
 * one — credentials stay in the main process, never reach the renderer.
 *
 * @param authorName Optional display name to use for snapshot commits created
 *   by the recovery subsystem. Threads the same identity the sync orchestrator
 *   uses for syncProject so commit authorship is consistent.
 */
export async function buildRecoveryContext(
  projectDir: string,
  lib: LibForContext,
  tokenStore: TokenStore,
  authorName?: string,
): Promise<RecoveryContext> {
  // Resolve the project's OWN repo root (not an ancestor repo). This is what the
  // backup walks — getting it wrong (e.g. ~/.git) zips the whole home dir → OOM.
  let source: { type: string; path?: string; repoRoot?: string } | null = null;
  try {
    source = await lib.detectProjectSource(projectDir);
  } catch {
    source = null;
  }
  const repoDir =
    source && source.type === "local-git-folder"
      ? source.repoRoot ?? source.path ?? projectDir
      : projectDir;
  const diag = await lib.diagnoseProjectRemote(projectDir, { tokenStore }).catch(() => ({
    branch: undefined as string | undefined,
    remoteUrl: undefined as string | undefined,
  }));

  const branch = diag.branch ?? "main";
  const remoteUrl = diag.remoteUrl;

  // Resolve credential for the remote host (stays in main)
  let credential: HostCredential | undefined;
  if (remoteUrl) {
    try {
      const host = new URL(remoteUrl).hostname;
      credential = (await tokenStore.get(host)) ?? undefined;
    } catch {
      // Malformed URL or missing credential — proceed without
    }
  }

  // Repo slug from the last path segment (safe for backup naming)
  const repoSlug = path.basename(repoDir).replace(/[^a-zA-Z0-9_-]/g, "_") || "repo";

  return {
    projectDir,
    repoDir,
    branch,
    remoteUrl,
    repoSlug,
    credential,
    tokenStore,
    authorName,
    confirmation: hostConfirmationGate(projectDir),
  };
}

// ── classifyFromHealth ────────────────────────────────────────────────────────

const STALE_LOCK_THRESHOLD_MS = 30_000; // 30 s

/**
 * Classify a structural repo condition from a RepoHealth snapshot alone.
 * Used by the preflight path at project-open, where there is no thrown error
 * to classify — only the health facts.
 *
 * Returns null for a healthy repo (nothing to recover).
 */
export function classifyFromHealth(health: RepoHealth): SyncErrorKind | null {
  if (!health.hasGitDir) return "missing_git_dir";
  if (health.hasStaleLock && (health.lockAgeMs ?? 0) > STALE_LOCK_THRESHOLD_MS)
    return "stale_lock";
  if (health.hasInterruptedMerge) return "merge_conflict";
  if (health.hasInterruptedRebase) return "non_fast_forward";
  if (health.hasInterruptedCherryPick) return "merge_conflict";
  if (health.isDetachedHead) return "detached_head";
  return null;
}

// ── getConflictPreviewImpl ────────────────────────────────────────────────────

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg",
  ".pdf", ".zip", ".tar", ".gz", ".7z",
  ".ttf", ".otf", ".woff", ".woff2", ".eot",
  ".mp3", ".mp4", ".wav", ".ogg",
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
]);

const PREVIEW_SIZE_CAP = 256 * 1024; // 256 KB

export type ConflictKind = "both-edited" | "you-deleted" | "online-deleted";

export interface ConflictPreviewResult {
  mine: string;
  theirs: string;
  kind: ConflictKind;
  isBinary: boolean;
}

/**
 * Read the working-tree copy and the online-sidecar copy of a conflicted file.
 * Used by the `sync:getConflictPreview` IPC handler in main.ts.
 *
 * @param projectDir  Absolute path to the project directory
 * @param relativePath  Relative path within the project (no `..` allowed)
 * @param kind  The ConflictKind for this file
 * @param onlineCopyPath  The lib's onlineCopyPath() function
 */
export async function getConflictPreviewImpl(
  projectDir: string,
  relativePath: string,
  kind: ConflictKind,
  onlineCopyPath: (absPath: string) => string,
): Promise<ConflictPreviewResult> {
  // Safety: reject path traversal
  const resolvedProject = path.resolve(projectDir);
  const resolvedFile = path.resolve(projectDir, relativePath);
  if (
    !resolvedFile.startsWith(resolvedProject + path.sep) &&
    resolvedFile !== resolvedProject
  ) {
    throw new Error(`Path traversal rejected: ${relativePath}`);
  }

  // Binary detection by extension
  const ext = path.extname(relativePath).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) {
    return { mine: "", theirs: "", kind, isBinary: true };
  }

  // Read mine (working-tree)
  let mine = "";
  try {
    const buf = await readFile(resolvedFile);
    if (buf.length <= PREVIEW_SIZE_CAP) {
      mine = buf.toString("utf-8");
    } else {
      mine = buf.slice(0, PREVIEW_SIZE_CAP).toString("utf-8") + "\n… [truncated]";
    }
  } catch {
    // File missing (e.g. you-deleted kind) — leave empty
  }

  // Read theirs (online-copy sidecar)
  let theirs = "";
  const sidecarPath = onlineCopyPath(resolvedFile);
  try {
    if (fs.existsSync(sidecarPath)) {
      const buf = await readFile(sidecarPath);
      if (buf.length <= PREVIEW_SIZE_CAP) {
        theirs = buf.toString("utf-8");
      } else {
        theirs = buf.slice(0, PREVIEW_SIZE_CAP).toString("utf-8") + "\n… [truncated]";
      }
    }
  } catch {
    // Sidecar missing or unreadable — leave empty
  }

  return { mine, theirs, kind, isBinary: false };
}
