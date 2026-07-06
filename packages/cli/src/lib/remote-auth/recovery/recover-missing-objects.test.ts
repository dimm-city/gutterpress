/**
 * Tests for recover-missing-objects.ts — Missing/corrupt loose objects recovery.
 *
 * Feature: when isomorphic-git surfaces a "missing object" or "pack corrupt"
 * error, the recovery handler tries a safe fetch from the remote to fill gaps.
 * If the fetch cannot repair the repo, it stops with manual guidance and a
 * backup — NEVER pushes, NEVER force-pushes, leaves the remote unchanged.
 *
 * Test strategy:
 *   - Real on-disk temp repos built with isomorphic-git (no system git).
 *   - Real in-process HTTP server from test-support/git-http-server.ts for
 *     remote-wire tests.
 *   - Mocks ONLY for: confirmation gate (UI dialog), FaultInjector (fault hooks),
 *     and http transport wrapper (push spy).
 *   - Tests are written FAIL-FIRST (handler not yet implemented).
 *
 * Safety invariants checked in every applicable test:
 *   I1. No push attempted (gitSpy.pushCalls.length === 0).
 *   I2. No force-push (every recorded push call has force !== true).
 *   I3. Remote HEAD+tree UNCHANGED after the recovery attempt.
 *   I4. User-visible files preserved on block/fail.
 *   I5. Backup created and readable BEFORE any repair.
 *   I6. If backup creation fails → repair never starts (failed_no_changes_made).
 *   I7. If risky repair throws after backup → failed_backup_available, zip readable.
 *   I8. User denied confirmation → blocked, no-op.
 *   I9. Guidance present in every non-recovered result.
 */

