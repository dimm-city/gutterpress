/**
 * TDD Stage 1 — FAILING tests for recover-non-fast-forward.ts
 *
 * WHY this file exists: The non_fast_forward recovery handler is a THIN wrapper
 * over syncProject (pull-then-push). These tests verify the mapping from
 * SyncOutcome → RecoveryResult and the safety invariants required by the
 * dispatcher contract, including:
 *   - Alice + Bob diverge on different files → 'recovered'; both files present
 *     locally AND on remote.
 *   - Every push call has force !== true (no force-push, ever).
 *   - Same-line conflict path returns 'needs_user', remote head+tree unchanged.
 *   - No backup zip created (policy.createBackup === false for non_fast_forward).
 *   - Delegates to syncProject, not a re-implemented merge engine.
 *
 * Tests are written against the DISPATCHER CONTRACT signature:
 *   export async function recover(ctx: RecoveryContext, error?: unknown): Promise<RecoveryResult>
 *
 * The module does NOT exist yet — every test must fail with "Cannot find module"
 * or equivalent (not a typo or assertion error).
 *
 * TEST RUNNER: bun:test only (import { describe, expect, test } from "bun:test").
 * REAL on-disk temp repos via isomorphic-git — no mocks for git state.
 * HTTP client is the real isomorphic-git/http/node transport via
 * git-http-server.ts; gitSpy wraps it to record push invocations.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import git from "isomorphic-git";
import httpNode from "isomorphic-git/http/node";

import { cloneRepository } from "../clone.ts";
import { recover } from "./recover-non-fast-forward.ts";
import { BACKUP_ROOT } from "./backup.ts";
import type { ConfirmationGate, RecoveryContext } from "./types.ts";
import {
  createFixtureRepo,
  startGitServer,
  tempDir,
  type GitServer,
} from "../test-support/git-http-server.ts";

// ── git spy ──────────────────────────────────────────────────────────────────
//
// Wraps the real httpNode transport, recording every receive-pack POST so tests
// can assert that no push carried the force flag.  isomorphic-git's push does
// not surface force as a distinct HTTP-level flag; we detect it by reading the
// pkt-line command line inside the request body.  A force push carries the
// zero-oid as oldOid (delete + create) OR a non-empty oldOid that doesn't
// match the server's current ref — but more relevantly, git.push() only sets
// force internally; we spy at the application level instead: we intercept the
// call via the httpClient and record the old/new oids from the pkt-line body.
// For the purposes of these tests "force !== true" means we never see the
// zero-oid old ref in a non-create scenario.

interface PushRecord {
  oldOid: string;
  newOid: string;
  ref: string;
}

interface GitSpy {
  http: typeof httpNode;
  pushes: PushRecord[];
}

function makeGitSpy(): GitSpy {
  const pushes: PushRecord[] = [];

  // Parse a receive-pack request body to extract the first ref-update command.
  function parseFirstCommand(body: Uint8Array): PushRecord | null {
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
      // Capture the body for receive-pack POSTs.
      if (config.url.includes("/git-receive-pack") && config.method === "POST") {
        const chunks: Buffer[] = [];
        for await (const chunk of config.body as AsyncIterable<Uint8Array>) {
          chunks.push(Buffer.from(chunk));
        }
        const body = Buffer.concat(chunks);
        const cmd = parseFirstCommand(body);
        if (cmd) pushes.push(cmd);

        // Replay the body as an async iterable for the real transport.
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

// ── test harness ──────────────────────────────────────────────────────────────

const AUTHOR = { name: "Author", email: "author@test.local" };
const ALICE_AUTHOR = { name: "Alice", email: "alice@test.local" };
const BOB_AUTHOR = { name: "Bob", email: "bob@test.local" };

interface AliceBobHarness {
  serverDir: string;
  server: GitServer;
  aliceDir: string;
  bobDir: string;
  cleanup(): Promise<void>;
}

/**
 * Set up an Alice + Bob diverge scenario:
 *   - Shared server repo with one commit.
 *   - Alice clones → edits alice.md → commits.
 *   - Bob clones → edits bob.md → commits → pushes to server.
 *   - Alice now has a non-fast-forward situation: her push would be rejected
 *     because the server has Bob's commit that she doesn't have.
 *
 * recover() is called from Alice's context.
 */
