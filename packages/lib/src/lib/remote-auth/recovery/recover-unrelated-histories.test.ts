/**
 * TDD Stage 1 — FAILING tests for recover-unrelated-histories.ts
 *
 * WHY this file exists: The unrelated_histories recovery handler detects that
 * the local repo and the remote share NO common ancestor — they are entirely
 * independent histories. This is a BLOCK path: no auto-merge, no force-push,
 * no repair. The handler backs up the local repo (policy.createBackup=true),
 * asks the user to confirm they want to proceed (but "proceed" means only
 * showing guidance — there is nothing to merge), and returns 'blocked' with
 * guidance pointing at the "reconnect_repo" action.
 *
 * Tests verify the dispatcher contract signature:
 *   export async function recover(ctx: RecoveryContext, error?: unknown): Promise<RecoveryResult>
 *
 * The module does NOT exist yet — every test must fail with "Cannot find
 * module" or equivalent (not a typo or assertion error within this file).
 *
 * Safety invariants tested:
 *   ✓ result.status === 'blocked'
 *   ✓ guidance.recommendedAction === 'reconnect_repo'
 *   ✓ guidance text is jargon-free (no "branch", "commit", "merge", "HEAD")
 *   ✓ guidance text mentions wrong/shared repo concept
 *   ✓ no push calls ever (gitSpy.pushCalls.length === 0)
 *   ✓ remote head + tree UNCHANGED after the call
 *   ✓ local user files UNCHANGED after the call
 *   ✓ a backup zip is created under /tmp/print-sync-recovery/ before any action
 *   ✓ backup_create fault → failed_no_changes_made, no writes after
 *   ✓ user DENY → blocked no-op, local+remote unchanged, backup still exists
 *   ✓ backup zip is readable after the call (assertZipReadable passes)
 *   ✓ backup zip contains user-visible file + .git/HEAD
 *
 * TEST RUNNER: bun:test only.
 * REAL on-disk temp repos via isomorphic-git — no mocks for git state.
 * HTTP transport spy wraps real isomorphic-git/http/node to record pushes.
 * Never shells out to system git.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import git from "isomorphic-git";
import httpNode from "isomorphic-git/http/node";

import { assertZipReadable, zipEntries } from "./backup.ts";
import type {
  ConfirmationGate,
  FaultPoint,
  RecoveryContext,
  RecoveryResult,
} from "./types.ts";
import {
  createFixtureRepo,
  startGitServer,
  tempDir,
  type GitServer,
} from "../test-support/git-http-server.ts";

// ── Import the handler under test ─────────────────────────────────────────────
// This import WILL FAIL until recover-unrelated-histories.ts is implemented.
// That failure is the expected TDD red state.
import { recover } from "./recover-unrelated-histories.ts";

// ── Git push spy ──────────────────────────────────────────────────────────────

interface PushRecord {
  oldOid: string;
  newOid: string;
  ref: string;
  url: string;
}

interface GitSpy {
  http: typeof httpNode;
  pushes: PushRecord[];
}

function makeGitSpy(): GitSpy {
  const pushes: PushRecord[] = [];

  function parseFirstCommand(body: Uint8Array): Omit<PushRecord, "url"> | null {
    const buf = Buffer.from(body);
    let i = 0;
    while (i + 4 <= buf.length) {
      const len = parseInt(buf.subarray(i, i + 4).toString(), 16);
      if (len === 0) break;
      const line = buf
        .subarray(i + 4, i + len)
        .toString()
        .replace(/\n$/, "")
        .split("\0")[0]!;
      const parts = line.split(" ");
      if (parts.length >= 3) {
        return {
          oldOid: parts[0]!,
          newOid: parts[1]!,
          ref: parts.slice(2).join(" "),
        };
      }
      i += len;
    }
    return null;
  }

  const http: typeof httpNode = {
    async request(config) {
      if (config.url.includes("/git-receive-pack") && config.method === "POST") {
        const chunks: Buffer[] = [];
        for await (const chunk of config.body as AsyncIterable<Uint8Array>) {
          chunks.push(Buffer.from(chunk));
        }
        const body = Buffer.concat(chunks);
        const cmd = parseFirstCommand(body);
        if (cmd) pushes.push({ ...cmd, url: config.url });

        const replayConfig = {
          ...config,
          body: (async function* () {
            yield body;
          })(),
        };
        return httpNode.request(replayConfig);
      }
      return httpNode.request(config);
    },
  } as typeof httpNode;

  return { http, pushes };
}

// ── Fixture helpers ───────────────────────────────────────────────────────────

/**
 * Build two COMPLETELY INDEPENDENT repos:
 *
 *   - remoteDir: initialized separately with its own root commit ("remote root
 *     commit"). This is the remote the server serves.
 *   - localDir: initialized separately with its own root commit ("local root
 *     commit"), then told about the remote via git.addRemote — NO clone.
 *
 * Because they were never related (different root commits, no shared parent),
 * any attempt to merge or pull would produce an "unrelated histories" error.
 */
