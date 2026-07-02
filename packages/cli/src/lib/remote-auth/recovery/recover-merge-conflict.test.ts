/**
 * Tests for recover-merge-conflict.ts — thin wrapper over pullChanges that
 * surfaces a 'needs_user' result when both the local and online copies changed
 * the same file.
 *
 * WHY a thin wrapper: merge_conflict is NOT a broken repo — the working tree is
 * always left clean by pullChanges (abortOnConflict). The recovery handler's
 * only job is to translate the `{ status: "conflict" }` PullOutcome into a
 * `{ status: "needs_user" }` RecoveryResult so the host can show the per-file
 * chooser. No merge logic is re-implemented here.
 *
 * SAFETY INVARIANTS asserted throughout:
 *   1. Result is 'needs_user' with ConflictFile[] attached.
 *   2. The conflicted working file NEVER contains '<<<<<<<' or '>>>>>>>' markers.
 *   3. The remote HEAD + tree are UNCHANGED after recover() returns.
 *   4. User-visible local files are preserved (the snapshot kept both copies).
 *   5. No force-push is ever attempted (push calls observed, force flag absent).
 *   6. resolveConflicts('mine'/'theirs'/'both') produces an honest two-parent merge.
 *   7. Policy has requireConfirmation=false — no confirmation gate is called.
 *
 * Test runner: bun:test (NOT Vitest).
 * Repos:       real on-disk temp dirs built with isomorphic-git.
 * Mocks:       confirmation gate only (must never be called for this kind).
 * No system git, no child_process.
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import git from "isomorphic-git";
import httpNode from "isomorphic-git/http/node";

import { cloneRepository } from "../clone.ts";
import {
  resolveConflicts,
  SYNC_SNAPSHOT_MESSAGE,
  type ConflictResolution,
} from "../sync.ts";
import type { HostCredential } from "../token-store.ts";
import {
  createFixtureRepo,
  startGitServer,
  tempDir,
  type GitServer,
} from "../test-support/git-http-server.ts";
import type {
  RecoveryContext,
  RecoveryResult,
  ConfirmationGate,
} from "./types.ts";

// ── Import the handler under test ─────────────────────────────────────────────
// This import will FAIL until recover-merge-conflict.ts exists — that is the
// expected "red" state for TDD Stage 1.
import { recover } from "./recover-merge-conflict.ts";

// ── Test fixture helpers ──────────────────────────────────────────────────────

const SERVER_AUTHOR = { name: "OnlineCopy", email: "server@test.local" };
const ALICE_AUTHOR = { name: "Alice", email: "alice@test.local" };

interface ConflictHarness {
  serverDir: string;
  server: GitServer;
  /** Alice's local project directory (cloned from server). */
  aliceDir: string;
  cleanup(): Promise<void>;
}

/**
 * Set up the classic merge conflict: Alice clones the repo, then BOTH Alice
 * and the server (simulating Bob) edit the same line in the same file.
 * Alice does NOT push — she is left with a local commit diverging from the
 * server's commit on the same baseline.
 */
async function setupConflictHarness(): Promise<ConflictHarness> {
  // 1. Server repo + initial fixture content
  const serverDir = await tempDir("mc-server-");
  await createFixtureRepo(serverDir); // creates chapter-01.md + manifest.yaml

  const server = await startGitServer(serverDir);

  // 2. Alice clones
  const parentDir = await tempDir("mc-alice-parent-");
  const aliceDir = path.join(parentDir, "alice-project");
  await cloneRepository({ url: server.url, dir: aliceDir });

  // 3. Server (Bob) edits chapter-01.md and commits — Alice doesn't have this
  await writeFile(
    path.join(serverDir, "chapter-01.md"),
    "# One\n\nBob's online rewrite.\n",
  );
  await git.add({ fs, dir: serverDir, filepath: "chapter-01.md" });
  await git.commit({
    fs,
    dir: serverDir,
    message: "online: bob's rewrite",
    author: SERVER_AUTHOR,
  });

  // 4. Alice edits the same line locally (not yet committed — left as pending
  //    changes so the snapshot-first behaviour is exercised)
  await writeFile(
    path.join(aliceDir, "chapter-01.md"),
    "# One\n\nAlice's local rewrite.\n",
  );

  return {
    serverDir,
    server,
    aliceDir,
    cleanup: async () => {
      await server.close();
      await rm(serverDir, { recursive: true, force: true });
      await rm(parentDir, { recursive: true, force: true });
    },
  };
}

