/**
 * TDD tests for recover-wrong-remote.ts — Wrong remote / missing branch.
 *
 * WHAT: When a project's configured online destination has no matching
 * destination branch, or the remote address points to the wrong place,
 * syncing cannot proceed. This handler:
 *   1. Uses diagnose facts (diagnoseProjectRemote / parseRemoteOrigin) to
 *      detect the mismatch: the branch the project is configured for does not
 *      exist on the remote server, OR the remote URL does not accept the
 *      expected project name.
 *   2. Returns status "blocked" with reconnect/choose-branch guidance.
 *   3. NEVER creates a branch on the remote automatically.
 *   4. NEVER pushes to the remote.
 *   5. Leaves local files and remote state completely unchanged.
 *
 * WHY these tests: the spec mandates every safety invariant is product-tested:
 *   - Branch "missing-branch" configured but absent on server → "blocked".
 *   - No push issued in any scenario (gitSpy.pushCalls.length === 0).
 *   - Local files UNCHANGED.
 *   - Remote HEAD UNCHANGED.
 *   - policy.wrong_remote_or_branch has createBackup:false — no backup zip
 *     is created for this kind (pure block, no repair attempted).
 *   - Guidance is always present on blocked result.
 *   - No remoteUrl → blocked with guidance (can't even verify).
 *   - Wrong remote URL (server returns 404 or unknown repo) → blocked.
 *
 * Test runner: bun:test (NOT vitest).
 * Repos: real on-disk temp repos via isomorphic-git. NO system git binary.
 * HTTP: real git smart-HTTP via test-support/git-http-server.ts.
 * Mocks: confirmation gate (not needed — wrong_remote_or_branch never asks),
 *        gitSpy httpClient wrapper to assert no push is issued.
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { makeTempDir } from "../../../test-helpers/testkit";

import git from "isomorphic-git";
import httpNode from "isomorphic-git/http/node";

import {
  createFixtureRepo,
  startGitServer,
} from "../test-support/git-http-server.ts";
import type {
  RecoveryContext,
  RecoveryResult,
  ConfirmationGate,
} from "./types.ts";

// ── The module under test — expected to NOT exist yet (TDD stage 1) ──────────
// This import will fail until recover-wrong-remote.ts is implemented.
import { recover } from "./recover-wrong-remote.ts";
import { BACKUP_ROOT } from "./backup.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

const FIXED_NOW = new Date("2025-01-20T10:00:00.000Z").getTime();

/** A confirmation gate that should never be called for wrong_remote_or_branch. */
const UNEXPECTED_CONFIRM_GATE: ConfirmationGate = {
  confirmRepair: async () => {
    throw new Error("confirmRepair should NOT be called for wrong_remote_or_branch");
  },
};

/** A confirmation gate that approves (used where confirmation might be triggered). */
const APPROVE_GATE: ConfirmationGate = {
  confirmRepair: async () => true,
};

/**
 * Push-spy wrapper around httpNode. Records every receive-pack (push) request.
 * assertNoPushCalled() verifies the handler never issued a push.
 */
function makePushSpy(): {
  httpClient: typeof httpNode;
  pushCalls: Array<{ url: string }>;
  assertNoPushCalled(): void;
} {
  const pushCalls: Array<{ url: string }> = [];
  const httpClient: typeof httpNode = {
    async request(opts) {
      if (
        opts.url.endsWith("/git-receive-pack") ||
        (opts.url.includes("/info/refs") && opts.url.includes("service=git-receive-pack"))
      ) {
        pushCalls.push({ url: opts.url });
      }
      return httpNode.request(opts);
    },
  };
  return {
    httpClient,
    pushCalls,
    assertNoPushCalled() {
      expect(pushCalls.length).toBe(0);
    },
  };
}

/**
 * Build a fixture: remote repo serving only "main", plus a valid local clone.
 * The wrong-branch misconfiguration is simulated by the CALLER setting
 * ctx.branch (via makeCtx) to a branch the server does not have — the fixture
 * itself always serves "main".
 */
