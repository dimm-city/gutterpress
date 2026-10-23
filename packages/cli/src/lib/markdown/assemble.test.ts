import { test, expect } from "bun:test";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type MarkdownIt from "markdown-it";

import { assembleBookHtml } from "./assemble";
import { inlineStyles } from "../asset-inline";
import { renderChapters } from "./index";
import { extract, resolvePage } from "../../engine/shared/gcpm-extract.ts";

/**
 * Parity test: the pure, node-free `assembleBookHtml`
 * (browser-usable) must produce the EXACT same book.html as the node
 * `renderChapters` wrapper for the same inputs — proving the refactor split the
 * file-reading concern out without changing the rendered HTML.
 */

const FILES: Record<string, string> = {
  "01-intro.md": "# Intro\n\nHello **world**.\n",
  "02-body.md": "## Body\n\n- one\n- two\n\n> [!NOTE]\nA note.\n",
};

test("assembleBookHtml (pure, in-memory readText) === renderChapters (node, on disk)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gutterpress-assemble-parity-"));
  try {
    await mkdir(join(dir, "css"), { recursive: true });
    await writeFile(join(dir, "css/print.css"), "body{}", "utf-8");
    for (const [name, body] of Object.entries(FILES)) {
      await writeFile(join(dir, name), body, "utf-8");
    }

    const files = ["01-intro.md", "02-body.md"];

    // Node path: reads off disk.
    const printArea = { width: 432, height: 648, safe: 18 };
    const nodeHtml = await renderChapters(dir, {
      title: "My Book",
      printArea,
      styles: ["css/print.css"],
      files,
    });

    // Pure path: same inputs, in-memory reader. The node wrapper's ONLY extra
    // job is reading + inlining the stylesheets, so feeding the pure assembler
    // that same inlined CSS must reproduce its output byte for byte.
    const { css: projectCss } = await inlineStyles(dir, ["css/print.css"]);
    const pureHtml = await assembleBookHtml({
      files,
      readText: (rel) => Promise.resolve(FILES[rel] ?? Promise.reject(new Error(`no ${rel}`))),
      projectCss,
      title: "My Book",
      printArea,
    });

    expect(pureHtml).toBe(nodeHtml);
    expect(pureHtml).toContain('<meta name="gp-print-area"');
    // Sanity: the assembled HTML carries the rendered markdown.
    expect(pureHtml).toContain(">Intro</h1>");
    expect(pureHtml).toContain("<strong>world</strong>");
    // The un-rewritten book.html must have no network dependency (native
    // engine ships no runtime pagination polyfill at all).
    expect(pureHtml).not.toMatch(/https?:\/\//);
    expect(pureHtml).not.toMatch(/unpkg/);
    // CSS is INLINED, never <link>ed — that is what makes a stylesheet's
    // location irrelevant to the output (themes, shared design systems).
    expect(pureHtml).not.toContain("<link rel=\"stylesheet\"");
    expect(pureHtml).toContain("<style data-project-css>");
    expect(pureHtml).toContain("body{}");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("chapter metadata preserves plugins that wrap md.render", async () => {
  const html = await assembleBookHtml({
    files: ["chapter.md"],
    readText: () => Promise.resolve("# Heading\n"),
    plugins: [{
      name: "wrap-render",
      options: {},
      plugin(md: MarkdownIt) {
        const render = md.render.bind(md);
        md.render = (source, env) =>
          `<section data-plugin-render>${render(source, env)}</section>`;
      },
    }],
    annotateSourceChapters: true,
  });

  expect(html).toContain("<section data-plugin-render>");
  // The chapter id is threaded through `env`, so a plugin that wraps
  // md.render() must still see it land on the source-mapped block.
  expect(html).toMatch(/<h1[^>]*data-chapter-src="chapter.md"/);
});

test("assembleBookHtml throws on empty file list", async () => {
  await expect(
    assembleBookHtml({ files: [], readText: () => Promise.resolve("") }),
  ).rejects.toThrow(/no markdown files/i);
});

test("assembleBookHtml writes the print padding on <html> for the viewer", async () => {
  const readText = () => Promise.resolve("# A\n");
  const padded = await assembleBookHtml({ files: ["a.md"], readText, print: { signature: 4, reserveLastPage: true } });
  expect(padded).toContain('<html lang="en" data-gp-signature="4" data-gp-last-page="blank">');
  const short = await assembleBookHtml({ files: ["a.md"], readText, print: { signature: 4, reserveLastPage: true, lastPage: "short-by-one" } });
  expect(short).toContain('<html lang="en" data-gp-signature="4" data-gp-last-page="short-by-one">');
  const plain = await assembleBookHtml({ files: ["a.md"], readText, print: { signature: 1, reserveLastPage: false } });
  expect(plain).toContain('<html lang="en">');
});

test("assembleBookHtml writes the project's print area into <head>, in every book it assembles", async () => {
  const readText = () => Promise.resolve("# A\n");
  const html = await assembleBookHtml({
    files: ["a.md"],
    readText,
    printArea: { width: 621, height: 810, bleed: 9, safe: 36, artSafe: 18, preset: "dtrpg" },
  });
  const head = html.slice(0, html.indexOf("</head>"));
  expect(head).toContain(
    `<meta name="gp-print-area" content='{"width":621,"height":810,"bleed":9,"safe":36,"artSafe":18,"preset":"dtrpg"}'>`,
  );
  // one meta, and none at all without a print area
  expect(html.match(/gp-print-area/g)).toHaveLength(1);
  expect(await assembleBookHtml({ files: ["a.md"], readText })).not.toContain("gp-print-area");
});

// ── #415: the manifest's page size is what prints unless a stylesheet sets its own ──
//
// `page.width` x `page.height` is what every check and the preview's overlays
// judge against; Chromium prints the stylesheet's plain `@page { size }`. The
// assembly supplies the manifest's as plain CSS when no extension or book CSS
// sets one — before them, so an author's own `size` still wins by the cascade.

const DTRPG = { width: 621, height: 810, bleed: 9, safe: 36, artSafe: 18, preset: "dtrpg" };
const DEFAULT_RULE = "@page { size: 621pt 810pt; }";
const readA = () => Promise.resolve("# A\n");

/** The one `<style data-project-css>` block of an assembled book. */
function projectStyle(html: string): string {
  return html.slice(html.indexOf("<style data-project-css>"), html.indexOf("</style>"));
}

test("a stylesheet with @page margins and no size prints at the manifest's page size: the rule is written before the project CSS", async () => {
  const html = await assembleBookHtml({
    files: ["a.md"],
    readText: readA,
    projectCss: "@page { margin: 1in }",
    printArea: DTRPG,
  });
  const css = projectStyle(html);
  expect(css).toContain(DEFAULT_RULE);
  expect(css.match(/@page \{ size: /g)).toHaveLength(1);
  // Ahead of the author's sheet, so a `size` added there later wins the cascade.
  expect(css.indexOf(DEFAULT_RULE)).toBeLessThan(css.indexOf("/* project css */"));
  expect(css.indexOf(DEFAULT_RULE)).toBeLessThan(css.indexOf("@page { margin: 1in }"));
  // Unlayered, not inside any `@layer` block.
  expect(css).toContain(`}\n\n/* page size (manifest) */\n${DEFAULT_RULE}\n\n`);
  // The viewer and the compiler read the base page with this same reader: it
  // now sees the manifest's size, not Chromium's Letter fallback.
  expect(resolvePage(extract(css)).geometry).toMatchObject({ width: 621, height: 810 });

  // A book with no stylesheet at all prints at the manifest's size too.
  expect(projectStyle(await assembleBookHtml({ files: ["a.md"], readText: readA, printArea: DTRPG }))).toContain(DEFAULT_RULE);
});

test("a stylesheet that sets its own plain @page size keeps it: nothing is added", async () => {
  for (const projectCss of [
    "@page { size: 6in 9in; margin: 1in }",
    "@media print { @page { size: 6in 9in } }",
    "@page { margin: 1in }\n@page { size: 6in 9in }",
  ]) {
    const css = projectStyle(await assembleBookHtml({ files: ["a.md"], readText: readA, projectCss, printArea: DTRPG }));
    expect(css, projectCss).not.toContain("page size (manifest)");
    expect(css, projectCss).not.toContain("621pt");
    expect(resolvePage(extract(css)).geometry).toMatchObject({ width: 432, height: 648 });
  }
});

test("a look's plain @page size, inside its extension layer, counts: nothing is added", async () => {
  const pluginCss = "@layer ext.look;\n\n/* look */\n@layer ext.look {\n@page { size: 6in 9in; margin: 1in }\n}";
  const css = projectStyle(
    await assembleBookHtml({ files: ["a.md"], readText: readA, pluginCss, projectCss: "@page { margin: 0.75in }", printArea: DTRPG }),
  );
  expect(css).not.toContain("page size (manifest)");
  expect(css).not.toContain("621pt");
});

test("a named or pseudo page's size is not the book's geometry: the default is still written", async () => {
  const css = projectStyle(
    await assembleBookHtml({
      files: ["a.md"],
      readText: readA,
      projectCss: "@page cover { size: 7in 10in }\n@page :first { size: 7in 10in }\n@page { margin: 1in }",
      printArea: DTRPG,
    }),
  );
  expect(css).toContain(DEFAULT_RULE);
  expect(css.indexOf(DEFAULT_RULE)).toBeLessThan(css.indexOf("@page cover"));
  expect(resolvePage(extract(css)).geometry).toMatchObject({ width: 621, height: 810 });
  expect(resolvePage(extract(css), { name: "cover" }).geometry).toMatchObject({ width: 504, height: 720 });
});

test("without a print area there is no size to supply: nothing is added", async () => {
  const html = await assembleBookHtml({ files: ["a.md"], readText: readA, projectCss: "@page { margin: 1in }" });
  expect(html).not.toContain("page size (manifest)");
  expect(html).not.toContain("@page { size:");
});
