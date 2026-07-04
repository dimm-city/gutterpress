import { test, expect } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  stripPaginationRuntime,
  injectNavigationScripts,
  shipRuntimePaginatedHtml,
  stagePaginationInput,
} from "./build-runner.ts";
import { pagedjsPolyfillTag } from "./pagedjs-marker.ts";

// The break-inside handler block is injected by patchHtmlForPagedjs and ends up
// in the serialized DOM; stripPaginationRuntime must remove it (and the polyfill
// <script src>) while leaving everything else — including navigation scripts and
// the inlined Paged.js layout CSS — intact.
test("stripPaginationRuntime removes polyfill script and inline break handler", () => {
  const html = [
    "<!DOCTYPE html><html><head>",
    '<style>.pagedjs_page{width:8.5in}</style>',
    "<script>",
    "(function(){ window.PagedConfig = window.PagedConfig || {};",
    "  class BreakInsideAvoidHandler extends Paged.Handler { onBreakToken(b){ return b; } }",
    "  Paged.registerHandlers(BreakInsideAvoidHandler);",
    "})();",
    "</script>",
    '<script src="./vendor/paged.polyfill.js"></script>',
    '<script src="preview/scripts/pagedjs-interface.js"></script>',
    "</head><body><div class=\"pagedjs_page\">hi</div></body></html>",
  ].join("\n");

  const out = stripPaginationRuntime(html);

  expect(out).not.toMatch(/paged\.polyfill\.js/);
  expect(out).not.toMatch(/BreakInsideAvoidHandler/);
  // Navigation script and the layout CSS survive.
  expect(out).toMatch(/pagedjs-interface\.js/);
  expect(out).toMatch(/\.pagedjs_page\{width:8\.5in\}/);
  // The paginated page DOM survives.
  expect(out).toMatch(/class="pagedjs_page"/);
});

test("stripPaginationRuntime removes a CDN polyfill script tag too", () => {
  const html =
    '<head><script src="https://unpkg.com/pagedjs@0.4.3/dist/paged.polyfill.js"></script></head>';
  expect(stripPaginationRuntime(html)).not.toMatch(/script/);
});

// The strip/replace passes must key on the stable marker, NOT the pagedjs
// version. Prove it: emit the core polyfill slot at a spread of versions (as if
// the single PAGEDJS_VERSION constant were bumped) and confirm the rewriters
// still strip AND the navigation scripts survive at every version.
test("stripPaginationRuntime is version-agnostic (marker, not URL, drives the match)", () => {
  for (const version of ["0.4.3", "0.5.0", "1.0.0", "42.7.9"]) {
    const html =
      "<!DOCTYPE html><html><head>" +
      `${pagedjsPolyfillTag(version)}` +
      '<script src="preview/scripts/pagedjs-interface.js"></script>' +
      '</head><body><div class="pagedjs_page">hi</div></body></html>';
    const out = stripPaginationRuntime(html);
    // The polyfill slot is gone at every version...
    expect(out).not.toMatch(/data-pagedjs-polyfill/);
    // ...while the navigation script (also contains "pagedjs") survives...
    expect(out).toMatch(/pagedjs-interface\.js/);
    // ...and the paginated page DOM is untouched.
    expect(out).toMatch(/class="pagedjs_page"/);
  }
});