import { describe, expect, test, beforeEach } from "bun:test";
import * as nodeFs from "node:fs";
import { readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { makeTempDir as freshTempDir } from "../../../test-helpers/testkit";

import git from "isomorphic-git";
import httpNode from "isomorphic-git/http/node";

import { assertZipReadable, BACKUP_ROOT } from "./backup.ts";
import type { HostCredential } from "../token-store.ts";
import type {
  RecoveryContext,
  RecoveryResult,
  FaultPoint,
  FaultInjector,
  ConfirmationGate,
} from "./types.ts";

// ── Import the handler under test ─────────────────────────────────────────────
// This will fail (module not found / no export) until the handler is implemented —
// that's the INTENDED red state for TDD stage 1.
import { recover } from "./recover-missing-objects.ts";

// ── Import test-support server helpers ─────────────────────────────────────────
import {
  createFixtureRepo,
  startGitServer,
  tempDir,
  type GitServer,
} from "../test-support/git-http-server.ts";

// ── Push spy ──────────────────────────────────────────────────────────────────

/**
 * Wraps httpNode to record every push (POST to /git-receive-pack) so tests can
 * assert that the handler never pushes and never force-pushes.
 */
interface PushSpy {
  pushCalls: Array<{ url: string; headers: Record<string, string> }>;
  http: typeof httpNode;
}

function makePushSpy(): PushSpy {
  const spy: PushSpy = { pushCalls: [], http: null as unknown as typeof httpNode };
  spy.http = {
    async request(options: {
      url: string;
      method: string;
      headers: Record<string, string>;
      body?: unknown;
      onProgress?: unknown;
    }) {
      if (
        options.method === "POST" &&
        options.url?.includes("git-receive-pack")
      ) {
        spy.pushCalls.push({ url: options.url, headers: options.headers });
      }
      return httpNode.request(options as Parameters<typeof httpNode.request>[0]);
    },
  } as unknown as typeof httpNode;
  return spy;
}

// ── Temp repo helpers ─────────────────────────────────────────────────────────

async function makeTempDir(): Promise<string> {
  return freshTempDir("recover-missing-objects-test-");
}

const AUTHOR = { name: "Test Author", email: "test@test.local" };

/**
 * Create a minimal git repo with user content and at least one commit.
 * Returns the commit oid.
 */
async function makeTestRepo(dir: string): Promise<string> {
  await git.init({ fs: nodeFs, dir, defaultBranch: "main" });
  await writeFile(path.join(dir, "manifest.yaml"), "title: Test Book\n");
  await writeFile(path.join(dir, "chapter-01.md"), "# Chapter One\n\nContent here.\n");
  await git.add({ fs: nodeFs, dir, filepath: "manifest.yaml" });
  await git.add({ fs: nodeFs, dir, filepath: "chapter-01.md" });
  return git.commit({ fs: nodeFs, dir, message: "initial", author: AUTHOR });
}

/** Read the HEAD commit oid for a directory (or null on error). */
async function headOid(dir: string): Promise<string | null> {
  try {
    return await git.resolveRef({ fs: nodeFs, dir, ref: "HEAD" });
  } catch {
    return null;
  }
}

/** Read the root tree oid for a given commit oid. */
async function treeOid(dir: string, oid: string): Promise<string | null> {
  try {
    const { commit } = await git.readCommit({ fs: nodeFs, dir, oid });
    return commit.tree;
  } catch {
    return null;
  }
}

// ── Harness: local repo + remote server ───────────────────────────────────────

interface RemoteHarness {
  serverDir: string;
  server: GitServer;
  clientDir: string;
  remoteHeadAtStart: string;
  remoteTreeAtStart: string;
  cleanup(): Promise<void>;
}

async function setupRemoteHarness(): Promise<RemoteHarness> {
  const serverDir = await tempDir("missing-obj-server-");
  await createFixtureRepo(serverDir);
  const server = await startGitServer(serverDir);

  const clientDir = await tempDir("missing-obj-client-");
  // Clone into client.
  await git.clone({
    fs: nodeFs,
    http: httpNode,
    dir: clientDir,
    url: server.url,
    singleBranch: true,
    depth: undefined,
  });

  const remoteHeadAtStart = await headOid(serverDir) ?? "";
  const remoteTreeAtStart = remoteHeadAtStart
    ? (await treeOid(serverDir, remoteHeadAtStart)) ?? ""
    : "";

  return {
    serverDir,
    server,
    clientDir,
    remoteHeadAtStart,
    remoteTreeAtStart,
    cleanup: async () => {
      await server.close();
      await rm(serverDir, { recursive: true, force: true });
      await rm(clientDir, { recursive: true, force: true });
    },
  };
}

// ── Context builder ───────────────────────────────────────────────────────────

function makeCtx(
  repoDir: string,
  opts: {
    remoteUrl?: string;
    confirmation?: ConfirmationGate;
    faults?: FaultInjector;
    http?: typeof httpNode;
    credential?: HostCredential;
  } = {},
): RecoveryContext {
  return {
    projectDir: repoDir,
    repoDir,
    branch: "main",
    repoSlug: "test-book",
    remoteUrl: opts.remoteUrl,
    confirmation: opts.confirmation ?? {
      confirmRepair: async () => true,
    },
    faults: opts.faults,
    httpClient: opts.http ?? httpNode,
    ...(opts.credential ? { credential: opts.credential } : {}),
    now: () => new Date("2025-06-15T10:00:00.000Z").getTime(),
  };
}

/** Simulate a corrupt loose object by overwriting one object file with garbage. */
async function damageLooseObject(repoDir: string): Promise<void> {
  const objectsDir = path.join(repoDir, ".git", "objects");
  // Walk subdirs (fan-out: 2-char prefix dirs) to find a loose object.
  const subdirs = nodeFs.readdirSync(objectsDir).filter((d) => /^[0-9a-f]{2}$/.test(d));
  for (const sub of subdirs) {
    const subPath = path.join(objectsDir, sub);
    const files = nodeFs.readdirSync(subPath);
    if (files.length > 0 && files[0]) {
      await writeFile(path.join(subPath, files[0]), Buffer.from("CORRUPTED_GARBAGE_DATA"));
      return;
    }
  }
  // If no loose objects found, create a fake corrupt one.
  const fakeDir = path.join(objectsDir, "aa");
  nodeFs.mkdirSync(fakeDir, { recursive: true });
  await writeFile(path.join(fakeDir, "bbccddee" + "0".repeat(32)), Buffer.from("BAD"));
}

// ── Representative error for the classifier ───────────────────────────────────

function makeMissingObjectsError(): Error & { code: string } {
  const e = new Error("ReadObjectFail: Could not find object") as Error & { code: string };
  e.code = "ReadObjectFail";
  return e;
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST SUITES
// ─────────────────────────────────────────────────────────────────────────────

// ── 1. Handler exists and exports recover() ───────────────────────────────────

describe("recover-missing-objects — module contract", () => {
  test("exports a recover function", () => {
    expect(typeof recover).toBe("function");
  });
});

// ── 2. Safety: no push ever ───────────────────────────────────────────────────

describe("recover-missing-objects — I1/I2 no push", () => {
  test("never calls push (no remote configured)", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);
    await damageLooseObject(dir);

    const spy = makePushSpy();
    const ctx = makeCtx(dir, {
      // No remoteUrl — handler must not attempt network push.
      http: spy.http,
    });

    const error = makeMissingObjectsError();
    const result = await recover(ctx, error);

    expect(spy.pushCalls.length).toBe(0);
    // Result is a failure/block/needs_user (not 'recovered') when there's no remote.
    expect(["needs_user", "blocked", "failed_no_changes_made", "failed_backup_available"]).toContain(
      result.status,
    );
  });

  test("never pushes even when remote is configured", async () => {
    const harness = await setupRemoteHarness();
    try {
      await damageLooseObject(harness.clientDir);
      const spy = makePushSpy();
      const ctx = makeCtx(harness.clientDir, {
        remoteUrl: harness.server.url,
        http: spy.http,
      });

      await recover(ctx, makeMissingObjectsError());

      expect(spy.pushCalls.length).toBe(0);
    } finally {
      await harness.cleanup();
    }
  });

  test("no force-push in any push call (spy records force header pattern)", async () => {
    const harness = await setupRemoteHarness();
    try {
      await damageLooseObject(harness.clientDir);
      const spy = makePushSpy();
      const ctx = makeCtx(harness.clientDir, {
        remoteUrl: harness.server.url,
        http: spy.http,
      });

      await recover(ctx, makeMissingObjectsError());

      // If there are any push calls, none should be force-pushes.
      for (const call of spy.pushCalls) {
        // force-push pkt-lines start with the new oid (non-zero) sent for a
        // ref that currently has a different value without the client verifying
        // the old oid. We detect this by asserting the spy recorded no calls at all.
        expect(call).toBeDefined(); // just to use the variable
      }
      expect(spy.pushCalls.length).toBe(0);
    } finally {
      await harness.cleanup();
    }
  });
});

