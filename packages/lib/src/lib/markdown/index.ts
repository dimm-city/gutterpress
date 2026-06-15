import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import MarkdownIt from "markdown-it";
import { BOOK_HTML_FILENAME } from "../viewer";
import markdownItAttrs from "markdown-it-attrs";
import markdownItFootnote from "markdown-it-footnote";
import markdownItPaged, { PAGED_CSS } from "./markdown-it-paged.js";
import markdownItSourceMap from "markdown-it-source-map";
import { registerImageRule } from "./images";
import { canonicalChapterId } from "./chapter-id";
import type { LoadedPlugin } from "./plugins";
import { applyPlugins } from "./plugins";

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
export function createMarkdownRenderer(customPlugins?: LoadedPlugin[]): MarkdownIt {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
  });

  // Some of these plugins ship as `exports.default = fn` (webpack-style CJS
  // with `__esModule: true`). Bun's runtime auto-unwraps `{ default: fn }`
  // to the function in dev mode; the standalone-binary loader does not, so
  // the import surfaces as `{ default: fn }` and `md.use` blows up with
  // "plugin.apply is not a function". Unwrap defensively.
  const unwrap = <T>(plugin: T): T =>
    (plugin && typeof plugin === "object" && "default" in (plugin as object)
      ? ((plugin as unknown as { default: T }).default)
      : plugin);

  md.use(unwrap(markdownItAttrs));
  md.use(unwrap(markdownItFootnote));
  md.use(unwrap(markdownItSourceMap));
  md.use(unwrap(markdownItPaged));

  // Image src normalization (token-level renderer rule).
  registerImageRule(md);

  // Apply custom plugins from manifest
  if (customPlugins && customPlugins.length > 0) {
    applyPlugins(md, customPlugins);
  }

  return md;
}

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
  const title = opts.title ?? "Document";
  const styles = resolveStyles(inputDir, opts.styles);
  const pluginCss = opts.pluginCss ?? '';

  const md = createMarkdownRenderer(opts.plugins);

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

  // Source files concatenate directly into the body. @chapter (DC plugin)
  // owns chapter wrappers and IDs; print-md core does not impose a file-level
  // wrapper. Removed 2026-05-17 — previously emitted <section class="chapter">
  // (and briefly chapter-file) but it was never required by any consumer.
  let bodyContent = "";
  for (const file of files) {
    // ONE canonical identity per chapter (see chapter-id.ts): the same
    // normalized string is used to resolve the file on disk AND as the
    // data-chapter-src tag. The file-watcher broadcasts the identical form,
    // and the preview shell matches the two strings exactly to splice a
    // single edited chapter. Normalizing before join() also makes
    // Windows-authored manifest entries (`chapters\03.md`) readable on
    // POSIX hosts.
    const chapterId = canonicalChapterId(file);
    const filePath = join(inputDir, chapterId);
    try {
      const content = await readFile(filePath, "utf-8");
      const rendered = md.render(content);
      if (opts.wrapChapters) {
        const safe = chapterId.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
        bodyContent += `<div class="pmd-chapter" data-chapter-src="${safe}">\n${rendered}\n</div>\n`;
      } else {
        bodyContent += rendered + "\n";
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to read file ${file}: ${errorMsg}`);
    }
  }

  // Inject markdown-it-paged + user-plugin CSS as a single <style> block.
  // PAGED_CSS is treated identically to user plugin css — the only built-in
  // plugin that ships CSS routes through the same pipeline as user plugins,
  // so the cascade story is uniform.
  const inlineCss = [
    `/* markdown-it-paged */\n${PAGED_CSS.trim()}`,
    pluginCss ? `/* user plugin css */\n${pluginCss.trim()}` : null,
  ].filter(Boolean).join("\n\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  ${styles.map(s => `<link rel="stylesheet" href="${s}">`).join('\n  ')}
  <style>\n${inlineCss}\n</style>
  <script src="https://unpkg.com/pagedjs@0.4.3/dist/paged.polyfill.js"></script>
</head>
<body>
${bodyContent}
</body>
</html>`;
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