async function makeFixture(): Promise<{
  projectDir: string;
  remoteDir: string;
  remoteUrl: string;
  closeServer: () => Promise<void>;
  initialRemoteHead: string;
}> {

  // Set up the remote fixture repo.
  const remoteDir = await makeTempDir("wrong-remote-remote-");
  const { head: initialRemoteHead } = await createFixtureRepo(remoteDir);

  // createFixtureRepo always creates "main" — the only branch the server
  // ever advertises in these tests.
  const server = await startGitServer(remoteDir);

  // Clone the remote so we have a valid local git repo.
  const projectDir = await makeTempDir("wrong-remote-project-");
  // Remove the auto-created dir so clone can create it fresh.
  const { rm } = await import("node:fs/promises");
  await rm(projectDir, { recursive: true, force: true });

  await git.clone({
    fs,
    http: httpNode,
    dir: projectDir,
    url: server.url,
    singleBranch: true,
  });

  return {
    projectDir,
    remoteDir,
    remoteUrl: server.url,
    closeServer: server.close,
    initialRemoteHead,
  };
}

/** Build a RecoveryContext for wrong_remote_or_branch recovery. */
function makeCtx(
  projectDir: string,
  remoteUrl: string,
  branch: string,
  overrides: Partial<RecoveryContext> = {},
): RecoveryContext {
  return {
    projectDir,
    repoDir: projectDir,
    branch,
    remoteUrl,
    repoSlug: "test-book",
    httpClient: httpNode,
    // wrong_remote_or_branch policy: no confirmation required.
    // Use the guard gate to catch if it's incorrectly called.
    confirmation: UNEXPECTED_CONFIRM_GATE,
    now: () => FIXED_NOW,
    ...overrides,
  };
}

// ── Primary spec: missing branch on remote → blocked ─────────────────────────
//
// Configure branch "missing-branch" which does NOT exist on the server.
// The server only has "main". The handler must detect this and return
// status "blocked" without pushing.

describe("recover (wrong_remote_or_branch) — missing branch on remote", () => {
  test("returns status=blocked when configured branch is absent from remote", async () => {
    const { projectDir, remoteUrl, closeServer } = await makeFixture();
    try {
      // The server has "main"; context says we want "missing-branch".
      const ctx = makeCtx(projectDir, remoteUrl, "missing-branch");
      const result = await recover(ctx);

      expect(result.status).toBe("blocked");
    } finally {
      await closeServer();
    }
  });

  test("blocked result includes guidance with non-empty userSummary", async () => {
    const { projectDir, remoteUrl, closeServer } = await makeFixture();
    try {
      const ctx = makeCtx(projectDir, remoteUrl, "missing-branch");
      const result = await recover(ctx);

      expect(result).toHaveProperty("guidance");
      const r = result as Extract<RecoveryResult, { status: "blocked" }>;
      expect(r.guidance.userSummary.length).toBeGreaterThan(0);
    } finally {
      await closeServer();
    }
  });

  test("blocked result guidance has recommendedNextStep", async () => {
    const { projectDir, remoteUrl, closeServer } = await makeFixture();
    try {
      const ctx = makeCtx(projectDir, remoteUrl, "missing-branch");
      const result = await recover(ctx);

      const r = result as Extract<RecoveryResult, { status: "blocked" }>;
      expect(r.guidance.recommendedNextStep.length).toBeGreaterThan(0);
    } finally {
      await closeServer();
    }
  });

  test("blocked result guidance has recommendedAction", async () => {
    const { projectDir, remoteUrl, closeServer } = await makeFixture();
    try {
      const ctx = makeCtx(projectDir, remoteUrl, "missing-branch");
      const result = await recover(ctx);

      const r = result as Extract<RecoveryResult, { status: "blocked" }>;
      expect(r.guidance.recommendedAction.length).toBeGreaterThan(0);
    } finally {
      await closeServer();
    }
  });

  test("guidance does not contain git jargon (branch/commit/HEAD/ref) in userSummary", async () => {
    const { projectDir, remoteUrl, closeServer } = await makeFixture();
    try {
      const ctx = makeCtx(projectDir, remoteUrl, "missing-branch");
      const result = await recover(ctx);

      const r = result as Extract<RecoveryResult, { status: "blocked" }>;
      const summary = r.guidance.userSummary.toLowerCase();
      // Author-facing strings must never leak raw git words.
      expect(summary).not.toMatch(/\bcommit\b/);
      expect(summary).not.toMatch(/\bhead\b/);
      expect(summary).not.toMatch(/\bref\b/);
      expect(summary).not.toMatch(/\brebase\b/);
    } finally {
      await closeServer();
    }
  });
});

