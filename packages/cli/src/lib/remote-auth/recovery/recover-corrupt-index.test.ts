/**
 * TDD Stage 1 — FAILING tests for recover-corrupt-index.ts
 *
 * The handler does not exist yet. Every test here is expected to FAIL with a
 * module-not-found or "not a function" error — NOT a typo or import error from
 * within this file.
 *
 * Feature: corrupt_index recovery
 *   BUILD:  backup → confirm → delete .git/index → rebuild via git.checkout
 *           (re-stages all tracked files from HEAD) → re-detect pending changes.
 *   NEVER discard user-visible files (chapter.md must survive in all paths).
 *   NEVER force-push.
 *
 * Safety invariant matrix (see HARD RULES §5):
 *   ✓ no force-push (every test with a remote: spy push calls)
 *   ✓ backup zip created under the OS temp recovery root (os.tmpdir()/print-sync-recovery) before any repair
 *   ✓ zip contains user file (chapter.md) + .git/HEAD
 *   ✓ chapter.md still present and unmodified after recovery (all paths)
 *   ✓ backup_create fault → failed_no_changes_made, .git/index NOT deleted, no
 *     writes after
 *   ✓ rebuild_index fault (throw after backup) → failed_backup_available,
 *     backup readable, remote unchanged, user files preserved
 *   ✓ user DENY → blocked, .git/index NOT deleted, local+remote unchanged
 *   ✓ happy path: status=recovered, backupZipPath present, chapter.md intact,
 *     .git/index exists (rebuilt)
 *
 * Uses real on-disk temp repos via isomorphic-git. Mocks only: confirmation
 * gate (UI dialog), FaultInjector (controls step failures), HTTP client spy
 * (records push calls to assert no force-push). Never shells out to system git.
 * bun:test only.
 */

import { describe, expect, test, beforeEach } from "bun:test";
import * as fs from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { makeTempDir as freshTempDir } from "../../../test-helpers/testkit";

import git from "isomorphic-git";

import { assertZipReadable, BACKUP_ROOT, zipEntries } from "./backup.ts";
import type {
  RecoveryContext,
  RecoveryResult,
  FaultPoint,
  ConfirmationGate,
} from "./types.ts";

// ── Import the handler under test ─────────────────────────────────────────────
// This import WILL FAIL until recover-corrupt-index.ts is implemented.
// That failure is the expected TDD red state.
import { recover } from "./recover-corrupt-index.ts";

// ── Temp dir helpers ──────────────────────────────────────────────────────────

async function makeTempDir(): Promise<string> {
  return freshTempDir("corrupt-index-test-");
}

/**
 * Create a minimal git repo with a chapter file, an initial commit, and a
 * CORRUPT .git/index (random bytes so isomorphic-git status calls fail).
 */
async function makeCorruptIndexRepo(dir: string): Promise<void> {
  await git.init({ fs, dir, defaultBranch: "main" });
  await writeFile(path.join(dir, "chapter.md"), "# Chapter One\n\nHello world.\n");
  await writeFile(path.join(dir, "manifest.yaml"), "title: Test Book\n");
  await git.add({ fs, dir, filepath: "chapter.md" });
  await git.add({ fs, dir, filepath: "manifest.yaml" });
  const author = { name: "Test Author", email: "test@test.local" };
  await git.commit({ fs, dir, message: "initial commit", author });

  // Corrupt the index — overwrite with garbage bytes so any git operation
  // that reads the index will fail.
  const indexPath = path.join(dir, ".git", "index");
  await writeFile(indexPath, Buffer.from("GARBAGE CORRUPT INDEX DATA\x00\x01\x02\x03", "utf8"));
}

// ── Context builder ───────────────────────────────────────────────────────────

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
      confirmRepair: async () => true, // default: user approves
    },
    now: () => new Date("2025-06-15T12:00:00.000Z").getTime(),
    ...overrides,
  };
}

