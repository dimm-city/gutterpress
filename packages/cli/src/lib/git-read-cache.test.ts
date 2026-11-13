/**
 * git-read-cache.ts: one cache per repository, shared by reads, started
 * afresh when the pack files change and dropped once the repository has gone
 * IDLE_MS without a read.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gitReadCache, IDLE_MS } from "./git-read-cache";

let dir: string;
const packDir = (): string => path.join(dir, ".git", "objects", "pack");

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "gutterpress-read-cache-"));
  await mkdir(packDir(), { recursive: true });
  await writeFile(path.join(packDir(), "pack-a.pack"), "");
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("gitReadCache", () => {
  test("reads of one repository share one cache; another repository has its own", async () => {
    const other = await mkdtemp(path.join(tmpdir(), "gutterpress-read-cache-other-"));
    try {
      const a = await gitReadCache(dir);
      expect(await gitReadCache(dir)).toBe(a);
      expect(await gitReadCache(path.join(dir, "."))).toBe(a);
      expect(await gitReadCache(other)).not.toBe(a);
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });

  test("a new pack (a fetch) or a pack gone (a gc) starts a fresh cache", async () => {
    const before = await gitReadCache(dir);
    await writeFile(path.join(packDir(), "pack-b.pack"), "");
    const added = await gitReadCache(dir);
    expect(added).not.toBe(before);
    expect(await gitReadCache(dir)).toBe(added);
    await rm(path.join(packDir(), "pack-a.pack"));
    expect(await gitReadCache(dir)).not.toBe(added);
  });

  test("dropped once the repository goes IDLE_MS without a read; each read keeps it", async () => {
    // Times are passed in rather than faked: fake timers around the real file
    // reads below timed out in CI under the full suite.
    await writeFile(path.join(packDir(), "pack-c.pack"), "");
    const t = Date.now();
    const kept = await gitReadCache(dir, t);
    expect(await gitReadCache(dir, t + IDLE_MS - 1_000)).toBe(kept);
    expect(await gitReadCache(dir, t + 2 * (IDLE_MS - 1_000))).toBe(kept);
    expect(await gitReadCache(dir, t + 2 * (IDLE_MS - 1_000) + IDLE_MS + 1)).not.toBe(kept);
  });
});
