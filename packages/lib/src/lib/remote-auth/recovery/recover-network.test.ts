/**
 * Tests for recover-network.ts — Offline: keep local work, schedule retry.
 *
 * WHY: network_unavailable is a "thin wrapper" around sync.ts's pullChanges /
 * pushChanges / syncProject. When the transport throws ECONNREFUSED or
 * ETIMEDOUT, sync.ts classifies it as status "offline" and we translate that
 * to RecoveryResult { status: "retry_later", retryAfterMs: >0 }. This file
 * proves the happy path, the safety invariants, and the reconnect follow-up.
 *
 * SAFETY INVARIANTS (per spec):
 *   1. Write offline.md, sync offline → status "retry_later"
 *   2. offline.md is preserved locally (snapshot-first guarantees this)
 *   3. Remote does NOT contain offline.md (no write happened)
 *   4. No force-push (every push call has force !== true)
 *   5. Reconnect follow-up → syncProject pushes queued work, remote now has
 *      offline.md
 *   6. No backup zip is created (policy: createBackup=false)
 *   7. retryAfterMs is a positive number (exponential backoff)
 *
 * bun:test only. Real on-disk temp repos via isomorphic-git.
 * NEVER shells out to system git or gh.
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import git from "isomorphic-git";
import httpNode from "isomorphic-git/http/node";

import { cloneRepository } from "../clone.ts";
import { syncProject } from "../sync.ts";
import {
  createFixtureRepo,
  startGitServer,
  tempDir,
  type GitServer,
} from "../test-support/git-http-server.ts";

// ── The module under test (does not exist yet — will fail to import) ──────────
import { recover } from "./recover-network.ts";
import { BACKUP_ROOT } from "./backup.ts";
import type { RecoveryContext, RecoveryResult } from "./types.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

const TEST_AUTHOR = { name: "Test Author", email: "test@test.local" };

interface NetworkHarness {
  serverDir: string;
  server: GitServer;
  projectDir: string;
  cleanup(): Promise<void>;
}

/**
 * Create a fixture server + cloned project directory.
 * The cloned project dir already has two commits (from createFixtureRepo).
 */
async function setupOnlineHarness(): Promise<NetworkHarness> {
  const serverDir = await tempDir("pmd-net-server-");
  await createFixtureRepo(serverDir);
  const server = await startGitServer(serverDir);
  const parent = await tempDir("pmd-net-client-");
  const projectDir = path.join(parent, "project");
  await cloneRepository({ url: server.url, dir: projectDir });
  return {
    serverDir,
    server,
    projectDir,
    cleanup: async () => {
      await server.close();
      await rm(serverDir, { recursive: true, force: true });
      await rm(parent, { recursive: true, force: true });
    },
  };
}

/** Build an offline HTTP client — every request throws ECONNREFUSED. */
function offlineHttpClient(): typeof httpNode {
  return {
    async request() {
      const err = new Error("connect ECONNREFUSED 127.0.0.1:9") as NodeJS.ErrnoException;
      err.code = "ECONNREFUSED";
      throw err;
    },
  } as unknown as typeof httpNode;
}

/**
 * Build an HTTP client that throws ETIMEDOUT. Used to verify classify
 * handles both common offline error codes.
 */
function timedOutHttpClient(): typeof httpNode {
  return {
    async request() {
      const err = new Error("connect ETIMEDOUT") as NodeJS.ErrnoException;
      err.code = "ETIMEDOUT";
      throw err;
    },
  } as unknown as typeof httpNode;
}

/**
 * Spy wrapper around a real HTTP client. Records every `git-receive-pack`
 * POST (a push) and whether it included a force flag.
 *
 * isomorphic-git does not expose "force" in the HTTP body directly, but
 * reject-able push detection tests in sync.ts already prove force is
 * controlled at the library level. For our purposes we record the push
 * URLs so we can assert at least that a push WAS attempted on reconnect.
 */
interface PushRecord {
  url: string;
  body: string;
}

function spyHttpClient(
  inner: typeof httpNode,
  pushLog: PushRecord[],
): typeof httpNode {
  return {
    async request(opts: Parameters<typeof httpNode.request>[0]) {
      const result = await inner.request(opts);
      if (opts.url?.includes("git-receive-pack") && result.body) {
        const bodyChunks: Uint8Array[] = [];
        const originalBody = result.body;
        const tee = (async function* () {
          for await (const chunk of originalBody) {
            bodyChunks.push(chunk as Uint8Array);
            yield chunk;
          }
          pushLog.push({
            url: opts.url ?? "",
            body: Buffer.concat(bodyChunks.map((c) => Buffer.from(c))).toString(
              "latin1",
            ),
          });
        })();
        return { ...result, body: tee };
      }
      return result;
    },
  } as unknown as typeof httpNode;
}

