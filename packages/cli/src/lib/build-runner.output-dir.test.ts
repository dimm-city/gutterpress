/**
 * Regression test for maintainer P1 (PR #98, build-runner.ts:139/167):
 *
 * "The guide says `gutterpress build ./my-book` writes dist next to the
 * project, but this function resolves dist against the command CWD. I
 * scaffolded four projects and built them by absolute input path from the
 * repository; all wrote to one repository dist/book.html and overwrote one
 * another."
 *
 * `resolveBuildContext` (Stage 1 — pure planning, no filesystem writes) is
 * the exact function that picked `outDir`, so it is unit-testable in
 * isolation without touching Chromium/pagination. When `opts.outDir` is NOT
 * set (no explicit `--out`), `config.output.dir` (default "dist", or
 * whatever the manifest sets) must resolve against `manifestDir` — the
 * project being built — not against `process.cwd()`. An explicit `--out`
 * (already resolved by `splitOutPath` before it reaches here) must be
 * preserved exactly, with no additional resolution against manifestDir.
 */
import { test, expect, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveBuildContext } from "./build-runner.ts";

const originalCwd = process.cwd();
const dirsToClean: string[] = [];

afterEach(async () => {
  process.chdir(originalCwd);
  for (const d of dirsToClean.splice(0)) {
    await rm(d, { recursive: true, force: true });
  }
});

test("resolveBuildContext resolves the conventional output dir against the project's manifestDir, not the CWD (cross-project dist collision)", async () => {
  // Two separate scaffolded projects, at different absolute paths.
  const projA = await mkdtemp(join(tmpdir(), "gutterpress-proj-a-"));
  const projB = await mkdtemp(join(tmpdir(), "gutterpress-proj-b-"));
  // A third, unrelated CWD the "repository" build is invoked from — mirrors
  // the maintainer's repro of building by absolute input path from the repo
  // root while neither project's dist lived under that repo.
  const repoCwd = await mkdtemp(join(tmpdir(), "gutterpress-repo-cwd-"));
  dirsToClean.push(projA, projB, repoCwd);
  await Bun.write(join(projA, "manifest.yaml"), "title: Project A\n");
  await Bun.write(join(projB, "manifest.yaml"), "title: Project B\n");

  process.chdir(repoCwd);

  const ctxA = await resolveBuildContext({
    inputDir: projA,
    format: "html",
    rawArgs: {},
  });
  const ctxB = await resolveBuildContext({
    inputDir: projB,
    format: "html",
    rawArgs: {},
  });

  // Each project's output must land in ITS OWN <projectDir>/dist ...
  expect(ctxA.outDir).toBe(join(projA, "dist", "project-a"));
  expect(ctxB.outDir).toBe(join(projB, "dist", "project-b"));
  // ... not collide on a shared directory (the bug: both used to resolve to
  // <repoCwd>/dist and therefore to each other).
  expect(ctxA.outDir).not.toBe(ctxB.outDir);
  expect(ctxA.outDir).not.toBe(join(repoCwd, "dist", "project-a"));
  expect(ctxB.outDir).not.toBe(join(repoCwd, "dist", "project-b"));
});

test("resolveBuildContext preserves an explicit --out exactly (no re-resolution against manifestDir or CWD)", async () => {
  const projA = await mkdtemp(join(tmpdir(), "gutterpress-proj-explicit-"));
  const repoCwd = await mkdtemp(join(tmpdir(), "gutterpress-repo-cwd2-"));
  dirsToClean.push(projA, repoCwd);
  await Bun.write(join(projA, "manifest.yaml"), "title: Project A\n");

  process.chdir(repoCwd);

  // Mirrors what commands/build.ts passes: splitOutPath already resolved
  // --out to an absolute path against the CWD at parse time, before
  // resolveBuildContext ever sees it.
  const explicitOut = join(repoCwd, "custom-out");

  const ctx = await resolveBuildContext({
    inputDir: projA,
    format: "html",
    outDir: explicitOut,
    rawArgs: {},
  });

  expect(ctx.outDir).toBe(explicitOut);
});

test("two books anchored in ONE tree get separate output dirs with no configuration", async () => {
  // The case a single shared `dist` could never handle however `output.dir` was
  // configured — and the reason the field is gone rather than re-tuned.
  const tree = await mkdtemp(join(tmpdir(), "gutterpress-multi-book-"));
  const repoCwd = await mkdtemp(join(tmpdir(), "gutterpress-repo-cwd3-"));
  dirsToClean.push(tree, repoCwd);
  await Bun.write(join(tree, "book-01", "manifest.yaml"), "title: Dragon Heist\n");
  await Bun.write(join(tree, "book-02", "manifest.yaml"), "title: Design Guide\n");

  process.chdir(repoCwd);

  const one = await resolveBuildContext({
    inputDir: join(tree, "book-01"),
    format: "html",
    rawArgs: {},
  });
  const two = await resolveBuildContext({
    inputDir: join(tree, "book-02"),
    format: "html",
    rawArgs: {},
  });

  expect(one.outDir).toBe(join(tree, "book-01", "dist", "dragon-heist"));
  expect(two.outDir).toBe(join(tree, "book-02", "dist", "design-guide"));
  expect(one.outDir).not.toBe(two.outDir);
});

test("a manifest still carrying the removed `output` block fails loudly", async () => {
  const proj = await mkdtemp(join(tmpdir(), "gutterpress-proj-legacy-"));
  dirsToClean.push(proj);
  await Bun.write(join(proj, "manifest.yaml"), "title: Legacy\noutput:\n  dir: build\n");

  await expect(
    resolveBuildContext({ inputDir: proj, format: "html", rawArgs: {} })
  ).rejects.toThrow(/`output`/);
});
