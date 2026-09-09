import { expect, test, afterAll } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { runBuild } from "./build-runner.ts";
import { resolveChromiumExecutable } from "./chromium.ts";
import { closeBrowser } from "./browser-pool.ts";
import { clearPdfCache, loadPdf } from "./pdf-inspect.ts";
import { extractReport, serializeReport } from "./render-parity.ts";
import { makeTempDir, pngRgb } from "../test-helpers/testkit.ts";

/**
 * END TO END for #263: a relative link in a book must not bake the build
 * machine's `file:///tmp/gutterpress-build-<random>/…` path into the PDF.
 *
 * Only a real Chromium can show this — the leak is Chromium resolving the
 * staged document's relative hrefs against its `file://` base URL as it
 * writes the link annotations, so no unit test on the HTML can observe it.
 * Two builds of the same sources must agree on every annotation, and the
 * HTML format must keep every href (its images ship beside book.html).
 */

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;
if (!chromium) {
  // eslint-disable-next-line no-console
  console.warn("[build-runner.dangling-links.test] No Chromium resolved — skipping.");
}

const TIMEOUT_MS = 90_000;
const dirs: string[] = [];
afterAll(async () => {
  if (chromium) await closeBrowser();
  clearPdfCache();
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

const CHAPTER = [
  "# Intro {#intro}",
  "",
  "![cover](images/cover.png)",
  "",
  "A [constitution](docs/constitution.md), the [next chapter](chapters/02-next.md),",
  "the [cover](images/cover.png), a [spec](files/spec.pdf), the [intro](#intro),",
  "a [site](https://example.com/page), an [address](mailto:reader@example.com),",
  "[this file](./01-intro.md#intro) and <a href=\"docs/constitution.md\">raw HTML</a>.",
  "",
].join("\n");

async function makeBook(): Promise<string> {
  const dir = await makeTempDir("gp-dangling-links-");
  dirs.push(dir);
  for (const sub of ["images", "docs", "files", "chapters"]) await mkdir(path.join(dir, sub));
  await writeFile(path.join(dir, "images", "cover.png"), pngRgb(8, 8, () => [200, 40, 40]));
  await writeFile(path.join(dir, "docs", "constitution.md"), "# Constitution\n");
  await writeFile(path.join(dir, "files", "spec.pdf"), "%PDF-1.4\n");
  await writeFile(path.join(dir, "chapters", "02-next.md"), "# Next\n\nMore.\n");
  await writeFile(path.join(dir, "01-intro.md"), CHAPTER);
  await writeFile(
    path.join(dir, "manifest.yaml"),
    "title: Link Fixture\nsource:\n  files:\n    - 01-intro.md\n    - chapters/02-next.md\n",
  );
  return dir;
}

async function build(inputDir: string, format: "pdf" | "html", tag: string): Promise<string> {
  const outDir = await makeTempDir(`gp-dangling-links-out-${tag}-`);
  dirs.push(outDir);
  const result = await runBuild({
    inputDir,
    format,
    outDir,
    skipLint: true,
    skipPreValidate: true,
    keepBrowserAlive: true,
    rawArgs: {},
  });
  if (format === "html") return path.join(outDir, "book.html");
  if (!result.pdfPath) throw new Error("build produced no pdfPath");
  return result.pdfPath;
}

/** Every Link annotation's target: an external `url` or an in-document `dest`. */
async function linkTargets(pdfPath: string): Promise<{ urls: string[]; dests: string[] }> {
  const doc = await loadPdf(pdfPath);
  if (!doc) throw new Error(`could not load ${pdfPath}`);
  const urls: string[] = [];
  const dests: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    for (const a of await page.getAnnotations()) {
      const annot = a as { subtype?: string; url?: string; unsafeUrl?: string; dest?: unknown };
      if (annot.subtype !== "Link") continue;
      // pdf.js exposes a scheme it will not open (file: included) as
      // `unsafeUrl` only — reading `url` alone would hide the very leak.
      const url = annot.url ?? annot.unsafeUrl;
      if (url) urls.push(url);
      else if (annot.dest) dests.push(String(annot.dest));
    }
  }
  return { urls: urls.sort(), dests: dests.sort() };
}

testIf(
  "a pdf build keeps absolute and in-document links and bakes no file: URI",
  async () => {
    const book = await makeBook();
    const [a, b] = await Promise.all([build(book, "pdf", "a"), build(book, "pdf", "b")]);

    const links = await linkTargets(a);
    // Same-book chapter, copied image, sibling PDF, raw <a>: all relative,
    // none openable from a PDF, all gone. Baseline had eight file:// URIs.
    expect(links.urls).toEqual(["https://example.com/page", "mailto:reader@example.com"]);
    expect(links.dests).toEqual(["intro"]);
    expect(await linkTargets(b)).toEqual(links);

    // Nothing else in the two builds differs either.
    expect(serializeReport(await extractReport(a))).toBe(serializeReport(await extractReport(b)));
  },
  TIMEOUT_MS,
);

testIf(
  "an html build keeps every href",
  async () => {
    const html = await readFile(await build(await makeBook(), "html", "html"), "utf8");
    expect(html).toContain('href="images/cover.png"');
    expect(html).toContain('href="docs/constitution.md"');
    expect(html).toContain('href="chapters/02-next.md"');
  },
  TIMEOUT_MS,
);