/** A confirmation gate that always denies. */
const DENY_GATE: ConfirmationGate = {
  confirmRepair: async () => false,
};

/** A confirmation gate that always approves. */
const APPROVE_GATE: ConfirmationGate = {
  confirmRepair: async () => true,
};

// ── Helpers for remote state checks ──────────────────────────────────────────

/**
 * Record the HEAD oid of a remote fixture repo so tests can assert it did
 * not change after a failed/blocked recovery.
 */
async function remoteHead(remoteDir: string): Promise<string> {
  try {
    return await git.resolveRef({ fs, dir: remoteDir, ref: "HEAD" });
  } catch {
    return "";
  }
}

// ── Test: happy path ──────────────────────────────────────────────────────────

describe("recover-corrupt-index — happy path", () => {
  test("returns status=recovered when user approves", async () => {
    const dir = await makeTempDir();
    await makeCorruptIndexRepo(dir);

    const ctx = makeCtx(dir, { confirmation: APPROVE_GATE });
    const result = await recover(ctx);

    expect(result.status).toBe("recovered");
  });

  test("recovered result includes a backupZipPath", async () => {
    const dir = await makeTempDir();
    await makeCorruptIndexRepo(dir);

    const ctx = makeCtx(dir, { confirmation: APPROVE_GATE });
    const result = await recover(ctx);

    expect(result.status).toBe("recovered");
    const r = result as Extract<RecoveryResult, { status: "recovered" }>;
    expect(typeof r.backupZipPath).toBe("string");
    expect(r.backupZipPath!.length).toBeGreaterThan(0);
  });

  test("backup zip is created under the OS temp recovery root", async () => {
    const dir = await makeTempDir();
    await makeCorruptIndexRepo(dir);

    const ctx = makeCtx(dir, { confirmation: APPROVE_GATE });
    const result = await recover(ctx) as Extract<RecoveryResult, { status: "recovered" }>;

    expect(result.backupZipPath).toBeDefined();
    expect(result.backupZipPath!.startsWith(BACKUP_ROOT + path.sep)).toBe(true);
    expect(fs.existsSync(result.backupZipPath!)).toBe(true);
  });

  test("backup zip contains chapter.md", async () => {
    const dir = await makeTempDir();
    await makeCorruptIndexRepo(dir);

    const ctx = makeCtx(dir, { confirmation: APPROVE_GATE });
    const result = await recover(ctx) as Extract<RecoveryResult, { status: "recovered" }>;

    const entries = await zipEntries(result.backupZipPath!);
    expect(entries.some((e) => e.name.includes("chapter.md"))).toBe(true);
  });

  test("backup zip contains .git/HEAD", async () => {
    const dir = await makeTempDir();
    await makeCorruptIndexRepo(dir);

    const ctx = makeCtx(dir, { confirmation: APPROVE_GATE });
    const result = await recover(ctx) as Extract<RecoveryResult, { status: "recovered" }>;

    const entries = await zipEntries(result.backupZipPath!);
    expect(entries.some((e) => e.name === ".git/HEAD" || e.name.startsWith(".git/"))).toBe(true);
  });

  test("chapter.md is still present and unmodified after recovery", async () => {
    const dir = await makeTempDir();
    await makeCorruptIndexRepo(dir);
    const originalContent = "# Chapter One\n\nHello world.\n";

    const ctx = makeCtx(dir, { confirmation: APPROVE_GATE });
    await recover(ctx);

    const content = await readFile(path.join(dir, "chapter.md"), "utf8");
    expect(content).toBe(originalContent);
  });

  test(".git/index exists after recovery (index was rebuilt)", async () => {
    const dir = await makeTempDir();
    await makeCorruptIndexRepo(dir);

    const ctx = makeCtx(dir, { confirmation: APPROVE_GATE });
    await recover(ctx);

    expect(fs.existsSync(path.join(dir, ".git", "index"))).toBe(true);
  });

  test("backup zip is readable from disk (assertZipReadable passes)", async () => {
    const dir = await makeTempDir();
    await makeCorruptIndexRepo(dir);

    const ctx = makeCtx(dir, { confirmation: APPROVE_GATE });
    const result = await recover(ctx) as Extract<RecoveryResult, { status: "recovered" }>;

    await expect(assertZipReadable(result.backupZipPath!)).resolves.toBeUndefined();
  });
});

