/**
 * auto-sync/recovery-emit.ts — the ONE shared mapping from a lib `RecoveryResult`
 * to the `sync:status` payload the renderer receives.
 *
 * WHY THIS EXISTS
 * ---------------
 * Two host paths dispatch `lib.recover()` and must translate its terminal
 * `RecoveryResult` into a `SyncStatusPayload`:
 *
 *   1. AutoSyncOrchestrator.run()'s error path (a sync threw, was classified,
 *      and routed through recover()).
 *   2. The api:preview PREFLIGHT block in main.ts (a structural condition was
 *      detected on open and repaired before the first sync).
 *
 * Historically each built the SAME five emit payloads inline — a near-verbatim
 * duplicate that drifted apart in exactly one place: how a `needs_user` result
 * that carries NO conflict files is surfaced (the orchestrator treats it as an
 * `auth` prompt; the preflight treats it as a generic `error`). This module owns
 * the payload construction ONCE and parameterises that single documented
 * divergence via `authlessNeedsUserAs`, so both callers share one implementation.
 *
 * The follow-up ACTIONS each caller takes on the returned `kind` (single-flight
 * runAgain, the retry timer, the conflict-latch, the deferred resume) genuinely
 * differ between the two paths and stay in the callers — this module maps the
 * result to a payload + a discriminant, nothing more. Pure and side-effect free.
 *
 * Node/lib-side ONLY — never imported by the renderer.
 */

import type { RecoveryResult } from "gutterpress";
import { isConflictFileBinary } from "../recovery-bridge";
import type { SyncStatusPayload } from "./orchestrator";

/** The follow-up bucket a caller acts on. Mirrors the branches both call sites
 *  historically switched over. */
export type RecoveryEmitKind = "recovered" | "retry_later" | "conflict" | "auth" | "error";

export interface RecoveryEmit {
  /** Which follow-up the caller should apply (latch / retry / resume / none). */
  kind: RecoveryEmitKind;
  /** The exact payload to hand to emitSyncStatus / deps.emit. */
  status: SyncStatusPayload;
  /** Present only when kind === "retry_later": re-arm delay, already defaulted. */
  retryAfterMs?: number;
}

export interface RecoveryEmitArgs {
  /** Absolute project dir the status applies to. */
  projectDir: string;
  /** Timestamp the caller computed for this emit (recovered may use a fresher one). */
  lastSyncAt: string | null;
  /** Operation-log path to surface on recovered/conflict/error payloads. */
  logFile?: string;
  /**
   * How to render a `needs_user` result that carries NO conflict files. The
   * orchestrator's error path treats it as an auth prompt (`"auth"`); the
   * api:preview preflight historically treats it as a generic error (`"error"`).
   * This is the ONLY behavioural divergence between the two call sites.
   */
  authlessNeedsUserAs: "auth" | "error";
}

/** The default re-arm delay when a retry_later handler omits `retryAfterMs`. */
const DEFAULT_RETRY_MS = 60_000;

/** Build the shared `error` payload used by blocked/failed/needs_user-error. */
function errorStatus(
  result: RecoveryResult,
  projectDir: string,
  lastSyncAt: string | null,
  logFile?: string,
): SyncStatusPayload {
  return {
    state: "error",
    projectDir,
    lastSyncAt,
    // Every RecoveryResult carries author-language copy — surface it so the
    // ambient pill can show WHY sync is paused, not just that it is.
    message: result.message,
    guidance: "guidance" in result ? result.guidance : undefined,
    backupZipPath: "backupZipPath" in result ? result.backupZipPath : undefined,
    logFile,
  };
}

/**
 * Map a terminal `RecoveryResult` to the payload the renderer receives plus the
 * follow-up bucket the caller acts on. Pure — no timers, no state mutation.
 */
export function mapRecoveryResultToEmit(
  result: RecoveryResult,
  args: RecoveryEmitArgs,
): RecoveryEmit {
  const { projectDir, lastSyncAt, logFile } = args;

  switch (result.status) {
    case "recovered":
      return {
        kind: "recovered",
        status: {
          state: "recovered",
          projectDir,
          lastSyncAt,
          backupZipPath: result.backupZipPath,
          logFile,
        },
      };

    case "retry_later":
      return {
        kind: "retry_later",
        status: { state: "offline", projectDir, lastSyncAt },
        retryAfterMs: result.retryAfterMs ?? DEFAULT_RETRY_MS,
      };

    case "needs_user":
      if (result.files && result.files.length > 0) {
        return {
          kind: "conflict",
          status: {
            state: "conflict",
            // L12: attach the host-authoritative isBinary per file (single
            // source of truth — recovery-bridge.ts's isConflictFileBinary).
            // M13: forward the conflict tip OIDs when this RecoveryResult
            // carries them. The binary-conflict recovery producer
            // (recover-binary-conflict.ts) populates localId/remoteId
            // alongside files, so this branch CAN report them — only the
            // text-merge conflict builder (outcome-mapping.ts's `conflict`
            // case) omits them, in which case the renderer falls back to
            // fetching the ids via syncChanges (see the
            // conflictPending/conflictFetchFailed states in
            // sync-controller.svelte.ts) instead of a permanently dead button.
            files: result.files.map((f) => ({ ...f, isBinary: isConflictFileBinary(f.path) })),
            ...(result.localId ? { localId: result.localId } : {}),
            ...(result.remoteId ? { remoteId: result.remoteId } : {}),
            projectDir,
            lastSyncAt,
            logFile,
          },
        };
      }
      // No conflict files: auth prompt (orchestrator) or generic error (preview).
      if (args.authlessNeedsUserAs === "auth") {
        return { kind: "auth", status: { state: "auth", projectDir, lastSyncAt } };
      }
      return { kind: "error", status: errorStatus(result, projectDir, lastSyncAt, logFile) };

    case "blocked":
    case "failed_no_changes_made":
    case "failed_backup_available":
    default:
      // Structural failure the recovery subsystem says is blocked — latch and
      // show guidance. `default` is a forward-compatible fail-safe (any new
      // status renders as a non-latching-free error rather than crashing).
      return { kind: "error", status: errorStatus(result, projectDir, lastSyncAt, logFile) };
  }
}
