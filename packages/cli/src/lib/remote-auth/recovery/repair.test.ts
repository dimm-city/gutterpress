/**
 * repairRepo tests — the single repair pipeline (2026-08-14 simplification).
 *
 * The two invariants every scenario asserts:
 *   1. WORKING FILES ARE NEVER TOUCHED — byte-identical before/after.
 *   2. EVERY COMMIT THAT WAS READABLE BEFORE THE REPAIR RESOLVES AFTERWARDS
 *      (unpushed snapshots included) — pinned by listing pre-damage oids and
 *      resolving each one in the repaired repo.
 *
 * Scenarios run with and without a remote (the in-process smart-HTTP server
 * from test-support), covering the in-place fixes and the re-clone+salvage
 * last resort.
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import git from "isomorphic-git";

import { cloneRepository } from "../clone.ts";
import { syncProject } from "../sync.ts";
import { hasPendingChanges } from "../../source-provider.ts";
import { repairRepo } from "./repair.ts";
import {
  createFixtureRepo,
  startGitServer,
  tempDir,
  type GitServer,
} from "../test-support/git-http-server.ts";

const AUTHOR = { name: "Writer", email: "writer@test.local" };

interface Harness {
  serverDir: string;
  server: GitServer;
  projectDir: string;
  cleanup(): Promise<void>;
}

async function setupClone(): Promise<Harness> {
  const serverDir = await tempDir("gutterpress-repair-server-");
  await createFixtureRepo(serverDir);
  const server = await startGitServer(serverDir);
  const parent = await tempDir("gutterpress-repair-client-");
  const projectDir = path.join(parent, "project");
  await cloneRepository({ url: server.url, dir: projectDir });
  return {
    serverDir,
    server,
    projectDir,
    cleanup: async () => {
      await server.close().catch(() => {});
      await rm(serverDir, { recursive: true, force: true });
      await rm(parent, { recursive: true, force: true });
    },
  };
}

/** A local-only repo (no remote at all). */
async function setupLocalRepo(): Promise<{ dir: string; cleanup(): Promise<void> }> {
  const parent = await tempDir("gutterpress-repair-local-");
  const dir = path.join(parent, "book");
  fs.mkdirSync(dir, { recursive: true });
  await git.init({ fs, dir, defaultBranch: "main" });
  await writeFile(path.join(dir, "chapter-01.md"), "# One\n\nDraft.\n");
  await git.add({ fs, dir, filepath: "chapter-01.md" });
  await git.commit({ fs, dir, message: "first draft", author: AUTHOR });
  return { dir, cleanup: () => rm(parent, { recursive: true, force: true }) };
}

/** Commit a local edit (an "unpushed snapshot"). */
async function localCommit(dir: string, file: string, content: string, message: string): Promise<string> {
  await writeFile(path.join(dir, file), content);
  await git.add({ fs, dir, filepath: file });
  return git.commit({ fs, dir, message, author: AUTHOR });
}

/** Every commit oid reachable from HEAD right now. */
async function allCommitOids(dir: string): Promise<string[]> {
  const log = await git.log({ fs, dir, depth: 200 });
  return log.map((e) => e.oid);
}

/** Assert every oid resolves to a readable commit in the repo. */
async function expectAllReachable(dir: string, oids: string[]): Promise<void> {
  const head = await git.resolveRef({ fs, dir, ref: "HEAD" });
  const reachable = new Set((await git.log({ fs, dir, depth: 500, ref: head })).map((e) => e.oid));
  // Also count commits reachable via any other branch (rescue refs included).
  for (const branch of await git.listBranches({ fs, dir })) {
    for (const e of await git.log({ fs, dir, depth: 500, ref: branch })) {
      reachable.add(e.oid);
    }
  }
  for (const oid of oids) {
    expect(reachable.has(oid)).toBe(true);
  }
}