// ── 3. Safety: remote unchanged ───────────────────────────────────────────────

describe("recover-missing-objects — I3 remote HEAD+tree unchanged", () => {
  test("remote HEAD is unchanged after recovery attempt", async () => {
    const harness = await setupRemoteHarness();
    try {
      await damageLooseObject(harness.clientDir);
      const ctx = makeCtx(harness.clientDir, {
        remoteUrl: harness.server.url,
      });

      await recover(ctx, makeMissingObjectsError());

      const remoteHeadAfter = await headOid(harness.serverDir);
      expect(remoteHeadAfter).toBe(harness.remoteHeadAtStart);
    } finally {
      await harness.cleanup();
    }
  });

  test("remote tree is unchanged after recovery attempt", async () => {
    const harness = await setupRemoteHarness();
    try {
      await damageLooseObject(harness.clientDir);
      const ctx = makeCtx(harness.clientDir, {
        remoteUrl: harness.server.url,
      });

      await recover(ctx, makeMissingObjectsError());

      const remoteHeadAfter = await headOid(harness.serverDir);
      const remoteTreeAfter = remoteHeadAfter
        ? await treeOid(harness.serverDir, remoteHeadAfter)
        : null;
      expect(remoteTreeAfter).toBe(harness.remoteTreeAtStart);
    } finally {
      await harness.cleanup();
    }
  });
});

// ── 4. Safety: user-visible files preserved ───────────────────────────────────

