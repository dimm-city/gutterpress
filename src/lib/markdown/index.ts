import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import MarkdownIt from "markdown-it";
import { BOOK_HTML_FILENAME } from "../viewer";
import markdownItAttrs from "markdown-it-attrs";
import markdownItFootnote from "markdown-it-footnote";
import markdownItPaged, { PAGED_CSS } from "./markdown-it-paged.js";
import markdownItSourceMap from "markdown-it-source-map";
import { dcAlertsPlugin } from "./alerts";
import { fixImagePaths } from "./images";
import type { LoadedPlugin } from "./plugins";
import { applyPlugins } from "./plugins";

/**
 * Create a fully-configured MarkdownIt instance.
 *
 * Built-in pipeline (runs before any user plugins):
 *   dcAlertsPlugin → markdown-it-attrs → markdown-it-footnote
 *   → markdown-it-source-map → markdown-it-paged
 *
 * Block container syntax (`:::name ... :::`) was removed 2026-05-17 in favor
 * of the @marker family. See docs/migrations/2026-05-removing-container-syntax.md
 * for the migration mapping.
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

  // DC alert plugin must run before markdownItAttrs so attrs don't interfere
  // with blockquote detection (e.g. `> [!NOTE]{.something}` edge cases).
  md.use(dcAlertsPlugin);
  md.use(unwrap(markdownItAttrs));
  md.use(unwrap(markdownItFootnote));
  md.use(unwrap(markdownItSourceMap));
  md.use(unwrap(markdownItPaged));

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

  let bodyContent = "";
  for (const file of files) {
    const filePath = join(inputDir, file);
    try {
      const content = await readFile(filePath, "utf-8");
      let html = md.render(content);
      const id = file.replace(/\.md$/, "").replace(/\//g, "-");
      html = `<section class="chapter" id="${id}" data-source-file="${file}">\n${html}\n</section>`;
      bodyContent += html + "\n";
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to read file ${file}: ${errorMsg}`);
    }
  }

  bodyContent = fixImagePaths(bodyContent);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  ${styles.map(s => `<link rel="stylesheet" href="${s}">`).join('\n  ')}
  <style>\n/* markdown-it-paged layout CSS */\n${PAGED_CSS}\n</style>
  ${pluginCss ? `<style>\n/* Plugin CSS */\n${pluginCss}\n</style>` : ''}
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