// ── Safety: no push ever issued ───────────────────────────────────────────────
//
// The handler must NEVER push to the remote — not even a probe push.
// Assert using a push-spy wrapping httpClient.

describe("recover (wrong_remote_or_branch) — no push ever issued", () => {
  test("no push request made when branch is missing", async () => {
    const { projectDir, remoteUrl, closeServer } = await makeFixture();
    try {
      const spy = makePushSpy();
      const ctx = makeCtx(projectDir, remoteUrl, "missing-branch", {
        httpClient: spy.httpClient,
      });

      await recover(ctx);

      spy.assertNoPushCalled();
    } finally {
      await closeServer();
    }
  });

  test("no push request made when remoteUrl is missing", async () => {
    const { projectDir, closeServer } = await makeFixture();
    try {
      const spy = makePushSpy();
      const ctx = makeCtx(projectDir, "", "missing-branch", {
        remoteUrl: undefined,
        httpClient: spy.httpClient,
        confirmation: APPROVE_GATE, // allow any confirmation if triggered
      });

      await recover(ctx);

      spy.assertNoPushCalled();
    } finally {
      await closeServer();
    }
  });

  test("no push request made when remote URL is a 404 (notFound server)", async () => {
    // Start a server that returns 404 for everything (wrong remote).
    const remoteDir = await makeTempDir("wrong-404-remote-");
    await createFixtureRepo(remoteDir);

    // Start a notFound server to simulate a wrong remote URL.
    const { startGitServer: startServer } = await import(
      "../test-support/git-http-server.ts"
    );
    const notFoundServer = await startServer(remoteDir, { notFound: true });

    // We need a local repo too (a valid git dir pointing to the wrong remote).
    const projectDir = await makeTempDir("wrong-404-project-");
    const { rm } = await import("node:fs/promises");
    await rm(projectDir, { recursive: true, force: true });

    // Init a local repo (not cloned — simulates having a local git pointing to a dead remote).
    await git.init({ fs, dir: projectDir, defaultBranch: "main" });
    await writeFile(path.join(projectDir, "manifest.yaml"), "title: Test\n");
    await git.add({ fs, dir: projectDir, filepath: "manifest.yaml" });
    await git.commit({
      fs,
      dir: projectDir,
      message: "initial",
      author: { name: "Test", email: "test@test.local" },
    });
    await git.addRemote({
      fs,
      dir: projectDir,
      remote: "origin",
      url: notFoundServer.url,
    });

    try {
      const spy = makePushSpy();
      const ctx = makeCtx(projectDir, notFoundServer.url, "main", {
        httpClient: spy.httpClient,
        confirmation: APPROVE_GATE,
      });

      await recover(ctx);

      spy.assertNoPushCalled();
    } finally {
      await notFoundServer.close();
    }
  });

  test("push call count is exactly zero for missing-branch scenario", async () => {
    const { projectDir, remoteUrl, closeServer } = await makeFixture();
    try {
      const spy = makePushSpy();
      const ctx = makeCtx(projectDir, remoteUrl, "missing-branch", {
        httpClient: spy.httpClient,
      });

      await recover(ctx);

      // Be explicit: the array length must be exactly zero.
      expect(spy.pushCalls.length).toBe(0);
    } finally {
      await closeServer();
    }
  });
});

// ── Safety: local files unchanged ────────────────────────────────────────────
//
// No user-visible files (markdown, yaml, etc.) may be changed regardless
// of whether the branch mismatch is detected before or after a read.

