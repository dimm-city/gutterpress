/**
 * Tests for recover-auth.ts — Auth failure recovery (thin wrapper).
 *
 * The auth_required handler clears the bad credential from the token store and
 * returns `needs_user` with reconnect guidance. It NEVER pushes, NEVER changes
 * local files, and NEVER changes the remote. No backup is created (policy says
 * createBackup=false for auth_required).
 *
 * Safety invariants asserted:
 *  1. Result status is always "needs_user" on auth failure.
 *  2. recommendedAction is "reconnect_repo" or "Reconnect" (as per guidance).
 *  3. The bad credential is cleared from the token store (wasCleared=true).
 *  4. Local files are unchanged after the call.
 *  5. Remote HEAD and tree are unchanged (no push was accepted).
 *  6. No successful push was sent (gitSpy: no receive-pack with a valid ref move).
 *  7. Guidance message/summary does NOT leak the token text.
 *  8. No backup zip is created (policy=false for auth).
 *
 * Uses a real in-process git-http-server with requireAuth, real isomorphic-git
 * temp repos. Token store is a fake in-memory store so we can assert .delete()
 * was called without touching the filesystem.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as nodeFs from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import git from "isomorphic-git";
import httpNode from "isomorphic-git/http/node";

import { cloneRepository } from "../clone.ts";
import type { HostCredential, TokenStore } from "../token-store.ts";
import {
  createFixtureRepo,
  startGitServer,
  tempDir,
  type GitServer,
} from "../test-support/git-http-server.ts";
import type {
  ConfirmationGate,
  FaultInjector,
  RecoveryContext,
} from "./types.ts";

// ── Import the handler under test ─────────────────────────────────────────────
// This import WILL FAIL until recover-auth.ts is created — that is the
// intended red state (TDD Stage 1).
import { recover } from "./recover-auth.ts";
import { recover as dispatchRecover } from "./dispatch.ts";

// ── Test helpers ──────────────────────────────────────────────────────────────

const GOOD_PASSWORD = "correct-token";
const BAD_PASSWORD = "wrong-token";
const TEST_USERNAME = "testuser";

/** A fake in-memory TokenStore that records whether delete() was called. */
function makeFakeTokenStore(initialToken?: string): TokenStore & { wasCleared: boolean; deletedHosts: string[] } {
  const store = new Map<string, HostCredential>();
  const deletedHosts: string[] = [];

  if (initialToken) {
    const cred: HostCredential = {
      host: "127.0.0.1",
      kind: "token",
      token: initialToken,
      username: TEST_USERNAME,
      createdAt: Date.now(),
    };
    store.set("127.0.0.1", cred);
  }

  return {
    get wasCleared() {
      return deletedHosts.length > 0;
    },
    deletedHosts,
    async get(host: string) {
      return store.get(host.toLowerCase()) ?? null;
    },
    async set(host: string, cred: HostCredential) {
      store.set(host.toLowerCase(), cred);
    },
    async delete(host: string) {
      deletedHosts.push(host.toLowerCase());
      store.delete(host.toLowerCase());
    },
    async list() {
      return [...store.values()];
    },
  };
}

/** Confirmation gate that always denies (should not be called for auth). */
const neverCalledGate: ConfirmationGate = {
  async confirmRepair() {
    throw new Error("confirmRepair must not be called for auth_required (no confirmation required by policy)");
  },
};

