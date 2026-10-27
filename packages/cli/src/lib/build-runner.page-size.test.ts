/**
 * END TO END: the manifest's page size is what a book prints at, whatever
 * its stylesheets say.
 *
 * `page.width` x `page.height` — the preset's, or the manifest's — is what
 * every check and the preview's print overlays judge against, and Chromium
 * prints the `@page { size }` it is given. A book whose author wrote
 * `@page { margin }` alone, or had no stylesheet at all, set none, so it
 * printed at Letter (612x792) while `pdf.print.page-size` expected 621x810
 * (#415); a look that set its own `size` shadowed the manifest. The markdown
 * assembly writes the manifest's size after every stylesheet
 * (lib/markdown/assemble.ts), so the manifest wins in every case below.
 *
 * This drives the WHOLE product path — `runBuild`, a manifest, a stylesheet,
 * a real Chromium, a real PDF — because the gap was between the pieces: the
 * config, the assembly and the check were each right on their own. Skipped
 * without a Chromium the engine accepts (`CHROMIUM_PATH` or a standard install).
 */
import { afterEach, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { runBuild } from "./build-runner.ts";
import { resolveChromiumExecutable } from "./chromium.ts";
import { getPageSize, loadPdf } from "./pdf-inspect.ts";
import { makeTempDir } from "../test-helpers/testkit.ts";

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;
if (!chromium) {
  // eslint-disable-next-line no-console
  console.warn(
    "[build-runner.page-size.test] No Chromium resolved — skipping. Install Chrome/Chromium or set CHROMIUM_PATH to run it.",
  );
}

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

/** The dtrpg preset's sheet: 8.625 x 11.25in, the trim plus its bleed. */
const DTRPG = { w: 621, h: 810 };
/**
 * A one-chapter `dtrpg` book. `css` is the book's one stylesheet (none when
 * null); `lookCss` adds a look extension whose only sheet holds it.
 */
async function makeBook(css: string | null, lookCss?: string): Promise<string> {
  const dir = await makeTempDir("gp-page-size-e2e-");
  dirs.push(dir);
  await writeFile(path.join(dir, "01.md"), "# Chapter One\n\nSome text on the page.\n", "utf8");
  const manifest = ["title: Page Size", "preset: dtrpg"];
  if (css !== null) {
    await mkdir(path.join(dir, "styles"), { recursive: true });
    await writeFile(path.join(dir, "styles", "book.css"), css, "utf8");
    manifest.push("styles:", "  - styles/book.css");
  }
  if (lookCss !== undefined) {
    const look = path.join(dir, "ext", "look");
    await mkdir(look, { recursive: true });
    await writeFile(
      path.join(look, "package.json"),
      JSON.stringify({ name: "look", main: "plugin.js", gutterpress: { styles: ["theme.css"] } }),
      "utf8",
    );
    await writeFile(path.join(look, "plugin.js"), "export default function () {}\n", "utf8");
    await writeFile(path.join(look, "theme.css"), lookCss, "utf8");
    manifest.push("extensions:", "  - ./ext/look");
  }
  await writeFile(path.join(dir, "manifest.yaml"), manifest.join("\n") + "\n", "utf8");
  return dir;
}

/** Build the book to PDF and read back every page's size, in points. */
async function printedPageSizes(inputDir: string): Promise<Array<{ w: number; h: number }>> {
  const outDir = await makeTempDir("gp-page-size-e2e-out-");
  dirs.push(outDir);
  const result = await runBuild({
    inputDir,
    format: "pdf",
    outDir,
    skipLint: true,
    skipPreValidate: true,
    rawArgs: {},
  });
  if (!result.pdfPath) throw new Error("build produced no pdfPath");
  const doc = await loadPdf(result.pdfPath);
  if (!doc) throw new Error(`could not load ${result.pdfPath}`);
  const sizes: Array<{ w: number; h: number }> = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const { w, h } = getPageSize(await doc.getPage(i));
    sizes.push({ w: Math.round(w), h: Math.round(h) });
  }
  return sizes;
}

function expectEveryPage(sizes: Array<{ w: number; h: number }>, size: { w: number; h: number }): void {
  expect(sizes.length).toBeGreaterThan(0);
  for (const s of sizes) expect(s).toEqual(size);
}

testIf(
  "a stylesheet with @page margins and no size prints at the manifest's page size",
  async () => {
    // Before #415 this was the Letter book: 612x792 on every page.
    expectEveryPage(await printedPageSizes(await makeBook("@page { margin: 0.75in }\n")), DTRPG);
  },
  120_000,
);

testIf(
  "a book with no stylesheet at all prints at the manifest's page size",
  async () => {
    expectEveryPage(await printedPageSizes(await makeBook(null)), DTRPG);
  },
  120_000,
);

testIf(
  "a stylesheet's own plain @page size is overridden by the manifest's",
  async () => {
    expectEveryPage(
      await printedPageSizes(await makeBook("@page { size: 6in 9in; margin: 0.75in }\n")),
      DTRPG,
    );
  },
  120_000,
);

testIf(
  "a look's plain @page size, inside its extension layer, is overridden by the manifest's too",
  async () => {
    expectEveryPage(
      await printedPageSizes(
        await makeBook("@page { margin: 0.75in }\n", "@page { size: 6in 9in; margin: 1in }\n"),
      ),
      DTRPG,
    );
  },
  120_000,
);