describe("recover (wrong_remote_or_branch) — local files unchanged", () => {
  test("chapter-01.md content is unchanged after blocked result", async () => {
    const { projectDir, remoteUrl, closeServer } = await makeFixture();
    try {
      const beforeContent = fs.readFileSync(
        path.join(projectDir, "chapter-01.md"),
        "utf8",
      );

      const ctx = makeCtx(projectDir, remoteUrl, "missing-branch");
      await recover(ctx);

      const afterContent = fs.readFileSync(
        path.join(projectDir, "chapter-01.md"),
        "utf8",
      );
      expect(afterContent).toBe(beforeContent);
    } finally {
      await closeServer();
    }
  });

  test("untracked file is preserved after blocked result", async () => {
    const { projectDir, remoteUrl, closeServer } = await makeFixture();
    try {
      const unsyncedContent = "# This should not be touched\n";
      await writeFile(path.join(projectDir, "unsynced.md"), unsyncedContent);

      const ctx = makeCtx(projectDir, remoteUrl, "missing-branch");
      await recover(ctx);

      const afterContent = fs.readFileSync(
        path.join(projectDir, "unsynced.md"),
        "utf8",
      );
      expect(afterContent).toBe(unsyncedContent);
    } finally {
      await closeServer();
    }
  });

  test("projectDir still exists after blocked result", async () => {
    const { projectDir, remoteUrl, closeServer } = await makeFixture();
    try {
      const ctx = makeCtx(projectDir, remoteUrl, "missing-branch");
      await recover(ctx);

      expect(fs.existsSync(projectDir)).toBe(true);
    } finally {
      await closeServer();
    }
  });
});

// ── Safety: remote HEAD unchanged ────────────────────────────────────────────
//
// The remote must look identical before and after the recovery call —
// no commits pushed, no refs updated.

describe("recover (wrong_remote_or_branch) — remote HEAD unchanged", () => {
  test("remote HEAD is unchanged when branch is missing", async () => {
    const { projectDir, remoteUrl, remoteDir, closeServer, initialRemoteHead } =
      await makeFixture();
    try {
      const ctx = makeCtx(projectDir, remoteUrl, "missing-branch");
      await recover(ctx);

      const headAfter = await git.resolveRef({ fs, dir: remoteDir, ref: "HEAD" });
      expect(headAfter).toBe(initialRemoteHead);
    } finally {
      await closeServer();
    }
  });

  test("remote HEAD is unchanged when remoteUrl is missing", async () => {
    const { projectDir, remoteDir, closeServer, initialRemoteHead } =
      await makeFixture();
    try {
      const ctx = makeCtx(projectDir, "", "main", {
        remoteUrl: undefined,
        confirmation: APPROVE_GATE,
      });
      await recover(ctx);

      const headAfter = await git.resolveRef({ fs, dir: remoteDir, ref: "HEAD" });
      expect(headAfter).toBe(initialRemoteHead);
    } finally {
      await closeServer();
    }
  });
});

// ── No backup zip created (policy: createBackup:false) ───────────────────────
//
// wrong_remote_or_branch is a pure-block kind — no repair is attempted,
// so no backup zip should be created under the OS temp recovery root.

describe("recover (wrong_remote_or_branch) — no backup zip created", () => {
  test("result does not include backupZipPath (no backup for pure block)", async () => {
    const { projectDir, remoteUrl, closeServer } = await makeFixture();
    try {
      const ctx = makeCtx(projectDir, remoteUrl, "missing-branch");
      const result = await recover(ctx);

      // The wrong_remote_or_branch policy has createBackup:false.
      // The result must not carry a backupZipPath.
      expect((result as Record<string, unknown>).backupZipPath).toBeUndefined();
    } finally {
      await closeServer();
    }
  });

  test("no file appears under the OS temp recovery root for this kind", async () => {
    const { projectDir, remoteUrl, closeServer } = await makeFixture();
    try {
      // Record backup dir size before.
      const backupBase = path.join(BACKUP_ROOT, "test-book");
      const beforeCount = fs.existsSync(backupBase)
        ? fs.readdirSync(backupBase).length
        : 0;

      const ctx = makeCtx(projectDir, remoteUrl, "missing-branch");
      await recover(ctx);

      const afterCount = fs.existsSync(backupBase)
        ? fs.readdirSync(backupBase).length
        : 0;

      // No new backup files should have been written.
      expect(afterCount).toBe(beforeCount);
    } finally {
      await closeServer();
    }
  });
});

