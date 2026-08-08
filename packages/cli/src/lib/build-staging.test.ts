import { test, expect } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  stripPaginationRuntime,
  injectNavigationScripts,
  shipRuntimePaginatedHtml,
  stripPaginationOrigin,
} from "./build-staging.ts";
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
    '<script src="preview/scripts/preview-interface.js"></script>',
    "</head><body><div class=\"pagedjs_page\">hi</div></body></html>",
  ].join("\n");

  const out = stripPaginationRuntime(html);

  expect(out).not.toMatch(/paged\.polyfill\.js/);
  expect(out).not.toMatch(/BreakInsideAvoidHandler/);
  // Navigation script and the layout CSS survive.
  expect(out).toMatch(/preview-interface\.js/);
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
      '<script src="preview/scripts/preview-interface.js"></script>' +
      '</head><body><div class="pagedjs_page">hi</div></body></html>';
    const out = stripPaginationRuntime(html);
    // The polyfill slot is gone at every version...
    expect(out).not.toMatch(/data-pagedjs-polyfill/);
    // ...while the navigation script (also contains "pagedjs") survives...
    expect(out).toMatch(/preview-interface\.js/);
    // ...and the paginated page DOM is untouched.
    expect(out).toMatch(/class="pagedjs_page"/);
  }
});

// The runtime fallback likewise rewrites the marker slot regardless of version.
test("shipRuntimePaginatedHtml rewrites the marker slot at any version", async () => {
  for (const version of ["0.4.3", "9.9.9"]) {
    const dir = await mkdtemp(join(tmpdir(), "gutterpress-fallback-ver-"));
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
      expect(result).toMatch(/preview\/scripts\/preview-interface\.js/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test("injectNavigationScripts inserts both toolbar scripts before </head>", () => {
  const out = injectNavigationScripts("<head><title>x</title></head><body></body>");
  expect(out).toMatch(/preview\/scripts\/preview-interface\.js/);
  expect(out).toMatch(/preview\/scripts\/preview-bridge\.js/);
  // Inserted before </head>, not after it.
  expect(out.indexOf("preview-interface.js")).toBeLessThan(out.indexOf("</head>"));
});

// The no-Chromium fallback for `--format html`: ships the polyfill + nav scripts
// so the browser paginates on load (the pre-SSG behavior). Verifies the emitted
// book.html and that the vendored assets land on disk.
test("shipRuntimePaginatedHtml rewrites the book + vendors the polyfill", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gutterpress-fallback-"));
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
    expect(result).toMatch(/preview\/scripts\/preview-interface\.js/);
    expect(result).toMatch(/preview\/scripts\/preview-bridge\.js/);
    // The CDN tag was replaced (no unpkg reference left).
    expect(result).not.toMatch(/unpkg\.com/);
    // Vendored assets exist on disk.
    expect(existsSync(join(dir, "vendor/paged.polyfill.js"))).toBe(true);
    expect(existsSync(join(dir, "preview/scripts/preview-interface.js"))).toBe(true);
    expect(existsSync(join(dir, "preview/scripts/preview-bridge.js"))).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// Paged.js absolutizes every non-data: CSS url() against the sheet's origin, so
// the serialized document comes back pointing at the build's ephemeral
// http://127.0.0.1:<port>/ — a port that dies with the build. These cover the
// rewrite back to document-relative URLs.
test("stripPaginationOrigin rewrites the ephemeral build origin to document-relative URLs", () => {
  const html = 'a { background: url("http://127.0.0.1:44321/assets/ab12.png"); }';
  expect(stripPaginationOrigin(html)).toBe('a { background: url("assets/ab12.png"); }');
});

test("stripPaginationOrigin strips the leading slash too, so subpath deploys work", () => {
  // book.html sits at the artifact root: `assets/x.png` is correct, while a
  // root-relative `/assets/x.png` would break a GitHub Pages project site.
  const out = stripPaginationOrigin("url(http://127.0.0.1:1/images/x.png)");
  expect(out).toBe("url(images/x.png)");
  expect(out).not.toContain("/images");
});

test("stripPaginationOrigin handles several ports and occurrences in one document", () => {
  const html = "url(http://127.0.0.1:1/a.png) url(http://127.0.0.1:65535/b/c.png)";
  expect(stripPaginationOrigin(html)).toBe("url(a.png) url(b/c.png)");
});

test("stripPaginationOrigin leaves genuine remote URLs and data: URIs alone", () => {
  const html = 'url("https://cdn.example.com/x.png") url("data:image/gif;base64,AAAA")';
  expect(stripPaginationOrigin(html)).toBe(html);
});
