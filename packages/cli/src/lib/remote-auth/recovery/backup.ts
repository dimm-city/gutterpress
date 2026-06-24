/**
 * Temp-dir zip backup creation and verification for the sync-recovery subsystem.
 *
 * Creates a STORE-method (no compression) ZIP of the project's user files plus
 * .git/, writing it to:
 *   <os.tmpdir()>/print-sync-recovery/<repo-slug>/<ISO-timestamp>-<reason>.zip
 *
 * The backup root is `os.tmpdir()` (NOT a hardcoded "/tmp") so it is correct on
 * Windows/macOS/Linux — the viewer ships on all three (CLAUDE.md §8). A literal
 * "/tmp" would make every risky-repair backup throw on Windows.
 *
 * WHY a bespoke inlined writer instead of a dependency:
 *   - packages/cli has no zip library (fflate, adm-zip, jszip are absent).
 *   - Adding a dependency adds a build surface and potential native bindings.
 *   - STORE-method ZIP is ~150 lines: local file header + raw bytes, central
 *     directory, end-of-central-directory record, CRC-32 with an inlined
 *     table. Zero imports beyond node:fs/node:os/node:path. Survives bun build
 *     --compile cleanly (no runtime package.json reads, no native bindings,
 *     no computed-path dynamic imports — CLAUDE.md §1/§3).
 *
 * Verification (assertZipReadable / zipEntries): parses the EOCD + central
 * directory. assertZipReadable validates EVERY central-directory entry's
 * signature and bounds (not just the first) via positioned reads of the central
 * directory only — never the file data — so it stays memory-safe on multi-GB
 * backups while still catching corruption in any later entry. For STORE entries,
 * stored bytes ARE the file bytes, so a content check needs no inflate. The same
 * reader backs test zip-assertions helpers.
 *
 * Retention: createRecoveryZip prunes stale backups (best-effort, never throws)
 * before writing a new one — see pruneOldBackups — so old backups do not fill
 * the disk over time.
 *
 * Exclusions: node_modules/, .print-sync/cache/, and **.git/config**. The git
 * config file is deliberately dropped from the backup because it can carry an
 * embedded credential (e.g. a tokenized remote URL) and is reconstructable on
 * recovery (the remote is reconfigured from the stored connection). All other
 * .git/ contents (objects, refs, HEAD) ARE included so recovery still works.
 * Inclusions: all user-visible files + .git/ (minus config, for full recovery)
 */

import { createReadStream, createWriteStream } from "node:fs";
import { once } from "node:events";
import { mkdir, open, readdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { RecoveryBackup, RecoveryContext } from "./types.ts";

// ── CRC-32 (inlined, INCREMENTAL — bounded memory for streaming) ─────────────

const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c;
  }
  return t;
})();

const CRC_INIT = 0xffffffff;
function crc32Update(crc: number, buf: Uint8Array): number {
  let c = crc;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  }
  return c >>> 0;
}
function crc32Final(crc: number): number {
  return (crc ^ 0xffffffff) >>> 0;
}

// ── ZIP byte helpers ──────────────────────────────────────────────────────────

function writeUint16LE(buf: Buffer, offset: number, val: number): void {
  buf.writeUInt16LE(val & 0xffff, offset);
}
function writeUint32LE(buf: Buffer, offset: number, val: number): void {
  buf.writeUInt32LE(val >>> 0, offset);
}

/** Write to a stream with backpressure (await `drain` when the buffer is full). */
async function writeChunk(
  stream: import("node:fs").WriteStream,
  buf: Uint8Array,
): Promise<void> {
  if (!stream.write(buf)) await once(stream, "drain");
}

// ── File walker ───────────────────────────────────────────────────────────────

const EXCLUDED_DIRS = new Set(["node_modules"]);
// Path-prefix exclusions, expressed with forward slashes. `isExcluded`
// normalizes the (OS-native) relative path to forward slashes before matching,
// so these work on Windows (\) and POSIX (/) alike.
//   - .print-sync/cache : transient cache, never needed for recovery
//   - .git/config       : may embed a credential (tokenized remote URL); it is
//     reconstructable on recovery, so we deliberately drop it (BUG 3).
const EXCLUDED_PATHS = [".print-sync/cache", ".git/config"];

