/**
 * Embedded preview assets (favicon, manifest schema, paged.js polyfill,
 * iframe interface + cross-origin bridge).
 *
 * Assets are referenced via `new URL('../assets/...', import.meta.url)`, which
 * works in three contexts:
 *  - Dev (bun src/cli.ts): resolves to real disk paths
 *  - Compiled binary (bun build --compile): Bun embeds files referenced by
 *    this pattern and maps them into the binary's bunfs
 *  - Node.js (inside Electron): resolves to real disk paths in node_modules
 *
 * On first use we copy everything into a per-process temp directory and return
 * that as the "assets dir", letting existing call sites keep using plain
 * readFile/cp without caring whether the source lives on disk or inside the
 * executable.
 *
 * Viewer chrome (toolbar HTML, preview.js, preview.css, toast.*) was
 * removed 2026-05-18; lives in packages/viewer.
 */

import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const EMBEDDED_ASSETS: Record<string, URL> = {
  "favicon.ico": new URL("../assets/favicon.ico", import.meta.url),
  "manifest.schema.json": new URL("../assets/manifest.schema.json", import.meta.url),
  "preview/scripts/pagedjs-interface.js": new URL("../assets/preview/scripts/pagedjs-interface.js", import.meta.url),
  "preview/scripts/pagedjs-bridge.js": new URL("../assets/preview/scripts/pagedjs-bridge.js", import.meta.url),
  "vendor/paged.polyfill.js": new URL("../assets/vendor/paged.polyfill.js", import.meta.url),
};

let extractPromise: Promise<string> | null = null;

async function extractAssets(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "print-md-assets-"));
  for (const [relPath, srcUrl] of Object.entries(EMBEDDED_ASSETS)) {
    const dest = join(root, relPath);
    await mkdir(dirname(dest), { recursive: true });
    const bytes = await readFile(srcUrl);
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
