/**
 * Sync / conflict-resolution tests (#15 sync phase, ADR 0006 D5).
 *
 * These run against the REAL in-process smart-HTTP server (upload-pack AND
 * receive-pack — see test-support/git-http-server.ts), so the full wire
 * protocol is exercised: ref advertisement, packfile upload, report-status.
 * No transport mocks, no shims.
 *
 * Invariants asserted throughout:
 *  - The pre-sync snapshot ALWAYS exists before any merge/network step
 *    (author work can never be lost).
 *  - A conflict NEVER leaves merge markers or a dirty working tree.
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import git from "isomorphic-git";
import httpNode from "isomorphic-git/http/node";

import { cloneRepository } from "./clone.ts";
import {
  onlineCopyPath,
  pushChanges,
  syncProject,
  SYNC_SNAPSHOT_MESSAGE,
  resolveConflicts,
  type SyncOutcome,
} from "./sync.ts";
import type { HostCredential } from "./token-store.ts";
import {
  createFixtureRepo,
  FLUSH,
  pkt,
  startGitServer,
  tempDir,
  type GitServer,
} from "./test-support/git-http-server.ts";

const SERVER_AUTHOR = { name: "Server", email: "server@test.local" };

interface Harness {
  serverDir: string;
  server: GitServer;
  projectDir: string;
  cleanup(): Promise<void>;
}

async function setupClone(opts: { requireAuth?: { username: string; password: string } } = {}): Promise<Harness> {
  const serverDir = await tempDir("pmd-sync-server-");
  await createFixtureRepo(serverDir);
  const server = await startGitServer(serverDir, opts);
  const parent = await tempDir("pmd-sync-client-");
  const projectDir = path.join(parent, "project");
  const credential: HostCredential | undefined = opts.requireAuth
    ? {
        host: "127.0.0.1",
        kind: "token",
        token: opts.requireAuth.password,
        username: opts.requireAuth.username,
        createdAt: Date.now(),
      }
    : undefined;
  await cloneRepository({
    url: server.url,
    dir: projectDir,
    ...(credential ? { credential } : {}),
  });
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

async function serverCommit(
  serverDir: string,
  files: Record<string, string | null>,
  message: string,
): Promise<string> {
  for (const [name, content] of Object.entries(files)) {
    if (content === null) {
      await rm(path.join(serverDir, name), { force: true });
      await git.remove({ fs, dir: serverDir, filepath: name });
    } else {
      await writeFile(path.join(serverDir, name), content);
      await git.add({ fs, dir: serverDir, filepath: name });
    }
  }
  return git.commit({ fs, dir: serverDir, message, author: SERVER_AUTHOR });
}

async function isClean(dir: string): Promise<boolean> {
  const matrix = await git.statusMatrix({ fs, dir });
  return matrix.every(([, head, work, stage]) => head === 1 && work === 1 && stage === 1);
}

async function serverHead(serverDir: string): Promise<string> {
  return git.resolveRef({ fs, dir: serverDir, ref: "refs/heads/main" });
}

async function serverFile(serverDir: string, filepath: string): Promise<string | null> {
  try {
    const oid = await serverHead(serverDir);
    const { blob } = await git.readBlob({ fs, dir: serverDir, oid, filepath });
    return Buffer.from(blob).toString("utf8");
  } catch {
    return null;
  }
}

/**
 * An httpClient that runs `beforePushAdvert` right before the FIRST `times`
 * receive-pack ref advertisements (the GET the client makes immediately
 * before uploading a push). Committing into the server repo from that hook
 * reproduces the REAL "someone synced between my fetch and my push" race:
 * the sync sequence has already fetched, and the ref moves before its push.
 */
function racingHttpClient(
  beforePushAdvert: () => Promise<void>,
  times = 1,
): typeof httpNode {
  let fired = 0;
  return {
    async request(config: Parameters<typeof httpNode.request>[0]) {
      if (config.url.includes("service=git-receive-pack") && fired < times) {
        fired++;
        await beforePushAdvert();
      }
      return httpNode.request(config);
    },
  } as typeof httpNode;
}

/**
 * An httpClient that lets the receive-pack ref advertisement through (so the
 * client builds and uploads a real push) but rewrites the receive-pack RESULT
 * body to a server-side rejection carrying `message` on the ref's report-status
 * `ng` line. This reproduces a NON-fast-forward (or a permission/hook decline)
 * rejection over the REAL wire format — isomorphic-git parses the side-band
 * report-status and throws GitPushError with that text — without touching the
 * shared in-process server.
 */
function pushRejectingHttpClient(message: string): typeof httpNode {
  return {
    async request(config: Parameters<typeof httpNode.request>[0]) {
      const res = await httpNode.request(config);
      const isReceivePackResult =
        config.method === "POST" && config.url.endsWith("/git-receive-pack");
      if (!isReceivePackResult) return res;
      // Drain the real response so the server finishes its work, then replace
      // the body with a side-band-wrapped report-status that rejects the ref.
      if (res.body) {
        for await (const _ of res.body) {
          // discard — we only need the server to have processed the push
        }
      }
      const report = Buffer.concat([
        pkt("unpack ok\n"),
        pkt(`ng refs/heads/main ${message}\n`),
        FLUSH,
      ]);
      const sideBand = Buffer.concat([
        pkt(Buffer.concat([Buffer.from([0x01]), report])),
        FLUSH,
      ]);
      return {
        ...res,
        body: (async function* () {
          yield new Uint8Array(sideBand);
        })(),
      };
    },
  } as typeof httpNode;
}

/** A tiny but real PNG byte sequence (1×1 transparent pixel). */
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06,
  0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44,
  0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d,
  0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42,
  0x60, 0x82,
]);

/** A second distinct PNG (different IDAT byte) so "mine" ≠ "theirs" in bytes. */
const PNG_BYTES_VARIANT = (() => {
  const b = new Uint8Array(PNG_BYTES);
  // Flip a byte inside the IDAT payload so the two images differ but both
  // remain non-UTF-8 binary blobs.
  b[44] = 0x02;
  return b;
})();

