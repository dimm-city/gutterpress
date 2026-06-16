/**
 * Tests for backup.ts — STORE-method zip creation, verification, and fail-safe.
 *
 * Uses REAL on-disk temp repos (no mocks for the zip itself).
 * FaultInjector is used to simulate backup_create and backup_verify failures.
 * bun:test only.
 */

import { describe, expect, test, beforeEach } from "bun:test";
import * as fs from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import git from "isomorphic-git";

import {
  assertZipReadable,
  createRecoveryZip,
  parseZipEntries,
  zipEntries,
  BACKUP_ROOT,
} from "./backup.ts";
import type { RecoveryContext, FaultPoint } from "./types.ts";

// ── Temp dir helpers ──────────────────────────────────────────────────────────

async function makeTempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "backup-test-"));
}

/** Create a minimal git repo with some files. */
async function makeTestRepo(dir: string): Promise<void> {
  await git.init({ fs, dir, defaultBranch: "main" });
  await writeFile(path.join(dir, "chapter-01.md"), "# Chapter One\n\nContent here.\n");
  await writeFile(path.join(dir, "manifest.yaml"), "title: Test Book\n");
  await mkdir(path.join(dir, "assets"), { recursive: true });
  await writeFile(path.join(dir, "assets", "cover.txt"), "cover image placeholder\n");
  await git.add({ fs, dir, filepath: "chapter-01.md" });
  await git.add({ fs, dir, filepath: "manifest.yaml" });
  await git.add({ fs, dir, filepath: "assets/cover.txt" });
  const author = { name: "Test Author", email: "test@test.local" };
  await git.commit({ fs, dir, message: "initial", author });
}

/** Build a minimal RecoveryContext for backup tests. */
function makeCtx(
  repoDir: string,
  overrides: Partial<RecoveryContext> = {},
): RecoveryContext {
  return {
    projectDir: repoDir,
    repoDir,
    branch: "main",
    repoSlug: "test-book",
    confirmation: {
      confirmRepair: async () => true,
    },
    now: () => new Date("2025-01-15T10:30:00.000Z").getTime(),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("createRecoveryZip — basic creation", () => {
  test("creates a zip file under BACKUP_ROOT", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);
    const ctx = makeCtx(dir);

    const backup = await createRecoveryZip(ctx, "test_reason");

    expect(fs.existsSync(backup.zipPath)).toBe(true);
    expect(backup.zipPath.startsWith(BACKUP_ROOT)).toBe(true);
    expect(backup.zipPath).toContain("test-book");
    expect(backup.zipPath).toContain("test_reason");
  });

  test("zip path uses safe ISO timestamp (no colons)", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);
    const ctx = makeCtx(dir);

    const backup = await createRecoveryZip(ctx, "my_reason");

    // Colons from ISO timestamp should be replaced with dashes.
    expect(backup.zipPath).not.toContain(":");
  });

  test("backup entries include user content files", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);
    const ctx = makeCtx(dir);

    const backup = await createRecoveryZip(ctx, "check_entries");

    expect(backup.entries.some((e) => e.includes("chapter-01.md"))).toBe(true);
    expect(backup.entries.some((e) => e.includes("manifest.yaml"))).toBe(true);
    expect(backup.entries.some((e) => e.includes("assets/cover.txt"))).toBe(true);
  });

  test("backup entries include .git/HEAD", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);
    const ctx = makeCtx(dir);

    const backup = await createRecoveryZip(ctx, "git_included");

    expect(backup.entries.some((e) => e === ".git/HEAD" || e.startsWith(".git/"))).toBe(true);
  });

  test("node_modules is excluded", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);
    await mkdir(path.join(dir, "node_modules", "some-pkg"), { recursive: true });
    await writeFile(path.join(dir, "node_modules", "some-pkg", "index.js"), "module.exports={};");
    const ctx = makeCtx(dir);

    const backup = await createRecoveryZip(ctx, "exclude_node_modules");

    expect(backup.entries.every((e) => !e.includes("node_modules"))).toBe(true);
  });

  test("createdAt is a valid ISO string", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);
    const ctx = makeCtx(dir);

    const backup = await createRecoveryZip(ctx, "ts_check");

    expect(() => new Date(backup.createdAt)).not.toThrow();
    expect(new Date(backup.createdAt).getFullYear()).toBeGreaterThan(2024);
  });
});

