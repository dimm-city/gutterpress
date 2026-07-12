import { test, expect, afterEach } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runBuild } from "./build-runner.ts";
import type { PdfRenderInput } from "./pagination.ts";

/**
 * Staging-hygiene guard (P2 / build-tmpdir-staging): a build must NOT leave a
 * `.print-md-stage*` scratch directory behind in the caller's cwd. runBuild is
 * exported and driven by the viewer host, so polluting/mutating cwd is a real
 * side effect and breaks concurrent builds.
 *
 * Drives the FULL PDF path of runBuild via an injected `pdfRenderer` — the same
 * seam the Electron viewer uses. Injecting a renderer also skips the Chromium
 * preflight, so this runs with no browser installed. The fake renderer writes a
 * minimal valid PDF so the rest of the pipeline (stamp, fingerprint) runs to
 * completion exactly as production would.
 */

// A minimal but structurally valid PDF so pdf-lib's /Creator stamp loads it
// cleanly (mirrors what a real renderer would emit closely enough).
const MINIMAL_PDF =
  "%PDF-1.4\n" +
  "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
  "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
  "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n" +
  "xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n" +
  "0000000052 00000 n \n0000000101 00000 n \n" +
  "trailer<</Size 4/Root 1 0 R>>\nstartxref\n170\n%%EOF\n";

const fakeRenderer = async ({ outPdf }: PdfRenderInput): Promise<void> => {
  await writeFile(outPdf, MINIMAL_PDF, "latin1");
};

const originalCwd = process.cwd();
const dirsToClean: string[] = [];

afterEach(async () => {
  process.chdir(originalCwd);
  for (const d of dirsToClean.splice(0)) {
    await rm(d, { recursive: true, force: true });
  }
});

test("runBuild (pdf) leaves no .print-md-stage* dir in cwd and still writes the PDF", async () => {
  // A source project with a single chapter.
  const inputDir = await mkdtemp(join(tmpdir(), "pmd-stage-input-"));
  const outDir = await mkdtemp(join(tmpdir(), "pmd-stage-out-"));
  // A pristine working directory we run the build FROM.
  const workCwd = await mkdtemp(join(tmpdir(), "pmd-stage-cwd-"));
  dirsToClean.push(inputDir, outDir, workCwd);

  await writeFile(
    join(inputDir, "chapter-01.md"),
    "# Hello\n\nA minimal chapter for the staging guard.\n",
    "utf-8"
  );

  process.chdir(workCwd);

  const result = await runBuild({
    inputDir,
    format: "pdf",
    outDir,
    // Skip the lint / pre-build validation gates: they are unrelated to staging
    // and would spawn external probes. The staging code runs regardless.
    skipLint: true,
    skipPreValidate: true,
    // Injected renderer => full PDF pipeline with no Chromium + no preflight.
    pdfRenderer: fakeRenderer,
    rawArgs: {},
  });

  // The produced PDF is correct and lives at the reported path.
  expect(result.pdfPath).not.toBeNull();
  expect(existsSync(result.pdfPath!)).toBe(true);
  const bytes = await readFile(result.pdfPath!);
  expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");

  // No scratch staging directory leaked into the working directory.
  const leftover = (await readdir(workCwd)).filter((name) =>
    name.startsWith(".print-md-stage")
  );
  expect(leftover).toEqual([]);
});
