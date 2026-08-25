/**
 * ARCH finding #4 — build-log surfacing.
 *
 * `markers.js` computes typed, line-numbered author-mistake warnings
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
import { mkdir, mkdtemp, readFile, readdir, writeFile, rm } from "node:fs/promises";
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
  const dir = await mkdtemp(join(tmpdir(), "gutterpress-build-warnings-"));
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
  dirs.push(ctx.workDir);
  const htmlFile = await renderBook(ctx);

  expect(htmlFile).toContain("book.html");

  const warnLines = (warnSpy!.mock.calls as unknown[][]).map((call) => String(call[0]));
  const match = warnLines.find(
    (line) => line.includes("01.md") && line.includes("line 3") && line.includes("@continue")
  );
  expect(match).toBeDefined();
});

test("renderBook logs no layout-marker warning for a chapter with no marker mistakes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gutterpress-build-nowarnings-"));
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
  dirs.push(ctx.workDir);
  await renderBook(ctx);

  // The default preset's conventional-but-absent asset dirs (css/fonts/images)
  // legitimately warn here too (unrelated pre-existing behavior) — assert
  // specifically that NO warning is shaped like a layout-marker warning
  // (references "01.md" + a line number), not that the log is silent.
  const warnLines = (warnSpy!.mock.calls as unknown[][]).map((call) => String(call[0]));
  const layoutWarning = warnLines.find((line) => line.includes("01.md") && line.includes("line"));
  expect(layoutWarning).toBeUndefined();
});

test("renderBook does not duplicate marker findings already emitted by prevalidation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gutterpress-build-prevalidated-warnings-"));
  dirs.push(dir);

  await writeFile(join(dir, "manifest.yaml"), "title: Prevalidated\npreset: book\n", "utf8");
  await writeFile(join(dir, "01.md"), "# Chapter One\n\n@continue\n\nText.\n", "utf8");

  resetWarnOnce();
  warnSpy = spyOn(console, "warn").mockImplementation(() => {});

  const ctx = await resolveBuildContext({
    inputDir: dir,
    format: "html",
    outDir: join(dir, "dist"),
    rawArgs: {},
  });
  dirs.push(ctx.workDir);
  // runBuild reaches renderBook with the exact findings its prevalidation pass
  // printed. HTML normally has no gates, so seed that report-derived key here
  // to isolate the render-time dedupe branch.
  ctx.prevalidatedLayoutWarningKeys.add(
    `${join(dir, "01.md")}\0${3}\0@continue used without an open @section; ignoring marker.`,
  );
  await renderBook(ctx);

  const warnLines = (warnSpy!.mock.calls as unknown[][]).map((call) => String(call[0]));
  expect(warnLines.some((line) => line.includes("01.md") && line.includes("line 3"))).toBe(false);
});

test("renderBook keeps a legitimate warning when prevalidation did not report that exact finding", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gutterpress-build-unreported-warning-"));
  dirs.push(dir);
  await writeFile(join(dir, "manifest.yaml"), "title: Unreported\npreset: book\n", "utf8");
  await writeFile(join(dir, "01.md"), "# Chapter One\n\n@continue\n\nText.\n", "utf8");

  resetWarnOnce();
  warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  const ctx = await resolveBuildContext({
    inputDir: dir,
    format: "html",
    outDir: join(dir, "dist"),
    rawArgs: {},
  });
  dirs.push(ctx.workDir);
  ctx.gates.preValidate = true;
  await renderBook(ctx);

  const warnLines = (warnSpy!.mock.calls as unknown[][]).map((call) => String(call[0]));
  expect(warnLines.some((line) => line.includes("01.md") && line.includes("line 3"))).toBe(true);
});

test("renderBook stages a missing non-PNG image at a PNG path and rewrites the rendered src", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gutterpress-build-placeholder-path-"));
  dirs.push(dir);

  await writeFile(join(dir, "manifest.yaml"), "title: Placeholder\npreset: book\n", "utf8");
  await writeFile(
    join(dir, "01.md"),
    "# Chapter One\n\n![Missing art](images/does-not-exist.jpg){.gp-shape}\n",
    "utf8",
  );

  resetWarnOnce();
  warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  const ctx = await resolveBuildContext({
    inputDir: dir,
    format: "html",
    outDir: join(dir, "dist"),
    rawArgs: {},
  });
  dirs.push(ctx.workDir);
  const htmlFile = await renderBook(ctx);
  const html = await readFile(htmlFile, "utf8");

  const src = /<img\b[^>]*\bsrc="([^"]+)"/.exec(html)?.[1];
  expect(src).toMatch(/^assets\/gutterpress-missing\/[a-f0-9]{16}\.png$/);
  expect(html).not.toContain(`src="images/does-not-exist.jpg"`);
  // The gp-shape mirror is inlined only after it has been redirected to the
  // generated PNG, proving that path is decodable and actually readable.
  expect(html).toContain("--gp-shape:url(&quot;data:image/png;base64,");

  const placeholder = await readFile(join(ctx.workDir, src!));
  expect([...placeholder.subarray(0, 8)]).toEqual([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  expect(await readdir(join(ctx.workDir, "images"))).toEqual([]);

  const warnLines = (warnSpy!.mock.calls as unknown[][]).map((call) => String(call[0]));
  expect(warnLines.some((line) => line.includes("missing: images/does-not-exist.jpg"))).toBe(true);
});

test("renderBook keeps srcset data payloads and comma-bearing local URLs out of placeholders", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gutterpress-build-srcset-commas-"));
  dirs.push(dir);
  await writeFile(join(dir, "manifest.yaml"), "title: Srcset Commas\npreset: book\n", "utf8");
  await mkdir(join(dir, "images"), { recursive: true });
  await writeFile(join(dir, "images", "actual,comma.png"), "comma asset", "utf8");
  await writeFile(join(dir, "images", "fallback.png"), "fallback asset", "utf8");
  const dataUrl = "data:image/svg+xml,%3Csvg%3E%3C/svg%3E";
  const remoteCandidates = [
    "ftp://example.com/art.png 3x",
    "blob:https://example.com/id 4x",
    "mailto:art@example.com 5x",
    "?image=1 6x",
  ].join(", ");
  await writeFile(
    join(dir, "01.md"),
    `<picture><source srcset="${dataUrl} 1x, images/actual,comma.png 2x, ${remoteCandidates}"><img src="images/fallback.png"></picture>\n`,
    "utf8",
  );

  const ctx = await resolveBuildContext({
    inputDir: dir,
    format: "html",
    outDir: join(dir, "dist"),
    rawArgs: {},
  });
  dirs.push(ctx.workDir);
  const html = await readFile(await renderBook(ctx), "utf8");

  expect(html).toContain(
    `${dataUrl} 1x, images/actual,comma.png 2x, ${remoteCandidates}`,
  );
  expect(await readFile(join(ctx.workDir, "images", "actual,comma.png"), "utf8")).toBe(
    "comma asset",
  );
  expect(await readFile(join(ctx.workDir, "images", "fallback.png"), "utf8")).toBe(
    "fallback asset",
  );
  expect(
    await readdir(join(ctx.workDir, "assets", "gutterpress-missing")).catch(() => []),
  ).toEqual([]);
});
