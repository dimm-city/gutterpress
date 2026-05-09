import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitViewer, BOOK_HTML_FILENAME } from "./viewer";

describe("emitViewer", () => {
  let outDir: string;

  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), "print-md-viewer-"));
  });

  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
  }, 60000);

  test("writes index.html with data-mode='static'", async () => {
    await emitViewer(outDir);
    const html = await readFile(join(outDir, "index.html"), "utf-8");
    expect(html).toContain('data-mode="static"');
    expect(html).not.toContain('data-mode="live"');
  });

  test("iframe loads the book HTML by relative filename", async () => {
    await emitViewer(outDir);
    const html = await readFile(join(outDir, "index.html"), "utf-8");
    // Iframe src must be relative `book.html` so subpath hosting works
    expect(html).toContain('src="book.html"');
    expect(html).not.toContain('src="/preview.html"');
    expect(html).not.toContain('src="/book.html"');
  });

  test("copies preview/scripts and preview/styles", async () => {
    await emitViewer(outDir);
    const previewJs = await stat(join(outDir, "preview", "scripts", "preview.js"));
    const previewCss = await stat(join(outDir, "preview", "styles", "preview.css"));
    expect(previewJs.isFile()).toBe(true);
    expect(previewCss.isFile()).toBe(true);
  });

  test("uses relative paths for viewer scripts and styles", async () => {
    await emitViewer(outDir);
    const html = await readFile(join(outDir, "index.html"), "utf-8");
    // Must be relative so subpath hosting (e.g. user.github.io/repo/) works.
    expect(html).toContain('src="preview/scripts/');
    expect(html).toContain('href="preview/styles/');
    expect(html).not.toContain('src="/preview/scripts/');
    expect(html).not.toContain('href="/preview/styles/');
  });

  test("is idempotent — calling twice does not throw", async () => {
    await emitViewer(outDir);
    await emitViewer(outDir); // overwrites in place
    const html = await readFile(join(outDir, "index.html"), "utf-8");
    expect(html).toContain('data-mode="static"');
  });

  test("BOOK_HTML_FILENAME is the filename the iframe loads", async () => {
    expect(BOOK_HTML_FILENAME).toBe("book.html");
    await emitViewer(outDir);
    const html = await readFile(join(outDir, "index.html"), "utf-8");
    expect(html).toContain(`src="${BOOK_HTML_FILENAME}"`);
  });
});
