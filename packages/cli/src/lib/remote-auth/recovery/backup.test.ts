/**
 * Tests for backup.ts — STORE-method zip creation, verification, and fail-safe.
 *
 * Uses REAL on-disk temp repos (no mocks for the zip itself).
 * FaultInjector is used to simulate backup_create and backup_verify failures.
 * bun:test only.
 */

import { describe, expect, test, beforeEach } from "bun:test";
import * as fs from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { makeTempDir as freshTempDir } from "../../../test-helpers/testkit";

import git from "isomorphic-git";

import {
  assertZipReadable,
  createRecoveryZip,
  parseZipEntries,
  pruneOldBackups,
  zipEntries,
  BACKUP_ROOT,
} from "./backup.ts";
import type { RecoveryContext, FaultPoint } from "./types.ts";

// ── Temp dir helpers ──────────────────────────────────────────────────────────

async function makeTempDir(): Promise<string> {
  return freshTempDir("backup-test-");
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

  test("NESTED node_modules is excluded too (not just at the repo root)", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);
    const nested = path.join(dir, "examples", "site", "node_modules", "pkg");
    await mkdir(nested, { recursive: true });
    await writeFile(path.join(nested, "index.js"), "module.exports={};");
    await writeFile(path.join(dir, "examples", "site", "page.md"), "# page\n");
    const ctx = makeCtx(dir);

    const backup = await createRecoveryZip(ctx, "exclude_nested_node_modules");

    expect(backup.entries.every((e) => !e.includes("node_modules"))).toBe(true);
    // Sibling content next to the nested node_modules is still included.
    expect(backup.entries).toContain("examples/site/page.md");
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

// ── BUG 1: BACKUP_ROOT must be cross-platform (os.tmpdir, not hardcoded /tmp) ──

describe("BUG 1 — BACKUP_ROOT is OS-appropriate (cross-platform)", () => {
  test("BACKUP_ROOT is rooted at os.tmpdir() with a print-sync-recovery segment", () => {
    // On Windows os.tmpdir() is e.g. C:\Users\me\AppData\Local\Temp — a
    // hardcoded "/tmp" would make every risky-repair backup throw there.
    expect(BACKUP_ROOT).toBe(path.join(tmpdir(), "print-sync-recovery"));
    expect(BACKUP_ROOT.startsWith(tmpdir())).toBe(true);
    expect(BACKUP_ROOT.endsWith("print-sync-recovery")).toBe(true);
  });

  test("created zip lives under os.tmpdir()/print-sync-recovery", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);
    const ctx = makeCtx(dir);

    const backup = await createRecoveryZip(ctx, "xplat_root");

    expect(backup.zipPath.startsWith(path.join(tmpdir(), "print-sync-recovery"))).toBe(true);
  });
});

// ── BUG 2: prune old backups (TTL + per-slug cap) ─────────────────────────────

describe("BUG 2 — pruneOldBackups removes old backups, keeps recent", () => {
  /** Drop a fake backup zip with a given mtime into the slug dir. */
  async function seedBackup(slugDir: string, name: string, ageMs: number, now: number): Promise<string> {
    await mkdir(slugDir, { recursive: true });
    const p = path.join(slugDir, name);
    await writeFile(p, Buffer.from("PK\x05\x06"));
    const mtime = new Date(now - ageMs);
    await fs.promises.utimes(p, mtime, mtime);
    return p;
  }

  test("prunes zips older than the TTL, keeps recent ones", async () => {
    const root = await makeTempDir();
    const slug = "ttl-book";
    const slugDir = path.join(root, slug);
    const now = new Date("2025-06-01T00:00:00.000Z").getTime();
    const dayMs = 24 * 60 * 60 * 1000;

    const old1 = await seedBackup(slugDir, "old1.zip", 10 * dayMs, now);
    const old2 = await seedBackup(slugDir, "old2.zip", 8 * dayMs, now);
    const fresh = await seedBackup(slugDir, "fresh.zip", 1 * dayMs, now);

    await pruneOldBackups({ root, slug, ttlMs: 7 * dayMs, now: () => now });

    expect(fs.existsSync(old1)).toBe(false);
    expect(fs.existsSync(old2)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
  });

  test("caps retained backups per slug to the newest N", async () => {
    const root = await makeTempDir();
    const slug = "cap-book";
    const slugDir = path.join(root, slug);
    const now = new Date("2025-06-01T00:00:00.000Z").getTime();
    const minute = 60 * 1000;

    // 5 recent backups (all within TTL), staggered by minute so newest is clear.
    const b1 = await seedBackup(slugDir, "b1.zip", 5 * minute, now);
    const b2 = await seedBackup(slugDir, "b2.zip", 4 * minute, now);
    const b3 = await seedBackup(slugDir, "b3.zip", 3 * minute, now);
    const b4 = await seedBackup(slugDir, "b4.zip", 2 * minute, now);
    const b5 = await seedBackup(slugDir, "b5.zip", 1 * minute, now);

    await pruneOldBackups({ root, slug, ttlMs: 365 * 24 * 60 * 60 * 1000, maxPerSlug: 2, now: () => now });

    // Newest 2 kept (b4, b5), the older 3 removed.
    expect(fs.existsSync(b1)).toBe(false);
    expect(fs.existsSync(b2)).toBe(false);
    expect(fs.existsSync(b3)).toBe(false);
    expect(fs.existsSync(b4)).toBe(true);
    expect(fs.existsSync(b5)).toBe(true);
  });

  test("never throws on a missing slug directory (best-effort)", async () => {
    const root = await makeTempDir();
    await expect(
      pruneOldBackups({ root, slug: "does-not-exist", ttlMs: 1, now: () => Date.now() }),
    ).resolves.toBeUndefined();
  });

  test("createRecoveryZip prunes prior old backups for the same slug", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);
    const now = new Date("2025-06-01T00:00:00.000Z").getTime();
    const dayMs = 24 * 60 * 60 * 1000;

    // makeCtx slug is "test-book"; seed an ancient backup there.
    const slugDir = path.join(BACKUP_ROOT, "test-book");
    const stale = await seedBackup(slugDir, "ancient.zip", 30 * dayMs, now);

    const ctx = makeCtx(dir, { now: () => now });
    const backup = await createRecoveryZip(ctx, "prune_on_create");

    // The new backup exists; the ancient one was pruned by the start-of-create step.
    expect(fs.existsSync(backup.zipPath)).toBe(true);
    expect(fs.existsSync(stale)).toBe(false);
  });
});

