#!/usr/bin/env bun
/**
 * Build @dimm-city/print-md-lib → dist/
 *
 * Compiles src/ to Node.js-compatible ESM. All npm deps stay external.
 * Assets referenced via `with { type: "file" }` in embedded-assets.ts are
 * automatically copied to dist/ by Bun with content-hashed filenames and
 * relative import paths rewritten accordingly — no manual copy needed.
 */

import { rm } from "node:fs/promises";
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

const outputs = result.outputs.map((o) => o.path.replace(ROOT + "/", ""));
console.log(`✓ dist/ built (${outputs.length} files: ${outputs.join(", ")})`);
