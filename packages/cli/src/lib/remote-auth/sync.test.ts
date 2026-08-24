/**
 * Sync / convergence tests (#15 sync phase, ADR 0006 D5; converge ruling
 * 2026-08-14).
 *
 * These run against the REAL in-process smart-HTTP server (upload-pack AND
 * receive-pack — see test-support/git-http-server.ts), so the full wire
 * protocol is exercised: ref advertisement, packfile upload, report-status.
 * No transport mocks, no shims.
 *
 * Invariants asserted throughout:
 *  - The pre-sync snapshot ALWAYS exists before any merge/network step
 *    (author work can never be lost).
 *  - Sync ALWAYS converges: a both-edited passage keeps BOTH versions in the
 *    one file (standard git markers); a both-edited binary keeps both as two
 *    files (mine, plus theirs as a `.online` sibling); an edit always
 *    survives a deletion. Every version stays in history.
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import git from "isomorphic-git";
import httpNode from "isomorphic-git/http/node";

import { cloneRepository } from "./clone.ts";
import {
  isPushRejected,
  isUnrelatedHistories,
  syncProject,
  SYNC_SNAPSHOT_MESSAGE,
} from "./sync.ts";
import { mergeWithMarkers } from "./converge-merge.ts";
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
  const serverDir = await tempDir("gutterpress-sync-server-");
  await createFixtureRepo(serverDir);
  const server = await startGitServer(serverDir, opts);
  const parent = await tempDir("gutterpress-sync-client-");
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

  test("both edited the same passage → sync CONVERGES: both versions in the ONE file", async () => {
    const h = await setupClone();
    try {
      await serverCommit(
        h.serverDir,
        { "chapter-01.md": "# One\n\nOnline rewrite.\n" },
        "online edit",
      );
      await writeFile(
        path.join(h.projectDir, "chapter-01.md"),
        "# One\n\nLocal rewrite.\n",
      );

      const outcome = await syncProject({ projectDir: h.projectDir });
      // No conflict outcome exists: sync lands, both versions in the file.
      expect(outcome.status).toBe("synced");
      if (outcome.status !== "synced") throw new Error("unreachable");
      expect(outcome.mergedRemoteChanges).toBe(true);
      expect(outcome.combinedFiles).toEqual(["chapter-01.md"]);

      const content = await readFile(
        path.join(h.projectDir, "chapter-01.md"),
        "utf8",
      );
      expect(content).toContain("<<<<<<< your version");
      expect(content).toContain("Local rewrite.");
      expect(content).toContain("Online rewrite.");
      expect(content).toContain(">>>>>>> online version");
      // The server received the SAME combined content — one file, no copies.
      expect(await serverFile(h.serverDir, "chapter-01.md")).toBe(content);
      expect(await isClean(h.projectDir)).toBe(true);
      // The merge commit is honest: two parents (both histories intact).
      const head = await serverHead(h.serverDir);
      const { commit } = await git.readCommit({ fs, dir: h.projectDir, oid: head });
      expect(commit.parent).toHaveLength(2);
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
      expect(outcome.message).toContain("try Sync again in a moment");
      // The snapshot protected the work; nothing was lost or left dirty.
      expect(outcome.snapshotId).toBeDefined();
      expect(await isClean(h.projectDir)).toBe(true);
    } finally {
      await h.cleanup();
    }
  });
});

// ── The autosave-versus-sync race (0.10.0 data-loss report) ──────────────────
//
// Field report on 0.10.0: "this latest update erases my most recent edit and
// states 'RELOADED FROM DISC' every minute or so". A solo author, auto-sync on
// its 2-minute safety timer, and a repo full of "Snapshot before syncing"
// commits. The author is TYPING while sync runs, and the desktop editor's
// autosave fires 500 ms after the last keystroke — so an edit routinely lands
// on disk after the pre-sync snapshot committed the tree and before the merge
// ends in a checkout. Whatever the checkout writes over that edit is gone: it
// was never in a commit, so no "Previous versions" entry holds it.
//
// Every test below asserts the same rule from a different angle: an edit that
// reaches disk mid-sync must still be there afterwards, and must be reachable
// in history. Converging it into conflict markers is fine; vanishing is not.
describe("an edit that lands on disk mid-sync is never discarded", () => {
  /**
   * An httpClient that runs `duringFetch` at the upload-pack ref
   * advertisement — the moment the sync is out on the network, AFTER the
   * snapshot committed the tree and BEFORE the merge/checkout. That is the
   * window a real autosave lands in, and the whole round-trip is how long it
   * stays open.
   */
  function writeDuringFetch(duringFetch: () => Promise<void>): typeof httpNode {
    let fired = false;
    return {
      async request(config: Parameters<typeof httpNode.request>[0]) {
        if (config.url.includes("service=git-upload-pack") && !fired) {
          fired = true;
          await duringFetch();
        }
        return httpNode.request(config);
      },
    } as typeof httpNode;
  }

  /** True when any commit reachable from HEAD holds exactly `content` at `filepath`. */
  async function reachableInHistory(
    dir: string,
    filepath: string,
    content: string,
  ): Promise<boolean> {
    for (const c of await git.log({ fs, dir, depth: 50 })) {
      try {
        const { blob } = await git.readBlob({ fs, dir, oid: c.oid, filepath });
        if (Buffer.from(blob).toString("utf8") === content) return true;
      } catch {
        // not present in that commit
      }
    }
    return false;
  }

  const LATE_EDIT = "# One\n\nThe sentence the author typed while syncing.\n";

  test("the reported bug: a solo author's edit survives on disk AND in history", async () => {
    const h = await setupClone();
    try {
      const file = path.join(h.projectDir, "chapter-01.md");
      // The last autosave before the sync timer fired.
      await writeFile(file, "# One\n\nSaved before the sync started.\n");

      // Nobody else touched the online copy — the merge below is a pure
      // no-op, which is exactly the case the 0.10.0 regression made
      // destructive (pre-0.10.0 returned early and never checked out).
      const outcome = await syncProject({
        projectDir: h.projectDir,
        httpClient: writeDuringFetch(() => writeFile(file, LATE_EDIT)),
      });

      expect(await readFile(file, "utf8")).toBe(LATE_EDIT);
      expect(await reachableInHistory(h.projectDir, "chapter-01.md", LATE_EDIT)).toBe(true);
      expect(await isClean(h.projectDir)).toBe(true);
      // …and it reached the online copy, since the push follows the pull.
      expect(await serverFile(h.serverDir, "chapter-01.md")).toBe(LATE_EDIT);

      // Honest reporting: nothing came DOWN, so the author must not be told
      // their work was "combined with changes from the online copy" (and the
      // host must not be told to reload a preview that didn't change).
      expect(outcome.status).toBe("synced");
      if (outcome.status !== "synced") throw new Error("unreachable");
      expect(outcome.mergedRemoteChanges).toBe(false);
      expect(outcome.filesChanged).toBeUndefined();
    } finally {
      await h.cleanup();
    }
  });

  test("the post-fetch snapshot is the one reported, under its own message", async () => {
    const h = await setupClone();
    try {
      const file = path.join(h.projectDir, "chapter-01.md");
      await writeFile(file, "# One\n\nSaved before the sync started.\n");

      const outcome = await syncProject({
        projectDir: h.projectDir,
        httpClient: writeDuringFetch(() => writeFile(file, LATE_EDIT)),
      });

      expect(await readFile(file, "utf8")).toBe(LATE_EDIT);
      expect(await reachableInHistory(h.projectDir, "chapter-01.md", LATE_EDIT)).toBe(true);
      // The SECOND (post-fetch) snapshot is the one reported — it holds
      // strictly more of the author's work than the pre-fetch one.
      const snapshotId = "snapshotId" in outcome ? outcome.snapshotId : undefined;
      expect(snapshotId).toBeDefined();
      const snap = await git.readCommit({ fs, dir: h.projectDir, oid: snapshotId! });
      expect(snap.commit.message.trim()).toBe("Saved the edit you made while syncing");
      expect(outcome.status).toBe("synced");
    } finally {
      await h.cleanup();
    }
  });

  test("late edit vs an overlapping online edit: BOTH versions land, in markers", async () => {
    const h = await setupClone();
    try {
      const file = path.join(h.projectDir, "chapter-01.md");
      await serverCommit(
        h.serverDir,
        { "chapter-01.md": "# One\n\nOnline rewrite.\n" },
        "online edit",
      );

      const outcome = await syncProject({
        projectDir: h.projectDir,
        httpClient: writeDuringFetch(() => writeFile(file, LATE_EDIT)),
      });

      expect(outcome.status).toBe("synced");
      const content = await readFile(file, "utf8");
      // Converged, not chosen between — the documented policy.
      expect(content).toContain("The sentence the author typed while syncing.");
      expect(content).toContain("Online rewrite.");
      expect(content).toContain("<<<<<<< your version");
      expect(await isClean(h.projectDir)).toBe(true);
    } finally {
      await h.cleanup();
    }
  });

  test("a write between the merge and the checkout is refused, never overwritten", async () => {
    const h = await setupClone();
    try {
      const file = path.join(h.projectDir, "chapter-01.md");
      // Both sides edit the same file, so the merge genuinely has to write it
      // — the only shape in which the checkout can collide with a late write.
      await serverCommit(
        h.serverDir,
        { "chapter-01.md": "# One\n\nOnline rewrite.\n" },
        "online edit",
      );
      await writeFile(file, "# One\n\nLocal rewrite.\n");

      // The narrowest window there is: a write that lands after the merge
      // commit exists and before the working tree is synced to it. No network
      // hook reaches in there, so patch the merge call itself.
      const realMerge = git.merge;
      let merged = 0;
      (git as unknown as { merge: typeof git.merge }).merge = async (args) => {
        const result = await realMerge(args);
        merged++;
        await writeFile(file, LATE_EDIT);
        return result;
      };
      let outcome;
      try {
        outcome = await syncProject({ projectDir: h.projectDir });
      } finally {
        (git as unknown as { merge: typeof git.merge }).merge = realMerge;
      }
      expect(merged).toBeGreaterThan(0);

      // Refused, not forced: the author's newest bytes are untouched on disk.
      expect(await readFile(file, "utf8")).toBe(LATE_EDIT);
      expect(outcome.status).toBe("error");
      expect(outcome.message).toContain("Your work is saved on this computer");

      // The branch was rolled back off the merge it could not check out, so
      // HEAD, the index and the working tree still agree — no half-applied
      // merge for the next sync to trip over.
      const tip = await git.resolveRef({ fs, dir: h.projectDir, ref: "main" });
      const { commit } = await git.readCommit({ fs, dir: h.projectDir, oid: tip });
      expect(commit.parent).toHaveLength(1);

      // And the retry converges properly — the late edit is combined with the
      // online one instead of being dropped by either side.
      const retry = await syncProject({ projectDir: h.projectDir });
      expect(retry.status).toBe("synced");
      const content = await readFile(file, "utf8");
      expect(content).toContain("The sentence the author typed while syncing.");
      expect(content).toContain("Online rewrite.");
      expect(await isClean(h.projectDir)).toBe(true);
    } finally {
      await h.cleanup();
    }
  });
});