// ── No remoteUrl → blocked with guidance ─────────────────────────────────────
//
// Without any remoteUrl, the handler can't probe anything.
// It must return a blocked/needs_user result with guidance, not throw.

describe("recover (wrong_remote_or_branch) — no remoteUrl", () => {
  test("returns blocked or needs_user when remoteUrl is undefined", async () => {
    const { projectDir, closeServer } = await makeFixture();
    try {
      const ctx = makeCtx(projectDir, "", "main", {
        remoteUrl: undefined,
        confirmation: APPROVE_GATE,
      });
      const result = await recover(ctx);

      expect(["blocked", "needs_user", "failed_no_changes_made"]).toContain(
        result.status,
      );
    } finally {
      await closeServer();
    }
  });

  test("result includes guidance when remoteUrl is undefined", async () => {
    const { projectDir, closeServer } = await makeFixture();
    try {
      const ctx = makeCtx(projectDir, "", "main", {
        remoteUrl: undefined,
        confirmation: APPROVE_GATE,
      });
      const result = await recover(ctx);

      expect(result).toHaveProperty("guidance");
      const r = result as { guidance?: { userSummary: string } };
      expect(r.guidance?.userSummary.length).toBeGreaterThan(0);
    } finally {
      await closeServer();
    }
  });

  test("no push when remoteUrl is undefined", async () => {
    const { projectDir, closeServer } = await makeFixture();
    try {
      const spy = makePushSpy();
      const ctx = makeCtx(projectDir, "", "main", {
        remoteUrl: undefined,
        httpClient: spy.httpClient,
        confirmation: APPROVE_GATE,
      });

      await recover(ctx);

      spy.assertNoPushCalled();
    } finally {
      await closeServer();
    }
  });
});

// ── 404 remote (wrong remote URL) → blocked with guidance ────────────────────
//
// When the remote URL exists but the server returns 404 (wrong repo),
// the handler cannot verify anything and must block with guidance.

describe("recover (wrong_remote_or_branch) — 404 remote URL", () => {
  test("returns blocked or needs_user when server returns 404", async () => {
    const remoteDir = await makeTempDir("404-fixture-");
    await createFixtureRepo(remoteDir);

    const { startGitServer: startServer } = await import(
      "../test-support/git-http-server.ts"
    );
    const notFoundServer = await startServer(remoteDir, { notFound: true });

    // Build a local repo pointing at the 404 server.
    const projectDir = await makeTempDir("404-project-");
    const { rm } = await import("node:fs/promises");
    await rm(projectDir, { recursive: true, force: true });

    await git.init({ fs, dir: projectDir, defaultBranch: "main" });
    await writeFile(path.join(projectDir, "manifest.yaml"), "title: Test\n");
    await git.add({ fs, dir: projectDir, filepath: "manifest.yaml" });
    await git.commit({
      fs,
      dir: projectDir,
      message: "initial",
      author: { name: "Test", email: "test@test.local" },
    });
    await git.addRemote({
      fs,
      dir: projectDir,
      remote: "origin",
      url: notFoundServer.url,
    });

    try {
      const ctx = makeCtx(projectDir, notFoundServer.url, "main", {
        confirmation: APPROVE_GATE,
      });
      const result = await recover(ctx);

      expect(["blocked", "needs_user", "failed_no_changes_made"]).toContain(
        result.status,
      );
      expect(result).toHaveProperty("guidance");
    } finally {
      await notFoundServer.close();
    }
  });

  test("guidance is present when server returns 404", async () => {
    const remoteDir = await makeTempDir("404-fixture2-");
    await createFixtureRepo(remoteDir);

    const { startGitServer: startServer } = await import(
      "../test-support/git-http-server.ts"
    );
    const notFoundServer = await startServer(remoteDir, { notFound: true });

    const projectDir = await makeTempDir("404-project2-");
    const { rm } = await import("node:fs/promises");
    await rm(projectDir, { recursive: true, force: true });

    await git.init({ fs, dir: projectDir, defaultBranch: "main" });
    await writeFile(path.join(projectDir, "manifest.yaml"), "title: Test\n");
    await git.add({ fs, dir: projectDir, filepath: "manifest.yaml" });
    await git.commit({
      fs,
      dir: projectDir,
      message: "initial",
      author: { name: "Test", email: "test@test.local" },
    });
    await git.addRemote({
      fs,
      dir: projectDir,
      remote: "origin",
      url: notFoundServer.url,
    });

    try {
      const ctx = makeCtx(projectDir, notFoundServer.url, "main", {
        confirmation: APPROVE_GATE,
      });
      const result = await recover(ctx);

      const r = result as { guidance?: { userSummary: string } };
      expect(r.guidance?.userSummary.length).toBeGreaterThan(0);
    } finally {
      await notFoundServer.close();
    }
  });
});