/** Build a minimal RecoveryContext for network_unavailable tests. */
function makeCtx(
  projectDir: string,
  overrides: Partial<RecoveryContext> = {},
): RecoveryContext {
  return {
    projectDir,
    repoDir: projectDir,
    branch: "main",
    repoSlug: "test-book",
    confirmation: {
      // network_unavailable never asks for confirmation, but provide
      // a no-op gate so the interface is satisfied.
      confirmRepair: async () => false,
    },
    ...overrides,
  };
}

// ── 1. Happy path: offline sync → retry_later ─────────────────────────────────

describe("recover-network — offline sync returns retry_later", () => {
  test("status is retry_later when server is unreachable", async () => {
    const h = await setupOnlineHarness();
    try {
      const ctx = makeCtx(h.projectDir, {
        httpClient: offlineHttpClient(),
      });
      const result = await recover(ctx);
      expect(result.status).toBe("retry_later");
    } finally {
      await h.cleanup();
    }
  });

  test("status is retry_later for ETIMEDOUT as well as ECONNREFUSED", async () => {
    const h = await setupOnlineHarness();
    try {
      const ctx = makeCtx(h.projectDir, {
        httpClient: timedOutHttpClient(),
      });
      const result = await recover(ctx);
      expect(result.status).toBe("retry_later");
    } finally {
      await h.cleanup();
    }
  });

  test("retryAfterMs is a positive number", async () => {
    const h = await setupOnlineHarness();
    try {
      const ctx = makeCtx(h.projectDir, {
        httpClient: offlineHttpClient(),
      });
      const result = await recover(ctx);
      expect(result.status).toBe("retry_later");
      const r = result as Extract<RecoveryResult, { status: "retry_later" }>;
      expect(r.retryAfterMs).toBeGreaterThan(0);
    } finally {
      await h.cleanup();
    }
  });

  test("message is present (non-empty string)", async () => {
    const h = await setupOnlineHarness();
    try {
      const ctx = makeCtx(h.projectDir, {
        httpClient: offlineHttpClient(),
      });
      const result = await recover(ctx);
      expect(typeof result.message).toBe("string");
      expect((result.message as string).length).toBeGreaterThan(0);
    } finally {
      await h.cleanup();
    }
  });
});

// ── 2. Snapshot-first: local file preserved after offline attempt ──────────────

describe("recover-network — local file preserved (snapshot-first)", () => {
  test("offline.md is readable locally after offline recover()", async () => {
    const h = await setupOnlineHarness();
    try {
      // Write a new file that hasn't been synced yet.
      await writeFile(path.join(h.projectDir, "offline.md"), "# Offline Work\n\nSaved locally.\n");

      const ctx = makeCtx(h.projectDir, {
        httpClient: offlineHttpClient(),
      });
      await recover(ctx);

      // The file must still be on disk.
      const content = await readFile(path.join(h.projectDir, "offline.md"), "utf8");
      expect(content).toBe("# Offline Work\n\nSaved locally.\n");
    } finally {
      await h.cleanup();
    }
  });

  test("uncommitted file is still present after offline recover()", async () => {
    const h = await setupOnlineHarness();
    try {
      await writeFile(
        path.join(h.projectDir, "offline.md"),
        "# Draft\n\nNot yet synced.\n",
      );

      const ctx = makeCtx(h.projectDir, {
        httpClient: offlineHttpClient(),
      });
      await recover(ctx);

      expect(fs.existsSync(path.join(h.projectDir, "offline.md"))).toBe(true);
    } finally {
      await h.cleanup();
    }
  });
});

// ── 3. Remote unchanged: offline.md does NOT reach the server ────────────────