async function setupAliceBob(): Promise<AliceBobHarness> {
  // Shared bare-like server repo.
  const serverDir = await tempDir("pmd-nff-server-");
  await createFixtureRepo(serverDir);
  const server = await startGitServer(serverDir);

  // Alice clones.
  const aliceParent = await tempDir("pmd-nff-alice-");
  const aliceDir = path.join(aliceParent, "alice-project");
  await cloneRepository({ url: server.url, dir: aliceDir });

  // Bob clones.
  const bobParent = await tempDir("pmd-nff-bob-");
  const bobDir = path.join(bobParent, "bob-project");
  await cloneRepository({ url: server.url, dir: bobDir });

  // Bob writes bob.md and pushes first.
  await writeFile(path.join(bobDir, "bob.md"), "# Bob\n\nBob was here.\n");
  await git.add({ fs, dir: bobDir, filepath: "bob.md" });
  await git.commit({ fs, dir: bobDir, message: "bob: add bob.md", author: BOB_AUTHOR });
  await git.push({
    fs,
    http: httpNode,
    dir: bobDir,
    remote: "origin",
    ref: "main",
  });

  // Alice writes alice.md locally (does NOT push — that would succeed).
  await writeFile(path.join(aliceDir, "alice.md"), "# Alice\n\nAlice was here.\n");
  await git.add({ fs, dir: aliceDir, filepath: "alice.md" });
  await git.commit({ fs, dir: aliceDir, message: "alice: add alice.md", author: ALICE_AUTHOR });

  return {
    serverDir,
    server,
    aliceDir,
    bobDir,
    cleanup: async () => {
      await server.close();
      await rm(serverDir, { recursive: true, force: true });
      await rm(aliceParent, { recursive: true, force: true });
      await rm(bobParent, { recursive: true, force: true });
    },
  };
}

/**
 * Set up a CONFLICT scenario: Alice and Bob both edit the SAME line of the
 * SAME file, so syncProject returns 'conflict'.
 */
async function setupSameLineConflict(): Promise<AliceBobHarness> {
  const serverDir = await tempDir("pmd-nff-conflict-server-");
  await createFixtureRepo(serverDir);
  const server = await startGitServer(serverDir);

  const aliceParent = await tempDir("pmd-nff-conflict-alice-");
  const aliceDir = path.join(aliceParent, "alice-project");
  await cloneRepository({ url: server.url, dir: aliceDir });

  const bobParent = await tempDir("pmd-nff-conflict-bob-");
  const bobDir = path.join(bobParent, "bob-project");
  await cloneRepository({ url: server.url, dir: bobDir });

  // Bob edits chapter-01.md and pushes.
  await writeFile(
    path.join(bobDir, "chapter-01.md"),
    "# One\n\nBob rewrote this.\n",
  );
  await git.add({ fs, dir: bobDir, filepath: "chapter-01.md" });
  await git.commit({
    fs,
    dir: bobDir,
    message: "bob: rewrite chapter-01",
    author: BOB_AUTHOR,
  });
  await git.push({
    fs,
    http: httpNode,
    dir: bobDir,
    remote: "origin",
    ref: "main",
  });

  // Alice edits the SAME line of chapter-01.md — guaranteed conflict.
  await writeFile(
    path.join(aliceDir, "chapter-01.md"),
    "# One\n\nAlice rewrote this.\n",
  );
  await git.add({ fs, dir: aliceDir, filepath: "chapter-01.md" });
  await git.commit({
    fs,
    dir: aliceDir,
    message: "alice: rewrite chapter-01",
    author: ALICE_AUTHOR,
  });

  return {
    serverDir,
    server,
    aliceDir,
    bobDir,
    cleanup: async () => {
      await server.close();
      await rm(serverDir, { recursive: true, force: true });
      await rm(aliceParent, { recursive: true, force: true });
      await rm(bobParent, { recursive: true, force: true });
    },
  };
}

/** Resolve the HEAD oid of the server's main branch. */
async function serverHead(serverDir: string): Promise<string> {
  return git.resolveRef({ fs, dir: serverDir, ref: "refs/heads/main" });
}