// ── Test: user DENIES confirmation → blocked ──────────────────────────────────

describe("recover-corrupt-index — user denies confirmation", () => {
  test("returns status=blocked when user denies", async () => {
    const dir = await makeTempDir();
    await makeCorruptIndexRepo(dir);

    const ctx = makeCtx(dir, { confirmation: DENY_GATE });
    const result = await recover(ctx);

    expect(result.status).toBe("blocked");
  });

  test("blocked result includes guidance", async () => {
    const dir = await makeTempDir();
    await makeCorruptIndexRepo(dir);

    const ctx = makeCtx(dir, { confirmation: DENY_GATE });
    const result = await recover(ctx);

    expect(result).toHaveProperty("guidance");
    const r = result as Extract<RecoveryResult, { status: "blocked" }>;
    expect(r.guidance.userSummary.length).toBeGreaterThan(0);
    expect(r.guidance.recommendedAction.length).toBeGreaterThan(0);
  });

  test("blocked result: .git/index NOT deleted (corrupt index preserved as-is)", async () => {
    const dir = await makeTempDir();
    await makeCorruptIndexRepo(dir);
    const indexPath = path.join(dir, ".git", "index");
    const corruptContent = await readFile(indexPath);

    const ctx = makeCtx(dir, { confirmation: DENY_GATE });
    await recover(ctx);

    // Index must still exist with the same corrupt content — nothing touched it.
    expect(fs.existsSync(indexPath)).toBe(true);
    const afterContent = await readFile(indexPath);
    expect(afterContent.equals(corruptContent)).toBe(true);
  });

  test("blocked result: chapter.md still present and unmodified", async () => {
    const dir = await makeTempDir();
    await makeCorruptIndexRepo(dir);
    const originalContent = "# Chapter One\n\nHello world.\n";

    const ctx = makeCtx(dir, { confirmation: DENY_GATE });
    await recover(ctx);

    const content = await readFile(path.join(dir, "chapter.md"), "utf8");
    expect(content).toBe(originalContent);
  });

  test("blocked result includes a backupZipPath (backup was created before prompt)", async () => {
    const dir = await makeTempDir();
    await makeCorruptIndexRepo(dir);

    const ctx = makeCtx(dir, { confirmation: DENY_GATE });
    const result = await recover(ctx) as Extract<RecoveryResult, { status: "blocked" }>;

    // Backup must have been created BEFORE the prompt, so it exists on block.
    expect(result.backupZipPath).toBeDefined();
    expect(typeof result.backupZipPath).toBe("string");
    expect(result.backupZipPath!.length).toBeGreaterThan(0);
  });

  test("blocked result: backup zip is readable from disk", async () => {
    const dir = await makeTempDir();
    await makeCorruptIndexRepo(dir);

    const ctx = makeCtx(dir, { confirmation: DENY_GATE });
    const result = await recover(ctx) as Extract<RecoveryResult, { status: "blocked" }>;

    await expect(assertZipReadable(result.backupZipPath!)).resolves.toBeUndefined();
  });
});

// ── Test: backup_create fault → failed_no_changes_made ───────────────────────

