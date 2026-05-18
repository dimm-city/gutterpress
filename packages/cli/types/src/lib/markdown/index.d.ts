import MarkdownIt from "markdown-it";
import type { LoadedPlugin } from "./plugins";
/**
 * Create a fully-configured MarkdownIt instance.
 *
 * Built-in pipeline (runs before any user plugins):
 *   markdown-it-attrs → markdown-it-footnote → markdown-it-source-map
 *   → markdown-it-paged
 *
 * Block container syntax (`:::name ... :::`) was removed 2026-05-17 in favor
 * of the @marker family. See docs/migrations/2026-05-removing-container-syntax.md
 * for the migration mapping.
 *
 * GFM-style `> [!NOTE]` alerts were also moved into the DC plugin on the
 * same date because the emitted classes (dc-alert, dc-vibe-callout, etc.)
 * are DC-branded. Core should not leak DC identifiers.
 *
 * @param customPlugins - Optional array of custom plugins to load
 */
export declare function createMarkdownRenderer(customPlugins?: LoadedPlugin[]): MarkdownIt;
/**
 * Render all chapter markdown files to a single HTML string.
 *
 * If files are specified, they will be included in the provided order.
 * If files are not specified, all .md files in the directory will be included in alphabetical order.
 */
export declare function renderChapters(inputDir: string, opts?: {
    title?: string;
    styles?: string[];
    files?: string[] | null;
    plugins?: LoadedPlugin[];
    pluginCss?: string;
}): Promise<string>;
/**
 * Render chapters and write the result to a file.
 *
 * The output filename is fixed at `book.html` (BOOK_HTML_FILENAME) — the
 * print-md viewer (`index.html`) loads this via a relative iframe `src`.
 */
export declare function renderChaptersToFile(inputDir: string, outDir: string, opts?: {
    title?: string;
    styles?: string[];
    files?: string[] | null;
    plugins?: LoadedPlugin[];
    pluginCss?: string;
}): Promise<string>;