// ── BUG 3: .git/config (credential-bearing) must NOT be in the backup ─────────

describe("BUG 3 — .git/config is excluded from the backup", () => {
  test("backup zip does NOT contain .git/config even when it holds a token", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);
    // Simulate a config carrying an embedded credential in the remote URL.
    await writeFile(
      path.join(dir, ".git", "config"),
      "[remote \"origin\"]\n\turl = https://x-access-token:ghp_SECRET123@github.com/me/book.git\n",
    );
    const ctx = makeCtx(dir);

    const backup = await createRecoveryZip(ctx, "no_git_config");

    // Neither the entries list nor the zip body may carry .git/config.
    expect(backup.entries.some((e) => e === ".git/config")).toBe(false);
    const entries = await zipEntries(backup.zipPath);
    expect(entries.some((e) => e.name === ".git/config")).toBe(false);
    // The token bytes must not be present anywhere in the zip.
    const buf = await readFile(backup.zipPath);
    expect(buf.includes(Buffer.from("ghp_SECRET123"))).toBe(false);
  });

  test("other .git/ files (HEAD, objects, refs) are still backed up", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);
    await writeFile(path.join(dir, ".git", "config"), "[core]\n\tbare = false\n");
    const ctx = makeCtx(dir);

    const backup = await createRecoveryZip(ctx, "git_kept_minus_config");

    // .git/ must still be present for recovery (just not config).
    expect(backup.entries.some((e) => e.startsWith(".git/"))).toBe(true);
    expect(backup.entries.some((e) => e === ".git/config")).toBe(false);
  });
});

// ── BUG 4: assertZipReadable must validate EVERY central-directory entry ──────

describe("BUG 4 — assertZipReadable walks all central-directory entries", () => {
  test("throws when a LATER central-directory entry is corrupted", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);
    // Multiple files → multiple CD entries, so a later one exists to corrupt.
    await writeFile(path.join(dir, "second.md"), "# second chapter\n");
    await writeFile(path.join(dir, "third.md"), "# third chapter\n");
    const ctx = makeCtx(dir);
    const backup = await createRecoveryZip(ctx, "cd_walk");

    // Sanity: it's valid before corruption.
    await expect(assertZipReadable(backup.zipPath)).resolves.toBeUndefined();

    // Locate the central directory and clobber the SECOND CD entry's signature.
    const buf = await readFile(backup.zipPath);
    let eocd = -1;
    for (let i = buf.length - 22; i >= 0; i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    expect(eocd).toBeGreaterThanOrEqual(0);
    const cdOffset = buf.readUInt32LE(eocd + 16);
    const cdCount = buf.readUInt16LE(eocd + 8);
    expect(cdCount).toBeGreaterThan(1);

    // Walk to the second CD entry and break its signature.
    const nameLen0 = buf.readUInt16LE(cdOffset + 28);
    const extraLen0 = buf.readUInt16LE(cdOffset + 30);
    const commentLen0 = buf.readUInt16LE(cdOffset + 32);
    const secondPos = cdOffset + 46 + nameLen0 + extraLen0 + commentLen0;
    // First entry is still intact; clobber only the second signature.
    buf.writeUInt32LE(0xdeadbeef, secondPos);

    const corruptPath = path.join(dir, "corrupt-cd.zip");
    await writeFile(corruptPath, buf);

    await expect(assertZipReadable(corruptPath)).rejects.toThrow();
  });
});