async function commitBinary(
  dir: string,
  filepath: string,
  bytes: Uint8Array,
): Promise<void> {
  await writeFile(path.join(dir, filepath), bytes);
  await git.add({ fs, dir, filepath });
}

describe("syncProject", () => {
  test("local changes only → snapshot + push; the remote head advances", async () => {
    const h = await setupClone();
    try {
      const before = await serverHead(h.serverDir);
      await writeFile(
        path.join(h.projectDir, "chapter-01.md"),
        "# One\n\nThird draft, written locally.\n",
      );

      const outcome = await syncProject({ projectDir: h.projectDir });
      expect(outcome.status).toBe("synced");
      if (outcome.status !== "synced") throw new Error("unreachable");
      expect(outcome.mergedRemoteChanges).toBe(false);
      // The snapshot-first invariant: unsaved work was committed before push.
      expect(outcome.snapshotId).toBeDefined();

      const after = await serverHead(h.serverDir);
      expect(after).not.toBe(before);
      expect(after).toBe(outcome.snapshotId!);
      expect(await serverFile(h.serverDir, "chapter-01.md")).toBe(
        "# One\n\nThird draft, written locally.\n",
      );
      expect(await isClean(h.projectDir)).toBe(true);
    } finally {
      await h.cleanup();
    }
  });

  test("nothing to sync → friendly up-to-date message", async () => {
    const h = await setupClone();
    try {
      const outcome = await syncProject({ projectDir: h.projectDir });
      expect(outcome.status).toBe("up-to-date");
      if (outcome.status !== "up-to-date") throw new Error("unreachable");
      expect(outcome.message).toBe("Everything is in sync.");
    } finally {
      await h.cleanup();
    }
  });

  test("remote-only fast-forward reports filesChanged so open buffers reconcile", async () => {
    const h = await setupClone();
    try {
      await serverCommit(
        h.serverDir,
        { "chapter-01.md": "# One\n\nEdited online.\n" },
        "online edit",
      );

      const outcome = await syncProject({ projectDir: h.projectDir });

      expect(outcome.status).toBe("up-to-date");
      if (outcome.status !== "up-to-date") throw new Error("unreachable");
      expect(outcome.filesChanged).toBe(true);
      expect(await readFile(path.join(h.projectDir, "chapter-01.md"), "utf8")).toBe(
        "# One\n\nEdited online.\n",
      );
    } finally {
      await h.cleanup();
    }
  });

  test("remote moved with no overlap → merge commit pushed, both histories present", async () => {
    const h = await setupClone();
    try {
      // Online: a brand-new file. Local: an edit to an existing file.
      const remoteCommit = await serverCommit(
        h.serverDir,
        { "chapter-02.md": "# Two\n\nWritten online.\n" },
        "online: add chapter two",
      );
      await writeFile(
        path.join(h.projectDir, "chapter-01.md"),
        "# One\n\nLocal third draft.\n",
      );

      const outcome = await syncProject({ projectDir: h.projectDir });
      expect(outcome.status).toBe("synced");
      if (outcome.status !== "synced") throw new Error("unreachable");
      expect(outcome.mergedRemoteChanges).toBe(true);

      // The pushed head is a TWO-PARENT merge commit containing both sides.
      const head = await serverHead(h.serverDir);
      const { commit } = await git.readCommit({ fs, dir: h.serverDir, oid: head });
      expect(commit.parent).toHaveLength(2);
      expect(commit.parent).toContain(remoteCommit);
      expect(await serverFile(h.serverDir, "chapter-01.md")).toBe(
        "# One\n\nLocal third draft.\n",
      );
      expect(await serverFile(h.serverDir, "chapter-02.md")).toBe(
        "# Two\n\nWritten online.\n",
      );
      // The online file arrived in the local working tree too.
      expect(
        await readFile(path.join(h.projectDir, "chapter-02.md"), "utf8"),
      ).toBe("# Two\n\nWritten online.\n");
    } finally {
      await h.cleanup();
    }
  });

  test("true conflict → status conflict, tree stays CLEAN, no merge markers", async () => {
    const h = await setupClone();
    try {
      await serverCommit(
        h.serverDir,
        { "chapter-01.md": "# One\n\nOnline rewrite.\n" },
        "online edit",
      );
      const localText = "# One\n\nLocal rewrite.\n";
      await writeFile(path.join(h.projectDir, "chapter-01.md"), localText);

      const outcome = await syncProject({ projectDir: h.projectDir });
      expect(outcome.status).toBe("conflict");
      if (outcome.status !== "conflict") throw new Error("unreachable");
      expect(outcome.files).toEqual([
        { path: "chapter-01.md", kind: "both-edited" },
      ]);
      expect(outcome.localId).toMatch(/^[0-9a-f]{40}$/);
      expect(outcome.remoteId).toMatch(/^[0-9a-f]{40}$/);

      // The working tree is clean (the snapshot IS the current state) and the
      // file contains the author's text — never markers.
      expect(await isClean(h.projectDir)).toBe(true);
      const content = await readFile(
        path.join(h.projectDir, "chapter-01.md"),
        "utf8",
      );
      expect(content).toBe(localText);
      expect(content).not.toContain("<<<<<<<");
      // The safety snapshot exists and is the local tip.
      const [headLog] = await git.log({ fs, dir: h.projectDir, depth: 1 });
      expect(headLog!.commit.message.trim()).toBe(SYNC_SNAPSHOT_MESSAGE);
      expect(headLog!.oid).toBe(outcome.localId);
    } finally {
      await h.cleanup();
    }
  });

  test("401 → status auth (and the snapshot still protected the work)", async () => {
    const h = await setupClone({
      requireAuth: { username: "writer", password: "secret-token" },
    });
    try {
      await writeFile(
        path.join(h.projectDir, "chapter-01.md"),
        "# One\n\nEdited while signed out.\n",
      );
      // No credential supplied and none in a store → fetch gets a 401.
      const outcome = await syncProject({ projectDir: h.projectDir });
      expect(outcome.status).toBe("auth");
      if (outcome.status !== "auth") throw new Error("unreachable");
      expect(outcome.snapshotId).toBeDefined();
      expect(await isClean(h.projectDir)).toBe(true);
    } finally {
      await h.cleanup();
    }
  });

  test("with the right credential the same server accepts the sync", async () => {
    const h = await setupClone({
      requireAuth: { username: "writer", password: "secret-token" },
    });
    try {
      await writeFile(
        path.join(h.projectDir, "chapter-01.md"),
        "# One\n\nEdited while signed in.\n",
      );
      const outcome = await syncProject({
        projectDir: h.projectDir,
        credential: {
          host: "127.0.0.1",
          kind: "token",
          token: "secret-token",
          username: "writer",
          createdAt: Date.now(),
        },
      });
      expect(outcome.status).toBe("synced");
      expect(await serverFile(h.serverDir, "chapter-01.md")).toBe(
        "# One\n\nEdited while signed in.\n",
      );
    } finally {
      await h.cleanup();
    }
  });

  test("offline → friendly retry-later, local snapshot intact", async () => {
    const h = await setupClone();
    try {
      // Point the remote at a dead address (the server keeps running so
      // cleanup works, but the project can no longer reach a repository).
      await git.deleteRemote({ fs, dir: h.projectDir, remote: "origin" });
      await git.addRemote({
        fs,
        dir: h.projectDir,
        remote: "origin",
        url: "http://127.0.0.1:1/unreachable.git",
      });
      const localText = "# One\n\nWritten on a train.\n";
      await writeFile(path.join(h.projectDir, "chapter-01.md"), localText);

      const outcome = await syncProject({ projectDir: h.projectDir });
      expect(outcome.status).toBe("offline");
      if (outcome.status !== "offline") throw new Error("unreachable");
      expect(outcome.message).toContain("saved on this computer");
      // Work is snapshotted locally and untouched.
      expect(outcome.snapshotId).toBeDefined();
      expect(await isClean(h.projectDir)).toBe(true);
      expect(
        await readFile(path.join(h.projectDir, "chapter-01.md"), "utf8"),
      ).toBe(localText);
      const [headLog] = await git.log({ fs, dir: h.projectDir, depth: 1 });
      expect(headLog!.commit.message.trim()).toBe(SYNC_SNAPSHOT_MESSAGE);
    } finally {
      await h.cleanup();
    }
  });

  test("push rejected mid-sync → the retry loop merges the racer's change and syncs", async () => {
    const h = await setupClone();
    try {
      await writeFile(
        path.join(h.projectDir, "chapter-01.md"),
        "# One\n\nLocal third draft.\n",
      );
      // The remote moves AFTER sync's fetch, right before its push: the
      // first push attempt is rejected (non-fast-forward), the loop re-runs,
      // merges the racer's commit, and the second push lands.
      const httpClient = racingHttpClient(async () => {
        await serverCommit(
          h.serverDir,
          { "racer.md": "Synced by someone else mid-flight.\n" },
          "racer",
        );
      }, 1);

      const outcome = await syncProject({ projectDir: h.projectDir, httpClient });
      expect(outcome.status).toBe("synced");
      if (outcome.status !== "synced") throw new Error("unreachable");
      expect(outcome.mergedRemoteChanges).toBe(true);

      // Both sides of the race are on the server head…
      expect(await serverFile(h.serverDir, "chapter-01.md")).toBe(
        "# One\n\nLocal third draft.\n",
      );
      expect(await serverFile(h.serverDir, "racer.md")).toBe(
        "Synced by someone else mid-flight.\n",
      );
      // …and the racer's file arrived locally via the merge.
      expect(
        await readFile(path.join(h.projectDir, "racer.md"), "utf8"),
      ).toBe("Synced by someone else mid-flight.\n");
      expect(await isClean(h.projectDir)).toBe(true);
    } finally {
      await h.cleanup();
    }
  });

  test("push rejected on EVERY attempt → friendly race message, work stays safe", async () => {
    const h = await setupClone();
    try {
      await writeFile(
        path.join(h.projectDir, "chapter-01.md"),
        "# One\n\nLocal third draft.\n",
      );
      let n = 0;
      // The remote moves before EVERY push attempt — every attempt rejects.
      // (times=10 exceeds any reasonable bounded budget, so the loop always
      // exhausts its attempts and surfaces the friendly race message.)
      const httpClient = racingHttpClient(async () => {
        n++;
        await serverCommit(h.serverDir, { [`racer-${n}.md`]: `racer ${n}\n` }, `racer ${n}`);
      }, 10);

      const outcome = await syncProject({
        projectDir: h.projectDir,
        httpClient,
        retry: { backoffMs: 0 },
      });
      expect(outcome.status).toBe("error");
      if (outcome.status !== "error") throw new Error("unreachable");
      expect(outcome.message).toContain("at the same moment");
      // The snapshot protected the work; nothing was lost or left dirty.
      expect(outcome.snapshotId).toBeDefined();
      expect(await isClean(h.projectDir)).toBe(true);
    } finally {
      await h.cleanup();
    }
  });
});

