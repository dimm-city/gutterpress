import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { loadManifestWithPath, resolveConfig } from "./manifest";
import { log } from "../utils/logger";
import { checkCss, ruleRiskyProps, rulePageContainment } from "./printsafe";
import { resolveActiveStyles } from "./style-resolver";
import { loadPluginsWithCss } from "./markdown/plugins";

export interface LintRunnerOptions {
  files?: string;
  manifest?: string;
  /**
   * Pre-loaded, absolute plugin `styles` file paths (#262). `undefined` (the
   * default — every standalone `gutterpress lint` invocation, which is now
   * this function's only production caller since #272 removed the build
   * pipeline's own separate lint gate) makes this function load plugins
   * itself, degrade-and-report (warn-and-skip) for a plugin that fails to
   * load. An explicit `[]` or a pre-loaded list from a caller that already
   * knows the resolved plugin styles for this manifest is honored as-is, not
   * treated as "unset".
   */
  pluginStylePaths?: string[];
}

export interface LintRunnerResult {
  ok: boolean;
  /** Count of `printsafe/no-risky-print-effects` findings across every linted file. */
  riskyCount: number;
  /**
   * Count of `printsafe/page-containment` findings across every linted file
   * (#272). Kept separate from {@link riskyCount} rather than folded into it,
   * so a consumer can tell the two finding kinds apart without re-parsing
   * printed text.
   */
  containmentCount: number;
  filesLinted: number;
}

export async function runLint(opts: LintRunnerOptions = {}): Promise<LintRunnerResult> {
  const { glob } = await import("glob");
  const { manifest, manifestDir } = await loadManifestWithPath(opts.manifest, {
    explicit: opts.manifest !== undefined,
  });
  // Use the RESOLVED config, not the raw manifest, so lint and the desktop
  // Problems panel (validate) agree about which stylesheets a project uses —
  // both read the list resolveConfig produces.
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
    // now too — no longer an opaque string printsafe never saw.
    //
    // #262: a caller that already loaded plugins for this exact manifest can
    // pass the resolved paths in directly (`opts.pluginStylePaths`) and this
    // skips loading them a second time — an npm-vendored plugin's
    // vendor-tree verification (plugin-vendor.ts's
    // verifyVendoredPlugin/computeVendorTreeDigest) is not free. Since #272
    // removed the build pipeline's own separate lint gate, every standalone
    // `gutterpress lint` run (this function's only production caller) has no
    // such preload, so it loads plugins itself here, same as always:
    // degrade-and-report — a plugin that can't load is a WARNING here, not a
    // reason to fail `gutterpress lint` outright (that fail-fast bar belongs
    // to build/export, not this pre-flight check — see loadPlugins' doc
    // comment on the two failure modes). Already-absolute paths pass through
    // untouched below.
    let pluginStylePaths = opts.pluginStylePaths;
    if (pluginStylePaths === undefined) {
      ({ pluginStylePaths } = await loadPluginsWithCss(
        resolved.extensions,
        manifestDir,
        (ref, err) => log.warn(`Skipping plugin "${ref}" for lint — ${err.message}`),
      ));
    }

    files = [...projectFiles, ...pluginStylePaths].filter((f) => !f.endsWith(".min.css"));
  }

  if (files.length === 0) {
    log.warn("No CSS files found to lint");
    return { ok: true, riskyCount: 0, containmentCount: 0, filesLinted: 0 };
  }

  log.info(`Linting ${files.length} CSS file(s)`);

  let errorCount = 0;
  let riskyCount = 0;
  let containmentCount = 0;

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
    // Every warning-severity rule prints and counts here — not just risky
    // props. Before #272, `printsafe/page-containment` findings were checked
    // and computed by `checkCss` but silently dropped by this function, even
    // though the README documents `gutterpress lint` as covering
    // page-containment risk. Sorted by line so a file with both kinds of
    // finding reads top-to-bottom, matching how an author reads the source.
    const risky = warnings.filter((w) => w.rule === ruleRiskyProps);
    const containment = warnings.filter((w) => w.rule === rulePageContainment);
    riskyCount += risky.length;
    containmentCount += containment.length;

    if (errors.length > 0) {
      log.error(`  ${file}`);
      for (const w of errors) {
        log.error(`    ${w.line}:${w.column}  ${w.message}  (${w.rule})`);
      }
      errorCount += errors.length;
    }
    const nonErrorWarnings = [...risky, ...containment].sort((a, b) => a.line - b.line);
    if (nonErrorWarnings.length > 0) {
      log.warn(`  ${file}`);
      for (const w of nonErrorWarnings) {
        log.warn(`    ${w.line}:${w.column}  ${w.message}  (${w.rule})`);
      }
    }
  }

  if (errorCount > 0) {
    log.error("CSS lint errors found");
    return { ok: false, riskyCount, containmentCount, filesLinted: linted };
  }

  const totalWarnings = riskyCount + containmentCount;
  if (totalWarnings > 0) {
    log.warn(
      `${totalWarnings} print-safety warning(s): ${riskyCount} risky effect(s), ${containmentCount} page-containment`
    );
  } else {
    log.success("CSS lint passed");
  }

  return { ok: true, riskyCount, containmentCount, filesLinted: linted };
}
