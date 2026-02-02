import { defineCommand } from "citty";
import { glob } from "glob";
import stylelint from "stylelint";
import { resolve, join } from "node:path";
import { loadManifest, resolveConfig } from "../lib/manifest";
import { log } from "../lib/logger";

export default defineCommand({
  meta: {
    name: "lint",
    description: "Lint CSS for print-safety issues",
  },
  args: {
    files: {
      type: "string",
      description: "Glob pattern for CSS files to lint",
    },
    config: {
      type: "string",
      description: "Path to stylelint config",
    },
    manifest: {
      type: "string",
      description: "Path to manifest.yaml",
    },
  },
  async run({ args }) {
    const manifest = await loadManifest(args.manifest);
    const resolvedConfig = resolveConfig(
      {
        lint: args.config ? { configPath: args.config } : undefined,
      },
      manifest
    );

    const configPath = resolvedConfig.lint.configPath;

    // Load config: custom path or built-in
    let stylelintConfig: any;
    if (configPath) {
      stylelintConfig = require(resolve(configPath));
    } else {
      stylelintConfig = require(
        resolve(join(import.meta.dir, "..", "stylelint", "stylelint.config.cjs"))
      );
    }

    // Resolve files to lint
    let files: string[];
    if (args.files) {
      files = await glob([args.files], { nodir: true, ignore: ["**/*.min.css"] });
    } else {
      const stageGlob = ".build/**/*.css";
      const stageFiles = await glob([stageGlob], {
        nodir: true,
        ignore: ["**/*.min.css"],
      });
      files =
        stageFiles.length > 0
          ? stageFiles
          : await glob(["example/**/*.css", "demos/**/*.css"], {
              ignore: ["node_modules/**", "dist/**"],
            });
    }

    if (files.length === 0) {
      log.warn("No CSS files found to lint");
      return;
    }

    log.info(`Linting ${files.length} CSS file(s)`);

    const result = await stylelint.lint({
      files,
      config: stylelintConfig,
      configBasedir: resolve(join(import.meta.dir, "..")),
      formatter: "string",
    });

    if (result.output?.trim()) console.log(result.output);

    const hasRealErrors = result.results.some((r) =>
      r.warnings.some(
        (w) =>
          w.severity === "error" && !w.rule?.startsWith("printsafe/no-risky")
      )
    );

    if (hasRealErrors) {
      if (!result.output?.trim()) {
        for (const r of result.results) {
          const errors = r.warnings.filter(
            (w) => w.severity === "error" && !w.rule?.startsWith("printsafe/no-risky")
          );
          if (errors.length > 0) {
            log.error(`  ${r.source}`);
            for (const w of errors) {
              log.error(`    ${w.line}:${w.column}  ${w.text}  (${w.rule})`);
            }
          }
        }
      }
      log.error("CSS lint errors found");
      process.exit(2);
    }

    const riskyCount = result.results.reduce(
      (sum, r) =>
        sum +
        r.warnings.filter((w) => w.rule?.startsWith("printsafe/no-risky"))
          .length,
      0
    );

    if (riskyCount > 0) {
      log.warn(
        `${riskyCount} risky print properties found (may cause rasterization)`
      );
      log.warn(
        "The validator will check for actual rasterized pages after PDF generation."
      );
    } else {
      log.success("CSS lint passed");
    }
  },
});