describe("test server receive-pack validation", () => {
  test("a stale oldOid is rejected as non-fast-forward and the ref does not move", async () => {
    const serverDir = await tempDir("pmd-sync-nff-server-");
    const { first } = await createFixtureRepo(serverDir);
    const server = await startGitServer(serverDir);
    try {
      const headBefore = await serverHead(serverDir);
      expect(headBefore).not.toBe(first);

      // Hand-built receive-pack request whose oldOid is the STALE first
      // commit (the ref has since moved to `head`) and no packfile bytes.
      const body = Buffer.concat([
        pkt(`${first} ${"f".repeat(40)} refs/heads/main\0report-status side-band-64k\n`),
        FLUSH,
      ]);
      const res = await fetch(`${server.url}/git-receive-pack`, {
        method: "POST",
        headers: { "content-type": "application/x-git-receive-pack-request" },
        body,
      });
      const text = Buffer.from(await res.arrayBuffer()).toString("utf8");
      expect(text).toContain("unpack ok");
      expect(text).toContain("ng refs/heads/main non-fast-forward");
      expect(text).not.toContain("ok refs/heads/main");
      // The ref was NOT moved.
      expect(await serverHead(serverDir)).toBe(headBefore);
    } finally {
      await server.close();
      await rm(serverDir, { recursive: true, force: true });
    }
  });
});

