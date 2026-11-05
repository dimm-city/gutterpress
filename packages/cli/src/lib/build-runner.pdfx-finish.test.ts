/**
 * The pdfx tail of `runBuild` (`PdfOutput.finish`), end to end. It needs
 * Chromium, Ghostscript and qpdf, like the flatten integration tests, and is
 * skipped without them.
 *
 * The post-build gate must validate the manifest the build loaded (#496).
 * With no `--manifest` it used to look for one in the working directory —
 * none, for a CLI run from outside the book — and validated an empty
 * manifest's defaults, announcing that a book with `preset: dtrpg` had no
 * preset.
 */
import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveChromiumExecutable } from "./chromium";
import { resolveGhostscript } from "./ghostscript";
import { isToolAvailable } from "./tool-probe";
import { resetWarnOnce } from "./presets";
import { runBuild } from "./build-runner";

const tools =
  (await resolveChromiumExecutable()) && (await resolveGhostscript()) && (await isToolAvailable("qpdf"));
const testIf = tools ? test : test.skip;

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

testIf(
  "the post-build gate validates the manifest the build loaded",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "gutterpress-pdfx-finish-"));
    dirs.push(dir);
    await writeFile(join(dir, "manifest.yaml"), "title: Finish\nauthors: [F]\npreset: dtrpg\n", "utf8");
    await writeFile(join(dir, "book.md"), "# Finish\n\nOne page of text.\n", "utf8");

    // The notice prints once per process; an earlier run must not hide it here.
    resetWarnOnce();
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    let warnings: string[] = [];
    try {
      await runBuild({
        inputDir: dir,
        format: "pdfx",
        outDir: join(dir, "out"),
        skipLint: true,
        skipPreValidate: true,
        rawArgs: {},
      });
      warnings = warn.mock.calls.map((c) => String(c[0]));
    } finally {
      warn.mockRestore();
    }
    expect(warnings.filter((w) => w.includes("No `preset` in manifest.yaml"))).toEqual([]);
  },
  120_000
);
