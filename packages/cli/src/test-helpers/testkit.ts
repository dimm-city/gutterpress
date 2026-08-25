/**
 * Shared CLI test-scaffolding kit.
 *
 * TEST-ONLY. This module is imported exclusively by `*.test.ts` files — it is
 * never referenced by production entrypoints (`src/index.ts`, `src/cli.ts`),
 * so it never lands in the `bun build`/`bun build --compile` output. It exists
 * to kill the copy-pasted scaffolding that used to live inline in dozens of
 * test files (`makeTempDir` ~13×, `makeCtx` ~2× for the CheckContext shape,
 * plus the isomorphic-git repo builders).
 *
 * Where copies differed meaningfully, the canonical helper keeps every
 * behavior via options rather than silently picking one — callers pass the
 * exact prefix/author/content they relied on.
 */

import { spawnSync } from "node:child_process";
import { deflateSync } from "node:zlib";
import * as nodeFs from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { spyOn } from "bun:test";
import git from "isomorphic-git";
import type { FsClient } from "isomorphic-git";

import { resolveConfig } from "../lib/manifest";
import type { CheckContext } from "../checks/types";

// ---------------------------------------------------------------------------
// Temp dirs
// ---------------------------------------------------------------------------

/**
 * Create a fresh, unique temp directory under `os.tmpdir()`.
 *
 * The `prefix` is purely a human-readable naming segment for the OS-assigned
 * unique dir (handy when eyeballing leftover fixtures); callers that relied on
 * a suite-specific prefix pass it through so behavior is byte-identical.
 */
export async function makeTempDir(prefix = "gutterpress-test-"): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

// ---------------------------------------------------------------------------
// CheckContext builder
// ---------------------------------------------------------------------------

/**
 * Build a {@link CheckContext} for check/policy unit tests, filling the
 * required fields with defaults and shallow-merging a partial override
 * (last-write-wins), matching the copies that lived in
 * `checks.test.ts` / `policy.test.ts`.
 */
export function makeCtx(partial: Partial<CheckContext> = {}): CheckContext {
  return {
    config: resolveConfig({}, {} as never),
    inputDir: "/tmp/test-input",
    outputDir: "/tmp/test-output",
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// isomorphic-git repo builders
// ---------------------------------------------------------------------------

export interface TestAuthor {
  name: string;
  email: string;
}

/** The author most recovery-test copies used. */
export const DEFAULT_TEST_AUTHOR: TestAuthor = {
  name: "Test Author",
  email: "test@test.local",
};

const DEFAULT_FS = nodeFs as unknown as FsClient;

export interface InitRepoOptions {
  branch?: string;
  content?: string;
  message?: string;
  author?: TestAuthor;
  fs?: FsClient;
}

/**
 * Initialize a git repo with a single committed `chapter-01.md` and return the
 * initial commit oid. Every varying bit (branch, file content, commit message,
 * author, fs impl) is an option so the previously-bespoke copies map onto it
 * without changing behavior.
 */
export async function initRepo(
  dir: string,
  opts: InitRepoOptions = {},
): Promise<string> {
  const fs = opts.fs ?? DEFAULT_FS;
  await git.init({ fs, dir, defaultBranch: opts.branch ?? "main" });
  await writeFile(
    path.join(dir, "chapter-01.md"),
    opts.content ?? "# Chapter One\n\nInitial content.\n",
  );
  await git.add({ fs, dir, filepath: "chapter-01.md" });
  return git.commit({
    fs,
    dir,
    message: opts.message ?? "initial commit",
    author: opts.author ?? DEFAULT_TEST_AUTHOR,
  });
}

/**
 * Like {@link initRepo} but defaults to the `"initial"` commit message the
 * `makeTestRepo` copies used. Always on `main`. Returns the commit oid.
 */
export async function makeTestRepo(
  dir: string,
  opts: Omit<InitRepoOptions, "branch"> = {},
): Promise<string> {
  return initRepo(dir, {
    branch: "main",
    content: opts.content ?? "# Chapter One\n\nContent.\n",
    message: opts.message ?? "initial",
    author: opts.author,
    fs: opts.fs,
  });
}

export interface CommitFileOptions {
  message?: string;
  author?: TestAuthor;
  fs?: FsClient;
}

/**
 * Write `body` to `filename` inside an existing repo, stage it and commit.
 * Defaults the message to `add <filename>` (the copies' convention). Returns
 * the commit oid.
 */
export async function commitFile(
  dir: string,
  filename: string,
  body: string,
  opts: CommitFileOptions = {},
): Promise<string> {
  const fs = opts.fs ?? DEFAULT_FS;
  await writeFile(path.join(dir, filename), body);
  await git.add({ fs, dir, filepath: filename });
  return git.commit({
    fs,
    dir,
    message: opts.message ?? `add ${filename}`,
    author: opts.author ?? DEFAULT_TEST_AUTHOR,
  });
}

// ---------------------------------------------------------------------------
// process.exit stubbing (command-level citty dispatch tests)
// ---------------------------------------------------------------------------

/**
 * Thrown by {@link stubProcessExit}'s stub instead of actually terminating
 * the test worker. Carries the exit code so `expect(...).rejects.toThrow(...)`
 * can assert on it directly.
 */
export class ProcessExitSignal extends Error {
  code: number;
  constructor(code: number) {
    super(`process.exit(${code})`);
    this.name = "ProcessExitSignal";
    this.code = code;
  }
}

/**
 * Replace `process.exit` with a stub that THROWS a {@link ProcessExitSignal}
 * instead of ending the process — mirroring real `process.exit()` semantics
 * (nothing after the call site ever runs) while staying observable in tests.
 * Command handlers routinely do `log.error(...); process.exit(code);` with no
 * `return` after — without this, a naive no-op stub would fall through into
 * whatever code follows and throw on unrelated undefined state.
 *
 * Callers MUST `mockRestore()` the returned spy (e.g. in `afterEach`) —
 * `process` is a shared global across the whole test run, exactly like the
 * `spyOn`/`mockRestore` discipline documented in
 * `build-runner.browser-lifecycle.test.ts`.
 */
export function stubProcessExit(): ReturnType<typeof spyOn<typeof process, "exit">> {
  return spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new ProcessExitSignal(code ?? 0);
  }) as unknown as typeof process.exit);
}