describe("resolveConflicts", () => {
  /** Drive sync into the standard both-edited conflict. */
  async function conflictSetup(): Promise<{
    h: Harness;
    conflict: Extract<SyncOutcome, { status: "conflict" }>;
    localText: string;
    onlineText: string;
  }> {
    const h = await setupClone();
    const onlineText = "# One\n\nOnline rewrite.\n";
    await serverCommit(h.serverDir, { "chapter-01.md": onlineText }, "online edit");
    const localText = "# One\n\nLocal rewrite.\n";
    await writeFile(path.join(h.projectDir, "chapter-01.md"), localText);
    const outcome = await syncProject({ projectDir: h.projectDir });
    if (outcome.status !== "conflict") {
      await h.cleanup();
      throw new Error(`expected conflict, got ${outcome.status}`);
    }
    return { h, conflict: outcome, localText, onlineText };
  }

  async function expectPushedTwoParentMerge(h: Harness): Promise<void> {
    const head = await serverHead(h.serverDir);
    const { commit } = await git.readCommit({ fs, dir: h.serverDir, oid: head });
    // The pushed history contains a two-parent merge commit (the head itself,
    // or — for delete-style resolutions — the parent of a small follow-up).
    const merge =
      commit.parent.length === 2
        ? commit
        : (await git.readCommit({ fs, dir: h.serverDir, oid: commit.parent[0]! }))
            .commit;
    expect(merge.parent).toHaveLength(2);
  }

  test('"Keep my version" → my content everywhere, merge pushed with two parents', async () => {
    const { h, conflict, localText } = await conflictSetup();
    try {
      const outcome = await resolveConflicts({
        projectDir: h.projectDir,
        resolutions: [{ path: "chapter-01.md", choice: "mine" }],
        localId: conflict.localId,
        remoteId: conflict.remoteId,
      });
      expect(outcome.status).toBe("synced");
      expect(
        await readFile(path.join(h.projectDir, "chapter-01.md"), "utf8"),
      ).toBe(localText);
      expect(await serverFile(h.serverDir, "chapter-01.md")).toBe(localText);
      expect(await isClean(h.projectDir)).toBe(true);
      await expectPushedTwoParentMerge(h);

      // No conflict markers anywhere in the project.
      const text = await readFile(path.join(h.projectDir, "chapter-01.md"), "utf8");
      expect(text).not.toContain("<<<<<<<");
      expect(text).not.toContain(">>>>>>>");
    } finally {
      await h.cleanup();
    }
  });

  test('"Use the online version" → online content everywhere', async () => {
    const { h, conflict, onlineText } = await conflictSetup();
    try {
      const outcome = await resolveConflicts({
        projectDir: h.projectDir,
        resolutions: [{ path: "chapter-01.md", choice: "theirs" }],
        localId: conflict.localId,
        remoteId: conflict.remoteId,
      });
      expect(outcome.status).toBe("synced");
      expect(
        await readFile(path.join(h.projectDir, "chapter-01.md"), "utf8"),
      ).toBe(onlineText);
      expect(await serverFile(h.serverDir, "chapter-01.md")).toBe(onlineText);
      expect(await isClean(h.projectDir)).toBe(true);
      await expectPushedTwoParentMerge(h);
    } finally {
      await h.cleanup();
    }
  });

  test('"Keep both copies" → mine at the original path, online copy alongside', async () => {
    const { h, conflict, localText, onlineText } = await conflictSetup();
    try {
      const outcome = await resolveConflicts({
        projectDir: h.projectDir,
        resolutions: [{ path: "chapter-01.md", choice: "both" }],
        localId: conflict.localId,
        remoteId: conflict.remoteId,
      });
      expect(outcome.status).toBe("synced");
      const copyName = onlineCopyPath("chapter-01.md");
      expect(copyName).toBe("chapter-01 (online copy).md");
      expect(
        await readFile(path.join(h.projectDir, "chapter-01.md"), "utf8"),
      ).toBe(localText);
      expect(
        await readFile(path.join(h.projectDir, copyName), "utf8"),
      ).toBe(onlineText);
      expect(await serverFile(h.serverDir, "chapter-01.md")).toBe(localText);
      expect(await serverFile(h.serverDir, copyName)).toBe(onlineText);
      expect(await isClean(h.projectDir)).toBe(true);
      await expectPushedTwoParentMerge(h);
    } finally {
      await h.cleanup();
    }
  });

  test("delete-vs-edit conflict: keeping my deletion wins on both sides", async () => {
    const h = await setupClone();
    try {
      await serverCommit(
        h.serverDir,
        { "chapter-01.md": "# One\n\nOnline edit to a file I deleted.\n" },
        "online edit",
      );
      await rm(path.join(h.projectDir, "chapter-01.md"));

      const outcome = await syncProject({ projectDir: h.projectDir });
      expect(outcome.status).toBe("conflict");
      if (outcome.status !== "conflict") throw new Error("unreachable");
      expect(outcome.files).toEqual([
        { path: "chapter-01.md", kind: "you-deleted" },
      ]);

      const resolved = await resolveConflicts({
        projectDir: h.projectDir,
        resolutions: [{ path: "chapter-01.md", choice: "mine" }],
        localId: outcome.localId,
        remoteId: outcome.remoteId,
      });
      expect(resolved.status).toBe("synced");
      expect(fs.existsSync(path.join(h.projectDir, "chapter-01.md"))).toBe(false);
      expect(await serverFile(h.serverDir, "chapter-01.md")).toBeNull();
      expect(await isClean(h.projectDir)).toBe(true);
      await expectPushedTwoParentMerge(h);
    } finally {
      await h.cleanup();
    }
  });

  test("edit-vs-online-delete conflict: keeping my edit restores the file on both sides", async () => {
    const h = await setupClone();
    try {
      // The online copy DELETED the file; the author edited it.
      await serverCommit(h.serverDir, { "chapter-01.md": null }, "online delete");
      const myText = "# One\n\nEdited after the online copy deleted it.\n";
      await writeFile(path.join(h.projectDir, "chapter-01.md"), myText);

      const outcome = await syncProject({ projectDir: h.projectDir });
      expect(outcome.status).toBe("conflict");
      if (outcome.status !== "conflict") throw new Error("unreachable");
      expect(outcome.files).toEqual([
        { path: "chapter-01.md", kind: "online-deleted" },
      ]);

      const resolved = await resolveConflicts({
        projectDir: h.projectDir,
        resolutions: [{ path: "chapter-01.md", choice: "mine" }],
        localId: outcome.localId,
        remoteId: outcome.remoteId,
      });
      expect(resolved.status).toBe("synced");
      expect(
        await readFile(path.join(h.projectDir, "chapter-01.md"), "utf8"),
      ).toBe(myText);
      expect(await serverFile(h.serverDir, "chapter-01.md")).toBe(myText);
      expect(await isClean(h.projectDir)).toBe(true);
      await expectPushedTwoParentMerge(h);
    } finally {
      await h.cleanup();
    }
  });

  test('"Keep both copies" never overwrites a pre-existing "(online copy)" file', async () => {
    const { h, conflict, localText, onlineText } = await conflictSetup();
    try {
      // A file with the default copy name ALREADY exists (e.g. from an
      // earlier "Keep both"). It must survive untouched.
      const existingName = "chapter-01 (online copy).md";
      const existingText = "# Pre-existing online copy — do not clobber.\n";
      await writeFile(path.join(h.projectDir, existingName), existingText);

      const outcome = await resolveConflicts({
        projectDir: h.projectDir,
        resolutions: [{ path: "chapter-01.md", choice: "both" }],
        localId: conflict.localId,
        remoteId: conflict.remoteId,
      });
      expect(outcome.status).toBe("synced");
      // The pre-existing file is byte-identical…
      expect(
        await readFile(path.join(h.projectDir, existingName), "utf8"),
      ).toBe(existingText);
      // …and the online version landed under the uniquified name.
      const uniquified = "chapter-01 (online copy 2).md";
      expect(
        await readFile(path.join(h.projectDir, uniquified), "utf8"),
      ).toBe(onlineText);
      expect(
        await readFile(path.join(h.projectDir, "chapter-01.md"), "utf8"),
      ).toBe(localText);
      expect(await serverFile(h.serverDir, uniquified)).toBe(onlineText);
      expect(await isClean(h.projectDir)).toBe(true);
    } finally {
      await h.cleanup();
    }
  });

  test("remote moves (no overlap) between conflict and confirm → recovery merge, synced", async () => {
    const { h, conflict, localText } = await conflictSetup();
    try {
      // Someone syncs a NON-conflicting file while the choices dialog is
      // open: the resolution push is rejected, the recovery pass fetches the
      // new tip, merges it cleanly, and pushes again — no author interaction.
      await serverCommit(
        h.serverDir,
        { "chapter-03.md": "# Three\n\nSynced mid-resolution.\n" },
        "mid-resolution add",
      );

      const outcome = await resolveConflicts({
        projectDir: h.projectDir,
        resolutions: [{ path: "chapter-01.md", choice: "mine" }],
        localId: conflict.localId,
        remoteId: conflict.remoteId,
      });
      expect(outcome.status).toBe("synced");
      expect(await serverFile(h.serverDir, "chapter-01.md")).toBe(localText);
      expect(await serverFile(h.serverDir, "chapter-03.md")).toBe(
        "# Three\n\nSynced mid-resolution.\n",
      );
      expect(
        await readFile(path.join(h.projectDir, "chapter-03.md"), "utf8"),
      ).toBe("# Three\n\nSynced mid-resolution.\n");
      expect(await isClean(h.projectDir)).toBe(true);
    } finally {
      await h.cleanup();
    }
  });

  test("remote moves the SAME file between conflict and confirm → fresh conflict with the NEW tip", async () => {
    const { h, conflict, localText } = await conflictSetup();
    try {
      // The contested file changes online AGAIN while the dialog is open.
      const newerText = "# One\n\nOnline rewrite, take two.\n";
      const newerTip = await serverCommit(
        h.serverDir,
        { "chapter-01.md": newerText },
        "online edit two",
      );

      const outcome = await resolveConflicts({
        projectDir: h.projectDir,
        resolutions: [{ path: "chapter-01.md", choice: "mine" }],
        localId: conflict.localId,
        remoteId: conflict.remoteId,
      });
      // NOT a dead-end "try again": a fresh conflict carrying the NEW online
      // tip so the next confirm targets reality.
      expect(outcome.status).toBe("conflict");
      if (outcome.status !== "conflict") throw new Error("unreachable");
      expect(outcome.remoteId).toBe(newerTip);
      expect(outcome.files).toEqual([
        { path: "chapter-01.md", kind: "both-edited" },
      ]);
      expect(await isClean(h.projectDir)).toBe(true);

      // Confirming against the fresh ids completes the sync.
      const second = await resolveConflicts({
        projectDir: h.projectDir,
        resolutions: [{ path: "chapter-01.md", choice: "mine" }],
        localId: outcome.localId,
        remoteId: outcome.remoteId,
      });
      expect(second.status).toBe("synced");
      expect(await serverFile(h.serverDir, "chapter-01.md")).toBe(localText);
      expect(await isClean(h.projectDir)).toBe(true);
    } finally {
      await h.cleanup();
    }
  });
});

