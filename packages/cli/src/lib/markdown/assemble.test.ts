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

test("footnotes in two files get their own ids, and each reference links to its own file's note", async () => {
  const files: Record<string, string> = {
    "chapters/01.md": "# One\n\nFirst.[^a]\n\n[^a]: Note one.\n",
    "chapters/02.md": "# Two\n\nSecond.[^b]\n\n[^b]: Note two.\n",
  };
  const html = await assembleBookHtml({
    files: Object.keys(files),
    readText: (rel) => Promise.resolve(files[rel]!),
  });
  // Each file renders on its own and numbers its notes from 1, so the ids
  // carry the file: never `fn1` twice in one book.
  expect(html.match(/<li id="fn[^"]*"/g)).toEqual([
    '<li id="fn-chapters-01-md-1"',
    '<li id="fn-chapters-02-md-1"',
  ]);
  expect(html).toContain('<a href="#fn-chapters-01-md-1" id="fnref-chapters-01-md-1">');
  expect(html).toContain('<a href="#fn-chapters-02-md-1" id="fnref-chapters-02-md-1">');
  expect(html).toContain('<a href="#fnref-chapters-01-md-1" class="footnote-backref">');
  expect(html).toContain('<a href="#fnref-chapters-02-md-1" class="footnote-backref">');
  // No id is used twice, and every in-book link lands on one.
  const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  expect(new Set(ids).size).toBe(ids.length);
  for (const [, href] of html.matchAll(/ href="#([^"]+)"/g)) expect(ids).toContain(href);
});

