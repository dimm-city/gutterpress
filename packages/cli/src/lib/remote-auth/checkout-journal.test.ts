/**
 * Checkout-journal tests — the crash window between a pull's `git.merge`
 * (branch ref moves) and its forced `git.checkout` (folder materializes).
 *
 * The regression pinned here is the dc-op-manual `c84d16e` clobber
 * (2026-08-16): a pull died inside that window, the folder stayed on the
 * pre-merge tree while the ref sat at the merged tip, and the next sync's
 * snapshot-first committed the stale folder as author work — publishing a
 * 161-file wholesale revert of merged collaborator work as a clean
 * fast-forward. Local folder stale + remote advanced ⇒ sync must NOT push
 * deletions.
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import git from "isomorphic-git";

import {
  checkoutPendingMarkerPath,
  clearCheckoutPending,
  healPendingCheckout,
  writeCheckoutPending,
} from "./checkout-journal.ts";
import { cloneRepository } from "./clone.ts";
import { pullChanges, pushChanges, SYNC_SNAPSHOT_MESSAGE } from "./sync.ts";
import {
  createFixtureRepo,
  startGitServer,
  tempDir,
  type GitServer,
} from "./test-support/git-http-server.ts";

const AUTHOR = { name: "Author", email: "author@test.local" };
const SERVER_AUTHOR = { name: "Server", email: "server@test.local" };

async function commitAll(
  dir: string,
  files: Record<string, string | null>,
  message: string,
): Promise<string> {
  for (const [name, content] of Object.entries(files)) {
    if (content === null) {
      await rm(path.join(dir, name), { force: true });
      await git.remove({ fs, dir, filepath: name });
    } else {
      fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      await writeFile(path.join(dir, name), content);
      await git.add({ fs, dir, filepath: name });
    }
  }
  return git.commit({ fs, dir, message, author: AUTHOR });
}

async function fileOrNull(dir: string, name: string): Promise<string | null> {
  try {
    return await readFile(path.join(dir, name), "utf8");
  } catch {
    return null;
  }
}

describe("healPendingCheckout — precise reconciliation", () => {
  test("no marker → null, folder untouched", async () => {
    const dir = await tempDir("gutterpress-journal-");
    try {
      await git.init({ fs, dir, defaultBranch: "main" });
      await commitAll(dir, { "a.md": "one\n" }, "first");
      await writeFile(path.join(dir, "a.md"), "edited\n");
      expect(await healPendingCheckout({ dir })).toBeNull();
      expect(await fileOrNull(dir, "a.md")).toBe("edited\n");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("stale remnants materialize to HEAD; post-crash author edits are kept", async () => {
    const dir = await tempDir("gutterpress-journal-");
    try {
      await git.init({ fs, dir, defaultBranch: "main" });
      // pre-merge tip A: three files, one of which the merge will delete.
      const preTip = await commitAll(
        dir,
        {
          "chapter.md": "old chapter\n",
          "notes.md": "old notes\n",
          "obsolete.md": "goes away\n",
        },
        "pre-merge",
      );
      // merged tip B: modifies chapter, deletes obsolete, adds tools/gate.sh.
      await commitAll(
        dir,
        {
          "chapter.md": "MIGRATED chapter\n",
          "obsolete.md": null,
          "tools/gate.sh": "#!/bin/sh\necho gate\n",
        },
        "merged",
      );
      // Simulate the died checkout: ref is at B, folder back at A's state.
      await writeFile(path.join(dir, "chapter.md"), "old chapter\n");
      await writeFile(path.join(dir, "obsolete.md"), "goes away\n");
      await rm(path.join(dir, "tools"), { recursive: true, force: true });
      // ...except the author edited notes.md AFTER the crash.
      await writeFile(path.join(dir, "notes.md"), "my new thoughts\n");
      writeCheckoutPending(dir, { branch: "main", preMergeTip: preTip });

      const result = await healPendingCheckout({ dir });
      expect(result).not.toBeNull();
      expect(result!.forced).toBe(false);
      expect(result!.healed.sort()).toEqual(["chapter.md", "obsolete.md", "tools/gate.sh"]);
      expect(result!.kept).toEqual(["notes.md"]);

      // Stale remnants now match HEAD…
      expect(await fileOrNull(dir, "chapter.md")).toBe("MIGRATED chapter\n");
      expect(await fileOrNull(dir, "obsolete.md")).toBeNull();
      expect(await fileOrNull(dir, "tools/gate.sh")).toBe("#!/bin/sh\necho gate\n");
      // …the author's post-crash edit survives…
      expect(await fileOrNull(dir, "notes.md")).toBe("my new thoughts\n");
      // …and the journal is closed.
      expect(fs.existsSync(checkoutPendingMarkerPath(dir))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("marker present but the merge never landed (HEAD == preMergeTip) → keep everything", async () => {
    const dir = await tempDir("gutterpress-journal-");
    try {
      await git.init({ fs, dir, defaultBranch: "main" });
      const tip = await commitAll(dir, { "a.md": "one\n" }, "only");
      await writeFile(path.join(dir, "a.md"), "in-flight edit\n");
      writeCheckoutPending(dir, { branch: "main", preMergeTip: tip });

      const result = await healPendingCheckout({ dir });
      // Every diff from HEAD also differs from the (identical) pre-merge
      // tree, so nothing is materialized — it is all author work.
      expect(result!.healed).toEqual([]);
      expect(result!.kept).toEqual(["a.md"]);
      expect(await fileOrNull(dir, "a.md")).toBe("in-flight edit\n");
      expect(fs.existsSync(checkoutPendingMarkerPath(dir))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("corrupt marker → forced checkout of the branch tip, journal closed", async () => {
    const dir = await tempDir("gutterpress-journal-");
    try {
      await git.init({ fs, dir, defaultBranch: "main" });
      await commitAll(dir, { "a.md": "committed\n" }, "first");
      await writeFile(path.join(dir, "a.md"), "stale or edited — unknowable\n");
      fs.writeFileSync(checkoutPendingMarkerPath(dir), "not json{{{");

      const result = await healPendingCheckout({ dir });
      expect(result!.forced).toBe(true);
      // Publishing a wrong tree propagates to collaborators; the bounded
      // local edit loses this (doubly rare) tie — see the module doc.
      expect(await fileOrNull(dir, "a.md")).toBe("committed\n");
      expect(fs.existsSync(checkoutPendingMarkerPath(dir))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("regression: interrupted pull must not become a pushed revert (c84d16e)", () => {
  interface Harness {
    serverDir: string;
    server: GitServer;
    projectDir: string;
    cleanup(): Promise<void>;
  }

  async function setupClone(): Promise<Harness> {
    const serverDir = await tempDir("gutterpress-journal-server-");
    await createFixtureRepo(serverDir);
    const server = await startGitServer(serverDir);
    const parent = await tempDir("gutterpress-journal-client-");
    const projectDir = path.join(parent, "project");
    await cloneRepository({ url: server.url, dir: projectDir });
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
        fs.mkdirSync(path.dirname(path.join(serverDir, name)), { recursive: true });
        await writeFile(path.join(serverDir, name), content);
        await git.add({ fs, dir: serverDir, filepath: name });
      }
    }
    return git.commit({ fs, dir: serverDir, message, author: SERVER_AUTHOR });
  }

  async function serverHeadFile(serverDir: string, filepath: string): Promise<string | null> {
    try {
      const oid = await git.resolveRef({ fs, dir: serverDir, ref: "refs/heads/main" });
      const { blob } = await git.readBlob({ fs, dir: serverDir, oid, filepath });
      return Buffer.from(blob).toString("utf8");
    } catch {
      return null;
    }
  }

  /**
   * Put the clone into the exact post-crash state: remote objects fetched,
   * branch ref moved to the remote tip, working folder still on the old
   * tree, checkout journal open. This is what an interrupted convergeMerge
   * leaves behind.
   */
  async function simulateDiedPull(projectDir: string, remoteUrl: string): Promise<{ preTip: string; remoteTip: string }> {
    const preTip = await git.resolveRef({ fs, dir: projectDir, ref: "refs/heads/main" });
    await git.fetch({
      fs,
      http: (await import("isomorphic-git/http/node")).default,
      dir: projectDir,
      url: remoteUrl,
      ref: "main",
      singleBranch: true,
    });
    const remoteTip = await git.resolveRef({ fs, dir: projectDir, ref: "refs/remotes/origin/main" });
    writeCheckoutPending(projectDir, { branch: "main", preMergeTip: preTip });
    await git.writeRef({
      fs,
      dir: projectDir,
      ref: "refs/heads/main",
      value: remoteTip,
      force: true,
    });
    return { preTip, remoteTip };
  }

  test("no local edits: push heals the folder and publishes NOTHING", async () => {
    const h = await setupClone();
    try {
      // The "migration" lands remotely: new tooling + a reworked chapter.
      await serverCommit(
        h.serverDir,
        {
          "tools/gate.sh": "#!/bin/sh\necho baseline gate\n",
          "chapter-01.md": "# One\n\nMigrated draft.\n",
        },
        "squash merge migration",
      );
      const { remoteTip } = await simulateDiedPull(h.projectDir, h.server.url);

      const outcome = await pushChanges({ projectDir: h.projectDir });

      // The stale folder was reconciled, so there was nothing to snapshot
      // and nothing to push — NOT a fast-forwarded wholesale revert.
      expect(outcome.status).toBe("up-to-date");
      expect(await git.resolveRef({ fs, dir: h.serverDir, ref: "refs/heads/main" })).toBe(remoteTip);
      expect(await serverHeadFile(h.serverDir, "tools/gate.sh")).toBe("#!/bin/sh\necho baseline gate\n");
      // The local folder now holds the migration it was silently reverting.
      expect(await fileOrNull(h.projectDir, "tools/gate.sh")).toBe("#!/bin/sh\necho baseline gate\n");
      expect(await fileOrNull(h.projectDir, "chapter-01.md")).toBe("# One\n\nMigrated draft.\n");
      expect(fs.existsSync(checkoutPendingMarkerPath(h.projectDir))).toBe(false);
    } finally {
      await h.cleanup();
    }
  });

  test("with a post-crash edit: the edit is pushed, the migration survives", async () => {
    const h = await setupClone();
    try {
      await serverCommit(
        h.serverDir,
        {
          "tools/gate.sh": "#!/bin/sh\necho baseline gate\n",
          "chapter-01.md": "# One\n\nMigrated draft.\n",
        },
        "squash merge migration",
      );
      await simulateDiedPull(h.projectDir, h.server.url);
      // The author keeps writing after the crash, unaware of any of this.
      await writeFile(path.join(h.projectDir, "notes.md"), "post-crash idea\n");

      const outcome = await pushChanges({ projectDir: h.projectDir });

      expect(outcome.status).toBe("pushed");
      // The pushed snapshot carries the author's edit…
      expect(await serverHeadFile(h.serverDir, "notes.md")).toBe("post-crash idea\n");
      // …and NOT a revert of anything the author never touched.
      expect(await serverHeadFile(h.serverDir, "tools/gate.sh")).toBe("#!/bin/sh\necho baseline gate\n");
      expect(await serverHeadFile(h.serverDir, "chapter-01.md")).toBe("# One\n\nMigrated draft.\n");
      const [head] = await git.log({ fs, dir: h.serverDir, depth: 1 });
      expect(head!.commit.message.trim()).toBe(SYNC_SNAPSHOT_MESSAGE);
    } finally {
      await h.cleanup();
    }
  });

  test("a completed pull leaves no journal behind", async () => {
    const h = await setupClone();
    try {
      await serverCommit(h.serverDir, { "chapter-01.md": "# One\n\nThird draft.\n" }, "server edit");
      const outcome = await pullChanges({ projectDir: h.projectDir });
      expect(outcome.status).toBe("pulled");
      expect(fs.existsSync(checkoutPendingMarkerPath(h.projectDir))).toBe(false);
      expect(await fileOrNull(h.projectDir, "chapter-01.md")).toBe("# One\n\nThird draft.\n");
      // clearCheckoutPending is idempotent — belt for the buckle above.
      clearCheckoutPending(h.projectDir);
    } finally {
      await h.cleanup();
    }
  });
});
