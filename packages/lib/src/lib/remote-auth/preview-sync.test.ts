/**
 * previewSync tests — the fetch-only "what would a Sync do?" preview that
 * backs the Sync dialog's incoming/outgoing view.
 *
 * Runs against the REAL in-process smart-HTTP server (see
 * test-support/git-http-server.ts) — no transport mocks. Covers:
 * incoming-only, outgoing-only, both, neither, fetch-failure (offline and
 * auth), and book-subfolder projects.
 *
 * 0.5.0 fetch-first rebuild: the preview NEVER scans the working tree
 * (`workingTree: "skipped"`, `changedFiles` always empty) — a status walk
 * loads entire packfiles and made the dialog unusable on large repos.
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import git from "isomorphic-git";

import { detectProjectSource } from "../project-source.ts";
import { providerFor } from "../source-provider.ts";
import { cloneRepository } from "./clone.ts";
import { previewSync, syncProject } from "./sync.ts";
import type { HostCredential } from "./token-store.ts";
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

async function setupClone(
  opts: { requireAuth?: { username: string; password: string } } = {},
): Promise<Harness> {
  const serverDir = await tempDir("pmd-preview-server-");
  await createFixtureRepo(serverDir);
  const server = await startGitServer(serverDir, opts);
  const parent = await tempDir("pmd-preview-client-");
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

describe("previewSync", () => {
  test("neither direction: fresh clone is fully in sync", async () => {
    const h = await setupClone();
    try {
      const preview = await previewSync({ projectDir: h.projectDir });
      expect(preview.hasRemote).toBe(true);
      expect(preview.branch).toBe("main");
      expect(preview.live).toBe(true);
      expect(preview.fetchNotice).toBeUndefined();
      expect(preview.incoming).toEqual({ count: 0, commits: [], approximate: false });
      expect(preview.outgoing).toEqual({ count: 0, commits: [], approximate: false });
      expect(preview.changedFiles).toEqual({ count: 0, sample: [] });
      expect(preview.workingTree).toBe("skipped");
    } finally {
      await h.cleanup();
    }
  });

  test("outgoing-only: local commit with details; working tree never scanned", async () => {
    const h = await setupClone();
    try {
      await localCommit(
        h.projectDir,
        { "chapter-01.md": "# One\n\nThird draft.\n" },
        "Local rewrite of chapter one",
      );
      // Uncommitted edit: invisible to the preview by design (workingTree
      // "skipped") — syncProject still snapshots it at action time.
      await writeFile(path.join(h.projectDir, "chapter-02.md"), "# Two\n");

      const preview = await previewSync({ projectDir: h.projectDir });
      expect(preview.live).toBe(true);
      expect(preview.incoming.count).toBe(0);
      expect(preview.outgoing.count).toBe(1);
      expect(preview.outgoing.commits).toHaveLength(1);
      expect(preview.outgoing.commits[0]!.message).toBe("Local rewrite of chapter one");
      expect(preview.outgoing.commits[0]!.author).toBe("Local");
      expect(preview.outgoing.commits[0]!.timestamp).toBeGreaterThan(0);
      expect(preview.workingTree).toBe("skipped");
      expect(preview.changedFiles).toEqual({ count: 0, sample: [] });
    } finally {
      await h.cleanup();
    }
  });

  test("incoming-only: online commits are listed newest-first with details", async () => {
    const h = await setupClone();
    try {
      await serverCommit(h.serverDir, { "chapter-01.md": "# One\n\nER fix.\n" }, "ER Update");
      await serverCommit(h.serverDir, { "manifest.yaml": "title: New Title\n" }, "Retitle");

      const preview = await previewSync({ projectDir: h.projectDir });
      expect(preview.live).toBe(true);
      expect(preview.outgoing.count).toBe(0);
      expect(preview.incoming.count).toBe(2);
      expect(preview.incoming.commits.map((c) => c.message)).toEqual([
        "Retitle",
        "ER Update",
      ]);
      expect(preview.incoming.commits[0]!.author).toBe("Server");
      expect(preview.changedFiles.count).toBe(0);
      // The preview NEVER merges: the working tree still holds the old content.
      const local = fs.readFileSync(path.join(h.projectDir, "chapter-01.md"), "utf8");
      expect(local).toContain("Second draft");
    } finally {
      await h.cleanup();
    }
  });

  test("both directions diverged: counts vs the merge base", async () => {
    const h = await setupClone();
    try {
      await serverCommit(h.serverDir, { "chapter-03.md": "# Three\n" }, "Online chapter three");
      await localCommit(h.projectDir, { "chapter-04.md": "# Four\n" }, "Local chapter four");

      const preview = await previewSync({ projectDir: h.projectDir });
      expect(preview.live).toBe(true);
      expect(preview.incoming.count).toBe(1);
      expect(preview.incoming.commits[0]!.message).toBe("Online chapter three");
      expect(preview.outgoing.count).toBe(1);
      expect(preview.outgoing.commits[0]!.message).toBe("Local chapter four");
    } finally {
      await h.cleanup();
    }
  });

  test("fetch failure (offline): friendly notice, outgoing still reported, never throws", async () => {
    const h = await setupClone();
    try {
      await localCommit(h.projectDir, { "chapter-01.md": "# One\n\nOffline edit.\n" }, "Offline edit");
      await h.server.close(); // the remote is now unreachable

      const preview = await previewSync({ projectDir: h.projectDir });
      expect(preview.live).toBe(false);
      expect(preview.fetchNotice).toContain("Couldn't reach the online repository");
      // No credentials/URLs leak into the notice.
      expect(preview.fetchNotice).not.toContain("127.0.0.1");
      // Outgoing degrades to the last-fetched record of the online tip.
      expect(preview.outgoing.count).toBe(1);
      expect(preview.outgoing.commits[0]!.message).toBe("Offline edit");
      expect(preview.incoming.count).toBe(0);
    } finally {
      await h.cleanup();
    }
  });

  test("fetch failure (rejected connection): auth-flavored notice", async () => {
    const h = await setupClone({ requireAuth: { username: "u", password: "right" } });
    try {
      const preview = await previewSync({
        projectDir: h.projectDir,
        credential: {
          host: "127.0.0.1",
          kind: "token",
          token: "wrong",
          username: "u",
          createdAt: Date.now(),
        },
      });
      expect(preview.live).toBe(false);
      expect(preview.fetchNotice).toContain("didn't accept the saved connection");
      expect(preview.fetchNotice).not.toContain("wrong");
      expect(preview.incoming.count).toBe(0);
      expect(preview.outgoing.count).toBe(0);
    } finally {
      await h.cleanup();
    }
  });

  test("after syncing incoming changes, version history lists the merged commits", async () => {
    const h = await setupClone();
    try {
      await serverCommit(h.serverDir, { "chapter-01.md": "# One\n\nER fix.\n" }, "ER Update");

      const before = await previewSync({ projectDir: h.projectDir });
      expect(before.incoming.count).toBe(1);

      const outcome = await syncProject({ projectDir: h.projectDir });
      expect(outcome.status).toBe("up-to-date"); // fast-forwarded onto the online tip

      // Version History (listHistory reads the local log from HEAD) now shows
      // the merged online commit — the dialog refreshes after onSynced.
      const source = await detectProjectSource(h.projectDir);
      const history = await providerFor(source).listHistory(h.projectDir);
      expect(history.map((e) => e.message)).toContain("ER Update");

      const after = await previewSync({ projectDir: h.projectDir });
      expect(after.incoming.count).toBe(0);
      expect(after.outgoing.count).toBe(0);
    } finally {
      await h.cleanup();
    }
  });

  test("book subfolder: previews against the enclosing repo, no tree scan", async () => {
    const h = await setupClone();
    try {
      // Make the clone a shared folder with a book subfolder.
      const bookDir = path.join(h.projectDir, "field-guide");
      await mkdir(bookDir, { recursive: true });
      await localCommit(
        h.projectDir,
        { "field-guide/manifest.yaml": "title: Field Guide\n" },
        "Add field guide book",
      );
      // Pending edits (inside and outside the book) are invisible to the
      // preview — the working tree is never scanned.
      await writeFile(path.join(bookDir, "chapter-01.md"), "# FG One\n");
      await writeFile(path.join(h.projectDir, "chapter-01.md"), "# One\n\nRoot edit.\n");

      const preview = await previewSync({ projectDir: bookDir });
      expect(preview.live).toBe(true);
      // Commit counts are whole-repo (that is what a sync pushes/pulls).
      expect(preview.outgoing.count).toBe(1);
      expect(preview.workingTree).toBe("skipped");
      expect(preview.changedFiles).toEqual({ count: 0, sample: [] });
    } finally {
      await h.cleanup();
    }
  });

  test("fetch:false previews locally — no network, last-fetched tip, no notice", async () => {
    const h = await setupClone();
    try {
      // New online commit the local repo has NOT fetched yet.
      await serverCommit(h.serverDir, { "chapter-03.md": "# Three\n" }, "Online three");
      await localCommit(h.projectDir, { "chapter-04.md": "# Four\n" }, "Local four");
      // Kill the server: a local preview must not care.
      await h.server.close();

      const preview = await previewSync({ projectDir: h.projectDir, fetch: false });
      expect(preview.live).toBe(false);
      // No fetch attempt → no failure notice (this is the instant first paint).
      expect(preview.fetchNotice).toBeUndefined();
      // Outgoing is computed against the last-fetched record of the online
      // tip; the unfetched online commit is invisible to a local preview.
      expect(preview.outgoing.count).toBe(1);
      expect(preview.outgoing.commits[0]!.message).toBe("Local four");
      expect(preview.incoming.count).toBe(0);
    } finally {
      await h.cleanup();
    }
  });
});
