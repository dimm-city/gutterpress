import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { loadManifestWithPath, resolveConfig } from "./manifest";
import { log } from "../utils/logger";
import { checkCss, ruleRiskyProps } from "./printsafe";
import { resolveActiveStyles } from "./style-resolver";
import { loadPluginsWithCss } from "./markdown/plugins";

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
  // Use the RESOLVED config, not the raw manifest: resolveWithPreset
  // (manifest.ts) is the only place `engineStyles.native` is appended to the
  // style list, and that sheet loads LAST at render time, so its rules win the
  // cascade in the shipped PDF. Discarding this return linted 7 of the field
  // guide's 8 sheets and hid its most severe finding — see the
  // engineStyles.native test in lint-runner.test.ts.
  const resolved = resolveConfig({}, manifest);

  let files: string[];
  if (opts.files) {
    // Explicit override (`gutterpress lint <glob>` with no manifest project) —
    // the one case that legitimately wants arbitrary glob expansion.
    files = await glob([opts.files], { nodir: true, ignore: ["**/*.min.css"] });
  } else {
    // THE canonical "which stylesheet(s) does this project use?" resolver —
    // the SAME one the renderer/editor use (style-resolver.ts), fed the SAME
    // resolved style list, so `gutterpress lint` checks exactly the
    // stylesheet(s) that ship — engine-conditional furniture included.
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
    const relStyles = await resolveActiveStyles(manifestDir, resolved.styles);
    const projectFiles = relStyles.map((rel) => resolve(manifestDir, rel));

    // #238: a plugin's file-based `styles` are a real, lintable CSS surface
    // now too — no longer an opaque string printsafe never saw. Loaded
    // degrade-and-report: a plugin that can't load is a WARNING here, not a
    // reason to fail `gutterpress lint` outright (that fail-fast bar belongs
    // to build/export, not this pre-flight check — see loadPlugins' doc
    // comment on the two failure modes). Already-absolute paths pass through
    // untouched below.
    const { pluginStylePaths } = await loadPluginsWithCss(
      resolved.plugins,
      manifestDir,
      (ref, err) => log.warn(`Skipping plugin "${ref}" for lint — ${err.message}`),
    );

    files = [...projectFiles, ...pluginStylePaths].filter((f) => !f.endsWith(".min.css"));
  }

  if (files.length === 0) {
    log.warn("No CSS files found to lint");
    return { ok: true, riskyCount: 0, filesLinted: 0 };
  }

  log.info(`Linting ${files.length} CSS file(s)`);

  let errorCount = 0;
  let riskyCount = 0;

  let linted = 0;

  for (const file of files) {
    let css: string;
    try {
      css = await readFile(file, "utf8");
    } catch (err) {
      // An unreadable stylesheet FAILS lint rather than being skipped. These
      // paths come from `resolveActiveStyles`, whose discovery fallbacks are
      // existence-checked — so an unreadable entry means the manifest's
      // `styles:` list (returned verbatim, style-resolver.ts:126) names a file
      // that is missing, is a directory, or cannot be opened. Skipping it
      // silently reported `ok: true` having inspected nothing, which is the
      // same silent-green this resolver change exists to remove; `inlineStyles`
      // already treats a missing stylesheet as a hard build error, so lint
      // agrees with the build instead of disagreeing quietly.
      log.error(`  ${file}`);
      log.error(
        `    cannot read stylesheet: ${err instanceof Error ? err.message : String(err)}`
      );
      errorCount++;
      continue;
    }
    linted++;
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
    return { ok: false, riskyCount, filesLinted: linted };
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

  return { ok: true, riskyCount, filesLinted: linted };
}