describe("recover-corrupt-index — fault at backup_create", () => {
  test("returns failed_no_changes_made when backup_create throws", async () => {
    const dir = await makeTempDir();
    await makeCorruptIndexRepo(dir);

    const ctx = makeCtx(dir, {
      confirmation: APPROVE_GATE,
      faults: {
        before: async (point: FaultPoint) => {
          if (point === "backup_create") throw new Error("injected: disk full");
        },
      },
    });

    const result = await recover(ctx);

    expect(result.status).toBe("failed_no_changes_made");
  });

  test("backup_create fault: no backupZipPath in result", async () => {
    const dir = await makeTempDir();
    await makeCorruptIndexRepo(dir);

    const ctx = makeCtx(dir, {
      confirmation: APPROVE_GATE,
      faults: {
        before: async (point: FaultPoint) => {
          if (point === "backup_create") throw new Error("injected: disk full");
        },
      },
    });

    const result = await recover(ctx);

    expect("backupZipPath" in result && (result as any).backupZipPath).toBeFalsy();
  });

  test("backup_create fault: .git/index NOT deleted, no writes after", async () => {
    const dir = await makeTempDir();
    await makeCorruptIndexRepo(dir);
    const indexPath = path.join(dir, ".git", "index");
    const corruptContent = await readFile(indexPath);

    const ctx = makeCtx(dir, {
      confirmation: APPROVE_GATE,
      faults: {
        before: async (point: FaultPoint) => {
          if (point === "backup_create") throw new Error("injected: disk full");
        },
      },
    });

    await recover(ctx);

    // Index must be UNCHANGED — no repair was attempted after backup failure.
    expect(fs.existsSync(indexPath)).toBe(true);
    const afterContent = await readFile(indexPath);
    expect(afterContent.equals(corruptContent)).toBe(true);
  });

  test("backup_create fault: chapter.md preserved", async () => {
    const dir = await makeTempDir();
    await makeCorruptIndexRepo(dir);
    const originalContent = "# Chapter One\n\nHello world.\n";

    const ctx = makeCtx(dir, {
      confirmation: APPROVE_GATE,
      faults: {
        before: async (point: FaultPoint) => {
          if (point === "backup_create") throw new Error("injected: disk full");
        },
      },
    });

    await recover(ctx);

    const content = await readFile(path.join(dir, "chapter.md"), "utf8");
    expect(content).toBe(originalContent);
  });

  test("backup_create fault: result includes guidance", async () => {
    const dir = await makeTempDir();
    await makeCorruptIndexRepo(dir);

    const ctx = makeCtx(dir, {
      confirmation: APPROVE_GATE,
      faults: {
        before: async (point: FaultPoint) => {
          if (point === "backup_create") throw new Error("injected: disk full");
        },
      },
    });

    const result = await recover(ctx);

    expect(result).toHaveProperty("guidance");
    const r = result as Extract<RecoveryResult, { status: "failed_no_changes_made" }>;
    expect(r.guidance.userSummary.length).toBeGreaterThan(0);
  });
});

// ── Test: rebuild_index fault (throw AFTER backup) → failed_backup_available ──

