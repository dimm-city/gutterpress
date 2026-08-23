import { test, expect, afterEach } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runBuild } from "./build-runner.ts";
import { resolveChromiumExecutable } from "./chromium.ts";

/**
 * Staging-hygiene guard (P2 / build-tmpdir-staging): a build must NOT leave a
 * `.gutterpress-stage*` scratch directory behind in the caller's cwd. runBuild is
 * exported and driven by the desktop host, so polluting/mutating cwd is a real
 * side effect and breaks concurrent builds.
 *
 * Drives the FULL native PDF path of runBuild against a real Chromium — the
 * native engine's compiler evaluates JS against a real DOM to fragment pages,
 * so (unlike the deleted Paged.js `pdfRenderer` seam) there is no trivial
 * in-process fake for it. Skipped when no Chromium is resolvable, same
 * pattern as the other Chromium-driven engine tests (e.g. nav-native.test.ts).
 */

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;
if (!chromium) {
  console.warn("[build-runner.staging.test] No Chromium resolved — skipping.");
}

const originalCwd = process.cwd();
const dirsToClean: string[] = [];

afterEach(async () => {
  process.chdir(originalCwd);
  for (const d of dirsToClean.splice(0)) {
    await rm(d, { recursive: true, force: true });
  }
});

testIf("runBuild (pdf) leaves no .gutterpress-stage* dir in cwd and still writes the PDF", async () => {
  // A source project with a single chapter.
  const inputDir = await mkdtemp(join(tmpdir(), "gutterpress-stage-input-"));
  const outDir = await mkdtemp(join(tmpdir(), "gutterpress-stage-out-"));
  // A pristine working directory we run the build FROM.
  const workCwd = await mkdtemp(join(tmpdir(), "gutterpress-stage-cwd-"));
  dirsToClean.push(inputDir, outDir, workCwd);

  await writeFile(
    join(inputDir, "chapter-01.md"),
    "# Hello\n\nA minimal chapter for the staging guard.\n",
    "utf-8"
  );
  await writeFile(join(inputDir, "manifest.yaml"), "title: Staging Guard\n", "utf-8");

  process.chdir(workCwd);

  const result = await runBuild({
    inputDir,
    format: "pdf",
    outDir,
    // Skip the lint / pre-build validation gates: they are unrelated to staging
    // and would spawn external probes. The staging code runs regardless.
    skipLint: true,
    skipPreValidate: true,
    rawArgs: {},
  });

  // The produced PDF is correct and lives at the reported path.
  expect(result.pdfPath).not.toBeNull();
  expect(existsSync(result.pdfPath!)).toBe(true);
  const bytes = await readFile(result.pdfPath!);
  expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");

  // No scratch staging directory leaked into the working directory.
  const leftover = (await readdir(workCwd)).filter((name) =>
    name.startsWith(".gutterpress-stage")
  );
  expect(leftover).toEqual([]);
}, 60_000);
// 60s: this drives the FULL native runBuild pipeline (staging, chapter
// render, a real Chromium PDF render, fingerprinting) — real disk/process/
// browser work, not a fixed-cost unit test. It ran at 30s until a release
// build timed out at exactly 30028ms on a GitHub runner: the same work takes
// ~1.5s locally, so the budget was sized on a warm local machine and left no
// room for a cold Chromium launch on a shared one. Worse, the timeout killed
// the pooled browser ("killed 1 dangling process") and the NEXT test failed
// in getBrowser() as collateral, which made one slow test look like two
// broken ones. 60s matches the sibling test below and every other
// Chromium-driving test in the repo.

testIf("runBuild prevalidation permits a missing image and paginates its placeholder", async () => {
  const inputDir = await mkdtemp(join(tmpdir(), "gutterpress-placeholder-prevalidate-in-"));
  const outDir = await mkdtemp(join(tmpdir(), "gutterpress-placeholder-prevalidate-out-"));
  dirsToClean.push(inputDir, outDir);

  await writeFile(
    join(inputDir, "chapter-01.md"),
    "# Placeholder Contract\n\n![Missing](images/does-not-exist.jpg)\n",
    "utf-8",
  );
  await writeFile(
    join(inputDir, "manifest.yaml"),
    "title: Placeholder Prevalidation\npreset: book\n",
    "utf-8",
  );

  const result = await runBuild({
    inputDir,
    format: "pdf",
    outDir,
    skipLint: true,
    // This is the contract under test: the ordinary pre-build validation gate
    // runs, reports the missing image as a warning, and does not abort before
    // the asset planner can create its visible fallback.
    skipPreValidate: false,
    skipPostValidate: true,
    rawArgs: {},
  });

  expect(result.pdfPath).not.toBeNull();
  const bytes = await readFile(result.pdfPath!);
  expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
}, 60_000);
