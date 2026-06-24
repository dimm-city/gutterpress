import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { BOOK_HTML_FILENAME } from "../viewer";
import { canonicalChapterId } from "./chapter-id";
import { assembleBookHtml } from "./assemble";
import type { LoadedPlugin } from "./renderer";

// Re-export the pure render core so existing callers
// (`import { createMarkdownRenderer } from "./markdown/index"`) keep working.
// The factory + plugin author types now live in the node-free `renderer.ts`
// (so the browser/PWA can import them) and are surfaced here unchanged.
export { createMarkdownRenderer } from "./renderer";

/**
 * Resolve which CSS files to link. Uses the explicit list if provided,
 * otherwise tries common names in the input directory.
 */
function resolveStyles(inputDir: string, configured?: string[]): string[] {
  if (configured && configured.length > 0) return configured;

  const fallbacks = ["css/print.css", "css/index.css", "css/style.css", "css/main.css"];
  for (const c of fallbacks) {
    if (existsSync(join(inputDir, c))) return [c];
  }
  return ["css/print.css"];
}

/**
 * Render all chapter markdown files to a single HTML string.
 *
 * If files are specified, they will be included in the provided order.
 * If files are not specified, all .md files in the directory will be included in alphabetical order.
 *
 * This is the thin **Node wrapper** around the pure `assembleBookHtml`
 * (`./assemble.ts`): it resolves the CSS list + the file list off disk and
 * supplies a `node:fs/promises`-backed `readText`. The pure assembler owns the
 * markdown→HTML→book.html work, so the browser/PWA WebAdapter can reuse the
 * exact same render path with a File System Access reader (#33).
 */
export async function renderChapters(
  inputDir: string,
  opts: {
    title?: string;
    styles?: string[];
    files?: string[] | null;
    plugins?: LoadedPlugin[];
    pluginCss?: string;
    /**
     * Wrap each source file's output in `<div class="pmd-chapter"
     * data-chapter-src="<file>">`. Used by the incremental live-preview to
     * identify and re-paginate a single chapter on edit. Off by default — the
     * build output is unaffected.
     */
    wrapChapters?: boolean;
  } = {}
): Promise<string> {
  const styles = resolveStyles(inputDir, opts.styles);

  // Determine which files to process
  let files: string[];
  if (opts.files && opts.files.length > 0) {
    // Use explicit files in the provided order
    files = opts.files;
  } else {
    // Fallback to all .md files in alphabetical order
    files = (await readdir(inputDir))
      .filter((f: string) => f.endsWith(".md"))
      .sort();
  }

  // Validate that files exist
  if (files.length === 0) {
    throw new Error(`No markdown files found in ${inputDir}`);
  }

  return assembleBookHtml({
    files,
    // node:fs reader. The pure assembler passes the canonical chapter id; join()
    // here also makes Windows-authored manifest entries (`chapters\03.md`)
    // readable on POSIX hosts (canonicalChapterId already normalised slashes).
    readText: (relPath) => readFile(join(inputDir, canonicalChapterId(relPath)), "utf-8"),
    styles,
    title: opts.title,
    plugins: opts.plugins,
    pluginCss: opts.pluginCss,
    wrapChapters: opts.wrapChapters,
  });
}

/**
 * Render chapters and write the result to a file.
 *
 * The output filename is fixed at `book.html` (BOOK_HTML_FILENAME) — the
 * print-md viewer (`index.html`) loads this via a relative iframe `src`.
 */
export async function renderChaptersToFile(
  inputDir: string,
  outDir: string,
  opts: {
    title?: string;
    styles?: string[];
    files?: string[] | null;
    plugins?: LoadedPlugin[];
    pluginCss?: string;
  } = {}
): Promise<string> {
  await mkdir(outDir, { recursive: true });
  const html = await renderChapters(inputDir, {
    title: opts.title,
    styles: opts.styles,
    files: opts.files,
    plugins: opts.plugins,
    pluginCss: opts.pluginCss,
  });
  const outFile = join(outDir, BOOK_HTML_FILENAME);
  await writeFile(outFile, html);
  return outFile;
}
