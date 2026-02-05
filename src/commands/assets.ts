import { defineCommand } from "citty";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { loadManifest, resolveConfig } from "../lib/manifest";
import { copyAssets, resolveAssetDestName } from "../lib/assets";
import { log } from "../lib/logger";

export default defineCommand({
  meta: {
    name: "assets",
    description: "Copy CSS, fonts, and images to the output directory",
  },
  args: {
    input: {
      type: "string",
      description: "Input directory containing asset folders",
    },
    out: {
      type: "string",
      description: "Output directory",
    },
    "skip-css": {
      type: "boolean",
      description: "Skip copying css/",
    },
    "skip-fonts": {
      type: "boolean",
      description: "Skip copying fonts/",
    },
    "skip-images": {
      type: "boolean",
      description: "Skip copying images/",
    },
    manifest: {
      type: "string",
      description: "Path to manifest.yaml",
    },
  },
  async run({ args }) {
    const manifest = await loadManifest(args.manifest ?? args.input);
    const config = resolveConfig(
      {
        output: args.out ? { dir: args.out } : undefined,
        source: undefined,
      },
      manifest
    );

    const inputDir = resolve(args.input ?? ".");
    const outDir = resolve(args.out ?? config.output.dir);

    log.info(`Copying assets from ${inputDir} to ${outDir}`);
    await mkdir(outDir, { recursive: true });

    const skipMap: Record<string, boolean | undefined> = {
      css: args["skip-css"],
      fonts: args["skip-fonts"],
      images: args["skip-images"],
    };

    // Filter out skipped assets
    const assetsToProcess = config.source.assets.filter((dir) => {
      const destName = resolveAssetDestName(dir);
      return !skipMap[destName];
    });

    await copyAssets(inputDir, outDir, assetsToProcess, {
      onCopy: (assetPath) => log.info(`Copying ${assetPath}/`),
      onSkip: (assetPath, srcPath) =>
        log.warn(`${assetPath}/ not found at ${srcPath} (skipping)`),
    });

    log.success("Asset copy complete");
  },
});