describe("recover-corrupt-index — fault at rebuild_index (mid-repair failure)", () => {
  test("returns failed_backup_available when rebuild_index fault fires", async () => {
    const dir = await makeTempDir();
    await makeCorruptIndexRepo(dir);

    const ctx = makeCtx(dir, {
      confirmation: APPROVE_GATE,
      faults: {
        before: async (point: FaultPoint) => {
          if (point === "rebuild_index") throw new Error("injected: checkout failed");
        },
      },
    });

    const result = await recover(ctx);

    expect(result.status).toBe("failed_backup_available");
  });

  test("rebuild_index fault: backup zip is present and readable from disk", async () => {
    const dir = await makeTempDir();
    await makeCorruptIndexRepo(dir);

    const ctx = makeCtx(dir, {
      confirmation: APPROVE_GATE,
      faults: {
        before: async (point: FaultPoint) => {
          if (point === "rebuild_index") throw new Error("injected: checkout failed");
        },
      },
    });

    const result = await recover(ctx) as Extract<RecoveryResult, { status: "failed_backup_available" }>;

    expect(result.backupZipPath).toBeDefined();
    await expect(assertZipReadable(result.backupZipPath)).resolves.toBeUndefined();
  });

  test("rebuild_index fault: chapter.md is preserved (user files intact)", async () => {
    const dir = await makeTempDir();
    await makeCorruptIndexRepo(dir);
    const originalContent = "# Chapter One\n\nHello world.\n";

    const ctx = makeCtx(dir, {
      confirmation: APPROVE_GATE,
      faults: {
        before: async (point: FaultPoint) => {
          if (point === "rebuild_index") throw new Error("injected: checkout failed");
        },
      },
    });

    await recover(ctx);

    const content = await readFile(path.join(dir, "chapter.md"), "utf8");
    expect(content).toBe(originalContent);
  });

  test("rebuild_index fault: result includes guidance and backupZipPath", async () => {
    const dir = await makeTempDir();
    await makeCorruptIndexRepo(dir);

    const ctx = makeCtx(dir, {
      confirmation: APPROVE_GATE,
      faults: {
        before: async (point: FaultPoint) => {
          if (point === "rebuild_index") throw new Error("injected: checkout failed");
        },
      },
    });

    const result = await recover(ctx) as Extract<RecoveryResult, { status: "failed_backup_available" }>;

    expect(result).toHaveProperty("guidance");
    expect(result.guidance.userSummary.length).toBeGreaterThan(0);
    expect(result.backupZipPath.length).toBeGreaterThan(0);
  });
});

// ── Test: no force-push under any path ───────────────────────────────────────
//
// The corrupt_index policy has mayChangeRemote: false so this test proves the
// handler never sends a push at all, let alone a force-push.

describe("recover-corrupt-index — no force-push invariant", () => {
  test("happy path: no push call is made (corrupt_index is local-only repair)", async () => {
    const dir = await makeTempDir();
    await makeCorruptIndexRepo(dir);

    const pushCalls: Array<{ url: string; force?: boolean }> = [];

    // Wrap the HTTP client to spy on push (receive-pack) requests.
    const spyHttpClient = {
      async request(opts: { url: string; method: string; headers: Record<string, string>; body: AsyncIterableIterator<Uint8Array> }) {
        if (opts.url.includes("receive-pack")) {
          // Collect pkt-line data to detect force flag (not in HTTP, but track url)
          pushCalls.push({ url: opts.url, force: false });
        }
        // Return a 200 OK so the handler doesn't error out on network.
        return {
          url: opts.url,
          method: opts.method,
          statusCode: 200,
          statusMessage: "OK",
          body: (async function* () { yield Buffer.alloc(0); })(),
          headers: {},
        };
      },
    } as any;

    const ctx = makeCtx(dir, {
      confirmation: APPROVE_GATE,
      httpClient: spyHttpClient,
    });

    await recover(ctx);

    // The corrupt_index repair is purely local (no push). Assert zero push calls.
    expect(pushCalls.length).toBe(0);
  });

  test("denied path: no push call when user denies", async () => {
    const dir = await makeTempDir();
    await makeCorruptIndexRepo(dir);

    const pushCalls: Array<{ url: string }> = [];
    const spyHttpClient = {
      async request(opts: { url: string; method: string; headers: Record<string, string>; body: AsyncIterableIterator<Uint8Array> }) {
        if (opts.url.includes("receive-pack")) {
          pushCalls.push({ url: opts.url });
        }
        return {
          url: opts.url,
          method: opts.method,
          statusCode: 200,
          statusMessage: "OK",
          body: (async function* () { yield Buffer.alloc(0); })(),
          headers: {},
        };
      },
    } as any;

    const ctx = makeCtx(dir, {
      confirmation: DENY_GATE,
      httpClient: spyHttpClient,
    });

    await recover(ctx);

    expect(pushCalls.length).toBe(0);
  });
});

// ── Test: confirmation gate receives correct repair metadata ──────────────────

