import path from "node:path";
import os from "node:os";
import fsp from "node:fs/promises";
import { copyAssets, resolveAssetDestName } from "./assets";
import { patchHtmlForPagedjs } from "./pagedjs";
import { pagedjsPolyfillTagRegex } from "./pagedjs-marker";
import { BOOK_HTML_FILENAME } from "./viewer";
import { getAssetPath } from "./embedded-assets";

/**
 * Staging + HTML string-rewriting (ARCH finding #9, extracted from
 * build-runner.ts): prepares the self-contained working copy of a rendered
 * book that the pagination pass (`./pagination.ts`) reads from, and turns the
 * raw serialized-paginated DOM that pagination produces back into the
 * shippable static viewer HTML (or the runtime-pagination fallback). Neither
 * of these responsibilities touches a browser — they are pure string/fs
 * transforms build-runner.ts's two `OutputStrategy` classes call into.
 */

/**
 * Remove the Paged.js pagination ENGINE from an already-paginated, serialized
 * document so the browser renders the static pages as-is and never re-paginates.
 * Strips (a) the polyfill `<script src>` and (b) the inline break-inside handler.
 * Navigation toolbar scripts are NOT touched — they only scroll between pages
 * that already exist, which is not DOM-pagination.
 */
export function stripPaginationRuntime(html: string): string {
  let out = html;
  // (a) The Paged.js polyfill <script> slot — identified by the stable
  //     `data-pagedjs-polyfill` marker OR (post-staging) its `paged.polyfill`
  //     src. The shared matcher deliberately never matches a bare "pagedjs"
  //     substring, so the navigation scripts (pagedjs-interface.js /
  //     pagedjs-bridge.js) survive.
  out = out.replace(pagedjsPolyfillTagRegex(), "");
  // (b) The inline BreakInsideAvoidHandler block (identified by its class name);
  //     it sets window.PagedConfig.* which is dead without the engine.
  out = out.replace(
    /<script\b(?![^>]*\bsrc=)[^>]*>(?:(?!<\/script>)[\s\S])*?BreakInsideAvoidHandler(?:(?!<\/script>)[\s\S])*?<\/script>/gi,
    ""
  );
  return out;
}

/**
 * Inject the navigation-only toolbar scripts (page nav, zoom, view modes) into
 * the static document head. These read the pre-rendered `.pagedjs_page`
 * elements; they do not paginate.
 */
export function injectNavigationScripts(html: string): string {
  const tags =
    '  <script src="preview/scripts/pagedjs-interface.js"></script>\n' +
    '  <script src="preview/scripts/pagedjs-bridge.js"></script>\n';
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, tags + "</head>");
  return tags + html;
}

/**
 * Turn a raw serialized paginated document into the shippable static viewer
 * `book.html`: copy the navigation toolbar scripts into outDir, strip the
 * pagination engine, wire the nav scripts, and write the file. Shared by the
 * HTML format and the PDF unification path.
 */
export async function finalizeStaticBook(
  rawSerializedHtml: string,
  htmlFile: string,
  outDir: string
): Promise<void> {
  await fsp.mkdir(path.join(outDir, "preview/scripts"), { recursive: true });
  await fsp.copyFile(
    await getAssetPath("preview/scripts/pagedjs-interface.js"),
    path.join(outDir, "preview/scripts/pagedjs-interface.js")
  );
  await fsp.copyFile(
    await getAssetPath("preview/scripts/pagedjs-bridge.js"),
    path.join(outDir, "preview/scripts/pagedjs-bridge.js")
  );
  await fsp.writeFile(
    htmlFile,
    injectNavigationScripts(stripPaginationRuntime(rawSerializedHtml)),
    "utf-8"
  );
}

/**
 * Fallback for `--format html` when no headless browser is available: ship the
 * Paged.js polyfill + nav scripts so the BROWSER paginates at load time (the
 * pre-SSG behavior). Slower at runtime and not pre-paginated, but it works with
 * no Chromium at build. Mirrors the historic HTML output exactly.
 */
export async function shipRuntimePaginatedHtml(
  htmlFile: string,
  outDir: string
): Promise<void> {
  await fsp.mkdir(path.join(outDir, "vendor"), { recursive: true });
  await fsp.mkdir(path.join(outDir, "preview/scripts"), { recursive: true });
  await fsp.copyFile(
    await getAssetPath("vendor/paged.polyfill.js"),
    path.join(outDir, "vendor/paged.polyfill.js")
  );
  await fsp.copyFile(
    await getAssetPath("preview/scripts/pagedjs-interface.js"),
    path.join(outDir, "preview/scripts/pagedjs-interface.js")
  );
  await fsp.copyFile(
    await getAssetPath("preview/scripts/pagedjs-bridge.js"),
    path.join(outDir, "preview/scripts/pagedjs-bridge.js")
  );
  const bookSource = await fsp.readFile(htmlFile, "utf-8");
  const bookWithInterface = bookSource.replace(
    pagedjsPolyfillTagRegex(),
    '<script src="preview/scripts/pagedjs-interface.js"></script>\n  <script src="preview/scripts/pagedjs-bridge.js"></script>\n  <script src="vendor/paged.polyfill.js"></script>'
  );
  await fsp.writeFile(htmlFile, bookWithInterface, "utf-8");
}

/**
 * Stage a self-contained working copy of the rendered `htmlFile` (book.html)
 * plus its flattened assets and the vendored Paged.js polyfill into `stageDir`,
 * then patch the staged HTML to load that polyfill. Both pagination passes —
 * the static-HTML `--format html` pass and the PDF render pass — need the
 * identical staged input on a local HTTP origin, so they share this sequence.
 * `stageDir` is wiped and recreated first. Returns the path to the staged book.
 */
export async function stagePaginationInput(
  htmlFile: string,
  outDir: string,
  assetDirs: string[],
  stageDir: string
): Promise<string> {
  await fsp.rm(stageDir, { recursive: true, force: true });
  await fsp.mkdir(stageDir, { recursive: true });
  const stagedHtml = path.join(stageDir, BOOK_HTML_FILENAME);
  await fsp.copyFile(htmlFile, stagedHtml);
  if (assetDirs.length > 0) {
    const flattenedAssetDirs = Array.from(
      new Set(assetDirs.map(resolveAssetDestName))
    );
    await copyAssets(outDir, stageDir, flattenedAssetDirs);
  }
  // Vendor paged.js from embedded assets (works in compiled binary without node_modules)
  await fsp.mkdir(path.join(stageDir, "vendor"), { recursive: true });
  await fsp.copyFile(
    await getAssetPath("vendor/paged.polyfill.js"),
    path.join(stageDir, "vendor/paged.polyfill.js")
  );
  // Inject the break-inside handler + polyfill so pagination AND its cleanup
  // (ghost-card dedupe, orphan-page hide) run during the pagination pass.
  await patchHtmlForPagedjs(stagedHtml, "./vendor/paged.polyfill.js");
  return stagedHtml;
}

/**
 * Create a unique scratch directory for a build's pagination staging under the
 * OS temp dir (mirrors the mkdtemp pattern in lib/embedded-assets.ts). Staging
 * must NOT be resolved against process.cwd(): runBuild is exported and called by
 * the viewer host, so writing scratch dirs into cwd is a hidden side effect that
 * pollutes the caller's directory and breaks concurrent builds (each build now
 * gets its own isolated stage root). Callers must remove the returned directory
 * in a finally block.
 */
export async function createStageRoot(): Promise<string> {
  return fsp.mkdtemp(path.join(os.tmpdir(), "print-md-stage-"));
}
