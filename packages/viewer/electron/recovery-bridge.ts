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
 * NOTE: The lib module is declared as `declare module "@dimm-city/print-md"`
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
// .d.ts yet (types.d.ts declares `declare module "@dimm-city/print-md"`).

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
  | "interrupted_rebase"
  | "interrupted_cherry_pick"
  | "interrupted_merge"
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
  /** Optional log file path for debugging recovery operations. */
  logFile?: string;
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
  /**
   * The lib's single RecoveryContext resolver (recovery/context.ts): repo-root
   * (the project's OWN root, never an ancestor repo), branch, remote URL,
   * credential, and backup slug all resolve in ONE tested place. The host
   * contributes only its ConfirmationGate.
   */
  buildRecoveryContext(options: {
    projectDir: string;
    confirmation: ConfirmationGate;
    tokenStore?: TokenStore;
    authorName?: string;
    logFile?: string;
  }): Promise<RecoveryContext>;
}

/**
 * Build a RecoveryContext for a projectDir: delegate the resolution to the lib
 * and attach the Electron dialog gate. Credentials stay in the main process —
 * they ride the context to the lib, never to the renderer.
 */
export async function buildRecoveryContext(
  projectDir: string,
  lib: LibForContext,
  tokenStore: TokenStore,
  authorName?: string,
  logFile?: string,
): Promise<RecoveryContext> {
  return lib.buildRecoveryContext({
    projectDir,
    confirmation: hostConfirmationGate(projectDir),
    tokenStore,
    authorName,
    logFile,
  });
}

// ── classifyFromHealth ────────────────────────────────────────────────────────
// The health-only preflight classifier now lives in the lib
// (packages/cli/src/lib/remote-auth/recovery/classify.ts, exported through the
// @dimm-city/print-md barrel as `classifyFromHealth`) — ONE ordering and ONE
// stale-lock age threshold shared with the error-path classifier and the
// stale-lock handler. main.ts calls lib.classifyFromHealth(health) directly.

// ── Preflight diagnostics ─────────────────────────────────────────────────────
// preflightStructuralReason + buildPreflightDiagnostics now live in the lib
// (recovery/inspect.ts, exported through the barrel) — pure mappers shared by
// every host that logs why a recovery kind was chosen. main.ts calls
// lib.buildPreflightDiagnostics(...) directly.

// ── decideRunAgainAfterPreflight ──────────────────────────────────────────────

/** The terminal status values a recover() call can settle with (mirrors the
 *  lib RecoveryResult union — see recovery/types.ts). Declared locally because
 *  the lib has no .d.ts (see header note). */
export type RecoveryResultStatus =
  | "recovered"
  | "retry_later"
  | "needs_user"
  | "blocked"
  | "failed_no_changes_made"
  | "failed_backup_available";

/** What the preflight orchestrator should do with a pending `runAgain` flag once
 *  recover() settles and the single-flight lock is released. */
export type RunAgainDecision =
  /** No trigger was queued while preflight held the lock — do nothing. */
  | "none"
  /** A trigger was queued and the outcome is non-latching — run the queued sync. */
  | "run"
  /** A trigger was queued but the outcome latches (conflict/blocked/failed) — the
   *  latch intentionally suppresses it; clear the flag without running. */
  | "suppress";

/**
 * Decide the fate of a pending auto-sync trigger after preflight recovery.
 *
 * WHY (BUG 3): the api:preview preflight IIFE holds the single-flight lock while
 * recover() runs. If runAutoSync fires during that window it sets `runAgain`
 * instead of syncing. Previously main.ts only honored `runAgain` on the
 * `recovered` branch — so on `retry_later` (and any non-`recovered` non-latching
 * path) the queued sync was silently dropped and the author's sync never ran.
 *
 * Centralizing the decision here keeps the rule testable and consistent with the
 * runAutoSync invariants:
 *   - Non-latching outcomes (recovered, retry_later): a pending trigger is
 *     allowed to proceed ("run"). This is the dropped-trigger fix.
 *   - Latching outcomes (needs_user conflict, blocked, failed_*): the
 *     conflict-latch deliberately pauses auto-sync, so a pending trigger is
 *     suppressed ("suppress") rather than run.
 *   - Any unrecognized status fails SAFE to "suppress" (never auto-run on a
 *     state we don't understand).
 *
 * @param status   The terminal status returned by lib.recover().
 * @param runAgain Whether a trigger was queued while preflight held the lock.
 */
export function decideRunAgainAfterPreflight(
  status: RecoveryResultStatus,
  runAgain: boolean,
): RunAgainDecision {
  if (!runAgain) return "none";
  switch (status) {
    case "recovered":
    case "retry_later":
      // Non-latching: honor the queued sync (BUG 3 fix).
      return "run";
    case "needs_user":
    case "blocked":
    case "failed_no_changes_made":
    case "failed_backup_available":
      // Latching: the conflict-latch suppresses the queued sync.
      return "suppress";
    default:
      // Forward-compatible fail-safe: never auto-run on an unknown state.
      return "suppress";
  }
}

export function preExportSyncGateBlockError(gateErr: unknown): Error | null {
  const code = (gateErr as Error & { code?: string })?.code;
  if (code === "SYNC_CONFLICT") return gateErr as Error;
  if (code === "RepoNeedsRecovery") {
    const repairErr = new Error(
      "This project needs repair before saving a PDF. Open the project and allow the repair, then try again.",
    );
    (repairErr as Error & { code?: string }).code = "SYNC_CONFLICT";
    return repairErr;
  }
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
