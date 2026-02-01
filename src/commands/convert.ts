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
      description: "Input directory containing markdown files",
    },
    out: {
      type: "string",
      description: "Output directory for HTML",
    },
    title: {
      type: "string",
      description: "Document title",
    },
    styles: {
      type: "string",
      description: "Comma-separated CSS paths to use in HTML link tags",
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
        styles: args.styles ? args.styles.split(",") : undefined,
        output: args.out ? { dir: args.out } : undefined,
      },
      manifest
    );

    const inputDir = resolve(args.input ?? ".");
    const outDir = resolve(args.out ?? config.output.dir);

    log.info(`Converting chapters from ${inputDir}`);

    // Log file selection for debugging
    if (config.source.files && config.source.files.length > 0) {
      log.info(`Using specified files (${config.source.files.length} total):`);
      config.source.files.forEach(f => log.info(`  - ${f}`));
    } else {
      log.info(`Using all .md files in alphabetical order (no files specified in manifest)`);
    }

    const outFile = await renderChaptersToFile(inputDir, outDir, {
      title: config.title,
      styles: config.styles,
      files: config.source.files,
      outFilename: config.output.html,
    });

    log.success(`Wrote ${outFile}`);
  },
});
