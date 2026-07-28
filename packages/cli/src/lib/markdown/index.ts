import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { BOOK_HTML_FILENAME } from "../viewer";
import { canonicalChapterId } from "./chapter-id";
import { assembleBookHtml, type LayoutWarning } from "./assemble";
import { resolveActiveStyles } from "../style-resolver";
import { inlineStyles, type AssetCopy } from "../asset-inline";
import type { LoadedPlugin } from "./renderer";

export type { LayoutWarning } from "./assemble";

// Re-export the pure render core so existing callers
// (`import { createMarkdownRenderer } from "./markdown/index"`) keep working.
// The factory + plugin author types now live in the node-free `renderer.ts`
// (so the browser/PWA can import them) and are surfaced here unchanged.
export { createMarkdownRenderer } from "./renderer";

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
    /**
     * ARCH finding #4: per-chapter author-mistake warnings computed by
     * markdown-it-paged (`env.layoutWarnings`), forwarded straight through
     * from {@link assembleBookHtml}. See that option's docstring — omitting
     * it is fully backward compatible.
     */
    onChapterWarnings?: (file: string, warnings: LayoutWarning[]) => void;
    /** See {@link assembleBookHtml}'s option of the same name. */
    onImageRefs?: (refs: string[]) => void;
    /**
     * Files the inlined CSS needs alongside the book (content-addressed images
     * too large to embed). The build adds these to its copy plan.
     */
    onCssAssets?: (copies: AssetCopy[]) => void;
    /** Non-fatal notices from the inliner (e.g. a remote `url()` left as-is). */
    onStyleWarnings?: (warnings: string[]) => void;
  } = {}
): Promise<string> {
  // The SAME resolver the editor uses, so what gets inlined is always the file
  // the Design/Edit-CSS surface edits (no "design doesn't change preview").
  const styles = await resolveActiveStyles(inputDir, opts.styles);
  // Read + inline them here (fonts become data: URIs, oversized CSS images get
  // a copy plan). A stylesheet is a file to READ, never a file to ship, so its
  // location — themes/, ../design-guide/, anywhere — has no effect on output.
  const inlined = await inlineStyles(inputDir, styles);
  if (inlined.warnings.length > 0) opts.onStyleWarnings?.(inlined.warnings);
  if (inlined.copies.length > 0) opts.onCssAssets?.(inlined.copies);

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
    projectCss: inlined.css,
    title: opts.title,
    plugins: opts.plugins,
    pluginCss: opts.pluginCss,
    wrapChapters: opts.wrapChapters,
    onChapterWarnings: opts.onChapterWarnings,
    onImageRefs: opts.onImageRefs,
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
    /** ARCH finding #4 — see {@link renderChapters}'s option of the same name. */
    onChapterWarnings?: (file: string, warnings: LayoutWarning[]) => void;
    /** See {@link renderChapters}'s options of the same names. */
    onImageRefs?: (refs: string[]) => void;
    onCssAssets?: (copies: AssetCopy[]) => void;
    onStyleWarnings?: (warnings: string[]) => void;
  } = {}
): Promise<string> {
  await mkdir(outDir, { recursive: true });
  const html = await renderChapters(inputDir, {
    title: opts.title,
    styles: opts.styles,
    files: opts.files,
    plugins: opts.plugins,
    pluginCss: opts.pluginCss,
    onChapterWarnings: opts.onChapterWarnings,
    onImageRefs: opts.onImageRefs,
    onCssAssets: opts.onCssAssets,
    onStyleWarnings: opts.onStyleWarnings,
  });
  const outFile = join(outDir, BOOK_HTML_FILENAME);
  await writeFile(outFile, html);
  return outFile;
}
