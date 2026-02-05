import { defineCommand } from "citty";
import { resolve, dirname } from "node:path";
import { loadManifestWithPath, resolveConfig } from "../lib/manifest";
import { renderChaptersToFile } from "../lib/markdown/index";
import { loadPlugins, collectPluginCss } from "../lib/markdown/plugins";
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
    const { manifest, manifestDir } = await loadManifestWithPath(args.manifest ?? args.input);
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

    // Load plugins if configured
    let plugins;
    let pluginCss = '';
    if (config.plugins.length > 0) {
      log.info(`Loading ${config.plugins.length} plugin(s)...`);

      // Plugins paths are relative to the manifest directory
      plugins = await loadPlugins(config.plugins, manifestDir);
      pluginCss = collectPluginCss(plugins);

      if (plugins.length > 0) {
        log.success(`Loaded ${plugins.length} plugin(s)`);
      }
    }

    const outFile = await renderChaptersToFile(inputDir, outDir, {
      title: config.title,
      styles: config.styles,
      files: config.source.files,
      outFilename: config.output.html,
      plugins,
      pluginCss,
    });

    log.success(`Wrote ${outFile}`);
  },
});
