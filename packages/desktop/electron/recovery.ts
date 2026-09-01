// ──────────────────────────────────────────────────────────────────────────
// recovery.ts — crash-recovery sidecar store (#44).
//
// NAMING MAP (UX review M38): "recovery" names TWO unrelated subsystems in
// this codebase, and they must not be confused:
//   1. CRASH-DRAFT recovery (THIS FILE + its `recovery:*` IPC handlers
//      (electron/api/recovery.ts) + CrashRecoveryDialog.svelte) — an
//      in-editor unsaved-changes sidecar.
//      Writer-facing vocabulary: "unsaved changes" only, never "recovery".
//   2. SYNC-REPAIR recovery (recovery-bridge.ts + RecoveryOverlay /
//      RecoveryConfirmDialog / RecoveryGuidanceDialog) — git-repair machinery
//      for a broken local-git project. Writer-facing vocabulary: "backup" /
//      "repair", also never the bare word "recovery" in visible copy.
// Internal identifiers (this file's name, `RecoveryEntry`, the route paths)
// keep the word "recovery" — renaming them broadly is out of scope (churn
// with no writer-facing value); only each domain's writer-facing dialog copy
// is disambiguated.
//
// The in-app editor (#38) auto-saves on a debounce; between an edit and that
// disk write the buffer differs from disk and an unclean exit would lose it.
// This module persists a debounced *sidecar snapshot* of the open buffer under
// Electron `userData/recovery/` so the next launch can offer to restore it.
//
// Layout (under <userData>/recovery/):
//   index.json            — RecoveryEntry[] (one per recovered file)
//   <sha1(filePath)>.md   — the buffer snapshot bytes
//
// On a successful disk save the matching entry is cleared, so a clean exit
// leaves no orphan and launch-time recovery only fires after a real crash.
//
// The snapshot file is keyed by a hash of the absolute file path; recovery
// entries are app-managed machine state (never the user's real file), so
// clearing one is a lifecycle action, not user-data deletion.
//
// IO helpers take the recovery directory as an argument so the pure index
// transforms (which carry the testable logic) stay free of electron / a global
// userData path and can be unit-tested in isolation (mirrors project-state.ts).
// ──────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";
import path from "node:path";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";

/** One pending crash-recovery snapshot (#44). Mirrors the contract type. */
export interface RecoveryEntry {
  /** Absolute path of the document the snapshot belongs to. */
  filePath: string;
  /** Absolute path of the snapshot bytes on disk. */
  recoveryPath: string;
  /** Epoch-ms timestamp the snapshot was written. */
  savedAt: number;
  /** Disk mtime (epoch ms) the snapshot was taken against. */
  baseMtimeMs: number;
}

/** Deterministic snapshot filename for a document path (sha1, 16 hex chars). */
export function recoveryFileName(filePath: string): string {
  return createHash("sha1").update(filePath).digest("hex").slice(0, 16) + ".md";
}

/** Upsert an entry into the index, returning a NEW array (keyed by filePath). */
export function upsertEntry(
  index: RecoveryEntry[],
  entry: RecoveryEntry,
): RecoveryEntry[] {
  const rest = index.filter((e) => e.filePath !== entry.filePath);
  return [entry, ...rest];
}

/** Remove the entry for `filePath`, returning a NEW array. */
export function removeEntry(
  index: RecoveryEntry[],
  filePath: string,
): RecoveryEntry[] {
  return index.filter((e) => e.filePath !== filePath);
}

// ── IO layer (recoveryDir injected) ────────────────────────────────────────

function indexPath(recoveryDir: string): string {
  return path.join(recoveryDir, "index.json");
}

/** Read the recovery index, returning `[]` on absence or corruption. */
export async function readIndex(recoveryDir: string): Promise<RecoveryEntry[]> {
  try {
    const raw = await readFile(indexPath(recoveryDir), "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is RecoveryEntry =>
        e && typeof e.filePath === "string" && typeof e.recoveryPath === "string",
    );
  } catch {
    return [];
  }
}

async function writeIndex(
  recoveryDir: string,
  index: RecoveryEntry[],
): Promise<void> {
  await mkdir(recoveryDir, { recursive: true });
  await writeFile(indexPath(recoveryDir), JSON.stringify(index, null, 2), "utf-8");
}

/**
 * Write a debounced snapshot of `content` for `filePath` and upsert its index
 * entry. `baseMtimeMs` is the disk mtime the snapshot was taken against.
 */