// ── Opening a subfolder syncs the WHOLE enclosing repo (no per-book scoping) ──

describe("syncProject opened on a subfolder", () => {
  test("syncs the whole enclosing repo (one snapshot, whole tree) — plain git, no scoping", async () => {
    const h = await setupClone();
    try {
      const dirA = path.join(h.projectDir, "book-a");
      const dirB = path.join(h.projectDir, "book-b");
      await mkdir(dirA, { recursive: true });
      await mkdir(dirB, { recursive: true });
      await writeFile(path.join(dirA, "chapter-01.md"), "# A\n\nBook A draft.\n");
      await writeFile(path.join(dirB, "chapter-01.md"), "# B\n\nBook B draft.\n");

      // Syncing from the subfolder operates on the ENCLOSING repo (a project is
      // its git repo) — one whole-tree snapshot, then push.
      const outcome = await syncProject({
        projectDir: dirA,
        message: "Snapshot before syncing",
      });
      expect(outcome.status).toBe("synced");
      if (outcome.status !== "synced") throw new Error("unreachable");
      expect(outcome.snapshotId).toBeDefined();

      // Both books reached the server — one push of the whole repository.
      expect(await serverFile(h.serverDir, "book-a/chapter-01.md")).toBe(
        "# A\n\nBook A draft.\n",
      );
      expect(await serverFile(h.serverDir, "book-b/chapter-01.md")).toBe(
        "# B\n\nBook B draft.\n",
      );

      // ONE snapshot commit, and it contains the WHOLE tree — book B included.
      // (No special per-book scoping, no extra "shared folder" commit.)
      const snap = await git.readCommit({
        fs,
        dir: h.projectDir,
        oid: outcome.snapshotId!,
      });
      const blobB = await git.readBlob({
        fs,
        dir: h.projectDir,
        oid: snap.oid,
        filepath: "book-b/chapter-01.md",
      });
      expect(new TextDecoder().decode(blobB.blob)).toBe("# B\n\nBook B draft.\n");

      expect(await isClean(h.projectDir)).toBe(true);
    } finally {
      await h.cleanup();
    }
  });

  test("two books in one repo serialize and both sync cleanly", async () => {
    const h = await setupClone();
    try {
      const dirA = path.join(h.projectDir, "book-a");
      const dirB = path.join(h.projectDir, "book-b");
      await mkdir(dirA, { recursive: true });
      await mkdir(dirB, { recursive: true });
      await writeFile(path.join(dirA, "chapter-01.md"), "# A\n");
      const first = await syncProject({ projectDir: dirA, message: "A" });
      expect(first.status).toBe("synced");
      await writeFile(path.join(dirB, "chapter-01.md"), "# B\n");
      const second = await syncProject({ projectDir: dirB, message: "B" });
      expect(second.status).toBe("synced");
      expect(await serverFile(h.serverDir, "book-a/chapter-01.md")).toBe("# A\n");
      expect(await serverFile(h.serverDir, "book-b/chapter-01.md")).toBe("# B\n");
    } finally {
      await h.cleanup();
    }
  });
});