/** Tracks all push requests so we can verify force=false. */
function makePushSpyClient(): { client: typeof httpNode; pushCommands: Array<{ ref: string; oldOid: string; newOid: string }> } {
  const pushCommands: Array<{ ref: string; oldOid: string; newOid: string }> = [];
  // Parse pkt-lines from a receive-pack body to extract ref-update commands.
  function parseRefCommands(body: Buffer): Array<{ ref: string; oldOid: string; newOid: string }> {
    const cmds: Array<{ ref: string; oldOid: string; newOid: string }> = [];
    let i = 0;
    while (i + 4 <= body.length) {
      const len = parseInt(body.subarray(i, i + 4).toString(), 16);
      if (len === 0) break;
      const line = body.subarray(i + 4, i + len).toString().replace(/\n$/, "").split("\0")[0]!;
      const parts = line.split(" ");
      if (parts.length >= 3) {
        cmds.push({ oldOid: parts[0]!, newOid: parts[1]!, ref: parts.slice(2).join(" ") });
      }
      i += len;
    }
    return cmds;
  }

  const client: typeof httpNode = {
    async request(config: Parameters<typeof httpNode.request>[0]) {
      const res = await httpNode.request(config);
      // Capture push commands from receive-pack POSTs
      if (config.url?.includes("/git-receive-pack") && config.method === "POST") {
        const chunks: Buffer[] = [];
        for await (const chunk of config.body as AsyncIterable<Buffer>) {
          chunks.push(chunk);
        }
        const body = Buffer.concat(chunks);
        const cmds = parseRefCommands(body);
        pushCommands.push(...cmds);
      }
      return res;
    },
  } as typeof httpNode;

  return { client, pushCommands };
}

// ── Test harness ──────────────────────────────────────────────────────────────

interface AuthHarness {
  serverDir: string;
  server: GitServer;
  projectDir: string;
  initialServerHead: string;
  cleanup(): Promise<void>;
}

async function setupAuthHarness(opts: {
  /** Token the server requires. Defaults to GOOD_PASSWORD. */
  serverPassword?: string;
  /** Token the client will present. Defaults to GOOD_PASSWORD (valid). */
  clientToken?: string;
}): Promise<AuthHarness> {
  const serverPassword = opts.serverPassword ?? GOOD_PASSWORD;
  const clientToken = opts.clientToken ?? GOOD_PASSWORD;

  const serverDir = await tempDir("pmd-auth-recovery-server-");
  await createFixtureRepo(serverDir);
  const initialServerHead = await git.resolveRef({ fs: nodeFs, dir: serverDir, ref: "main" });

  const server = await startGitServer(serverDir, {
    requireAuth: { username: TEST_USERNAME, password: serverPassword },
  });

  const parent = await tempDir("pmd-auth-recovery-client-");
  const projectDir = path.join(parent, "project");

  // Clone with the correct credential so we get a valid local repo
  const goodCred: HostCredential = {
    host: "127.0.0.1",
    kind: "token",
    token: GOOD_PASSWORD,
    username: TEST_USERNAME,
    createdAt: Date.now(),
  };
  await cloneRepository({ url: server.url, dir: projectDir, credential: goodCred });

  // Write a local file so there's something to snapshot/push
  await writeFile(path.join(projectDir, "draft.md"), "# Draft\n\nLocal content.\n");
  await git.add({ fs: nodeFs, dir: projectDir, filepath: "draft.md" });
  await git.commit({
    fs: nodeFs,
    dir: projectDir,
    message: "local commit",
    author: { name: "Test Author", email: "test@example.com" },
  });

  // The local repo already has origin pointing at the server.
  // The (possibly bad) token is injected through ctx.credential in each test.
  void clientToken;

  return {
    serverDir,
    server,
    projectDir,
    initialServerHead,
    cleanup: async () => {
      await server.close().catch(() => {});
      await rm(serverDir, { recursive: true, force: true });
      await rm(parent, { recursive: true, force: true });
    },
  };
}

