/**
 * Tests for recover-unrelated-histories.ts
 *
 * The unrelated_histories recovery handler combines local and remote when they
 * share no common ancestor. The handler:
 *   1. Creates a backup (policy.createBackup=true).
 *   2. Asks the user to confirm.
 *   3. Saves current HEAD to a temporary branch.
 *   4. Moves the working branch to the remote's HEAD.
 *   5. Merges with allowUnrelatedHistories.
 *   6. On file conflicts → squash: all local changes as one commit.
 *
 * Safety invariants tested:
 *   ✓ Clean merge → recovered with combined content
 *   ✓ File conflicts → needs_user with ConflictFile[] + localId/remoteId
 *   ✓ resolveConflicts 'mine' → keeps local version, no markers
 *   ✓ resolveConflicts 'theirs' → keeps remote version, no markers
 *   ✓ resolveConflicts 'both' → keeps local + writes (online copy)
 *   ✓ resolveConflicts → two-parent merge commit (both histories intact)
 *   ✓ No remoteUrl → blocked
 *   ✓ User DENY → blocked, local+remote unchanged
 *   ✓ backup_create fault → failed_no_changes_made, no writes after
 *   ✓ Remote head + tree UNCHANGED after the handler (push is in resolveConflicts)
 *   ✓ Zero push calls from the handler itself
 *   ✓ Backup zip created, readable, contains user files
 *   ✓ Guidance text is jargon-free
 *   ✓ Branch unchanged on conflict (abortOnConflict)
 *
 * TEST RUNNER: bun:test only.
 * REAL on-disk temp repos via isomorphic-git — no mocks for git state.
 * HTTP transport spy wraps real isomorphic-git/http/node to record pushes.
 * Never shells out to system git.
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

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
  resolveConflicts,
  type ConflictResolution,
} from "../sync.ts";
import {
  packDroppingClient,
  startGitServer,
  tempDir,
  type GitServer,
} from "../test-support/git-http-server.ts";

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

// ── Fixture: clean merge (no overlapping files) ───────────────────────────────

interface CleanMergeFixture {
  remoteDir: string;
  localDir: string;
  server: GitServer;
  localFileContent: string;
  cleanup(): Promise<void>;
}

async function setupCleanMerge(): Promise<CleanMergeFixture> {
  const author = { name: "Test Author", email: "test@test.local" };
  const localFileContent = "# My Local Chapter\n\nThis is my work.\n";

  const remoteDir = await tempDir("pmd-urh-clean-remote-");
  await git.init({ fs, dir: remoteDir, defaultBranch: "main" });
  await writeFile(path.join(remoteDir, "remote-root.md"), "# Remote Root\n\nCompletely unrelated.\n");
  await writeFile(path.join(remoteDir, "remote-manifest.yaml"), "title: Remote Book\n");
  await git.add({ fs, dir: remoteDir, filepath: "remote-root.md" });
  await git.add({ fs, dir: remoteDir, filepath: "remote-manifest.yaml" });
  await git.commit({ fs, dir: remoteDir, message: "remote: root commit", author });

  const server = await startGitServer(remoteDir);

  const localDir = await tempDir("pmd-urh-clean-local-");
  await git.init({ fs, dir: localDir, defaultBranch: "main" });
  await writeFile(path.join(localDir, "chapter.md"), localFileContent);
  await writeFile(path.join(localDir, "local-notes.md"), "# Local Notes\n\nMy notes.\n");
  await git.add({ fs, dir: localDir, filepath: "chapter.md" });
  await git.add({ fs, dir: localDir, filepath: "local-notes.md" });
  await git.commit({ fs, dir: localDir, message: "local: root commit", author });

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

// ── Fixture: conflict merge (overlapping manifest.yaml) ────────────────────────

interface ConflictMergeFixture {
  remoteDir: string;
  localDir: string;
  server: GitServer;
  localFileContent: string;
  cleanup(): Promise<void>;
}

async function setupConflictMerge(): Promise<ConflictMergeFixture> {
  const author = { name: "Test Author", email: "test@test.local" };
  const localFileContent = "# My Local Chapter\n\nThis is my work.\n";

  const remoteDir = await tempDir("pmd-urh-conflict-remote-");
  await git.init({ fs, dir: remoteDir, defaultBranch: "main" });
  await writeFile(path.join(remoteDir, "remote-root.md"), "# Remote Root\n\nCompletely unrelated.\n");
  await writeFile(path.join(remoteDir, "manifest.yaml"), "title: Remote Book\n");
  await git.add({ fs, dir: remoteDir, filepath: "remote-root.md" });
  await git.add({ fs, dir: remoteDir, filepath: "manifest.yaml" });
  await git.commit({ fs, dir: remoteDir, message: "remote: root commit", author });

  const server = await startGitServer(remoteDir);

  const localDir = await tempDir("pmd-urh-conflict-local-");
  await git.init({ fs, dir: localDir, defaultBranch: "main" });
  await writeFile(path.join(localDir, "chapter.md"), localFileContent);
  await writeFile(path.join(localDir, "manifest.yaml"), "title: My Local Book\n");
  await git.add({ fs, dir: localDir, filepath: "chapter.md" });
  await git.add({ fs, dir: localDir, filepath: "manifest.yaml" });
  await git.commit({ fs, dir: localDir, message: "local: root commit", author });

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
  fix: { localDir: string; server: GitServer },
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

// ── Helper: extract zip path from result ──────────────────────────────────────

function zipPathFrom(result: RecoveryResult): string | undefined {
  if ("backupZipPath" in result && result.backupZipPath) return result.backupZipPath;
  if ("guidance" in result && result.guidance.backupZipPath) return result.guidance.backupZipPath;
  return undefined;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("recover (unrelated_histories)", () => {
  // ── Fixture verification ────────────────────────────────────────────────────

  test("clean merge fixture has no shared ancestor", async () => {
    const fix = await setupCleanMerge();
    try {
      const localHead = await git.resolveRef({ fs, dir: fix.localDir, ref: "HEAD" });
      const remHead = await remoteHead(fix.remoteDir);
      expect(localHead).not.toBe(remHead);

      const remoteHeadContent = await git.readCommit({ fs, dir: fix.remoteDir, oid: remHead });
      const localHeadContent = await git.readCommit({ fs, dir: fix.localDir, oid: localHead });
      expect(remoteHeadContent.commit.parent).toHaveLength(0);
      expect(localHeadContent.commit.parent).toHaveLength(0);
    } finally {
      await fix.cleanup();
    }
  });

  test("conflict merge fixture has overlapping files", async () => {
    const fix = await setupConflictMerge();
    try {
      // Both repos have manifest.yaml — this will conflict.
      const remoteFiles = await git.listFiles({ fs, dir: fix.remoteDir });
      const localFiles = await git.listFiles({ fs, dir: fix.localDir });
      const overlap = remoteFiles.filter((f) => localFiles.includes(f));
      expect(overlap).toContain("manifest.yaml");
    } finally {
      await fix.cleanup();
    }
  });

  // ── Clean merge → recovered ─────────────────────────────────────────────────

  test("clean merge: result status is 'recovered'", async () => {
    const fix = await setupCleanMerge();
    try {
      const ctx = makeCtx(fix);
      const result = await recover(ctx);
      expect(result.status).toBe("recovered");
    } finally {
      await fix.cleanup();
    }
  });

  test("clean merge: local chapter.md is preserved", async () => {
    const fix = await setupCleanMerge();
    try {
      const ctx = makeCtx(fix);
      await recover(ctx);

      const content = await readFile(path.join(fix.localDir, "chapter.md"), "utf8");
      expect(content).toBe(fix.localFileContent);
    } finally {
      await fix.cleanup();
    }
  });

  test("clean merge: remote-root.md is present after combine", async () => {
    const fix = await setupCleanMerge();
    try {
      const ctx = makeCtx(fix);
      await recover(ctx);

      const content = await readFile(path.join(fix.localDir, "remote-root.md"), "utf8");
      expect(content).toContain("Remote Root");
    } finally {
      await fix.cleanup();
    }
  });

  test("clean merge: local-notes.md is present after combine", async () => {
    const fix = await setupCleanMerge();
    try {
      const ctx = makeCtx(fix);
      await recover(ctx);

      const content = await readFile(path.join(fix.localDir, "local-notes.md"), "utf8");
      expect(content).toContain("Local Notes");
    } finally {
      await fix.cleanup();
    }
  });

  // ── Conflict merge → needs_user with conflict files + OIDs ──────────────────

  test("conflict merge: result status is 'needs_user'", async () => {
    const fix = await setupConflictMerge();
    try {
      const ctx = makeCtx(fix);
      const result = await recover(ctx);
      // Overlapping files (manifest.yaml) with different content MUST surface
      // as needs_user — NOT silently resolved in favor of local.
      expect(result.status).toBe("needs_user");
    } finally {
      await fix.cleanup();
    }
  });

  test("conflict merge: needs_user includes overlapping file in conflict list", async () => {
    const fix = await setupConflictMerge();
    try {
      const ctx = makeCtx(fix);
      const result = await recover(ctx);
      expect(result.status).toBe("needs_user");
      if (result.status !== "needs_user") throw new Error("unreachable");

      expect(result.files).toBeDefined();
      expect(result.files!.length).toBeGreaterThan(0);
      const paths = result.files!.map((f) => f.path);
      expect(paths).toContain("manifest.yaml");
      for (const f of result.files!) {
        expect(["both-edited", "you-deleted", "online-deleted"]).toContain(f.kind);
      }
    } finally {
      await fix.cleanup();
    }
  });

  test("conflict merge: local chapter.md is preserved (non-overlapping file)", async () => {
    const fix = await setupConflictMerge();
    try {
      const ctx = makeCtx(fix);
      await recover(ctx);

      // chapter.md only exists locally — the merge was aborted so it should
      // be unchanged.
      const content = await readFile(path.join(fix.localDir, "chapter.md"), "utf8");
      expect(content).toBe(fix.localFileContent);
    } finally {
      await fix.cleanup();
    }
  });

  test("conflict merge: branch unchanged on conflict (abortOnConflict)", async () => {
    const fix = await setupConflictMerge();
    try {
      const headBefore = await git.resolveRef({ fs, dir: fix.localDir, ref: "HEAD" });
      const ctx = makeCtx(fix);
      await recover(ctx);

      // The merge was aborted (abortOnConflict:true), so the branch must be
      // at its original position.
      const headAfter = await git.resolveRef({ fs, dir: fix.localDir, ref: "HEAD" });
      expect(headAfter).toBe(headBefore);
    } finally {
      await fix.cleanup();
    }
  });

  test("conflict merge: manifest.yaml is NOT silently overwritten", async () => {
    const fix = await setupConflictMerge();
    try {
      const ctx = makeCtx(fix);
      await recover(ctx);

      // The conflict was surfaced, not silently resolved. The working tree
      // should still have the local manifest (merge was aborted).
      const content = await readFile(path.join(fix.localDir, "manifest.yaml"), "utf8");
      expect(content).toContain("My Local Book");
    } finally {
      await fix.cleanup();
    }
  });

  test("conflict merge: localId and remoteId threaded through for resolveConflicts", async () => {
    const fix = await setupConflictMerge();
    try {
      const headBefore = await git.resolveRef({ fs, dir: fix.localDir, ref: "HEAD" });
      const ctx = makeCtx(fix);
      const result = await recover(ctx);
      expect(result.status).toBe("needs_user");

      // The result must carry localId and remoteId so the host can call
      // resolveConflicts({ allowUnrelatedHistories: true }).
      const asAny = result as Record<string, unknown>;
      const localId = asAny["localId"] as string | undefined;
      const remoteId = asAny["remoteId"] as string | undefined;
      expect(localId).toBeDefined();
      expect(remoteId).toBeDefined();
      expect(localId).toBe(headBefore);
    } finally {
      await fix.cleanup();
    }
  });

  // ── resolveConflicts round-trip: user choices are respected ─────────────────
  //
  // After the handler surfaces needs_user with localId/remoteId, the host
  // shows the per-file version chooser. The user picks "keep mine", "keep
  // theirs", or "keep both" for each conflicted file. The host then calls
  // resolveConflicts({ allowUnrelatedHistories: true }) which applies the
  // choices, creates a two-parent merge commit, and pushes.

  test("resolveConflicts 'mine': keeps local manifest.yaml, no markers", async () => {
    const fix = await setupConflictMerge();
    try {
      const ctx = makeCtx(fix);
      const result = await recover(ctx);
      expect(result.status).toBe("needs_user");
      const asAny = result as Record<string, unknown>;

      const resolutions: ConflictResolution[] = [
        { path: "manifest.yaml", choice: "mine" },
      ];
      const outcome = await resolveConflicts({
        projectDir: fix.localDir,
        resolutions,
        localId: asAny["localId"] as string,
        remoteId: asAny["remoteId"] as string,
        httpClient: httpNode,
        allowUnrelatedHistories: true,
      });

      // The merge should succeed (the user's choice resolves the conflict).
      expect(outcome.status).toBe("synced");

      // The local manifest.yaml is kept — no conflict markers.
      const content = await readFile(path.join(fix.localDir, "manifest.yaml"), "utf8");
      expect(content).toContain("My Local Book");
      expect(content).not.toMatch(/<<<<<<<|>>>>>>>/);

      // The remote-only file is also present (clean merge brought it in).
      const remoteRoot = await readFile(path.join(fix.localDir, "remote-root.md"), "utf8");
      expect(remoteRoot).toContain("Remote Root");
    } finally {
      await fix.cleanup();
    }
  });

  test("resolveConflicts 'theirs': keeps remote manifest.yaml, no markers", async () => {
    const fix = await setupConflictMerge();
    try {
      const ctx = makeCtx(fix);
      const result = await recover(ctx);
      expect(result.status).toBe("needs_user");
      const asAny = result as Record<string, unknown>;

      const resolutions: ConflictResolution[] = [
        { path: "manifest.yaml", choice: "theirs" },
      ];
      const outcome = await resolveConflicts({
        projectDir: fix.localDir,
        resolutions,
        localId: asAny["localId"] as string,
        remoteId: asAny["remoteId"] as string,
        httpClient: httpNode,
        allowUnrelatedHistories: true,
      });

      expect(outcome.status).toBe("synced");

      // The remote manifest.yaml is kept — no conflict markers.
      const content = await readFile(path.join(fix.localDir, "manifest.yaml"), "utf8");
      expect(content).toContain("Remote Book");
      expect(content).not.toMatch(/<<<<<<<|>>>>>>>/);

      // The local-only file is also present (merge brought it in).
      const chapter = await readFile(path.join(fix.localDir, "chapter.md"), "utf8");
      expect(chapter).toBe(fix.localFileContent);
    } finally {
      await fix.cleanup();
    }
  });

  test("resolveConflicts 'both': keeps local AND writes (online copy)", async () => {
    const fix = await setupConflictMerge();
    try {
      const ctx = makeCtx(fix);
      const result = await recover(ctx);
      expect(result.status).toBe("needs_user");
      const asAny = result as Record<string, unknown>;

      const resolutions: ConflictResolution[] = [
        { path: "manifest.yaml", choice: "both" },
      ];
      const outcome = await resolveConflicts({
        projectDir: fix.localDir,
        resolutions,
        localId: asAny["localId"] as string,
        remoteId: asAny["remoteId"] as string,
        httpClient: httpNode,
        allowUnrelatedHistories: true,
      });

      expect(outcome.status).toBe("synced");

      // Both files must exist: the local manifest AND the online copy.
      expect(fs.existsSync(path.join(fix.localDir, "manifest.yaml"))).toBe(true);
      expect(
        fs.existsSync(path.join(fix.localDir, "manifest (online copy).yaml")),
      ).toBe(true);

      // The local copy has the local content.
      const localContent = await readFile(path.join(fix.localDir, "manifest.yaml"), "utf8");
      expect(localContent).toContain("My Local Book");

      // The online copy has the remote content.
      const onlineCopy = await readFile(
        path.join(fix.localDir, "manifest (online copy).yaml"),
        "utf8",
      );
      expect(onlineCopy).toContain("Remote Book");
    } finally {
      await fix.cleanup();
    }
  });

  test("resolveConflicts produces a two-parent merge commit (both histories intact)", async () => {
    const fix = await setupConflictMerge();
    try {
      const ctx = makeCtx(fix);
      const result = await recover(ctx);
      expect(result.status).toBe("needs_user");
      const asAny = result as Record<string, unknown>;
      const localId = asAny["localId"] as string;
      const remoteId = asAny["remoteId"] as string;

      const resolutions: ConflictResolution[] = [
        { path: "manifest.yaml", choice: "mine" },
      ];
      await resolveConflicts({
        projectDir: fix.localDir,
        resolutions,
        localId,
        remoteId,
        httpClient: httpNode,
        allowUnrelatedHistories: true,
      });

      // The new HEAD must be a merge commit with TWO parents: the local tip
      // and the remote tip. Both histories are intact.
      const head = await git.resolveRef({ fs, dir: fix.localDir, ref: "HEAD" });
      const { commit } = await git.readCommit({ fs, dir: fix.localDir, oid: head });
      expect(commit.parent.length).toBe(2);
      expect(commit.parent).toContain(localId);
      expect(commit.parent).toContain(remoteId);
    } finally {
      await fix.cleanup();
    }
  });

  // ── No remoteUrl → blocked ──────────────────────────────────────────────────

  test("no remoteUrl: result status is 'blocked'", async () => {
    const fix = await setupCleanMerge();
    try {
      const ctx = makeCtx(fix, { remoteUrl: undefined });
      const result = await recover(ctx);
      expect(result.status).toBe("blocked");
    } finally {
      await fix.cleanup();
    }
  });

  test("no remoteUrl: guidance routes to connection settings with a human label", async () => {
    const fix = await setupCleanMerge();
    try {
      const ctx = makeCtx(fix, { remoteUrl: undefined });
      const result = await recover(ctx);
      expect(result.status).toBe("blocked");
      if (result.status !== "blocked") throw new Error("unreachable");
      // recommendedAction is the literal button label — a human phrase, never
      // a machine token; the machine token lives in recommendedActionKey.
      expect(result.guidance.recommendedAction).toBe("Check connection");
      expect(result.guidance.recommendedActionKey).toBe("check_connection");
    } finally {
      await fix.cleanup();
    }
  });

  // ── User DENY → blocked ─────────────────────────────────────────────────────

  test("user deny: result status is 'blocked'", async () => {
    const fix = await setupCleanMerge();
    try {
      const ctx = makeCtx(fix, { confirmation: alwaysDeny });
      const result = await recover(ctx);
      expect(result.status).toBe("blocked");
    } finally {
      await fix.cleanup();
    }
  });

  test("user deny: local files unchanged", async () => {
    const fix = await setupCleanMerge();
    try {
      const localFileBefore = await readFile(
        path.join(fix.localDir, "chapter.md"),
        "utf8",
      );
      const ctx = makeCtx(fix, { confirmation: alwaysDeny });
      await recover(ctx);

      const localFileAfter = await readFile(
        path.join(fix.localDir, "chapter.md"),
        "utf8",
      );
      expect(localFileAfter).toBe(localFileBefore);
    } finally {
      await fix.cleanup();
    }
  });

  test("user deny: remote unchanged", async () => {
    const fix = await setupCleanMerge();
    try {
      const headBefore = await remoteHead(fix.remoteDir);
      const treeBefore = await remoteTree(fix.remoteDir);
      const ctx = makeCtx(fix, { confirmation: alwaysDeny });
      await recover(ctx);

      expect(await remoteHead(fix.remoteDir)).toBe(headBefore);
      expect(await remoteTree(fix.remoteDir)).toBe(treeBefore);
    } finally {
      await fix.cleanup();
    }
  });

  test("user deny: backup zip still exists and is readable", async () => {
    const fix = await setupCleanMerge();
    try {
      const ctx = makeCtx(fix, {
        repoSlug: "urh-deny-backup-test",
        confirmation: alwaysDeny,
      });
      const result = await recover(ctx);
      expect(result.status).toBe("blocked");

      const zipPath = zipPathFrom(result);
      expect(zipPath).toBeDefined();
      await assertZipReadable(zipPath!);
    } finally {
      await fix.cleanup();
    }
  });

  // ── No push calls ───────────────────────────────────────────────────────────

  test("zero push calls — remote is never touched (clean merge)", async () => {
    const fix = await setupCleanMerge();
    try {
      const spy = makeGitSpy();
      const ctx = makeCtx(fix, { httpClient: spy.http });
      await recover(ctx);
      expect(spy.pushes).toHaveLength(0);
    } finally {
      await fix.cleanup();
    }
  });

  test("zero push calls — remote is never touched (conflict merge)", async () => {
    const fix = await setupConflictMerge();
    try {
      const spy = makeGitSpy();
      const ctx = makeCtx(fix, { httpClient: spy.http });
      await recover(ctx);
      expect(spy.pushes).toHaveLength(0);
    } finally {
      await fix.cleanup();
    }
  });

  // ── Remote unchanged ────────────────────────────────────────────────────────

  test("remote head and tree are unchanged after recover() (clean merge)", async () => {
    const fix = await setupCleanMerge();
    try {
      const headBefore = await remoteHead(fix.remoteDir);
      const treeBefore = await remoteTree(fix.remoteDir);
      const ctx = makeCtx(fix);
      await recover(ctx);

      expect(await remoteHead(fix.remoteDir)).toBe(headBefore);
      expect(await remoteTree(fix.remoteDir)).toBe(treeBefore);
    } finally {
      await fix.cleanup();
    }
  });

  test("remote head and tree are unchanged after recover() (conflict merge)", async () => {
    const fix = await setupConflictMerge();
    try {
      const headBefore = await remoteHead(fix.remoteDir);
      const treeBefore = await remoteTree(fix.remoteDir);
      const ctx = makeCtx(fix);
      await recover(ctx);

      expect(await remoteHead(fix.remoteDir)).toBe(headBefore);
      expect(await remoteTree(fix.remoteDir)).toBe(treeBefore);
    } finally {
      await fix.cleanup();
    }
  });

  // ── Backup zip ──────────────────────────────────────────────────────────────

  test("backup zip is created and readable (clean merge)", async () => {
    const fix = await setupCleanMerge();
    try {
      const ctx = makeCtx(fix, { repoSlug: "urh-backup-clean" });
      const result = await recover(ctx);

      const zipPath = zipPathFrom(result);
      expect(zipPath).toBeDefined();
      expect(zipPath).toMatch(/\.zip$/);
      await assertZipReadable(zipPath!);
    } finally {
      await fix.cleanup();
    }
  });

  test("backup zip contains chapter.md and .git/HEAD (clean merge)", async () => {
    const fix = await setupCleanMerge();
    try {
      const ctx = makeCtx(fix, { repoSlug: "urh-zip-entries-clean" });
      const result = await recover(ctx);

      const zipPath = zipPathFrom(result);
      expect(zipPath).toBeDefined();
      const entries = await zipEntries(zipPath!);
      const names = entries.map((e) => e.name);

      expect(names.some((n) => n.includes("chapter.md"))).toBe(true);
      expect(names.some((n) => n.endsWith(".git/HEAD") || n.includes(".git/HEAD"))).toBe(true);
    } finally {
      await fix.cleanup();
    }
  });

  // ── backup_create fault ─────────────────────────────────────────────────────

  test("backup_create fault → failed_no_changes_made, no writes after", async () => {
    const fix = await setupCleanMerge();
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
      expect(result.status).toBe("failed_no_changes_made");

      expect(await remoteHead(fix.remoteDir)).toBe(headBefore);
      expect(spy.pushes).toHaveLength(0);

      const localFileAfter = await readFile(
        path.join(fix.localDir, "chapter.md"),
        "utf8",
      );
      expect(localFileAfter).toBe(localFileBefore);
    } finally {
      await fix.cleanup();
    }
  });

  // ── after_backup_before_repair fault ────────────────────────────────────────

  test("after_backup_before_repair fault → failed_backup_available or blocked, backup readable", async () => {
    const fix = await setupCleanMerge();
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

      expect(
        result.status === "failed_backup_available" ||
        result.status === "blocked",
      ).toBe(true);

      const zipPath = zipPathFrom(result);
      if (zipPath) {
        await assertZipReadable(zipPath);
      }

      expect(await remoteHead(fix.remoteDir)).toBe(headBefore);
      expect(spy.pushes).toHaveLength(0);
    } finally {
      await fix.cleanup();
    }
  });

  // ── Guidance text ───────────────────────────────────────────────────────────

  test("guidance text is jargon-free (no raw git words)", async () => {
    const fix = await setupCleanMerge();
    try {
      const ctx = makeCtx(fix, { remoteUrl: undefined });
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

  test("guidance mentions combining or separate history concept", async () => {
    const fix = await setupCleanMerge();
    try {
      const ctx = makeCtx(fix, { remoteUrl: undefined });
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

      const mentionsConcept =
        allText.includes("separate") ||
        allText.includes("unrelated") ||
        allText.includes("different") ||
        allText.includes("combine") ||
        allText.includes("shared") ||
        allText.includes("starting point");
      expect(mentionsConcept).toBe(true);
    } finally {
      await fix.cleanup();
    }
  });

  // ── Error object in supportDetails ──────────────────────────────────────────

  test("error object passed to recover() is included in supportDetails", async () => {
    const fix = await setupCleanMerge();
    try {
      const ctx = makeCtx(fix, { repoSlug: "urh-error-details-test", remoteUrl: undefined });
      const err = new Error("unrelated histories detected by upstream fetch");
      const result = await recover(ctx, err);

      expect(result.status).toBe("blocked");
      if (result.status !== "blocked") throw new Error("unreachable");

      const support = result.guidance.supportDetails ?? "";
      expect(support).toBeTruthy();
    } finally {
      await fix.cleanup();
    }
  });

  // ── Local user files preserved after clean merge ────────────────────────────

  test("local user-visible files are unchanged after recover() (clean merge)", async () => {
    const fix = await setupCleanMerge();
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

  // ── R15: aborted fetch must not leave a dangling tracking ref ───────────────

  test("aborted fetch (idle-timeout mid-pack) leaves no dangling refs/remotes/origin/main", async () => {
    const fix = await setupCleanMerge();
    try {
      // The local repo has NEVER fetched — no refs/remotes/origin/main yet.
      const before = await git
        .resolveRef({ fs, dir: fix.localDir, ref: "refs/remotes/origin/main" })
        .catch(() => null);
      expect(before).toBeNull();

      const ctx = makeCtx(fix, { httpClient: packDroppingClient(httpNode) });
      const result = await recover(ctx);

      // The fetch died mid-transfer → the repair fails, backup available.
      expect(result.status).toBe("failed_backup_available");

      // The tracking ref must NOT be left dangling (R15): the abort moved it
      // to an oid whose pack never landed, which poisons the next sync (zero
      // `have`s → full-repo re-download) and makes resolving it report
      // missing-object "corruption" on a never-corrupt repo.
      const after = await git
        .resolveRef({ fs, dir: fix.localDir, ref: "refs/remotes/origin/main" })
        .catch(() => null);
      expect(after).toBeNull();
    } finally {
      await fix.cleanup();
    }
  });

  // ── Conflict merge: needs_user file list shape ──────────────────────────────

  test("conflict merge needs_user: files list is non-empty and well-formed", async () => {
    const fix = await setupConflictMerge();
    try {
      const ctx = makeCtx(fix);
      const result = await recover(ctx);

      // The conflict fixture has overlapping manifest.yaml — this MUST
      // surface as needs_user, never as recovered (silent resolution is a bug).
      expect(result.status).toBe("needs_user");
      if (result.status !== "needs_user") throw new Error("unreachable");

      expect(result.files).toBeDefined();
      expect(result.files!.length).toBeGreaterThan(0);
      for (const f of result.files!) {
        expect(f.path).toBeTruthy();
        expect(["both-edited", "you-deleted", "online-deleted"]).toContain(f.kind);
      }

      // localId and remoteId must be present for resolveConflicts.
      const asAny = result as Record<string, unknown>;
      expect(asAny["localId"]).toBeDefined();
      expect(asAny["remoteId"]).toBeDefined();
    } finally {
      await fix.cleanup();
    }
  });
});
