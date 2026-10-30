/**
 * Renaming and deleting revisions (#448), against the REAL in-process
 * smart-HTTP server (see test-support/git-http-server.ts): the online copy is
 * changed over the wire, and these tests read the server's refs to prove what
 * it holds after each call.
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import git from "isomorphic-git";
import httpNode from "isomorphic-git/http/node";

import { detectProjectSource } from "../project-source.ts";
import {
  createRevision,
  listRevisions,
  providerFor,
  switchBranch,
} from "../source-provider.ts";
import { deleteRevision, renameRevision } from "./revisions.ts";
import { refreshRemoteCopies, syncProject } from "./sync.ts";
import { FLUSH, pkt } from "./test-support/git-http-server.ts";
import { serverCommit, setupClone, type Harness } from "./test-support/sync-harness.ts";

const serverBranches = async (h: Harness) => (await git.listBranches({ fs, dir: h.serverDir })).sort();
const localBranches = async (h: Harness) => (await git.listBranches({ fs, dir: h.projectDir })).sort();
const listed = async (h: Harness) =>
  (await listRevisions(h.projectDir))!.revisions.map((r) => `${r.name}:${r.where}`);

/** A revision started here and sent online by a backup; the book is left open on `main`. */
async function backedUpRevision(h: Harness, name: string, credential = h.credential) {
  await createRevision({ projectDir: h.projectDir, name });
  expect((await syncProject({ projectDir: h.projectDir, credential })).status).toBe("synced");
  await switchBranch({ projectDir: h.projectDir, branch: "main" });
}

/** Save a version of `file` on the open revision. */
async function saveVersion(h: Harness, file: string, message: string) {
  await writeFile(path.join(h.projectDir, file), `${message}\n`);
  const source = await detectProjectSource(h.projectDir);
  await providerFor(source).snapshot({ projectDir: h.projectDir, message });
}

/** Commit on a branch of the server's own copy (it keeps `main` checked out). */
async function serverCommitOn(h: Harness, branch: string, message: string) {
  await git.checkout({ fs, dir: h.serverDir, ref: branch });
  await serverCommit(h.serverDir, { "elsewhere.md": `${message}\n` }, message);
  await git.checkout({ fs, dir: h.serverDir, ref: "main" });
}

/**
 * A revision that exists only in the online copy as far as this computer is
 * concerned: made there (with a version for each message), then heard about by a refresh.
 */
async function onlineOnlyRevision(h: Harness, name: string, versions: string[] = []) {
  const tip = await git.resolveRef({ fs, dir: h.serverDir, ref: "main" });
  await git.branch({ fs, dir: h.serverDir, ref: name, object: tip });
  for (const message of versions) await serverCommitOn(h, name, message);
  await refreshRemoteCopies({ projectDir: h.projectDir, credential: h.credential });
}

/**
 * An http client that lets everything through except deletes of the named
 * online revisions, which it declines in the server's report-status — as a host
 * does for the revision it opens by default.
 */
function declineDeletes(...names: string[]): typeof httpNode {
  return {
    async request(config: Parameters<typeof httpNode.request>[0]) {
      if (config.method !== "POST" || !config.url.endsWith("/git-receive-pack") || !config.body) {
        return httpNode.request(config);
      }
      const body = Buffer.concat((await Array.fromAsync(config.body)).map((chunk) => Buffer.from(chunk)));
      const refused = names.find((n) => body.toString("latin1").includes(`${"0".repeat(40)} refs/heads/${n}`));
      if (!refused) {
        return httpNode.request({
          ...config,
          body: (async function* () {
            yield new Uint8Array(body);
          })(),
        });
      }
      const report = Buffer.concat([
        pkt("unpack ok\n"),
        pkt(`ng refs/heads/${refused} refusing to delete the current branch\n`),
        FLUSH,
      ]);
      const sideBand = Buffer.concat([pkt(Buffer.concat([Buffer.from([0x01]), report])), FLUSH]);
      return {
        url: config.url,
        method: config.method,
        statusCode: 200,
        statusMessage: "OK",
        headers: { "content-type": "application/x-git-receive-pack-result" },
        body: (async function* () {
          yield new Uint8Array(sideBand);
        })(),
      };
    },
  } as typeof httpNode;
}

