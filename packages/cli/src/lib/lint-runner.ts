import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { loadManifestWithPath, resolveConfig } from "./manifest";
import { log } from "../utils/logger";
import { checkCss, ruleRiskyProps } from "./printsafe";
import { resolveActiveStyles } from "./style-resolver";

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
  const { manifest, manifestDir } = await loadManifestWithPath(opts.manifest, {
    explicit: opts.manifest !== undefined,
  });
  // resolveConfig still runs so manifest loading/validation behaves consistently.
  resolveConfig({}, manifest);

  let files: string[];
  if (opts.files) {
    // Explicit override (`print-md lint <glob>` with no manifest project) —
    // the one case that legitimately wants arbitrary glob expansion.
    files = await glob([opts.files], { nodir: true, ignore: ["**/*.min.css"] });
  } else {
    // THE canonical "which stylesheet(s) does this project use?" resolver —
    // the SAME one the renderer/editor use (style-resolver.ts), so
    // `print-md lint` checks exactly the stylesheet(s) that ship.
    //
    // This used to be its own third fallback chain (2026-07-28 duplication
    // audit): when the manifest had no `styles:`, it globbed `.build/**/*.css`
    // and then `example/**/*.css`/`demos/**/*.css` — leftover scaffolding for
    // linting THIS REPO's own dogfooding examples, unrelated to any given
    // project's manifest, and (unlike every other project-wide scan in this
    // package) it never applied ASSET_SCAN_IGNORE_GLOBS, so it didn't even
    // exclude node_modules/.git/dist. resolveActiveStyles's own fallback
    // (styles/book.css, else the first discovered project .css, else `[]`)
    // replaces all of that.
    const relStyles = await resolveActiveStyles(manifestDir, manifest.styles);
    files = relStyles
      .map((rel) => resolve(manifestDir, rel))
      .filter((f) => !f.endsWith(".min.css"));
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
