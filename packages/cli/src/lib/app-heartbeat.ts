/**
  * app-heartbeat.ts — detect a running Gutterpress app before a CLI repair
 * mutates the repo.
 *
 * WHY: `gutterpress repair` and the desktop's own recovery path both call into
 * the recovery subsystem, but each runs in its own OS process. The per-repo
 * FIFO lock (source-provider.ts) only serializes operations WITHIN a process,
 * so `gutterpress repair` run from a terminal while the desktop has the same
 * project open can race a live sync/snapshot. Rather than build a
 * cross-process lock manager, the desktop leaves a small liveness marker
 * behind while a project is open, and `repair` checks it before mutating.
 *
 * The marker lives at `<repoDir>/.git/gutterpress-app-heartbeat` (NOT in
 * userData) so `repair`, given only a repo directory, can find it without any
 * knowledge of the desktop's install. It is deliberately NOT a lock:
 *   - It never blocks the desktop itself, or any other repair run with --force.
 *   - It carries no locking semantics — just "an app touched this repo
 *     recently, maybe check before you assume it's idle".
 *   - It is written best-effort (a failed write must never surprise the
 *     author with a crash) and read best-effort (a missing/corrupt file
 *     means "no app appears to have this open", not an error).
 *
 * Two invariants that keep this file inert to the rest of the recovery
 * subsystem:
 *   - Filename does not match any pattern `findLockCandidates` scans
 *     (recover-stale-lock.ts: fixed top-level `*.lock` names + `refs/**`) —
 *     so stale-lock recovery can never see or remove it.
 *   - It lives under `.git`, which `hasPendingChanges`/`listWorkdirChanges`
 *     (source-provider.ts) always ignores (`git.isIgnored` treats a `.git`
 *     path segment as ignored unconditionally) — so it can never look like an
 *     uncommitted author change.
 */

import { readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { gitDirFor } from "./source-provider.ts";

/** Filename only — never `*.lock` and never under `refs/`, see module doc. */
const HEARTBEAT_FILENAME = "gutterpress-app-heartbeat";

/**
 * Fallback freshness window used only when a heartbeat carries no `ttlMs`
 * (an older writer, or one with no cadence to report). Prefer a
 * cadence-derived TTL — see {@link heartbeatTtlMs} — since the actual
 * refresh cadence ranges 1 min–24 h (AUTO_SYNC_MIN/MAX_MINUTES,
 * host-policy.ts) and a fixed 2-minute window reads a live app as "closed"
 * for most of any longer cadence.
 */
export const APP_HEARTBEAT_FRESH_MS = 2 * 60_000;

export interface AppHeartbeat {
  /** PID of the process that wrote the heartbeat (diagnostic only — never
   *  used to `kill`/signal anything). */
  pid: number;
  /** Epoch ms the heartbeat was last (re)written. */
  timestamp: number;
  /**
   * Freshness window (ms) the writer says applies to THIS heartbeat, derived
   * from its own refresh cadence (see {@link heartbeatTtlMs}). When present,
   * `isAppHeartbeatFresh` honors it instead of its `maxAgeMs` fallback param —
   * the writer knows how often it actually refreshes; the reader doesn't.
   */
  ttlMs?: number;
}

/** Refresh cadence is re-checked on every write, so the TTL only needs to
 *  outlive one missed tick, not many — a small multiplier is enough and
 *  keeps a live-but-idle app from reading as fresh for hours after it quit. */
const HEARTBEAT_TTL_MULTIPLIER = 2;
/** Covers the write's own async latency (detect + fs write landing a little
 *  after the tick fires) so the marker isn't momentarily stale right at each
 *  tick boundary. */
const HEARTBEAT_TTL_BUFFER_MS = 30_000;

/**
 * The freshness window a heartbeat writer should stamp for a given refresh
 * cadence (the actual interval this writer refreshes the marker on — e.g.
 * `autoSyncDelayMs(settings.versionHistory)`). `null` (feature disabled, no
 * periodic refresh at all) falls back to {@link APP_HEARTBEAT_FRESH_MS}.
 *
 * Standard heartbeat rule: TTL should comfortably exceed the refresh period
 * so one missed/delayed tick doesn't read as "closed". Exported so both the
 * desktop (the writer, which knows its own cadence) and tests can compute it
 * consistently.
 */
export function heartbeatTtlMs(periodicMs: number | null): number {
  if (periodicMs === null) return APP_HEARTBEAT_FRESH_MS;
  return periodicMs * HEARTBEAT_TTL_MULTIPLIER + HEARTBEAT_TTL_BUFFER_MS;
}

/** Absolute path to the heartbeat marker for a repo. */
export function appHeartbeatPath(repoDir: string): string {
  return path.join(gitDirFor(repoDir), HEARTBEAT_FILENAME);
}

/**
 * Write/refresh the heartbeat marker. Best-effort: a failed write (missing
 * `.git` dir, read-only filesystem, …) is swallowed — it must never surface
 * as an error to the author, since it is only ever a background liveness
 * signal, not a required operation.
 *
 * `ttlMs`, when supplied, should be {@link heartbeatTtlMs} applied to this
 * writer's OWN actual refresh cadence — it is stamped into the marker so a
 * reader with no knowledge of that cadence still judges freshness correctly.
 * Omit it (or pass `undefined`) when the caller has no cadence to report; the
 * reader then falls back to its own `maxAgeMs` default.
 */
export async function writeAppHeartbeat(
  repoDir: string,
  now: number = Date.now(),
  pid: number = process.pid,
  ttlMs?: number,
): Promise<void> {
  try {
    const heartbeat: AppHeartbeat = { pid, timestamp: now, ...(ttlMs !== undefined ? { ttlMs } : {}) };
    await writeFile(appHeartbeatPath(repoDir), JSON.stringify(heartbeat));
  } catch {
    // Best-effort — see module doc.
  }
}

/**
 * Remove the heartbeat marker (project close / app quit). Best-effort: an
 * already-missing or unreadable file is not an error.
 */
export async function removeAppHeartbeat(repoDir: string): Promise<void> {
  try {
    await unlink(appHeartbeatPath(repoDir));
  } catch {
    // Missing/unreadable — nothing to clean up.
  }
}

/**
 * Read + parse the heartbeat marker. Returns `null` when absent, unreadable,
 * or corrupt (never throws — a damaged heartbeat is just "no signal").
 */
export async function readAppHeartbeat(repoDir: string): Promise<AppHeartbeat | null> {
  try {
    const raw = await readFile(appHeartbeatPath(repoDir), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as AppHeartbeat).pid === "number" &&
      typeof (parsed as AppHeartbeat).timestamp === "number"
    ) {
      const candidate = parsed as AppHeartbeat;
      const ttlMs = typeof candidate.ttlMs === "number" ? candidate.ttlMs : undefined;
      return { pid: candidate.pid, timestamp: candidate.timestamp, ...(ttlMs !== undefined ? { ttlMs } : {}) };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * True when a FRESH heartbeat exists for this repo — i.e. the gutterpress app
 * appears to have this project open right now. Absent/stale/corrupt all read
 * as "not open" (fail open: `repair` should not block on ambiguous signal).
 *
 * Freshness window: the heartbeat's own stamped `ttlMs` (derived from the
 * writer's actual refresh cadence — see {@link heartbeatTtlMs}) wins when
 * present; `maxAgeMs` is only a fallback for a heartbeat with none.
 */
export async function isAppHeartbeatFresh(
  repoDir: string,
  now: number = Date.now(),
  maxAgeMs: number = APP_HEARTBEAT_FRESH_MS,
): Promise<boolean> {
  const heartbeat = await readAppHeartbeat(repoDir);
  if (!heartbeat) return false;
  return now - heartbeat.timestamp < (heartbeat.ttlMs ?? maxAgeMs);
}