// ── BUG 2: isPushRejected must only treat a genuine non-fast-forward as ────────
//          pull-first; permission/hook rejections surface to the auth classifier.

describe("push rejection precision (BUG 2)", () => {
  test("a genuine non-fast-forward still maps to pull-first (remote ahead)", async () => {
    const h = await setupClone();
    try {
      // The online copy moved ahead; a local commit makes this a real
      // non-fast-forward. pushChanges must report pull-first (never auth).
      await serverCommit(h.serverDir, { "online.md": "online\n" }, "online");
      await writeFile(path.join(h.projectDir, "chapter-01.md"), "local edit\n");
      await git.add({ fs, dir: h.projectDir, filepath: "chapter-01.md" });
      await git.commit({
        fs,
        dir: h.projectDir,
        message: "local",
        author: { name: "L", email: "l@test.local" },
      });

      const outcome = await pushChanges({ projectDir: h.projectDir });
      expect(outcome.status).toBe("pull-first");
    } finally {
      await h.cleanup();
    }
  });

  test("a server-side non-fast-forward rejection maps to pull-first", async () => {
    const h = await setupClone();
    try {
      await writeFile(path.join(h.projectDir, "chapter-01.md"), "local\n");
      // The server rejects with a non-fast-forward report-status.
      const httpClient = pushRejectingHttpClient("non-fast-forward");
      const outcome = await pushChanges({ projectDir: h.projectDir, httpClient });
      expect(outcome.status).toBe("pull-first");
    } finally {
      await h.cleanup();
    }
  });

  test("a PERMISSION-style push rejection does NOT map to pull-first", async () => {
    const h = await setupClone();
    try {
      await writeFile(path.join(h.projectDir, "chapter-01.md"), "local\n");
      // The server declines for permission/policy reasons — pulling can't fix
      // this, so it must surface as auth (NOT pull-first, NOT a race message).
      const httpClient = pushRejectingHttpClient("permission denied");
      const outcome = await pushChanges({ projectDir: h.projectDir, httpClient });
      expect(outcome.status).not.toBe("pull-first");
      expect(outcome.status).toBe("auth");
    } finally {
      await h.cleanup();
    }
  });

  test("a pre-receive hook decline does NOT map to pull-first", async () => {
    const h = await setupClone();
    try {
      await writeFile(path.join(h.projectDir, "chapter-01.md"), "local\n");
      const httpClient = pushRejectingHttpClient("pre-receive hook declined");
      const outcome = await pushChanges({ projectDir: h.projectDir, httpClient });
      expect(outcome.status).not.toBe("pull-first");
      // A hook decline is an auth/permission-class problem, not a race.
      expect(outcome.status).toBe("auth");
    } finally {
      await h.cleanup();
    }
  });
});

// ── BUG 3: a MIXED text+binary conflict must keep binary bytes byte-identical ──