describe("listRevisions with an online copy", () => {
  test("says where each revision is and what is not backed up yet, without the network", async () => {
    const h = await setupClone();
    try {
      await backedUpRevision(h, "Second edition");
      await createRevision({ projectDir: h.projectDir, name: "Only here" });
      await switchBranch({ projectDir: h.projectDir, branch: "Second-edition" });
      await saveVersion(h, "chapter-03.md", "A version not backed up");
      const tip = await git.resolveRef({ fs, dir: h.serverDir, ref: "main" });
      await git.branch({ fs, dir: h.serverDir, ref: "Made-elsewhere", object: tip });
      await refreshRemoteCopies({ projectDir: h.projectDir });

      await h.server.close(); // from here on the online copy cannot be reached
      expect(await listRevisions(h.projectDir)).toEqual({
        current: "Second-edition",
        revisions: [
          { name: "Made-elsewhere", current: false, where: "online-only", notBackedUp: false },
          { name: "main", current: false, where: "online", notBackedUp: false },
          { name: "Only-here", current: false, where: "this-computer", notBackedUp: false },
          { name: "Second-edition", current: true, where: "online", notBackedUp: true },
        ],
      });
    } finally {
      await h.cleanup().catch(() => {});
    }
  });
});

describe("a new revision", () => {
  test("is created in the online copy by its first backup", async () => {
    const h = await setupClone();
    try {
      await createRevision({ projectDir: h.projectDir, name: "Second edition" });
      expect(await serverBranches(h)).toEqual(["main"]);

      expect((await syncProject({ projectDir: h.projectDir })).status).toBe("synced");

      expect(await serverBranches(h)).toEqual(["Second-edition", "main"]);
      expect(await git.resolveRef({ fs, dir: h.serverDir, ref: "Second-edition" })).toBe(
        await git.resolveRef({ fs, dir: h.projectDir, ref: "Second-edition" }),
      );
      expect(await listed(h)).toEqual(["main:online", "Second-edition:online"]);
    } finally {
      await h.cleanup();
    }
  });
});

