import { test, expect } from "bun:test";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assembleBookHtml } from "./assemble";
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
  const dir = await mkdtemp(join(tmpdir(), "pmd-assemble-parity-"));
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

    // Pure path: same inputs, in-memory reader.
    const pureHtml = await assembleBookHtml({
      files,
      readText: (rel) => Promise.resolve(FILES[rel] ?? Promise.reject(new Error(`no ${rel}`))),
      styles: ["css/print.css"],
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
    expect(pureHtml).toContain('<link rel="stylesheet" href="css/print.css">');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("assembleBookHtml wrapChapters parity with renderChapters", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pmd-assemble-wrap-"));
  try {
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
    const pureHtml = await assembleBookHtml({
      files,
      readText: (rel) => Promise.resolve(FILES[rel]!),
      styles: ["css/print.css"],
      title: "Doc",
      wrapChapters: true,
    });
    expect(pureHtml).toBe(nodeHtml);
    expect(pureHtml).toContain('data-chapter-src="01-intro.md"');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("assembleBookHtml throws on empty file list", async () => {
  await expect(
    assembleBookHtml({ files: [], readText: () => Promise.resolve(""), styles: [] }),
  ).rejects.toThrow(/no markdown files/i);
});
