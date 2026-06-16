/**
 * /tmp zip backup creation and verification for the sync-recovery subsystem.
 *
 * Creates a STORE-method (no compression) ZIP of the project's user files plus
 * .git/, writing it to:
 *   /tmp/print-sync-recovery/<repo-slug>/<ISO-timestamp>-<reason>.zip
 *
 * WHY a bespoke inlined writer instead of a dependency:
 *   - packages/lib has no zip library (fflate, adm-zip, jszip are absent).
 *   - Adding a dependency adds a build surface and potential native bindings.
 *   - STORE-method ZIP is ~150 lines: local file header + raw bytes, central
 *     directory, end-of-central-directory record, CRC-32 with an inlined
 *     table. Zero imports beyond node:fs/node:path. Survives bun build
 *     --compile cleanly (no runtime package.json reads, no native bindings,
 *     no computed-path dynamic imports — CLAUDE.md §1/§3).
 *
 * Verification (assertZipReadable / zipEntries): parses the EOCD + central
 * directory. For STORE entries, stored bytes ARE the file bytes, so a content
 * check needs no inflate. The same reader backs test zip-assertions helpers.
 *
 * Exclusions: node_modules/, .print-sync/cache/
 * Inclusions: all user-visible files + .git/ (for full recovery)
 */

import * as fs from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { RecoveryBackup, RecoveryContext } from "./types.ts";

// ── CRC-32 (inlined — no import, no dependency) ──────────────────────────────

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

function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ── STORE-method ZIP writer (inlined) ────────────────────────────────────────

interface ZipEntry {
  /** Path inside the zip (forward slashes, no leading slash). */
  name: string;
  data: Uint8Array;
}

function writeUint16LE(buf: Buffer, offset: number, val: number): void {
  buf.writeUInt16LE(val >>> 0, offset);
}
function writeUint32LE(buf: Buffer, offset: number, val: number): void {
  buf.writeUInt32LE(val >>> 0, offset);
}

/**
 * Build a STORE-method ZIP buffer from an array of entries.
 * Each entry is: local file header + raw bytes.
 * Followed by: central directory + end-of-central-directory record.
 */
function buildStoreZip(entries: ZipEntry[]): Buffer {
  const localHeaders: Buffer[] = [];
  const centralDirEntries: Buffer[] = [];
  const offsets: number[] = [];

  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, "utf8");
    const data = entry.data;
    const crc = crc32(data);
    const size = data.length;

    // Local file header (30 bytes + name)
    const lhSize = 30 + nameBytes.length;
    const lh = Buffer.alloc(lhSize, 0);
    writeUint32LE(lh, 0, 0x04034b50); // signature
    writeUint16LE(lh, 4, 20);          // version needed (2.0)
    writeUint16LE(lh, 6, 0);           // general purpose bit flag
    writeUint16LE(lh, 8, 0);           // compression: STORE
    writeUint16LE(lh, 10, 0);          // last mod time
    writeUint16LE(lh, 12, 0);          // last mod date
    writeUint32LE(lh, 14, crc);        // crc-32
    writeUint32LE(lh, 18, size);       // compressed size
    writeUint32LE(lh, 22, size);       // uncompressed size
    writeUint16LE(lh, 26, nameBytes.length); // file name length
    writeUint16LE(lh, 28, 0);          // extra field length
    nameBytes.copy(lh, 30);

    offsets.push(offset);
    localHeaders.push(lh);
    localHeaders.push(Buffer.from(data));
    offset += lhSize + size;

    // Central directory entry (46 bytes + name)
    const cdSize = 46 + nameBytes.length;
    const cd = Buffer.alloc(cdSize, 0);
    writeUint32LE(cd, 0, 0x02014b50); // signature
    writeUint16LE(cd, 4, 20);          // version made by
    writeUint16LE(cd, 6, 20);          // version needed
    writeUint16LE(cd, 8, 0);           // general purpose bit flag
    writeUint16LE(cd, 10, 0);          // compression: STORE
    writeUint16LE(cd, 12, 0);          // last mod time
    writeUint16LE(cd, 14, 0);          // last mod date
    writeUint32LE(cd, 16, crc);        // crc-32
    writeUint32LE(cd, 20, size);       // compressed size
    writeUint32LE(cd, 24, size);       // uncompressed size
    writeUint16LE(cd, 28, nameBytes.length); // file name length
    writeUint16LE(cd, 30, 0);          // extra field length
    writeUint16LE(cd, 32, 0);          // file comment length
    writeUint16LE(cd, 34, 0);          // disk number start
    writeUint16LE(cd, 36, 0);          // internal attributes
    writeUint32LE(cd, 38, 0);          // external attributes
    writeUint32LE(cd, 42, offsets[offsets.length - 1]!); // relative offset of local header
    nameBytes.copy(cd, 46);
    centralDirEntries.push(cd);
  }

  const cdBuf = Buffer.concat(centralDirEntries);
  const cdOffset = offset;
  const cdSize2 = cdBuf.length;

  // End of central directory record (22 bytes)
  const eocd = Buffer.alloc(22, 0);
  writeUint32LE(eocd, 0, 0x06054b50); // signature
  writeUint16LE(eocd, 4, 0);           // disk number
  writeUint16LE(eocd, 6, 0);           // disk with start of cd
  writeUint16LE(eocd, 8, entries.length);  // entries on disk
  writeUint16LE(eocd, 10, entries.length); // total entries
  writeUint32LE(eocd, 12, cdSize2);    // size of central directory
  writeUint32LE(eocd, 16, cdOffset);   // offset of start of cd
  writeUint16LE(eocd, 20, 0);          // comment length

  return Buffer.concat([...localHeaders, cdBuf, eocd]);
}