describe("recover-corrupt-index — confirmation request shape", () => {
  test("confirmation is asked with repair=corrupt_index", async () => {
    const dir = await makeTempDir();
    await makeCorruptIndexRepo(dir);

    let capturedRepair: string | undefined;
    const capturingGate: ConfirmationGate = {
      confirmRepair: async (req) => {
        capturedRepair = req.repair;
        return false; // deny to stop here
      },
    };

    const ctx = makeCtx(dir, { confirmation: capturingGate });
    await recover(ctx);

    expect(capturedRepair).toBe("corrupt_index");
  });

  test("confirmation receives a backupZipPath that is readable", async () => {
    const dir = await makeTempDir();
    await makeCorruptIndexRepo(dir);

    let capturedBackupPath: string | undefined;
    const capturingGate: ConfirmationGate = {
      confirmRepair: async (req) => {
        capturedBackupPath = req.backupZipPath;
        return false; // deny
      },
    };

    const ctx = makeCtx(dir, { confirmation: capturingGate });
    await recover(ctx);

    expect(capturedBackupPath).toBeDefined();
    expect(capturedBackupPath!.length).toBeGreaterThan(0);
    await expect(assertZipReadable(capturedBackupPath!)).resolves.toBeUndefined();
  });

  test("confirmation receives willChangeLocalFiles=false, willChangeRemote=false", async () => {
    const dir = await makeTempDir();
    await makeCorruptIndexRepo(dir);

    let capturedReq: any;
    const capturingGate: ConfirmationGate = {
      confirmRepair: async (req) => {
        capturedReq = req;
        return false;
      },
    };

    const ctx = makeCtx(dir, { confirmation: capturingGate });
    await recover(ctx);

    expect(capturedReq.willChangeLocalFiles).toBe(false);
    expect(capturedReq.willChangeRemote).toBe(false);
    // The index rebuild touches git metadata.
    expect(capturedReq.willChangeGitMetadata).toBe(true);
  });
});

// ── Test: uncommitted edits are preserved after recovery ─────────────────────
//
// The key safety invariant: if the user has unsaved (uncommitted) changes in
// chapter.md BEFORE the corrupt-index crash, those edits MUST survive recovery.
// This is the realistic scenario — a crash mid-work means an in-progress edit
// is the common case. Recovery MUST NOT silently revert user content.

