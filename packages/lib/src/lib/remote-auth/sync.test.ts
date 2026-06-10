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
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import git from "isomorphic-git";
import httpNode from "isomorphic-git/http/node";

import { cloneRepository } from "./clone.ts";
import {
  getSyncStatus,
  onlineCopyPath,
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

  test("push rejected on BOTH attempts → friendly race message, work stays safe", async () => {
    const h = await setupClone();
    try {
      await writeFile(
        path.join(h.projectDir, "chapter-01.md"),
        "# One\n\nLocal third draft.\n",
      );
      let n = 0;
      // The remote moves before EVERY push attempt — both attempts reject.
      const httpClient = racingHttpClient(async () => {
        n++;
        await serverCommit(h.serverDir, { [`racer-${n}.md`]: `racer ${n}\n` }, `racer ${n}`);
      }, 2);

      const outcome = await syncProject({ projectDir: h.projectDir, httpClient });
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

describe("getSyncStatus", () => {
  test("ahead counts local snapshots; behind counts online ones (live fetch)", async () => {
    const h = await setupClone();
    try {
      // Two local snapshots.
      await writeFile(path.join(h.projectDir, "chapter-01.md"), "# One\n\nv3\n");
      await git.add({ fs, dir: h.projectDir, filepath: "chapter-01.md" });
      await git.commit({
        fs,
        dir: h.projectDir,
        message: "local one",
        author: SERVER_AUTHOR,
      });
      await writeFile(path.join(h.projectDir, "chapter-01.md"), "# One\n\nv4\n");
      await git.add({ fs, dir: h.projectDir, filepath: "chapter-01.md" });
      await git.commit({
        fs,
        dir: h.projectDir,
        message: "local two",
        author: SERVER_AUTHOR,
      });

      // Local compare (no network): the clone recorded the remote tip.
      const local = await getSyncStatus({ projectDir: h.projectDir });
      expect(local.hasRemote).toBe(true);
      expect(local.ahead).toBe(2);
      expect(local.behind).toBe(0);
      expect(local.live).toBe(false);
      expect(local.hasUnsnapshottedChanges).toBe(false);

      // One online commit; a live check sees it.
      await serverCommit(
        h.serverDir,
        { "chapter-02.md": "# Two\n" },
        "online add",
      );
      const liveStatus = await getSyncStatus({
        projectDir: h.projectDir,
        fetch: true,
      });
      expect(liveStatus.ahead).toBe(2);
      expect(liveStatus.behind).toBe(1);
      expect(liveStatus.live).toBe(true);

      // Unsnapshotted working-tree edits are reported separately.
      await writeFile(path.join(h.projectDir, "notes.md"), "draft\n");
      const withEdits = await getSyncStatus({ projectDir: h.projectDir });
      expect(withEdits.hasUnsnapshottedChanges).toBe(true);
    } finally {
      await h.cleanup();
    }
  });

  test("live fetch failure degrades to the local compare (live: false)", async () => {
    const h = await setupClone();
    try {
      // One local snapshot, then the remote becomes unreachable.
      await writeFile(path.join(h.projectDir, "chapter-01.md"), "# One\n\nv3\n");
      await git.add({ fs, dir: h.projectDir, filepath: "chapter-01.md" });
      await git.commit({
        fs,
        dir: h.projectDir,
        message: "local one",
        author: SERVER_AUTHOR,
      });
      await git.deleteRemote({ fs, dir: h.projectDir, remote: "origin" });
      await git.addRemote({
        fs,
        dir: h.projectDir,
        remote: "origin",
        url: "http://127.0.0.1:1/unreachable.git",
      });

      const status = await getSyncStatus({ projectDir: h.projectDir, fetch: true });
      expect(status.hasRemote).toBe(true);
      expect(status.live).toBe(false);
      // The local compare still works off the recorded remote-tracking ref.
      expect(status.ahead).toBe(1);
      expect(status.behind).toBe(0);
      expect(status.approximate).toBe(false);
    } finally {
      await h.cleanup();
    }
  });

  test("no remote → hasRemote false, counts null", async () => {
    const dir = await tempDir("pmd-sync-noremote-");
    try {
      await git.init({ fs, dir, defaultBranch: "main" });
      await writeFile(path.join(dir, "a.md"), "hi\n");
      await git.add({ fs, dir, filepath: "a.md" });
      await git.commit({ fs, dir, message: "init", author: SERVER_AUTHOR });
      const status = await getSyncStatus({ projectDir: dir });
      expect(status.hasRemote).toBe(false);
      expect(status.ahead).toBeNull();
      expect(status.behind).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