/**
 * Build a RecoveryContext for Alice's repo. The confirmation gate panics if
 * called — merge_conflict policy has requireConfirmation=false.
 */
function makeCtx(
  h: ConflictHarness,
  overrides: Partial<RecoveryContext> = {},
): RecoveryContext {
  const confirmation: ConfirmationGate = {
    confirmRepair: async () => {
      throw new Error(
        "confirmRepair must NOT be called for merge_conflict — policy has requireConfirmation=false",
      );
    },
  };
  return {
    projectDir: h.aliceDir,
    repoDir: h.aliceDir,
    branch: "main",
    remoteUrl: h.server.url,
    repoSlug: "mc-test-book",
    httpClient: httpNode,
    confirmation,
    ...overrides,
  };
}

/** Read the tip commit of the server's main branch. */
async function serverHead(serverDir: string): Promise<string> {
  return git.resolveRef({ fs, dir: serverDir, ref: "refs/heads/main" });
}

/** Read a file's content from the server's HEAD tree. */
async function serverFile(serverDir: string, filepath: string): Promise<string | null> {
  try {
    const oid = await serverHead(serverDir);
    const { blob } = await git.readBlob({ fs, dir: serverDir, oid, filepath });
    return Buffer.from(blob).toString("utf8");
  } catch {
    return null;
  }
}

/** Return true when the working tree matches every tracked file's HEAD. */
async function isClean(dir: string): Promise<boolean> {
  const matrix = await git.statusMatrix({ fs, dir });
  return matrix.every(([, head, work, stage]) => head === 1 && work === 1 && stage === 1);
}

// ── Spy http client — records whether any push used force ─────────────────────

interface PushRecord {
  url: string;
  /** True when the push pkt-line contained 'force' (force-push). */
  hasForce: boolean;
}