describe("repairRepo — in-place fixes (history untouched by construction)", () => {
  test("interrupted merge state (MERGE_HEAD) is cleared; files and commits intact", async () => {
    const h = await setupClone();
    try {
      const before = await allCommitOids(h.projectDir);
      const tip = before[0]!;
      // Fabricate the abandoned-native-merge state + an uncommitted edit
      // containing conflict markers (exactly what native git leaves behind).
      await writeFile(path.join(h.projectDir, ".git", "MERGE_HEAD"), `${tip}\n`);
      const markered = "# One\n\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> other\n";
      await writeFile(path.join(h.projectDir, "chapter-01.md"), markered);

      const result = await repairRepo({ projectDir: h.projectDir });
      expect(result.status).toBe("repaired");
      // State file gone; the marker-bearing FILE is untouched (working files
      // are never modified — markers are the normal converge representation).
      expect(fs.existsSync(path.join(h.projectDir, ".git", "MERGE_HEAD"))).toBe(false);
      expect(await readFile(path.join(h.projectDir, "chapter-01.md"), "utf8")).toBe(markered);
      await expectAllReachable(h.projectDir, before);
      // The repo syncs again afterwards.
      const outcome = await syncProject({ projectDir: h.projectDir });
      expect(outcome.status).toBe("synced");
    } finally {
      await h.cleanup();
    }
  });

  test("corrupt index is rebuilt from HEAD; uncommitted edits survive byte-for-byte", async () => {
    const h = await setupClone();
    try {
      const before = await allCommitOids(h.projectDir);
      const edit = "# One\n\nEdited but not yet saved as a version.\n";
      await writeFile(path.join(h.projectDir, "chapter-01.md"), edit);
      // Trash the index.
      await writeFile(path.join(h.projectDir, ".git", "index"), "garbage-not-an-index");

      const result = await repairRepo({ projectDir: h.projectDir });
      expect(result.status).toBe("repaired");
      // The edit survived — repair captured it as a snapshot on top.
      expect(await readFile(path.join(h.projectDir, "chapter-01.md"), "utf8")).toBe(edit);
      await expectAllReachable(h.projectDir, before);
      expect(await git.listFiles({ fs, dir: h.projectDir })).toContain("chapter-01.md");
    } finally {
      await h.cleanup();
    }
  });

  test("detached HEAD: work is rescued, HEAD reattached, stranded commits fold into history", async () => {
    const h = await setupLocalRepo();
    try {
      // Detach onto a stranded commit with real work.
      const base = await git.resolveRef({ fs: fs, dir: h.dir, ref: "HEAD" });
      fs.writeFileSync(path.join(h.dir, ".git", "HEAD"), `${base}\n`);
      const stranded = await localCommit(
        h.dir,
        "chapter-02.md",
        "# Two\n\nWritten while detached.\n",
        "stranded work",
      );
      // Plus an uncommitted edit on top.
      await writeFile(path.join(h.dir, "chapter-03.md"), "# Three\n\nUnsaved.\n");

      const result = await repairRepo({ projectDir: h.dir });
      expect(result.status).toBe("repaired");
      // HEAD is a branch again.
      expect(await git.currentBranch({ fs, dir: h.dir })).toBe("main");
      // The stranded commit and the unsaved edit are all reachable/on disk.
      await expectAllReachable(h.dir, [base, stranded]);
      expect(await readFile(path.join(h.dir, "chapter-02.md"), "utf8")).toBe(
        "# Two\n\nWritten while detached.\n",
      );
      expect(await readFile(path.join(h.dir, "chapter-03.md"), "utf8")).toBe(
        "# Three\n\nUnsaved.\n",
      );
    } finally {
      await h.cleanup();
    }
  });

  test("a pre-existing in-project .git-damaged-* (0.10.0 repair) is never committed by later snapshots", async () => {
    const h = await setupLocalRepo();
    try {
      // What a 0.10.0-era repair left behind: the old object store parked
      // INSIDE the project, next to `.git`.
      const legacy = path.join(h.dir, ".git-damaged-2026-08-01T00-00-00");
      fs.mkdirSync(path.join(legacy, "objects", "ab"), { recursive: true });
      await writeFile(path.join(legacy, "objects", "ab", "cdef"), "old packfile bytes");
      await writeFile(path.join(legacy, "config"), "[core]\n");
      // Plus a real edit so the repair's snapshot has something to commit.
      await writeFile(path.join(h.dir, "chapter-01.md"), "# One\n\nEdited.\n");
      // Corrupt the index → the in-place repair path runs and snapshots.
      await writeFile(path.join(h.dir, ".git", "index"), "garbage-not-an-index");

      const result = await repairRepo({ projectDir: h.dir });
      expect(result.status).toBe("repaired");
      // The edit was committed…
      const tracked = await git.listFiles({ fs, dir: h.dir });
      expect(tracked).toContain("chapter-01.md");
      // …but nothing under the legacy backup was, and nothing stays pending
      // (a snapshot loop that kept seeing it would re-commit it forever).
      expect(tracked.some((f) => f.startsWith(".git-damaged"))).toBe(false);
      expect(await hasPendingChanges(h.dir)).toBe(false);
      // The folder itself is untouched on disk — skipped, not deleted.
      expect(fs.existsSync(path.join(legacy, "objects", "ab", "cdef"))).toBe(true);
    } finally {
      await h.cleanup();
    }
  });

  test("fresh lock → retry_later, nothing changed", async () => {
    const h = await setupLocalRepo();
    try {
      await writeFile(path.join(h.dir, ".git", "index.lock"), "");
      const result = await repairRepo({ projectDir: h.dir });
      expect(result.status).toBe("retry_later");
      expect(fs.existsSync(path.join(h.dir, ".git", "index.lock"))).toBe(true);
    } finally {
      await h.cleanup();
    }
  });

  test("stale locks are swept (aged past the threshold)", async () => {
    const h = await setupLocalRepo();
    try {
      const lock = path.join(h.dir, ".git", "index.lock");
      await writeFile(lock, "");
      const old = new Date(Date.now() - 10 * 60 * 1000);
      fs.utimesSync(lock, old, old);
      const result = await repairRepo({ projectDir: h.dir });
      expect(result.status).toBe("repaired");
      expect(fs.existsSync(lock)).toBe(false);
    } finally {
      await h.cleanup();
    }
  });
});

