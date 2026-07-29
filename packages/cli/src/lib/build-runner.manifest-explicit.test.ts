/**
 * Regression test for ARCH finding #12 (PR #98, maintainer HIGH,
 * manifest.ts:36-50):
 *
 * "explicit missing manifests silently fall back to defaults. A typo in
 * --manifest can create output beneath a directory named after the missing
 * file."
 *
 * `resolveBuildContext` (Stage 1 — pure planning, no filesystem writes) is
 * where `opts.manifestPath` reaches `loadManifestWithPath` and where the
 * resulting `manifestDir` feeds `outDir` (see build-runner.output-dir.test.ts
 * for that half of the contract). This file pins the other half: an
 * explicit, nonexistent `--manifest` path must throw a `UsageError` here,
 * before `runBuild` ever creates `outDir`, and a build whose project scan finds
 * no manifest must fail with guidance instead of producing an empty book.
 */
import { test, expect, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveBuildContext, runBuild } from "./build-runner.ts";
import { UsageError } from "./cli-args.ts";

const dirsToClean: string[] = [];

afterEach(async () => {
  for (const d of dirsToClean.splice(0)) {
    await rm(d, { recursive: true, force: true });
  }
});

test("resolveBuildContext throws UsageError when --manifest points at a nonexistent path (typo repro)", async () => {
  const projA = await mkdtemp(join(tmpdir(), "gutterpress-proj-typo-manifest-"));
  dirsToClean.push(projA);

  const missingManifest = join(projA, "typo.yaml");

  await expect(
    resolveBuildContext({
      inputDir: projA,
      format: "html",
      manifestPath: missingManifest,
      rawArgs: {},
    })
  ).rejects.toThrow(UsageError);

  await expect(
    resolveBuildContext({
      inputDir: projA,
      format: "html",
      manifestPath: missingManifest,
      rawArgs: {},
    })
  ).rejects.toThrow(`manifest not found: ${missingManifest}`);
});

test("runBuild rejects with UsageError before creating any output directory when --manifest is a typo'd path", async () => {
  const projA = await mkdtemp(join(tmpdir(), "gutterpress-proj-typo-manifest-build-"));
  dirsToClean.push(projA);

  const missingManifest = join(projA, "typo.yaml");
  const outDir = join(projA, "dist");

  await expect(
    runBuild({
      inputDir: projA,
      format: "html",
      manifestPath: missingManifest,
      rawArgs: {},
    })
  ).rejects.toThrow(UsageError);

  // No output must be created — the maintainer's exact complaint was output
  // being written beneath a directory named after the missing manifest path.
  expect(await Bun.file(outDir).exists()).toBe(false);
});

test("resolveBuildContext rejects a build when project discovery finds no manifest", async () => {
  const projNoManifest = await mkdtemp(join(tmpdir(), "gutterpress-proj-no-manifest-"));
  dirsToClean.push(projNoManifest);

  await expect(
    resolveBuildContext({
      inputDir: projNoManifest,
      format: "html",
      rawArgs: {},
    })
  ).rejects.toThrow(UsageError);
  await expect(
    resolveBuildContext({
      inputDir: projNoManifest,
      format: "html",
      rawArgs: {},
    })
  ).rejects.toThrow(
    `No project manifest found in ${projNoManifest}`
  );
  await expect(
    resolveBuildContext({
      inputDir: projNoManifest,
      format: "html",
      rawArgs: {},
    })
  ).rejects.toThrow("gutterpress build <project-dir>");
});
