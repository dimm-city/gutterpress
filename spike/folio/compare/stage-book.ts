/**
 * Produce the SAME pre-pagination `book.html` the current Gutterpress build
 * hands to Paged.js, so both engines can be run against byte-identical input.
 *
 * Uses the shipped library's own functions (manifest resolution + markdown
 * render), not a reimplementation — whatever Gutterpress feeds Paged.js is
 * exactly what Folio gets.
 */
import path from "node:path";
import { copyFile, mkdir } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { loadManifestWithPath, resolveConfig } from "../../../packages/cli/src/lib/manifest.ts";
import { renderChaptersToFile } from "../../../packages/cli/src/lib/markdown/index.ts";
import { loadPluginsWithCss } from "../../../packages/cli/src/lib/markdown/plugins.ts";
import { planImageCopies, type AssetCopy } from "../../../packages/cli/src/lib/asset-inline.ts";

const inputDir = path.resolve(process.argv[2] ?? "examples/gutterpress-user-guide");
const outDir = path.resolve(process.argv[3] ?? "/tmp/cmp/staged");

const { manifest, manifestPath } = await loadManifestWithPath(inputDir);
// resolveConfig's contract is (cliOverrides, manifest) — the old call passed
// the manifest as overrides and a junk object as the manifest, which worked
// only because every real value rode in through the overrides slot. Surfaced
// the moment compare/ entered the typecheck program.
const config = resolveConfig({}, manifest);
const renderDir = manifestPath ? path.dirname(manifestPath) : inputDir;
const { plugins, pluginCss } = await loadPluginsWithCss(config.plugins, renderDir);

mkdirSync(outDir, { recursive: true });

// Gutterpress copies every referenced image and CSS asset next to book.html as
// a SEPARATE build step; rendering alone leaves `src="images/…"` dangling.
// Staging only the HTML silently starved Folio of the entire art programme on
// an image-heavy book — it built 184 pages of text where the real book is 301,
// and the comparison looked like a pagination difference rather than a missing
// input. Mirror the shipped build's asset step so both engines get the same
// document AND the same assets.
const imageRefs: string[] = [];
const cssAssets: AssetCopy[] = [];
const htmlPath = await renderChaptersToFile(renderDir, outDir, {
  title: config.title,
  styles: config.styles,
  files: config.source.files,
  plugins,
  pluginCss,
  onImageRefs: (refs: string[]) => imageRefs.push(...refs),
  onCssAssets: (copies: AssetCopy[]) => cssAssets.push(...copies),
});

const { copies: imageCopies, errors } = await planImageCopies(renderDir, imageRefs);
if (errors.length)
  console.error(`  ${errors.length} unresolved image reference(s):\n    ${errors.join("\n    ")}`);
const copies = [...cssAssets, ...imageCopies];
await Promise.all(
  copies.map(async (c) => {
    const dest = path.join(outDir, c.to);
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(c.from, dest);
  }),
);
console.error(`  staged ${copies.length} referenced asset(s) alongside book.html`);
console.log(htmlPath);