// ---------------------------------------------------------------------------
// Raster measurement (page-background tests)
// ---------------------------------------------------------------------------

/**
 * "Did this declaration paint anything?" is not answerable from a PDF's
 * structure — Chromium fetches an unreferenced `@page` background image and
 * then paints nothing, with no error and no missing object
 * (docs/known-limitations.md §3, #152). The only honest answer is pixels, so
 * these helpers rasterize page 1 and diff it against a control.
 *
 * Ghostscript rather than poppler's `pdftoppm`: `gs` is what CI installs, and
 * one rasterizer keeps the two page-background suites measuring the same way.
 */
export interface GrayRaster {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Ghostscript's path, or `null`. Callers self-skip, as the PDF/X suites do. */
export async function resolveRasterizer(): Promise<string | null> {
  const { resolveGhostscript } = await import("../lib/ghostscript");
  return (await resolveGhostscript()) ?? null;
}

/** Page 1 of `pdfPath` as an 8-bit grayscale raster at 100 dpi. */
export function rasterizePdfPage(gsBin: string, pdfPath: string, outDir: string, tag: string): GrayRaster {
  const out = path.join(outDir, `${tag}.pgm`);
  nodeFs.rmSync(out, { force: true });
  const res = spawnSync(
    gsBin,
    ["-q", "-dNOPAUSE", "-dBATCH", "-dSAFER", "-sDEVICE=pgmraw", "-r100",
     "-dFirstPage=1", "-dLastPage=1", `-sOutputFile=${out}`, pdfPath],
    { encoding: "utf-8" },
  );
  if (res.status !== 0) throw new Error(`ghostscript failed: ${res.stderr || res.status}`);
  return parsePgm(nodeFs.readFileSync(out));
}

/** Binary PGM (P5) reader — no image library, exactly the header grammar. */
function parsePgm(buf: Buffer): GrayRaster {
  let pos = 0;
  const token = (): string => {
    while (pos < buf.length) {
      const c = buf[pos]!;
      if (c === 0x23) {
        while (pos < buf.length && buf[pos] !== 0x0a) pos++;
        continue;
      }
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) {
        pos++;
        continue;
      }
      break;
    }
    const start = pos;
    while (pos < buf.length && ![0x20, 0x09, 0x0a, 0x0d].includes(buf[pos]!)) pos++;
    return buf.toString("latin1", start, pos);
  };
  if (token() !== "P5") throw new Error("not a binary PGM");
  const width = Number(token());
  const height = Number(token());
  token(); // maxval
  pos++; // the single whitespace byte before the raster
  return { width, height, data: buf.subarray(pos, pos + width * height) };
}

/**
 * Mean absolute per-pixel difference. `0` means the two prints are identical —
 * i.e. the declaration under test changed nothing at all.
 */
export function meanAbsDiff(a: GrayRaster, b: GrayRaster): number {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`raster size mismatch: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
  let sum = 0;
  for (let i = 0; i < a.data.length; i++) sum += Math.abs(a.data[i]! - b.data[i]!);
  return sum / a.data.length;
}

/**
 * A minimal RGB PNG encoder, so page-background fixtures can generate the
 * exact image they need — a solid tile that is unmistakable when it paints, or
 * an incompressible one that is genuinely large — instead of carrying opaque
 * base64 blobs whose size and contrast nobody can check by reading them.
 */
export function pngRgb(
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number],
): Buffer {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  const crc32 = (b: Buffer): number => {
    let c = -1;
    for (let i = 0; i < b.length; i++) c = table[(c ^ b[i]!) & 0xff]! ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const raw = Buffer.alloc(height * (1 + width * 3));
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
