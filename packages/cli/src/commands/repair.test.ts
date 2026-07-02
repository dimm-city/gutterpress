/**
 * Tests for `print-md repair`'s DIAGNOSIS step (repair.ts).
 *
 * H1 fix under test: classifyFromHealth (health.ts's filesystem-presence
 * checks) can NEVER return corrupt_index / missing_or_corrupt_objects /
 * unrelated_histories / wrong_remote_or_branch — it never reads a git
 * object. Before this fix, `repair --check` on a repo with a missing/corrupt
 * object reported "healthy" because the diagnosis stopped at
 * classifyFromHealth. The fix adds a structural readability probe
 * (verifyRepoReadable, shared with recover-missing-objects.ts's own
 * post-fetch verification) that runs when classifyFromHealth finds nothing,
 * and feeds any thrown error through classifyGitError to get the real kind.
 *
 * These tests exercise the actual `print-md repair --check` CLI process (the
 * end-to-end surface the bug was observed on), built from source with Bun —
 * no system git involved (isomorphic-git only, per CLAUDE.md §7).
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import git from "isomorphic-git";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_ENTRY = path.join(__dirname, "..", "cli.ts");

/** Create a minimal real repo (isomorphic-git only) with one commit. */
async function makeRepo(dir: string): Promise<string> {
  await git.init({ fs, dir, defaultBranch: "main" });
  fs.writeFileSync(path.join(dir, "a.txt"), "hello");
  await git.add({ fs, dir, filepath: "a.txt" });
  const oid = await git.commit({
    fs,
    dir,
    message: "init",
    author: { name: "tester", email: "tester@example.com" },
  });
  return oid;
}

/** Delete the loose object file for the given oid — simulates a corrupted/missing object. */
function deleteLooseObject(dir: string, oid: string): void {
  const objPath = path.join(dir, ".git", "objects", oid.slice(0, 2), oid.slice(2));
  fs.unlinkSync(objPath);
}

function runRepairCheck(dir: string): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync({
    cmd: ["bun", "run", CLI_ENTRY, "repair", dir, "--check"],
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

describe("print-md repair --check diagnosis", () => {
  test("healthy repo reports healthy and exits 0", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "repair-healthy-"));
    try {
      await makeRepo(dir);
      const { exitCode, stdout } = runRepairCheck(dir);
      expect(stdout).toContain("looks healthy");
      expect(exitCode).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("fresh git init with no commits yet reports healthy (unborn HEAD is not corruption)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "repair-unborn-"));
    try {
      // `print-md new` git-inits a project before its first snapshot commit;
      // in that window HEAD names a branch with no commits, and the
      // readability probe throws the same NotFoundError as ref-store damage.
      // isUnbornRepo (empty object store) must keep this diagnosed healthy.
      await git.init({ fs, dir, defaultBranch: "main" });
      const { exitCode, stdout } = runRepairCheck(dir);
      expect(stdout).toContain("looks healthy");
      expect(exitCode).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 20_000);

  test("repo with a deleted/corrupted commit object is NOT reported healthy", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "repair-corrupt-"));
    try {
      const oid = await makeRepo(dir);
      deleteLooseObject(dir, oid);

      const { exitCode, stdout } = runRepairCheck(dir);

      // Before the H1 fix this printed "Your project's version history looks
      // healthy. Nothing to repair." and exited 0 — classifyFromHealth never
      // reads a git object, so it can't see this damage. The fix must surface
      // a real problem and the non-zero --check exit code.
      expect(stdout).not.toContain("looks healthy");
      expect(stdout).toContain("Found a problem");
      expect(exitCode).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 20_000);
});
