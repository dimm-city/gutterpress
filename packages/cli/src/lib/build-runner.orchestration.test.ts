import { test, expect, afterEach } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  runBuild,
  resolveIccProfile,
  BuildError,
} from "./build-runner.ts";
import { getAssetPath } from "./embedded-assets.ts";
import { shipViewerHtml } from "./build-staging.ts";

/**
 * Orchestration characterization tests for the runBuild decomposition
 * (P2 / runbuild-strategy). These lock the CURRENT observable behavior of the
 * full HTML build path and the extracted pure ICC-resolution helper, so the
 * god-function -> stages+strategies refactor is provably behavior-preserving.
 *
 * The HTML build assertion exercises runtime pagination
 * (shipRuntimePaginatedHtml): markdown -> book.html + index.html + fingerprint,
 * and the returned BuildRunnerResult shape.
 *
 * It is deliberately UNGATED. It used to be wrapped in
 * `chromium ? test.skip : test` — inverted, so it ran only when Chromium was
 * ABSENT — on the theory that `--format html` paginates in Chromium when one
 * is available. That theory was wrong: `rendersInPooledChromium()`
 * (build-preflight.ts) is `format !== "html" && !opts.engineBrowser`, so an
 * html build never touches Chromium at all. CI's Test job always resolves a
 * Chromium, so the gate skipped these 14 assertions on every CI run —
 * including the check that published output ships neither the galley nor the
 * edit bundle — while the suite still reported green. (The comment also cited
 * a `pagination.test.ts` that does not exist.)
 */

const dirsToClean: string[] = [];

afterEach(async () => {
  for (const d of dirsToClean.splice(0)) {
    await rm(d, { recursive: true, force: true });
  }
});

test("runBuild (html) writes book.html + index.html + fingerprint and returns the right shape", async () => {
  const inputDir = await mkdtemp(join(tmpdir(), "gutterpress-orch-in-"));
  const outDir = await mkdtemp(join(tmpdir(), "gutterpress-orch-out-"));
  dirsToClean.push(inputDir, outDir);

  await writeFile(
    join(inputDir, "chapter-01.md"),
    "# Hello\n\nA minimal chapter for the orchestration guard.\n",
    "utf-8"
  );
  await writeFile(join(inputDir, "manifest.yaml"), "title: Orchestration Guard\n", "utf-8");

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
  // Both are non-null here because a conventional project build PUBLISHES them;
  // only a one-file delivery (--out x.pdf) reports them as absent.
  expect(result.outDir).toBe(outDir);
  expect(result.pdfPath).toBeNull();
  expect(result.htmlPath).not.toBeNull();
  expect(result.fingerprintPath).not.toBeNull();
  const htmlPath = result.htmlPath!;
  const fingerprintPath = result.fingerprintPath!;
  expect(existsSync(htmlPath)).toBe(true);
  expect(htmlPath).toBe(join(outDir, "book.html"));
  expect(existsSync(fingerprintPath)).toBe(true);
  expect(fingerprintPath).toBe(join(outDir, "build-fingerprint.json"));

  // book.html carries the authored content.
  const book = await readFile(htmlPath, "utf-8");
  expect(book).toMatch(/Hello/);

  // Published output carries the viewer bundle and NO editing code — neither
  // the deleted inline-edit module nor the preview-only galley editor bundle
  // (belt and braces: the strings must not appear at all).
  expect(book).toContain("engine/gutterpress-viewer.js");
  expect(book).not.toContain("gutterpress-edit.js");
  expect(book).not.toContain("gutterpress-galley.js");

  // A redirect index.html is written as the static-host entry point.
  const indexHtml = await readFile(join(outDir, "index.html"), "utf-8");
  expect(indexHtml).toMatch(/url=book\.html/);

  // The fingerprint records the build command.
  const fp = JSON.parse(await readFile(fingerprintPath, "utf-8"));
  expect(fp.command).toBe("build");
}, 30_000); // A cold full build (markdown render + asset copy + fingerprint) can
// sit near bun's default 5s timeout on a slow runner; give it comfortable head-room.

// The published-output injector itself (always runs, Chromium or not): it
// ships exactly the viewer bundle — no gutterpress-edit.js, no
// gutterpress-galley.js. Editing code is preview-only by construction
// (injectPreviewScripts); a published book must never carry it.
test("shipViewerHtml injects only the viewer bundle — no edit or galley code", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gutterpress-ship-viewer-"));
  dirsToClean.push(dir);
  const htmlFile = join(dir, "book.html");
  await writeFile(htmlFile, "<!doctype html><html><head><title>t</title></head><body></body></html>", "utf-8");

  await shipViewerHtml(htmlFile, dir);

  const book = await readFile(htmlFile, "utf-8");
  expect(book).toContain('<script src="engine/gutterpress-viewer.js"></script>');
  expect(book).not.toContain("gutterpress-edit.js");
  expect(book).not.toContain("gutterpress-galley.js");
  expect(existsSync(join(dir, "engine", "gutterpress-viewer.js"))).toBe(true);
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
  const dir = await mkdtemp(join(tmpdir(), "gutterpress-icc-"));
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
    "gutterpress-no-such-dir/CGATS21_CRPC1.icc",
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