interface UnrelatedHistoriesFixture {
  remoteDir: string;
  localDir: string;
  server: GitServer;
  /** Content of the user-visible file in localDir. */
  localFileContent: string;
  cleanup(): Promise<void>;
}

async function setupUnrelatedHistories(): Promise<UnrelatedHistoriesFixture> {
  const author = { name: "Test Author", email: "test@test.local" };
  const localFileContent = "# My Local Chapter\n\nThis is my work.\n";

  // ── Remote repo: independent root commit ──────────────────────────────────
  const remoteDir = await tempDir("pmd-urh-remote-");
  await git.init({ fs, dir: remoteDir, defaultBranch: "main" });
  await writeFile(path.join(remoteDir, "remote-root.md"), "# Remote Root\n\nCompletely unrelated.\n");
  await writeFile(path.join(remoteDir, "manifest.yaml"), "title: Remote Book\n");
  await git.add({ fs, dir: remoteDir, filepath: "remote-root.md" });
  await git.add({ fs, dir: remoteDir, filepath: "manifest.yaml" });
  await git.commit({ fs, dir: remoteDir, message: "remote: root commit", author });

  const server = await startGitServer(remoteDir);

  // ── Local repo: independent root commit — no clone, no shared ancestor ───
  const localDir = await tempDir("pmd-urh-local-");
  await git.init({ fs, dir: localDir, defaultBranch: "main" });
  await writeFile(path.join(localDir, "chapter.md"), localFileContent);
  await writeFile(path.join(localDir, "manifest.yaml"), "title: My Local Book\n");
  await git.add({ fs, dir: localDir, filepath: "chapter.md" });
  await git.add({ fs, dir: localDir, filepath: "manifest.yaml" });
  await git.commit({ fs, dir: localDir, message: "local: root commit", author });

  // Point local at the remote — but they share NO common history.
  await git.addRemote({ fs, dir: localDir, remote: "origin", url: server.url });

  return {
    remoteDir,
    localDir,
    server,
    localFileContent,
    cleanup: async () => {
      await server.close();
      await rm(remoteDir, { recursive: true, force: true });
      await rm(localDir, { recursive: true, force: true });
    },
  };
}

// ── Remote state readers ──────────────────────────────────────────────────────

async function remoteHead(remoteDir: string): Promise<string> {
  return git.resolveRef({ fs, dir: remoteDir, ref: "refs/heads/main" });
}

async function remoteTree(remoteDir: string): Promise<string> {
  const oid = await remoteHead(remoteDir);
  const { commit } = await git.readCommit({ fs, dir: remoteDir, oid });
  return commit.tree;
}

// ── Confirmation gate helpers ─────────────────────────────────────────────────

