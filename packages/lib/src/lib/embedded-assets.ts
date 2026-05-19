/**
 * Embedded preview assets (favicon, manifest schema, paged.js polyfill,
 * iframe interface + cross-origin bridge).
 *
 * `with { type: "file" }` imports are the canonical embedding mechanism for
 * assets that must be accessible in all three runtime contexts:
 *
 *  - bun build --compile (standalone binary):
 *      Bun embeds the file at a bunfs path and the import returns that absolute
 *      bunfs path as a string. All modules are merged into one root file in
 *      bunfs, so new URL("../assets/...", import.meta.url) does NOT work here
 *      because import.meta.url points to the bundle root, not the source file.
 *      with { type: "file" } correctly gives the embedded absolute path.
 *
 *  - bun run src/cli.ts (development):
 *      The import returns the real absolute disk path to the asset file.
 *
 *  - Node.js via dist/ (Electron in-process):
 *      bun build --target node copies assets alongside the output JS with
 *      hashed filenames and rewrites imports to relative strings like
 *      "./favicon-abc123.ico". We resolve these relative to __libdir so
 *      readFile always gets an absolute path regardless of CWD.
 *
 * On first use we copy everything into a per-process temp directory and return
 * that path, letting call sites use plain readFile/cp without caring about
 * the source format.
 */

import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import favicon from "../assets/favicon.ico" with { type: "file" };
import manifestSchema from "../assets/manifest.schema.json" with { type: "file" };
import pagedjsInterfaceJs from "../assets/preview/scripts/pagedjs-interface.js" with { type: "file" };
import pagedjsBridgeJs from "../assets/preview/scripts/pagedjs-bridge.js" with { type: "file" };
import pagedPolyfill from "../assets/vendor/paged.polyfill.js" with { type: "file" };

// Resolve paths relative to this module's location so that relative string
// paths produced by bun build --target node work regardless of CWD.
const __libdir = dirname(fileURLToPath(import.meta.url));
const abs = (p: string) => resolve(__libdir, p);

// Cast helper for imports where TypeScript infers the module shape rather
// than a plain string (e.g. JSON imports, JS module imports).
const filePath = (v: unknown): string => v as string;

const EMBEDDED_ASSETS: Record<string, string> = {
  "favicon.ico":                            abs(favicon),
  "manifest.schema.json":                   abs(filePath(manifestSchema)),
  "preview/scripts/pagedjs-interface.js":   abs(filePath(pagedjsInterfaceJs)),
  "preview/scripts/pagedjs-bridge.js":      abs(filePath(pagedjsBridgeJs)),
  "vendor/paged.polyfill.js":               abs(filePath(pagedPolyfill)),
};

let extractPromise: Promise<string> | null = null;

async function extractAssets(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "print-md-assets-"));
  for (const [relPath, srcPath] of Object.entries(EMBEDDED_ASSETS)) {
    const dest = join(root, relPath);
    await mkdir(dirname(dest), { recursive: true });
    const bytes = await readFile(srcPath);
    await writeFile(dest, bytes);
  }
  return root;
}

export async function getAssetsDir(): Promise<string> {
  if (!extractPromise) {
    extractPromise = extractAssets();
  }
  return extractPromise;
}

export async function getAssetPath(relPath: string): Promise<string> {
  const root = await getAssetsDir();
  return join(root, relPath);
}