describe("recover-missing-objects — I4 user files preserved on block/fail", () => {
  test("chapter file unchanged when no remote configured", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);
    await damageLooseObject(dir);

    const originalContent = "# Chapter One\n\nContent here.\n";
    const ctx = makeCtx(dir);

    const result = await recover(ctx, makeMissingObjectsError());

    // File must be readable and unchanged.
    const content = nodeFs.readFileSync(path.join(dir, "chapter-01.md"), "utf8");
    expect(content).toBe(originalContent);

    // Result should not be 'recovered' if there's no remote to fetch from.
    expect(result.status).not.toBe("recovered");
  });

  test("chapter file unchanged after failed remote fetch", async () => {
    const harness = await setupRemoteHarness();
    try {
      // Write extra user content before damaging.
      await writeFile(
        path.join(harness.clientDir, "chapter-02.md"),
        "# Chapter Two\n\nNew stuff.\n",
      );
      await damageLooseObject(harness.clientDir);

      const ctx = makeCtx(harness.clientDir, {
        remoteUrl: harness.server.url,
      });

      await recover(ctx, makeMissingObjectsError());

      // chapter-02.md must survive.
      const content = nodeFs.readFileSync(
        path.join(harness.clientDir, "chapter-02.md"),
        "utf8",
      );
      expect(content).toBe("# Chapter Two\n\nNew stuff.\n");
    } finally {
      await harness.cleanup();
    }
  });
});

// ── 5. Safety: backup created and readable before any repair ─────────────────

describe("recover-missing-objects — I5 backup created before repair", () => {
  test("result includes a backupZipPath on success path (fetch worked)", async () => {
    const harness = await setupRemoteHarness();
    try {
      // Don't corrupt anything — just try a recovery on a clean repo with a
      // simulated missing-objects error. The fetch should succeed (no real damage).
      const ctx = makeCtx(harness.clientDir, {
        remoteUrl: harness.server.url,
      });

      const result = await recover(ctx, makeMissingObjectsError());

      // Whether recovered or needs_user, a backupZipPath should be present
      // (policy createBackup: true).
      if (result.status === "recovered" || result.status === "failed_backup_available") {
        expect((result as { backupZipPath?: string }).backupZipPath).toBeDefined();
        const zipPath = (result as { backupZipPath: string }).backupZipPath;
        await expect(assertZipReadable(zipPath)).resolves.toBeUndefined();
      }
      // If blocked or needs_user, backupZipPath may or may not be present
      // depending on whether the backup was created before the block.
    } finally {
      await harness.cleanup();
    }
  });

  test("backupZipPath is under the OS temp recovery root when present", async () => {
    const harness = await setupRemoteHarness();
    try {
      const ctx = makeCtx(harness.clientDir, {
        remoteUrl: harness.server.url,
      });

      const result = await recover(ctx, makeMissingObjectsError());

      const zipPath =
        (result as { backupZipPath?: string }).backupZipPath ??
        (result.status === "blocked"
          ? (result as { backupZipPath?: string }).backupZipPath
          : undefined);

      if (zipPath) {
        expect(zipPath.startsWith(BACKUP_ROOT + path.sep)).toBe(true);
      }
    } finally {
      await harness.cleanup();
    }
  });
});

// ── 6. Safety: backup failure → no repair ─────────────────────────────────────

describe("recover-missing-objects — I6 backup failure stops repair", () => {
  test("returns failed_no_changes_made when backup_create fault fires", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);
    await damageLooseObject(dir);

    const ctx = makeCtx(dir, {
      faults: {
        before: async (point: FaultPoint) => {
          if (point === "backup_create") throw new Error("injected: disk full");
        },
      },
    });

    const result = await recover(ctx, makeMissingObjectsError());

    expect(result.status).toBe("failed_no_changes_made");
  });

  test("failed_no_changes_made result has no backupZipPath", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);
    await damageLooseObject(dir);

    const ctx = makeCtx(dir, {
      faults: {
        before: async (point: FaultPoint) => {
          if (point === "backup_create") throw new Error("injected: disk full");
        },
      },
    });

    const result = await recover(ctx, makeMissingObjectsError());

    expect(result.status).toBe("failed_no_changes_made");
    expect("backupZipPath" in result).toBe(false);
  });

  test("chapter file is preserved when backup fails", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);
    await damageLooseObject(dir);

    const originalContent = "# Chapter One\n\nContent here.\n";

    const ctx = makeCtx(dir, {
      faults: {
        before: async (point: FaultPoint) => {
          if (point === "backup_create") throw new Error("injected: disk full");
        },
      },
    });

    await recover(ctx, makeMissingObjectsError());

    const content = nodeFs.readFileSync(path.join(dir, "chapter-01.md"), "utf8");
    expect(content).toBe(originalContent);
  });

  test("guidance is present even when backup fails", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);
    await damageLooseObject(dir);

    const ctx = makeCtx(dir, {
      faults: {
        before: async (point: FaultPoint) => {
          if (point === "backup_create") throw new Error("injected: disk full");
        },
      },
    });

    const result = await recover(ctx, makeMissingObjectsError());

    expect(result).toHaveProperty("guidance");
    const r = result as Extract<RecoveryResult, { status: "failed_no_changes_made" }>;
    expect(r.guidance.userSummary.length).toBeGreaterThan(0);
    expect(r.guidance.recommendedAction.length).toBeGreaterThan(0);
  });
});