// ── Correct branch on remote → should NOT block (happy path sanity check) ────
//
// When the configured branch IS present on the remote, the handler should
// not return "blocked" for a branch-missing reason. This ensures the handler
// only blocks when there's a real mismatch.
//
// NOTE: The handler is still expected to return "blocked" for this feature
// kind (wrong_remote_or_branch is always a block — you get called only when
// the classifier already decided it's a mismatch). But if the handler can
// distinguish "branch present" vs "branch absent" it SHOULD let the caller
// know the branch exists. For TDD purposes we test the primary bad-path only.
// This suite just documents the intent for future refinement.

describe("recover (wrong_remote_or_branch) — branch present on remote (known good)", () => {
  test("returns blocked even when branch is present (handler is always a block for this kind)", async () => {
    // wrong_remote_or_branch is called only when the classifier decided it's wrong.
    // The handler always blocks — it cannot auto-fix a misconfigured remote.
    const { projectDir, remoteUrl, closeServer } = await makeFixture();
    try {
      const ctx = makeCtx(projectDir, remoteUrl, "main");
      const result = await recover(ctx);

      // Even for "main" (which exists on the server), the handler returns blocked:
      // the classifier already decided the remote/branch is wrong, so the handler
      // blocks unconditionally.
      expect(result.status).toBe("blocked");
      expect(result).toHaveProperty("guidance");
    } finally {
      await closeServer();
    }
  });
});

// ── Detection: branch absent vs present produces distinguishable guidance ────
//
// SPEC BUILD requirement: "via diagnose facts, detect configured branch missing
// remotely or remote URL mismatch." The handler uses diagnoseProjectRemote and
// parseRemoteOrigin (mandated reuses) and probes listServerRefs to determine
// whether the configured branch is on the server.
//
// The handler always returns "blocked" (the classifier already decided it's
// wrong), but the supportDetails MUST reflect whether the branch was found
// or absent — proving detection is actually implemented, not just unconditional.
//
// Safety invariants (no push, no backup, unchanged local+remote) MUST still
// hold in both the absent and present cases.

