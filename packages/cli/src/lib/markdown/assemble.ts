/**
 * Pure (node-free) book-HTML assembly.
 *
 * §1/§8 / ADR 0004: imports ONLY the pure render core (`renderer.ts`,
 * `markdown-it-paged.js`, `chapter-id.ts`) — NO `node:*`, NO `fs`/`path`. The
 * caller injects an async `readText(relPath)` so the SAME assembly runs:
 *   - on the CLI / preview server with a `node:fs/promises`-backed reader
 *     (see `renderChapters` in `./index.ts`); and
 *   - in the browser (the PWA WebAdapter, #33) with a File System Access reader.
 *
 * This is the "fix the core primitive" split (CLAUDE.md §0/§6): the file-reading
 * wrapper is the ONLY node-coupled part of the old `renderChapters`, so the pure
 * markdown→HTML→book.html work lives here and the wrapper just supplies inputs.
 */
import { PAGED_CSS } from "./markdown-it-paged.js";
import { canonicalChapterId } from "./chapter-id";
import { createMarkdownRenderer, type LoadedPlugin } from "./renderer";
import { pagedjsPolyfillTag } from "../pagedjs-marker";

/** Reader injected by the host: resolve a project-root-relative file → its text. */
export type ReadText = (relPath: string) => Promise<string>;

export interface AssembleBookHtmlOptions {
  /** Ordered list of project-root-relative `.md` files to concatenate. */
  files: string[];
  /** Async reader the assembler uses to fetch each file's contents. */
  readText: ReadText;
  /** Project-root-relative CSS hrefs to `<link>` (already resolved by the host). */
  styles: string[];
  title?: string;
  plugins?: LoadedPlugin[];
  pluginCss?: string;
  /**
   * Wrap each source file's output in `<div class="pmd-chapter"
   * data-chapter-src="<file>">`. Used by the incremental live-preview to
   * identify and re-paginate a single chapter on edit. Off by default — the
   * build output is unaffected.
   */
  wrapChapters?: boolean;
}

/**
 * Assemble a single `book.html` string from the given markdown files.
 *
 * Pure: every input (the file list, their contents via `readText`, the resolved
 * CSS hrefs) is supplied by the caller. Mirrors the exact `<head>`/body/CSS
 * emission the old `renderChapters` produced, so the CLI output is byte-identical
 * for identical inputs.
 */
export async function assembleBookHtml(opts: AssembleBookHtmlOptions): Promise<string> {
  const title = opts.title ?? "Document";
  const styles = opts.styles;
  const pluginCss = opts.pluginCss ?? "";
  const files = opts.files;

  if (files.length === 0) {
    throw new Error("No markdown files to render");
  }

  const md = createMarkdownRenderer(opts.plugins);

  // Source files concatenate directly into the body. @chapter (DC plugin)
  // owns chapter wrappers and IDs; print-md core does not impose a file-level
  // wrapper.
  let bodyContent = "";
  for (const file of files) {
    // ONE canonical identity per chapter (see chapter-id.ts): the same
    // normalized string is used to resolve the file AND as the data-chapter-src
    // tag. The file-watcher broadcasts the identical form, and the preview
    // shell matches the two strings exactly to splice a single edited chapter.
    const chapterId = canonicalChapterId(file);
    let content: string;
    try {
      content = await opts.readText(chapterId);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to read file ${file}: ${errorMsg}`);
    }
    const rendered = md.render(content);
    if (opts.wrapChapters) {
      const safe = chapterId.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
      bodyContent += `<div class="pmd-chapter" data-chapter-src="${safe}">\n${rendered}\n</div>\n`;
    } else {
      bodyContent += rendered + "\n";
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
  ${pagedjsPolyfillTag()}
</head>
<body>
${bodyContent}
</body>
</html>`;
}
