import { test, expect, afterEach } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  runBuild,
  resolveIccProfile,
  BuildError,
  type PdfRenderInput,
} from "./build-runner.ts";
import { getAssetPath } from "./embedded-assets.ts";

/**
 * Orchestration characterization tests for the runBuild decomposition
 * (P2 / runbuild-strategy). These lock the CURRENT observable behavior of the
 * full HTML build path and the extracted pure ICC-resolution helper, so the
 * god-function -> stages+strategies refactor is provably behavior-preserving.
 *
 * The HTML path runs with NO Chromium (the CI/dev box here resolves none), so
 * it exercises the runtime-pagination fallback (shipRuntimePaginatedHtml) end
 * to end: markdown -> book.html + index.html + fingerprint, and the returned
 * BuildRunnerResult shape.
 */

const dirsToClean: string[] = [];

afterEach(async () => {
  for (const d of dirsToClean.splice(0)) {
    await rm(d, { recursive: true, force: true });
  }
});

test("runBuild (html) writes book.html + index.html + fingerprint and returns the right shape", async () => {
  const inputDir = await mkdtemp(join(tmpdir(), "pmd-orch-in-"));
  const outDir = await mkdtemp(join(tmpdir(), "pmd-orch-out-"));
  dirsToClean.push(inputDir, outDir);

  await writeFile(
    join(inputDir, "chapter-01.md"),
    "# Hello\n\nA minimal chapter for the orchestration guard.\n",
    "utf-8"
  );

  const result = await runBuild({
    inputDir,
    format: "html",
    outDir,
    // html format ignores lint/validate gates entirely; pass them anyway to
    // prove the "flags ignored" path stays green.
    skipLint: true,
    skipPreValidate: true,
    rawArgs: {},
  });

  // Return shape: html has no PDF, a book.html htmlPath, and a fingerprint.
  expect(result.outDir).toBe(outDir);
  expect(result.pdfPath).toBeNull();
  expect(existsSync(result.htmlPath)).toBe(true);
  expect(result.htmlPath).toBe(join(outDir, "book.html"));
  expect(existsSync(result.fingerprintPath)).toBe(true);
  expect(result.fingerprintPath).toBe(join(outDir, "build-fingerprint.json"));

  // book.html carries the authored content.
  const book = await readFile(result.htmlPath, "utf-8");
  expect(book).toMatch(/Hello/);

  // A redirect index.html is written as the static-host entry point.
  const indexHtml = await readFile(join(outDir, "index.html"), "utf-8");
  expect(indexHtml).toMatch(/url=book\.html/);

  // The fingerprint records the build command.
  const fp = JSON.parse(await readFile(result.fingerprintPath, "utf-8"));
  expect(fp.command).toBe("build");
});

// resolveIccProfile is the pure ICC-candidate resolver extracted from the pdfx
// branch. It resolves relative paths against the manifest dir first, then cwd,
// falls back to the embedded default profile ONLY for the unspecified
// CGATS21_CRPC1.icc default, and throws a BuildError(exitCode 2) otherwise.
test("resolveIccProfile finds an absolute ICC that exists on disk", async () => {
  const embedded = await getAssetPath("profiles/CGATS21_CRPC1.icc");
  const resolved = await resolveIccProfile(embedded, "/nonexistent", embedded);
  expect(resolved).toBe(embedded);
});

test("resolveIccProfile resolves a relative path against the manifest dir", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pmd-icc-"));
  dirsToClean.push(dir);
  await mkdir(join(dir, "profiles"), { recursive: true });
  const iccOnDisk = join(dir, "profiles", "custom.icc");
  await writeFile(iccOnDisk, "fake-icc", "utf-8");

  const resolved = await resolveIccProfile("profiles/custom.icc", dir, undefined);
  expect(resolved).toBe(iccOnDisk);
});

test("resolveIccProfile falls back to the embedded default for the unspecified CGATS21 profile", async () => {
  // A relative default profile that resolves nowhere on disk (neither the
  // manifest dir nor cwd), no explicit --icc, and the default basename => the
  // embedded asset copy is used.
  const resolved = await resolveIccProfile(
    "pmd-no-such-dir/CGATS21_CRPC1.icc",
    "/nonexistent",
    undefined
  );
  const embedded = await getAssetPath("profiles/CGATS21_CRPC1.icc");
  expect(resolved).toBe(embedded);
});

test("resolveIccProfile throws BuildError(2) when the profile cannot be found", async () => {
  await expect(
    resolveIccProfile("profiles/missing.icc", "/nonexistent", undefined)
  ).rejects.toMatchObject({ name: "BuildError", exitCode: 2 });
  await expect(
    resolveIccProfile("profiles/missing.icc", "/nonexistent", undefined)
  ).rejects.toBeInstanceOf(BuildError);
});

// A no-op reference so the PdfRenderInput import is exercised (keeps the seam
// type visible to this suite even though the html path doesn't use a renderer).
const _rendererType: (i: PdfRenderInput) => void = () => {};
void _rendererType;