// ── File walker ───────────────────────────────────────────────────────────────

const EXCLUDED_DIRS = new Set(["node_modules"]);
const EXCLUDED_PATHS = [".print-sync/cache"];

function isExcluded(relPath: string): boolean {
  const parts = relPath.split(path.sep);
  if (parts[0] && EXCLUDED_DIRS.has(parts[0])) return true;
  return EXCLUDED_PATHS.some((p) => relPath.startsWith(p));
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

export const BACKUP_ROOT = "/tmp/print-sync-recovery";

/**
 * Create a /tmp zip backup of the project directory (user files + .git/).
 * Calls ctx.faults?.before("backup_create") then ctx.faults?.before("backup_verify")
 * so tests can inject failures at each step.
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

  const zipDir = path.join(BACKUP_ROOT, slug);
  await mkdir(zipDir, { recursive: true });
  const zipPath = path.join(zipDir, `${ts}-${safeReason}.zip`);

  // Collect all files under the project dir.
  const relPaths: string[] = [];
  await walkDir(ctx.repoDir, ctx.repoDir, relPaths);
  relPaths.sort();

  // Build zip entries.
  const zipEntries: ZipEntry[] = [];
  for (const rel of relPaths) {
    const abs = path.join(ctx.repoDir, rel);
    let data: Buffer;
    try {
      data = await readFile(abs);
    } catch {
      continue; // Skip unreadable files.
    }
    // Forward slashes in zip entry names.
    zipEntries.push({ name: rel.split(path.sep).join("/"), data: new Uint8Array(data) });
  }

  const zipBuf = buildStoreZip(zipEntries);
  await writeFile(zipPath, zipBuf);

  // Verify the zip is readable immediately — read FROM DISK, not from the
  // in-memory buffer, so a truncated or failed disk write is caught here
  // rather than silently passing a self-verify against the in-memory data.
  await ctx.faults?.before("backup_verify");
  await assertZipReadable(zipPath);

  return {
    zipPath,
    createdAt: new Date(now).toISOString(),
    entries: zipEntries.map((e) => e.name),
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
 */
export async function assertZipReadable(zipPath: string): Promise<void> {
  let buf: Buffer;
  try {
    buf = await readFile(zipPath);
  } catch (e) {
    throw new Error(`Backup zip not readable at ${zipPath}: ${e}`);
  }
  const entries = parseZipEntries(buf);
  if (entries.length === 0) {
    // An empty zip is technically valid but suspicious — warn via error.
    throw new Error(`Backup zip appears empty or corrupt at ${zipPath}`);
  }
}

/**
 * Return the list of entries inside a zip file (as ZipEntryInfo objects).
 * Used by tests to assert which files were backed up and inspect content.
 */
export async function zipEntries(zipPath: string): Promise<ZipEntryInfo[]> {
  const buf = await readFile(zipPath);
  return parseZipEntries(buf);
}
