/**
 * Produce the SAME pre-pagination `book.html` the current Gutterpress build
 * hands to Paged.js, so both engines can be run against byte-identical input.
 *
 * Uses the shipped library's own functions (manifest resolution + markdown
 * render), not a reimplementation — whatever Gutterpress feeds Paged.js is
 * exactly what Folio gets.
 */
import path from "node:path";
import { mkdirSync } from "node:fs";
import { loadManifestWithPath, resolveConfig } from "../../../packages/cli/src/lib/manifest.ts";
import { renderChaptersToFile } from "../../../packages/cli/src/lib/markdown/index.ts";
import { loadPluginsWithCss } from "../../../packages/cli/src/lib/markdown/plugins.ts";

const inputDir = path.resolve(process.argv[2] ?? "examples/gutterpress-user-guide");
const outDir = path.resolve(process.argv[3] ?? "/tmp/cmp/staged");

const { manifest, manifestPath } = await loadManifestWithPath(inputDir);
const config = resolveConfig(manifest, { inputDir, manifestPath });
const renderDir = path.dirname(manifestPath);
const { plugins, pluginCss } = await loadPluginsWithCss(config.plugins, renderDir);

mkdirSync(outDir, { recursive: true });
const htmlPath = await renderChaptersToFile(renderDir, outDir, {
  title: config.title,
  styles: config.styles,
  files: config.source.files,
  plugins,
  pluginCss,
});
console.log(htmlPath);
