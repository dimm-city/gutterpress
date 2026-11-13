/**
 * git-read-cache.ts: one cache per repository, shared by reads, started
 * afresh when the pack files change and dropped once the repository has gone
 * IDLE_MS without a read.
 */
import { afterAll, afterEach, beforeAll, describe, expect, jest, test } from "bun:test";
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

afterEach(() => {
  jest.useRealTimers();
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
    jest.useFakeTimers();
    // A cache made under the fake clock.
    await writeFile(path.join(packDir(), "pack-c.pack"), "");
    const kept = await gitReadCache(dir);
    jest.advanceTimersByTime(IDLE_MS - 1_000);
    expect(await gitReadCache(dir)).toBe(kept);
    jest.advanceTimersByTime(IDLE_MS - 1_000);
    expect(await gitReadCache(dir)).toBe(kept);
    jest.advanceTimersByTime(IDLE_MS + 1);
    expect(await gitReadCache(dir)).not.toBe(kept);
  });
});