function isExcluded(relPath: string): boolean {
  // Normalize to forward slashes so prefix matching is separator-agnostic.
  const normalized = relPath.split(path.sep).join("/");
  const parts = normalized.split("/");
  if (parts[0] && EXCLUDED_DIRS.has(parts[0])) return true;
  return EXCLUDED_PATHS.some((p) => normalized === p || normalized.startsWith(p + "/"));
}

/** Walk a directory recursively, collecting all file paths relative to root. */
async function walkDir(dir: string, root: string, out: string[]): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return; // Unreadable dir — skip silently.
  }
  for (const name of entries) {
    const abs = path.join(dir, name);
    const rel = path.relative(root, abs);
    if (isExcluded(rel)) continue;
    let s;
    try {
      s = await stat(abs);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      await walkDir(abs, root, out);
    } else if (s.isFile()) {
      out.push(rel);
    }
  }
}

// ── Timestamp → safe filename segment ────────────────────────────────────────

function safeTimestamp(now: number): string {
  return new Date(now).toISOString().replace(/:/g, "-").replace(/\./g, "-");
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Root directory for all sync-recovery backups.
 *
 * Computed from `os.tmpdir()` (NOT hardcoded "/tmp") so it resolves to a real
 * temp dir on Windows, macOS, and Linux. A literal "/tmp" does not exist on
 * Windows and would make every risky-repair backup throw there (CLAUDE.md §8).
 */
export const BACKUP_ROOT = path.join(os.tmpdir(), "print-sync-recovery");

/** Default retention window for backups: zips older than this are pruned. */
const DEFAULT_BACKUP_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
/** Default cap on retained backups per repo-slug (newest kept). */
const DEFAULT_BACKUP_MAX_PER_SLUG = 20;

export interface PruneOldBackupsOptions {
  /** Backup root to prune under. Defaults to {@link BACKUP_ROOT}. */
  root?: string;
  /** Restrict pruning to a single repo-slug subfolder. */
  slug?: string;
  /** Remove zips with an mtime older than this many ms. Default 7 days. */
  ttlMs?: number;
  /** After TTL pruning, keep at most this many newest zips per slug. */
  maxPerSlug?: number;
  /** Clock override (tests). Returns epoch ms. */
  now?: () => number;
}

/**
 * Remove stale recovery backups so they do not accumulate forever and fill the
 * disk (BUG 2). Two independent policies are applied per repo-slug folder:
 *   1. TTL — delete any zip whose mtime is older than `ttlMs` (default 7 days).
 *   2. Cap — keep only the newest `maxPerSlug` zips (default 20), delete the rest.
 *
 * BEST-EFFORT and SILENT: this never throws and never blocks backup creation.
 * Any unreadable dir, racing delete, or stat failure is ignored — a failure to
 * prune must never prevent the user's work from being backed up.
 */
export async function pruneOldBackups(opts: PruneOldBackupsOptions = {}): Promise<void> {
  const root = opts.root ?? BACKUP_ROOT;
  const ttlMs = opts.ttlMs ?? DEFAULT_BACKUP_TTL_MS;
  const maxPerSlug = opts.maxPerSlug ?? DEFAULT_BACKUP_MAX_PER_SLUG;
  const now = opts.now?.() ?? Date.now();

  // Determine which slug folders to scan.
  let slugDirs: string[];
  try {
    if (opts.slug) {
      slugDirs = [path.join(root, opts.slug)];
    } else {
      const names = await readdir(root);
      slugDirs = names.map((n) => path.join(root, n));
    }
  } catch {
    return; // Root missing/unreadable — nothing to prune.
  }

  for (const slugDir of slugDirs) {
    let zipNames: string[];
    try {
      zipNames = (await readdir(slugDir)).filter((n) => n.endsWith(".zip"));
    } catch {
      continue; // Missing/unreadable slug folder — skip.
    }

    // Stat each zip once; tolerate races (a vanished file is fine to ignore).
    const stats: { abs: string; mtimeMs: number }[] = [];
    for (const name of zipNames) {
      const abs = path.join(slugDir, name);
      try {
        const s = await stat(abs);
        if (s.isFile()) stats.push({ abs, mtimeMs: s.mtimeMs });
      } catch {
        // ignore
      }
    }

    // Policy 1 — TTL: collect zips older than the window.
    const toRemove = new Set<string>();
    for (const s of stats) {
      if (now - s.mtimeMs > ttlMs) toRemove.add(s.abs);
    }

    // Policy 2 — cap: of the survivors, keep only the newest `maxPerSlug`.
    const survivors = stats
      .filter((s) => !toRemove.has(s.abs))
      .sort((a, b) => b.mtimeMs - a.mtimeMs); // newest first
    for (const s of survivors.slice(maxPerSlug)) toRemove.add(s.abs);

    for (const abs of toRemove) {
      try {
        await rm(abs, { force: true });
      } catch {
        // ignore — best effort
      }
    }
  }
}

/**
 * Create a temp-dir zip backup of the project directory (user files + .git/,
 * minus .git/config). Calls ctx.faults?.before("backup_create") then
 * ctx.faults?.before("backup_verify") so tests can inject failures at each step.
 *
 * Returns a RecoveryBackup describing the zip, or throws on failure.
 */
export async function createRecoveryZip(
  ctx: Pick<RecoveryContext, "repoDir" | "repoSlug" | "faults" | "now">,
  reason: string,
): Promise<RecoveryBackup> {
  await ctx.faults?.before("backup_create");

  const now = ctx.now?.() ?? Date.now();
  const ts = safeTimestamp(now);
  const safeReason = reason.replace(/[^a-z0-9_-]/gi, "_").toLowerCase();
  const slug = ctx.repoSlug.replace(/[^a-z0-9_-]/gi, "_").toLowerCase();

  // Best-effort retention sweep BEFORE writing the new backup so old zips never
  // accumulate. Never throws, never blocks the new backup (BUG 2). Scoped to
  // this slug so a large stash under another project can't slow this path.
  await pruneOldBackups({ slug, now: () => now });

  const zipDir = path.join(BACKUP_ROOT, slug);
  await mkdir(zipDir, { recursive: true });
  const zipPath = path.join(zipDir, `${ts}-${safeReason}.zip`);

  // Collect all files under the project dir.
  const relPaths: string[] = [];
  await walkDir(ctx.repoDir, ctx.repoDir, relPaths);
  relPaths.sort();

  // STREAM each file's bytes straight to disk — NEVER hold the whole repo (or a
  // large packfile) in memory. Memory use is O(one chunk + the central
  // directory headers), not O(repo size). This is what makes the backup safe on
  // large repos (the old whole-buffer writer OOM'd on a big .git). Uses ZIP
  // data descriptors (flag bit 3) so the CRC/size — unknown until the file has
  // been streamed — are written AFTER the data, keeping it a single read pass.
  const names: string[] = [];
  const central: Buffer[] = [];
  const out = createWriteStream(zipPath);
  let offset = 0;
  try {
    for (const rel of relPaths) {
      const abs = path.join(ctx.repoDir, rel);
      let st;
      try {
        st = await stat(abs);
      } catch {
        continue; // Unreadable — skip.
      }
      if (!st.isFile()) continue;

      const name = rel.split(path.sep).join("/");
      const nameBytes = Buffer.from(name, "utf8");
      const localOffset = offset;

      // Local file header (crc/sizes deferred to the data descriptor → 0 here).
      const lh = Buffer.alloc(30 + nameBytes.length, 0);
      writeUint32LE(lh, 0, 0x04034b50);
      writeUint16LE(lh, 4, 20);
      writeUint16LE(lh, 6, 0x0008); // bit 3: sizes/crc in a trailing data descriptor
      writeUint16LE(lh, 8, 0); // STORE
      writeUint16LE(lh, 26, nameBytes.length);
      nameBytes.copy(lh, 30);
      await writeChunk(out, lh);
      offset += lh.length;

      // Stream the file data, computing CRC + size incrementally.
      let crc = CRC_INIT;
      let size = 0;
      try {
        const rs = createReadStream(abs);
        for await (const chunk of rs as AsyncIterable<Buffer>) {
          crc = crc32Update(crc, chunk);
          size += chunk.length;
          await writeChunk(out, chunk);
          offset += chunk.length;
        }
      } catch {
        // File vanished/locked mid-read — the data descriptor still closes the
        // entry consistently with whatever bytes were written.
      }
      crc = crc32Final(crc);

      // Data descriptor (with signature): crc, compressed size, uncompressed size.
      const dd = Buffer.alloc(16, 0);
      writeUint32LE(dd, 0, 0x08074b50);
      writeUint32LE(dd, 4, crc);
      writeUint32LE(dd, 8, size);
      writeUint32LE(dd, 12, size);
      await writeChunk(out, dd);
      offset += dd.length;

      // Central directory entry (real crc/size; carries the data-descriptor flag).
      const cd = Buffer.alloc(46 + nameBytes.length, 0);
      writeUint32LE(cd, 0, 0x02014b50);
      writeUint16LE(cd, 4, 20);
      writeUint16LE(cd, 6, 20);
      writeUint16LE(cd, 8, 0x0008);
      writeUint16LE(cd, 10, 0);
      writeUint32LE(cd, 16, crc);
      writeUint32LE(cd, 20, size);
      writeUint32LE(cd, 24, size);
      writeUint16LE(cd, 28, nameBytes.length);
      writeUint32LE(cd, 42, localOffset);
      nameBytes.copy(cd, 46);
      central.push(cd);
      names.push(name);
    }

    // Central directory + end-of-central-directory record.
    const cdStart = offset;
    for (const cd of central) {
      await writeChunk(out, cd);
      offset += cd.length;
    }
    const cdSize = offset - cdStart;

    const eocd = Buffer.alloc(22, 0);
    writeUint32LE(eocd, 0, 0x06054b50);
    writeUint16LE(eocd, 8, names.length);
    writeUint16LE(eocd, 10, names.length);
    writeUint32LE(eocd, 12, cdSize);
    writeUint32LE(eocd, 16, cdStart);
    await writeChunk(out, eocd);
  } finally {
    await new Promise<void>((resolve, reject) => {
      out.on("error", reject);
      out.end(resolve);
    });
  }

  // Verify FROM DISK (positioned reads of the EOCD + central directory only —
  // never the whole zip), so a truncated/failed write is caught and a huge
  // backup is verified without reading it back into memory.
  await ctx.faults?.before("backup_verify");
  await assertZipReadable(zipPath);

  return {
    zipPath,
    createdAt: new Date(now).toISOString(),
    entries: names,
  };
}

// ── ZIP reader (for assertions and verification) ──────────────────────────────

export interface ZipEntryInfo {
  name: string;
  size: number;
  /** For STORE entries, this is the raw file content. */
  data: Uint8Array;
}

/**
 * Parse the central directory of a ZIP buffer and return entry info.
 * Works for STORE-method (no compression) zips only — the ones we write.
 */
export function parseZipEntries(buf: Buffer): ZipEntryInfo[] {
  // Find EOCD signature (0x06054b50) from the end.
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) return [];

  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  const cdCount = buf.readUInt16LE(eocdOffset + 8);

  const entries: ZipEntryInfo[] = [];
  let pos = cdOffset;
  for (let i = 0; i < cdCount; i++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) break;
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const size = buf.readUInt32LE(pos + 24); // uncompressed size
    const localOffset = buf.readUInt32LE(pos + 42);
    const name = buf.subarray(pos + 46, pos + 46 + nameLen).toString("utf8");

    // For STORE entries, data starts right after the local file header.
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const data = buf.subarray(dataStart, dataStart + size);

    entries.push({ name, size, data });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/**
 * Assert that a zip file at `zipPath` is readable and parseable.
 * Throws with a descriptive error if not.
 *
 * Validates EVERY central-directory entry — each entry's CD signature
 * (0x02014b50) and that its variable-length fields stay within the central
 * directory bounds. A zip whose FIRST entry is intact but whose LATER entries
 * are corrupt is rejected (BUG 4): checking only entry 0 let truncated/garbled
 * tails slip through.
 *
 * MEMORY-SAFE: reads only the end-of-central-directory record (file tail) and
 * the central directory via positioned reads — NEVER the file data. A multi-GB
 * backup is verified without reading it back into memory.
 */
export async function assertZipReadable(zipPath: string): Promise<void> {
  let handle;
  try {
    handle = await open(zipPath, "r");
  } catch (e) {
    throw new Error(`Backup zip not readable at ${zipPath}: ${e}`);
  }
  try {
    const { size } = await handle.stat();
    if (size < 22) throw new Error(`Backup zip appears empty or corrupt at ${zipPath}`);

    // EOCD is in the last 22 bytes + up to a 65535-byte comment.
    const tailLen = Math.min(size, 65557);
    const tail = Buffer.alloc(tailLen);
    await handle.read(tail, 0, tailLen, size - tailLen);

    let e = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) {
        e = i;
        break;
      }
    }
    if (e < 0) throw new Error(`Backup zip has no end-of-archive record at ${zipPath}`);

    const cdCount = tail.readUInt16LE(e + 8);
    const cdSize = tail.readUInt32LE(e + 12);
    const cdOffset = tail.readUInt32LE(e + 16);
    if (cdCount === 0) throw new Error(`Backup zip appears empty or corrupt at ${zipPath}`);
    if (cdOffset + cdSize > size) {
      throw new Error(`Backup zip central directory runs past end of file at ${zipPath}`);
    }

    // Read the whole central directory once (positioned read — file data is
    // never touched), then walk all cdCount entries verifying each signature
    // and that its name/extra/comment fields stay inside the CD buffer.
    const cd = Buffer.alloc(Math.min(cdSize, size));
    await handle.read(cd, 0, cd.length, cdOffset);

    let pos = 0;
    for (let i = 0; i < cdCount; i++) {
      // Fixed 46-byte CD header must fit.
      if (pos + 46 > cd.length) {
        throw new Error(
          `Backup zip central directory entry ${i + 1}/${cdCount} is truncated at ${zipPath}`,
        );
      }
      if (cd.readUInt32LE(pos) !== 0x02014b50) {
        throw new Error(
          `Backup zip central directory entry ${i + 1}/${cdCount} is corrupt at ${zipPath}`,
        );
      }
      const nameLen = cd.readUInt16LE(pos + 28);
      const extraLen = cd.readUInt16LE(pos + 30);
      const commentLen = cd.readUInt16LE(pos + 32);
      const next = pos + 46 + nameLen + extraLen + commentLen;
      // Variable-length fields must stay within the central directory.
      if (next > cd.length) {
        throw new Error(
          `Backup zip central directory entry ${i + 1}/${cdCount} overflows the directory at ${zipPath}`,
        );
      }
      pos = next;
    }
  } finally {
    await handle.close();
  }
}

/**
 * Return the list of entries inside a zip file (as ZipEntryInfo objects).
 *
 * @internal TEST-ONLY: reads the WHOLE zip into memory to expose entry content.
 * NEVER call this in a production path — a large backup would OOM. Production
 * verification uses {@link assertZipReadable} (positioned reads, memory-safe).
 * Used by tests to assert which files were backed up and inspect content.
 */
export async function zipEntries(zipPath: string): Promise<ZipEntryInfo[]> {
  const buf = await readFile(zipPath);
  return parseZipEntries(buf);
}