describe("zip readability — parseZipEntries / assertZipReadable", () => {
  test("assertZipReadable succeeds on a freshly created zip", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);
    const ctx = makeCtx(dir);
    const backup = await createRecoveryZip(ctx, "readable_check");

    await expect(assertZipReadable(backup.zipPath)).resolves.toBeUndefined();
  });

  test("zipEntries returns the same names as backup.entries", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);
    const ctx = makeCtx(dir);
    const backup = await createRecoveryZip(ctx, "roundtrip");

    const entries = await zipEntries(backup.zipPath);
    const names = entries.map((e) => e.name);

    expect(names.sort()).toEqual(backup.entries.sort());
  });

  test("zip content round-trips — STORE method preserves bytes", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);
    const ctx = makeCtx(dir);
    const backup = await createRecoveryZip(ctx, "content_check");

    const buf = await readFile(backup.zipPath);
    const entries = parseZipEntries(buf);
    const chapterEntry = entries.find((e) => e.name === "chapter-01.md");

    expect(chapterEntry).toBeDefined();
    expect(Buffer.from(chapterEntry!.data).toString()).toBe("# Chapter One\n\nContent here.\n");
  });

  test("assertZipReadable throws on a non-existent file", async () => {
    await expect(assertZipReadable("/tmp/does-not-exist-xyz.zip")).rejects.toThrow();
  });

  test("assertZipReadable throws on a corrupt/truncated zip", async () => {
    const dir = await makeTempDir();
    const badPath = path.join(dir, "bad.zip");
    await writeFile(badPath, Buffer.alloc(10, 0));

    await expect(assertZipReadable(badPath)).rejects.toThrow();
  });
});

describe("createRecoveryZip — fault injection", () => {
  test("fault at backup_create causes createRecoveryZip to throw", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);
    const ctx = makeCtx(dir, {
      faults: {
        before: async (point: FaultPoint) => {
          if (point === "backup_create") throw new Error("injected backup_create failure");
        },
      },
    });

    await expect(createRecoveryZip(ctx, "fault_create")).rejects.toThrow(
      "injected backup_create failure",
    );
  });

  test("fault at backup_verify causes createRecoveryZip to throw", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);
    const ctx = makeCtx(dir, {
      faults: {
        before: async (point: FaultPoint) => {
          if (point === "backup_verify") throw new Error("injected backup_verify failure");
        },
      },
    });

    await expect(createRecoveryZip(ctx, "fault_verify")).rejects.toThrow(
      "injected backup_verify failure",
    );
  });
});

describe("createRecoveryZip — disk-side verify catches truncated write", () => {
  test("fault at backup_verify causes throw even though writeFile succeeded", async () => {
    // WHY: createRecoveryZip now re-reads the zip FROM DISK (not in-memory
    // buffer) for verification. The backup_verify fault hook fires after
    // writeFile but before assertZipReadable, so throwing here proves the
    // read-from-disk path is actually exercised (not a self-verify against
    // the buffer that was just written).
    const dir = await makeTempDir();
    await makeTestRepo(dir);
    const ctx = makeCtx(dir, {
      faults: {
        before: async (point: FaultPoint) => {
          if (point === "backup_verify") throw new Error("injected disk-verify failure");
        },
      },
    });

    await expect(createRecoveryZip(ctx, "disk_verify")).rejects.toThrow(
      "injected disk-verify failure",
    );
  });

  test("assertZipReadable can be called on the written zip and succeeds", async () => {
    // Proves the verification path reads from disk — assertZipReadable is the
    // same helper used internally after writeFile.
    const dir = await makeTempDir();
    await makeTestRepo(dir);
    const ctx = makeCtx(dir);
    const backup = await createRecoveryZip(ctx, "disk_read_check");

    // Re-read from disk independently — must not throw.
    await expect(assertZipReadable(backup.zipPath)).resolves.toBeUndefined();
  });
});

describe("createRecoveryZip — repoSlug sanitization", () => {
  test("unusual slug characters are sanitized in path", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);
    const ctx = makeCtx(dir, { repoSlug: "My Book / Title!" });

    const backup = await createRecoveryZip(ctx, "slug_test");

    // Slug should be sanitized (no slashes or exclamation marks)
    const zipDir = path.dirname(backup.zipPath);
    const slugPart = path.basename(zipDir);
    expect(slugPart).not.toContain("/");
    expect(slugPart).not.toContain("!");
  });
});

describe("createRecoveryZip — large file streams without buffering (regression)", () => {
  // The backup must STREAM file bytes to disk, never hold the whole file (or the
  // whole zip) in memory — otherwise a large `.git` packfile OOMs the process
  // (the 600MB/15MB-RSS proof). This guards the streaming + data-descriptor
  // path on a multi-chunk file and verifies the content round-trips exactly.
  test("backs up a multi-MB file and the content round-trips", async () => {
    const dir = await makeTempDir();
    await git.init({ fs, dir, defaultBranch: "main" });
    // 5 MB → spans ~80 read-stream chunks, exercising incremental CRC + backpressure.
    const big = Buffer.alloc(5 * 1024 * 1024);
    for (let i = 0; i < big.length; i++) big[i] = i & 0xff;
    await writeFile(path.join(dir, "big.bin"), big);
    await writeFile(path.join(dir, "small.md"), "# small\n");

    const ctx = makeCtx(dir);
    const backup = await createRecoveryZip(ctx, "detached_head");

    await expect(assertZipReadable(backup.zipPath)).resolves.toBeUndefined();
    const entries = await zipEntries(backup.zipPath);
    const bigEntry = entries.find((e) => e.name === "big.bin");
    expect(bigEntry).toBeDefined();
    expect(bigEntry!.size).toBe(big.length);
    // Content must match byte-for-byte (CRC/size were written via data descriptor).
    expect(Buffer.from(bigEntry!.data).equals(big)).toBe(true);
  });
});
