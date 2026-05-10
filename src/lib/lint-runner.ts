import { glob } from "glob";
import type { Config } from "stylelint";
import { resolve, dirname } from "node:path";
import { loadManifest, resolveConfig } from "./manifest";
import { log } from "./logger";

export interface LintRunnerOptions {
  files?: string;
  configPath?: string;
  manifest?: string;
}

export interface LintRunnerResult {
  ok: boolean;
  riskyCount: number;
  filesLinted: number;
}

export async function runLint(opts: LintRunnerOptions = {}): Promise<LintRunnerResult> {
  const manifest = await loadManifest(opts.manifest);
  const resolvedConfig = resolveConfig(
    {
      lint: opts.configPath ? { configPath: opts.configPath } : undefined,
    },
    manifest
  );

  const configPath = resolvedConfig.lint.configPath;

  // User-supplied configPath is a runtime path on the host filesystem;
  // dynamic require() is the right call. The default config is dynamically
  // imported so that the bundler embeds it (survives `bun build --compile`)
  // *and* its transitive printsafe-plugin require chain only evaluates on
  // the `print-md lint` command path — not on cold startup of preview/build.
  let stylelintConfig: unknown;
  if (configPath) {
    stylelintConfig = require(resolve(configPath));
  } else {
    stylelintConfig = (await import("../stylelint/stylelint.config.cjs")).default;
  }

  let files: string[];
  if (opts.files) {
    files = await glob([opts.files], { nodir: true, ignore: ["**/*.min.css"] });
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
    return { ok: true, riskyCount: 0, filesLinted: 0 };
  }

  log.info(`Linting ${files.length} CSS file(s)`);

  const { default: stylelint } = await import("stylelint");
  const result = await stylelint.lint({
    files,
    config: stylelintConfig as Config,
    // For user-supplied configs, resolve `extends`/plugin paths relative to
    // the config file. For the bundled default, stylelint resolves against
    // cwd (its built-in fallback) — fine because the default config's
    // `extends: ["stylelint-config-standard"]` gets resolved through the
    // bundled module graph.
    configBasedir: configPath ? dirname(resolve(configPath)) : undefined,
    formatter: "string",
  });

  if (result.report?.trim()) console.log(result.report);

  const hasRealErrors = result.results.some((r) =>
    r.warnings.some(
      (w) =>
        w.severity === "error" && !w.rule?.startsWith("printsafe/no-risky")
    )
  );

  if (hasRealErrors) {
    if (!result.report?.trim()) {
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
    return { ok: false, riskyCount: 0, filesLinted: files.length };
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

  return { ok: true, riskyCount, filesLinted: files.length };
}
