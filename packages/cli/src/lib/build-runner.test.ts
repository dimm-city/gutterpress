import { test, expect } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  stripPaginationRuntime,
  injectNavigationScripts,
  shipRuntimePaginatedHtml,
} from "./build-runner.ts";

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