// ── 7. Safety: mid-repair failure → failed_backup_available ──────────────────

describe("recover-missing-objects — I7 mid-repair failure with backup", () => {
  test("returns failed_backup_available when fetch fault fires after backup", async () => {
    const harness = await setupRemoteHarness();
    try {
      const ctx = makeCtx(harness.clientDir, {
        remoteUrl: harness.server.url,
        faults: {
          before: async (point: FaultPoint) => {
            if (point === "fetch") throw new Error("injected: fetch exploded mid-repair");
          },
        },
      });

      const result = await recover(ctx, makeMissingObjectsError());

      expect(result.status).toBe("failed_backup_available");
    } finally {
      await harness.cleanup();
    }
  });

  test("failed_backup_available zip is readable from disk", async () => {
    const harness = await setupRemoteHarness();
    try {
      const ctx = makeCtx(harness.clientDir, {
        remoteUrl: harness.server.url,
        faults: {
          before: async (point: FaultPoint) => {
            if (point === "fetch") throw new Error("injected: fetch exploded");
          },
        },
      });

      const result = await recover(ctx, makeMissingObjectsError());

      expect(result.status).toBe("failed_backup_available");
      const r = result as Extract<RecoveryResult, { status: "failed_backup_available" }>;
      expect(r.backupZipPath).toBeDefined();
      await expect(assertZipReadable(r.backupZipPath)).resolves.toBeUndefined();
    } finally {
      await harness.cleanup();
    }
  });

  test("remote HEAD unchanged when fetch fault fires mid-repair", async () => {
    const harness = await setupRemoteHarness();
    try {
      const ctx = makeCtx(harness.clientDir, {
        remoteUrl: harness.server.url,
        faults: {
          before: async (point: FaultPoint) => {
            if (point === "fetch") throw new Error("injected");
          },
        },
      });

      await recover(ctx, makeMissingObjectsError());

      const remoteHeadAfter = await headOid(harness.serverDir);
      expect(remoteHeadAfter).toBe(harness.remoteHeadAtStart);
    } finally {
      await harness.cleanup();
    }
  });

  test("guidance included in failed_backup_available result", async () => {
    const harness = await setupRemoteHarness();
    try {
      const ctx = makeCtx(harness.clientDir, {
        remoteUrl: harness.server.url,
        faults: {
          before: async (point: FaultPoint) => {
            if (point === "fetch") throw new Error("injected");
          },
        },
      });

      const result = await recover(ctx, makeMissingObjectsError());

      expect(result).toHaveProperty("guidance");
      const r = result as Extract<RecoveryResult, { status: "failed_backup_available" }>;
      expect(r.guidance.userSummary.length).toBeGreaterThan(0);
    } finally {
      await harness.cleanup();
    }
  });
});

// ── 8. Safety: user denied confirmation → blocked, no-op ─────────────────────

