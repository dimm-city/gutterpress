/**
 * Unit tests for the shared CLI test-scaffolding kit.
 *
 * These lock the canonical behavior of the consolidated helpers that used to
 * be copy-pasted across ~17 (`makeCtx`) / ~13 (`makeTempDir`) test files. The
 * migration keeps the existing suite as the integration safety net; this file
 * is the focused unit net for the helpers themselves.
 */

import { describe, test, expect } from "bun:test";
import * as nodeFs from "node:fs";
import { readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import git from "isomorphic-git";

import {
  makeTempDir,
  makeCtx,
  makeTestRepo,
  initRepo,
  commitFile,
  DEFAULT_TEST_AUTHOR,
} from "./testkit";

describe("makeTempDir", () => {
  test("creates a real, unique directory under os.tmpdir()", async () => {
    const a = await makeTempDir();
    const b = await makeTempDir();
    try {
      expect(a.startsWith(tmpdir())).toBe(true);
      expect(a).not.toBe(b);
      expect((await stat(a)).isDirectory()).toBe(true);
    } finally {
      await rm(a, { recursive: true, force: true });
      await rm(b, { recursive: true, force: true });
    }
  });

  test("honors a caller-supplied prefix segment", async () => {
    const dir = await makeTempDir("kit-prefix-check-");
    try {
      expect(path.basename(dir).startsWith("kit-prefix-check-")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("makeCtx (CheckContext builder)", () => {
  test("supplies sane defaults", () => {
    const ctx = makeCtx();
    expect(ctx.inputDir).toBe("/tmp/test-input");
    expect(ctx.outputDir).toBe("/tmp/test-output");
    expect(ctx.config).toBeDefined();
    expect(ctx.pdfPath).toBeUndefined();
  });

  test("shallow-merges the partial override, last-write-wins", () => {
    const ctx = makeCtx({ pdfPath: "/tmp/book.pdf", inputDir: "/custom/in" });
    expect(ctx.pdfPath).toBe("/tmp/book.pdf");
    expect(ctx.inputDir).toBe("/custom/in");
    // untouched defaults survive
    expect(ctx.outputDir).toBe("/tmp/test-output");
  });
});

describe("git repo helpers", () => {
  test("initRepo makes a committed repo with a default author/branch", async () => {
    const dir = await makeTempDir("kit-initrepo-");
    try {
      const oid = await initRepo(dir);
      expect(typeof oid).toBe("string");
      const branch = await git.currentBranch({ fs: nodeFs, dir });
      expect(branch).toBe("main");
      const body = await readFile(path.join(dir, "chapter-01.md"), "utf8");
      expect(body).toContain("# Chapter One");
      const log = await git.log({ fs: nodeFs, dir });
      expect(log[0]?.commit.author.email).toBe(DEFAULT_TEST_AUTHOR.email);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("initRepo honors branch/content/message/author overrides", async () => {
    const dir = await makeTempDir("kit-initrepo-opts-");
    try {
      await initRepo(dir, {
        branch: "trunk",
        content: "# Chapter One\n\nOriginal.\n",
        message: "seed",
        author: { name: "X", email: "x@test.local" },
      });
      expect(await git.currentBranch({ fs: nodeFs, dir })).toBe("trunk");
      const body = await readFile(path.join(dir, "chapter-01.md"), "utf8");
      expect(body).toContain("Original.");
      const log = await git.log({ fs: nodeFs, dir });
      expect(log[0]?.commit.message).toBe("seed\n");
      expect(log[0]?.commit.author.email).toBe("x@test.local");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("makeTestRepo returns the initial commit oid", async () => {
    const dir = await makeTempDir("kit-maketestrepo-");
    try {
      const oid = await makeTestRepo(dir);
      expect(typeof oid).toBe("string");
      const body = await readFile(path.join(dir, "chapter-01.md"), "utf8");
      expect(body.length).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("commitFile writes, stages and commits a new file", async () => {
    const dir = await makeTempDir("kit-commitfile-");
    try {
      await initRepo(dir);
      const oid = await commitFile(dir, "chapter-02.md", "# Two\n");
      expect(typeof oid).toBe("string");
      const body = await readFile(path.join(dir, "chapter-02.md"), "utf8");
      expect(body).toBe("# Two\n");
      const log = await git.log({ fs: nodeFs, dir });
      expect(log[0]?.commit.message).toBe("add chapter-02.md\n");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
