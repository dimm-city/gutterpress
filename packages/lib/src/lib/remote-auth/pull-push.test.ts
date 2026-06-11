/**
 * pullChanges / pushChanges tests — the distinct Pull and Push operations
 * behind the viewer History tab (Fetch stays previewSync).
 *
 * Runs against the REAL in-process smart-HTTP server (see
 * test-support/git-http-server.ts) — no transport mocks. Covers:
 *
 *  - Pull applies remote commits WITHOUT pushing local ones.
 *  - Pull snapshots unsaved work first (D5), fast-forwards, reports
 *    incomingApplied / merged / filesChanged.
 *  - Pull conflict leaves the working tree untouched (no markers).
 *  - Push sends local commits only; never merges.
 *  - Push when the remote is ahead (or diverged) → typed "pull-first",
 *    remote untouched.
 *  - Friendly failure mapping (offline) with no credential leakage.
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import git from "isomorphic-git";

import { cloneRepository } from "./clone.ts";
import { pullChanges, pushChanges, SYNC_SNAPSHOT_MESSAGE } from "./sync.ts";
import {
  createFixtureRepo,
  startGitServer,
  tempDir,
  type GitServer,
} from "./test-support/git-http-server.ts";

const SERVER_AUTHOR = { name: "Server", email: "server@test.local" };
const LOCAL_AUTHOR = { name: "Local", email: "local@test.local" };

interface Harness {
  serverDir: string;
  server: GitServer;
  projectDir: string;
  cleanup(): Promise<void>;
}

async function setupClone(): Promise<Harness> {
  const serverDir = await tempDir("pmd-pullpush-server-");
  await createFixtureRepo(serverDir);
  const server = await startGitServer(serverDir);
  const parent = await tempDir("pmd-pullpush-client-");
  const projectDir = path.join(parent, "project");
  await cloneRepository({ url: server.url, dir: projectDir });
  return {
    serverDir,
    server,
    projectDir,
    cleanup: async () => {
      await server.close().catch(() => {});
      await rm(serverDir, { recursive: true, force: true });
      await rm(parent, { recursive: true, force: true });
    },
  };
}

async function serverCommit(
  serverDir: string,
  files: Record<string, string>,
  message: string,
): Promise<string> {
  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(serverDir, name), content);
    await git.add({ fs, dir: serverDir, filepath: name });
  }
  return git.commit({ fs, dir: serverDir, message, author: SERVER_AUTHOR });
}

async function localCommit(
  dir: string,
  files: Record<string, string>,
  message: string,
): Promise<string> {
  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(dir, name), content);
    await git.add({ fs, dir, filepath: name });
  }
  return git.commit({ fs, dir, message, author: LOCAL_AUTHOR });
}

const serverTip = (h: Harness) =>
  git.resolveRef({ fs, dir: h.serverDir, ref: "main" });
const localTip = (h: Harness) =>
  git.resolveRef({ fs, dir: h.projectDir, ref: "main" });

describe("pullChanges", () => {
  test("up-to-date when nothing is new online", async () => {
    const h = await setupClone();
    try {
      const outcome = await pullChanges({ projectDir: h.projectDir });
      expect(outcome.status).toBe("up-to-date");
    } finally {
      await h.cleanup();
    }
  });

  test("applies remote commits WITHOUT pushing local ones (fast-forward)", async () => {
    const h = await setupClone();
    try {
      const remoteOid = await serverCommit(
        h.serverDir,
        { "chapter-02.md": "# Two\n" },
        "online chapter",
      );
      const outcome = await pullChanges({ projectDir: h.projectDir });
      expect(outcome.status).toBe("pulled");
      if (outcome.status !== "pulled") throw new Error("unreachable");
      expect(outcome.merged).toBe(false); // plain fast-forward
      expect(outcome.incomingApplied).toBe(1);
      expect(outcome.filesChanged).toBe(true);
      // The online file landed in the working tree…
      expect(await readFile(path.join(h.projectDir, "chapter-02.md"), "utf8")).toBe(
        "# Two\n",
      );
      // …local landed exactly on the online tip, and the remote DID NOT move.
      expect(await localTip(h)).toBe(remoteOid);
      expect(await serverTip(h)).toBe(remoteOid);
    } finally {
      await h.cleanup();
    }
  });

  test("local commits stay LOCAL: pull merges but never pushes", async () => {
    const h = await setupClone();
    try {
      const remoteOid = await serverCommit(
        h.serverDir,
        { "chapter-02.md": "# Two\n" },
        "online chapter",
      );
      await localCommit(h.projectDir, { "chapter-03.md": "# Three\n" }, "my chapter");
      const outcome = await pullChanges({ projectDir: h.projectDir });
      expect(outcome.status).toBe("pulled");
      if (outcome.status !== "pulled") throw new Error("unreachable");
      expect(outcome.merged).toBe(true); // combine commit (both sides moved)
      expect(outcome.incomingApplied).toBe(1);
      expect(outcome.filesChanged).toBe(true);
      // Remote tip unchanged — our commit and the merge were NOT uploaded.
      expect(await serverTip(h)).toBe(remoteOid);
      // The merge commit carries both parents locally.
      const tip = await localTip(h);
      const { commit } = await git.readCommit({ fs, dir: h.projectDir, oid: tip });
      expect(commit.parent).toHaveLength(2);
    } finally {
      await h.cleanup();
    }
  });

  test("unsaved work is snapshotted FIRST (lazy action-time check)", async () => {
    const h = await setupClone();
    try {
      await serverCommit(h.serverDir, { "chapter-02.md": "# Two\n" }, "online chapter");
      await writeFile(path.join(h.projectDir, "draft.md"), "unsaved\n");
      const outcome = await pullChanges({ projectDir: h.projectDir });
      expect(outcome.status).toBe("pulled");
      if (outcome.status !== "pulled") throw new Error("unreachable");
      expect(outcome.snapshotId).toBeDefined();
      const { commit } = await git.readCommit({
        fs,
        dir: h.projectDir,
        oid: outcome.snapshotId!,
      });
      expect(commit.message.trim()).toBe(SYNC_SNAPSHOT_MESSAGE);
      // The unsaved file survived the forced post-merge checkout.
      expect(await readFile(path.join(h.projectDir, "draft.md"), "utf8")).toBe(
        "unsaved\n",
      );
    } finally {
      await h.cleanup();
    }
  });

  test("conflict → status conflict, working tree untouched, NO push", async () => {
    const h = await setupClone();
    try {
      const remoteOid = await serverCommit(
        h.serverDir,
        { "chapter-01.md": "# One\n\nOnline edit.\n" },
        "online edit",
      );
      const myOid = await localCommit(
        h.projectDir,
        { "chapter-01.md": "# One\n\nMy edit.\n" },
        "my edit",
      );
      const outcome = await pullChanges({ projectDir: h.projectDir });
      expect(outcome.status).toBe("conflict");
      if (outcome.status !== "conflict") throw new Error("unreachable");
      expect(outcome.files).toEqual([
        { path: "chapter-01.md", kind: "both-edited" },
      ]);
      expect(outcome.localId).toBe(myOid);
      expect(outcome.remoteId).toBe(remoteOid);
      // abortOnConflict: the file is EXACTLY the author's version, no markers.
      const content = await readFile(
        path.join(h.projectDir, "chapter-01.md"),
        "utf8",
      );
      expect(content).toBe("# One\n\nMy edit.\n");
      expect(content).not.toContain("<<<<<<<");
      // Local branch did not move; remote untouched.
      expect(await localTip(h)).toBe(myOid);
      expect(await serverTip(h)).toBe(remoteOid);
    } finally {
      await h.cleanup();
    }
  });

  test("offline → friendly outcome, no credential/URL leakage", async () => {
    const h = await setupClone();
    try {
      await h.server.close();
      const outcome = await pullChanges({ projectDir: h.projectDir });
      expect(outcome.status).toBe("offline");
      if (outcome.status !== "offline") throw new Error("unreachable");
      expect(outcome.message).not.toMatch(/127\.0\.0\.1|http|@/);
    } finally {
      await h.cleanup();
    }
  });
});

describe("pushChanges", () => {
  test("up-to-date when there is nothing to send", async () => {
    const h = await setupClone();
    try {
      const outcome = await pushChanges({ projectDir: h.projectDir });
      expect(outcome.status).toBe("up-to-date");
    } finally {
      await h.cleanup();
    }
  });

  test("sends local commits to the remote (verified on the server repo)", async () => {
    const h = await setupClone();
    try {
      const myOid = await localCommit(
        h.projectDir,
        { "chapter-03.md": "# Three\n" },
        "my chapter",
      );
      const outcome = await pushChanges({ projectDir: h.projectDir });
      expect(outcome.status).toBe("pushed");
      expect(await serverTip(h)).toBe(myOid);
    } finally {
      await h.cleanup();
    }
  });

  test("snapshots unsaved work first, then pushes the snapshot", async () => {
    const h = await setupClone();
    try {
      await writeFile(path.join(h.projectDir, "draft.md"), "unsaved\n");
      const outcome = await pushChanges({ projectDir: h.projectDir });
      expect(outcome.status).toBe("pushed");
      if (outcome.status !== "pushed") throw new Error("unreachable");
      expect(outcome.snapshotId).toBeDefined();
      expect(await serverTip(h)).toBe(outcome.snapshotId!);
    } finally {
      await h.cleanup();
    }
  });

  test("remote ahead → pull-first, NEVER auto-merges, remote untouched", async () => {
    const h = await setupClone();
    try {
      const remoteOid = await serverCommit(
        h.serverDir,
        { "chapter-02.md": "# Two\n" },
        "online chapter",
      );
      const myOid = await localCommit(
        h.projectDir,
        { "chapter-03.md": "# Three\n" },
        "my chapter",
      );
      const outcome = await pushChanges({ projectDir: h.projectDir });
      expect(outcome.status).toBe("pull-first");
      if (outcome.status !== "pull-first") throw new Error("unreachable");
      expect(outcome.message).toMatch(/online copy has changes/i);
      expect(outcome.message).not.toMatch(/127\.0\.0\.1|http|@/);
      // Nothing moved anywhere: no merge locally, no upload remotely.
      expect(await localTip(h)).toBe(myOid);
      expect(await serverTip(h)).toBe(remoteOid);
    } finally {
      await h.cleanup();
    }
  });

  test("remote ahead with NO local commits → pull-first (still never merges)", async () => {
    const h = await setupClone();
    try {
      await serverCommit(h.serverDir, { "chapter-02.md": "# Two\n" }, "online chapter");
      const before = await localTip(h);
      const outcome = await pushChanges({ projectDir: h.projectDir });
      expect(outcome.status).toBe("pull-first");
      expect(await localTip(h)).toBe(before);
    } finally {
      await h.cleanup();
    }
  });

  test("offline → friendly outcome (work stays saved locally)", async () => {
    const h = await setupClone();
    try {
      await localCommit(h.projectDir, { "chapter-03.md": "# Three\n" }, "my chapter");
      await h.server.close();
      const outcome = await pushChanges({ projectDir: h.projectDir });
      expect(outcome.status).toBe("offline");
    } finally {
      await h.cleanup();
    }
  });
});
