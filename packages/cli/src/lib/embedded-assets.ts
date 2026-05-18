/**
 * Embedded preview assets (favicon, manifest schema, paged.js polyfill,
 * iframe interface + cross-origin bridge).
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
 *
 * Viewer chrome (toolbar HTML, preview.js, preview.css, toast.*) was
 * removed 2026-05-18; lives in packages/viewer.
 */

import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import favicon from "../assets/favicon.ico" with { type: "file" };
import manifestSchema from "../assets/manifest.schema.json" with { type: "file" };
import pagedjsInterfaceJs from "../assets/preview/scripts/pagedjs-interface.js" with { type: "file" };
import pagedjsBridgeJs from "../assets/preview/scripts/pagedjs-bridge.js" with { type: "file" };
import pagedPolyfill from "../assets/vendor/paged.polyfill.js" with { type: "file" };

const filePath = (v: unknown): string => v as string;

// Manifest of asset path → embedded source. Keys are paths relative to the
// extracted assets dir; values are paths into the bundle.
const EMBEDDED_ASSETS: Record<string, string> = {
  "favicon.ico": favicon,
  "manifest.schema.json": filePath(manifestSchema),
  "preview/scripts/pagedjs-interface.js": filePath(pagedjsInterfaceJs),
  "preview/scripts/pagedjs-bridge.js": filePath(pagedjsBridgeJs),
  "vendor/paged.polyfill.js": filePath(pagedPolyfill),
};

let extractPromise: Promise<string> | null = null;

async function extractAssets(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "print-md-assets-"));
  for (const [relPath, srcPath] of Object.entries(EMBEDDED_ASSETS)) {
    const dest = join(root, relPath);
    await mkdir(dirname(dest), { recursive: true });
    const bytes = await Bun.file(srcPath).bytes();
    await writeFile(dest, bytes);
  }
  return root;
}

/**
 * Resolve the assets directory, extracting embedded copies on first use.
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