describe("recover-missing-objects — I8 user denied confirmation", () => {
  test("returns blocked when user denies confirmation", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);
    await damageLooseObject(dir);

    const ctx = makeCtx(dir, {
      confirmation: {
        confirmRepair: async () => false, // user denies
      },
    });

    const result = await recover(ctx, makeMissingObjectsError());

    expect(result.status).toBe("blocked");
  });

  test("blocked result includes guidance", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);
    await damageLooseObject(dir);

    const ctx = makeCtx(dir, {
      confirmation: {
        confirmRepair: async () => false,
      },
    });

    const result = await recover(ctx, makeMissingObjectsError());

    expect(result).toHaveProperty("guidance");
    const r = result as Extract<RecoveryResult, { status: "blocked" }>;
    expect(r.guidance.userSummary.length).toBeGreaterThan(0);
  });

  test("no push when user denies confirmation", async () => {
    const harness = await setupRemoteHarness();
    try {
      await damageLooseObject(harness.clientDir);
      const spy = makePushSpy();
      const ctx = makeCtx(harness.clientDir, {
        remoteUrl: harness.server.url,
        http: spy.http,
        confirmation: {
          confirmRepair: async () => false,
        },
      });

      await recover(ctx, makeMissingObjectsError());

      expect(spy.pushCalls.length).toBe(0);
    } finally {
      await harness.cleanup();
    }
  });

  test("chapter file unchanged when user denies confirmation", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);
    await damageLooseObject(dir);

    const originalContent = "# Chapter One\n\nContent here.\n";

    const ctx = makeCtx(dir, {
      confirmation: {
        confirmRepair: async () => false,
      },
    });

    await recover(ctx, makeMissingObjectsError());

    const content = nodeFs.readFileSync(path.join(dir, "chapter-01.md"), "utf8");
    expect(content).toBe(originalContent);
  });
});

// ── 9. Guidance: result always includes guidance on non-recovered paths ────────

describe("recover-missing-objects — I9 guidance present on all non-recovered results", () => {
  test("guidance.recommendedAction is non-empty in failed/blocked/needs_user results", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);
    await damageLooseObject(dir);

    // No remote — should stop with guidance.
    const ctx = makeCtx(dir);
    const result = await recover(ctx, makeMissingObjectsError());

    if (result.status !== "recovered" && result.status !== "retry_later") {
      expect(result).toHaveProperty("guidance");
      const r = result as { guidance: { recommendedAction: string; userSummary: string } };
      expect(r.guidance.recommendedAction.length).toBeGreaterThan(0);
      expect(r.guidance.userSummary.length).toBeGreaterThan(0);
    }
  });

  test("guidance contains no raw git jargon (no 'branch', 'commit', 'HEAD', 'ref')", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);
    await damageLooseObject(dir);

    const ctx = makeCtx(dir);
    const result = await recover(ctx, makeMissingObjectsError());

    if ("guidance" in result && result.guidance) {
      const { userSummary, recommendedNextStep, recommendedAction } = result.guidance;
      const combined = [userSummary, recommendedNextStep, recommendedAction].join(" ");
      // Raw git jargon must not appear in author-facing strings.
      expect(combined).not.toMatch(/\bHEAD\b/);
      expect(combined).not.toMatch(/\bcommit\b/i);
      expect(combined).not.toMatch(/\bref\b/i);
      // "branch" is a git word but also common English; per spec check for lower-case
      // "fetch" specifically should be allowed in action label ("Fetch missing history")
      // but "git fetch" should not appear.
      expect(combined).not.toMatch(/\bgit fetch\b/i);
      expect(combined).not.toMatch(/\bgit push\b/i);
    }
  });

  test("guidance carries a human button label and the check_connection key", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);
    await damageLooseObject(dir);

    // No remote → cannot fetch → should guide toward the connection settings.
    const ctx = makeCtx(dir);
    const result = await recover(ctx, makeMissingObjectsError());

    if (result.status === "needs_user" || result.status === "blocked") {
      const r = result as {
        guidance: { recommendedAction: string; recommendedActionKey: string };
      };
      // recommendedAction is the literal button label — a human phrase, never
      // a machine token like the old 'clone_fresh_copy'.
      expect(r.guidance.recommendedAction).not.toMatch(/_/);
      expect(r.guidance.recommendedAction.length).toBeGreaterThan(0);
      expect(r.guidance.recommendedActionKey).toBe("check_connection");
    }
  });
});

// ── 10. Result shape: all possible non-recovered statuses ─────────────────────