describe("renameRevision", () => {
  test("a revision only on this computer is renamed here, with no network", async () => {
    const h = await setupClone();
    try {
      await createRevision({ projectDir: h.projectDir, name: "Second edition" });
      await h.server.close();

      const result = await renameRevision({
        projectDir: h.projectDir,
        from: "Second-edition",
        to: "Editor's pass",
      });

      expect(result).toEqual({ current: "Editor's-pass", name: "Editor's-pass" });
      expect(await git.currentBranch({ fs, dir: h.projectDir, fullname: false })).toBe("Editor's-pass");
      expect(await localBranches(h)).toEqual(["Editor's-pass", "main"]);
    } finally {
      await h.cleanup().catch(() => {});
    }
  });

  test("an online revision is renamed in the online copy too, right away", async () => {
    const h = await setupClone();
    try {
      await backedUpRevision(h, "Second edition");

      const result = await renameRevision({ projectDir: h.projectDir, from: "Second-edition", to: "Third edition" });

      expect(result).toEqual({ current: "main", name: "Third-edition" });
      expect(await serverBranches(h)).toEqual(["Third-edition", "main"]);
      expect(await localBranches(h)).toEqual(["Third-edition", "main"]);
      expect(await listed(h)).toEqual(["main:online", "Third-edition:online"]);
      // Same versions under the new name: nothing is waiting to be backed up.
      expect((await listRevisions(h.projectDir))!.revisions.every((r) => !r.notBackedUp)).toBe(true);
    } finally {
      await h.cleanup();
    }
  });

  test("the open revision can be renamed, and the book stays open on it", async () => {
    const h = await setupClone();
    try {
      await createRevision({ projectDir: h.projectDir, name: "Draft" });
      await syncProject({ projectDir: h.projectDir });

      const result = await renameRevision({ projectDir: h.projectDir, from: "Draft", to: "Final" });

      expect(result).toEqual({ current: "Final", name: "Final" });
      expect(await git.currentBranch({ fs, dir: h.projectDir, fullname: false })).toBe("Final");
      expect(await serverBranches(h)).toEqual(["Final", "main"]);
      // The next backup sends the open revision under its new name.
      await saveVersion(h, "chapter-04.md", "After the rename");
      expect((await syncProject({ projectDir: h.projectDir })).status).toBe("synced");
      expect(await git.resolveRef({ fs, dir: h.serverDir, ref: "Final" })).toBe(
        await git.resolveRef({ fs, dir: h.projectDir, ref: "Final" }),
      );
    } finally {
      await h.cleanup();
    }
  });

  test("is refused, changing nothing, when the online copy has versions this computer lacks", async () => {
    const h = await setupClone();
    try {
      await backedUpRevision(h, "Second edition");
      await serverCommitOn(h, "Second-edition", "Written online");

      await expect(
        renameRevision({ projectDir: h.projectDir, from: "Second-edition", to: "Third" }),
      ).rejects.toThrow(/doesn't have yet\. Switch to "Second-edition" and get the latest first/i);

      expect(await serverBranches(h)).toEqual(["Second-edition", "main"]);
      expect(await localBranches(h)).toEqual(["Second-edition", "main"]);

      // The open revision only needs the latest brought in…
      await switchBranch({ projectDir: h.projectDir, branch: "Second-edition" });
      await expect(
        renameRevision({ projectDir: h.projectDir, from: "Second-edition", to: "Third" }),
      ).rejects.toThrow(/doesn't have yet\. Get the latest first/i);
      // …after which the rename goes through.
      expect((await syncProject({ projectDir: h.projectDir, push: false })).status).toBe("up-to-date");
      await renameRevision({ projectDir: h.projectDir, from: "Second-edition", to: "Third" });
      expect(await serverBranches(h)).toEqual(["Third", "main"]);
    } finally {
      await h.cleanup();
    }
  });

  test("offline changes nothing and says so in plain words", async () => {
    const h = await setupClone();
    try {
      await backedUpRevision(h, "Second edition");
      await h.server.close();

      const error = await renameRevision({ projectDir: h.projectDir, from: "Second-edition", to: "Third" }).then(
        () => null,
        (e: Error) => e,
      );

      expect(error?.message).toMatch(/couldn't reach the online copy, so "Second-edition" wasn't renamed/i);
      expect(error?.message).not.toMatch(/branch|push|remote|repository|sync/i);
      expect(await localBranches(h)).toEqual(["Second-edition", "main"]);
    } finally {
      await h.cleanup().catch(() => {});
    }
  });

  test("a rejected sign-in changes nothing; with the sign-in it works", async () => {
    const h = await setupClone({ requireAuth: { username: "writer", password: "secret" } });
    try {
      await backedUpRevision(h, "Second edition");

      await expect(
        renameRevision({ projectDir: h.projectDir, from: "Second-edition", to: "Third" }),
      ).rejects.toThrow(/didn't accept the saved sign-in, so "Second-edition" wasn't renamed/i);
      expect(await serverBranches(h)).toEqual(["Second-edition", "main"]);
      expect(await localBranches(h)).toEqual(["Second-edition", "main"]);

      await renameRevision({ projectDir: h.projectDir, from: "Second-edition", to: "Third", credential: h.credential });
      expect(await serverBranches(h)).toEqual(["Third", "main"]);
    } finally {
      await h.cleanup();
    }
  });

  test("when the online copy won't remove the old name, the new name is taken back", async () => {
    const h = await setupClone();
    try {
      await backedUpRevision(h, "Second edition");

      await expect(
        renameRevision({
          projectDir: h.projectDir,
          from: "Second-edition",
          to: "Third",
          httpClient: declineDeletes("Second-edition"),
        }),
      ).rejects.toThrow(/didn't allow that, so "Second-edition" wasn't renamed/i);

      // Everything is as it was: no half-renamed state anywhere.
      expect(await serverBranches(h)).toEqual(["Second-edition", "main"]);
      expect(await localBranches(h)).toEqual(["Second-edition", "main"]);
      expect(await listed(h)).toEqual(["main:online", "Second-edition:online"]);
    } finally {
      await h.cleanup();
    }
  });

  test("if the new name can't be taken back either, the error says the online copy has both", async () => {
    const h = await setupClone();
    try {
      await backedUpRevision(h, "Second edition");

      await expect(
        renameRevision({
          projectDir: h.projectDir,
          from: "Second-edition",
          to: "Third",
          httpClient: declineDeletes("Second-edition", "Third"),
        }),
      ).rejects.toThrow(/online copy, which now has both "Second-edition" and "Third".*your work is safe/i);

      expect(await serverBranches(h)).toEqual(["Second-edition", "Third", "main"]);
      expect(await localBranches(h)).toEqual(["Second-edition", "main"]);
    } finally {
      await h.cleanup();
    }
  });
});

describe("deleteRevision", () => {
  test("never deletes the open revision", async () => {
    const h = await setupClone();
    try {
      await expect(deleteRevision({ projectDir: h.projectDir, name: "main", everywhere: true })).rejects.toThrow(
        /working on "main" right now.*switch to another revision/i,
      );
      expect(await localBranches(h)).toEqual(["main"]);
    } finally {
      await h.cleanup();
    }
  });

  test("a revision with nothing of its own is deleted on this computer only, with no network", async () => {
    const h = await setupClone();
    try {
      await createRevision({ projectDir: h.projectDir, name: "Scratch" });
      await switchBranch({ projectDir: h.projectDir, branch: "main" });
      await h.server.close();

      expect(await deleteRevision({ projectDir: h.projectDir, name: "Scratch" })).toEqual({ deleted: true });
      expect(await localBranches(h)).toEqual(["main"]);
    } finally {
      await h.cleanup().catch(() => {});
    }
  });

  test("on this computer only: the online copy keeps it, and it shows as online-only", async () => {
    const h = await setupClone();
    try {
      await backedUpRevision(h, "Second edition");

      expect(await deleteRevision({ projectDir: h.projectDir, name: "Second-edition" })).toEqual({ deleted: true });

      expect(await serverBranches(h)).toEqual(["Second-edition", "main"]);
      expect(await listed(h)).toEqual(["main:online", "Second-edition:online-only"]);
    } finally {
      await h.cleanup();
    }
  });

  test("everywhere: removed from the online copy first, then from this computer", async () => {
    const h = await setupClone();
    try {
      await backedUpRevision(h, "Second edition");

      expect(await deleteRevision({ projectDir: h.projectDir, name: "Second-edition", everywhere: true })).toEqual({
        deleted: true,
      });

      expect(await serverBranches(h)).toEqual(["main"]);
      expect(await localBranches(h)).toEqual(["main"]);
      expect(await listed(h)).toEqual(["main:online"]);
    } finally {
      await h.cleanup();
    }
  });

  test("everywhere is refused, changing nothing, when the online copy has versions this computer lacks", async () => {
    const h = await setupClone();
    try {
      await backedUpRevision(h, "Second edition");
      await serverCommitOn(h, "Second-edition", "Written online");

      await expect(
        deleteRevision({ projectDir: h.projectDir, name: "Second-edition", everywhere: true }),
      ).rejects.toThrow(/doesn't have yet\. Switch to "Second-edition" and get the latest first/i);
      expect(await serverBranches(h)).toEqual(["Second-edition", "main"]);
      expect(await localBranches(h)).toEqual(["Second-edition", "main"]);
    } finally {
      await h.cleanup();
    }
  });

  test("everywhere offline changes nothing", async () => {
    const h = await setupClone();
    try {
      await backedUpRevision(h, "Second edition");
      await h.server.close();

      await expect(
        deleteRevision({ projectDir: h.projectDir, name: "Second-edition", everywhere: true }),
      ).rejects.toThrow(/couldn't reach the online copy, so "Second-edition" wasn't deleted/i);
      expect(await localBranches(h)).toEqual(["Second-edition", "main"]);
    } finally {
      await h.cleanup().catch(() => {});
    }
  });

  test("a revision holding versions found nowhere else is not deleted until asked twice", async () => {
    const h = await setupClone();
    try {
      await createRevision({ projectDir: h.projectDir, name: "Experiment" });
      await saveVersion(h, "chapter-03.md", "First experiment");
      await saveVersion(h, "chapter-04.md", "Second experiment");
      await switchBranch({ projectDir: h.projectDir, branch: "main" });

      expect(await deleteRevision({ projectDir: h.projectDir, name: "Experiment" })).toEqual({
        deleted: false,
        versionsOnlyHere: 2,
      });
      expect(await localBranches(h)).toEqual(["Experiment", "main"]);

      expect(await deleteRevision({ projectDir: h.projectDir, name: "Experiment", discard: true })).toEqual({
        deleted: true,
      });
      expect(await localBranches(h)).toEqual(["main"]);
    } finally {
      await h.cleanup();
    }
  });

  test("versions are safe when another revision has them: merged work needs no second look", async () => {
    const h = await setupClone();
    try {
      await createRevision({ projectDir: h.projectDir, name: "Experiment" });
      await saveVersion(h, "chapter-03.md", "Kept experiment");
      // main takes the experiment's tip (a fast-forward, as if merged).
      const tip = await git.resolveRef({ fs, dir: h.projectDir, ref: "Experiment" });
      await git.writeRef({ fs, dir: h.projectDir, ref: "refs/heads/main", value: tip, force: true });
      await switchBranch({ projectDir: h.projectDir, branch: "main" });

      expect(await deleteRevision({ projectDir: h.projectDir, name: "Experiment" })).toEqual({ deleted: true });
    } finally {
      await h.cleanup();
    }
  });

  test("local-only deletion counts only versions the online copy lacks; everywhere counts all", async () => {
    const h = await setupClone();
    try {
      await backedUpRevision(h, "Second edition");
      await switchBranch({ projectDir: h.projectDir, branch: "Second-edition" });
      await saveVersion(h, "chapter-03.md", "Not backed up");
      await switchBranch({ projectDir: h.projectDir, branch: "main" });

      // The online copy still has everything but the last version.
      expect(await deleteRevision({ projectDir: h.projectDir, name: "Second-edition" })).toEqual({
        deleted: false,
        versionsOnlyHere: 1,
      });

      // Back it up: now the online copy has them all, so a local-only delete is safe…
      await switchBranch({ projectDir: h.projectDir, branch: "Second-edition" });
      await syncProject({ projectDir: h.projectDir });
      await saveVersion(h, "chapter-04.md", "Another");
      await syncProject({ projectDir: h.projectDir });
      await switchBranch({ projectDir: h.projectDir, branch: "main" });
      // …but deleting it everywhere would lose the versions only it holds.
      expect(
        await deleteRevision({ projectDir: h.projectDir, name: "Second-edition", everywhere: true }),
      ).toEqual({ deleted: false, versionsOnlyHere: 2 });
      expect(await serverBranches(h)).toEqual(["Second-edition", "main"]);

      expect(await deleteRevision({ projectDir: h.projectDir, name: "Second-edition" })).toEqual({ deleted: true });
    } finally {
      await h.cleanup();
    }
  });

  test("a revision that is only in the online copy is renamed there, with nothing changed here", async () => {
    const h = await setupClone();
    try {
      await onlineOnlyRevision(h, "Elsewhere");

      const result = await renameRevision({ projectDir: h.projectDir, from: "Elsewhere", to: "Somewhere else" });

      expect(result).toEqual({ current: "main", name: "Somewhere-else" });
      expect(await serverBranches(h)).toEqual(["Somewhere-else", "main"]);
      expect(await localBranches(h)).toEqual(["main"]);
      expect(await listed(h)).toEqual(["main:online", "Somewhere-else:online-only"]);
    } finally {
      await h.cleanup();
    }
  });

  describe("a revision that is only in the online copy", () => {
    test("is deleted from the online copy; nothing changes on this computer", async () => {
      const h = await setupClone();
      try {
        await onlineOnlyRevision(h, "Elsewhere");
        expect(await listed(h)).toEqual(["Elsewhere:online-only", "main:online"]);

        expect(await deleteRevision({ projectDir: h.projectDir, name: "Elsewhere" })).toEqual({ deleted: true });

        expect(await serverBranches(h)).toEqual(["main"]);
        expect(await localBranches(h)).toEqual(["main"]);
        // The row is gone without another check of the online copy.
        expect(await listed(h)).toEqual(["main:online"]);
      } finally {
        await h.cleanup();
      }
    });

    test("holding versions found nowhere else is not deleted until asked twice", async () => {
      const h = await setupClone();
      try {
        await onlineOnlyRevision(h, "Elsewhere", ["First online", "Second online"]);

        expect(await deleteRevision({ projectDir: h.projectDir, name: "Elsewhere" })).toEqual({
          deleted: false,
          versionsOnlyHere: 2,
        });
        expect(await serverBranches(h)).toEqual(["Elsewhere", "main"]);
        expect(await listed(h)).toEqual(["Elsewhere:online-only", "main:online"]);

        expect(await deleteRevision({ projectDir: h.projectDir, name: "Elsewhere", discard: true })).toEqual({
          deleted: true,
        });
        expect(await serverBranches(h)).toEqual(["main"]);
        expect(await listed(h)).toEqual(["main:online"]);
      } finally {
        await h.cleanup();
      }
    });

    test("needs no second look when another revision, here or online, has its versions", async () => {
      const h = await setupClone();
      try {
        await onlineOnlyRevision(h, "Elsewhere", ["Kept online"]);
        const tip = await git.resolveRef({ fs, dir: h.serverDir, ref: "Elsewhere" });
        await git.branch({ fs, dir: h.serverDir, ref: "Copy", object: tip });
        await refreshRemoteCopies({ projectDir: h.projectDir });

        // The online copy's "Copy" has them too.
        expect(await deleteRevision({ projectDir: h.projectDir, name: "Elsewhere" })).toEqual({ deleted: true });
        expect(await serverBranches(h)).toEqual(["Copy", "main"]);

        // And so does a revision on this computer, once "Copy" is out of the way.
        await git.branch({ fs, dir: h.projectDir, ref: "Mine", object: tip });
        expect(await deleteRevision({ projectDir: h.projectDir, name: "Copy" })).toEqual({ deleted: true });
        expect(await serverBranches(h)).toEqual(["main"]);
        expect(await localBranches(h)).toEqual(["Mine", "main"]);
      } finally {
        await h.cleanup();
      }
    });

    test("is refused, changing nothing, when it gained versions after the list was checked", async () => {
      const h = await setupClone();
      try {
        await onlineOnlyRevision(h, "Elsewhere");
        await serverCommitOn(h, "Elsewhere", "Written online since");

        await expect(deleteRevision({ projectDir: h.projectDir, name: "Elsewhere" })).rejects.toThrow(
          /has versions of "Elsewhere" that this computer doesn't have yet\. They arrived after the list was last checked, so "Elsewhere" wasn't deleted\. Try again\./i,
        );
        expect(await serverBranches(h)).toEqual(["Elsewhere", "main"]);
        expect(await listed(h)).toEqual(["Elsewhere:online-only", "main:online"]);

        // Checking the list again brings the new version in; the delete now shows what would be lost.
        await refreshRemoteCopies({ projectDir: h.projectDir });
        expect(await deleteRevision({ projectDir: h.projectDir, name: "Elsewhere" })).toEqual({
          deleted: false,
          versionsOnlyHere: 1,
        });
      } finally {
        await h.cleanup();
      }
    });

    test("offline changes nothing and says so in plain words", async () => {
      const h = await setupClone();
      try {
        await onlineOnlyRevision(h, "Elsewhere");
        await h.server.close();

        await expect(deleteRevision({ projectDir: h.projectDir, name: "Elsewhere" })).rejects.toThrow(
          /couldn't reach the online copy, so "Elsewhere" wasn't deleted/i,
        );
        expect(await listed(h)).toEqual(["Elsewhere:online-only", "main:online"]);
      } finally {
        await h.cleanup().catch(() => {});
      }
    });

    test("a rejected sign-in changes nothing; with the sign-in it works", async () => {
      const h = await setupClone({ requireAuth: { username: "writer", password: "secret" } });
      try {
        await onlineOnlyRevision(h, "Elsewhere");

        await expect(deleteRevision({ projectDir: h.projectDir, name: "Elsewhere" })).rejects.toThrow(
          /didn't accept the saved sign-in, so "Elsewhere" wasn't deleted/i,
        );
        expect(await serverBranches(h)).toEqual(["Elsewhere", "main"]);

        await deleteRevision({ projectDir: h.projectDir, name: "Elsewhere", credential: h.credential });
        expect(await serverBranches(h)).toEqual(["main"]);
      } finally {
        await h.cleanup();
      }
    });

    test("stays listed when the online copy won't remove it", async () => {
      const h = await setupClone();
      try {
        await onlineOnlyRevision(h, "Elsewhere");

        await expect(
          deleteRevision({ projectDir: h.projectDir, name: "Elsewhere", httpClient: declineDeletes("Elsewhere") }),
        ).rejects.toThrow(/didn't allow that, so "Elsewhere" wasn't deleted/i);
        expect(await serverBranches(h)).toEqual(["Elsewhere", "main"]);
        expect(await listed(h)).toEqual(["Elsewhere:online-only", "main:online"]);
      } finally {
        await h.cleanup();
      }
    });

    test("already gone from the online copy: nothing to remove, and the next check drops the row", async () => {
      const h = await setupClone();
      try {
        await onlineOnlyRevision(h, "Elsewhere");
        await git.deleteBranch({ fs, dir: h.serverDir, ref: "Elsewhere" });

        expect(await deleteRevision({ projectDir: h.projectDir, name: "Elsewhere" })).toEqual({ deleted: true });
        await refreshRemoteCopies({ projectDir: h.projectDir });
        expect(await listed(h)).toEqual(["main:online"]);
      } finally {
        await h.cleanup();
      }
    });
  });

  test("a name that does not exist is a plain error", async () => {
    const h = await setupClone();
    try {
      await expect(deleteRevision({ projectDir: h.projectDir, name: "Nope" })).rejects.toThrow(
        /couldn't find a revision named "Nope"/i,
      );
    } finally {
      await h.cleanup();
    }
  });
});

describe("a book whose tracking refs were packed by other Git tools", () => {
  /** Move every loose tracking ref into `packed-refs`, the way `git gc` leaves them. */
  function packTrackingRefs(projectDir: string) {
    const dir = path.join(projectDir, ".git", "refs", "remotes", "origin");
    const names = fs.readdirSync(dir).filter((name) => name !== "HEAD"); // HEAD is a pointer, not packed
    const lines = names.map((name) => `${fs.readFileSync(path.join(dir, name), "utf8").trim()} refs/remotes/origin/${name}`);
    fs.writeFileSync(path.join(projectDir, ".git", "packed-refs"), `# pack-refs with: peeled fully-peeled sorted\n${lines.join("\n")}\n`);
    for (const name of names) fs.rmSync(path.join(dir, name));
  }

  test("deleting everywhere and renaming leave no stale online-only row behind", async () => {
    const h = await setupClone();
    try {
      await backedUpRevision(h, "Gone");
      await backedUpRevision(h, "Old name");
      packTrackingRefs(h.projectDir);
      expect(await listed(h)).toEqual(["Gone:online", "main:online", "Old-name:online"]);

      await deleteRevision({ projectDir: h.projectDir, name: "Gone", everywhere: true });
      await renameRevision({ projectDir: h.projectDir, from: "Old-name", to: "New name" });

      expect(await serverBranches(h)).toEqual(["New-name", "main"]);
      expect(await listed(h)).toEqual(["main:online", "New-name:online"]);
    } finally {
      await h.cleanup();
    }
  });
});

describe("renameRevision names", () => {
  test("refuses a name already used here or online, and an unusable one", async () => {
    const h = await setupClone();
    try {
      await createRevision({ projectDir: h.projectDir, name: "One" });
      await createRevision({ projectDir: h.projectDir, name: "Two" });
      const tip = await git.resolveRef({ fs, dir: h.serverDir, ref: "main" });
      await git.branch({ fs, dir: h.serverDir, ref: "Online-one", object: tip });
      await refreshRemoteCopies({ projectDir: h.projectDir });

      const refused = (to: string) =>
        renameRevision({ projectDir: h.projectDir, from: "Two", to }).then(() => "renamed", (e: Error) => e.message);
      expect(await refused("one")).toMatch(/already a revision called "One"/i);
      expect(await refused("online one")).toMatch(/already a revision in the online copy/i);
      expect(await refused("bad:name")).toMatch(/can't be a revision name/i);
      expect(await refused("  ")).toMatch(/give the revision a name/i);
      expect(await localBranches(h)).toEqual(["One", "Two", "main"]);
    } finally {
      await h.cleanup();
    }
  });
});