// The runtime fallback likewise rewrites the marker slot regardless of version.
test("shipRuntimePaginatedHtml rewrites the marker slot at any version", async () => {
  for (const version of ["0.4.3", "9.9.9"]) {
    const dir = await mkdtemp(join(tmpdir(), "pmd-fallback-ver-"));
    try {
      const htmlFile = join(dir, "book.html");
      await writeFile(
        htmlFile,
        "<!DOCTYPE html><html><head>\n" +
          `${pagedjsPolyfillTag(version)}\n` +
          "</head><body><p>hello</p></body></html>",
        "utf-8"
      );
      await shipRuntimePaginatedHtml(htmlFile, dir);
      const result = await readFile(htmlFile, "utf-8");
      // The marker slot was replaced with the vendored polyfill + nav scripts.
      expect(result).not.toMatch(/data-pagedjs-polyfill/);
      expect(result).toMatch(/vendor\/paged\.polyfill\.js/);
      expect(result).toMatch(/preview\/scripts\/pagedjs-interface\.js/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test("injectNavigationScripts inserts both toolbar scripts before </head>", () => {
  const out = injectNavigationScripts("<head><title>x</title></head><body></body>");
  expect(out).toMatch(/preview\/scripts\/pagedjs-interface\.js/);
  expect(out).toMatch(/preview\/scripts\/pagedjs-bridge\.js/);
  // Inserted before </head>, not after it.
  expect(out.indexOf("pagedjs-interface.js")).toBeLessThan(out.indexOf("</head>"));
});

// The no-Chromium fallback for `--format html`: ships the polyfill + nav scripts
// so the browser paginates on load (the pre-SSG behavior). Verifies the emitted
// book.html and that the vendored assets land on disk.
test("shipRuntimePaginatedHtml rewrites the book + vendors the polyfill", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pmd-fallback-"));
  try {
    const htmlFile = join(dir, "book.html");
    await writeFile(
      htmlFile,
      '<!DOCTYPE html><html><head>\n' +
        '<script src="https://unpkg.com/pagedjs@0.4.3/dist/paged.polyfill.js"></script>\n' +
        "</head><body><p>hello</p></body></html>",
      "utf-8"
    );

    await shipRuntimePaginatedHtml(htmlFile, dir);

    const result = await readFile(htmlFile, "utf-8");
    // The browser-pagination polyfill IS shipped (this is the fallback).
    expect(result).toMatch(/vendor\/paged\.polyfill\.js/);
    expect(result).toMatch(/preview\/scripts\/pagedjs-interface\.js/);
    expect(result).toMatch(/preview\/scripts\/pagedjs-bridge\.js/);
    // The CDN tag was replaced (no unpkg reference left).
    expect(result).not.toMatch(/unpkg\.com/);
    // Vendored assets exist on disk.
    expect(existsSync(join(dir, "vendor/paged.polyfill.js"))).toBe(true);
    expect(existsSync(join(dir, "preview/scripts/pagedjs-interface.js"))).toBe(true);
    expect(existsSync(join(dir, "preview/scripts/pagedjs-bridge.js"))).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// The shared staging sequence used by BOTH the HTML and PDF pagination passes:
// wipe/recreate the stage dir, copy the rendered book.html, vendor the Paged.js
// polyfill, and patch the staged HTML to load it. No Chromium involved.
test("stagePaginationInput stages book + vendors + patches the polyfill", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pmd-stage-"));
  try {
    const { mkdir } = await import("node:fs/promises");
    const outDir = join(dir, "out");
    const stageDir = join(dir, "stage");
    const htmlFile = join(outDir, "book.html");
    // Write the source book (no assets configured).
    await mkdir(outDir, { recursive: true });
    await writeFile(
      htmlFile,
      "<!DOCTYPE html><html><head><title>x</title></head><body><p>hi</p></body></html>",
      "utf-8"
    );

    // Pre-seed the stage dir with a stale file to prove it gets wiped.
    await mkdir(stageDir, { recursive: true });
    await writeFile(join(stageDir, "stale.txt"), "old", "utf-8");

    const stagedHtml = await stagePaginationInput(htmlFile, outDir, [], stageDir);

    // Returns the staged book path inside the stage dir.
    expect(stagedHtml).toBe(join(stageDir, "book.html"));
    expect(existsSync(stagedHtml)).toBe(true);
    // Stage dir was wiped (stale file gone).
    expect(existsSync(join(stageDir, "stale.txt"))).toBe(false);
    // Polyfill vendored from embedded assets.
    expect(existsSync(join(stageDir, "vendor/paged.polyfill.js"))).toBe(true);
    // Staged HTML patched to load the vendored polyfill + break handler.
    const staged = await readFile(stagedHtml, "utf-8");
    expect(staged).toMatch(/vendor\/paged\.polyfill\.js/);
    expect(staged).toMatch(/BreakInsideAvoidHandler/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