describe("resolveConflicts binary safety (BUG 3)", () => {
  /**
   * Build a TRUE mixed conflict: a base commit (text + binary) is the common
   * ancestor of BOTH sides, then the server and the local clone each diverge
   * by editing BOTH files differently — so a sync merge conflicts on both.
   *
   * The clone happens AFTER the binary base lands on the server so the client
   * shares that ancestor (otherwise a fast-forward would erase the divergence).
   */
  async function setupBinaryConflict(myPng: Uint8Array): Promise<{
    h: Harness;
    onlinePng: Uint8Array;
  }> {
    const serverDir = await tempDir("pmd-bin-server-");
    await createFixtureRepo(serverDir);
    // Base commit on the server: a binary cover + a text chapter (the shared
    // ancestor both sides will diverge from).
    await commitBinary(serverDir, "cover.png", PNG_BYTES);
    await writeFile(path.join(serverDir, "chapter-01.md"), "# One\n\nBase.\n");
    await git.add({ fs, dir: serverDir, filepath: "chapter-01.md" });
    await git.commit({
      fs,
      dir: serverDir,
      message: "base with binary",
      author: SERVER_AUTHOR,
    });

    const server = await startGitServer(serverDir);
    const parent = await tempDir("pmd-bin-client-");
    const projectDir = path.join(parent, "project");
    // Clone NOW — the client gets the binary base as its common ancestor.
    await cloneRepository({ url: server.url, dir: projectDir });

    // The ONLINE copy diverges: a distinct binary variant + a text edit.
    const onlinePng = PNG_BYTES_VARIANT;
    await commitBinary(serverDir, "cover.png", onlinePng);
    await serverCommit(
      serverDir,
      { "chapter-01.md": "# One\n\nOnline rewrite.\n" },
      "online edits both",
    );

    // The LOCAL copy diverges differently on BOTH files (committed, not just
    // working-tree edits, so the snapshot captures a real divergent tip).
    await writeFile(path.join(projectDir, "cover.png"), myPng);
    await writeFile(path.join(projectDir, "chapter-01.md"), "# One\n\nLocal rewrite.\n");
    await git.add({ fs, dir: projectDir, filepath: "cover.png" });
    await git.add({ fs, dir: projectDir, filepath: "chapter-01.md" });
    await git.commit({
      fs,
      dir: projectDir,
      message: "local edits both",
      author: { name: "Local", email: "local@test.local" },
    });

    const h: Harness = {
      serverDir,
      server,
      projectDir,
      cleanup: async () => {
        await server.close().catch(() => {});
        await rm(serverDir, { recursive: true, force: true });
        await rm(parent, { recursive: true, force: true });
      },
    };
    return { h, onlinePng };
  }

  test("mixed .png + .md conflict → MY binary bytes are byte-identical after resolve", async () => {
    const myPng = new Uint8Array(PNG_BYTES);
    myPng[44] = 0x03; // a THIRD distinct binary variant — the author's bytes
    const { h } = await setupBinaryConflict(myPng);
    try {
      const outcome = await syncProject({ projectDir: h.projectDir });
      expect(outcome.status).toBe("conflict");
      if (outcome.status !== "conflict") throw new Error("unreachable");
      // The mixed conflict reports BOTH files.
      const paths = outcome.files.map((f) => f.path).sort();
      expect(paths).toEqual(["chapter-01.md", "cover.png"]);

      // Resolve: keep MY version for both files.
      const resolved = await resolveConflicts({
        projectDir: h.projectDir,
        resolutions: [
          { path: "chapter-01.md", choice: "mine" },
          { path: "cover.png", choice: "mine" },
        ],
        localId: outcome.localId,
        remoteId: outcome.remoteId,
      });
      expect(resolved.status).toBe("synced");

      // CRITICAL: the binary file's bytes on disk are byte-identical to MY
      // chosen bytes — NOT UTF-8 corrupted by the text merge driver.
      const onDisk = new Uint8Array(
        await readFile(path.join(h.projectDir, "cover.png")),
      );
      expect(onDisk).toEqual(myPng);
      // And it has NO U+FFFD replacement bytes (the EF BF BD signature that a
      // UTF-8 round-trip of binary data would introduce).
      const raw = await readFile(path.join(h.projectDir, "cover.png"));
      expect(raw.includes(Buffer.from([0xef, 0xbf, 0xbd]))).toBe(false);
      // The text file kept my version too.
      expect(
        await readFile(path.join(h.projectDir, "chapter-01.md"), "utf8"),
      ).toBe("# One\n\nLocal rewrite.\n");
      expect(await isClean(h.projectDir)).toBe(true);
    } finally {
      await h.cleanup();
    }
  });

  test("keeping the ONLINE binary in a mixed conflict is also byte-identical", async () => {
    const myPng = new Uint8Array(PNG_BYTES);
    myPng[44] = 0x07;
    const { h, onlinePng } = await setupBinaryConflict(myPng);
    try {
      const outcome = await syncProject({ projectDir: h.projectDir });
      expect(outcome.status).toBe("conflict");
      if (outcome.status !== "conflict") throw new Error("unreachable");

      const resolved = await resolveConflicts({
        projectDir: h.projectDir,
        resolutions: [
          { path: "chapter-01.md", choice: "theirs" },
          { path: "cover.png", choice: "theirs" },
        ],
        localId: outcome.localId,
        remoteId: outcome.remoteId,
      });
      expect(resolved.status).toBe("synced");

      // The online binary bytes land byte-identical.
      const onDisk = new Uint8Array(
        await readFile(path.join(h.projectDir, "cover.png")),
      );
      expect(onDisk).toEqual(new Uint8Array(onlinePng));
      const raw = await readFile(path.join(h.projectDir, "cover.png"));
      expect(raw.includes(Buffer.from([0xef, 0xbf, 0xbd]))).toBe(false);
      expect(await isClean(h.projectDir)).toBe(true);
    } finally {
      await h.cleanup();
    }
  });
});

// ── BUG 5: resolveConflicts must reject unverified (nonexistent) OIDs ──────────

