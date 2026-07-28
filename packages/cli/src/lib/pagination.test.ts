import { test, expect, afterAll } from "bun:test";
import { mkdtemp, writeFile, readFile, rm, mkdir, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveChromiumExecutable } from "./chromium.ts";
import { getAssetPath } from "./embedded-assets.ts";
import { closeBrowser } from "./browser-pool.ts";
import { patchHtmlForPagedjs } from "./pagedjs.ts";
import { paginateToStaticHtml, renderHtmlToPdf } from "./pagination.ts";
import { renderChapters } from "./markdown/index.ts";

/**
 * Render smoke-test (issue #52 guard): drives the REAL Chromium render path —
 * the same code the production build uses — so the de-duplication refactor of
 * the static-server + puppeteer capture logic is provably behavior-preserving.
 *
 * Resolves a browser exactly like production (resolveChromiumExecutable). If no
 * browser resolves, the tests SKIP (do not fail) with a clear message — CI has
 * Chromium for the perf-gate, and locally /usr/bin/google-chrome exists.
 *
 * Covers BOTH render outputs from minimal HTML input:
 *   a. paginateToStaticHtml -> static paged HTML (.pagedjs_page elements).
 *   b. renderHtmlToPdf (default puppeteerPdfRenderer) -> non-empty PDF (%PDF).
 */

// Render is slow; give it a generous-but-bounded budget.
const RENDER_TEST_TIMEOUT_MS = 120_000;

/**
 * Stage a minimal Paged.js book into a temp dir: a book.html with a couple of
 * forced page breaks plus the vendored polyfill, patched the same way the build
 * pipeline patches it (BREAK_INSIDE_HANDLER + polyfill + __PAGED_RENDERED__).
 * Returns the staged book.html path and a cleanup fn.
 */
async function stageMinimalBook(): Promise<{ stagedBook: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "pmd-render-smoke-"));
  const stagedBook = join(dir, "book.html");
  // Two pages: a div that forces a page break before the second block.
  const html =
    "<!DOCTYPE html><html><head><meta charset=\"utf-8\">\n" +
    "<style>@page { size: 4in 6in; margin: 0.5in; }\n" +
    ".break { break-before: page; }</style>\n" +
    "</head><body>\n" +
    "<h1>Page One</h1><p>First page content.</p>\n" +
    "<div class=\"break\"></div>\n" +
    "<h1>Page Two</h1><p>Second page content.</p>\n" +
    "</body></html>";
  await writeFile(stagedBook, html, "utf-8");

  // Vendor the polyfill alongside (build stages it under ./vendor/).
  await mkdir(join(dir, "vendor"), { recursive: true });
  await copyFile(
    await getAssetPath("vendor/paged.polyfill.js"),
    join(dir, "vendor/paged.polyfill.js")
  );
  // Patch in the polyfill + break handler + __PAGED_RENDERED__ marker (same as build).
  await patchHtmlForPagedjs(stagedBook, "./vendor/paged.polyfill.js");

  return {
    stagedBook,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;
if (!chromium) {
  // eslint-disable-next-line no-console
  console.warn(
    "[pagination.test] No Chromium resolved via resolveChromiumExecutable() — skipping render smoke-tests. Install Chrome/Chromium or set CHROMIUM_PATH to run them."
  );
}

afterAll(async () => {
  await closeBrowser();
});

testIf(
  "paginateToStaticHtml produces static paged HTML with the expected page count",
  async () => {
    const { stagedBook, cleanup } = await stageMinimalBook();
    try {
      const staticHtml = await paginateToStaticHtml(stagedBook);
      // Paged.js fragments into .pagedjs_page elements baked into the DOM.
      expect(staticHtml).toMatch(/class="[^"]*pagedjs_page/);
      // The forced break yields two pages.
      const pageCount = (staticHtml.match(/class="[^"]*pagedjs_page[^"]*"/g) ?? []).length;
      expect(pageCount).toBeGreaterThanOrEqual(2);
      // Authored content survives into the static artifact.
      expect(staticHtml).toMatch(/Page One/);
      expect(staticHtml).toMatch(/Page Two/);
    } finally {
      await cleanup();
    }
  },
  RENDER_TEST_TIMEOUT_MS
);

testIf(
  "preview chapter metadata preserves structural-selector pagination",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "pmd-wrapper-fidelity-"));
    try {
      await writeFile(join(dir, "a.md"), "# First\n\nAlpha.\n", "utf8");
      await writeFile(join(dir, "b.md"), "# Second\n\nBeta.\n", "utf8");
      await writeFile(
        join(dir, "book.css"),
        "@page{size:4in 6in;margin:.5in} p + h1{break-before:page}\n",
        "utf8",
      );
      await mkdir(join(dir, "vendor"), { recursive: true });
      await copyFile(
        await getAssetPath("vendor/paged.polyfill.js"),
        join(dir, "vendor/paged.polyfill.js"),
      );

      const files = ["a.md", "b.md"];
      const buildPath = join(dir, "build.html");
      const previewPath = join(dir, "preview.html");
      await writeFile(
        buildPath,
        await renderChapters(dir, { files, styles: ["book.css"] }),
        "utf8",
      );
      const annotated = await renderChapters(dir, {
        files,
        styles: ["book.css"],
        wrapChapters: true,
      });
      await writeFile(previewPath, annotated, "utf8");
      await patchHtmlForPagedjs(buildPath, "./vendor/paged.polyfill.js");
      await patchHtmlForPagedjs(previewPath, "./vendor/paged.polyfill.js");

      const [buildHtml, previewHtml] = await Promise.all([
        paginateToStaticHtml(buildPath),
        paginateToStaticHtml(previewPath),
      ]);
      const pageStarts = (html: string) =>
        [...html.matchAll(/<div class="pagedjs_page(?:\s[^"]*)?"/g)].map((match) => match.index!);
      const buildPages = pageStarts(buildHtml);
      const previewPages = pageStarts(previewHtml);

      expect(previewPages.length).toBe(buildPages.length);
      expect(previewPages.filter((start) => start < previewHtml.lastIndexOf("First")).length).toBe(1);
      expect(previewHtml).toContain('data-chapter-src="a.md"');
      expect(previewHtml).toContain('data-chapter-src="b.md"');
      expect(previewHtml).not.toContain('class="pmd-chapter"');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
  RENDER_TEST_TIMEOUT_MS,
);

testIf(
  "renderHtmlToPdf produces a non-empty, valid PDF with a page tree",
  async () => {
    const { stagedBook, cleanup } = await stageMinimalBook();
    const outPdf = join(stagedBook, "..", "out.pdf");
    try {
      await renderHtmlToPdf(stagedBook, outPdf);
      const bytes = await readFile(outPdf);
      expect(bytes.length).toBeGreaterThan(0);
      // Valid PDFs start with the %PDF- header.
      expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      // A page tree must exist (at least one /Page object).
      expect(bytes.toString("latin1")).toMatch(/\/Type\s*\/Page/);
    } finally {
      await cleanup();
    }
  },
  RENDER_TEST_TIMEOUT_MS
);
