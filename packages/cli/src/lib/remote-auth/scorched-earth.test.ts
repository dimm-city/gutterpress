/**
 * scorched-earth.ts — back up the folder, empty it, download a fresh copy,
 * copy the backed-up files (not the old `.git`) back on top.
 *
 * TEST RUNNER: bun:test only.
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import git from "isomorphic-git";

import { scorchedEarth } from "./scorched-earth.ts";
import { syncProject } from "./sync.ts";
import { tempDir } from "./test-support/git-http-server.ts";
import { serverCommit, setupClone, type Harness } from "./test-support/sync-harness.ts";

async function setup(): Promise<Harness & { backupDir: string; cleanup(): Promise<void> }> {
  const h = await setupClone();
  const backupsRoot = await tempDir("gp-scorched-backups-");
  return {
    ...h,
    backupDir: path.join(backupsRoot, "book", "t1"),
    cleanup: async () => {
      await h.cleanup();
      await rm(backupsRoot, { recursive: true, force: true });
    },
  };
}

describe("scorchedEarth", () => {
  test("fresh history, files here win, online-only files stay, full backup kept", async () => {
    const h = await setup();
    try {
      await serverCommit(h.serverDir, { "chapter-03.md": "# Three\n", "chapter-01.md": "# One\n\nOnline.\n" }, "server");
      await writeFile(path.join(h.projectDir, "chapter-01.md"), "# One\n\nMine.\n");
      await writeFile(path.join(h.projectDir, "notes.md"), "local only\n");
      // Wreck the history.
      fs.writeFileSync(path.join(h.projectDir, ".git", "index"), "");
      fs.writeFileSync(path.join(h.projectDir, ".git", "HEAD"), "");

      const result = await scorchedEarth({ projectDir: h.projectDir, backupDir: h.backupDir });

      expect(result.branch).toBe("main");
      expect(await readFile(path.join(h.projectDir, "chapter-01.md"), "utf8")).toBe("# One\n\nMine.\n");
      expect(await readFile(path.join(h.projectDir, "notes.md"), "utf8")).toBe("local only\n");
      expect(await readFile(path.join(h.projectDir, "chapter-03.md"), "utf8")).toBe("# Three\n");
      // The backup holds everything, broken .git included.
      expect(fs.readFileSync(path.join(h.backupDir, ".git", "HEAD"), "utf8")).toBe("");
      expect(fs.existsSync(path.join(h.backupDir, "notes.md"))).toBe(true);
      // The fresh .git works: the local files sync as an ordinary change.
      expect((await syncProject({ projectDir: h.projectDir })).status).toBe("synced");
      const [head] = await git.log({ fs, dir: h.projectDir, depth: 1 });
      expect(await git.resolveRef({ fs, dir: h.serverDir, ref: "main" })).toBe(head!.oid);
    } finally {
      await h.cleanup();
    }
  });

  test("a download that fails puts the folder back as it was", async () => {
    const h = await setup();
    try {
      await writeFile(path.join(h.projectDir, "chapter-01.md"), "# One\n\nKept.\n");
      await h.server.close();
      await expect(scorchedEarth({ projectDir: h.projectDir, backupDir: h.backupDir })).rejects.toThrow();
      expect(await readFile(path.join(h.projectDir, "chapter-01.md"), "utf8")).toBe("# One\n\nKept.\n");
      expect(fs.existsSync(path.join(h.projectDir, ".git", "HEAD"))).toBe(true);
    } finally {
      await rm(h.serverDir, { recursive: true, force: true }).catch(() => {});
      await rm(path.dirname(h.projectDir), { recursive: true, force: true }).catch(() => {});
      await rm(path.dirname(path.dirname(h.backupDir)), { recursive: true, force: true }).catch(() => {});
    }
  });
});
