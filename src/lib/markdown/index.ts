import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import MarkdownIt from "markdown-it";
import markdownItAttrs from "markdown-it-attrs";
import markdownItContainer from "markdown-it-container";
import {
  renderContainerOpen,
  createNamedContainer,
  createAliasedContainer,
  createSidebarContainer,
} from "./containers";
import { convertStyledImages, fixImagePaths } from "./images";

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

  return md;
}

/**
 * Resolve which CSS file to link. Uses the explicit value if it exists,
 * otherwise tries common names in the input directory.
 */
function resolveCssPath(inputDir: string, configured?: string): string {
  const candidates = [
    configured,
    "css/print.css",
    "css/index.css",
    "css/style.css",
    "css/main.css",
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    if (existsSync(join(inputDir, c))) return c;
  }
  return configured ?? "css/print.css";
}

/**
 * Render all chapter markdown files to a single HTML string.
 */
export async function renderChapters(
  inputDir: string,
  opts: {
    title?: string;
    cssPath?: string;
    chapterGlob?: string;
  } = {}
): Promise<string> {
  const title = opts.title ?? "Document";
  const cssPath = resolveCssPath(inputDir, opts.cssPath);

  const md = createMarkdownRenderer();

  const files = (await readdir(inputDir))
    .filter((f: string) => f.endsWith(".md") && f.startsWith("chapter-"))
    .sort();

  let bodyContent = "";
  for (const file of files) {
    const content = await readFile(join(inputDir, file), "utf-8");
    const normalizedMarkdown = convertStyledImages(content);
    let html = md.render(normalizedMarkdown);
    const id = file.replace(".md", "");
    html = `<section class="chapter" id="${id}">\n${html}\n</section>`;
    bodyContent += html + "\n";
  }

  bodyContent = fixImagePaths(bodyContent);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link rel="stylesheet" href="${cssPath}">
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
    cssPath?: string;
    outFilename?: string;
  } = {}
): Promise<string> {
  await mkdir(outDir, { recursive: true });
  const html = await renderChapters(inputDir, opts);
  const outFile = join(outDir, opts.outFilename ?? "index.html");
  await writeFile(outFile, html);
  return outFile;
}
