#!/usr/bin/env bun
/**
 * Build the @dimm-city/print-md npm package → dist/cli.js
 *
 * Bundles src/cli.ts + @dimm-city/print-md-lib into a single Node.js-
 * compatible ESM file. lib is a private workspace package so it cannot be
 * listed as an npm dep — instead its source is compiled in here.
 *
 * Runtime npm deps (chokidar, puppeteer-core, ws, etc.) are kept external
 * and listed in package.json "dependencies" so npm installs them.
 *
 * Usage: bun scripts/build-npm.ts
 */

import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

// All npm packages that should be imported at runtime (not bundled).
// @dimm-city/print-md-lib is intentionally NOT here — it gets bundled in.
const EXTERNAL = [
  "chokidar", "glob", "citty",
  "markdown-it", "markdown-it-attrs", "markdown-it-footnote", "markdown-it-source-map",
  "pagedjs", "puppeteer-core", "yaml", "ws",
  "stylelint", "stylelint-config-standard", "htmlhint", "markdownlint-cli2",
];

await rm(join(ROOT, "dist"), { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: [join(ROOT, "src/cli.ts")],
  outdir: join(ROOT, "dist"),
  target: "node",
  format: "esm",
  external: EXTERNAL,
  // Resolve @dimm-city/print-md-lib via its `bun` export condition (src/) so
  // its `with { type: "file" }` assets (paged.polyfill, favicon, ICC profile,
  // …) are re-emitted next to cli.js with correct relative paths. Resolving
  // the `default` export (dist/) instead inlines stale asset path strings whose
  // files never get copied → runtime ENOENT on the embedded assets.
  conditions: ["bun"],
  sourcemap: "none",
  minify: false,
  banner: "#!/usr/bin/env node",
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

const outputPath = join(ROOT, "dist", "cli.js");
const output = await readFile(outputPath, "utf8");
const normalizedOutput = output.replace(/^(?:#!.*\n|\/\/ @bun\n)+/, "");

await writeFile(outputPath, `#!/usr/bin/env node\n${normalizedOutput}`);

console.log("✓ dist/cli.js built for npm distribution");
