import { test, expect, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { stageBookAssets } from "./build-staging.ts";

/**
 * `stageBookAssets` is THE asset-staging step — the real build and the
 * preview↔print parity gate both go through it, so the gate can never measure
 * a document a build would not have produced.
 *
 * That sharing is the point of these tests. The gate used to hand-roll its own
 * `copyFile` loop, which died with a raw `ENOENT` on the first stale image
 * path — so the one tool that enforces the project's preview↔print invariant
 * could not be pointed at a real book, which is exactly the state real books
 * are in. The build has always substituted a visible magenta placeholder
 * instead (missing-asset-placeholder.ts); staging must do that for every
 * caller, and must rewrite the reference too — a broken `<img>` lays out at a
 * different size than the placeholder, which would make the gate compare a
 * document neither renderer ships.
 */

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function book(html: string): Promise<{ renderDir: string; outDir: string; htmlFile: string }> {
  const renderDir = await mkdtemp(join(tmpdir(), "gutterpress-staging-src-"));
  const outDir = await mkdtemp(join(tmpdir(), "gutterpress-staging-out-"));
  dirs.push(renderDir, outDir);
  const htmlFile = join(outDir, "book.html");
  await writeFile(htmlFile, html, "utf8");
  return { renderDir, outDir, htmlFile };
}

test("a missing image stages a placeholder instead of throwing ENOENT", async () => {
  const { renderDir, outDir, htmlFile } = await book(
    `<html><body><img src="images/gone.png"></body></html>`,
  );

  const { missing } = await stageBookAssets({
    renderDir,
    outDir,
    htmlFile,
    imageRefs: ["images/gone.png"],
    cssAssets: [],
  });

  expect(missing).toEqual(["images/gone.png"]);
  const staged = await readFile(htmlFile, "utf8");
  // The reference now points at the placeholder, not the absent file: a
  // broken <img> would lay out at a different size than the PNG the PDF ships.
  const src = /<img src="([^"]+)">/.exec(staged)?.[1];
  expect(src).toMatch(/^assets\/gutterpress-missing\/[0-9a-f]{16}\.png$/);
  const png = await readFile(join(outDir, src!));
  expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
});

test("a present image is copied and its reference left alone", async () => {
  const { renderDir, outDir, htmlFile } = await book(
    `<html><body><img src="images/here.png"></body></html>`,
  );
  await mkdir(join(renderDir, "images"), { recursive: true });
  await writeFile(join(renderDir, "images/here.png"), "not-really-a-png");

  const { missing } = await stageBookAssets({
    renderDir,
    outDir,
    htmlFile,
    imageRefs: ["images/here.png"],
    cssAssets: [],
  });

  expect(missing).toEqual([]);
  expect(existsSync(join(outDir, "images/here.png"))).toBe(true);
  expect(await readFile(htmlFile, "utf8")).toContain('src="images/here.png"');
});

test("onPlan sees unresolved refs and can abort before anything is copied", async () => {
  const { renderDir, outDir, htmlFile } = await book(
    `<html><body><img src="/etc/passwd"><img src="images/here.png"></body></html>`,
  );
  await mkdir(join(renderDir, "images"), { recursive: true });
  await writeFile(join(renderDir, "images/here.png"), "not-really-a-png");

  // The build's policy: an image reference that names no in-project file is a
  // refusal to ship, raised BEFORE a single byte is copied. The gate's policy
  // is the opposite (report and measure anyway) — which is why the plan is
  // handed out rather than judged inside.
  let seen: { unresolved: string[]; copyCount: number } | undefined;
  await expect(
    stageBookAssets({
      renderDir,
      outDir,
      htmlFile,
      imageRefs: ["/etc/passwd", "images/here.png"],
      cssAssets: [],
      onPlan: (plan) => {
        seen = plan;
        throw new Error("refused");
      },
    }),
  ).rejects.toThrow("refused");

  expect(seen?.copyCount).toBe(1);
  expect(seen?.unresolved).toHaveLength(1);
  expect(seen!.unresolved[0]).toContain("/etc/passwd");
  expect(existsSync(join(outDir, "images/here.png"))).toBe(false);
});
