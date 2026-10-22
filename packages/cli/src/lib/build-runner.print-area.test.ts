/**
 * A build writes the project's print area into its book.html, exactly as the
 * preview does: the `<meta name="gp-print-area">` comes from the markdown
 * assembly (lib/markdown/assemble.ts), so the compiler — and a published HTML
 * book's viewer — read the same numbers the preview's overlays read. Drives
 * the real stage-3 chain (`resolveBuildContext` -> `renderBook`); no Chromium.
 */
import { test, expect, afterEach } from "bun:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveBuildContext, renderBook } from "./build-runner.ts";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

test("renderBook writes the resolved print area into book.html", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gutterpress-build-print-area-"));
  dirs.push(dir);
  await writeFile(join(dir, "manifest.yaml"), "title: Print Area\npreset: dtrpg\n", "utf8");
  await writeFile(join(dir, "01.md"), "# Chapter One\n", "utf8");

  const ctx = await resolveBuildContext({ inputDir: dir, format: "html", outDir: join(dir, "dist"), rawArgs: {} });
  dirs.push(ctx.workDir);
  const html = await readFile(await renderBook(ctx), "utf8");

  const meta = html.match(/<meta name="gp-print-area" content='([^']*)'>/);
  expect(meta).not.toBeNull();
  expect(JSON.parse(meta![1]!.replace(/&#39;/g, "'").replace(/&amp;/g, "&"))).toMatchObject({
    width: 621,
    height: 810,
    bleed: 9,
    safe: 36,
    artSafe: 18,
    preset: "dtrpg",
  });
});

test("a manifest's page.gutter travels into book.html's print area beside the preset's own rules", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gutterpress-build-print-area-"));
  dirs.push(dir);
  await writeFile(join(dir, "manifest.yaml"), "title: Print Area\npreset: dtrpg\npage:\n  gutter: 54\n", "utf8");
  await writeFile(join(dir, "01.md"), "# Chapter One\n", "utf8");

  const ctx = await resolveBuildContext({ inputDir: dir, format: "html", outDir: join(dir, "dist"), rawArgs: {} });
  dirs.push(ctx.workDir);
  const html = await readFile(await renderBook(ctx), "utf8");

  const meta = html.match(/<meta name="gp-print-area" content='([^']*)'>/);
  expect(JSON.parse(meta![1]!.replace(/&#39;/g, "'").replace(/&amp;/g, "&"))).toMatchObject({
    safe: 36,
    artSafe: 18,
    gutter: 54,
  });
});
