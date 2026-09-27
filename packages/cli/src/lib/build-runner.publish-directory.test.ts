import { expect, test, afterEach } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { publishToDirectory, runBuild } from "./build-runner.ts";
import { resolveChromiumExecutable } from "./chromium.ts";
import { closeBrowser } from "./browser-pool.ts";
import { makeTempDir } from "../test-helpers/testkit.ts";

/**
 * #270 / #271: a shared `--out <dir>` lets a pdf build overwrite the html
 * build's book.html. `publishBuild`'s old directory branch copied the WHOLE
 * work dir (`fsp.cp(workDir, target.dir, { force: true })`) into the target,
 * so the pdf build's staged book.html — no viewer script, and (since #263)
 * no relative hrefs — clobbered the html build's published one.
 *
 * Fix (owner-picked shape 1): a directory publish delivers only what its
 * format actually produces. `html` still ships the whole bundle; `pdf`/
 * `pdfx` ships ONLY its own PDF.
 */

const dirsToClean: string[] = [];
afterEach(async () => {
  for (const d of dirsToClean.splice(0)) await rm(d, { recursive: true, force: true });
});

const VIEWER_SCRIPT_TAG = '<script src="engine/gutterpress-viewer.js"></script>';
// Stands in for the viewer script an html build's book.html actually carries —
// the exact tag is asserted separately by the end-to-end test below.
const HTML_BUILD_SENTINEL = "<!-- SENTINEL: html build's own book.html -->";

test("publishToDirectory: a pdf build into a directory that already holds an html build's output leaves book.html/index.html/assets alone and adds only the PDF", async () => {
  const workDir = await makeTempDir("gp-publish-dir-work-");
  const targetDir = await makeTempDir("gp-publish-dir-target-");
  dirsToClean.push(workDir, targetDir);

  // The html build's PREVIOUSLY published output, already sitting in the
  // shared --out directory.
  await writeFile(path.join(targetDir, "book.html"), `<html>${HTML_BUILD_SENTINEL}</html>`);
  await writeFile(path.join(targetDir, "index.html"), "<html>redirect</html>");
  await mkdir(path.join(targetDir, "images"), { recursive: true });
  await writeFile(path.join(targetDir, "images", "x.png"), "fake-png-bytes");

  // A pdf build's staged work dir: its OWN book.html (no viewer script, links
  // dropped per #263), the PDF artifact, and the fingerprint.
  await writeFile(path.join(workDir, "book.html"), "<html>pdf build's staged copy</html>");
  await mkdir(path.join(workDir, "images"), { recursive: true });
  await writeFile(path.join(workDir, "images", "x.png"), "fake-png-bytes");
  await writeFile(path.join(workDir, "some-book-pdf.pdf"), "%PDF-1.4\n");
  await writeFile(path.join(workDir, "build-fingerprint.json"), '{"schemaVersion":1}\n');

  await publishToDirectory(workDir, targetDir, "pdf", "some-book-pdf.pdf");

  // The html build's book.html/index.html/assets survive untouched.
  expect(await readFile(path.join(targetDir, "book.html"), "utf-8")).toContain(
    HTML_BUILD_SENTINEL
  );
  expect(await readFile(path.join(targetDir, "index.html"), "utf-8")).toBe("<html>redirect</html>");
  expect(await readFile(path.join(targetDir, "images", "x.png"), "utf-8")).toBe("fake-png-bytes");

  // Only the PDF arrived — no fingerprint, no second copy of book.html/images.
  expect(await readFile(path.join(targetDir, "some-book-pdf.pdf"), "utf-8")).toBe("%PDF-1.4\n");
  const targetEntries = (await readdir(targetDir)).sort();
  expect(targetEntries).toEqual(["book.html", "images", "index.html", "some-book-pdf.pdf"].sort());
});

test("publishToDirectory: an html build still delivers the whole bundle", async () => {
  const workDir = await makeTempDir("gp-publish-dir-html-work-");
  const targetDir = await makeTempDir("gp-publish-dir-html-target-");
  dirsToClean.push(workDir, targetDir);

  await writeFile(path.join(workDir, "book.html"), `<html>${VIEWER_SCRIPT_TAG}</html>`);
  await writeFile(path.join(workDir, "index.html"), "<html>redirect</html>");
  await writeFile(path.join(workDir, "build-fingerprint.json"), '{"schemaVersion":1}\n');

  await publishToDirectory(workDir, targetDir, "html", null);

  expect(await readFile(path.join(targetDir, "book.html"), "utf-8")).toContain(VIEWER_SCRIPT_TAG);
  expect(await readFile(path.join(targetDir, "index.html"), "utf-8")).toBe("<html>redirect</html>");
  expect(await readFile(path.join(targetDir, "build-fingerprint.json"), "utf-8")).toBe(
    '{"schemaVersion":1}\n'
  );
});

// ── End-to-end: the documented two-command `--out` sequence ────────────────

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;
if (!chromium) {
  // eslint-disable-next-line no-console
  console.warn("[build-runner.publish-directory.test] No Chromium resolved — skipping the end-to-end case.");
}

async function makeBook(): Promise<string> {
  const dir = await makeTempDir("gp-publish-dir-book-");
  dirsToClean.push(dir);
  await writeFile(path.join(dir, "chapter-01.md"), "# Hello\n\nA minimal chapter.\n");
  await writeFile(path.join(dir, "manifest.yaml"), "title: Shared Out Dir\n");
  return dir;
}

testIf(
  "the documented `--format html --out ./_site` then `--format pdf --out ./_site` sequence leaves book.html publishable (viewer script intact) and adds the PDF",
  async () => {
    const book = await makeBook();
    const outDir = await makeTempDir("gp-publish-dir-e2e-out-");
    dirsToClean.push(outDir);

    const htmlResult = await runBuild({
      inputDir: book,
      format: "html",
      outDir,
      keepBrowserAlive: true,
      rawArgs: {},
    });
    expect(htmlResult.htmlPath).toBe(path.join(outDir, "book.html"));

    const pdfResult = await runBuild({
      inputDir: book,
      format: "pdf",
      outDir,
      skipLint: true,
      skipPreValidate: true,
      keepBrowserAlive: true,
      rawArgs: {},
    });

    // The pdf build reports nothing at the html/fingerprint paths — it
    // delivered only its PDF into the shared directory (#270, #271).
    expect(pdfResult.htmlPath).toBeNull();
    expect(pdfResult.fingerprintPath).toBeNull();
    expect(pdfResult.pdfPath).not.toBeNull();
    expect(pdfResult.pdfPath).toBe(path.join(outDir, "shared-out-dir-pdf.pdf"));

    // The html build's book.html — the one a static host would actually
    // serve — still carries the viewer script and paginates in the browser.
    const bookHtml = await readFile(path.join(outDir, "book.html"), "utf-8");
    expect(bookHtml).toContain(VIEWER_SCRIPT_TAG);
    expect(bookHtml).toMatch(/Hello/);

    // The PDF landed alongside it.
    expect(existsSync(pdfResult.pdfPath!)).toBe(true);

    await closeBrowser();
  },
  60_000
);
