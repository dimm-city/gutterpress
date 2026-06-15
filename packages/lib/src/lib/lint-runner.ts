import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { loadManifestWithPath, resolveConfig } from "./manifest";
import { log } from "./logger";
import { checkCss, ruleRiskyProps } from "./printsafe";

export interface LintRunnerOptions {
  files?: string;
  manifest?: string;
}

export interface LintRunnerResult {
  ok: boolean;
  riskyCount: number;
  filesLinted: number;
}

export async function runLint(opts: LintRunnerOptions = {}): Promise<LintRunnerResult> {
  const { glob } = await import("glob");
  const { manifest, manifestDir } = await loadManifestWithPath(opts.manifest);
  // resolveConfig still runs so manifest loading/validation behaves consistently.
  resolveConfig({}, manifest);

  let files: string[];
  if (opts.files) {
    files = await glob([opts.files], { nodir: true, ignore: ["**/*.min.css"] });
  } else if (manifest.styles?.length) {
    files = await glob(
      manifest.styles.map((stylePath) => resolve(manifestDir, stylePath)),
      { nodir: true, ignore: ["**/*.min.css"] }
    );
  } else {
    const stageFiles = await glob([".build/**/*.css"], {
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

  let errorCount = 0;
  let riskyCount = 0;

  for (const file of files) {
    let css: string;
    try {
      css = await readFile(file, "utf8");
    } catch {
      continue;
    }
    const warnings = checkCss(css, file);
    const errors = warnings.filter((w) => w.severity === "error");
    riskyCount += warnings.filter((w) => w.rule === ruleRiskyProps).length;

    if (errors.length > 0) {
      log.error(`  ${file}`);
      for (const w of errors) {
        log.error(`    ${w.line}:${w.column}  ${w.message}  (${w.rule})`);
      }
      errorCount += errors.length;
    }
  }

  if (errorCount > 0) {
    log.error("CSS lint errors found");
    return { ok: false, riskyCount, filesLinted: files.length };
  }

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