test("a single file's footnote links still resolve", async () => {
  const html = await assembleBookHtml({
    files: ["paper.md"],
    readText: () => Promise.resolve("Text.[^1]\n\n[^1]: The note.\n"),
  });
  expect(html).toContain('<li id="fn-paper-md-1"');
  expect(html).toContain('<a href="#fn-paper-md-1" id="fnref-paper-md-1">');
  expect(html).toContain('<a href="#fnref-paper-md-1" class="footnote-backref">');
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

test("assembleBookHtml prints the book's language: <html lang> and its quotation marks", async () => {
  const html = await assembleBookHtml({ files: ["a.md"], readText: () => Promise.resolve('Er sagt "ja".\n'), language: "de" });
  expect(html).toContain('<html lang="de">');
  expect(html).toContain("Er sagt „ja“.");
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

// ── The manifest's page geometry is what prints: written after every stylesheet ──
//
// `page.width` x `page.height` is what every check and the preview's overlays
// judge against, and the assembly writes it as the plain `@page { size }` AFTER
// the extension and book CSS, so it wins the cascade: a look's or an author's
// `size` is overridden (#415 wrote it before them, as a default, and a
// stylesheet's size won). `page.margin`, when the manifest sets it, is written
// the same way, for both page sides.

const DTRPG = { width: 621, height: 810, bleed: 9, safe: 36, artSafe: 18, preset: "dtrpg" };
const SIZE_RULE = "@page { size: 8.625in 11.25in; }";
const readA = () => Promise.resolve("# A\n");

/** The one `<style data-project-css>` block of an assembled book. */
function projectStyle(html: string): string {
  return html.slice(html.indexOf("<style data-project-css>"), html.indexOf("</style>"));
}

test("the manifest's page size is written after the project CSS, unlayered, once", async () => {
  const html = await assembleBookHtml({
    files: ["a.md"],
    readText: readA,
    projectCss: "@page { margin: 2in }",
    printArea: DTRPG,
  });
  const css = projectStyle(html);
  expect(css).toContain(`/* page geometry (manifest) */\n${SIZE_RULE}`);
  expect(css.match(/@page \{ size: /g)).toHaveLength(1);
  expect(css.indexOf(SIZE_RULE)).toBeGreaterThan(css.indexOf("/* project css */"));
  expect(css.indexOf(SIZE_RULE)).toBeGreaterThan(css.indexOf("@page { margin: 2in }"));
  // The viewer and the compiler read the base page with this same reader; the
  // book's own margin stands (the default margin rule sits ahead of it).
  expect(resolvePage(extract(css)).geometry).toMatchObject({ width: 621, height: 810, margin: { top: 144, left: 144 } });

  // A book with no stylesheet at all prints at the manifest's size too.
  expect(projectStyle(await assembleBookHtml({ files: ["a.md"], readText: readA, printArea: DTRPG }))).toContain(SIZE_RULE);
});

test("with no margin anywhere the 1in default is written ahead of every stylesheet, and not once the manifest has margins", async () => {
  const DEFAULT_RULE = "/* page margins (default) */\n@page { margin: 1in; }";
  const css = projectStyle(
    await assembleBookHtml({ files: ["a.md"], readText: readA, pluginCss: "@layer ext.look;\n@layer ext.look {\nbody { color: red }\n}", projectCss: "p { margin: 0 }", printArea: DTRPG }),
  );
  expect(css).toContain(DEFAULT_RULE);
  expect(css.indexOf(DEFAULT_RULE)).toBeGreaterThan(css.indexOf("@layer gp.vocab {"));
  expect(css.indexOf(DEFAULT_RULE)).toBeLessThan(css.indexOf("/* extension css */"));
  // What Chromium prints with and what the engine's reader assumes agree.
  expect(resolvePage(extract(css)).geometry.margin).toEqual({ top: 72, right: 72, bottom: 72, left: 72 });
  // A look's margin, later in the cascade, wins over the default.
  const look = projectStyle(
    await assembleBookHtml({ files: ["a.md"], readText: readA, pluginCss: "@layer ext.look;\n@layer ext.look {\n@page { margin: 0.5in }\n}", printArea: DTRPG }),
  );
  expect(look).toContain(DEFAULT_RULE);
  expect(resolvePage(extract(look)).geometry.margin).toEqual({ top: 36, right: 36, bottom: 36, left: 36 });
  // The manifest's margins replace the default: written last, not first.
  const own = projectStyle(
    await assembleBookHtml({ files: ["a.md"], readText: readA, printArea: { ...DTRPG, margin: { top: 54, bottom: 54, inside: 54, outside: 54 } } }),
  );
  expect(own).not.toContain("page margins (default)");
  expect(own).toContain("@page { size: 8.625in 11.25in; margin: 0.75in 0.75in 0.75in 0.75in; }");
});

test("a size in the book's or a look's own plain @page is overridden by the manifest's", async () => {
  for (const projectCss of [
    "@page { size: 6in 9in; margin: 1in }",
    "@media print { @page { size: 6in 9in } }",
    "@page { margin: 1in }\n@page { size: 6in 9in }",
  ]) {
    const css = projectStyle(await assembleBookHtml({ files: ["a.md"], readText: readA, projectCss, printArea: DTRPG }));
    expect(css, projectCss).toContain(SIZE_RULE);
    expect(resolvePage(extract(css)).geometry, projectCss).toMatchObject({ width: 621, height: 810 });
  }
  const pluginCss = "@layer ext.look;\n\n/* look */\n@layer ext.look {\n@page { size: 6in 9in; margin: 1in }\n}";
  const css = projectStyle(
    await assembleBookHtml({ files: ["a.md"], readText: readA, pluginCss, projectCss: "@page { margin: 0.75in }", printArea: DTRPG }),
  );
  expect(resolvePage(extract(css)).geometry).toMatchObject({ width: 621, height: 810, margin: { top: 54 } });
});

test("a named page's size is its own; the book's geometry is still the manifest's", async () => {
  const css = projectStyle(
    await assembleBookHtml({
      files: ["a.md"],
      readText: readA,
      projectCss: "@page cover { size: 7in 10in }\n@page { margin: 1in }",
      printArea: DTRPG,
    }),
  );
  expect(resolvePage(extract(css)).geometry).toMatchObject({ width: 621, height: 810 });
  expect(resolvePage(extract(css), { name: "cover" }).geometry).toMatchObject({ width: 504, height: 720 });
});

test("the manifest's margins are written for both page sides and beat a look's mirrored @page margins", async () => {
  const printArea = { width: 432, height: 648, margin: { top: 61.2, bottom: 61.2, inside: 64.8, outside: 50.4 } };
  const pluginCss =
    "@layer ext.look;\n@layer ext.look {\n@page :left { margin: 0.5in 1in 0.5in 1in }\n@page :right { margin: 0.5in 1in 0.5in 1in }\n}";
  const css = projectStyle(
    await assembleBookHtml({ files: ["a.md"], readText: readA, pluginCss, projectCss: "@page { margin: 2in }", printArea }),
  );
  expect(css).toContain(
    "/* page geometry (manifest) */\n" +
      "@page { size: 6in 9in; margin: 0.85in 0.7in 0.85in 0.9in; }\n" +
      "@page :left { margin: 0.85in 0.9in 0.85in 0.7in; }\n" +
      "@page :right { margin: 0.85in 0.7in 0.85in 0.9in; }",
  );
  const model = extract(css);
  const marginOf = (pseudo: string) =>
    Object.fromEntries(
      Object.entries(resolvePage(model, { pseudos: [pseudo] }).geometry.margin).map(([k, v]) => [k, Math.round(v * 1000) / 1000]),
    );
  // A right-hand page: the inside (binding) margin is its left.
  expect(marginOf("right")).toEqual({ top: 61.2, right: 50.4, bottom: 61.2, left: 64.8 });
  expect(marginOf("left")).toEqual({ top: 61.2, right: 64.8, bottom: 61.2, left: 50.4 });
  // Without `margin` in the manifest, the stylesheets' margins stand.
  const own = projectStyle(
    await assembleBookHtml({ files: ["a.md"], readText: readA, projectCss: "@page { margin: 2in }", printArea: { width: 432, height: 648 } }),
  );
  expect(own).not.toContain("@page :left");
  expect(resolvePage(extract(own)).geometry.margin).toEqual({ top: 144, right: 144, bottom: 144, left: 144 });
});

test("without a print area there is no geometry to supply: nothing is added", async () => {
  const html = await assembleBookHtml({ files: ["a.md"], readText: readA, projectCss: "@page { margin: 1in }" });
  expect(html).not.toContain("page geometry (manifest)");
  expect(html).not.toContain("@page { size:");
});
