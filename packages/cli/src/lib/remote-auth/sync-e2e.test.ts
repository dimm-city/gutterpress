/**
 * End-to-end sync scenario mirroring the packaged desktop's exact topology on
 * a machine with NO system git (the product's whole point — CLAUDE.md §7):
 *
 *   - a multi-book BARE repository served by the in-test smart-HTTP server
 *   - the repo cloned BY THE APP (lib `cloneRepository` — the clone.ts path)
 *   - the project is a SUBFOLDER of the repo (`books/field-guide`)
 *   - a second lib clone plays the "other computer" that lands new commits
 *     on the server (via provider snapshots + `syncProject` — never system git)
 *
 * Then the full user flow, all through lib APIs, asserting each step:
 *   provider snapshot (local-only commit) → remote gains 2 commits →
 *   syncProject combines them in (file content on disk + new tip) →
 *   listHistoryPage for the subfolder → local edit + snapshot → syncProject
 *   lands on the server (server tip verified).
 *
 * This file runs on EVERY platform (it is part of the lib's normal
 * `bun test` suite) and is dispatched on windows-latest by
 * .github/workflows/windows-lib-test.yml — the field topology
 * (v0.5.0-rc.12/13 Windows report) had never been executed on Windows.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import git from "isomorphic-git";

import { detectProjectSource } from "../project-source.ts";
import { providerFor } from "../source-provider.ts";
import { cloneRepository } from "./clone.ts";
import { syncProject } from "./sync.ts";
import {
  startGitServer,
  tempDir,
  type GitServer,
} from "./test-support/git-http-server.ts";

const AUTHOR = { name: "Fixture", email: "fixture@test.local" };

/** Verbatim step logging so CI logs show exactly what each lib call returned. */
function logStep(step: string, outcome: unknown): void {
  console.log(`[sync-e2e] ${step}: ${JSON.stringify(outcome)}`);
}

/**
 * Build the multi-book fixture in a worktree, then serve its `.git` as the
 * BARE repository (the server helper treats a dir without `.git` inside it
 * as a gitdir). After this, the worktree is never touched again — every
 * change to the served repo arrives through lib pushes.
 */
async function createMultiBookBareRepo(): Promise<{
  bareDir: string;
  workDir: string;
  head: string;
}> {
  const workDir = await tempDir("gutterpress-e2e-fixture-");
  await git.init({ fs, dir: workDir, defaultBranch: "main" });
  const files: Record<string, string> = {
    "README.md": "# Multi-book repository\n",
    "books/field-guide/manifest.yaml": "title: Field Guide\n",
    "books/field-guide/chapter-01.md": "# One\n\nFirst draft.\n",
    "books/other-book/manifest.yaml": "title: Other Book\n",
    "books/other-book/notes.md": "Sibling book content.\n",
  };
  for (const [filepath, content] of Object.entries(files)) {
    const abs = path.join(workDir, filepath);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content);
    await git.add({ fs, dir: workDir, filepath });
  }
  const head = await git.commit({
    fs,
    dir: workDir,
    message: "Initial multi-book content",
    author: AUTHOR,
  });
  return { bareDir: path.join(workDir, ".git"), workDir, head };
}