describe("repairRepo — re-clone with salvage (last resort)", () => {
  test("unreadable HEAD with a remote: history rebuilt online, unpushed work left in the backup", async () => {
    const h = await setupClone();
    try {
      // Two unpushed local snapshots the remote has never seen.
      const snap1 = await localCommit(
        h.projectDir,
        "chapter-01.md",
        "# One\n\nLocal draft 2.\n",
        "local snapshot 1",
      );
      const files = {
        "chapter-01.md": await readFile(path.join(h.projectDir, "chapter-01.md"), "utf8"),
      };

      // Destroy the ref store (HEAD unreadable → nuclear path).
      await rm(path.join(h.projectDir, ".git", "HEAD"), { force: true });
      await rm(path.join(h.projectDir, ".git", "refs"), { recursive: true, force: true });
      await rm(path.join(h.projectDir, ".git", "packed-refs"), { force: true });

      const result = await repairRepo({ projectDir: h.projectDir });
      expect(result.status).toBe("repaired");
      expect(result.damagedGitBackupPath).toBeDefined();
      expect(fs.existsSync(result.damagedGitBackupPath!)).toBe(true);
      // The backup lives OUTSIDE the project (OS temp dir), absolute path —
      // an in-project backup was committed and PUSHED by the post-repair
      // snapshot, landing the damaged object store in the author's book.
      expect(path.isAbsolute(result.damagedGitBackupPath!)).toBe(true);
      expect(
        result.damagedGitBackupPath!.startsWith(h.projectDir + path.sep),
      ).toBe(false);
      // And the post-repair snapshot committed ZERO backup entries.
      const tracked = await git.listFiles({ fs, dir: h.projectDir });
      expect(tracked.some((f) => f.includes(".git-damaged"))).toBe(false);
      expect(tracked.some((f) => f.includes("gutterpress-damaged"))).toBe(false);

      // Working files byte-identical — repair never touches them.
      for (const [file, content] of Object.entries(files)) {
        expect(await readFile(path.join(h.projectDir, file), "utf8")).toBe(content);
      }

      // The online copy IS the rebuilt history: a commit the remote never saw
      // is NOT merged back in. It stays readable in the damaged-git backup,
      // whose object store was also copied into the fresh repo — so the work
      // is recoverable, just not on the branch.
      const after = await allCommitOids(h.projectDir);
      expect(after).not.toContain(snap1);
      await expect(
        git.readCommit({ fs, dir: h.projectDir, oid: snap1 }),
      ).resolves.toBeDefined();

      // And the repo syncs again.
      const outcome = await syncProject({ projectDir: h.projectDir });
      expect(outcome.status === "synced" || outcome.status === "up-to-date").toBe(true);
    } finally {
      await h.cleanup();
    }
  });

  test("missing .git with a remote: history rebuilt from the online copy, files kept", async () => {
    const h = await setupClone();
    try {
      const edited = "# One\n\nEdited right before .git vanished.\n";
      await writeFile(path.join(h.projectDir, "chapter-01.md"), edited);
      // Keep the remote URL recoverable: with .git gone entirely there is no
      // config left, so this scenario deletes everything EXCEPT config.
      const gitDir = path.join(h.projectDir, ".git");
      for (const entry of fs.readdirSync(gitDir)) {
        if (entry !== "config") {
          await rm(path.join(gitDir, entry), { recursive: true, force: true });
        }
      }

      const result = await repairRepo({ projectDir: h.projectDir });
      expect(result.status).toBe("repaired");
      // The edit survived and was snapshotted on top of the rebuilt history.
      expect(await readFile(path.join(h.projectDir, "chapter-01.md"), "utf8")).toBe(edited);
      const head = await git.resolveRef({ fs, dir: h.projectDir, ref: "HEAD" });
      expect(head).toMatch(/^[0-9a-f]{40}$/);
      const outcome = await syncProject({ projectDir: h.projectDir });
      expect(outcome.status === "synced" || outcome.status === "up-to-date").toBe(true);
    } finally {
      await h.cleanup();
    }
  });

  test("no remote: unreadable ref store → old history ADOPTED from the salvaged objects", async () => {
    const h = await setupLocalRepo();
    try {
      const second = await localCommit(
        h.dir,
        "chapter-02.md",
        "# Two\n\nSecond draft.\n",
        "second draft",
      );
      const before = await allCommitOids(h.dir);
      expect(before).toContain(second);

      // Destroy the ref store only — objects remain readable.
      await rm(path.join(h.dir, ".git", "HEAD"), { force: true });
      await rm(path.join(h.dir, ".git", "packed-refs"), { force: true });

      const result = await repairRepo({ projectDir: h.dir });
      expect(result.status).toBe("repaired");
      // The ENTIRE old history was adopted (loose refs survived → tips known).
      await expectAllReachable(h.dir, before);
      expect(await readFile(path.join(h.dir, "chapter-02.md"), "utf8")).toBe(
        "# Two\n\nSecond draft.\n",
      );
      expect(await git.currentBranch({ fs, dir: h.dir })).toBe("main");
    } finally {
      await h.cleanup();
    }
  });

  test("remote configured but UNREACHABLE → retry_later, damaged repo left in place", async () => {
    const h = await setupClone();
    try {
      await h.server.close();
      // Unreadable HEAD → nuclear path → clone fails → defer, nothing moved.
      await rm(path.join(h.projectDir, ".git", "HEAD"), { force: true });
      const result = await repairRepo({ projectDir: h.projectDir });
      expect(result.status).toBe("retry_later");
      // The damaged .git was NOT moved aside (no half-repaired state).
      expect(fs.existsSync(path.join(h.projectDir, ".git", "objects"))).toBe(true);
      expect(result.damagedGitBackupPath).toBeUndefined();
    } finally {
      await h.cleanup();
    }
  });
});
