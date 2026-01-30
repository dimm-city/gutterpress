import { defineCommand } from "citty";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadManifest, resolveConfig } from "../lib/manifest";
import { copyDir } from "../lib/exec";
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

    for (const dir of config.source.assets) {
      if (skipMap[dir]) continue;
      const src = join(inputDir, dir);
      if (existsSync(src)) {
        log.info(`Copying ${dir}/`);
        await copyDir(src, join(outDir, dir));
      } else {
        log.warn(`${dir}/ not found at ${src} (skipping)`);
      }
    }

    log.success("Asset copy complete");
  },
});