describe("sync e2e — app-cloned multi-book repo, project is a subfolder", () => {
  let server: GitServer;
  let bareDir: string;
  let fixtureWorkDir: string;
  let cleanupDirs: string[] = [];

  beforeAll(async () => {
    const fixture = await createMultiBookBareRepo();
    bareDir = fixture.bareDir;
    fixtureWorkDir = fixture.workDir;
    cleanupDirs.push(fixtureWorkDir);
    server = await startGitServer(bareDir);
  });

  afterAll(async () => {
    await server.close().catch(() => {});
    for (const dir of cleanupDirs) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  const serverTip = () => git.resolveRef({ fs, gitdir: bareDir, ref: "main" });

  test("full user flow: clone → snapshot → remote moves → sync → history → sync", async () => {
    // ── Step 1: the app clones the repo (the user's machine, "computer A") ──
    const parentA = await tempDir("gutterpress-e2e-a-");
    cleanupDirs.push(parentA);
    const repoA = path.join(parentA, "my-books");
    const cloneA = await cloneRepository({ url: server.url, dir: repoA });
    logStep("cloneA", cloneA);
    expect(cloneA.branch).toBe("main");
    const projectA = path.join(repoA, "books", "field-guide");
    expect(
      await readFile(path.join(projectA, "chapter-01.md"), "utf8"),
    ).toBe("# One\n\nFirst draft.\n");

    // ── Step 2: classification — subfolder project of the cloned repo ──
    const sourceA = await detectProjectSource(projectA);
    logStep("detectProjectSource(A)", sourceA);
    if (sourceA.type !== "local-git-folder") {
      throw new Error(`expected local-git-folder, got ${sourceA.type}`);
    }
    expect(path.resolve(sourceA.repoRoot)).toBe(path.resolve(repoA));
    // Canonical forward-slash subPath — MUST hold on Windows too.
    expect(sourceA.subPath).toBe("books/field-guide");
    expect(sourceA.hasRemote).toBe(true);

    // ── Step 3: a local-only commit via the provider (auto-snapshot path) ──
    await writeFile(
      path.join(projectA, "chapter-01.md"),
      "# One\n\nFirst draft, with my local notes.\n",
    );
    const localSnap = await providerFor(sourceA).snapshot({
      projectDir: projectA,
      message: "My local snapshot",
      authorName: "Author A",
    });
    logStep("snapshot(A)", localSnap);
    expect(localSnap.id).toMatch(/^[0-9a-f]{40}$/);

    // ── Step 4: the remote gains 2 commits via a SECOND lib clone ──
    const parentB = await tempDir("gutterpress-e2e-b-");
    cleanupDirs.push(parentB);
    const repoB = path.join(parentB, "my-books");
    await cloneRepository({ url: server.url, dir: repoB });
    const projectB = path.join(repoB, "books", "field-guide");
    const sourceB = await detectProjectSource(projectB);
    if (sourceB.type !== "local-git-folder") {
      throw new Error(`expected local-git-folder, got ${sourceB.type}`);
    }
    const providerB = providerFor(sourceB);
    await writeFile(
      path.join(projectB, "chapter-02.md"),
      "# Two\n\nWritten on the other computer.\n",
    );
    const remoteSnap1 = await providerB.snapshot({
      projectDir: projectB,
      message: "Remote commit 1",
      authorName: "Author B",
    });
    logStep("snapshot(B) #1", remoteSnap1);
    await writeFile(
      path.join(projectB, "chapter-03.md"),
      "# Three\n\nAlso from the other computer.\n",
    );
    const remoteSnap2 = await providerB.snapshot({
      projectDir: projectB,
      message: "Remote commit 2",
      authorName: "Author B",
    });
    logStep("snapshot(B) #2", remoteSnap2);
    const pushB = await syncProject({ projectDir: projectB });
    logStep("syncProject(B)", pushB);
    expect(pushB.status).toBe("synced");
    expect(await serverTip()).toBe(remoteSnap2.id);

    // ── Step 5: syncProject combines the online commits with the local one ──
    const tipBeforePull = await git.resolveRef({ fs, dir: repoA, ref: "main" });
    const pull = await syncProject({ projectDir: projectA });
    logStep("syncProject(A)", pull);
    expect(pull.status).toBe("synced");
    if (pull.status !== "synced") throw new Error("unreachable");
    expect(pull.mergedRemoteChanges).toBe(true); // both sides moved
    expect(pull.filesChanged).toBe(true);
    // The online files are ON DISK in the user's project folder.
    expect(
      await readFile(path.join(projectA, "chapter-02.md"), "utf8"),
    ).toBe("# Two\n\nWritten on the other computer.\n");
    expect(
      await readFile(path.join(projectA, "chapter-03.md"), "utf8"),
    ).toBe("# Three\n\nAlso from the other computer.\n");
    // The local edit from step 3 survived the merge.
    expect(
      await readFile(path.join(projectA, "chapter-01.md"), "utf8"),
    ).toBe("# One\n\nFirst draft, with my local notes.\n");
    // The tip moved and is a two-parent merge of local + online.
    const tipAfterPull = await git.resolveRef({ fs, dir: repoA, ref: "main" });
    expect(tipAfterPull).not.toBe(tipBeforePull);
    const mergeCommit = await git.readCommit({ fs, dir: repoA, oid: tipAfterPull });
    expect(mergeCommit.commit.parent).toHaveLength(2);
    expect(mergeCommit.commit.parent).toContain(localSnap.id);
    expect(mergeCommit.commit.parent).toContain(remoteSnap2.id);

    // A second sync is a no-op: "everything is in sync" must be TRUE.
    const pullAgain = await syncProject({ projectDir: projectA });
    logStep("syncProject(A) again", pullAgain);
    expect(pullAgain.status).toBe("up-to-date");

    // ── Step 7: listHistoryPage for the SUBFOLDER behaves sanely ──
    const historyPage = await providerFor(
      await detectProjectSource(projectA),
    ).listHistoryPage(projectA);
    logStep(
      "listHistoryPage(A)",
      historyPage.entries.map((e) => ({ id: e.id.slice(0, 7), message: e.message })),
    );
    const messages = historyPage.entries.map((e) => e.message);
    // Every commit that touched books/field-guide must appear…
    expect(messages).toContain("My local snapshot");
    expect(messages).toContain("Remote commit 1");
    expect(messages).toContain("Remote commit 2");
    expect(messages).toContain("Initial multi-book content");
    // …newest-first (timestamps non-increasing).
    const timestamps = historyPage.entries.map((e) => e.timestamp);
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]!).toBeLessThanOrEqual(timestamps[i - 1]!);
    }

    // ── Step 8: local edit + snapshot, then push lands on the server ──
    await writeFile(
      path.join(projectA, "chapter-04.md"),
      "# Four\n\nNew chapter after the pull.\n",
    );
    const finalSnap = await providerFor(
      await detectProjectSource(projectA),
    ).snapshot({
      projectDir: projectA,
      message: "Chapter four",
      authorName: "Author A",
    });
    logStep("snapshot(A) final", finalSnap);
    const pushA = await syncProject({ projectDir: projectA });
    logStep("syncProject(A)", pushA);
    expect(pushA.status).toBe("synced");
    // The SERVER's tip is exactly A's final snapshot — verified on the bare repo.
    expect(await serverTip()).toBe(finalSnap.id);
    // And the server-side commit object resolves to the pushed content.
    const { blob } = await git.readBlob({
      fs,
      gitdir: bareDir,
      oid: finalSnap.id,
      filepath: "books/field-guide/chapter-04.md",
    });
    expect(Buffer.from(blob).toString("utf8")).toBe(
      "# Four\n\nNew chapter after the pull.\n",
    );
  }, 60_000);
});