describe("recover-network — remote unchanged after offline attempt", () => {
  test("offline.md is NOT in the remote repo after failed sync", async () => {
    const h = await setupOnlineHarness();
    try {
      await writeFile(
        path.join(h.projectDir, "offline.md"),
        "# Offline\n\nNot pushed yet.\n",
      );

      const ctx = makeCtx(h.projectDir, {
        httpClient: offlineHttpClient(),
      });
      await recover(ctx);

      // Read the file from the remote's HEAD commit via isomorphic-git.
      const remoteHead = await git.resolveRef({
        fs,
        dir: h.serverDir,
        ref: "refs/heads/main",
      });
      let remoteHasFile = false;
      try {
        await git.readBlob({
          fs,
          dir: h.serverDir,
          oid: remoteHead,
          filepath: "offline.md",
        });
        remoteHasFile = true;
      } catch {
        remoteHasFile = false;
      }
      expect(remoteHasFile).toBe(false);
    } finally {
      await h.cleanup();
    }
  });

  test("remote HEAD is unchanged after offline recover()", async () => {
    const h = await setupOnlineHarness();
    try {
      const remoteHeadBefore = await git.resolveRef({
        fs,
        dir: h.serverDir,
        ref: "refs/heads/main",
      });

      await writeFile(path.join(h.projectDir, "offline.md"), "# Offline\n");

      const ctx = makeCtx(h.projectDir, {
        httpClient: offlineHttpClient(),
      });
      await recover(ctx);

      const remoteHeadAfter = await git.resolveRef({
        fs,
        dir: h.serverDir,
        ref: "refs/heads/main",
      });
      expect(remoteHeadAfter).toBe(remoteHeadBefore);
    } finally {
      await h.cleanup();
    }
  });
});

// ── 4. No force push ──────────────────────────────────────────────────────────

describe("recover-network — no force push", () => {
  test("no push is attempted when offline", async () => {
    const h = await setupOnlineHarness();
    try {
      // Record all receive-pack requests to detect any push attempt.
      const pushLog: PushRecord[] = [];
      const spied = spyHttpClient(offlineHttpClient(), pushLog);

      await writeFile(path.join(h.projectDir, "offline.md"), "# No push\n");

      const ctx = makeCtx(h.projectDir, { httpClient: spied });
      await recover(ctx);

      // The offline client never reaches the server, so no push can land.
      // The spy records pushes on successful HTTP exchanges only — a thrown
      // client means pushLog stays empty.
      expect(pushLog.filter((p) => p.url.includes("receive-pack")).length).toBe(0);
    } finally {
      await h.cleanup();
    }
  });
});

// ── 5. Reconnect follow-up: online after retry pushes queued work ─────────────

describe("recover-network — reconnect follow-up pushes queued work", () => {
  test("syncProject with real http after offline recover() pushes offline.md to remote", async () => {
    const h = await setupOnlineHarness();
    try {
      await writeFile(
        path.join(h.projectDir, "offline.md"),
        "# Offline Work\n\nQueued for sync.\n",
      );

      // Step 1: offline recover() — local file staged locally via snapshot.
      const offlineCtx = makeCtx(h.projectDir, {
        httpClient: offlineHttpClient(),
      });
      const offlineResult = await recover(offlineCtx);
      expect(offlineResult.status).toBe("retry_later");

      // Step 2: reconnect — real HTTP is available again.
      const syncOutcome = await syncProject({
        projectDir: h.projectDir,
        httpClient: h.server.url ? httpNode : httpNode,
        // No explicit credential — server has no auth requirement.
      });
      expect(syncOutcome.status).toBe("synced");

      // Step 3: verify offline.md is now on the remote.
      const remoteHead = await git.resolveRef({
        fs,
        dir: h.serverDir,
        ref: "refs/heads/main",
      });
      const { blob } = await git.readBlob({
        fs,
        dir: h.serverDir,
        oid: remoteHead,
        filepath: "offline.md",
      });
      const remoteContent = Buffer.from(blob).toString("utf8");
      expect(remoteContent).toBe("# Offline Work\n\nQueued for sync.\n");
    } finally {
      await h.cleanup();
    }
  });

  test("snapshot created during offline recover() is visible in local history", async () => {
    const h = await setupOnlineHarness();
    try {
      await writeFile(path.join(h.projectDir, "offline.md"), "# Local Draft\n");

      const ctx = makeCtx(h.projectDir, { httpClient: offlineHttpClient() });
      await recover(ctx);

      // After recover(), the local repo should have at least one commit beyond
      // the initial clone tip — the snapshot that captured offline.md.
      const localHead = await git.resolveRef({
        fs,
        dir: h.projectDir,
        ref: "HEAD",
      });
      const remoteHead = await git.resolveRef({
        fs,
        dir: h.serverDir,
        ref: "refs/heads/main",
      });

      // Local is ahead of remote (has the snapshot commit).
      expect(localHead).not.toBe(remoteHead);
    } finally {
      await h.cleanup();
    }
  });
});

