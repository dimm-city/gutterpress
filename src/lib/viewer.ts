/**
 * Helpers for emitting the print-md viewer chrome into a build output dir.
 *
 * The viewer is the same UI shown during `print-md preview` (toolbar with
 * page nav, zoom, two-column, debug, bg color, print). When a user runs
 * `print-md build`, the same chrome is emitted as `index.html` next to the
 * rendered book HTML, so the output directory is a self-hostable site.
 *
 * Two operating modes for the viewer (encoded as `<html data-mode="...">`):
 *
 * - `live`     a print-md server is backing the UI; folder picker / GitHub
 *              clone / exit / API polling are active.
 * - `static`   deployed as files (GitHub Pages, S3, file://); no API
 *              available; server-coupled buttons hidden.
 */

import { readFile, writeFile, mkdir, cp } from "node:fs/promises";
import { join } from "node:path";

import { getAssetsDir } from "./embedded-assets";

/**
 * Filename used for the rendered book HTML in every output (preview server
 * temp dir, build output dir, static-site dir). The viewer iframe loads this
 * via a relative `src="book.html"`.
 */
export const BOOK_HTML_FILENAME = "book.html";

/**
 * Emit the viewer chrome into `outDir` so the directory becomes a
 * self-hostable site.
 *
 * Writes:
 *   - `${outDir}/index.html`  — the viewer in static mode, iframe → book.html
 *   - `${outDir}/preview/`    — viewer scripts and styles (recursive copy)
 *
 * Idempotent — safe to call repeatedly.
 */
export async function emitViewer(outDir: string): Promise<void> {
  const assetsDir = await getAssetsDir();
  await mkdir(outDir, { recursive: true });

  const templatePath = join(assetsDir, "index.html");
  const template = await readFile(templatePath, "utf-8");

  // Switch the viewer to static mode. The source-of-truth template ships
  // with `data-mode="live"` for the preview server; build emits `static`.
  const staticHtml = template.replace(
    /data-mode="live"/,
    'data-mode="static"'
  );

  await writeFile(join(outDir, "index.html"), staticHtml, "utf-8");

  // Recursively copy the viewer scripts and styles directory.
  const previewSrc = join(assetsDir, "preview");
  const previewDest = join(outDir, "preview");
  await cp(previewSrc, previewDest, { recursive: true });
}
