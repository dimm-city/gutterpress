/**
 * ARCH finding #4 — build-log surfacing.
 *
 * `markdown-it-paged` computes typed, line-numbered author-mistake warnings
 * (`env.layoutWarnings`) — e.g. a stray `@continue` with no open `@section`.
 * Before this fix, `renderBook` (build-runner.ts stage 3) called
 * `renderChaptersToFile` with no way to observe those warnings, so a marker
 * mistake produced ZERO output anywhere in the build log: the author got no
 * signal their layout marker was silently ignored. This test drives the REAL
 * stage-3 function (`resolveBuildContext` -> `renderBook`, the exact call
 * chain `runBuild` uses) against a fixture chapter with a deliberate marker
 * mistake and asserts the build log prints a clearly attributed warning
 * naming the file, the line, and the message.
 */
import { test, expect, spyOn, afterEach } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveBuildContext, renderBook } from "./build-runner.ts";
import { resetWarnOnce } from "./presets.ts";

let warnSpy: ReturnType<typeof spyOn> | undefined;
const dirs: string[] = [];

afterEach(async () => {
  warnSpy?.mockRestore();
  warnSpy = undefined;
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

test("renderBook logs a clearly attributed warning for a chapter with a marker mistake", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pmd-build-warnings-"));
  dirs.push(dir);

  // Explicit preset so this test's console.warn spy only ever captures the
  // layout warning under test, not the unrelated "no preset set" notice
  // (which is itself a one-shot, process-wide dedup — see presets.ts).
  await writeFile(join(dir, "manifest.yaml"), "title: Warning Test\npreset: book\n", "utf8");
  // A deliberate marker mistake: @continue with no open @section.
  await writeFile(
    join(dir, "01.md"),
    "# Chapter One\n\n@continue\n\nOrphaned continuation text.\n",
    "utf8"
  );

  resetWarnOnce();
  warnSpy = spyOn(console, "warn").mockImplementation(() => {});

  const ctx = await resolveBuildContext({
    inputDir: dir,
    format: "html",
    outDir: join(dir, "dist"),
    rawArgs: {},
  });
  const { htmlFile } = await renderBook(ctx);

  expect(htmlFile).toContain("book.html");

  const warnLines = (warnSpy!.mock.calls as unknown[][]).map((call) => String(call[0]));
  const match = warnLines.find(
    (line) => line.includes("01.md") && line.includes("line 3") && line.includes("@continue")
  );
  expect(match).toBeDefined();
});

test("renderBook logs no layout-marker warning for a chapter with no marker mistakes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pmd-build-nowarnings-"));
  dirs.push(dir);

  await writeFile(join(dir, "manifest.yaml"), "title: Clean\npreset: book\n", "utf8");
  await writeFile(join(dir, "01.md"), "# Chapter One\n\nJust prose.\n", "utf8");

  resetWarnOnce();
  warnSpy = spyOn(console, "warn").mockImplementation(() => {});

  const ctx = await resolveBuildContext({
    inputDir: dir,
    format: "html",
    outDir: join(dir, "dist"),
    rawArgs: {},
  });
  await renderBook(ctx);

  // The default preset's conventional-but-absent asset dirs (css/fonts/images)
  // legitimately warn here too (unrelated pre-existing behavior) — assert
  // specifically that NO warning is shaped like a layout-marker warning
  // (references "01.md" + a line number), not that the log is silent.
  const warnLines = (warnSpy!.mock.calls as unknown[][]).map((call) => String(call[0]));
  const layoutWarning = warnLines.find((line) => line.includes("01.md") && line.includes("line"));
  expect(layoutWarning).toBeUndefined();
});