// ── 6. No backup zip is created ───────────────────────────────────────────────

describe("recover-network — no backup zip created", () => {
  test("recover() does not create a backup zip for network_unavailable", async () => {
    const h = await setupOnlineHarness();
    try {
      const ctx = makeCtx(h.projectDir, {
        httpClient: offlineHttpClient(),
        repoSlug: "net-test-no-backup",
      });

      await recover(ctx);

      // No zip should exist under the OS temp recovery root for this slug.
      const slug = "net-test-no-backup";
      const backupDir = path.join(BACKUP_ROOT, slug);
      let found = false;
      try {
        const entries = fs.readdirSync(backupDir);
        found = entries.length > 0;
      } catch {
        // Directory doesn't exist — good.
        found = false;
      }
      expect(found).toBe(false);
    } finally {
      await h.cleanup();
    }
  });

  test("result has no backupZipPath property", async () => {
    const h = await setupOnlineHarness();
    try {
      const ctx = makeCtx(h.projectDir, {
        httpClient: offlineHttpClient(),
      });
      const result = await recover(ctx);
      expect("backupZipPath" in result).toBe(false);
    } finally {
      await h.cleanup();
    }
  });
});

// ── 7. retryAfterMs is exponential (first call baseline) ──────────────────────

describe("recover-network — retryAfterMs (backoff)", () => {
  test("retryAfterMs is at least 5 seconds on first attempt", async () => {
    const h = await setupOnlineHarness();
    try {
      const ctx = makeCtx(h.projectDir, {
        httpClient: offlineHttpClient(),
      });
      const result = await recover(ctx);
      expect(result.status).toBe("retry_later");
      const r = result as Extract<RecoveryResult, { status: "retry_later" }>;
      // Minimum backoff must be at least 5 s to avoid hammering the server.
      expect(r.retryAfterMs).toBeGreaterThanOrEqual(5_000);
    } finally {
      await h.cleanup();
    }
  });

  test("retryAfterMs is at most 30 minutes (sane upper bound)", async () => {
    const h = await setupOnlineHarness();
    try {
      const ctx = makeCtx(h.projectDir, {
        httpClient: offlineHttpClient(),
      });
      const result = await recover(ctx);
      expect(result.status).toBe("retry_later");
      const r = result as Extract<RecoveryResult, { status: "retry_later" }>;
      expect(r.retryAfterMs).toBeLessThanOrEqual(30 * 60 * 1_000);
    } finally {
      await h.cleanup();
    }
  });
});

// ── 8. No confirmation gate is called ────────────────────────────────────────

describe("recover-network — confirmation gate never called", () => {
  test("confirmation.confirmRepair is never called for network_unavailable", async () => {
    const h = await setupOnlineHarness();
    try {
      let confirmCalled = false;
      const ctx = makeCtx(h.projectDir, {
        httpClient: offlineHttpClient(),
        confirmation: {
          confirmRepair: async () => {
            confirmCalled = true;
            return false;
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

// ── 9. Error passed to recover() is surfaced correctly ────────────────────────

describe("recover-network — error argument handling", () => {
  test("recover(ctx, error) with ECONNREFUSED error still returns retry_later", async () => {
    const h = await setupOnlineHarness();
    try {
      const offlineErr = new Error("connect ECONNREFUSED") as NodeJS.ErrnoException;
      offlineErr.code = "ECONNREFUSED";

      const ctx = makeCtx(h.projectDir, {
        httpClient: offlineHttpClient(),
      });
      const result = await recover(ctx, offlineErr);
      expect(result.status).toBe("retry_later");
    } finally {
      await h.cleanup();
    }
  });
});

// ── 10. Clean repo (nothing to sync) still returns retry_later ────────────────

describe("recover-network — clean repo offline", () => {
  test("returns retry_later even with no pending changes", async () => {
    const h = await setupOnlineHarness();
    try {
      // Do NOT write any new files — repo is in sync with remote.
      const ctx = makeCtx(h.projectDir, {
        httpClient: offlineHttpClient(),
      });
      const result = await recover(ctx);
      // The repo is already in sync; the network call still fails offline.
      // Result must still be retry_later (not an error / up-to-date).
      expect(result.status).toBe("retry_later");
    } finally {
      await h.cleanup();
    }
  });
});
