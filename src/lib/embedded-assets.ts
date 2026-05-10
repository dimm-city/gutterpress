/**
 * Embedded viewer assets (index.html, favicon, manifest schema, preview
 * scripts and styles).
 *
 * The repo holds these in `src/assets/`. In dev (`bun src/cli.ts`) we could
 * read them straight off the filesystem, but for the standalone binary
 * (`bun build --compile`) we have to embed them — the binary's
 * `import.meta.url` points inside `/$bunfs/` and the original `src/assets/`
 * tree is no longer reachable.
 *
 * Each asset is statically imported with `with { type: "file" }`, which
 * gives us a path string that resolves correctly in both dev (real disk
 * path) and compiled (a bunfs path inside the binary). On first use we copy
 * everything into a per-process temp directory and return that as the
 * "assets dir", letting existing call sites keep using plain
 * `readFile`/`cp` without caring whether the source lives on disk or inside
 * the executable.
 */

import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import indexHtml from "../assets/index.html" with { type: "file" };
import favicon from "../assets/favicon.ico" with { type: "file" };
import manifestSchema from "../assets/manifest.schema.json" with { type: "file" };
import toastJs from "../assets/preview/scripts/toast.js" with { type: "file" };
import pagedjsInterfaceJs from "../assets/preview/scripts/pagedjs-interface.js" with { type: "file" };
import previewJs from "../assets/preview/scripts/preview.js" with { type: "file" };
import previewCss from "../assets/preview/styles/preview.css" with { type: "file" };
import toastCss from "../assets/preview/styles/toast.css" with { type: "file" };
import debugCss from "../assets/preview/styles/debug.css" with { type: "file" };
import viewSingleCss from "../assets/preview/styles/view-single.css" with { type: "file" };
import viewTwoColumnCss from "../assets/preview/styles/view-two-column.css" with { type: "file" };

// Manifest of asset path → embedded source. Keys are paths relative to the
// extracted assets dir; values are paths into the bundle.
const EMBEDDED_ASSETS: Record<string, string> = {
  "index.html": indexHtml,
  "favicon.ico": favicon,
  "manifest.schema.json": manifestSchema,
  "preview/scripts/toast.js": toastJs,
  "preview/scripts/pagedjs-interface.js": pagedjsInterfaceJs,
  "preview/scripts/preview.js": previewJs,
  "preview/styles/preview.css": previewCss,
  "preview/styles/toast.css": toastCss,
  "preview/styles/debug.css": debugCss,
  "preview/styles/view-single.css": viewSingleCss,
  "preview/styles/view-two-column.css": viewTwoColumnCss,
};

let extractPromise: Promise<string> | null = null;

async function extractAssets(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "print-md-assets-"));
  for (const [relPath, srcPath] of Object.entries(EMBEDDED_ASSETS)) {
    const dest = join(root, relPath);
    await mkdir(dirname(dest), { recursive: true });
    // `srcPath` is the bunfs path Bun returned for the `with { type: "file" }`
    // import. `Bun.file(...).bytes()` reads the embedded content directly;
    // `copyFile` against the same path fails inside compiled binaries
    // because the bunfs entry isn't a real file the syscall can stat.
    const bytes = await Bun.file(srcPath).bytes();
    await writeFile(dest, bytes);
  }
  return root;
}

/**
 * Resolve the assets directory, extracting embedded copies on first use.
 *
 * The result is a real filesystem path that callers can pass to
 * `readFile`, `cp`, or static file middleware. Cached for the life of the
 * process — the same temp dir is reused across calls.
 */
export async function getAssetsDir(): Promise<string> {
  if (!extractPromise) {
    extractPromise = extractAssets();
  }
  return extractPromise;
}

/**
 * Resolve a single asset path within the extracted assets dir.
 */
export async function getAssetPath(relPath: string): Promise<string> {
  const root = await getAssetsDir();
  return join(root, relPath);
}