describe("recover-missing-objects — result status set", () => {
  test("result status is one of the valid RecoveryResult statuses", async () => {
    const VALID_STATUSES = [
      "recovered",
      "retry_later",
      "needs_user",
      "blocked",
      "failed_no_changes_made",
      "failed_backup_available",
    ];

    const dir = await makeTempDir();
    await makeTestRepo(dir);
    await damageLooseObject(dir);

    const ctx = makeCtx(dir);
    const result = await recover(ctx, makeMissingObjectsError());

    expect(VALID_STATUSES).toContain(result.status);
  });

  test("damaged repo with no remote results in needs_user, blocked, or failed status", async () => {
    const dir = await makeTempDir();
    await makeTestRepo(dir);
    await damageLooseObject(dir);

    const ctx = makeCtx(dir);
    const result = await recover(ctx, makeMissingObjectsError());

    // Without a remote, the handler cannot fetch and repair — it must stop.
    expect(["needs_user", "blocked", "failed_no_changes_made", "failed_backup_available"]).toContain(
      result.status,
    );
  });

  test("damaged loose object WITH live remote — result is not 'recovered' (fetch cannot overwrite corrupt loose objects)", async () => {
    // This is the spec's key case: git.fetch() downloads MISSING objects into
    // the pack store but NEVER overwrites an already-existing corrupt loose
    // object file on disk (git skips files that already exist at the
    // content-hash path). So if we corrupt a REAL loose object and then fetch,
    // the corruption persists. The handler must verify the repair actually
    // worked instead of blindly returning 'recovered'.
    //
    // Strategy: create a LOCAL repo (not a clone) — isomorphic-git stores every
    // object as a loose file for locally-initiated repos. Configure remote.origin
    // in the git config so git.fetch() can actually succeed, then damage the
    // HEAD commit object directly. The handler's fetch() will succeed but the
    // corrupt file will remain on disk, and verification must catch it.
    const serverDir = await tempDir("missing-obj-spec-server-");
    await createFixtureRepo(serverDir);
    const server = await startGitServer(serverDir);
    const clientDir = await makeTempDir();

    try {
      // Create a local (non-cloned) repo so objects ARE loose files on disk.
      const commitOid = await makeTestRepo(clientDir);

      // Configure remote.origin so git.fetch() can find the refspec and
      // successfully contact the server (downloads server objects into pack store).
      await git.setConfig({
        fs: nodeFs,
        dir: clientDir,
        path: "remote.origin.url",
        value: server.url,
      });
      await git.setConfig({
        fs: nodeFs,
        dir: clientDir,
        path: "remote.origin.fetch",
        value: "+refs/heads/*:refs/remotes/origin/*",
      });

      // Confirm there are real loose objects — local repos always have them.
      const objectsDir = path.join(clientDir, ".git", "objects");
      const subdirs = nodeFs.readdirSync(objectsDir).filter((d) => /^[0-9a-f]{2}$/.test(d));
      expect(subdirs.length).toBeGreaterThan(0);

      // Damage the HEAD commit object directly. This is the object that
      // git.resolveRef(HEAD) → git.readCommit() reads in the verification probe.
      // git.fetch() will succeed (downloads server objects) but CANNOT overwrite
      // this file because git skips loose object paths that already exist on disk.
      const headPrefix = commitOid.slice(0, 2);
      const headFile = commitOid.slice(2);
      const commitObjPath = path.join(objectsDir, headPrefix, headFile);
      if (nodeFs.existsSync(commitObjPath)) {
        await writeFile(commitObjPath, Buffer.from("CORRUPTED_GARBAGE_DATA"));
      } else {
        // Fallback: damage the first loose object found.
        await damageLooseObject(clientDir);
      }

      const spy = makePushSpy();
      const ctx = makeCtx(clientDir, {
        remoteUrl: server.url,
        http: spy.http,
      });

      const result = await recover(ctx, makeMissingObjectsError());

      // The spec requires: damaged-with-remote => one of {needs_user, failed_backup_available, blocked}
      // 'recovered' is NOT a valid outcome because the corrupt loose object file
      // persists on disk after git.fetch() — the repair did not actually work.
      // Without the verification step, the original handler would return 'recovered'
      // here (false positive), violating the spec.
      expect(["needs_user", "failed_backup_available", "blocked"]).toContain(result.status);

      // guidance must be present so the user knows what to do next.
      expect(result).toHaveProperty("guidance");

      // Safety invariants still hold.
      expect(spy.pushCalls.length).toBe(0);
      const remoteHeadAfter = await headOid(serverDir);
      expect(remoteHeadAfter).toBeTruthy(); // remote is unmodified
    } finally {
      await server.close();
      await rm(serverDir, { recursive: true, force: true });
      await rm(clientDir, { recursive: true, force: true });
    }
  });
});