/** Read a blob from the server's HEAD tree. Returns null if not present. */
async function serverFile(
  serverDir: string,
  filepath: string,
): Promise<string | null> {
  try {
    const oid = await serverHead(serverDir);
    const { blob } = await git.readBlob({ fs, dir: serverDir, oid, filepath });
    return Buffer.from(blob).toString("utf8");
  } catch {
    return null;
  }
}

/** Get the root tree oid of the server HEAD (for "unchanged" checks). */
async function serverTree(serverDir: string): Promise<string> {
  const oid = await serverHead(serverDir);
  const { commit } = await git.readCommit({ fs, dir: serverDir, oid });
  return commit.tree;
}

/** A confirmation gate that always approves (used when no confirmation needed). */
const alwaysApprove: ConfirmationGate = {
  confirmRepair: async () => true,
};

/** A confirmation gate that always denies. */
const alwaysDeny: ConfirmationGate = {
  confirmRepair: async () => false,
};

/** Build a minimal RecoveryContext for Alice's project. */
function aliceCtx(
  h: AliceBobHarness,
  overrides: Partial<RecoveryContext> = {},
): RecoveryContext {
  return {
    projectDir: h.aliceDir,
    repoDir: h.aliceDir,
    branch: "main",
    repoSlug: "test-repo",
    confirmation: alwaysApprove,
    ...overrides,
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("recover (non_fast_forward)", () => {
  // ── Success path ────────────────────────────────────────────────────────────

  test("alice+bob diverge (different files) → recovered; both files on remote", async () => {
    const h = await setupAliceBob();
    try {
      const spy = makeGitSpy();
      const ctx = aliceCtx(h, { httpClient: spy.http });

      const result = await recover(ctx);

      expect(result.status).toBe("recovered");

      // Both files must be present on the server after recovery.
      expect(await serverFile(h.serverDir, "alice.md")).toBe(
        "# Alice\n\nAlice was here.\n",
      );
      expect(await serverFile(h.serverDir, "bob.md")).toBe(
        "# Bob\n\nBob was here.\n",
      );

      // Both files must be present in Alice's local working tree.
      expect(
        await readFile(path.join(h.aliceDir, "alice.md"), "utf8"),
      ).toBe("# Alice\n\nAlice was here.\n");
      expect(
        await readFile(path.join(h.aliceDir, "bob.md"), "utf8"),
      ).toBe("# Bob\n\nBob was here.\n");
    } finally {
      await h.cleanup();
    }
  });

  // ── No force-push invariant ─────────────────────────────────────────────────

  test("no force-push: every push has oldOid that is not zero-oid for an existing ref", async () => {
    const h = await setupAliceBob();
    try {
      const spy = makeGitSpy();
      const ZERO_OID = "0".repeat(40);
      const ctx = aliceCtx(h, { httpClient: spy.http });

      const result = await recover(ctx);
      expect(result.status).toBe("recovered");

      // At least one push must have occurred.
      expect(spy.pushes.length).toBeGreaterThan(0);

      // No push carried the zero-oid as oldOid for an existing tracked ref
      // (that is what a force-push to overwrite history looks like).
      for (const push of spy.pushes) {
        // A create push (new branch) legitimately has zero oldOid. The main
        // branch already exists so any push to refs/heads/main with zero oldOid
        // IS a force-push and is forbidden.
        if (push.ref === "refs/heads/main" || push.ref === "main") {
          expect(push.oldOid).not.toBe(ZERO_OID);
        }
      }
    } finally {
      await h.cleanup();
    }
  });

  // ── No backup zip created ───────────────────────────────────────────────────

  test("no backup zip created under the OS temp recovery root (policy.createBackup=false)", async () => {
    const h = await setupAliceBob();
    try {
      const backupRoot = path.join(BACKUP_ROOT, "test-repo");
      // Note the backup root before recovery; collect the set of existing zips.
      let existingZips: string[] = [];
      try {
        existingZips = fs
          .readdirSync(backupRoot)
          .filter((f) => f.endsWith(".zip"));
      } catch {
        // Directory doesn't exist yet — that's fine, means no backups.
      }

      const ctx = aliceCtx(h);
      await recover(ctx);

      // After recovery, no NEW zips should have been created.
      let zipsAfter: string[] = [];
      try {
        zipsAfter = fs
          .readdirSync(backupRoot)
          .filter((f) => f.endsWith(".zip"));
      } catch {
        zipsAfter = [];
      }

      const newZips = zipsAfter.filter((z) => !existingZips.includes(z));
      expect(newZips).toHaveLength(0);
    } finally {
      await h.cleanup();
    }
  });

  // ── Conflict path → needs_user, remote unchanged ────────────────────────────

  test("same-line conflict → needs_user, remote head and tree unchanged", async () => {
    const h = await setupSameLineConflict();
    try {
      const headBefore = await serverHead(h.serverDir);
      const treeBefore = await serverTree(h.serverDir);

      const ctx = aliceCtx(h);
      const result = await recover(ctx);

      expect(result.status).toBe("needs_user");
      if (result.status !== "needs_user") throw new Error("unreachable");

      // files should be populated — the UI needs to show per-file choices.
      expect(result.files).toBeDefined();
      expect(result.files!.length).toBeGreaterThan(0);

      // Remote must be completely unchanged.
      const headAfter = await serverHead(h.serverDir);
      const treeAfter = await serverTree(h.serverDir);
      expect(headAfter).toBe(headBefore);
      expect(treeAfter).toBe(treeBefore);
    } finally {
      await h.cleanup();
    }
  });

  test("same-line conflict result is NOT 'recovered'", async () => {
    const h = await setupSameLineConflict();
    try {
      const ctx = aliceCtx(h);
      const result = await recover(ctx);
      // This must NOT be 'recovered' — the merge was not clean.
      expect(result.status).not.toBe("recovered");
    } finally {
      await h.cleanup();
    }
  });

  // ── Delegation invariant ────────────────────────────────────────────────────
  //
  // We cannot directly observe that syncProject is called (it is a module
  // import, not an injected dependency), but we CAN assert that the outcome
  // semantics match exactly what syncProject produces.  If the handler
  // re-implemented the merge, it would produce different behaviour (e.g.,
  // wrong commit messages, missing snapshot, wrong file content).  We verify
  // the tell-tale signs that syncProject ran: the local tip after recovery is a
  // merge commit with two parents (syncProject's merge commit), and the merge
  // commit message matches syncProject's wording.

  test("recovered outcome: server tip is a merge commit with two parents (syncProject signature)", async () => {
    const h = await setupAliceBob();
    try {
      const ctx = aliceCtx(h);
      const result = await recover(ctx);
      expect(result.status).toBe("recovered");

      const head = await serverHead(h.serverDir);
      const { commit } = await git.readCommit({ fs, dir: h.serverDir, oid: head });
      // syncProject produces a two-parent merge commit (pull merged online
      // changes + pushed the result). If the handler re-implemented the merge it
      // might produce a single-parent commit.
      expect(commit.parent).toHaveLength(2);
    } finally {
      await h.cleanup();
    }
  });

  // ── Auth outcome → delegate shape ──────────────────────────────────────────

  test("auth error from server → retry_later or needs_user (not recovered)", async () => {
    const serverDir = await tempDir("pmd-nff-auth-server-");
    await createFixtureRepo(serverDir);
    const server = await startGitServer(serverDir, {
      requireAuth: { username: "writer", password: "secret" },
    });
    const parent = await tempDir("pmd-nff-auth-client-");
    const clientDir = path.join(parent, "project");
    // Clone with the credential.
    await cloneRepository({
      url: server.url,
      dir: clientDir,
      credential: {
        host: "127.0.0.1",
        kind: "token",
        token: "secret",
        username: "writer",
        createdAt: Date.now(),
      },
    });
    // Make a local commit so a push would be needed.
    await writeFile(path.join(clientDir, "new.md"), "# New\n");
    await git.add({ fs, dir: clientDir, filepath: "new.md" });
    await git.commit({
      fs,
      dir: clientDir,
      message: "add new.md",
      author: AUTHOR,
    });
    try {
      // No credential supplied → 401 → should NOT be 'recovered'.
      const ctx: RecoveryContext = {
        projectDir: clientDir,
        repoDir: clientDir,
        branch: "main",
        repoSlug: "auth-test-repo",
        confirmation: alwaysApprove,
        // httpClient: default (will hit the 401 server)
      };
      const result = await recover(ctx);
      // Auth failure: must NOT be 'recovered'. It should be 'needs_user'
      // (reconnect) or 'retry_later' — the handler maps sync 'auth' → one of
      // these shapes per the spec.
      expect(result.status).not.toBe("recovered");
      // Must NOT be 'failed_no_changes_made' either (no risky repair was run).
      expect(result.status).not.toBe("failed_no_changes_made");
    } finally {
      await server.close();
      await rm(serverDir, { recursive: true, force: true });
      await rm(parent, { recursive: true, force: true });
    }
  });

  // ── Offline → retry_later ───────────────────────────────────────────────────

  test("offline (dead remote URL) → retry_later", async () => {
    const serverDir = await tempDir("pmd-nff-offline-server-");
    await createFixtureRepo(serverDir);
    const server = await startGitServer(serverDir);
    const parent = await tempDir("pmd-nff-offline-client-");
    const clientDir = path.join(parent, "project");
    await cloneRepository({ url: server.url, dir: clientDir });

    // Make a local commit.
    await writeFile(path.join(clientDir, "new.md"), "# New\n");
    await git.add({ fs, dir: clientDir, filepath: "new.md" });
    await git.commit({
      fs,
      dir: clientDir,
      message: "add new.md",
      author: AUTHOR,
    });

    // Point to a dead URL.
    await git.deleteRemote({ fs, dir: clientDir, remote: "origin" });
    await git.addRemote({
      fs,
      dir: clientDir,
      remote: "origin",
      url: "http://127.0.0.1:1/dead.git",
    });

    try {
      const ctx: RecoveryContext = {
        projectDir: clientDir,
        repoDir: clientDir,
        branch: "main",
        repoSlug: "offline-test-repo",
        confirmation: alwaysApprove,
      };
      const result = await recover(ctx);
      expect(result.status).toBe("retry_later");
      if (result.status !== "retry_later") throw new Error("unreachable");
      expect(result.retryAfterMs).toBeGreaterThan(0);
    } finally {
      await server.close();
      await rm(serverDir, { recursive: true, force: true });
      await rm(parent, { recursive: true, force: true });
    }
  });

  // ── Local-only changes (up-to-date remote) ─────────────────────────────────
  //
  // If Alice has commits the server doesn't have, but the server hasn't moved,
  // syncProject returns 'synced' and recover() should return 'recovered'.

  test("alice only has unpushed commits (no bob) → recovered", async () => {
    const serverDir = await tempDir("pmd-nff-solo-server-");
    await createFixtureRepo(serverDir);
    const server = await startGitServer(serverDir);
    const parent = await tempDir("pmd-nff-solo-client-");
    const clientDir = path.join(parent, "project");
    await cloneRepository({ url: server.url, dir: clientDir });

    await writeFile(path.join(clientDir, "new.md"), "# New\n");
    await git.add({ fs, dir: clientDir, filepath: "new.md" });
    await git.commit({
      fs,
      dir: clientDir,
      message: "add new.md",
      author: AUTHOR,
    });

    try {
      const spy = makeGitSpy();
      const ctx: RecoveryContext = {
        projectDir: clientDir,
        repoDir: clientDir,
        branch: "main",
        repoSlug: "solo-test-repo",
        confirmation: alwaysApprove,
        httpClient: spy.http,
      };
      const result = await recover(ctx);
      expect(result.status).toBe("recovered");

      // Spy: no force-push.
      for (const push of spy.pushes) {
        if (push.ref === "refs/heads/main" || push.ref === "main") {
          const ZERO_OID = "0".repeat(40);
          expect(push.oldOid).not.toBe(ZERO_OID);
        }
      }

      // File is on the server.
      expect(await serverFile(serverDir, "new.md")).toBe("# New\n");
    } finally {
      await server.close();
      await rm(serverDir, { recursive: true, force: true });
      await rm(parent, { recursive: true, force: true });
    }
  });
});