describe("test server receive-pack validation", () => {
  test("a stale oldOid is rejected as non-fast-forward and the ref does not move", async () => {
    const serverDir = await tempDir("gutterpress-sync-nff-server-");
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

describe("sync convergence policy", () => {
  test("delete-vs-edit: my edit survives an online deletion, on both sides", async () => {
    const h = await setupClone();
    try {
      // The online copy DELETED the file; the author edited it.
      await serverCommit(h.serverDir, { "chapter-01.md": null }, "online delete");
      const myText = "# One\n\nEdited after the online copy deleted it.\n";
      await writeFile(path.join(h.projectDir, "chapter-01.md"), myText);

      const outcome = await syncProject({ projectDir: h.projectDir });
      expect(outcome.status).toBe("synced");
      expect(
        await readFile(path.join(h.projectDir, "chapter-01.md"), "utf8"),
      ).toBe(myText);
      expect(await serverFile(h.serverDir, "chapter-01.md")).toBe(myText);
      expect(await isClean(h.projectDir)).toBe(true);
    } finally {
      await h.cleanup();
    }
  });

  test("delete-vs-edit: an online edit survives my deletion, on both sides", async () => {
    const h = await setupClone();
    try {
      const onlineText = "# One\n\nOnline edit to a file I deleted.\n";
      await serverCommit(h.serverDir, { "chapter-01.md": onlineText }, "online edit");
      await rm(path.join(h.projectDir, "chapter-01.md"));

      const outcome = await syncProject({ projectDir: h.projectDir });
      expect(outcome.status).toBe("synced");
      // The EDIT wins — a deletion is trivially re-doable, a lost edit is not.
      expect(
        await readFile(path.join(h.projectDir, "chapter-01.md"), "utf8"),
      ).toBe(onlineText);
      expect(await serverFile(h.serverDir, "chapter-01.md")).toBe(onlineText);
      expect(await isClean(h.projectDir)).toBe(true);
    } finally {
      await h.cleanup();
    }
  });

  test("both add the same NEW text file differently → both versions in the one file", async () => {
    const h = await setupClone();
    try {
      const onlineText = "# Nine\n\nAdded online.\n";
      await serverCommit(h.serverDir, { "chapter-09.md": onlineText }, "online add");
      const myText = "# Nine\n\nAdded on this computer.\n";
      await writeFile(path.join(h.projectDir, "chapter-09.md"), myText);

      const outcome = await syncProject({ projectDir: h.projectDir });
      expect(outcome.status).toBe("synced");
      if (outcome.status !== "synced") throw new Error("unreachable");
      // Same convergence as any both-edited text: markers, one file.
      expect(outcome.combinedFiles).toEqual(["chapter-09.md"]);
      const content = await readFile(
        path.join(h.projectDir, "chapter-09.md"),
        "utf8",
      );
      expect(content).toContain("Added on this computer.");
      expect(content).toContain("Added online.");
      expect(content).toContain("<<<<<<< your version");
      expect(await serverFile(h.serverDir, "chapter-09.md")).toBe(content);
      expect(await isClean(h.projectDir)).toBe(true);
    } finally {
      await h.cleanup();
    }
  });

  test("unrelated histories (wrong online address) → plain error, NOTHING spliced or committed", async () => {
    const h = await setupClone();
    try {
      // Point origin at a completely unrelated repository.
      // A truly UNRELATED repository: its own root commit, no shared history
      // (createFixtureRepo is deterministic — two fixture repos share oids —
      // so this one is built from scratch).
      const otherDir = await tempDir("gutterpress-unrelated-");
      await git.init({ fs, dir: otherDir, defaultBranch: "main" });
      await writeFile(path.join(otherDir, "other-book.md"), "# A different book\n");
      await git.add({ fs, dir: otherDir, filepath: "other-book.md" });
      await git.commit({
        fs,
        dir: otherDir,
        message: "different project",
        author: { name: "Other", email: "other@test.local", timestamp: 1700000000, timezoneOffset: 0 },
      });
      const otherServer = await startGitServer(otherDir);
      try {
        await git.setConfig({
          fs,
          dir: h.projectDir,
          path: "remote.origin.url",
          value: otherServer.url,
        });
        const before = await git.resolveRef({ fs, dir: h.projectDir, ref: "HEAD" });

        const outcome = await syncProject({ projectDir: h.projectDir });
        expect(outcome.status).toBe("error");
        if (outcome.status !== "error") throw new Error("unreachable");
        expect(outcome.message).toContain("different project");
        // NOTHING was merged or committed — the local history is untouched.
        expect(await git.resolveRef({ fs, dir: h.projectDir, ref: "HEAD" })).toBe(before);
      } finally {
        await otherServer.close();
        await rm(otherDir, { recursive: true, force: true });
      }
    } finally {
      await h.cleanup();
    }
  });
});

describe("mergeWithMarkers", () => {
  test("clean hunks merge; clashing hunks keep BOTH versions inside git markers", () => {
    const base = "intro\nmiddle\nend\n";
    const ours = "intro\nMY middle\nend\n";
    const theirs = "intro\nTHEIR middle\nend\n";
    const merged = mergeWithMarkers(base, ours, theirs);
    expect(merged).toBe(
      "intro\n" +
        "<<<<<<< your version\n" +
        "MY middle\n" +
        "=======\n" +
        "THEIR middle\n" +
        ">>>>>>> online version\n" +
        "end\n",
    );
  });

  test("non-overlapping edits merge with NO markers", () => {
    const base = "one\ntwo\nthree\n";
    const merged = mergeWithMarkers(base, "ONE\ntwo\nthree\n", "one\ntwo\nTHREE\n");
    expect(merged).toBe("ONE\ntwo\nTHREE\n");
    expect(merged).not.toContain("<<<<<<<");
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

// ── BUG 2: isPushRejected must only treat a genuine non-fast-forward as a ─────
//          race to retry; permission/hook rejections surface to the auth
//          classifier instead.

describe("push rejection precision (BUG 2)", () => {
  /** Local work to push, so the sync always reaches the push step. */
  async function withLocalWork(h: Harness): Promise<void> {
    await writeFile(path.join(h.projectDir, "chapter-01.md"), "local\n");
  }

  test("a genuine non-fast-forward is RETRIED as a race, never reported as auth", async () => {
    const h = await setupClone();
    try {
      await withLocalWork(h);
      // The server answers with a non-fast-forward report-status. That is a
      // RACE: the loop retries it, so a one-attempt budget exhausts into the
      // race message — never "reconnect", which would send the writer off to
      // fix a credential that is working fine.
      const outcome = await syncProject({
        projectDir: h.projectDir,
        httpClient: pushRejectingHttpClient("non-fast-forward"),
        retry: { attempts: 1 },
      });
      expect(outcome.status).toBe("error");
      expect(outcome.message).toContain("changing very quickly");
    } finally {
      await h.cleanup();
    }
  });

  test("a PERMISSION-style push rejection surfaces as auth, not as a race", async () => {
    const h = await setupClone();
    try {
      await withLocalWork(h);
      // The server declines for permission/policy reasons — retrying can't
      // fix this, so it must surface as auth (NOT a race message).
      const outcome = await syncProject({
        projectDir: h.projectDir,
        httpClient: pushRejectingHttpClient("permission denied"),
      });
      expect(outcome.status).toBe("auth");
    } finally {
      await h.cleanup();
    }
  });

  test("a pre-receive hook decline surfaces as auth, not as a race", async () => {
    const h = await setupClone();
    try {
      await withLocalWork(h);
      const outcome = await syncProject({
        projectDir: h.projectDir,
        httpClient: pushRejectingHttpClient("pre-receive hook declined"),
      });
      // A hook decline is an auth/permission-class problem, not a race.
      expect(outcome.status).toBe("auth");
    } finally {
      await h.cleanup();
    }
  });
});

// ── BUG 3: a MIXED text+binary conflict must keep binary bytes byte-identical ──

describe("binary convergence (keep BOTH, byte-exact)", () => {
  /**
   * Build a TRUE mixed clash: a base commit (text + binary) is the common
   * ancestor of BOTH sides, then the server and the local clone each diverge
   * by editing BOTH files differently.
   *
   * `localTimestamp` (epoch seconds) controls the LOCAL commit's clock — the
   * keep-both policy must ignore it in BOTH directions.
   */
  async function setupBinaryClash(
    myPng: Uint8Array,
    localTimestamp?: number,
  ): Promise<{ h: Harness; onlinePng: Uint8Array }> {
    const serverDir = await tempDir("gutterpress-bin-server-");
    await createFixtureRepo(serverDir);
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
    const parent = await tempDir("gutterpress-bin-client-");
    const projectDir = path.join(parent, "project");
    await cloneRepository({ url: server.url, dir: projectDir });

    // The ONLINE copy diverges: a distinct binary variant + a text edit.
    const onlinePng = PNG_BYTES_VARIANT;
    await commitBinary(serverDir, "cover.png", onlinePng);
    await serverCommit(
      serverDir,
      { "chapter-01.md": "# One\n\nOnline rewrite.\n" },
      "online edits both",
    );

    // The LOCAL copy diverges differently on BOTH files.
    await writeFile(path.join(projectDir, "cover.png"), myPng);
    await writeFile(path.join(projectDir, "chapter-01.md"), "# One\n\nLocal rewrite.\n");
    await git.add({ fs, dir: projectDir, filepath: "cover.png" });
    await git.add({ fs, dir: projectDir, filepath: "chapter-01.md" });
    await git.commit({
      fs,
      dir: projectDir,
      message: "local edits both",
      author: {
        name: "Local",
        email: "local@test.local",
        ...(localTimestamp !== undefined
          ? { timestamp: localTimestamp, timezoneOffset: 0 }
          : {}),
      },
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

  test("both versions survive: mine at the path, theirs as the .online sibling", async () => {
    const myPng = new Uint8Array(PNG_BYTES);
    myPng[44] = 0x03; // a THIRD distinct variant — the author's bytes
    const { h, onlinePng } = await setupBinaryClash(myPng);
    try {
      const outcome = await syncProject({ projectDir: h.projectDir });
      expect(outcome.status).toBe("synced");
      if (outcome.status !== "synced") throw new Error("unreachable");

      // The text file converged with markers…
      expect(outcome.combinedFiles).toEqual(["chapter-01.md"]);
      const text = await readFile(path.join(h.projectDir, "chapter-01.md"), "utf8");
      expect(text).toContain("<<<<<<< your version");

      // …and the binary kept MY bytes where they were, byte-identical — never
      // routed through the string merge driver.
      const mine = new Uint8Array(await readFile(path.join(h.projectDir, "cover.png")));
      expect(mine).toEqual(myPng);
      const raw = await readFile(path.join(h.projectDir, "cover.png"));
      expect(raw.includes(Buffer.from([0xef, 0xbf, 0xbd]))).toBe(false);

      // …with THEIR bytes alongside it, also byte-identical.
      const theirs = new Uint8Array(
        await readFile(path.join(h.projectDir, "cover.online.png")),
      );
      expect(theirs).toEqual(new Uint8Array(onlinePng));

      // The pair is reported so the host can name it.
      expect(outcome.keptBothFiles).toEqual([
        { path: "cover.png", onlinePath: "cover.online.png" },
      ]);

      // Pushed: the server has BOTH files with the same bytes.
      expect(await isClean(h.projectDir)).toBe(true);
      const serverOid = await serverHead(h.serverDir);
      const readServer = async (filepath: string) =>
        new Uint8Array(
          (await git.readBlob({ fs, dir: h.serverDir, oid: serverOid, filepath })).blob,
        );
      expect(await readServer("cover.png")).toEqual(myPng);
      expect(await readServer("cover.online.png")).toEqual(new Uint8Array(onlinePng));
    } finally {
      await h.cleanup();
    }
  });

  test("an OLDER local commit still keeps my bytes at the path (no newer-wins)", async () => {
    const myPng = new Uint8Array(PNG_BYTES);
    myPng[44] = 0x07;
    // Local commit stamped 10 minutes in the past — under the old newer-wins
    // policy the online bytes would have replaced mine at cover.png.
    const past = Math.floor(Date.now() / 1000) - 600;
    const { h, onlinePng } = await setupBinaryClash(myPng, past);
    try {
      const outcome = await syncProject({ projectDir: h.projectDir });
      expect(outcome.status).toBe("synced");
      if (outcome.status !== "synced") throw new Error("unreachable");

      const mine = new Uint8Array(await readFile(path.join(h.projectDir, "cover.png")));
      expect(mine).toEqual(myPng);
      const theirs = new Uint8Array(
        await readFile(path.join(h.projectDir, "cover.online.png")),
      );
      expect(theirs).toEqual(new Uint8Array(onlinePng));
      expect(outcome.keptBothFiles).toEqual([
        { path: "cover.png", onlinePath: "cover.online.png" },
      ]);
      expect(await isClean(h.projectDir)).toBe(true);
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
      expect(outcome.message).toContain("try Sync again in a moment");
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

// ── Structural preflight — never touch the tree of a damaged repo ─────────────
//
// The C1 scenario from the 2026-07-02 recovery audit: an abandoned native-git
// merge leaves MERGE_HEAD plus literal conflict markers in tracked files.
// Before the preflight existed, syncProject's snapshot step would COMMIT those
// markers and push them to the shared remote. It must instead refuse to touch
// the tree and throw the typed error the hosts' recovery routing consumes.

describe("syncProject — structural preflight", () => {
  test("mid-merge repo (MERGE_HEAD): throws RepoNeedsRecovery, snapshots nothing, pushes nothing", async () => {
    const h = await setupClone();
    try {
      const localBefore = await git.resolveRef({ fs, dir: h.projectDir, ref: "HEAD" });
      const serverBefore = await serverHead(h.serverDir);

      // Fabricate the abandoned-native-merge state: MERGE_HEAD + conflict
      // markers in a tracked file.
      await writeFile(
        path.join(h.projectDir, ".git", "MERGE_HEAD"),
        `${localBefore}\n`,
      );
      await writeFile(
        path.join(h.projectDir, "chapter-01.md"),
        "# One\n\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> other\n",
      );

      let thrown: unknown;
      try {
        await syncProject({ projectDir: h.projectDir });
      } catch (e) {
        thrown = e;
      }
      expect((thrown as { code?: string })?.code).toBe("RepoNeedsRecovery");
      expect((thrown as { kind?: string })?.kind).toBe("needs_repair");

      // Nothing was committed locally (the conflict markers were NOT
      // snapshotted into history) and nothing reached the remote.
      expect(await git.resolveRef({ fs, dir: h.projectDir, ref: "HEAD" })).toBe(localBefore);
      expect(await serverHead(h.serverDir)).toBe(serverBefore);
    } finally {
      await h.cleanup();
    }
  });

  test("a stale lock (older than the threshold) blocks sync with the stale_lock kind", async () => {
    const h = await setupClone();
    try {
      const lockPath = path.join(h.projectDir, ".git", "index.lock");
      await writeFile(lockPath, "");
      // Age the lock past the 2-minute preflight threshold.
      const old = new Date(Date.now() - 10 * 60 * 1000);
      fs.utimesSync(lockPath, old, old);

      let thrown: unknown;
      try {
        await syncProject({ projectDir: h.projectDir });
      } catch (e) {
        thrown = e;
      }
      expect((thrown as { code?: string })?.code).toBe("RepoNeedsRecovery");
      expect((thrown as { kind?: string })?.kind).toBe("stale_lock");
    } finally {
      await h.cleanup();
    }
  });

  test("a FRESH lock does not block sync (a live process may hold it)", async () => {
    const h = await setupClone();
    try {
      // A just-created lock is below the preflight age gate; sync proceeds
      // normally (nothing to push → up-to-date).
      await writeFile(path.join(h.projectDir, ".git", "index.lock"), "");
      const outcome = await syncProject({ projectDir: h.projectDir });
      expect(outcome.status).toBe("up-to-date");
    } finally {
      await h.cleanup();
    }
  });

  test("staged-but-uncommitted snapshot marker is recovered and pushed by sync", async () => {
    const h = await setupClone();
    try {
      await writeFile(path.join(h.projectDir, "chapter-01.md"), "# One\n\nRecovered staged draft.\n");
      await git.add({ fs, dir: h.projectDir, filepath: "chapter-01.md" });
      fs.writeFileSync(path.join(h.projectDir, ".git", "gutterpress-snapshot-staging"), "");

      const outcome = await syncProject({ projectDir: h.projectDir });

      expect(outcome.status).toBe("synced");
      expect("snapshotId" in outcome ? outcome.snapshotId : undefined).toBeDefined();
      expect(fs.existsSync(path.join(h.projectDir, ".git", "gutterpress-snapshot-staging"))).toBe(false);
      expect(await serverHead(h.serverDir)).toBe(
        await git.resolveRef({ fs, dir: h.projectDir, ref: "HEAD" }),
      );
    } finally {
      await h.cleanup();
    }
  });
});

// ── Pull-merge-only passes (push: false) — the 15-minute push cadence ────────
//
// Owner decision 2026-08-23: the auto-sync tick keeps PULLING every ~2 minutes
// so a collaborator's work still arrives promptly, but pushing happens on a
// ~15-minute cadence (and on app exit). The lib half of that decision is ONE
// flag on the one operation: `push: false` runs the same locked pass minus the
// network push — and minus any snapshot no merge needs, so a quiet tick mints
// no commit while the author types (the F4 "commit wall").

/** An httpClient that counts receive-pack traffic (advert GET + POST) — the
 *  network footprint of the PUSH phase. upload-pack (the pull half) passes
 *  through uncounted. */
function receivePackCountingClient(counter: { receivePack: number }): typeof httpNode {
  return {
    async request(config: Parameters<typeof httpNode.request>[0]) {
      if (config.url.includes("git-receive-pack")) counter.receivePack++;
      return httpNode.request(config);
    },
  } as typeof httpNode;
}

describe("pull-merge-only pass (push: false)", () => {
  test("remote moved + local edit → the merge lands locally and NOTHING is pushed", async () => {
    const h = await setupClone();
    try {
      const remoteCommit = await serverCommit(
        h.serverDir,
        { "chapter-02.md": "# Two\n\nWritten online.\n" },
        "online: add chapter two",
      );
      await writeFile(
        path.join(h.projectDir, "chapter-01.md"),
        "# One\n\nLocal draft in progress.\n",
      );

      const counter = { receivePack: 0 };
      const outcome = await syncProject({
        projectDir: h.projectDir,
        push: false,
        httpClient: receivePackCountingClient(counter),
      });

      // The pass reports complete; the push is deferred, not failed.
      expect(outcome.status).toBe("up-to-date");
      expect(outcome.filesChanged).toBe(true);
      // The online file is on disk locally…
      expect(await readFile(path.join(h.projectDir, "chapter-02.md"), "utf8")).toBe(
        "# Two\n\nWritten online.\n",
      );
      // …the local edit survived (the merge-guard snapshot still fired)…
      expect(await readFile(path.join(h.projectDir, "chapter-01.md"), "utf8")).toBe(
        "# One\n\nLocal draft in progress.\n",
      );
      // …the local tip is a two-parent merge holding both sides…
      const tip = await git.resolveRef({ fs, dir: h.projectDir, ref: "HEAD" });
      const { commit } = await git.readCommit({ fs, dir: h.projectDir, oid: tip });
      expect(commit.parent).toHaveLength(2);
      expect(commit.parent).toContain(remoteCommit);
      // …and the SERVER never saw a push: zero receive-pack traffic, tip unmoved.
      expect(counter.receivePack).toBe(0);
      expect(await serverHead(h.serverDir)).toBe(remoteCommit);
    } finally {
      await h.cleanup();
    }
  });

  test("a dirty tree on a quiet pass stays UNCOMMITTED — no per-tick snapshot wall", async () => {
    const h = await setupClone();
    try {
      const tipBefore = await git.resolveRef({ fs, dir: h.projectDir, ref: "HEAD" });
      await writeFile(
        path.join(h.projectDir, "chapter-01.md"),
        "# One\n\nStill typing this sentence…\n",
      );

      const counter = { receivePack: 0 };
      const outcome = await syncProject({
        projectDir: h.projectDir,
        push: false,
        httpClient: receivePackCountingClient(counter),
      });

      expect(outcome.status).toBe("up-to-date");
      // No snapshot was minted: the remote did not move, so no merge could
      // touch the tree — the edit stays an ordinary unsaved change for the
      // auto-snapshot debounce (or the next push-enabled pass) to commit.
      expect("snapshotId" in outcome ? outcome.snapshotId : undefined).toBeUndefined();
      expect(await git.resolveRef({ fs, dir: h.projectDir, ref: "HEAD" })).toBe(tipBefore);
      expect(await isClean(h.projectDir)).toBe(false);
      // The edit itself is untouched on disk.
      expect(await readFile(path.join(h.projectDir, "chapter-01.md"), "utf8")).toBe(
        "# One\n\nStill typing this sentence…\n",
      );
      // And nothing was pushed.
      expect(counter.receivePack).toBe(0);
      expect(await serverHead(h.serverDir)).toBe(tipBefore);
    } finally {
      await h.cleanup();
    }
  });

  test("overlapping edits still converge on a pull-only pass, reported via combinedFiles", async () => {
    const h = await setupClone();
    try {
      const remoteCommit = await serverCommit(
        h.serverDir,
        { "chapter-01.md": "# One\n\nThe online rewrite.\n" },
        "online rewrite",
      );
      await writeFile(
        path.join(h.projectDir, "chapter-01.md"),
        "# One\n\nThe local rewrite.\n",
      );

      const outcome = await syncProject({ projectDir: h.projectDir, push: false });

      expect(outcome.status).toBe("up-to-date");
      if (outcome.status !== "up-to-date") throw new Error("unreachable");
      // The converge report rides on the pull-only outcome so the host can
      // still show the "both versions are in the file" surface.
      expect(outcome.combinedFiles).toEqual(["chapter-01.md"]);
      const merged = await readFile(path.join(h.projectDir, "chapter-01.md"), "utf8");
      expect(merged).toContain("<<<<<<<");
      expect(merged).toContain("The online rewrite.");
      expect(merged).toContain("The local rewrite.");
      // The combined result exists ONLY locally until a push-enabled pass.
      expect(await serverHead(h.serverDir)).toBe(remoteCommit);
    } finally {
      await h.cleanup();
    }
  });

  test("work held back by pull-only passes is pushed intact by the next push-enabled pass", async () => {
    const h = await setupClone();
    try {
      // A pull-only pass with the remote moved: merge lands locally only.
      const remoteCommit = await serverCommit(
        h.serverDir,
        { "chapter-02.md": "# Two\n\nWritten online.\n" },
        "online: add chapter two",
      );
      await writeFile(
        path.join(h.projectDir, "chapter-01.md"),
        "# One\n\nHeld-back local work.\n",
      );
      const pullOnly = await syncProject({ projectDir: h.projectDir, push: false });
      expect(pullOnly.status).toBe("up-to-date");
      expect(await serverHead(h.serverDir)).toBe(remoteCommit);

      // The next push-enabled pass sends the exact merge — nothing lost.
      const pushPass = await syncProject({ projectDir: h.projectDir });
      expect(pushPass.status).toBe("synced");
      const localTip = await git.resolveRef({ fs, dir: h.projectDir, ref: "HEAD" });
      expect(await serverHead(h.serverDir)).toBe(localTip);
      expect(await serverFile(h.serverDir, "chapter-01.md")).toBe(
        "# One\n\nHeld-back local work.\n",
      );
      expect(await serverFile(h.serverDir, "chapter-02.md")).toBe(
        "# Two\n\nWritten online.\n",
      );
    } finally {
      await h.cleanup();
    }
  });
});

// ── Owner cadence, end to end: two REAL clones against the smart-HTTP server ─
//
// The four decisions in one flow: (1) a pull-only tick with the remote moved
// merges locally and pushes nothing; (2) a push-due tick with local changes
// pulls FIRST and its push carries the merge — nothing lost on either side;
// (3) a push-due tick with nothing to push makes zero receive-pack traffic
// (the pre-existing `tip === remoteTip` short-circuit); the exit pass (4) is
// host policy, pinned in the desktop orchestrator tests.
describe("push-cadence e2e — two clones, pull-only ticks, push-due ticks", () => {
  test("pull-only merges arrive; push-due sends the merge; quiet push-due pushes nothing", async () => {
    const serverDir = await tempDir("gutterpress-cadence-server-");
    await createFixtureRepo(serverDir);
    const server = await startGitServer(serverDir);
    const parentA = await tempDir("gutterpress-cadence-a-");
    const parentB = await tempDir("gutterpress-cadence-b-");
    const dirA = path.join(parentA, "book");
    const dirB = path.join(parentB, "book");
    try {
      await cloneRepository({ url: server.url, dir: dirA });
      await cloneRepository({ url: server.url, dir: dirB });

      // ── B (the other computer) sends new work online ──
      await writeFile(path.join(dirB, "chapter-05.md"), "# Five\n\nFrom computer B.\n");
      const pushB = await syncProject({ projectDir: dirB });
      expect(pushB.status).toBe("synced");
      const serverTipAfterB = await serverHead(serverDir);

      // ── (1) A's 2-minute tick: pull-only — B's work arrives, no push ──
      const counterA1 = { receivePack: 0 };
      const pullTick = await syncProject({
        projectDir: dirA,
        push: false,
        httpClient: receivePackCountingClient(counterA1),
      });
      expect(pullTick.status).toBe("up-to-date");
      expect(pullTick.filesChanged).toBe(true);
      expect(await readFile(path.join(dirA, "chapter-05.md"), "utf8")).toBe(
        "# Five\n\nFrom computer B.\n",
      );
      expect(counterA1.receivePack).toBe(0);
      expect(await serverHead(serverDir)).toBe(serverTipAfterB);

      // ── A types; the in-between quiet ticks commit and push NOTHING ──
      await writeFile(path.join(dirA, "chapter-06.md"), "# Six\n\nFrom computer A.\n");
      const tipA = await git.resolveRef({ fs, dir: dirA, ref: "HEAD" });
      const counterA2 = { receivePack: 0 };
      const quietTick = await syncProject({
        projectDir: dirA,
        push: false,
        httpClient: receivePackCountingClient(counterA2),
      });
      expect(quietTick.status).toBe("up-to-date");
      expect(counterA2.receivePack).toBe(0);
      expect(await git.resolveRef({ fs, dir: dirA, ref: "HEAD" })).toBe(tipA);
      expect(await serverHead(serverDir)).toBe(serverTipAfterB);

      // ── (2) B moves the remote again; A's PUSH-DUE tick pulls first and
      //        its push carries the merge — nothing lost on either side ──
      await writeFile(path.join(dirB, "chapter-07.md"), "# Seven\n\nMore from B.\n");
      const pushB2 = await syncProject({ projectDir: dirB });
      expect(pushB2.status).toBe("synced");

      const pushDue = await syncProject({ projectDir: dirA });
      expect(pushDue.status).toBe("synced");
      if (pushDue.status !== "synced") throw new Error("unreachable");
      expect(pushDue.mergedRemoteChanges).toBe(true);
      const mergedTipA = await git.resolveRef({ fs, dir: dirA, ref: "HEAD" });
      expect(await serverHead(serverDir)).toBe(mergedTipA);
      expect(await serverFile(serverDir, "chapter-06.md")).toBe("# Six\n\nFrom computer A.\n");
      expect(await serverFile(serverDir, "chapter-07.md")).toBe("# Seven\n\nMore from B.\n");
      expect(await readFile(path.join(dirA, "chapter-07.md"), "utf8")).toBe(
        "# Seven\n\nMore from B.\n",
      );

      // ── (3) push-due with nothing to push: zero receive-pack traffic ──
      const counterA3 = { receivePack: 0 };
      const idle = await syncProject({
        projectDir: dirA,
        httpClient: receivePackCountingClient(counterA3),
      });
      expect(idle.status).toBe("up-to-date");
      expect(counterA3.receivePack).toBe(0);
      expect(await serverHead(serverDir)).toBe(mergedTipA);

      // ── B's next pull-only tick receives A's work: full circle ──
      const counterB = { receivePack: 0 };
      const pullB = await syncProject({
        projectDir: dirB,
        push: false,
        httpClient: receivePackCountingClient(counterB),
      });
      expect(pullB.status).toBe("up-to-date");
      expect(counterB.receivePack).toBe(0);
      expect(await readFile(path.join(dirB, "chapter-06.md"), "utf8")).toBe(
        "# Six\n\nFrom computer A.\n",
      );
      expect(await git.resolveRef({ fs, dir: dirB, ref: "HEAD" })).toBe(mergedTipA);
    } finally {
      await server.close().catch(() => {});
      await rm(serverDir, { recursive: true, force: true }).catch(() => {});
      await rm(parentA, { recursive: true, force: true }).catch(() => {});
      await rm(parentB, { recursive: true, force: true }).catch(() => {});
    }
  }, 60_000);
});

// ── Push/merge-history guards (moved here with the functions they pin) ──────

describe("isPushRejected", () => {
  test("PushRejectedError: non-fast-forward (or reason-less back-compat) only", () => {
    expect(isPushRejected({ code: "PushRejectedError" })).toBe(true);
    expect(
      isPushRejected({ code: "PushRejectedError", data: { reason: "not-fast-forward" } }),
    ).toBe(true);
    expect(isPushRejected({ code: "PushRejectedError", data: { reason: "tag-exists" } })).toBe(
      false,
    );
  });

  test("GitPushError: only report-status text that says non-fast-forward", () => {
    expect(
      isPushRejected({
        code: "GitPushError",
        data: { prettyDetails: "refs/heads/main non-fast-forward" },
      }),
    ).toBe(true);
    expect(
      isPushRejected({
        code: "GitPushError",
        data: { prettyDetails: "pre-receive hook declined" },
      }),
    ).toBe(false);
  });

  test("anything else is not a push rejection", () => {
    expect(isPushRejected(new Error("ECONNREFUSED"))).toBe(false);
  });
});

describe("isUnrelatedHistories", () => {
  test("MergeNotSupportedError code and message signatures", () => {
    expect(isUnrelatedHistories({ code: "MergeNotSupportedError" })).toBe(true);
    expect(isUnrelatedHistories(new Error("refusing to merge unrelated histories"))).toBe(true);
    expect(isUnrelatedHistories(new Error("no common commits"))).toBe(true);
    expect(isUnrelatedHistories(new Error("plain failure"))).toBe(false);
  });
});