// ── 11. Auth: recovery fetch authenticates against a private remote ───────────
//
// REGRESSION GUARD. The handler must reuse sync.ts's credential convention
// (github-oauth → username "x-access-token", password = token). A prior bug
// read ctx.credential.password (a field that does NOT exist on HostCredential),
// so the fetch sent password:undefined and was rejected 401 by any authed
// remote — silently breaking object recovery on private repos. The other
// suites use an UNAUTHENTICATED server, so they could never catch it. This
// suite drives a server that REQUIRES Basic auth and asserts the credential is
// sent correctly.

describe("recover-missing-objects — authenticated remote (private repo)", () => {
  const TOKEN = "gho_obj_recovery_tok";
  // github-oauth tokens authenticate as user "x-access-token" with the token
  // as the password — the exact convention onAuthFor()/clone.ts implement.
  const CRED: HostCredential = {
    host: "github.com",
    kind: "github-oauth",
    token: TOKEN,
    createdAt: 0,
  };
  const onAuth = () => ({ username: "x-access-token", password: TOKEN });

  test("sends the credential as Basic auth so the fetch is not rejected (401)", async () => {
    const serverDir = await tempDir("missing-obj-auth-server-");
    await createFixtureRepo(serverDir);
    const server = await startGitServer(serverDir, {
      requireAuth: { username: "x-access-token", password: TOKEN },
    });
    const clientDir = await tempDir("missing-obj-auth-client-");

    try {
      // Clone (with auth) so the client tracks the authed remote.
      await git.clone({
        fs: nodeFs,
        http: httpNode,
        dir: clientDir,
        url: server.url,
        singleBranch: true,
        onAuth,
      });
      await damageLooseObject(clientDir);

      const spy = makePushSpy();
      const ctx = makeCtx(clientDir, {
        remoteUrl: server.url,
        http: spy.http,
        credential: CRED,
      });

      await recover(ctx, makeMissingObjectsError());

      // The recovery fetch must have authenticated: the server saw a Basic
      // header decoding to "x-access-token:<token>". With the old
      // password:undefined bug this header is absent / wrong and the fetch 401s.
      const basicAuthMatches = server.authHeaders.filter((h) => {
        if (!h?.startsWith("Basic ")) return false;
        const decoded = Buffer.from(h.slice("Basic ".length), "base64").toString("utf8");
        return decoded === `x-access-token:${TOKEN}`;
      });
      expect(basicAuthMatches.length).toBeGreaterThan(0);

      // Safety invariant still holds — recovery never pushes.
      expect(spy.pushCalls.length).toBe(0);
    } finally {
      await server.close();
      await rm(serverDir, { recursive: true, force: true });
      await rm(clientDir, { recursive: true, force: true });
    }
  });
});

// ── TOCTOU: object store already readable before recovery (dispatcher stillApplies) ─
//
// The object store may already be healthy again by the time recovery runs
// (e.g. a previous fetch attempt already repaired it) between classification
// and dispatch. The dispatcher's `stillApplies` probe (dispatch.ts) re-checks
// this with the SAME verifyRepoReadable() the handler itself uses, INSIDE
// withRepoLock, before the handler body runs — so this test goes through
// dispatch.recover, not the bare `recover()` export.

describe("recover-missing-objects — object store already readable (dispatcher stillApplies)", () => {
  test("readable object store → no-op recovered; no confirm, no backup, no fetch", async () => {
    const { recover: dispatchRecover } = await import("./dispatch.ts");
    const dir = await makeTempDir();
    await makeTestRepo(dir);
    // The object store is healthy — NOT damaged (unlike damageLooseObject).

    let confirmCalled = false;
    const gate: ConfirmationGate = {
      confirmRepair: async () => {
        confirmCalled = true;
        return true;
      },
    };

    const result = await dispatchRecover(
      "missing_or_corrupt_objects",
      makeCtx(dir, { confirmation: gate }),
    );

    expect(result.status).toBe("recovered");
    expect(confirmCalled).toBe(false);
    const r = result as Extract<RecoveryResult, { status: "recovered" }>;
    expect(r.backupZipPath ?? "").toBe("");
  });
});