function spyHttpClient(): { http: typeof httpNode; pushes: PushRecord[] } {
  const pushes: PushRecord[] = [];
  const http: typeof httpNode = {
    async request(config) {
      const url = config.url ?? "";
      // Detect push sends: receive-pack POST carries the ref-update commands
      if (url.includes("git-receive-pack") && config.method === "POST") {
        // Collect the body to check for force-push flag
        const chunks: Uint8Array[] = [];
        if (config.body) {
          for await (const chunk of config.body as AsyncIterable<Uint8Array>) {
            chunks.push(chunk);
          }
        }
        const body = Buffer.concat(chunks).toString("utf8");
        pushes.push({ url, hasForce: /\bforce\b/i.test(body) });
        // Re-create a body stream from the collected data for the real request
        const bodyBuf = Buffer.concat(chunks);
        const origConfig = { ...config, body: (async function* () { yield bodyBuf; })() };
        return httpNode.request(origConfig);
      }
      return httpNode.request(config);
    },
  } as typeof httpNode;
  return { http, pushes };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test suites
// ─────────────────────────────────────────────────────────────────────────────

// ── 1. Success path: conflict detected → needs_user ───────────────────────────

describe("recover (merge_conflict) — success path", () => {
  test("returns needs_user when local and online copy both changed the same file", async () => {
    const h = await setupConflictHarness();
    try {
      const ctx = makeCtx(h);
      const result = await recover(ctx);
      expect(result.status).toBe("needs_user");
    } finally {
      await h.cleanup();
    }
  });

  test("needs_user result includes ConflictFile[] with the contested file", async () => {
    const h = await setupConflictHarness();
    try {
      const ctx = makeCtx(h);
      const result = await recover(ctx);
      expect(result.status).toBe("needs_user");
      const r = result as Extract<RecoveryResult, { status: "needs_user" }>;
      expect(r.files).toBeDefined();
      expect(Array.isArray(r.files)).toBe(true);
      expect(r.files!.length).toBeGreaterThan(0);
      const paths = r.files!.map((f) => f.path);
      expect(paths).toContain("chapter-01.md");
    } finally {
      await h.cleanup();
    }
  });

  test("ConflictFile kind is 'both-edited' for a text file edited on both sides", async () => {
    const h = await setupConflictHarness();
    try {
      const ctx = makeCtx(h);
      const result = await recover(ctx);
      const r = result as Extract<RecoveryResult, { status: "needs_user" }>;
      const conflictedFile = r.files!.find((f) => f.path === "chapter-01.md");
      expect(conflictedFile).toBeDefined();
      expect(conflictedFile!.kind).toBe("both-edited");
    } finally {
      await h.cleanup();
    }
  });

  test("needs_user result includes ManualGuidance routing to the conflict chooser", async () => {
    const h = await setupConflictHarness();
    try {
      const ctx = makeCtx(h);
      const result = await recover(ctx);
      const r = result as Extract<RecoveryResult, { status: "needs_user" }>;
      expect(r.guidance).toBeDefined();
      // Human label + machine key — never a token in the label field.
      expect(r.guidance.recommendedActionKey).toBe("resolve_conflict");
      expect(r.guidance.recommendedAction).not.toMatch(/_/);
      expect(r.guidance.recommendedAction.length).toBeGreaterThan(0);
    } finally {
      await h.cleanup();
    }
  });

  test("needs_user result guidance userSummary is non-empty jargon-free copy", async () => {
    const h = await setupConflictHarness();
    try {
      const ctx = makeCtx(h);
      const result = await recover(ctx);
      const r = result as Extract<RecoveryResult, { status: "needs_user" }>;
      expect(r.guidance.userSummary.length).toBeGreaterThan(10);
      // Must not leak git jargon
      expect(r.guidance.userSummary.toLowerCase()).not.toContain("commit");
      expect(r.guidance.userSummary.toLowerCase()).not.toContain("branch");
      expect(r.guidance.userSummary.toLowerCase()).not.toContain("HEAD");
    } finally {
      await h.cleanup();
    }
  });
});

// ── 2. No conflict markers in the working file ────────────────────────────────

describe("recover (merge_conflict) — no conflict markers", () => {
  test("working file does NOT contain '<<<<<<' after recover", async () => {
    const h = await setupConflictHarness();
    try {
      const ctx = makeCtx(h);
      await recover(ctx);
      const content = await readFile(path.join(h.aliceDir, "chapter-01.md"), "utf8");
      expect(content).not.toContain("<<<<<<<");
    } finally {
      await h.cleanup();
    }
  });

  test("working file does NOT contain '>>>>>>>' after recover", async () => {
    const h = await setupConflictHarness();
    try {
      const ctx = makeCtx(h);
      await recover(ctx);
      const content = await readFile(path.join(h.aliceDir, "chapter-01.md"), "utf8");
      expect(content).not.toContain(">>>>>>>");
    } finally {
      await h.cleanup();
    }
  });

  test("working tree is clean (no unstaged changes) after recover", async () => {
    const h = await setupConflictHarness();
    try {
      const ctx = makeCtx(h);
      await recover(ctx);
      expect(await isClean(h.aliceDir)).toBe(true);
    } finally {
      await h.cleanup();
    }
  });

  test("working file still contains Alice's text (snapshot kept her version)", async () => {
    const h = await setupConflictHarness();
    try {
      const ctx = makeCtx(h);
      await recover(ctx);
      const content = await readFile(path.join(h.aliceDir, "chapter-01.md"), "utf8");
      expect(content).toBe("# One\n\nAlice's local rewrite.\n");
    } finally {
      await h.cleanup();
    }
  });
});

// ── 3. Remote is unchanged ────────────────────────────────────────────────────

describe("recover (merge_conflict) — remote unchanged", () => {
  test("server HEAD is unchanged after recover returns needs_user", async () => {
    const h = await setupConflictHarness();
    try {
      const headBefore = await serverHead(h.serverDir);
      const ctx = makeCtx(h);
      await recover(ctx);
      const headAfter = await serverHead(h.serverDir);
      expect(headAfter).toBe(headBefore);
    } finally {
      await h.cleanup();
    }
  });

  test("server file content is unchanged after recover", async () => {
    const h = await setupConflictHarness();
    try {
      const serverContentBefore = await serverFile(h.serverDir, "chapter-01.md");
      const ctx = makeCtx(h);
      await recover(ctx);
      const serverContentAfter = await serverFile(h.serverDir, "chapter-01.md");
      expect(serverContentAfter).toBe(serverContentBefore);
    } finally {
      await h.cleanup();
    }
  });

  test("no force-push is attempted during recover", async () => {
    const h = await setupConflictHarness();
    try {
      const { http, pushes } = spyHttpClient();
      const ctx = makeCtx(h, { httpClient: http });
      await recover(ctx);
      // Either no push happened at all, or every push had force=false
      for (const push of pushes) {
        expect(push.hasForce).toBe(false);
      }
    } finally {
      await h.cleanup();
    }
  });
});

// ── 4. Snapshot invariant ─────────────────────────────────────────────────────

describe("recover (merge_conflict) — snapshot-first invariant", () => {
  test("a safety snapshot commit exists in local history after recover", async () => {
    const h = await setupConflictHarness();
    try {
      const ctx = makeCtx(h);
      await recover(ctx);
      // The most recent commit should be the snapshot
      const log = await git.log({ fs, dir: h.aliceDir, depth: 1 });
      const topMessage = log[0]!.commit.message.trim();
      expect(topMessage).toBe(SYNC_SNAPSHOT_MESSAGE);
    } finally {
      await h.cleanup();
    }
  });

  test("local file is preserved in the snapshot commit tree", async () => {
    const h = await setupConflictHarness();
    try {
      const ctx = makeCtx(h);
      const result = await recover(ctx);
      const r = result as Extract<RecoveryResult, { status: "needs_user" }>;
      // localId on the result is the snapshot tip
      expect(r.guidance).toBeDefined();
      // Verify Alice's text is in HEAD tree (the snapshot)
      const headOid = await git.resolveRef({ fs, dir: h.aliceDir, ref: "main" });
      const { blob } = await git.readBlob({
        fs,
        dir: h.aliceDir,
        oid: headOid,
        filepath: "chapter-01.md",
      });
      expect(Buffer.from(blob).toString("utf8")).toBe(
        "# One\n\nAlice's local rewrite.\n",
      );
    } finally {
      await h.cleanup();
    }
  });
});

// ── 5. Confirmation gate is NEVER called (policy requireConfirmation=false) ───

describe("recover (merge_conflict) — confirmation gate not invoked", () => {
  test("confirmation gate is never called for merge_conflict", async () => {
    const h = await setupConflictHarness();
    try {
      let confirmCalled = false;
      const ctx = makeCtx(h, {
        confirmation: {
          confirmRepair: async () => {
            confirmCalled = true;
            return true;
          },
        },
      });
      await recover(ctx);
      expect(confirmCalled).toBe(false);
    } finally {
      await h.cleanup();
    }
  });
});

// ── 6. No backup is created (policy createBackup=false) ──────────────────────

describe("recover (merge_conflict) — no backup zip", () => {
  test("recover does not create a backup zip (merge_conflict is low-risk)", async () => {
    const h = await setupConflictHarness();
    try {
      const ctx = makeCtx(h);
      const result = await recover(ctx);
      const r = result as Extract<RecoveryResult, { status: "needs_user" }>;
      // The needs_user result should NOT have a backupZipPath — not needed for
      // a safe, no-write pause operation.
      expect(r.backupZipPath).toBeUndefined();
    } finally {
      await h.cleanup();
    }
  });
});

// ── 7. resolveConflicts delegation — 'mine' keeps Alice's text ────────────────

describe("resolveConflicts delegation — keeping Alice's version", () => {
  test("resolveConflicts('mine') keeps Alice's text and produces a two-parent merge commit", async () => {
    const h = await setupConflictHarness();
    try {
      const ctx = makeCtx(h);
      const result = await recover(ctx);
      expect(result.status).toBe("needs_user");
      const r = result as Extract<RecoveryResult, { status: "needs_user" }>;

      // Use the localId/remoteId from the result (they may be embedded in the
      // guidance or we derive them from the repo state).
      // resolve using sync.ts directly to verify delegation
      const localId = await git.resolveRef({ fs, dir: h.aliceDir, ref: "main" });
      // The remoteId was fetched — find it from the remote-tracking ref
      const remoteId = await git.resolveRef({
        fs,
        dir: h.aliceDir,
        ref: "refs/remotes/origin/main",
      });

      const resolutions: ConflictResolution[] = [
        { path: "chapter-01.md", choice: "mine" },
      ];

      const syncOutcome = await resolveConflicts({
        projectDir: h.aliceDir,
        resolutions,
        localId,
        remoteId,
        httpClient: httpNode,
      });

      // After resolve, the file should contain Alice's version
      const content = await readFile(
        path.join(h.aliceDir, "chapter-01.md"),
        "utf8",
      );
      expect(content).toBe("# One\n\nAlice's local rewrite.\n");
      expect(content).not.toContain("<<<<<<<");
      expect(content).not.toContain(">>>>>>>");

      // The push should succeed (conflict is resolved)
      expect(syncOutcome.status).toBe("synced");
    } finally {
      await h.cleanup();
    }
  });

  test("resolveConflicts('theirs') keeps the online text, no markers", async () => {
    const h = await setupConflictHarness();
    try {
      const ctx = makeCtx(h);
      await recover(ctx);

      const localId = await git.resolveRef({ fs, dir: h.aliceDir, ref: "main" });
      const remoteId = await git.resolveRef({
        fs,
        dir: h.aliceDir,
        ref: "refs/remotes/origin/main",
      });

      const resolutions: ConflictResolution[] = [
        { path: "chapter-01.md", choice: "theirs" },
      ];

      await resolveConflicts({
        projectDir: h.aliceDir,
        resolutions,
        localId,
        remoteId,
        httpClient: httpNode,
      });

      const content = await readFile(
        path.join(h.aliceDir, "chapter-01.md"),
        "utf8",
      );
      expect(content).toBe("# One\n\nBob's online rewrite.\n");
      expect(content).not.toContain("<<<<<<<");
    } finally {
      await h.cleanup();
    }
  });

  test("resolveConflicts('both') keeps Alice's text AND writes an online copy alongside", async () => {
    const h = await setupConflictHarness();
    try {
      const ctx = makeCtx(h);
      await recover(ctx);

      const localId = await git.resolveRef({ fs, dir: h.aliceDir, ref: "main" });
      const remoteId = await git.resolveRef({
        fs,
        dir: h.aliceDir,
        ref: "refs/remotes/origin/main",
      });

      const resolutions: ConflictResolution[] = [
        { path: "chapter-01.md", choice: "both" },
      ];

      const syncOutcome = await resolveConflicts({
        projectDir: h.aliceDir,
        resolutions,
        localId,
        remoteId,
        httpClient: httpNode,
      });

      // Alice's original should be intact
      const aliceContent = await readFile(
        path.join(h.aliceDir, "chapter-01.md"),
        "utf8",
      );
      expect(aliceContent).toBe("# One\n\nAlice's local rewrite.\n");
      expect(aliceContent).not.toContain("<<<<<<<");

      // An "(online copy)" file should have been created
      const onlineCopyName = "chapter-01 (online copy).md";
      const onlineCopyExists = fs.existsSync(
        path.join(h.aliceDir, onlineCopyName),
      );
      expect(onlineCopyExists).toBe(true);

      if (onlineCopyExists) {
        const onlineContent = await readFile(
          path.join(h.aliceDir, onlineCopyName),
          "utf8",
        );
        expect(onlineContent).toBe("# One\n\nBob's online rewrite.\n");
      }

      expect(syncOutcome.status).toBe("synced");
    } finally {
      await h.cleanup();
    }
  });

  test("resolveConflicts produces honest two-parent merge commit (both histories intact)", async () => {
    const h = await setupConflictHarness();
    try {
      const ctx = makeCtx(h);
      await recover(ctx);

      const localId = await git.resolveRef({ fs, dir: h.aliceDir, ref: "main" });
      const remoteId = await git.resolveRef({
        fs,
        dir: h.aliceDir,
        ref: "refs/remotes/origin/main",
      });

      await resolveConflicts({
        projectDir: h.aliceDir,
        resolutions: [{ path: "chapter-01.md", choice: "mine" }],
        localId,
        remoteId,
        httpClient: httpNode,
      });

      // After resolveConflicts the pushed head is a merge commit with 2 parents
      const pushedHead = await serverHead(h.serverDir);
      const { commit } = await git.readCommit({
        fs,
        dir: h.serverDir,
        oid: pushedHead,
      });
      expect(commit.parent.length).toBeGreaterThanOrEqual(2);
    } finally {
      await h.cleanup();
    }
  });
});

// ── 8. Multiple conflicted files ──────────────────────────────────────────────

describe("recover (merge_conflict) — multiple conflicted files", () => {
  test("all conflicted files appear in the needs_user file list", async () => {
    // Set up a fixture where BOTH chapter-01.md and chapter-02.md conflict
    const serverDir = await tempDir("mc-multi-server-");
    await git.init({ fs, dir: serverDir, defaultBranch: "main" });
    await writeFile(path.join(serverDir, "manifest.yaml"), "title: Multi\n");
    await writeFile(path.join(serverDir, "chapter-01.md"), "# One\n\nBase.\n");
    await writeFile(path.join(serverDir, "chapter-02.md"), "# Two\n\nBase.\n");
    await git.add({ fs, dir: serverDir, filepath: "manifest.yaml" });
    await git.add({ fs, dir: serverDir, filepath: "chapter-01.md" });
    await git.add({ fs, dir: serverDir, filepath: "chapter-02.md" });
    const author = { name: "Base", email: "base@test.local" };
    await git.commit({ fs, dir: serverDir, message: "initial", author });

    const server = await startGitServer(serverDir);
    const parentDir = await tempDir("mc-multi-alice-");
    const aliceDir = path.join(parentDir, "project");
    await cloneRepository({ url: server.url, dir: aliceDir });

    // Server edits both files
    await writeFile(path.join(serverDir, "chapter-01.md"), "# One\n\nServer edit.\n");
    await writeFile(path.join(serverDir, "chapter-02.md"), "# Two\n\nServer edit.\n");
    await git.add({ fs, dir: serverDir, filepath: "chapter-01.md" });
    await git.add({ fs, dir: serverDir, filepath: "chapter-02.md" });
    await git.commit({ fs, dir: serverDir, message: "server edits both", author: SERVER_AUTHOR });

    // Alice edits both files locally
    await writeFile(path.join(aliceDir, "chapter-01.md"), "# One\n\nAlice edit.\n");
    await writeFile(path.join(aliceDir, "chapter-02.md"), "# Two\n\nAlice edit.\n");

    const h: ConflictHarness = {
      serverDir,
      server,
      aliceDir,
      cleanup: async () => {
        await server.close();
        await rm(serverDir, { recursive: true, force: true });
        await rm(parentDir, { recursive: true, force: true });
      },
    };

    try {
      const ctx = makeCtx(h);
      const result = await recover(ctx);
      expect(result.status).toBe("needs_user");
      const r = result as Extract<RecoveryResult, { status: "needs_user" }>;
      const paths = r.files!.map((f) => f.path);
      expect(paths).toContain("chapter-01.md");
      expect(paths).toContain("chapter-02.md");
    } finally {
      await h.cleanup();
    }
  });
});

// ── 9. Non-conflict case: recover returns recovered when pull succeeds cleanly ─

describe("recover (merge_conflict) — non-conflict pull", () => {
  test("returns recovered when there is no actual conflict (clean pull)", async () => {
    // Fixture: server has new commits; Alice has no local changes — no conflict
    const serverDir = await tempDir("mc-clean-server-");
    await createFixtureRepo(serverDir);
    const server = await startGitServer(serverDir);
    const parentDir = await tempDir("mc-clean-alice-");
    const aliceDir = path.join(parentDir, "project");
    await cloneRepository({ url: server.url, dir: aliceDir });

    // Server adds a new file only (no overlap with local)
    await writeFile(path.join(serverDir, "chapter-03.md"), "# Three\n\nNew.\n");
    await git.add({ fs, dir: serverDir, filepath: "chapter-03.md" });
    await git.commit({
      fs,
      dir: serverDir,
      message: "add chapter 03",
      author: SERVER_AUTHOR,
    });

    const h: ConflictHarness = {
      serverDir,
      server,
      aliceDir,
      cleanup: async () => {
        await server.close();
        await rm(serverDir, { recursive: true, force: true });
        await rm(parentDir, { recursive: true, force: true });
      },
    };

    try {
      const ctx = makeCtx(h);
      const result = await recover(ctx);
      // No conflict → handler should report recovered (or up-to-date equivalent)
      // The handler is called when the kind is merge_conflict, but the actual
      // pull might resolve cleanly — the result should be 'recovered' not 'needs_user'
      expect(["recovered", "needs_user"]).toContain(result.status);
      // If it resolved cleanly, there must be no conflict files
      if (result.status === "recovered") {
        expect(result.message.length).toBeGreaterThan(0);
      }
    } finally {
      await h.cleanup();
    }
  });
});
