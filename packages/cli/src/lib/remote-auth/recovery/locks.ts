/**
 * locks.ts — the SINGLE lock-discovery + sweep implementation, shared by the
 * health probe (inspect.ts) and the repair pipeline (repair.ts) so the two
 * can never disagree about which locks exist or which count as stale.
 *
 * A crash does NOT only leave `.git/index.lock`. Depending on what was being
 * written when the process died, git can leave any of:
 *   - index.lock          (staging the index)
 *   - HEAD.lock           (moving HEAD)
 *   - config.lock         (writing config)
 *   - packed-refs.lock    (repacking refs)
 *   - refs/**\/<name>.lock (updating a single ref, e.g. refs/heads/main.lock)
 *
 * Sweep rule (conservative): a fresh lock (younger than
 * {@link STALE_LOCK_MIN_AGE_MS}) may belong to a LIVE process — deleting it
 * would corrupt an in-flight write, so ONE fresh lock defers the whole sweep.
 * Only when every candidate is stale are they all removed.
 */
import * as fs from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

import { STALE_LOCK_MIN_AGE_MS } from "./classify.ts";

const TOP_LEVEL_LOCK_NAMES = [
  "index.lock",
  "HEAD.lock",
  "config.lock",
  "packed-refs.lock",
] as const;

export interface LockCandidate {
  /** Absolute path to the lock file. */
  path: string;
  /** Age in ms relative to `now` (now - mtime). */
  ageMs: number;
}

/**
 * Recursively collect `*.lock` file paths under a directory. Best-effort and
 * never throws — an unreadable subdirectory is skipped. Used to find per-ref
 * locks like `refs/heads/main.lock` or `refs/tags/v1.lock` at any depth.
 */
async function collectRefLockPaths(dir: string, out: string[]): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // Missing/unreadable — nothing to collect here.
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectRefLockPaths(abs, out);
    } else if (entry.isFile() && entry.name.endsWith(".lock")) {
      out.push(abs);
    }
  }
}

/**
 * Gather every candidate lock file (top-level + refs/**) with its age.
 * Locks that vanish between discovery and stat are simply dropped (a racing
 * delete is fine to ignore). Never throws.
 */
export async function findLockCandidates(gitDir: string, now: number): Promise<LockCandidate[]> {
  const paths: string[] = TOP_LEVEL_LOCK_NAMES.map((name) => path.join(gitDir, name));
  await collectRefLockPaths(path.join(gitDir, "refs"), paths);

  const candidates: LockCandidate[] = [];
  for (const p of paths) {
    try {
      const s = await stat(p);
      if (s.isFile()) candidates.push({ path: p, ageMs: now - s.mtimeMs });
    } catch {
      // Not present (or unreadable) — skip.
    }
  }
  return candidates;
}

/**
 * Delete every stale lock under `gitDir` — but ONLY when every candidate is
 * stale (one fresh lock defers the whole sweep; a live process may hold it).
 *
 * Returns "clean" (nothing found), "swept" (all removed), or "fresh"
 * (deferred — the caller should retry later).
 */
export async function sweepStaleLocks(
  gitDir: string,
  now: number = Date.now(),
  minAgeMs: number = STALE_LOCK_MIN_AGE_MS,
): Promise<"clean" | "swept" | "fresh"> {
  const candidates = await findLockCandidates(gitDir, now);
  if (candidates.length === 0) return "clean";
  if (candidates.some((c) => c.ageMs < minAgeMs)) return "fresh";
  for (const c of candidates) {
    await rm(c.path, { force: true });
  }
  return "swept";
}