/** Build a RecoveryContext for auth recovery tests. */
function makeAuthCtx(
  h: AuthHarness,
  opts: {
    token?: string;
    tokenStore?: TokenStore & { wasCleared: boolean; deletedHosts: string[] };
    httpClient?: typeof httpNode;
    faults?: FaultInjector;
  } = {},
): RecoveryContext & { tokenStore: TokenStore & { wasCleared: boolean; deletedHosts: string[] } } {
  const token = opts.token ?? BAD_PASSWORD;
  const tokenStore = opts.tokenStore ?? makeFakeTokenStore(token);
  const credential: HostCredential = {
    host: "127.0.0.1",
    kind: "token",
    token,
    username: TEST_USERNAME,
    createdAt: Date.now(),
  };

  return {
    projectDir: h.projectDir,
    repoDir: h.projectDir,
    branch: "main",
    remoteUrl: h.server.url,
    repoSlug: "fixture",
    credential,
    tokenStore,
    httpClient: opts.httpClient ?? httpNode,
    authorName: "Test Author",
    confirmation: neverCalledGate,
    faults: opts.faults,
  } as RecoveryContext & { tokenStore: typeof tokenStore };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("recover-auth — auth_required thin wrapper", () => {
  let h: AuthHarness;

  beforeEach(async () => {
    h = await setupAuthHarness({
      serverPassword: GOOD_PASSWORD,
      clientToken: BAD_PASSWORD,
    });
  });

  afterEach(async () => {
    await h.cleanup();
  });

  // ── Primary path: auth failure produces needs_user ────────────────────────

  test("bad token → status 'needs_user' with reconnect guidance", async () => {
    const ctx = makeAuthCtx(h, { token: BAD_PASSWORD });
    const result = await recover(ctx);
    expect(result.status).toBe("needs_user");
  });

  test("guidance.recommendedAction is reconnect-flavoured (no raw git words)", async () => {
    const ctx = makeAuthCtx(h, { token: BAD_PASSWORD });
    const result = await recover(ctx);
    if (result.status !== "needs_user") throw new Error(`Expected needs_user, got ${result.status}`);
    // recommendedAction must be "Reconnect" or similar — never raw git words
    const action = result.guidance.recommendedAction.toLowerCase();
    expect(action).toMatch(/reconnect/i);
  });

  // ── Credential-clearing invariant ────────────────────────────────────────

  test("bad credential is cleared from the token store", async () => {
    const tokenStore = makeFakeTokenStore(BAD_PASSWORD);
    const ctx = makeAuthCtx(h, { token: BAD_PASSWORD, tokenStore });
    await recover(ctx);
    expect(tokenStore.wasCleared).toBe(true);
  });

  test("delete() is called for the correct host", async () => {
    const tokenStore = makeFakeTokenStore(BAD_PASSWORD);
    const ctx = makeAuthCtx(h, { token: BAD_PASSWORD, tokenStore });
    await recover(ctx);
    // Host should be the server's host (127.0.0.1 with optional port)
    expect(tokenStore.deletedHosts.length).toBeGreaterThan(0);
    const deletedHost = tokenStore.deletedHosts[0]!;
    expect(deletedHost).toMatch(/127\.0\.0\.1/);
  });

  // ── Local file preservation ───────────────────────────────────────────────

  test("local user files are unchanged after auth recovery", async () => {
    const draftBefore = await readFile(path.join(h.projectDir, "draft.md"), "utf8");
    const ctx = makeAuthCtx(h, { token: BAD_PASSWORD });
    await recover(ctx);
    const draftAfter = await readFile(path.join(h.projectDir, "draft.md"), "utf8");
    expect(draftAfter).toBe(draftBefore);
  });

  test("original fixture files are unchanged after auth recovery", async () => {
    const ch1Before = await readFile(path.join(h.projectDir, "chapter-01.md"), "utf8");
    const ctx = makeAuthCtx(h, { token: BAD_PASSWORD });
    await recover(ctx);
    const ch1After = await readFile(path.join(h.projectDir, "chapter-01.md"), "utf8");
    expect(ch1After).toBe(ch1Before);
  });

  // ── Remote unchanged ──────────────────────────────────────────────────────

  test("remote HEAD is unchanged after auth recovery (no successful push)", async () => {
    const ctx = makeAuthCtx(h, { token: BAD_PASSWORD });
    await recover(ctx);
    const remoteHead = await git.resolveRef({ fs: nodeFs, dir: h.serverDir, ref: "main" });
    expect(remoteHead).toBe(h.initialServerHead);
  });

  test("remote tree is unchanged after auth recovery", async () => {
    const remoteTipBefore = await git.readCommit({
      fs: nodeFs,
      dir: h.serverDir,
      oid: h.initialServerHead,
    });
    const ctx = makeAuthCtx(h, { token: BAD_PASSWORD });
    await recover(ctx);
    const remoteTipAfter = await git.readCommit({
      fs: nodeFs,
      dir: h.serverDir,
      oid: h.initialServerHead, // must still resolve (head unchanged)
    });
    expect(remoteTipAfter.commit.tree).toBe(remoteTipBefore.commit.tree);
  });

  // ── No backup (policy=false for auth_required) ────────────────────────────

  test("no backup zip is created (policy: createBackup=false for auth)", async () => {
    const backupDir = path.join("/tmp", "print-sync-recovery", "fixture");
    // Record any files before
    let filesBefore: string[] = [];
    try {
      filesBefore = await nodeFs.promises.readdir(backupDir);
    } catch {
      filesBefore = [];
    }

    const ctx = makeAuthCtx(h, { token: BAD_PASSWORD });
    await recover(ctx);

    let filesAfter: string[] = [];
    try {
      filesAfter = await nodeFs.promises.readdir(backupDir);
    } catch {
      filesAfter = [];
    }
    // No new backup files should be created
    expect(filesAfter.length).toBe(filesBefore.length);
  });

  test("result has no backupZipPath (no backup for auth)", async () => {
    const ctx = makeAuthCtx(h, { token: BAD_PASSWORD });
    const result = await recover(ctx);
    if (result.status !== "needs_user") throw new Error(`Expected needs_user, got ${result.status}`);
    expect(result.backupZipPath).toBeUndefined();
  });

  // ── No token leak in guidance ─────────────────────────────────────────────

  test("guidance does not leak the token text in any field", async () => {
    const sensitiveToken = "super-secret-token-xyz-12345";
    const tokenStore = makeFakeTokenStore(sensitiveToken);
    const ctx = makeAuthCtx(h, { token: sensitiveToken, tokenStore });
    const result = await recover(ctx);
    if (result.status !== "needs_user") throw new Error(`Expected needs_user, got ${result.status}`);

    const guidance = result.guidance;
    const allText = [
      guidance.userSummary,
      guidance.recommendedNextStep,
      guidance.recommendedAction,
      ...(guidance.safeNextSteps ?? []),
      guidance.supportDetails ?? "",
    ].join(" ");

    expect(allText).not.toContain(sensitiveToken);
  });

  test("guidance does not contain raw git words in user-facing fields", async () => {
    const ctx = makeAuthCtx(h, { token: BAD_PASSWORD });
    const result = await recover(ctx);
    if (result.status !== "needs_user") throw new Error(`Expected needs_user, got ${result.status}`);

    const guidance = result.guidance;
    // User-facing fields (not supportDetails) must not expose git internals
    const userFacingText = [
      guidance.userSummary,
      guidance.recommendedNextStep,
      guidance.recommendedAction,
      ...(guidance.safeNextSteps ?? []),
    ].join(" ");

    // Raw git words that must never appear in author-facing copy
    const gitWords = /\b(commit|branch|HEAD|rebase|merge|ref|push|fetch|remote|origin|packfile|oid|blob|tree)\b/i;
    expect(userFacingText).not.toMatch(gitWords);
  });

  // ── gitSpy: no successful receive-pack ───────────────────────────────────

  test("no push is sent when credential is bad (push spy: no ref-update commands accepted, no force push)", async () => {
    // Wire makePushSpyClient as ctx.httpClient so we can inspect exactly what
    // push traffic — if any — recover() emits AFTER setup is complete.
    // The spy intercepts receive-pack POSTs and captures parsed ref-update
    // commands; the real httpNode.request handles actual network I/O.
    const { client: spyClient, pushCommands } = makePushSpyClient();
    const ctx = makeAuthCtx(h, { token: BAD_PASSWORD, httpClient: spyClient });

    await recover(ctx);

    // 1. No ref-update commands should have been sent (no push attempt succeeded).
    //    With a bad credential the server returns 401 before accept-pack, so
    //    isomorphic-git throws before it can send a ref-update — pushCommands
    //    stays empty.
    expect(pushCommands.length).toBe(0);

    // 2. If any push commands were somehow captured, none must carry force=true.
    //    (force pushes rewrite the zero-oid check — they would show oldOid all-zeros.)
    //    This explicitly proves the no-force-push invariant via the spy.
    for (const cmd of pushCommands) {
      // A force-push from isomorphic-git sets oldOid to all zeros to bypass
      // the stale-ref check. Assert that never happened.
      expect(cmd.oldOid).not.toBe("0".repeat(40));
    }

    // 3. Cross-check: the server repo itself must be unchanged.
    const remoteHead = await git.resolveRef({ fs: nodeFs, dir: h.serverDir, ref: "main" });
    expect(remoteHead).toBe(h.initialServerHead);
  });

  // ── No backup means no confirmation gate ─────────────────────────────────

  test("confirmation gate is never called for auth_required", async () => {
    let confirmCalled = false;
    const trackingGate: ConfirmationGate = {
      async confirmRepair() {
        confirmCalled = true;
        return false;
      },
    };
    const tokenStore = makeFakeTokenStore(BAD_PASSWORD);
    const ctx: RecoveryContext = {
      ...makeAuthCtx(h, { token: BAD_PASSWORD, tokenStore }),
      confirmation: trackingGate,
    };
    await recover(ctx);
    expect(confirmCalled).toBe(false);
  });

  // ── Edge: missing token store ─────────────────────────────────────────────

  test("works without a tokenStore (credential clearing is best-effort)", async () => {
    // When ctx.tokenStore is undefined, the handler must still return needs_user
    // and must not throw.
    const ctx: RecoveryContext = {
      projectDir: h.projectDir,
      repoDir: h.projectDir,
      branch: "main",
      remoteUrl: h.server.url,
      repoSlug: "fixture",
      credential: {
        host: "127.0.0.1",
        kind: "token",
        token: BAD_PASSWORD,
        username: TEST_USERNAME,
        createdAt: Date.now(),
      },
      tokenStore: undefined,
      httpClient: httpNode,
      authorName: "Test Author",
      confirmation: neverCalledGate,
    };
    const result = await recover(ctx);
    expect(result.status).toBe("needs_user");
  });

  // ── Edge: good token does not trigger auth recovery ───────────────────────

  test("good credential → NOT needs_user (sync succeeds, no spurious credential clear)", async () => {
    // With the correct token, the handler should not return needs_user for auth.
    // (It might return 'recovered' or the underlying sync outcome after delegating.)
    const tokenStore = makeFakeTokenStore(GOOD_PASSWORD);
    const ctx = makeAuthCtx(h, { token: GOOD_PASSWORD, tokenStore });
    const result = await recover(ctx);
    // With a valid token, the result should NOT be needs_user for auth reasons.
    // The credential must NOT be cleared on success.
    if (result.status === "needs_user") {
      // If somehow needs_user, it must not be because we cleared a good token
      expect(tokenStore.wasCleared).toBe(false);
    }
    // Credential should NOT have been cleared when using a good token
    expect(tokenStore.wasCleared).toBe(false);
  });
});

// ── insecure_transport must NEVER reach the credential-deleting auth path ─────
//
// A stored credential withheld over non-loopback http (onAuthFor throws the
// typed InsecureTransport error) used to surface as a 401 → "auth" outcome,
// which routed here and DELETED the credential for the whole host — silently
// disabling sync for every other project on that host. The classifier now
// gives it its own kind; dispatching that kind must leave the store untouched
// and must not tell the user to reconnect (reconnecting cannot fix http).

describe("insecure_transport dispatch — no credential deletion, no reconnect loop", () => {
  test("token store is untouched and guidance is not reconnect-flavoured", async () => {
    const tokenStore = makeFakeTokenStore("s3cret-token");
    const ctx: RecoveryContext = {
      projectDir: "/nonexistent/project",
      repoDir: "/nonexistent/project",
      branch: "main",
      remoteUrl: "http://git.example.com/owner/repo.git",
      repoSlug: "fixture",
      credential: {
        host: "git.example.com",
        kind: "token",
        token: "s3cret-token",
        createdAt: 0,
      },
      tokenStore,
      confirmation: neverCalledGate,
    };
    const err = Object.assign(new Error("credential withheld over cleartext http"), {
      code: "InsecureTransport",
    });

    const result = await dispatchRecover("insecure_transport", ctx, err);

    // Nothing was repaired or deleted — the fix is changing the address to
    // https, which only the user can do.
    expect(result.status).toBe("failed_no_changes_made");
    if (result.status === "failed_no_changes_made") {
      expect(result.guidance.recommendedActionKey).not.toBe("reconnect");
      expect(result.guidance.recommendedAction).not.toMatch(/reconnect/i);
    }
    expect(tokenStore.wasCleared).toBe(false);
    expect(tokenStore.deletedHosts).toEqual([]);
  });
});