describe("resolveConflicts OID verification (BUG 5)", () => {
  test("a valid-hex but NONEXISTENT remoteId → friendly expired-choices error", async () => {
    const h = await setupClone();
    try {
      await serverCommit(h.serverDir, { "chapter-01.md": "# One\n\nOnline.\n" }, "online");
      await writeFile(path.join(h.projectDir, "chapter-01.md"), "# One\n\nLocal.\n");
      const conflict = await syncProject({ projectDir: h.projectDir });
      expect(conflict.status).toBe("conflict");
      if (conflict.status !== "conflict") throw new Error("unreachable");

      // A well-formed but bogus 40-hex id that is NOT a real commit object.
      const fakeRemoteId = "0123456789abcdef0123456789abcdef01234567";
      const outcome = await resolveConflicts({
        projectDir: h.projectDir,
        resolutions: [{ path: "chapter-01.md", choice: "mine" }],
        localId: conflict.localId,
        remoteId: fakeRemoteId,
      });
      // The SAME friendly message as the regex-fail path — never an unhandled
      // throw or a generic "error" with no guidance.
      expect(outcome.status).toBe("error");
      if (outcome.status !== "error") throw new Error("unreachable");
      expect(outcome.message).toBe(
        "Those combine choices have expired. Please run Sync again.",
      );
      // Work stays safe (clean tree).
      expect(await isClean(h.projectDir)).toBe(true);
    } finally {
      await h.cleanup();
    }
  });

  test("a valid-hex but NONEXISTENT localId → friendly expired-choices error", async () => {
    const h = await setupClone();
    try {
      await serverCommit(h.serverDir, { "chapter-01.md": "# One\n\nOnline.\n" }, "online");
      await writeFile(path.join(h.projectDir, "chapter-01.md"), "# One\n\nLocal.\n");
      const conflict = await syncProject({ projectDir: h.projectDir });
      expect(conflict.status).toBe("conflict");
      if (conflict.status !== "conflict") throw new Error("unreachable");

      const fakeLocalId = "fedcba9876543210fedcba9876543210fedcba98";
      const outcome = await resolveConflicts({
        projectDir: h.projectDir,
        resolutions: [{ path: "chapter-01.md", choice: "mine" }],
        localId: fakeLocalId,
        remoteId: conflict.remoteId,
      });
      expect(outcome.status).toBe("error");
      if (outcome.status !== "error") throw new Error("unreachable");
      expect(outcome.message).toBe(
        "Those combine choices have expired. Please run Sync again.",
      );
    } finally {
      await h.cleanup();
    }
  });
});

// ── BUG 6: configurable, bounded retry with backoff (no false race) ────────────

describe("syncProject retry budget (BUG 6)", () => {
  test("a remote that races TWICE then settles still syncs (attempts:3)", async () => {
    const h = await setupClone();
    try {
      await writeFile(
        path.join(h.projectDir, "chapter-01.md"),
        "# One\n\nLocal third draft.\n",
      );
      // The remote moves before the first TWO push advertisements, then is
      // quiescent — the 2-attempt loop would give up, but a 3-attempt budget
      // absorbs both races and the third push lands.
      const httpClient = racingHttpClient(async () => {
        await serverCommit(
          h.serverDir,
          { [`racer-${Date.now()}.md`]: "raced\n" },
          "racer",
        );
      }, 2);

      const outcome = await syncProject({
        projectDir: h.projectDir,
        httpClient,
        retry: { attempts: 3, backoffMs: 0 },
      });
      expect(outcome.status).toBe("synced");
      if (outcome.status !== "synced") throw new Error("unreachable");
      expect(outcome.mergedRemoteChanges).toBe(true);
      expect(await serverFile(h.serverDir, "chapter-01.md")).toBe(
        "# One\n\nLocal third draft.\n",
      );
      expect(await isClean(h.projectDir)).toBe(true);
    } finally {
      await h.cleanup();
    }
  });

  test("a remote that races EVERY attempt still ends with the friendly race message, work safe", async () => {
    const h = await setupClone();
    try {
      await writeFile(
        path.join(h.projectDir, "chapter-01.md"),
        "# One\n\nLocal third draft.\n",
      );
      let n = 0;
      // Race before EVERY push advertisement (more than the attempt budget).
      const httpClient = racingHttpClient(async () => {
        n++;
        await serverCommit(h.serverDir, { [`racer-${n}.md`]: `racer ${n}\n` }, `racer ${n}`);
      }, 10);

      const outcome = await syncProject({
        projectDir: h.projectDir,
        httpClient,
        retry: { attempts: 3, backoffMs: 0 },
      });
      expect(outcome.status).toBe("error");
      if (outcome.status !== "error") throw new Error("unreachable");
      expect(outcome.message).toContain("at the same moment");
      expect(outcome.snapshotId).toBeDefined();
      expect(await isClean(h.projectDir)).toBe(true);
      // The loop is BOUNDED: it tried exactly `attempts` times, no more.
      expect(n).toBe(3);
    } finally {
      await h.cleanup();
    }
  });

  test("a backoff delay is honored between attempts via the injectable sleep (bounded, never infinite)", async () => {
    const h = await setupClone();
    try {
      await writeFile(path.join(h.projectDir, "chapter-01.md"), "# One\n\nLocal.\n");
      let races = 0;
      const httpClient = racingHttpClient(async () => {
        races++;
        await serverCommit(h.serverDir, { [`r-${races}.md`]: `r${races}\n` }, `r${races}`);
      }, 10);

      // Deterministic backoff: record each sleep instead of waiting on a clock.
      const sleeps: number[] = [];
      const outcome = await syncProject({
        projectDir: h.projectDir,
        httpClient,
        retry: {
          attempts: 3,
          backoffMs: 25,
          sleep: async (ms) => {
            sleeps.push(ms);
          },
        },
      });
      expect(outcome.status).toBe("error");
      // 3 attempts → exactly 2 inter-attempt backoffs (none after the last).
      expect(sleeps).toEqual([25, 25]);
    } finally {
      await h.cleanup();
    }
  });
});
