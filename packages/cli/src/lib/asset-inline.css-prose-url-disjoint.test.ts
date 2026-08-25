import { expect, test, afterEach } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { planImageCopies } from "./asset-inline.ts";
import { renderChapters } from "./markdown/index.ts";
import { makeTempDir } from "../test-helpers/testkit.ts";
import type { AssetCopy } from "./asset-inline.ts";

/**
 * THE INVARIANT: a CSS image URL and a prose image URL can never be the same
 * string.
 *
 * This is load-bearing for correctness, and it is the whole reason
 * `inlineOne` content-addresses every CSS image instead of keeping the
 * author's project-relative path for in-project ones.
 *
 * Chromium does not paint a `url()` image owned by an `@page` rule unless a
 * second, unconsumed reference to that exact URL exists — and an `<img src>`
 * to the same URL does not merely fail to protect it, it CONSUMES the
 * `<link rel="preload">` that would have (measured: `preload + <img>` issues
 * 2 tile requests, not 3, and the page box drops). So the moment a CSS URL
 * and a prose URL can coincide, an author writing `![](images/tile.png)` for
 * a file their stylesheet also uses as the page background silently loses the
 * background — 292 blank pages in a valid PDF, no error anywhere.
 *
 * Content-addressing makes that collision UNREPRESENTABLE rather than
 * detected: the hash is computed by the build, so nothing an author, a
 * plugin, or raw HTML can write is able to utter the CSS destination.
 *
 * WHY THIS TEST EXISTS AT ALL: the obvious, well-meant future change — "make
 * asset names friendlier, `images/tile.png` beats `assets/9f3c….png`" — would
 * retract the invariant silently, and nothing in the code says it is load
 * bearing. This test is the assertion such a refactor must consciously
 * delete. If you are reading it because it went red, do not relax it: the
 * background images in every book with a both-ways asset depend on it.
 */

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

/**
 * 513 KB of bytes. The size is not part of the invariant — every CSS image is
 * content-addressed now, whatever it weighs. It is here so this test is RED
 * against the code that had a 512 KB inline threshold: under that threshold a
 * CSS image became a `data:` URI and had no destination to collide with, so a
 * smaller fixture would have passed vacuously instead of showing the two
 * identical destinations the invariant forbids.
 */
const TILE_PNG = Buffer.alloc(512 * 1024 + 1, 7);

test("a CSS image URL and a prose image URL of the SAME file can never coincide", async () => {
  const dir = await makeTempDir("gp-css-prose-disjoint-");
  dirs.push(dir);
  await mkdir(path.join(dir, "images"), { recursive: true });
  await mkdir(path.join(dir, "styles"), { recursive: true });

  // ONE source file, referenced both ways — the shape that breaks the page box.
  await writeFile(path.join(dir, "images", "tile.png"), TILE_PNG);
  await writeFile(
    path.join(dir, "styles", "book.css"),
    `@page { size: 300px 400px; background: #fff url("../images/tile.png") repeat }`,
    "utf-8",
  );
  await writeFile(
    path.join(dir, "chapter-01.md"),
    "# Both ways\n\n![texture](images/tile.png)\n",
    "utf-8",
  );

  const cssCopies: AssetCopy[] = [];
  const imageRefs: string[] = [];
  const html = await renderChapters(dir, {
    styles: ["styles/book.css"],
    onCssAssets: (copies) => cssCopies.push(...copies),
    onImageRefs: (refs) => imageRefs.push(...refs),
  });

  // Both paths must actually have staged the file, or this test is vacuous.
  expect(cssCopies).toHaveLength(1);
  expect(imageRefs).toEqual(["images/tile.png"]);
  const prose = await planImageCopies(dir, imageRefs);
  const proseDest = prose.destinations.get("images/tile.png")!;
  expect(proseDest).toBeDefined();

  const cssDest = cssCopies[0]!.to;

  expect(cssDest).not.toBe(proseDest);
  // Said again as the property, not the instance: no destination is shared.
  expect(prose.copies.some((c) => c.to === cssDest)).toBe(false);

  // And the built document cannot name the CSS destination from an element —
  // which is what stops an `<img>` consuming the page background's preload.
  const srcs = [...html.matchAll(/\ssrc\s*=\s*"([^"]*)"/g)].map((m) => m[1]!);
  expect(srcs).toContain(proseDest);
  expect(srcs).not.toContain(cssDest);
}, 30_000);
