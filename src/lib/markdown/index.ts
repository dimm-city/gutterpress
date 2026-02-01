import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import MarkdownIt from "markdown-it";
import markdownItAttrs from "markdown-it-attrs";
import markdownItContainer from "markdown-it-container";
import {
  renderContainerOpen,
  createNamedContainer,
  createAliasedContainer,
  createSidebarContainer,
} from "./containers";
import { fixImagePaths } from "./images";
import { registerCustomHrRule } from "./page-marker-hr";
import { pageMarkerPlugin } from "./page-marker-plugin";

/**
 * Get the preview CSS content
 * Reads the preview.css file and returns its content for inlining
 */
async function getPreviewCss(): Promise<string> {
  try {
    const thisDir = dirname(fileURLToPath(import.meta.url));
    const projectRoot = dirname(dirname(dirname(thisDir))); // src/lib/markdown -> src -> project root
    const cssPath = join(projectRoot, 'src', 'assets', 'preview', 'styles', 'preview.css');
    return await readFile(cssPath, 'utf-8');
  } catch (error) {
    console.warn('Failed to load preview.css:', error);
    return '';
  }
}

/**
 * Create a fully-configured MarkdownIt instance with all container plugins.
 */
export function createMarkdownRenderer(): MarkdownIt {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
  });

  md.use(markdownItAttrs);
  md.use(markdownItContainer, "page", {
    marker: ":",
    render(tokens: any, idx: number) {
      const token = tokens[idx];
      if (token.nesting === 1) {
        const m = token.info.trim().match(/^page\s*(.*)$/);
        return renderContainerOpen("page-break", token, m?.[1]);
      }
      return "</div>\n";
    },
  });
  md.use(markdownItContainer, "sidebar", createSidebarContainer(md));
  md.use(markdownItContainer, "wrapper", {
    marker: ":",
    render(tokens: any, idx: number) {
      const token = tokens[idx];
      if (token.nesting === 1) {
        const m = token.info.trim().match(/^wrapper\s*(.*)$/);
        return renderContainerOpen("wrapper", token, m?.[1]);
      }
      return "</div>\n";
    },
  });
  md.use(markdownItContainer, "ability", createNamedContainer("ability"));
  md.use(
    markdownItContainer,
    "ability-continued",
    createAliasedContainer("ability-continued", "ability")
  );
  md.use(markdownItContainer, "specialty", createNamedContainer("specialty"));
  md.use(
    markdownItContainer,
    "learning-path",
    createNamedContainer("learning-path")
  );
  md.use(markdownItContainer, "container", createNamedContainer("container"));
  md.use(markdownItContainer, "aug", createNamedContainer("aug"));
  md.use(markdownItContainer, "two-column", createNamedContainer("two-column"));

  // Register page marker support (order matters: hr rule first, then plugin)
  registerCustomHrRule(md);
  md.use(pageMarkerPlugin);

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
  } = {}
): Promise<string> {
  const title = opts.title ?? "Document";
  const styles = resolveStyles(inputDir, opts.styles);
  const previewCss = await getPreviewCss();

  const md = createMarkdownRenderer();

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
      html = `<section class="chapter" id="${id}">\n${html}\n</section>`;
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
  ${previewCss ? `<style>\n${previewCss}\n</style>` : ''}
  <script src="https://unpkg.com/pagedjs/dist/paged.polyfill.js"></script>
</head>
<body>
${bodyContent}
</body>
</html>`;
}

/**
 * Render chapters and write the result to a file.
 */
export async function renderChaptersToFile(
  inputDir: string,
  outDir: string,
  opts: {
    title?: string;
    styles?: string[];
    files?: string[] | null;
    outFilename?: string;
  } = {}
): Promise<string> {
  await mkdir(outDir, { recursive: true });
  const html = await renderChapters(inputDir, {
    title: opts.title,
    styles: opts.styles,
    files: opts.files,
  });
  const outFile = join(outDir, opts.outFilename ?? "index.html");
  await writeFile(outFile, html);
  return outFile;
}
