import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import MarkdownIt from "markdown-it";
import { BOOK_HTML_FILENAME } from "../viewer";
import markdownItAttrs from "markdown-it-attrs";
import markdownItContainer from "markdown-it-container";
import markdownItFootnote from "markdown-it-footnote";
import markdownItPaged from "./markdown-it-paged.js";
import markdownItSourceMap from "markdown-it-source-map";
import {
  renderContainerOpen,
  createNamedContainer,
  createSidebarContainer,
} from "./containers";
import { dcAlertsPlugin } from "./alerts";
import { fixImagePaths } from "./images";
import type { LoadedPlugin } from "./plugins";
import { applyPlugins } from "./plugins";

/* Minimal Paged.js-friendly hooks for @page, @section, @break markers */
const PAGED_CSS = `
.md-page-break { break-before: page; }
.page { break-before: page; }
.spread { break-before: page; }
.section { break-inside: avoid; }
.section.col-split { break-inside: auto; }
.md-column-break { break-after: column; height: 0; font-size: 0; line-height: 0; visibility: hidden; }
`;

/**
 * Create a fully-configured MarkdownIt instance with all container plugins.
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

  // @column-break / @section col-split:
  // Paged.js strips break-after:column during preprocessing so CSS column breaks never fire.
  // Authors opt in with .col-split on @section — the renderer then generates explicit .col
  // wrapper divs, making @column-break the closing/opening div boundary instead.
  // @section .two-column (without .col-split) keeps CSS multi-column balance behavior.
  let colSplitDepth = 0;

  md.renderer.rules.layout_section_open = (tokens, idx, opts, _env, self) => {
    const token = tokens[idx]!;
    const cls = token.attrGet("class") ?? "";

    if (cls.includes("col-split")) {
      // Look ahead for layout_column_break before the matching section_close
      let depth = 1;
      let hasBreak = false;
      for (let i = idx + 1; i < tokens.length; i++) {
        const t = tokens[i]!;
        if (t.type === "layout_section_open") depth++;
        if (t.type === "layout_section_close") { depth--; if (depth === 0) break; }
        if (t.type === "layout_column_break" && depth === 1) { hasBreak = true; break; }
      }
      if (hasBreak) {
        colSplitDepth++;
        return `<div class="${cls}"><div class="col">\n`; // cls already contains 'section col-split'
      }
    }

    return self.renderToken(tokens, idx, opts);
  };

  md.renderer.rules.layout_section_close = (tokens, idx, opts, _env, self) => {
    if (colSplitDepth > 0) {
      colSplitDepth--;
      return `</div></div>\n`;
    }
    return self.renderToken(tokens, idx, opts);
  };

  md.renderer.rules.layout_column_break = (tokens, idx) => {
    if (colSplitDepth > 0) {
      return `</div><div class="col">\n`;
    }
    const cls = tokens[idx]!.attrGet("class") ?? "md-column-break";
    return `<div class="${cls}" aria-hidden="true"></div>\n`;
  };

  md.renderer.rules.layout_page_break = (tokens, idx) => {
    const cls = tokens[idx]!.attrGet("class") ?? "md-page-break";
    return `<div class="${cls}" aria-hidden="true"></div>\n`;
  };

  md.renderer.rules.layout_page_open = (tokens, idx, opts, _env, self) => {
    colSplitDepth = 0;
    return self.renderToken(tokens, idx, opts);
  };

  md.renderer.rules.layout_chapter_open = (tokens, idx, opts, _env, self) => {
    colSplitDepth = 0;
    return self.renderToken(tokens, idx, opts);
  };

  // Removed: :::page (deprecated — use @page), :::wrapper (use named macros),
  // :::ability / :::ability-continued (use @skill / @continue),
  // :::aug (no replacement), :::lede (use @lede macro)
  md.use(markdownItContainer, "sidebar", createSidebarContainer(md));
  md.use(markdownItContainer, "dc-specialty", createNamedContainer("dc-specialty"));
  md.use(
    markdownItContainer,
    "learning-path",
    createNamedContainer("learning-path")
  );
  md.use(markdownItContainer, "container", createNamedContainer("container"));
  md.use(markdownItContainer, "two-column", createNamedContainer("two-column"));
  md.use(markdownItContainer, "three-column", createNamedContainer("three-column"));
  /* specific callout variants must be registered before the generic "callout"
     because markdown-it-container tests in order and "^callout\b" matches all variants */
  md.use(markdownItContainer, "callout-note", createNamedContainer("callout-note"));
  md.use(markdownItContainer, "callout-warning", createNamedContainer("callout-warning"));
  md.use(markdownItContainer, "callout-caution", createNamedContainer("callout-caution"));
  md.use(markdownItContainer, "callout-tip", createNamedContainer("callout-tip"));
  md.use(markdownItContainer, "callout", createNamedContainer("callout"));
  md.use(markdownItContainer, "pull-quote", createNamedContainer("pull-quote"));
  md.use(markdownItContainer, "procedure", createNamedContainer("procedure"));
  md.use(markdownItContainer, "item", createNamedContainer("item"));

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