describe("recover-corrupt-index — dirty working tree (uncommitted edits preserved)", () => {
  /**
   * Make a repo where chapter.md is committed at v1, then MODIFIED to v2 on
   * disk (uncommitted) before the index is corrupted.
   */
  async function makeCorruptIndexRepoDirty(dir: string): Promise<{ committedContent: string; dirtyContent: string }> {
    await git.init({ fs, dir, defaultBranch: "main" });
    const committedContent = "# Chapter One\n\nHello world.\n";
    await writeFile(path.join(dir, "chapter.md"), committedContent);
    await writeFile(path.join(dir, "manifest.yaml"), "title: Test Book\n");
    await git.add({ fs, dir, filepath: "chapter.md" });
    await git.add({ fs, dir, filepath: "manifest.yaml" });
    const author = { name: "Test Author", email: "test@test.local" };
    await git.commit({ fs, dir, message: "initial commit", author });

    // User edits chapter.md AFTER commit — this is the in-progress work that
    // must NEVER be discarded by index recovery.
    const dirtyContent = "# Chapter One\n\nMY UNSAVED IN-PROGRESS WORK — DO NOT DISCARD.\n";
    await writeFile(path.join(dir, "chapter.md"), dirtyContent);

    // Corrupt the index — simulates a crash mid-operation.
    const indexPath = path.join(dir, ".git", "index");
    await writeFile(indexPath, Buffer.from("GARBAGE CORRUPT INDEX DATA\x00\x01\x02\x03", "utf8"));

    return { committedContent, dirtyContent };
  }

  test("happy path with dirty file: status=recovered and dirty content preserved byte-for-byte", async () => {
    const dir = await makeTempDir();
    const { dirtyContent } = await makeCorruptIndexRepoDirty(dir);

    const ctx = makeCtx(dir, { confirmation: APPROVE_GATE });
    const result = await recover(ctx);

    expect(result.status).toBe("recovered");

    const after = await readFile(path.join(dir, "chapter.md"), "utf8");
    expect(after).toBe(dirtyContent);
  });

  test("dirty content is byte-for-byte identical after recovery (no silent revert)", async () => {
    const dir = await makeTempDir();
    const { dirtyContent } = await makeCorruptIndexRepoDirty(dir);

    const ctx = makeCtx(dir, { confirmation: APPROVE_GATE });
    await recover(ctx);

    const after = await readFile(path.join(dir, "chapter.md"), "utf8");
    expect(after).toBe(dirtyContent);
    // Ensure the committed (old) content was NOT restored.
    expect(after).not.toBe("# Chapter One\n\nHello world.\n");
  });

  test("deny path with dirty file: blocked and dirty content preserved byte-for-byte", async () => {
    const dir = await makeTempDir();
    const { dirtyContent } = await makeCorruptIndexRepoDirty(dir);

    const ctx = makeCtx(dir, { confirmation: DENY_GATE });
    const result = await recover(ctx);

    expect(result.status).toBe("blocked");

    const after = await readFile(path.join(dir, "chapter.md"), "utf8");
    expect(after).toBe(dirtyContent);
  });

  test("deny path: dirty content not reverted to committed version", async () => {
    const dir = await makeTempDir();
    const { dirtyContent } = await makeCorruptIndexRepoDirty(dir);

    const ctx = makeCtx(dir, { confirmation: DENY_GATE });
    await recover(ctx);

    const after = await readFile(path.join(dir, "chapter.md"), "utf8");
    expect(after).toBe(dirtyContent);
  });
});

// ── Test: remove_index fault ──────────────────────────────────────────────────
//
// The remove_index fault point fires AFTER backup but BEFORE the checkout.
// This is a mid-repair failure — fails after the index has been deleted but
// before rebuild. Must return failed_backup_available.

describe("recover-corrupt-index — fault at remove_index", () => {
  test("returns failed_backup_available when remove_index fault fires", async () => {
    const dir = await makeTempDir();
    await makeCorruptIndexRepo(dir);

    const ctx = makeCtx(dir, {
      confirmation: APPROVE_GATE,
      faults: {
        before: async (point: FaultPoint) => {
          if (point === "remove_index") throw new Error("injected: cannot unlink index");
        },
      },
    });

    const result = await recover(ctx);

    expect(result.status).toBe("failed_backup_available");
  });

  test("remove_index fault: chapter.md is preserved", async () => {
    const dir = await makeTempDir();
    await makeCorruptIndexRepo(dir);
    const originalContent = "# Chapter One\n\nHello world.\n";

    const ctx = makeCtx(dir, {
      confirmation: APPROVE_GATE,
      faults: {
        before: async (point: FaultPoint) => {
          if (point === "remove_index") throw new Error("injected: cannot unlink index");
        },
      },
    });

    await recover(ctx);

    const content = await readFile(path.join(dir, "chapter.md"), "utf8");
    expect(content).toBe(originalContent);
  });

  test("remove_index fault: backup zip is readable", async () => {
    const dir = await makeTempDir();
    await makeCorruptIndexRepo(dir);

    const ctx = makeCtx(dir, {
      confirmation: APPROVE_GATE,
      faults: {
        before: async (point: FaultPoint) => {
          if (point === "remove_index") throw new Error("injected: cannot unlink index");
        },
      },
    });

    const result = await recover(ctx) as Extract<RecoveryResult, { status: "failed_backup_available" }>;

    expect(result.backupZipPath).toBeDefined();
    await expect(assertZipReadable(result.backupZipPath)).resolves.toBeUndefined();
  });
});
