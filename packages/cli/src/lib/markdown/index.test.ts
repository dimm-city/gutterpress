import { test, expect, afterEach } from "bun:test";
import { mkdtemp, writeFile, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveConfig } from "../manifest";
import { renderChaptersToFile } from "./index";

/**
 * ARCH finding #2 — integration test REQUIRED by the work package: a manifest
 * with no `styles:` plus `styles/book.css` on disk must link `book.css` in a
 * real build, exercising the EXACT call chain `renderBook()` in
 * build-runner.ts uses (`resolveConfig` -> `renderChaptersToFile` ->
 * `renderChapters` -> `resolveActiveStyles` -> `assembleBookHtml`'s `<link>`
 * emission) — no puppeteer/Chromium needed since this is the HTML-assembly
 * stage, not pagination/PDF.
 *
 * Before the fix, `DTRPG_PRESET.styles` (`["css/print.css"]`) made
 * `resolveConfig` return a non-empty `styles` array for EVERY styles:-less
 * manifest, so `resolveActiveStyles`'s fallback chain (styles/book.css ->
 * discovered CSS -> []) was dead code on this path — the book always linked
 * the phantom `css/print.css`, whether or not it existed on disk.
 */

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function makeProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pmd-styles-integration-"));
  dirs.push(dir);
  return dir;
}

test("styles:-less manifest + styles/book.css on disk links book.css in a real build (not the phantom css/print.css)", async () => {
  const dir = await makeProject();
  // No `styles:` key at all — the exact "hand-written manifest" / "adopted
  // folder" shape the finding calls out.
  await writeFile(join(dir, "manifest.yaml"), "title: No Styles Key\n", "utf8");
  await mkdir(join(dir, "styles"), { recursive: true });
  await writeFile(join(dir, "styles", "book.css"), ":root { --x: 1; }\n", "utf8");
  await writeFile(join(dir, "01.md"), "# Chapter One\n", "utf8");

  // The SAME two calls build-runner.ts's renderBook() makes: resolveConfig
  // to get the merged config, then renderChaptersToFile with config.styles.
  const manifest = { title: "No Styles Key" };
  const config = resolveConfig({}, manifest);
  const outDir = join(dir, "dist");
  const htmlFile = await renderChaptersToFile(dir, outDir, {
    title: config.title,
    styles: config.styles,
    files: config.source.files,
  });

  const html = await readFile(htmlFile, "utf8");
  expect(html).toContain('<link rel="stylesheet" href="styles/book.css">');
  expect(html).not.toContain("css/print.css");
});

test("styles:-less manifest with NO conventional stylesheet on disk emits no phantom <link> at all", async () => {
  const dir = await makeProject();
  await writeFile(join(dir, "manifest.yaml"), "title: No Styles At All\n", "utf8");
  await writeFile(join(dir, "01.md"), "# Chapter One\n", "utf8");

  const config = resolveConfig({}, { title: "No Styles At All" });
  const outDir = join(dir, "dist");
  const htmlFile = await renderChaptersToFile(dir, outDir, {
    title: config.title,
    styles: config.styles,
    files: config.source.files,
  });

  const html = await readFile(htmlFile, "utf8");
  expect(html).not.toContain("<link rel=\"stylesheet\"");
  expect(html).not.toContain("css/print.css");
});

test("an explicit manifest `styles:` list still wins over styles/book.css", async () => {
  const dir = await makeProject();
  await writeFile(
    join(dir, "manifest.yaml"),
    "title: Explicit\nstyles:\n  - my/custom.css\n",
    "utf8",
  );
  await mkdir(join(dir, "styles"), { recursive: true });
  await writeFile(join(dir, "styles", "book.css"), ":root{}", "utf8");
  await writeFile(join(dir, "01.md"), "# Chapter One\n", "utf8");

  const config = resolveConfig({}, { title: "Explicit", styles: ["my/custom.css"] });
  const outDir = join(dir, "dist");
  const htmlFile = await renderChaptersToFile(dir, outDir, {
    title: config.title,
    styles: config.styles,
    files: config.source.files,
  });

  const html = await readFile(htmlFile, "utf8");
  expect(html).toContain('<link rel="stylesheet" href="my/custom.css">');
  expect(html).not.toContain("styles/book.css");
});
