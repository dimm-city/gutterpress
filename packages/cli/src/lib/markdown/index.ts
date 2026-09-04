import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { isOnlineSibling } from "../remote-auth/sync-messages";
import { join } from "node:path";
import { BOOK_HTML_FILENAME } from "../desktop";
import { canonicalChapterId } from "./chapter-id";
import { assembleBookHtml, type LayoutWarning } from "./assemble";
import { resolveActiveStyles } from "../style-resolver";
import { inlineStyles, type AssetCopy } from "../asset-inline";
import type { LoadedPlugin } from "./renderer";

export type { LayoutWarning } from "./assemble";


/**
 * THE canonical "which markdown files make up this book, and in what order?"
 * resolver — markdown's counterpart to `resolveActiveStyles` (style-resolver.ts).
 * Both `renderChapters` below AND validation/lint (validation-exec.ts,
 * lint-runner.ts) call this, so what gets checked is always what gets rendered
 * (2026-07-28 duplication audit — those two used to each re-derive their own
 * recursive-glob approximation of "the book's markdown files" instead of
 * calling this):
 *   1. `configuredFiles` (the manifest `source.files` list), if it has entries,
 *      in that order; else
 *   2. every `.md` file directly inside `inputDir` — NOT recursive, since a
 *      book's chapters live at the project root by convention — alphabetically.
 * Returned entries are exactly as authored/discovered (relative to `inputDir`,
 * un-normalised); callers that need a readable path must resolve them the same
 * way `renderChapters` does below (`join(inputDir, canonicalChapterId(f))`).
 */
export async function resolveActiveMarkdownFiles(
  inputDir: string,
  configuredFiles?: string[] | null
): Promise<string[]> {
  if (configuredFiles && configuredFiles.length > 0) return configuredFiles;
  // `.online` siblings are Gutterpress's own keep-both artifacts, not
  // chapters: a sync that cannot merge two versions of chapter-04.md
  // writes chapter-04.online.md beside it. Globbing it in would render
  // the online copy as a duplicate chapter and print it.
  return (await readdir(inputDir))
    .filter((f: string) => f.endsWith(".md") && !isOnlineSibling(f))
    .sort();
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
 * markdown→HTML→book.html work, so browser consumers of `gutterpress/render`
 * can reuse the exact same render path with a host-supplied reader.
 */
export async function renderChapters(
  inputDir: string,
  opts: {
    title?: string;
    styles?: string[];
    files?: string[] | null;
    plugins?: LoadedPlugin[];
    pluginCss?: string;
    /** Wrap each source file for incremental preview pagination. */
    wrapChapters?: boolean;
    /** Add source-file ids to source-mapped preview blocks without wrappers. */
    annotateSourceChapters?: boolean;
    /**
     * ARCH finding #4: per-chapter author-mistake warnings computed by
     * Gutterpress's marker parser (`env.layoutWarnings`), forwarded straight
     * through from {@link assembleBookHtml}. See that option's docstring — omitting
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

  // Determine which files to process (manifest `source.files` in order, else
  // every root-level .md file alphabetically) — see resolveActiveMarkdownFiles.
  const files = await resolveActiveMarkdownFiles(inputDir, opts.files);

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
    // SHIM — spec gap #152. Every staged CSS image gets a
    // `<link rel="preload" as="image">`, or Chromium prints an `@page`
    // background as blank paper. See `preloadImages` in ./assemble.ts for the
    // full rationale and the canary that says when to delete this.
    preloadImages: inlined.copies.map((c) => c.to),
    title: opts.title,
    plugins: opts.plugins,
    pluginCss: opts.pluginCss,
    wrapChapters: opts.wrapChapters,
    annotateSourceChapters: opts.annotateSourceChapters,
    onChapterWarnings: opts.onChapterWarnings,
    onImageRefs: opts.onImageRefs,
  });
}

/**
 * Render chapters and write the result to a file.
 *
 * The output filename is fixed at `book.html` (BOOK_HTML_FILENAME) — the
 * gutterpress desktop (`index.html`) loads this via a relative iframe `src`.
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
