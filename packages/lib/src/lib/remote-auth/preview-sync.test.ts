/**
 * previewSync tests — the fetch-only "what would a Sync do?" check that
 * backs "Check for updates" and the Sync dialog.
 *
 * Runs against the REAL in-process smart-HTTP server (see
 * test-support/git-http-server.ts) — no transport mocks.
 *
 * 0.5.0 check-path contract (the "Check for updates crashes on a 2 GB repo"
 * fix): the check NEVER walks local history. Incoming/outgoing are decided by
 * REF STRING EQUALITY (local tip · fetched online tip · pre-fetch
 * remote-tracking value · the last-synced marker in
 * `.git/print-md-remote.json`). Commit DETAILS are read exclusively from the
 * commits the fetch just downloaded, with a hard budget. Outgoing is never
 * counted; with no marker it is honestly `hasChanges: null`.
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import git from "isomorphic-git";

import { detectProjectSource } from "../project-source.ts";
import { providerFor } from "../source-provider.ts";
import { cloneRepository, provenancePath, readLastSyncedTip } from "./clone.ts";
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

describe("previewSync", () => {
  test("neither direction: fresh clone is fully in sync (clone wrote the marker)", async () => {
    const h = await setupClone();
    try {
      // The clone recorded its tip as the last-synced marker.
      expect(await readLastSyncedTip(h.projectDir, "main")).toBe(
        await git.resolveRef({ fs, dir: h.projectDir, ref: "main" }),
      );

      const preview = await previewSync({ projectDir: h.projectDir });
      expect(preview.hasRemote).toBe(true);
      expect(preview.branch).toBe("main");
      expect(preview.live).toBe(true);
      expect(preview.fetchNotice).toBeUndefined();
      expect(preview.incoming).toEqual(NONE);
      expect(preview.outgoing).toEqual(NONE);
      expect(preview.changedFiles).toEqual({ count: 0, sample: [] });
      expect(preview.workingTree).toBe("skipped");
    } finally {
      await h.cleanup();
    }
  });

  test("outgoing-only: marker equality flags changes to send — no count, no walk", async () => {
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
      expect(preview.incoming).toEqual(NONE);
      // Local tip differs from the marker → changes exist; the check path
      // never walks local history, so there is no count and no detail list.
      expect(preview.outgoing.hasChanges).toBe(true);
      expect(preview.outgoing.count).toBeNull();
      expect(preview.outgoing.commits).toEqual([]);
      expect(preview.workingTree).toBe("skipped");
      expect(preview.changedFiles).toEqual({ count: 0, sample: [] });
    } finally {
      await h.cleanup();
    }
  });

  test("no marker → outgoing is honestly unknown (never guessed)", async () => {
    const h = await setupClone();
    try {
      await localCommit(h.projectDir, { "chapter-03.md": "# Three\n" }, "Local three");
      await rm(provenancePath(h.projectDir), { force: true });

      const preview = await previewSync({ projectDir: h.projectDir });
      expect(preview.live).toBe(true);
      expect(preview.outgoing.hasChanges).toBeNull();
      expect(preview.outgoing.count).toBeNull();
    } finally {
      await h.cleanup();
    }
  });

  test("incoming-only: freshly fetched commits are listed newest-first with details", async () => {
    const h = await setupClone();
    try {
      await serverCommit(h.serverDir, { "chapter-01.md": "# One\n\nER fix.\n" }, "ER Update");
      await serverCommit(h.serverDir, { "manifest.yaml": "title: New Title\n" }, "Retitle");

      const preview = await previewSync({ projectDir: h.projectDir });
      expect(preview.live).toBe(true);
      expect(preview.outgoing).toEqual(NONE);
      expect(preview.incoming.hasChanges).toBe(true);
      expect(preview.incoming.count).toBe(2);
      expect(preview.incoming.approximate).toBe(false);
      expect(preview.incoming.commits.map((c) => c.message)).toEqual([
        "Retitle",
        "ER Update",
      ]);
      expect(preview.incoming.commits[0]!.author).toBe("Server");
      expect(preview.incoming.commits[0]!.timestamp).toBeGreaterThan(0);
      // The preview NEVER merges: the working tree still holds the old content.
      const local = fs.readFileSync(path.join(h.projectDir, "chapter-01.md"), "utf8");
      expect(local).toContain("Second draft");
    } finally {
      await h.cleanup();
    }
  });

  test("both directions diverged: fresh incoming details + uncounted outgoing", async () => {
    const h = await setupClone();
    try {
      await serverCommit(h.serverDir, { "chapter-03.md": "# Three\n" }, "Online chapter three");
      await localCommit(h.projectDir, { "chapter-04.md": "# Four\n" }, "Local chapter four");

      const preview = await previewSync({ projectDir: h.projectDir });
      expect(preview.live).toBe(true);
      expect(preview.incoming.hasChanges).toBe(true);
      expect(preview.incoming.count).toBe(1);
      expect(preview.incoming.commits[0]!.message).toBe("Online chapter three");
      expect(preview.outgoing.hasChanges).toBe(true);
      expect(preview.outgoing.count).toBeNull();
    } finally {
      await h.cleanup();
    }
  });

  test("walk budget: many incoming commits cap at the budget with approximate", async () => {
    const h = await setupClone();
    try {
      for (let i = 1; i <= 55; i++) {
        await serverCommit(h.serverDir, { "log.md": `entry ${i}\n` }, `Edit ${i}`);
      }
      const preview = await previewSync({ projectDir: h.projectDir });
      expect(preview.incoming.hasChanges).toBe(true);
      expect(preview.incoming.count).toBe(50); // INCOMING_WALK_BUDGET
      expect(preview.incoming.approximate).toBe(true); // "50+"
      expect(preview.incoming.commits).toHaveLength(20); // PREVIEW_COMMIT_LIMIT
      expect(preview.incoming.commits[0]!.message).toBe("Edit 55");
    } finally {
      await h.cleanup();
    }
  });

  test("stale incoming (fetched by an EARLIER check): flagged without details", async () => {
    const h = await setupClone();
    try {
      await serverCommit(h.serverDir, { "chapter-03.md": "# Three\n" }, "Online three");
      // First check fetches the commit (remote-tracking ref moves).
      const first = await previewSync({ projectDir: h.projectDir });
      expect(first.incoming.count).toBe(1);

      // Second check: the remote did NOT move since the last fetch, so there
      // are no freshly-downloaded objects to read — changes are still
      // honestly flagged, but uncounted (reading the older fetch's objects
      // could load old packfiles).
      const second = await previewSync({ projectDir: h.projectDir });
      expect(second.live).toBe(true);
      expect(second.incoming.hasChanges).toBe(true);
      expect(second.incoming.count).toBeNull();
      expect(second.incoming.commits).toEqual([]);
    } finally {
      await h.cleanup();
    }
  });

  test("partial walk: stopping at the pre-fetch tip marks the count approximate", async () => {
    const h = await setupClone();
    try {
      await serverCommit(h.serverDir, { "a.md": "a\n" }, "Older online edit");
      await previewSync({ projectDir: h.projectDir }); // remote-tracking → that tip
      await serverCommit(h.serverDir, { "b.md": "b\n" }, "Newer online edit");
      // No marker: the walk can only stop at the pre-fetch tip, which is a
      // "previously fetched" boundary, not a known-synced one → lower bound.
      await rm(provenancePath(h.projectDir), { force: true });

      const preview = await previewSync({ projectDir: h.projectDir });
      expect(preview.incoming.hasChanges).toBe(true);
      expect(preview.incoming.count).toBe(1);
      expect(preview.incoming.commits[0]!.message).toBe("Newer online edit");
      expect(preview.incoming.approximate).toBe(true);
    } finally {
      await h.cleanup();
    }
  });

  test("fetch failure (offline): friendly notice, marker still answers both directions", async () => {
    const h = await setupClone();
    try {
      await localCommit(h.projectDir, { "chapter-01.md": "# One\n\nOffline edit.\n" }, "Offline edit");
      await h.server.close(); // the remote is now unreachable

      const preview = await previewSync({ projectDir: h.projectDir });
      expect(preview.live).toBe(false);
      expect(preview.fetchNotice).toContain("Couldn't reach the online repository");
      // No credentials/URLs leak into the notice.
      expect(preview.fetchNotice).not.toContain("127.0.0.1");
      // Outgoing: local tip != marker → changes to send (uncounted).
      expect(preview.outgoing.hasChanges).toBe(true);
      expect(preview.outgoing.count).toBeNull();
      // Incoming: last-fetched record equals the marker → none known.
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

  test("after syncing incoming changes, history lists them and the marker advances", async () => {
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

      // The sync recorded the new common tip — the next check is pure
      // string equality.
      expect(await readLastSyncedTip(h.projectDir, "main")).toBe(
        await git.resolveRef({ fs, dir: h.projectDir, ref: "main" }),
      );
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
      expect(preview.outgoing.hasChanges).toBe(true);
      expect(preview.workingTree).toBe("skipped");
      expect(preview.changedFiles).toEqual({ count: 0, sample: [] });
    } finally {
      await h.cleanup();
    }
  });

  test("fetch:false previews locally — no network, marker equality, no notice", async () => {
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
      // Outgoing from the marker; the unfetched online commit is invisible
      // to a local preview (last-fetched record == marker → none known).
      expect(preview.outgoing.hasChanges).toBe(true);
      expect(preview.outgoing.count).toBeNull();
      expect(preview.incoming).toEqual(NONE);
    } finally {
      await h.cleanup();
    }
  });
});

describe("last-synced marker lifecycle", () => {
  test("pushChanges records the pushed tip → outgoing clears", async () => {
    const h = await setupClone();
    try {
      const myOid = await localCommit(h.projectDir, { "c.md": "c\n" }, "mine");
      expect((await previewSync({ projectDir: h.projectDir })).outgoing.hasChanges).toBe(true);

      const outcome = await pushChanges({ projectDir: h.projectDir });
      expect(outcome.status).toBe("pushed");
      expect(await readLastSyncedTip(h.projectDir, "main")).toBe(myOid);

      const after = await previewSync({ projectDir: h.projectDir });
      expect(after.outgoing).toEqual(NONE);
      expect(after.incoming).toEqual(NONE);
    } finally {
      await h.cleanup();
    }
  });

  test("pullChanges records the REMOTE tip — a local merge commit still counts as outgoing", async () => {
    const h = await setupClone();
    try {
      const remoteOid = await serverCommit(h.serverDir, { "c.md": "c\n" }, "online");
      await localCommit(h.projectDir, { "d.md": "d\n" }, "mine");

      const outcome = await pullChanges({ projectDir: h.projectDir });
      expect(outcome.status).toBe("pulled");
      // Marker is the online tip that was merged, NOT the new local merge
      // commit — the merge commit itself is still something to send.
      expect(await readLastSyncedTip(h.projectDir, "main")).toBe(remoteOid);

      const after = await previewSync({ projectDir: h.projectDir });
      expect(after.incoming).toEqual(NONE);
      expect(after.outgoing.hasChanges).toBe(true);
    } finally {
      await h.cleanup();
    }
  });

  test("syncProject records the pushed tip after a combine", async () => {
    const h = await setupClone();
    try {
      await serverCommit(h.serverDir, { "c.md": "c\n" }, "online");
      await localCommit(h.projectDir, { "d.md": "d\n" }, "mine");

      const outcome = await syncProject({ projectDir: h.projectDir });
      expect(outcome.status).toBe("synced");
      expect(await readLastSyncedTip(h.projectDir, "main")).toBe(
        await git.resolveRef({ fs, dir: h.projectDir, ref: "main" }),
      );

      const after = await previewSync({ projectDir: h.projectDir });
      expect(after.incoming).toEqual(NONE);
      expect(after.outgoing).toEqual(NONE);
    } finally {
      await h.cleanup();
    }
  });

  test("marker writes preserve the clone provenance fields in the sidecar", async () => {
    const h = await setupClone();
    try {
      // Simulate a provenance-bearing sidecar (GitHub-managed clone).
      const sidecar = provenancePath(h.projectDir);
      const existing = JSON.parse(await readFile(sidecar, "utf8"));
      await writeFile(
        sidecar,
        JSON.stringify({ provider: "github", owner: "o", repo: "r", ...existing }, null, 2),
      );

      const myOid = await localCommit(h.projectDir, { "c.md": "c\n" }, "mine");
      await pushChanges({ projectDir: h.projectDir });

      const raw = JSON.parse(await readFile(sidecar, "utf8"));
      expect(raw.provider).toBe("github");
      expect(raw.owner).toBe("o");
      expect(raw.lastSyncedTips.main).toBe(myOid);
    } finally {
      await h.cleanup();
    }
  });
});
