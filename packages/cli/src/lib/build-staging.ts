import path from "node:path";
import os from "node:os";
import fsp from "node:fs/promises";
import { pagedjsPolyfillTagRegex } from "./pagedjs-marker";
import { getAssetPath } from "./embedded-assets";

/**
 * HTML string-rewriting for the shippable artifact: turns the raw
 * serialized-paginated DOM that pagination produces into the static desktop HTML
 * (or the runtime-pagination fallback). Pure string/fs transforms — no browser.
 *
 * The former `stagePaginationInput` is GONE. It copied `book.html` plus every
 * asset directory into a temp dir purely so relative URLs would resolve against
 * some root, which cost a second full copy of every asset per build and made the
 * staged tree a second place assets could go missing. `book.html` is now
 * self-contained (CSS and fonts inlined by `lib/asset-inline.ts`), so the
 * pagination pass serves `outDir` directly with in-memory overlays for the
 * engine — see `createStaticFileServer`'s `overlays` in `./pagination.ts`.
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
  //     substring, so the navigation scripts (preview-interface.js /
  //     preview-bridge.js) survive.
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
 * Rewrite the build's ephemeral pagination origin back to document-relative
 * URLs.
 *
 * Paged.js absolutizes every non-`data:` CSS `url()` against the sheet's origin
 * (`replaceUrls`, paged.polyfill.js), so the serialized document comes back
 * pointing at `http://127.0.0.1:<port>/…` — a port that dies with the build.
 * Left alone, a shipped `book.html` references a dead origin for every
 * content-addressed image.
 *
 * The leading slash is stripped along with the origin ON PURPOSE: `book.html`
 * sits at the artifact root, so `assets/x.png` is correct and `/assets/x.png`
 * would break any deployment under a subpath (GitHub Pages project sites).
 */
export function stripPaginationOrigin(html: string): string {
  return html.replace(/https?:\/\/127\.0\.0\.1:\d+\//g, "");
}

/**
 * Inject the navigation-only toolbar scripts (page nav, zoom, view modes) into
 * the static document head. These read the pre-rendered `.pagedjs_page`
 * elements; they do not paginate.
 */
export function injectNavigationScripts(html: string): string {
  const tags =
    '  <script src="preview/scripts/preview-interface.js"></script>\n' +
    '  <script src="preview/scripts/preview-bridge.js"></script>\n';
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, tags + "</head>");
  return tags + html;
}

/**
 * Turn a raw serialized paginated document into the shippable static desktop
 * `book.html`: copy the navigation toolbar scripts, strip the pagination engine
 * and the build's ephemeral origin, wire the nav scripts, and write the file.
 * Shared by the HTML format and the PDF unification path.
 */
export async function finalizeStaticBook(
  rawSerializedHtml: string,
  htmlFile: string,
  outDir: string
): Promise<void> {
  await fsp.mkdir(path.join(outDir, "preview/scripts"), { recursive: true });
  await fsp.copyFile(
    await getAssetPath("preview/scripts/preview-interface.js"),
    path.join(outDir, "preview/scripts/preview-interface.js")
  );
  await fsp.copyFile(
    await getAssetPath("preview/scripts/preview-bridge.js"),
    path.join(outDir, "preview/scripts/preview-bridge.js")
  );
  await fsp.writeFile(
    htmlFile,
    injectNavigationScripts(
      stripPaginationOrigin(stripPaginationRuntime(rawSerializedHtml))
    ),
    "utf-8"
  );
}

/**
 * Fallback for `--format html` when no headless browser is available: ship the
 * Paged.js polyfill + nav scripts so the BROWSER paginates at load time (the
 * pre-SSG behavior). Slower at runtime and not pre-paginated, but it works with
 * no Chromium at build.
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
    await getAssetPath("preview/scripts/preview-interface.js"),
    path.join(outDir, "preview/scripts/preview-interface.js")
  );
  await fsp.copyFile(
    await getAssetPath("preview/scripts/preview-bridge.js"),
    path.join(outDir, "preview/scripts/preview-bridge.js")
  );
  const bookSource = await fsp.readFile(htmlFile, "utf-8");
  const bookWithInterface = bookSource.replace(
    pagedjsPolyfillTagRegex(),
    '<script src="preview/scripts/preview-interface.js"></script>\n  <script src="preview/scripts/preview-bridge.js"></script>\n  <script src="vendor/paged.polyfill.js"></script>'
  );
  await fsp.writeFile(htmlFile, bookWithInterface, "utf-8");
}

/**
 * `--format html --engine native`: ship the self-contained `book.html`
 * (already fully inlined — see `lib/asset-inline.ts`) alongside a copy of the
 * viewer bundle, with one `<script src="engine/gutterpress-viewer.js">`
 * injected before `</head>`. The viewer paginates the document in the
 * browser on load — no headless Chromium at build time, no DOM
 * serialization (see the "Not snapshotting the viewer's fragmented DOM" note
 * in the migration plan).
 */
export async function shipViewerHtml(
  htmlFile: string,
  outDir: string
): Promise<void> {
  await fsp.mkdir(path.join(outDir, "engine"), { recursive: true });
  await fsp.copyFile(
    await getAssetPath("engine/gutterpress-viewer.js"),
    path.join(outDir, "engine/gutterpress-viewer.js")
  );
  const tag = '  <script src="engine/gutterpress-viewer.js"></script>\n';
  const html = await fsp.readFile(htmlFile, "utf-8");
  await fsp.writeFile(
    htmlFile,
    /<\/head>/i.test(html) ? html.replace(/<\/head>/i, tag + "</head>") : tag + html,
    "utf-8"
  );
}

/**
 * Create a unique scratch directory under the OS temp dir. Now used ONLY for
 * PDF/X intermediates (`raw.pdf`, Ghostscript work files) — never for staging
 * assets. Must not be resolved against `process.cwd()`: `runBuild` is exported
 * and called by the desktop host, so writing scratch dirs into the caller's
 * directory is a hidden side effect. Callers remove it in a `finally`.
 */
export async function createStageRoot(): Promise<string> {
  return fsp.mkdtemp(path.join(os.tmpdir(), "gutterpress-stage-"));
}
