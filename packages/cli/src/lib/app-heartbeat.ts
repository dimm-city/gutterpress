/**
 * app-heartbeat.ts — detect a running print-md app before a CLI repair
 * mutates the repo.
 *
 * WHY: `print-md repair` and the viewer's own recovery path both call into
 * the recovery subsystem, but each runs in its own OS process. The per-repo
 * FIFO lock (source-provider.ts) only serializes operations WITHIN a process,
 * so `print-md repair` run from a terminal while the viewer has the same
 * project open can race a live sync/snapshot. Rather than build a
 * cross-process lock manager, the viewer leaves a small liveness marker
 * behind while a project is open, and `repair` checks it before mutating.
 *
 * The marker lives at `<repoDir>/.git/print-md-app-heartbeat` (NOT in
 * userData) so `repair`, given only a repo directory, can find it without any
 * knowledge of the viewer's install. It is deliberately NOT a lock:
 *   - It never blocks the viewer itself, or any other repair run with --force.
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
const HEARTBEAT_FILENAME = "print-md-app-heartbeat";

/** A heartbeat younger than this is treated as "the app still has this open". */
export const APP_HEARTBEAT_FRESH_MS = 2 * 60_000;

export interface AppHeartbeat {
  /** PID of the process that wrote the heartbeat (diagnostic only — never
   *  used to `kill`/signal anything). */
  pid: number;
  /** Epoch ms the heartbeat was last (re)written. */
  timestamp: number;
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
 */
export async function writeAppHeartbeat(
  repoDir: string,
  now: number = Date.now(),
  pid: number = process.pid,
): Promise<void> {
  try {
    const heartbeat: AppHeartbeat = { pid, timestamp: now };
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
      return { pid: (parsed as AppHeartbeat).pid, timestamp: (parsed as AppHeartbeat).timestamp };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * True when a FRESH heartbeat exists for this repo — i.e. the print-md app
 * appears to have this project open right now. Absent/stale/corrupt all read
 * as "not open" (fail open: `repair` should not block on ambiguous signal).
 */
export async function isAppHeartbeatFresh(
  repoDir: string,
  now: number = Date.now(),
  maxAgeMs: number = APP_HEARTBEAT_FRESH_MS,
): Promise<boolean> {
  const heartbeat = await readAppHeartbeat(repoDir);
  if (!heartbeat) return false;
  return now - heartbeat.timestamp < maxAgeMs;
}
