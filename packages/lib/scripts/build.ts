#!/usr/bin/env bun
/**
 * Build @dimm-city/print-md-lib → dist/
 *
 * Compiles src/ to Node.js-compatible ESM. All npm deps stay external
 * (packages: "external"). Assets are copied to dist/assets/ so that
 * new URL('../assets/...', import.meta.url) resolves correctly at runtime.
 */

import { cp, rm } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

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
  packages: "external",
  sourcemap: "none",
  minify: false,
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