export async function writeRecovery(
  recoveryDir: string,
  filePath: string,
  content: string,
  baseMtimeMs: number,
): Promise<{ ok: boolean }> {
  await mkdir(recoveryDir, { recursive: true });
  const recoveryPath = path.join(recoveryDir, recoveryFileName(filePath));
  await writeFile(recoveryPath, content, "utf-8");
  const index = await readIndex(recoveryDir);
  const entry: RecoveryEntry = {
    filePath,
    recoveryPath,
    savedAt: Date.now(),
    baseMtimeMs,
  };
  await writeIndex(recoveryDir, upsertEntry(index, entry));
  return { ok: true };
}

/**
 * Clear the snapshot for `filePath`: drop its index entry and delete the
 * snapshot bytes. Only ever touches `userData/recovery/`, never the real file.
 */
export async function clearRecovery(
  recoveryDir: string,
  filePath: string,
): Promise<{ ok: boolean }> {
  const index = await readIndex(recoveryDir);
  const entry = index.find((e) => e.filePath === filePath);
  await writeIndex(recoveryDir, removeEntry(index, filePath));
  if (entry) {
    await rm(entry.recoveryPath, { force: true });
  }
  return { ok: true };
}

/**
 * List pending snapshots for anything UNDER `projectDir`, newest first, and only
 * when the snapshot is actually live (its file exists). Entries whose disk file
 * changed since the snapshot's *baseline* (its `baseMtimeMs`) were
 * saved/superseded by another process since the crash and are skipped — those
 * are not "unsaved changes". (Comparing to `baseMtimeMs` rather than the
 * snapshot's `savedAt` avoids a fractional-`mtimeMs` vs integer-`Date.now()`
 * collision when the snapshot and the disk write land in the same millisecond.)
 *
 * The filter used to be `dirname(entry.filePath) !== projectDir` — immediate
 * children only (2026-07-29 audit). A crash draft for `styles/book.css`,
 * `themes/<id>/theme.css`, an explicitly-listed `chapters/ch01.md`, or an
 * authorized repo-root shared file was written on every edit and then never
 * offered back after a crash — and, being unoffered, was swept as stale on the
 * next listing. Silent loss of exactly the files a multi-book project shares.
 * Matching is separator-aware, so a prefix-sibling project (`<proj>2`) is not
 * "under" this one.
 */
export async function listRecovery(
  recoveryDir: string,
  projectDir: string,
): Promise<RecoveryEntry[]> {
  const index = await readIndex(recoveryDir);
  const out: RecoveryEntry[] = [];
  const stale: RecoveryEntry[] = [];
  const root = path.resolve(projectDir);
  for (const entry of index) {
    const file = path.resolve(entry.filePath);
    if (file !== root && !file.startsWith(root + path.sep)) continue;
    // The snapshot bytes must still exist.
    try {
      await stat(entry.recoveryPath);
    } catch {
      stale.push(entry);
      continue;
    }
    // Skip entries whose disk file moved past the snapshot's baseline mtime —
    // the file was saved/changed by another process since the snapshot, so its
    // current bytes supersede the recovery. A 1ms tolerance absorbs filesystem
    // mtime granularity. `baseMtimeMs === 0` means the baseline was unknown
    // (file absent when snapshotted) → always offer.
    try {
      const s = await stat(entry.filePath);
      if (entry.baseMtimeMs > 0 && s.mtimeMs > entry.baseMtimeMs + 1) {
        stale.push(entry);
        continue;
      }
      const [diskBytes, recoveryBytes] = await Promise.all([
        readFile(entry.filePath, "utf-8"),
        readFile(entry.recoveryPath, "utf-8"),
      ]).catch(() => [null, null] as const);
      if (diskBytes != null && recoveryBytes != null && diskBytes === recoveryBytes) {
        stale.push(entry);
        continue;
      }
    } catch {
      // File was deleted on disk — still offer the snapshot.
    }
    out.push(entry);
  }
  if (stale.length > 0) {
    const stalePaths = new Set(stale.map((entry) => entry.filePath));
    await writeIndex(recoveryDir, index.filter((entry) => !stalePaths.has(entry.filePath)));
    await Promise.all(stale.map((entry) => rm(entry.recoveryPath, { force: true })));
  }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}

/** Read a snapshot's bytes by its recovery path. */
export async function readRecoveryContent(recoveryPath: string): Promise<string> {
  return readFile(recoveryPath, "utf-8");
}
