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

import { existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import favicon from "../assets/favicon.ico" with { type: "file" };
import manifestSchema from "../assets/manifest.schema.json" with { type: "file" };
import previewInterfaceJs from "../assets/preview/scripts/preview-interface.js" with { type: "file" };
import previewBridgeJs from "../assets/preview/scripts/preview-bridge.js" with { type: "file" };
import previewShellJs from "../assets/preview/scripts/preview-shell.js" with { type: "file" };
import pagedPolyfill from "../assets/vendor/paged.polyfill.js" with { type: "file" };
import cmykProfile from "../../profiles/CGATS21_CRPC1.icc" with { type: "file" };

// Gutterpress engine bundles (native pagination — `--engine native`).
// Prebuilt by `scripts/build-engine-bundles.mjs` (part of `npm run build`)
// from `src/engine/{viewer,compiler}` — CLAUDE.md §1 bans a live bundler
// inside packages/cli/src at runtime, so these are ordinary generated/
// committed assets, embedded the same way as the vendored paged.polyfill.js.
import engineViewerJs from "../assets/engine/gutterpress-viewer.js" with { type: "file" };
import engineAgentJs from "../assets/engine/gutterpress-agent.js" with { type: "file" };

// New-project starter templates (#25). Baked in so `gutterpress new` (compiled
// binary) and the desktop wizard scaffold from one embedded source.
import tplBookManifest from "../assets/templates/book/manifest.yaml" with { type: "file" };
import tplBookChapter01 from "../assets/templates/book/chapter-01.md" with { type: "file" };
import tplZineManifest from "../assets/templates/zine/manifest.yaml" with { type: "file" };
import tplZineChapter01 from "../assets/templates/zine/chapter-01.md" with { type: "file" };
import tplTechnicalManifest from "../assets/templates/technical/manifest.yaml" with { type: "file" };
import tplTechnicalChapter01 from "../assets/templates/technical/chapter-01.md" with { type: "file" };

// Built-in themes (#32). Each = theme.css + theme.json, baked in so the Theme
// Manager (compiled binary + desktop) lists/applies from one embedded source.
import themeCleanBookCss from "../assets/themes/clean-book/theme.css" with { type: "file" };
import themeCleanBookJson from "../assets/themes/clean-book/theme.json" with { type: "file" };
import themeZineCss from "../assets/themes/zine/theme.css" with { type: "file" };
import themeZineJson from "../assets/themes/zine/theme.json" with { type: "file" };
import themeTechnicalCss from "../assets/themes/technical-doc/theme.css" with { type: "file" };
import themeTechnicalJson from "../assets/themes/technical-doc/theme.json" with { type: "file" };

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
  "preview/scripts/preview-interface.js":   abs(filePath(previewInterfaceJs)),
  "preview/scripts/preview-bridge.js":      abs(filePath(previewBridgeJs)),
  "preview/scripts/preview-shell.js":       abs(filePath(previewShellJs)),
  "vendor/paged.polyfill.js":               abs(filePath(pagedPolyfill)),
  "profiles/CGATS21_CRPC1.icc":             abs(filePath(cmykProfile)),
  "engine/gutterpress-viewer.js":           abs(filePath(engineViewerJs)),
  "engine/gutterpress-agent.js":            abs(filePath(engineAgentJs)),
  "templates/book/manifest.yaml":           abs(filePath(tplBookManifest)),
  "templates/book/chapter-01.md":           abs(filePath(tplBookChapter01)),
  "templates/zine/manifest.yaml":           abs(filePath(tplZineManifest)),
  "templates/zine/chapter-01.md":           abs(filePath(tplZineChapter01)),
  "templates/technical/manifest.yaml":      abs(filePath(tplTechnicalManifest)),
  "templates/technical/chapter-01.md":      abs(filePath(tplTechnicalChapter01)),
  "themes/clean-book/theme.css":            abs(filePath(themeCleanBookCss)),
  "themes/clean-book/theme.json":           abs(filePath(themeCleanBookJson)),
  "themes/zine/theme.css":                  abs(filePath(themeZineCss)),
  "themes/zine/theme.json":                 abs(filePath(themeZineJson)),
  "themes/technical-doc/theme.css":         abs(filePath(themeTechnicalCss)),
  "themes/technical-doc/theme.json":        abs(filePath(themeTechnicalJson)),
};

let extractPromise: Promise<string> | null = null;

async function extractAssets(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "gutterpress-assets-"));
  for (const [relPath, srcPath] of Object.entries(EMBEDDED_ASSETS)) {
    const dest = join(root, relPath);
    await mkdir(dirname(dest), { recursive: true });
    const bytes = await readFile(srcPath);
    await writeFile(dest, bytes);
  }
  return root;
}

// A sentinel asset whose presence proves the extracted dir is still intact.
// The OS tmp reaper, lifecycle shutdown cleanup, or external cleanup can remove
// the per-process temp dir out from under us; in that case we must re-extract.
const SENTINEL_ASSET = "vendor/paged.polyfill.js";

export async function getAssetsDir(): Promise<string> {
  if (extractPromise) {
    try {
      const root = await extractPromise;
      if (existsSync(join(root, SENTINEL_ASSET))) {
        return root;
      }
    } catch {
      // Prior extraction failed; fall through and retry.
    }
    // Cached dir is gone (or extraction failed) — invalidate and re-extract.
    extractPromise = null;
  }
  extractPromise = extractAssets();
  return extractPromise;
}

export async function getAssetPath(relPath: string): Promise<string> {
  const root = await getAssetsDir();
  return join(root, relPath);
}
