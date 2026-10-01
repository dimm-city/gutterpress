/**
 * repair.ts — "Repair online backup": one fixed sequence that replaces a
 * broken `.git` with a fresh download of the online history, keeps every
 * file on this computer, restores files that exist only online, then saves a
 * version and backs up.
 *
 * The damage fixtures are the real ones from the field: an EMPTY loose object
 * that only this computer ever had (0.11.6 report — the self-heal in git-fs
 * cannot help when no pack holds a copy), a truncated index, and a history
 * that was started over ("no common history").
 *
 * TEST RUNNER: bun:test only.
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import git from "isomorphic-git";

import { cloneRepository } from "./clone.ts";
import { REPAIR_SNAPSHOT_MESSAGE, repairOnlineBackup } from "./repair.ts";
import { MSG_HISTORY_UNREADABLE } from "./sync-messages.ts";
import { syncProject } from "./sync.ts";
import { createFixtureRepo, startGitServer, tempDir, type GitServer } from "./test-support/git-http-server.ts";

const AUTHOR = { name: "A", email: "a@example.com" };

interface Harness {
  serverDir: string;
  server: GitServer;
  projectDir: string;
  backupDir: string;
  cleanup(): Promise<void>;
}

async function setup(): Promise<Harness> {
  const serverDir = await tempDir("gp-repair-server-");
  await createFixtureRepo(serverDir);
  const server = await startGitServer(serverDir);
  const parent = await tempDir("gp-repair-client-");
  const projectDir = path.join(parent, "book");
  await cloneRepository({ url: server.url, dir: projectDir });
  const backupDir = path.join(await tempDir("gp-repair-backups-"), "book", "2026-10-01T00-00-00Z");
  return {
    serverDir,
    server,
    projectDir,
    backupDir,
    cleanup: async () => {
      await server.close();
      await rm(serverDir, { recursive: true, force: true });
      await rm(parent, { recursive: true, force: true });
      await rm(path.dirname(path.dirname(backupDir)), { recursive: true, force: true });
    },
  };
}

/** A version saved on this computer only, with its tree object then emptied. */
async function localVersionWithEmptyTree(dir: string, file: string, text: string): Promise<void> {
  await writeFile(path.join(dir, file), text);
  await git.add({ fs, dir, filepath: file });
  const oid = await git.commit({ fs, dir, author: AUTHOR, message: "local only" });
  const { commit } = await git.readCommit({ fs, dir, oid });
  fs.writeFileSync(path.join(dir, ".git", "objects", commit.tree.slice(0, 2), commit.tree.slice(2)), "");
}

async function serverCommit(serverDir: string, file: string, text: string): Promise<void> {
  await writeFile(path.join(serverDir, file), text);
  await git.add({ fs, dir: serverDir, filepath: file });
  await git.commit({ fs, dir: serverDir, author: { name: "Server", email: "s@test.local" }, message: `server ${file}` });
}

