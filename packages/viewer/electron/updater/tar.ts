// ──────────────────────────────────────────────────────────────────────────
// tar.ts — minimal gzip+tar reader for npm package tarballs (main process only)
//
// npm `dist.tarball` is a gzipped USTAR archive whose entries are all prefixed
// with `package/`. We download it as bytes, gunzip with fflate, and walk the
// 512-byte-block tar structure ourselves — no `npm install`, no extraction
// dependency, no shelling out. Only regular files are emitted; every entry path
// is normalised and the `package/` prefix stripped. Path-traversal guarding is
// the caller's job (see extractTarGz), so this module just yields entries.
// ──────────────────────────────────────────────────────────────────────────

import { gunzipSync } from "fflate";

export interface TarEntry {
  /** POSIX path with the leading `package/` prefix stripped (e.g. "dist/index.js"). */
  name: string;
  data: Uint8Array;
}

const BLOCK = 512;

/** Parse a NUL/space-terminated ASCII field from a tar header. */
function readString(buf: Uint8Array, offset: number, length: number): string {
  let end = offset;
  const limit = offset + length;
  while (end < limit && buf[end] !== 0) end++;
  return new TextDecoder("ascii").decode(buf.subarray(offset, end)).trim();
}

/** Parse an octal numeric tar field (size, etc.). Empty → 0. */
function readOctal(buf: Uint8Array, offset: number, length: number): number {
  const s = readString(buf, offset, length).replace(/[^0-7]/g, "");
  return s ? parseInt(s, 8) : 0;
}

/**
 * Walk a (decompressed) tar buffer and yield every regular-file entry with its
 * `package/` prefix removed. USTAR long-name (`L`)/pax extended headers are not
 * produced by `npm pack`, so the standard 100-byte name + `prefix` field cover
 * every real entry; unknown type flags are skipped.
 */
export function untar(tarBytes: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;
  while (offset + BLOCK <= tarBytes.length) {
    const header = tarBytes.subarray(offset, offset + BLOCK);
    // Two consecutive zero blocks mark end-of-archive; a single all-zero header
    // is enough to stop (npm pads the tail with zeros).
    if (header.every((b) => b === 0)) break;

    const name = readString(header, 0, 100);
    const size = readOctal(header, 124, 12);
    const typeFlag = String.fromCharCode(header[156] ?? 0);
    const prefix = readString(header, 345, 155);
    const fullName = prefix ? `${prefix}/${name}` : name;

    const dataStart = offset + BLOCK;
    // "0"/"\0" = regular file; everything else (dirs '5', links, pax 'x'/'g',
    // gnu 'L') is skipped — npm tarballs contain only files + implicit dirs.
    if ((typeFlag === "0" || typeFlag === "\0") && fullName) {
      const stripped = fullName.replace(/^package\//, "");
      if (stripped) {
        entries.push({
          name: stripped,
          data: tarBytes.subarray(dataStart, dataStart + size),
        });
      }
    }

    // Advance past the data, rounded up to the next 512-byte boundary.
    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK;
  }
  return entries;
}

/** Gunzip a `.tgz` buffer then parse the tar. */
export function readTarGz(tgzBytes: Uint8Array): TarEntry[] {
  return untar(gunzipSync(tgzBytes));
}
