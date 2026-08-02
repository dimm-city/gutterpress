import { test, expect } from "bun:test";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type MarkdownIt from "markdown-it";

import { assembleBookHtml } from "./assemble";
import { inlineStyles } from "../asset-inline";
import { renderChapters } from "./index";

/**
 * STEP A parity test (#33 Phase 2): the pure, node-free `assembleBookHtml`
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
    const nodeHtml = await renderChapters(dir, {
      title: "My Book",
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
    });

    expect(pureHtml).toBe(nodeHtml);
    // Sanity: the assembled HTML carries the rendered markdown + the paged runtime.
    expect(pureHtml).toContain(">Intro</h1>");
    expect(pureHtml).toContain("<strong>world</strong>");
    // Core emits the stable polyfill MARKER, never a live CDN URL — the
    // un-rewritten book.html must have no network dependency.
    expect(pureHtml).toContain("data-pagedjs-polyfill");
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

test("assembleBookHtml wrapChapters parity with renderChapters", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gutterpress-assemble-wrap-"));
  try {
    await mkdir(join(dir, "css"), { recursive: true });
    await writeFile(join(dir, "css/print.css"), "body{}", "utf-8");
    for (const [name, body] of Object.entries(FILES)) {
      await writeFile(join(dir, name), body, "utf-8");
    }
    const files = ["01-intro.md", "02-body.md"];
    const nodeHtml = await renderChapters(dir, {
      title: "Doc",
      styles: ["css/print.css"],
      files,
      wrapChapters: true,
    });
    const { css: wrapCss } = await inlineStyles(dir, ["css/print.css"]);
    const pureHtml = await assembleBookHtml({
      files,
      readText: (rel) => Promise.resolve(FILES[rel]!),
      projectCss: wrapCss,
      title: "Doc",
      wrapChapters: true,
    });
    expect(pureHtml).toBe(nodeHtml);
    expect(pureHtml).toContain('data-chapter-src="01-intro.md"');
    expect(pureHtml).toContain('class="gutterpress-chapter"');
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
    wrapChapters: true,
  });

  expect(html).toContain("<section data-plugin-render>");
  expect(html).toContain('<div class="gutterpress-chapter" data-chapter-src="chapter.md">');
});

test("assembleBookHtml throws on empty file list", async () => {
  await expect(
    assembleBookHtml({ files: [], readText: () => Promise.resolve("") }),
  ).rejects.toThrow(/no markdown files/i);
});
