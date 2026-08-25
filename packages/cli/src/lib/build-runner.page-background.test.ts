import { expect, test, afterEach } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { runBuild } from "./build-runner.ts";
import { resolveChromiumExecutable } from "./chromium.ts";
import {
  makeTempDir,
  meanAbsDiff,
  pngRgb,
  rasterizePdfPage,
  resolveRasterizer,
} from "../test-helpers/testkit.ts";

/**
 * END TO END: an author's `@page { background: url(...) }` reaches the PDF.
 *
 * Chromium fetches an image referenced only from inside an `@page` rule and
 * then paints nothing — no error, no missing object, a perfectly valid PDF of
 * blank paper (docs/known-limitations.md §3, #152). `assemble.ts` therefore
 * emits a `<link rel="preload" as="image">` for every image the project's
 * stylesheets staged, which is the second reference Chromium needs.
 *
 * This test is deliberately the WHOLE product path — `runBuild`, a manifest, a
 * stylesheet, a real Chromium, a real PDF — because every unit-level fixture
 * that "verified" `@page { background }` for months passed regardless of the
 * bug. Nothing short of pixels off the finished PDF can tell the difference
 * between "painted" and "fetched and discarded".
 *
 * The measurement is a mean absolute per-pixel difference against the SAME
 * book with the declaration removed. `0` is the failure: it means the
 * declaration changed nothing at all.
 */

const chromium = await resolveChromiumExecutable();
const rasterizer = await resolveRasterizer();
const testIf = chromium && rasterizer ? test : test.skip;
if (!chromium || !rasterizer) {
  // eslint-disable-next-line no-console
  console.warn(
    `[build-runner.page-background.test] Skipping — ${!chromium ? "no Chromium resolved" : "no Ghostscript resolved"}. This suite needs both.`,
  );
}

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

/**
 * 448x448 of deterministic noise. Noise because it must not deflate: the
 * staged file has to be genuinely over the 512 KB that used to decide whether
 * a CSS image was inlined as a `data:` URI (immune to the bug) or copied
 * (exposed to it). This is the exposed side, and it is the side real books
 * are on — a full-bleed page texture is never 200 KB.
 */
function heavyTexture(): Buffer {
  let seed = 0x2f6e2b1;
  const next = (): number => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) & 0xff;
  };
  return pngRgb(448, 448, () => [next(), next(), next()]);
}

/** A one-chapter book; `pageBackground` is the only difference between runs. */
async function makeBook(pageBackground: string): Promise<string> {
  const dir = await makeTempDir("gp-page-bg-e2e-");
  dirs.push(dir);
  await mkdir(path.join(dir, "images"), { recursive: true });
  await mkdir(path.join(dir, "styles"), { recursive: true });
  await writeFile(path.join(dir, "images", "texture.png"), heavyTexture());
  await writeFile(
    path.join(dir, "styles", "book.css"),
    `@page { size: 5in 3in; margin: 0.4in;${pageBackground} }\nbody { font: 12pt/1.4 serif }\n`,
    "utf-8",
  );
  await writeFile(path.join(dir, "chapter-01.md"), "# Paper\n\nOne page of text.\n", "utf-8");
  await writeFile(
    path.join(dir, "manifest.yaml"),
    "title: Page Background\nstyles:\n  - styles/book.css\n",
    "utf-8",
  );
  return dir;
}

async function buildToPdf(inputDir: string, tag: string): Promise<string> {
  const outDir = await makeTempDir(`gp-page-bg-out-${tag}-`);
  dirs.push(outDir);
  const result = await runBuild({
    inputDir,
    format: "pdf",
    outDir,
    skipLint: true,
    skipPreValidate: true,
    rawArgs: {},
  });
  expect(result.pdfPath).not.toBeNull();
  return result.pdfPath!;
}

testIf(
  "a book's @page background image reaches the printed PDF",
  async () => {
    const work = await makeTempDir("gp-page-bg-raster-");
    dirs.push(work);

    const withBg = await buildToPdf(
      await makeBook(` background: #ffffff url("../images/texture.png") repeat;`),
      "with",
    );
    const without = await buildToPdf(await makeBook(""), "without");

    const diff = meanAbsDiff(
      rasterizePdfPage(rasterizer!, withBg, work, "with"),
      rasterizePdfPage(rasterizer!, without, work, "without"),
    );

    expect(
      diff,
      `The @page background image printed NOTHING (mean-abs-diff ${diff.toFixed(4)} against the same book with the declaration removed). Chromium discards an image referenced only from inside an @page rule; the fix is the <link rel="preload" as="image"> assemble.ts emits for every staged CSS image.`,
    ).toBeGreaterThan(1);
  },
  240_000,
);
