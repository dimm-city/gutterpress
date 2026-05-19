#!/usr/bin/env bun
/**
 * Build Node.js-compatible library output for @dimm-city/print-md.
 *
 * Produces dist/ with compiled JavaScript so the viewer's SvelteKit server
 * can be imported in-process by Electron's built-in Node.js runtime (no Bun
 * subprocess required).
 *
 * Entry points:
 *   src/index.ts   → dist/index.js
 *   src/api/index.ts → dist/api/index.js
 *
 * All runtime npm deps are kept external (imported at runtime from the app's
 * node_modules). Only the CLI's own TypeScript source is compiled.
 *
 * Assets are copied to dist/assets/ so that:
 *   new URL("../assets/favicon.ico", import.meta.url)
 * in dist/lib/embedded-assets.js resolves to dist/assets/favicon.ico.
 */

import { cp, rm } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

// Runtime deps to keep external (not bundled).
const EXTERNAL = [
  // Runtime deps (package.json dependencies)
  "chokidar",
  "glob",
  "citty",
  "markdown-it",
  "markdown-it-attrs",
  "markdown-it-footnote",
  "markdown-it-source-map",
  "pagedjs",
  "puppeteer-core",
  "yaml",
  "ws",
  // Lazy-loaded optional tools (devDependencies)
  "stylelint",
  "stylelint-config-standard",
  "htmlhint",
  "markdownlint-cli2",
  // Playwright is used by puppeteer-core indirectly; keep external
  "playwright",
];

// Clean previous output
await rm(join(ROOT, "dist"), { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: [
    join(ROOT, "src/index.ts"),
    join(ROOT, "src/api/index.ts"),
  ],
  outdir: join(ROOT, "dist"),
  target: "node",
  format: "esm",
  splitting: true,
  minify: false,
  external: EXTERNAL,
  sourcemap: "none",
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

// Copy static assets so new URL('../assets/...', import.meta.url) resolves
// relative to the compiled dist/lib/embedded-assets.js file.
await cp(join(ROOT, "src/assets"), join(ROOT, "dist/assets"), { recursive: true });

const outputs = result.outputs.map((o) => o.path.replace(ROOT + "/", ""));
console.log(`✓ dist/ built (${outputs.length} files: ${outputs.join(", ")})`);