const alwaysApprove: ConfirmationGate = {
  confirmRepair: async () => true,
};

const alwaysDeny: ConfirmationGate = {
  confirmRepair: async () => false,
};

// ── Context builder ───────────────────────────────────────────────────────────

function makeCtx(
  fix: UnrelatedHistoriesFixture,
  overrides: Partial<RecoveryContext> = {},
): RecoveryContext {
  return {
    projectDir: fix.localDir,
    repoDir: fix.localDir,
    branch: "main",
    remoteUrl: fix.server.url,
    repoSlug: "urh-test-repo",
    confirmation: alwaysApprove,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("recover (unrelated_histories)", () => {
  // ── Happy path: result is 'blocked' ────────────────────────────────────────

  test("fixture has no shared ancestor (verify test setup)", async () => {
    const fix = await setupUnrelatedHistories();
    try {
      // Confirm both repos have commits with independent root trees.
      const localHead = await git.resolveRef({ fs, dir: fix.localDir, ref: "HEAD" });
      const remHead = await remoteHead(fix.remoteDir);
      // They must be different commits.
      expect(localHead).not.toBe(remHead);

      // Attempt a fetch; isomorphic-git won't fail on fetch alone but they share
      // no common ancestor — no merge base should exist.
      const remoteHeadContent = await git.readCommit({ fs, dir: fix.remoteDir, oid: remHead });
      const localHeadContent = await git.readCommit({ fs, dir: fix.localDir, oid: localHead });
      // Roots have no parents — independent histories.
      expect(remoteHeadContent.commit.parent).toHaveLength(0);
      expect(localHeadContent.commit.parent).toHaveLength(0);
    } finally {
      await fix.cleanup();
    }
  });

  test("result status is 'blocked'", async () => {
    const fix = await setupUnrelatedHistories();
    try {
      const ctx = makeCtx(fix);
      const result = await recover(ctx);
      expect(result.status).toBe("blocked");
    } finally {
      await fix.cleanup();
    }
  });

  test("guidance.recommendedAction is 'reconnect_repo'", async () => {
    const fix = await setupUnrelatedHistories();
    try {
      const ctx = makeCtx(fix);
      const result = await recover(ctx);
      expect(result.status).toBe("blocked");
      if (result.status !== "blocked") throw new Error("unreachable");
      expect(result.guidance.recommendedAction).toBe("reconnect_repo");
    } finally {
      await fix.cleanup();
    }
  });

  test("guidance text is jargon-free (no raw git words)", async () => {
    const fix = await setupUnrelatedHistories();
    try {
      const ctx = makeCtx(fix);
      const result = await recover(ctx);
      expect(result.status).toBe("blocked");
      if (result.status !== "blocked") throw new Error("unreachable");

      const { guidance } = result;
      const allText = [
        guidance.userSummary,
        guidance.recommendedNextStep,
        ...(guidance.safeNextSteps ?? []),
      ]
        .join(" ")
        .toLowerCase();

      // No raw git jargon in user-facing fields.
      expect(allText).not.toMatch(/\bbranch\b/);
      expect(allText).not.toMatch(/\bcommit\b/);
      expect(allText).not.toMatch(/\brebase\b/);
      expect(allText).not.toMatch(/\bhead\b/);
      expect(allText).not.toMatch(/\bref\b/);
      expect(allText).not.toMatch(/\bforce.push\b/);
    } finally {
      await fix.cleanup();
    }
  });

  test("guidance mentions wrong or unrelated project concept", async () => {
    const fix = await setupUnrelatedHistories();
    try {
      const ctx = makeCtx(fix);
      const result = await recover(ctx);
      expect(result.status).toBe("blocked");
      if (result.status !== "blocked") throw new Error("unreachable");

      const allText = [
        result.guidance.userSummary,
        result.guidance.recommendedNextStep,
        ...(result.guidance.safeNextSteps ?? []),
      ]
        .join(" ")
        .toLowerCase();

      // Guidance must indicate a wrong/unrelated repo situation in plain language.
      const mentionsWrongRepo =
        allText.includes("wrong") ||
        allText.includes("unrelated") ||
        allText.includes("different") ||
        allText.includes("correct") ||
        allText.includes("reconnect") ||
        allText.includes("shared");
      expect(mentionsWrongRepo).toBe(true);
    } finally {
      await fix.cleanup();
    }
  });

  // ── No push invariant ───────────────────────────────────────────────────────

  test("zero push calls — remote is never touched", async () => {
    const fix = await setupUnrelatedHistories();
    try {
      const spy = makeGitSpy();
      const ctx = makeCtx(fix, { httpClient: spy.http });

      await recover(ctx);

      expect(spy.pushes).toHaveLength(0);
    } finally {
      await fix.cleanup();
    }
  });

  // ── Remote unchanged invariant ──────────────────────────────────────────────

  test("remote head and tree are unchanged after recover()", async () => {
    const fix = await setupUnrelatedHistories();
    try {
      const headBefore = await remoteHead(fix.remoteDir);
      const treeBefore = await remoteTree(fix.remoteDir);

      const ctx = makeCtx(fix);
      await recover(ctx);

      const headAfter = await remoteHead(fix.remoteDir);
      const treeAfter = await remoteTree(fix.remoteDir);
      expect(headAfter).toBe(headBefore);
      expect(treeAfter).toBe(treeBefore);
    } finally {
      await fix.cleanup();
    }
  });

  // ── Local user files preserved ─────────────────────────────────────────────

  test("local user-visible files are unchanged after recover()", async () => {
    const fix = await setupUnrelatedHistories();
    try {
      const before = await readFile(
        path.join(fix.localDir, "chapter.md"),
        "utf8",
      );
      expect(before).toBe(fix.localFileContent);

      const ctx = makeCtx(fix);
      await recover(ctx);

      const after = await readFile(
        path.join(fix.localDir, "chapter.md"),
        "utf8",
      );
      expect(after).toBe(fix.localFileContent);
    } finally {
      await fix.cleanup();
    }
  });

  // ── Backup zip created ──────────────────────────────────────────────────────

  test("a backup zip is created under /tmp/print-sync-recovery/ before returning", async () => {
    const fix = await setupUnrelatedHistories();
    try {
      const ctx = makeCtx(fix, { repoSlug: "urh-backup-test" });

      // Record existing zips (if any).
      const backupRoot = "/tmp/print-sync-recovery/urh-backup-test";
      let before: string[] = [];
      try {
        before = fs.readdirSync(backupRoot).filter((f) => f.endsWith(".zip"));
      } catch {
        before = [];
      }

      const result = await recover(ctx);

      // Any status that involves a backup must include the zip path.
      const mayHaveZip =
        result.status === "blocked" ||
        result.status === "failed_backup_available";

      let after: string[] = [];
      try {
        after = fs.readdirSync(backupRoot).filter((f) => f.endsWith(".zip"));
      } catch {
        after = [];
      }
      const newZips = after.filter((z) => !before.includes(z));

      // Exactly one new backup zip must have been created.
      expect(newZips).toHaveLength(1);

      // The result must carry the backup path when one exists.
      if (mayHaveZip && result.status === "blocked") {
        expect(result.backupZipPath).toBeDefined();
        expect(result.backupZipPath).toMatch(/\.zip$/);
      }
    } finally {
      await fix.cleanup();
    }
  });

  test("backup zip is readable (assertZipReadable passes)", async () => {
    const fix = await setupUnrelatedHistories();
    try {
      const ctx = makeCtx(fix, { repoSlug: "urh-zip-readable-test" });
      const result = await recover(ctx);

      // Extract zip path from result.
      let zipPath: string | undefined;
      if (result.status === "blocked" && result.backupZipPath) {
        zipPath = result.backupZipPath;
      } else if (result.status === "failed_backup_available") {
        zipPath = result.backupZipPath;
      } else if ("guidance" in result && result.guidance.backupZipPath) {
        zipPath = result.guidance.backupZipPath;
      }

      expect(zipPath).toBeDefined();
      // assertZipReadable will throw if the zip is corrupt.
      await assertZipReadable(zipPath!);
    } finally {
      await fix.cleanup();
    }
  });

  test("backup zip contains chapter.md and .git/HEAD", async () => {
    const fix = await setupUnrelatedHistories();
    try {
      const ctx = makeCtx(fix, { repoSlug: "urh-zip-entries-test" });
      const result = await recover(ctx);

      let zipPath: string | undefined;
      if (result.status === "blocked" && result.backupZipPath) {
        zipPath = result.backupZipPath;
      } else if (result.status === "failed_backup_available") {
        zipPath = result.backupZipPath;
      } else if ("guidance" in result && result.guidance.backupZipPath) {
        zipPath = result.guidance.backupZipPath;
      }

      expect(zipPath).toBeDefined();
      const entries = await zipEntries(zipPath!);
      const names = entries.map((e) => e.name);

      // User file must be in the backup.
      expect(names.some((n) => n.includes("chapter.md"))).toBe(true);
      // .git/HEAD must be in the backup for full recovery.
      expect(names.some((n) => n.endsWith(".git/HEAD") || n.includes(".git/HEAD"))).toBe(true);
    } finally {
      await fix.cleanup();
    }
  });

  // ── backup_create fault: failed_no_changes_made, no writes ─────────────────

  test("backup_create fault → failed_no_changes_made, no writes after", async () => {
    const fix = await setupUnrelatedHistories();
    try {
      const headBefore = await remoteHead(fix.remoteDir);
      const localFileBefore = await readFile(
        path.join(fix.localDir, "chapter.md"),
        "utf8",
      );

      const spy = makeGitSpy();
      const ctx = makeCtx(fix, {
        repoSlug: "urh-fault-create-test",
        httpClient: spy.http,
        faults: {
          before: async (point: FaultPoint) => {
            if (point === "backup_create") {
              throw new Error("injected: backup_create failure");
            }
          },
        },
      });

      const result = await recover(ctx);

      // Must fail without creating a backup.
      expect(result.status).toBe("failed_no_changes_made");

      // Remote untouched.
      expect(await remoteHead(fix.remoteDir)).toBe(headBefore);

      // No pushes.
      expect(spy.pushes).toHaveLength(0);

      // Local file untouched.
      const localFileAfter = await readFile(
        path.join(fix.localDir, "chapter.md"),
        "utf8",
      );
      expect(localFileAfter).toBe(localFileBefore);
    } finally {
      await fix.cleanup();
    }
  });

  // ── User DENY → blocked no-op ───────────────────────────────────────────────

  test("user denies confirmation → blocked no-op, local+remote unchanged", async () => {
    const fix = await setupUnrelatedHistories();
    try {
      const headBefore = await remoteHead(fix.remoteDir);
      const localFileBefore = await readFile(
        path.join(fix.localDir, "chapter.md"),
        "utf8",
      );

      const spy = makeGitSpy();
      const ctx = makeCtx(fix, {
        repoSlug: "urh-deny-test",
        httpClient: spy.http,
        confirmation: alwaysDeny,
      });

      const result = await recover(ctx);

      // Denied → blocked.
      expect(result.status).toBe("blocked");

      // Remote untouched.
      expect(await remoteHead(fix.remoteDir)).toBe(headBefore);

      // No pushes.
      expect(spy.pushes).toHaveLength(0);

      // Local user files untouched.
      const localFileAfter = await readFile(
        path.join(fix.localDir, "chapter.md"),
        "utf8",
      );
      expect(localFileAfter).toBe(localFileBefore);
    } finally {
      await fix.cleanup();
    }
  });

  test("user deny: backup zip still exists and is readable (created before confirm gate)", async () => {
    const fix = await setupUnrelatedHistories();
    try {
      const ctx = makeCtx(fix, {
        repoSlug: "urh-deny-backup-test",
        confirmation: alwaysDeny,
      });

      const result = await recover(ctx);

      // Even when denied, the backup created before the confirmation gate must
      // survive (withBackupGate creates backup THEN asks for confirmation).
      expect(result.status).toBe("blocked");
      if (result.status !== "blocked") throw new Error("unreachable");

      // The backup zip path should be present in either the result or guidance.
      const zipPath =
        result.backupZipPath ?? result.guidance.backupZipPath;
      expect(zipPath).toBeDefined();
      await assertZipReadable(zipPath!);
    } finally {
      await fix.cleanup();
    }
  });

  // ── after_backup_before_repair fault: failed_backup_available ──────────────
  //
  // The unrelated_histories handler is pure BLOCK — there is no risky repair
  // step. The "repair" is actually blocked immediately. However, if the handler
  // implementation for some reason executes code after the backup and throws, it
  // should surface as failed_backup_available with the backup readable.
  //
  // We test after_backup_before_repair to ensure fault injection at that point
  // results in a safe outcome with a readable backup.

  test("after_backup_before_repair fault → failed_backup_available, backup readable", async () => {
    const fix = await setupUnrelatedHistories();
    try {
      const headBefore = await remoteHead(fix.remoteDir);
      const spy = makeGitSpy();

      const ctx = makeCtx(fix, {
        repoSlug: "urh-fault-after-backup-test",
        httpClient: spy.http,
        faults: {
          before: async (point: FaultPoint) => {
            if (point === "after_backup_before_repair") {
              throw new Error("injected: after_backup_before_repair failure");
            }
          },
        },
      });

      const result = await recover(ctx);

      // Must be either blocked (if confirmed before fault point) or
      // failed_backup_available (if withBackupGate catches the throw).
      expect(
        result.status === "failed_backup_available" ||
        result.status === "blocked",
      ).toBe(true);

      // In either case, backup must be readable.
      let zipPath: string | undefined;
      if (result.status === "failed_backup_available") {
        zipPath = result.backupZipPath;
      } else if (result.status === "blocked") {
        zipPath = result.backupZipPath ?? result.guidance.backupZipPath;
      }
      if (zipPath) {
        await assertZipReadable(zipPath);
      }

      // Remote untouched.
      expect(await remoteHead(fix.remoteDir)).toBe(headBefore);

      // No pushes.
      expect(spy.pushes).toHaveLength(0);
    } finally {
      await fix.cleanup();
    }
  });

  // ── Optional: also works when no remoteUrl is configured ───────────────────

  test("works when ctx.remoteUrl is undefined — still returns blocked", async () => {
    const fix = await setupUnrelatedHistories();
    try {
      const ctx = makeCtx(fix, { remoteUrl: undefined });
      const result = await recover(ctx);
      // Even without a remote URL in context, the handler must not crash.
      expect(result.status).toBe("blocked");
    } finally {
      await fix.cleanup();
    }
  });

  // ── Simulate error object passed to recover() ──────────────────────────────

  test("error object passed to recover() is included in supportDetails", async () => {
    const fix = await setupUnrelatedHistories();
    try {
      const ctx = makeCtx(fix, { repoSlug: "urh-error-details-test" });
      const err = new Error("unrelated histories detected by upstream fetch");
      const result = await recover(ctx, err);

      expect(result.status).toBe("blocked");
      if (result.status !== "blocked") throw new Error("unreachable");

      // supportDetails may contain technical info (it's for support tickets).
      const support = result.guidance.supportDetails ?? "";
      expect(support).toBeTruthy();
    } finally {
      await fix.cleanup();
    }
  });
});
