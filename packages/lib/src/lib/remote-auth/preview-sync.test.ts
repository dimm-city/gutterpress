/**
 * previewSync tests — the fetch-only "what would a Sync do?" check that
 * backs "Check for updates" and the Sync dialog.
 *
 * Runs against the REAL in-process smart-HTTP server (see
 * test-support/git-http-server.ts) — no transport mocks.
 *
 * Contract (the library-call rewrite): `git.fetch` (remote-tracking-ref
 * negotiation — the rc.10 fix) → `git.resolveRef` both tips → direction via
 * the library's depth-capped `git.isDescendent`. No counts, no commit lists,
 * no marker file. Tips equal → up to date; remote descends from local →
 * incoming only; local descends from remote → outgoing only; neither →
 * BOTH true (a false "changes" is a harmless no-op pull/push; a false
 * "nothing" hides the author's chapters — the rc.10 lesson).
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import git from "isomorphic-git";

import { detectProjectSource } from "../project-source.ts";
import { providerFor } from "../source-provider.ts";
import { cloneRepository } from "./clone.ts";
import { previewSync, pullChanges, pushChanges, syncProject } from "./sync.ts";
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

const NONE = { hasChanges: false, count: 0, commits: [], approximate: false };
const SOME = { hasChanges: true, count: null, commits: [], approximate: false };

describe("previewSync", () => {
  test("up to date: fresh clone reports no changes in either direction", async () => {
    const h = await setupClone();
    try {
      const preview = await previewSync({ projectDir: h.projectDir });
      expect(preview.hasRemote).toBe(true);
      expect(preview.branch).toBe("main");
      expect(preview.live).toBe(true);
      expect(preview.fetchNotice).toBeUndefined();
      expect(preview.incoming).toEqual(NONE);
      expect(preview.outgoing).toEqual(NONE);
      expect(preview.workingTree).toBe("skipped");
      expect(preview.changedFiles).toEqual({ count: 0, sample: [] });
    } finally {
      await h.cleanup();
    }
  });

  test("remote ahead → incoming only (no counts, no commit lists)", async () => {
    const h = await setupClone();
    try {
      await serverCommit(h.serverDir, { "chapter-02.md": "# Two\n" }, "online one");
      await serverCommit(h.serverDir, { "chapter-03.md": "# Three\n" }, "online two");
      const preview = await previewSync({ projectDir: h.projectDir });
      expect(preview.live).toBe(true);
      expect(preview.incoming).toEqual(SOME);
      expect(preview.outgoing).toEqual(NONE);
      // The check NEVER merges: the online files are not in the working tree.
      expect(fs.existsSync(path.join(h.projectDir, "chapter-02.md"))).toBe(false);
    } finally {
      await h.cleanup();
    }
  });

  test("local ahead → outgoing only", async () => {
    const h = await setupClone();
    try {
      await localCommit(h.projectDir, { "draft.md": "# Draft\n" }, "my draft");
      // Uncommitted edit: invisible to the preview by design (workingTree
      // "skipped") — pull/push still snapshot it at action time.
      await writeFile(path.join(h.projectDir, "chapter-02.md"), "# Two\n");
      const preview = await previewSync({ projectDir: h.projectDir });
      expect(preview.live).toBe(true);
      expect(preview.incoming).toEqual(NONE);
      expect(preview.outgoing).toEqual(SOME);
    } finally {
      await h.cleanup();
    }
  });

  test("diverged → changes in BOTH directions", async () => {
    const h = await setupClone();
    try {
      await serverCommit(h.serverDir, { "chapter-02.md": "# Two\n" }, "online");
      await localCommit(h.projectDir, { "draft.md": "# Draft\n" }, "mine");
      const preview = await previewSync({ projectDir: h.projectDir });
      expect(preview.live).toBe(true);
      expect(preview.incoming).toEqual(SOME);
      expect(preview.outgoing).toEqual(SOME);
    } finally {
      await h.cleanup();
    }
  });

  test("fetch failure (offline): friendly notice, tracking ref still answers", async () => {
    const h = await setupClone();
    try {
      await localCommit(h.projectDir, { "draft.md": "# Draft\n" }, "Offline edit");
      await h.server.close(); // the remote is now unreachable

      const preview = await previewSync({ projectDir: h.projectDir });
      expect(preview.live).toBe(false);
      expect(preview.fetchNotice).toContain("Couldn't reach the online repository");
      // No credentials/URLs leak into the notice.
      expect(preview.fetchNotice).not.toContain("127.0.0.1");
      // The pre-failure tracking ref still supports the comparison.
      expect(preview.outgoing).toEqual(SOME);
      expect(preview.incoming).toEqual(NONE);
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
      expect(preview.incoming).toEqual(NONE);
      expect(preview.outgoing).toEqual(NONE);
    } finally {
      await h.cleanup();
    }
  });

  test("fetch:false previews locally — no network, tracking-ref comparison, no notice", async () => {
    const h = await setupClone();
    try {
      // New online commit the local repo has NOT fetched yet — invisible to
      // a local preview (the tracking ref hasn't moved).
      await serverCommit(h.serverDir, { "chapter-03.md": "# Three\n" }, "Online three");
      await localCommit(h.projectDir, { "chapter-04.md": "# Four\n" }, "Local four");
      // Kill the server: a local preview must not care.
      await h.server.close();

      const preview = await previewSync({ projectDir: h.projectDir, fetch: false });
      expect(preview.live).toBe(false);
      // No fetch attempt → no failure notice (this is the instant first paint).
      expect(preview.fetchNotice).toBeUndefined();
      expect(preview.outgoing).toEqual(SOME);
      expect(preview.incoming).toEqual(NONE);
    } finally {
      await h.cleanup();
    }
  });

  test("no remote → hasRemote false, both directions empty", async () => {
    const dir = await tempDir("pmd-preview-noremote-");
    try {
      await createFixtureRepo(dir);
      const preview = await previewSync({ projectDir: dir });
      expect(preview.hasRemote).toBe(false);
      expect(preview.incoming).toEqual(NONE);
      expect(preview.outgoing).toEqual(NONE);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("after pulling the online changes, the preview returns to in-sync", async () => {
    const h = await setupClone();
    try {
      await serverCommit(h.serverDir, { "chapter-02.md": "# Two\n" }, "online");
      expect((await previewSync({ projectDir: h.projectDir })).incoming).toEqual(SOME);
      const pulled = await pullChanges({ projectDir: h.projectDir });
      expect(pulled.status).toBe("pulled");
      const preview = await previewSync({ projectDir: h.projectDir });
      expect(preview.incoming).toEqual(NONE);
      expect(preview.outgoing).toEqual(NONE);
    } finally {
      await h.cleanup();
    }
  });

  test("after pushing local changes, the preview returns to in-sync", async () => {
    const h = await setupClone();
    try {
      await localCommit(h.projectDir, { "draft.md": "# Draft\n" }, "mine");
      const pushed = await pushChanges({ projectDir: h.projectDir });
      expect(pushed.status).toBe("pushed");
      const preview = await previewSync({ projectDir: h.projectDir });
      expect(preview.incoming).toEqual(NONE);
      expect(preview.outgoing).toEqual(NONE);
    } finally {
      await h.cleanup();
    }
  });

  test("after syncing incoming changes, history lists them and the preview clears", async () => {
    const h = await setupClone();
    try {
      await serverCommit(h.serverDir, { "chapter-01.md": "# One\n\nER fix.\n" }, "ER Update");

      const before = await previewSync({ projectDir: h.projectDir });
      expect(before.incoming).toEqual(SOME);

      const outcome = await syncProject({ projectDir: h.projectDir });
      expect(outcome.status).toBe("up-to-date"); // fast-forwarded onto the online tip

      // Version History (listHistory reads the local log from HEAD) now shows
      // the merged online commit — the dialog refreshes after onSynced.
      const source = await detectProjectSource(h.projectDir);
      const history = await providerFor(source).listHistory(h.projectDir);
      expect(history.map((e) => e.message)).toContain("ER Update");

      const after = await previewSync({ projectDir: h.projectDir });
      expect(after.incoming).toEqual(NONE);
      expect(after.outgoing).toEqual(NONE);
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
      // Outgoing-ness is whole-repo (that is what a sync pushes/pulls).
      expect(preview.outgoing).toEqual(SOME);
      expect(preview.incoming).toEqual(NONE);
      expect(preview.workingTree).toBe("skipped");
      expect(preview.changedFiles).toEqual({ count: 0, sample: [] });
    } finally {
      await h.cleanup();
    }
  });
});