describe("repairOnlineBackup", () => {
  test("REPRO: an empty local-only object leaves sync with no way back", async () => {
    const h = await setup();
    try {
      await localVersionWithEmptyTree(h.projectDir, "chapter-02.md", "# Two\n");
      await serverCommit(h.serverDir, "chapter-03.md", "# Three\n"); // forces a merge
      const outcome = await syncProject({ projectDir: h.projectDir });
      expect(outcome.status).toBe("error");
      expect(outcome.message).toBe(MSG_HISTORY_UNREADABLE);
    } finally {
      await h.cleanup();
    }
  });

  test("repairs that book: files here win, online-only files come back, history is backed up", async () => {
    const h = await setup();
    try {
      await localVersionWithEmptyTree(h.projectDir, "chapter-02.md", "# Two\n");
      await serverCommit(h.serverDir, "chapter-03.md", "# Three\n");
      // An edit made here after the damage, never in any version.
      await writeFile(path.join(h.projectDir, "chapter-01.md"), "# One\n\nMy latest draft.\n");
      // The same file also changed online: this computer's copy must win.
      await serverCommit(h.serverDir, "chapter-01.md", "# One\n\nOnline draft.\n");

      const result = await repairOnlineBackup({ projectDir: h.projectDir, backupDir: h.backupDir });

      expect(result.outcome.status).toBe("synced");
      expect(result.restoredFiles).toEqual(["chapter-03.md"]);
      // Every file on this computer is exactly as it was…
      expect(await readFile(path.join(h.projectDir, "chapter-01.md"), "utf8")).toBe("# One\n\nMy latest draft.\n");
      expect(await readFile(path.join(h.projectDir, "chapter-02.md"), "utf8")).toBe("# Two\n");
      // …the online-only file is back…
      expect(await readFile(path.join(h.projectDir, "chapter-03.md"), "utf8")).toBe("# Three\n");
      // …the old history is kept aside, and the fresh one holds the repair version.
      expect(fs.existsSync(path.join(result.movedGitTo, "HEAD"))).toBe(true);
      expect(fs.existsSync(path.join(h.backupDir, "fresh-clone"))).toBe(false);
      const [head] = await git.log({ fs, dir: h.projectDir, depth: 1 });
      expect(head?.commit.message.trim()).toBe(REPAIR_SNAPSHOT_MESSAGE);
      // The online copy received it: a second sync has nothing to do.
      const again = await syncProject({ projectDir: h.projectDir });
      expect(again.status).toBe("up-to-date");
      const serverTip = await git.resolveRef({ fs, dir: h.serverDir, ref: "main" });
      expect(serverTip).toBe(head!.oid);
    } finally {
      await h.cleanup();
    }
  });

  test("a truncated index and a lost HEAD are repaired the same way", async () => {
    const h = await setup();
    try {
      await writeFile(path.join(h.projectDir, "chapter-01.md"), "# One\n\nKept.\n");
      fs.writeFileSync(path.join(h.projectDir, ".git", "index"), "");
      fs.writeFileSync(path.join(h.projectDir, ".git", "HEAD"), "");
      const result = await repairOnlineBackup({ projectDir: h.projectDir, backupDir: h.backupDir });
      expect(result.outcome.status).toBe("synced");
      expect(await readFile(path.join(h.projectDir, "chapter-01.md"), "utf8")).toBe("# One\n\nKept.\n");
      expect((await syncProject({ projectDir: h.projectDir })).status).toBe("up-to-date");
    } finally {
      await h.cleanup();
    }
  });

  test("a history that was started over ('no common history') is repaired too", async () => {
    const h = await setup();
    try {
      await rm(path.join(h.projectDir, ".git"), { recursive: true, force: true });
      await git.init({ fs, dir: h.projectDir, defaultBranch: "main" });
      await git.addRemote({ fs, dir: h.projectDir, remote: "origin", url: h.server.url });
      await git.add({ fs, dir: h.projectDir, filepath: "chapter-01.md" });
      await git.commit({ fs, dir: h.projectDir, author: AUTHOR, message: "started over" });
      expect((await syncProject({ projectDir: h.projectDir })).status).toBe("error");

      const result = await repairOnlineBackup({ projectDir: h.projectDir, backupDir: h.backupDir });
      expect(result.outcome.status).not.toBe("error");
      expect((await syncProject({ projectDir: h.projectDir })).status).toBe("up-to-date");
    } finally {
      await h.cleanup();
    }
  });

  test("a sign-in that lived only inside the old online address still backs up after the repair", async () => {
    const serverDir = await tempDir("gp-repair-auth-server-");
    await createFixtureRepo(serverDir);
    const auth = { username: "writer", password: "secret" };
    const server = await startGitServer(serverDir, { requireAuth: auth });
    const parent = await tempDir("gp-repair-auth-client-");
    const projectDir = path.join(parent, "book");
    const backupDir = path.join(parent, "backups", "book", "t1");
    try {
      // Our own clone strips an embedded sign-in from the stored address, so
      // this is the hand-edited (or older-tool) config the field can present.
      const embedded = server.url.replace("://", `://${auth.username}:${auth.password}@`);
      await cloneRepository({ url: embedded, dir: projectDir });
      await git.setConfig({ fs, dir: projectDir, path: "remote.origin.url", value: embedded });
      await localVersionWithEmptyTree(projectDir, "chapter-02.md", "# Two\n");
      await serverCommit(serverDir, "chapter-03.md", "# Three\n");
      const result = await repairOnlineBackup({ projectDir, backupDir });
      expect(result.outcome.status).toBe("synced");
      // The repair's own backup reached the server (the desktop's token store
      // would also now hold the migrated sign-in for later syncs).
      const [head] = await git.log({ fs, dir: projectDir, depth: 1 });
      expect(await git.resolveRef({ fs, dir: serverDir, ref: "main" })).toBe(head!.oid);
    } finally {
      await server.close();
      await rm(serverDir, { recursive: true, force: true });
      await rm(parent, { recursive: true, force: true });
    }
  });

  test("a download that fails touches nothing in the book", async () => {
    const h = await setup();
    try {
      await writeFile(path.join(h.projectDir, "chapter-01.md"), "# One\n\nKept.\n");
      const before = fs.statSync(path.join(h.projectDir, ".git")).ino;
      await h.server.close();
      await expect(repairOnlineBackup({ projectDir: h.projectDir, backupDir: h.backupDir })).rejects.toThrow();
      expect(fs.statSync(path.join(h.projectDir, ".git")).ino).toBe(before);
      expect(fs.existsSync(path.join(h.backupDir, "git"))).toBe(false);
      expect(await readFile(path.join(h.projectDir, "chapter-01.md"), "utf8")).toBe("# One\n\nKept.\n");
    } finally {
      await rm(h.serverDir, { recursive: true, force: true }).catch(() => {});
      await rm(path.dirname(h.projectDir), { recursive: true, force: true }).catch(() => {});
    }
  });
});
