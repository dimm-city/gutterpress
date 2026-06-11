import { test, expect } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  getRepoCache,
  invalidateRepoCache,
  REPO_CACHE_MAX_REPOS,
  repoCacheSize,
} from "./git-cache";
import { detectProjectSource } from "./project-source";
import { providerFor, hasPendingChanges } from "./source-provider";

async function tempDir(): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), "pmd-gitcache-"));
}

test("getRepoCache returns the SAME object per repo root (path-normalized)", () => {
  const a = getRepoCache("/tmp/pmd-cache-x");
  expect(getRepoCache("/tmp/pmd-cache-x")).toBe(a);
  expect(getRepoCache("/tmp/pmd-cache-x/../pmd-cache-x")).toBe(a);
  expect(getRepoCache("/tmp/pmd-cache-y")).not.toBe(a);
  invalidateRepoCache("/tmp/pmd-cache-x");
  invalidateRepoCache("/tmp/pmd-cache-y");
});

test("invalidateRepoCache drops the cached object (a fresh one is handed out)", () => {
  const a = getRepoCache("/tmp/pmd-cache-z");
  invalidateRepoCache("/tmp/pmd-cache-z");
  expect(getRepoCache("/tmp/pmd-cache-z")).not.toBe(a);
  invalidateRepoCache("/tmp/pmd-cache-z");
});

test("repo cache map is capped (LRU evicts the oldest-used repo)", () => {
  const roots = Array.from(
    { length: REPO_CACHE_MAX_REPOS + 2 },
    (_, i) => `/tmp/pmd-cache-lru-${i}`,
  );
  const first = getRepoCache(roots[0]!);
  for (const root of roots.slice(1)) getRepoCache(root);
  expect(repoCacheSize()).toBeLessThanOrEqual(REPO_CACHE_MAX_REPOS);
  // Root 0 was the least recently used → evicted → a fresh object now.
  expect(getRepoCache(roots[0]!)).not.toBe(first);
  for (const root of roots) invalidateRepoCache(root);
});

test("warm cache stays CORRECT across snapshot → edit → status → restore", async () => {
  // The per-repo cache is reused across operations; this guards isomorphic-
  // git's self-invalidation (index stats compare) end-to-end: every read
  // below must observe the latest writes even though the cache is warm.
  const dir = await tempDir();
  try {
    await writeFile(path.join(dir, "chapter-01.md"), "# Hello\n\nFirst.\n");
    const plain = providerFor({ type: "local-folder", path: dir });
    await plain.initVersionHistory({ projectDir: dir, initialMessage: "Initial" });
    const provider = providerFor(await detectProjectSource(dir));

    // Clean tree reads clean through the warm cache.
    expect(await hasPendingChanges(dir)).toBe(false);

    // An on-disk edit is visible immediately (no stale status).
    await writeFile(path.join(dir, "chapter-01.md"), "# Hello\n\nSecond.\n");
    expect(await hasPendingChanges(dir)).toBe(true);

    const snap = await provider.snapshot({ projectDir: dir, message: "Second" });
    expect(await hasPendingChanges(dir)).toBe(false);

    // History read through the same warm cache sees the new commit.
    const history = await provider.listHistory(dir);
    expect(history.map((e) => e.message)).toEqual(["Second", "Initial"]);
    expect(history[0]!.id).toBe(snap.id);

    // An index written by a DIFFERENT cache (external-process stand-in) is
    // picked up by the warm cache (stat-compare self-invalidation).
    const git = (await import("isomorphic-git")).default;
    const fsMod = await import("node:fs");
    await writeFile(path.join(dir, "chapter-02.md"), "# Two\n");
    await git.add({ fs: fsMod, dir, filepath: "chapter-02.md", cache: {} });
    await git.commit({
      fs: fsMod,
      dir,
      cache: {},
      message: "External commit",
      author: { name: "ext", email: "ext@example.com" },
    });
    expect(await hasPendingChanges(dir)).toBe(false);
    const after = await provider.listHistory(dir);
    expect(after[0]!.message).toBe("External commit");
  } finally {
    invalidateRepoCache(dir);
    await rm(dir, { recursive: true, force: true });
  }
});
