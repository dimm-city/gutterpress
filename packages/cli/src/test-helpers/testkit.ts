/**
 * Shared CLI test-scaffolding kit.
 *
 * TEST-ONLY. This module is imported exclusively by `*.test.ts` files — it is
 * never referenced by production entrypoints (`src/index.ts`, `src/cli.ts`),
 * so it never lands in the `bun build`/`bun build --compile` output. It exists
 * to kill the copy-pasted scaffolding that used to live inline in dozens of
 * test files (`makeTempDir` ~13×, `makeCtx` ~2× for the CheckContext shape,
 * plus the isomorphic-git repo builders).
 *
 * Where copies differed meaningfully, the canonical helper keeps every
 * behavior via options rather than silently picking one — callers pass the
 * exact prefix/author/content they relied on.
 */

import * as nodeFs from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import git from "isomorphic-git";
import type { FsClient } from "isomorphic-git";

import { resolveConfig } from "../lib/manifest";
import type { CheckContext } from "../checks/types";

// ---------------------------------------------------------------------------
// Temp dirs
// ---------------------------------------------------------------------------

/**
 * Create a fresh, unique temp directory under `os.tmpdir()`.
 *
 * The `prefix` is purely a human-readable naming segment for the OS-assigned
 * unique dir (handy when eyeballing leftover fixtures); callers that relied on
 * a suite-specific prefix pass it through so behavior is byte-identical.
 */
export async function makeTempDir(prefix = "print-md-test-"): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

// ---------------------------------------------------------------------------
// CheckContext builder
// ---------------------------------------------------------------------------

/**
 * Build a {@link CheckContext} for check/policy unit tests, filling the
 * required fields with defaults and shallow-merging a partial override
 * (last-write-wins), matching the copies that lived in
 * `checks.test.ts` / `policy.test.ts`.
 */
export function makeCtx(partial: Partial<CheckContext> = {}): CheckContext {
  return {
    config: resolveConfig({}, {} as never),
    inputDir: "/tmp/test-input",
    outputDir: "/tmp/test-output",
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// isomorphic-git repo builders
// ---------------------------------------------------------------------------

export interface TestAuthor {
  name: string;
  email: string;
}

/** The author most recovery-test copies used. */
export const DEFAULT_TEST_AUTHOR: TestAuthor = {
  name: "Test Author",
  email: "test@test.local",
};

const DEFAULT_FS = nodeFs as unknown as FsClient;

export interface InitRepoOptions {
  branch?: string;
  content?: string;
  message?: string;
  author?: TestAuthor;
  fs?: FsClient;
}

/**
 * Initialize a git repo with a single committed `chapter-01.md` and return the
 * initial commit oid. Every varying bit (branch, file content, commit message,
 * author, fs impl) is an option so the previously-bespoke copies map onto it
 * without changing behavior.
 */
export async function initRepo(
  dir: string,
  opts: InitRepoOptions = {},
): Promise<string> {
  const fs = opts.fs ?? DEFAULT_FS;
  await git.init({ fs, dir, defaultBranch: opts.branch ?? "main" });
  await writeFile(
    path.join(dir, "chapter-01.md"),
    opts.content ?? "# Chapter One\n\nInitial content.\n",
  );
  await git.add({ fs, dir, filepath: "chapter-01.md" });
  return git.commit({
    fs,
    dir,
    message: opts.message ?? "initial commit",
    author: opts.author ?? DEFAULT_TEST_AUTHOR,
  });
}

/**
 * Like {@link initRepo} but defaults to the `"initial"` commit message the
 * `makeTestRepo` copies used. Always on `main`. Returns the commit oid.
 */
export async function makeTestRepo(
  dir: string,
  opts: Omit<InitRepoOptions, "branch"> = {},
): Promise<string> {
  return initRepo(dir, {
    branch: "main",
    content: opts.content ?? "# Chapter One\n\nContent.\n",
    message: opts.message ?? "initial",
    author: opts.author,
    fs: opts.fs,
  });
}

export interface CommitFileOptions {
  message?: string;
  author?: TestAuthor;
  fs?: FsClient;
}

/**
 * Write `body` to `filename` inside an existing repo, stage it and commit.
 * Defaults the message to `add <filename>` (the copies' convention). Returns
 * the commit oid.
 */
export async function commitFile(
  dir: string,
  filename: string,
  body: string,
  opts: CommitFileOptions = {},
): Promise<string> {
  const fs = opts.fs ?? DEFAULT_FS;
  await writeFile(path.join(dir, filename), body);
  await git.add({ fs, dir, filepath: filename });
  return git.commit({
    fs,
    dir,
    message: opts.message ?? `add ${filename}`,
    author: opts.author ?? DEFAULT_TEST_AUTHOR,
  });
}
