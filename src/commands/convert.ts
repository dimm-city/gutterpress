import { defineCommand } from "citty";
import { resolve } from "node:path";
import { loadManifest, resolveConfig } from "../lib/manifest";
import { renderChaptersToFile } from "../lib/markdown/index";
import { log } from "../lib/logger";

export default defineCommand({
  meta: {
    name: "convert",
    description: "Convert Markdown chapters to a single HTML file",
  },
  args: {
    input: {
      type: "string",
      description: "Input directory containing chapter-*.md files",
    },
    out: {
      type: "string",
      description: "Output directory for HTML",
    },
    title: {
      type: "string",
      description: "Document title",
    },
    "css-path": {
      type: "string",
      description: "CSS path to use in HTML link tag",
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
        title: args.title,
        source: args["css-path"] ? { css: args["css-path"] } : undefined,
        output: args.out ? { dir: args.out } : undefined,
      },
      manifest
    );

    const inputDir = resolve(args.input ?? ".");
    const outDir = resolve(args.out ?? config.output.dir);

    log.info(`Converting chapters from ${inputDir}`);

    const outFile = await renderChaptersToFile(inputDir, outDir, {
      title: config.title,
      cssPath: config.source.css,
      outFilename: config.output.html,
    });

    log.success(`Wrote ${outFile}`);
  },
});