describe("recover (wrong_remote_or_branch) — detection: branch absent vs present", () => {
  test("supportDetails indicates destination not found when branch is absent", async () => {
    // Server has "main" only; configured branch is "missing-branch" (absent).
    const { projectDir, remoteUrl, closeServer } = await makeFixture();
    try {
      const ctx = makeCtx(projectDir, remoteUrl, "missing-branch");
      const result = await recover(ctx);

      // Handler must block.
      expect(result.status).toBe("blocked");

      // supportDetails must indicate the destination was NOT found on the server.
      const r = result as Extract<RecoveryResult, { status: "blocked" }>;
      expect(r.guidance.supportDetails).toBeTruthy();
      // "not found" or "not exist" must appear — proves detection ran.
      expect(r.guidance.supportDetails!.toLowerCase()).toMatch(/not found|not exist/);
    } finally {
      await closeServer();
    }
  });

  test("supportDetails indicates destination found when branch IS present on remote", async () => {
    // Server has "main"; configured branch is also "main" (present).
    const { projectDir, remoteUrl, closeServer } = await makeFixture();
    try {
      const ctx = makeCtx(projectDir, remoteUrl, "main");
      const result = await recover(ctx);

      // Handler still blocks (classifier already decided it's wrong).
      expect(result.status).toBe("blocked");

      // But supportDetails must say the destination WAS found — proves
      // the handler actually detects present vs absent, not just unconditional.
      const r = result as Extract<RecoveryResult, { status: "blocked" }>;
      expect(r.guidance.supportDetails).toBeTruthy();
      expect(r.guidance.supportDetails!.toLowerCase()).toMatch(/found on server/);
    } finally {
      await closeServer();
    }
  });

  test("absent-branch and present-branch results have different supportDetails", async () => {
    // Run both cases and assert they differ — definitively proves detection.
    const absentFixture = await makeFixture();
    const presentFixture = await makeFixture();
    try {
      const absentCtx = makeCtx(absentFixture.projectDir, absentFixture.remoteUrl, "missing-branch");
      const presentCtx = makeCtx(presentFixture.projectDir, presentFixture.remoteUrl, "main");

      const [absentResult, presentResult] = await Promise.all([
        recover(absentCtx),
        recover(presentCtx),
      ]);

      const absentDetails = (absentResult as Extract<RecoveryResult, { status: "blocked" }>)
        .guidance.supportDetails ?? "";
      const presentDetails = (presentResult as Extract<RecoveryResult, { status: "blocked" }>)
        .guidance.supportDetails ?? "";

      // The two results must differ — the handler detects the difference.
      expect(absentDetails).not.toBe(presentDetails);
    } finally {
      await absentFixture.closeServer();
      await presentFixture.closeServer();
    }
  });

  test("no push issued in absent-branch detection scenario", async () => {
    const { projectDir, remoteUrl, closeServer } = await makeFixture();
    try {
      const spy = makePushSpy();
      const ctx = makeCtx(projectDir, remoteUrl, "missing-branch", { httpClient: spy.httpClient });
      await recover(ctx);
      spy.assertNoPushCalled();
    } finally {
      await closeServer();
    }
  });

  test("no push issued in present-branch detection scenario", async () => {
    const { projectDir, remoteUrl, closeServer } = await makeFixture();
    try {
      const spy = makePushSpy();
      const ctx = makeCtx(projectDir, remoteUrl, "main", { httpClient: spy.httpClient });
      await recover(ctx);
      spy.assertNoPushCalled();
    } finally {
      await closeServer();
    }
  });

  test("remote HEAD unchanged in absent-branch detection scenario", async () => {
    const { projectDir, remoteUrl, remoteDir, closeServer, initialRemoteHead } =
      await makeFixture();
    try {
      const ctx = makeCtx(projectDir, remoteUrl, "missing-branch");
      await recover(ctx);
      const headAfter = await git.resolveRef({ fs, dir: remoteDir, ref: "HEAD" });
      expect(headAfter).toBe(initialRemoteHead);
    } finally {
      await closeServer();
    }
  });

  test("remote HEAD unchanged in present-branch detection scenario", async () => {
    const { projectDir, remoteUrl, remoteDir, closeServer, initialRemoteHead } =
      await makeFixture();
    try {
      const ctx = makeCtx(projectDir, remoteUrl, "main");
      await recover(ctx);
      const headAfter = await git.resolveRef({ fs, dir: remoteDir, ref: "HEAD" });
      expect(headAfter).toBe(initialRemoteHead);
    } finally {
      await closeServer();
    }
  });
});

// ── Never calls confirmRepair (policy: requireConfirmation:false) ─────────────
//
// wrong_remote_or_branch has requireConfirmation:false. The handler must
// NEVER invoke ctx.confirmation.confirmRepair. The UNEXPECTED_CONFIRM_GATE
// in the default makeCtx will throw if it's called.

describe("recover (wrong_remote_or_branch) — confirmation gate never called", () => {
  test("never invokes confirmRepair for missing-branch (guard gate would throw if called)", async () => {
    const { projectDir, remoteUrl, closeServer } = await makeFixture();
    try {
      // makeCtx uses UNEXPECTED_CONFIRM_GATE by default.
      const ctx = makeCtx(projectDir, remoteUrl, "missing-branch");

      // If confirmRepair is called, the gate throws and this test fails.
      // A clean result proves the gate was never invoked.
      await expect(recover(ctx)).resolves.toMatchObject({ status: "blocked" });
    } finally {
      await closeServer();
    }
  });
});
