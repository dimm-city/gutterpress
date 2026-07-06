/**
 * Tests for buildRecoveryContext — the single RecoveryContext resolution both
 * hosts (viewer bridge, `print-md repair`) delegate to.
 *
 * The repo-root cases guard against the ancestor-repo bug: resolving with an
 * ancestor-only walk (findEnclosingRepoDir) made a project that IS its own
 * repo root resolve to a parent repo (e.g. ~/.git), and the backup step would
 * then zip the entire home directory.
 */

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { detectProjectSource, type ProjectSource } from "../../project-source.ts";
import { diagnoseProjectRemote } from "../diagnose.ts";
import type { HostCredential, TokenStore } from "../token-store.ts";
import type { ConfirmationGate } from "./types.ts";
import { buildRecoveryContext } from "./context.ts";
import { inspectRepo } from "./inspect.ts";

const GATE: ConfirmationGate = { confirmRepair: async () => false };

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "pmd-recovery-ctx-"));
}

async function makeGitDir(
  dir: string,
  branch: string,
  remoteUrl?: string,
): Promise<void> {
  const gitDir = path.join(dir, ".git");
  await mkdir(gitDir, { recursive: true });
  await writeFile(path.join(gitDir, "HEAD"), `ref: refs/heads/${branch}\n`);
  const remote = remoteUrl
    ? `[remote "origin"]\n\turl = ${remoteUrl}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`
    : "";
  await writeFile(
    path.join(gitDir, "config"),
    `[core]\n\trepositoryformatversion = 0\n${remote}`,
  );
}

function fakeTokenStore(byHost: Record<string, HostCredential>): TokenStore {
  return {
    get: async (host: string) => byHost[host] ?? null,
    delete: async () => undefined,
  } as unknown as TokenStore;
}

describe("buildRecoveryContext — repo-root resolution", () => {
  test("a project that IS its own repo root resolves to itself, never a parent repo", async () => {
    const root = await tempDir();
    try {
      const outer = path.join(root, "outer");
      const inner = path.join(outer, "book");
      await mkdir(inner, { recursive: true });
      await makeGitDir(outer, "outer-main");
      await makeGitDir(inner, "inner-main");

      const ctx = await buildRecoveryContext({ projectDir: inner, confirmation: GATE });
      expect(ctx.repoDir).toBe(inner);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("a project subfolder resolves to its owning repo root", async () => {
    const root = await tempDir();
    try {
      const repo = path.join(root, "repo");
      const book = path.join(repo, "books", "field-guide");
      await mkdir(book, { recursive: true });
      await makeGitDir(repo, "main");

      const ctx = await buildRecoveryContext({ projectDir: book, confirmation: GATE });
      expect(ctx.repoDir).toBe(repo);
      expect(ctx.projectDir).toBe(book);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("a plain folder (no repo anywhere) resolves to itself", async () => {
    const root = await tempDir();
    try {
      const ctx = await buildRecoveryContext({ projectDir: root, confirmation: GATE });
      expect(ctx.repoDir).toBe(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("buildRecoveryContext — branch, credential, slug", () => {
  test("uses the locally detected branch for a local-only repo (no hardcoded 'main')", async () => {
    const root = await tempDir();
    try {
      const repo = path.join(root, "my-book");
      await mkdir(repo, { recursive: true });
      await makeGitDir(repo, "master");

      const ctx = await buildRecoveryContext({ projectDir: repo, confirmation: GATE });
      expect(ctx.branch).toBe("master");
      expect(ctx.remoteUrl).toBeUndefined();
      expect(ctx.credential).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("resolves the credential for the remote host and a sanitized repo slug", async () => {
    const root = await tempDir();
    try {
      const repo = path.join(root, "my book!");
      await mkdir(repo, { recursive: true });
      await makeGitDir(repo, "main", "https://example.com/me/my-book.git");

      const cred: HostCredential = {
        host: "example.com",
        kind: "token",
        token: "t0ken",
        createdAt: Date.now(),
      };
      const ctx = await buildRecoveryContext({
        projectDir: repo,
        confirmation: GATE,
        tokenStore: fakeTokenStore({ "example.com": cred }),
      });

      expect(ctx.remoteUrl).toBe("https://example.com/me/my-book.git");
      expect(ctx.credential?.token).toBe("t0ken");
      // Slug is filesystem-safe (backup file naming).
      expect(ctx.repoSlug).toBe("my_book_");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("classifies the project folder exactly ONCE and threads it (context → diagnose → inspect)", async () => {
    // Guard against the #87 hot-path regression: building a context used to
    // classify the same folder 2-3× (context, diagnoseProjectRemote, and again
    // in inspectRepo), each walking parent dirs with stats. Uses the classify/
    // diagnose injection seams — NEVER mock.module, which leaks the mock into
    // other test files (broke recover-wrong-remote in CI).
    const root = await tempDir();
    try {
      const repo = path.join(root, "one-classify");
      await mkdir(repo, { recursive: true });
      await makeGitDir(repo, "main", "https://example.com/me/book.git");

      let classifyCalls = 0;
      let sourceSeenByDiagnose: ProjectSource | undefined;
      const ctx = await buildRecoveryContext({
        projectDir: repo,
        confirmation: GATE,
        classify: async (p) => {
          classifyCalls++;
          return detectProjectSource(p);
        },
        diagnose: async (p, opts) => {
          // Record the threading: diagnose must receive the pre-classified
          // source (its own ghost-dir test proves it then skips re-classifying).
          sourceSeenByDiagnose = opts?.source;
          return diagnoseProjectRemote(p, opts);
        },
      });

      expect(classifyCalls).toBe(1);
      expect(sourceSeenByDiagnose?.type).toBe("local-git-folder");
      expect(ctx.source?.type).toBe("local-git-folder");

      // The preflight probe reuses the threaded classification too (the
      // fabricated-source test in inspect.test.ts proves it is honored).
      const health = await inspectRepo(ctx);
      expect(health.hasGitDir).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("a diagnose failure falls back to the locally classified source, sanitized (never null)", async () => {
    // The defensive catch around diagnoseProjectRemote must not throw away
    // the classification this function already resolved — that would force
    // inspectRepo to re-walk parent dirs (the exact #87 redundancy). The
    // fallback must also never carry a credential embedded in the remote
    // URL (D7), since the diagnose sanitization didn't run.
    const root = await tempDir();
    try {
      const repo = path.join(root, "diag-throws");
      await mkdir(repo, { recursive: true });
      await makeGitDir(repo, "main", "https://x-token:sekret123@example.com/me/book.git");

      const ctx = await buildRecoveryContext({
        projectDir: repo,
        confirmation: GATE,
        diagnose: async () => {
          throw new Error("injected diagnose failure");
        },
      });

      expect(ctx.source?.type).toBe("local-git-folder");
      expect(JSON.stringify(ctx.source)).not.toContain("sekret123");
      if (ctx.source?.type === "local-git-folder") {
        expect(ctx.source.remoteUrl).toBe("https://example.com/me/book.git");
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("threads authorName, logFile, and the host's confirmation gate through", async () => {
    const root = await tempDir();
    try {
      const repo = path.join(root, "proj");
      await mkdir(repo, { recursive: true });
      await makeGitDir(repo, "main");

      const ctx = await buildRecoveryContext({
        projectDir: repo,
        confirmation: GATE,
        authorName: "Ada",
        logFile: "/tmp/op.log",
      });
      expect(ctx.authorName).toBe("Ada");
      expect(ctx.logFile).toBe("/tmp/op.log");
      expect(ctx.confirmation).toBe(GATE);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
