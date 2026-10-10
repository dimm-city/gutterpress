/**
 * Restore a book's pinned npm extensions.
 *
 * Downloaded extensions (`plugins/npm/<name>/<version>/`) are not part of a
 * book's git history (see project-gitignore.ts), so a fresh clone has the
 * manifest's `extensions: [name@1.2.3]` pins and none of the files. This is the
 * one step that downloads them again. It is deliberately SEPARATE from the
 * plugin loader, which stays offline: build, validate and preview call it
 * before loading plugins, and the desktop calls it when a book is opened.
 *
 * What it does, and nothing more:
 *   - reads the manifest's `extensions:` list;
 *   - for each enabled npm entry pinned to an exact version whose downloaded
 *     copy is missing or incomplete, installs EXACTLY that version through the
 *     same verified path `ext add` uses (registry resolution, SRI check,
 *     vendor, load-test);
 *   - never changes the manifest or a pin, never picks another version, and
 *     never touches unpinned, local-path or bundled entries;
 *   - does nothing — no network — when every copy is present.
 */
import path from "node:path";

import { log } from "../utils/logger.ts";
import { BuildError, EXIT_CODES } from "./build-error.ts";
import { restoreNpmExtension } from "./extension-manager.ts";
import { parseExtensionSpecifier } from "./extension-specifier.ts";
import { loadManifestWithPath } from "./manifest.ts";
import type { NpmPluginInstallOptions } from "./npm-plugin-installer.ts";
import {
  isExactNpmVersion,
  resolvePackageEntry,
  resolveVendoredPluginInstallRoot,
  vendoredNpmPluginPackageDir,
} from "./plugin-vendor.ts";

export interface RestorePinnedOptions extends NpmPluginInstallOptions {
  /** An explicit `--manifest` file; the book folder is then that file's folder. */
  manifestPath?: string;
  /** Called with `name@version` just before a download starts (progress). */
  onRestoring?: (spec: string) => void;
}

export interface RestoreFailure {
  /** `name@version`, as pinned. */
  use: string;
  message: string;
}

export interface RestoreResult {
  /** File name of the manifest the pins were read from (`manifest.yaml`), or null when the folder has none. */
  manifestFile: string | null;
  /** `name@version` of each package downloaded. */
  installed: string[];
  failed: RestoreFailure[];
  warnings: string[];
}

interface PinnedNpm {
  name: string;
  version: string;
  export?: string;
}

/** The enabled, exactly-pinned npm entries of a manifest's `extensions:` list, once each. */
function pinnedEntries(manifest: { extensions?: unknown }): PinnedNpm[] {
  const found = new Map<string, PinnedNpm>();
  for (const entry of Array.isArray(manifest.extensions) ? manifest.extensions : []) {
    const object = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : null;
    const use = typeof entry === "string" ? entry : object?.use;
    if (typeof use !== "string" || object?.enabled === false) continue;
    let parsed;
    try {
      parsed = parseExtensionSpecifier(use);
    } catch {
      continue; // the loader and validation report a malformed specifier
    }
    if (parsed.kind !== "npm" || !parsed.version || !isExactNpmVersion(parsed.version)) continue;
    const spec = `${parsed.name}@${parsed.version}`;
    if (found.has(spec)) continue;
    found.set(spec, {
      name: parsed.name,
      version: parsed.version,
      ...(typeof object?.export === "string" && object.export ? { export: object.export } : {}),
    });
  }
  return [...found.values()];
}

/** True when the downloaded copy is absent or has no loadable entry — what the loader would call "Needs install" or "incomplete". */
async function needsRestore(projectDir: string, { name, version }: PinnedNpm): Promise<boolean> {
  const installRoot = await resolveVendoredPluginInstallRoot(projectDir, name, version);
  if (!installRoot) return true;
  try {
    await resolvePackageEntry(vendoredNpmPluginPackageDir(installRoot, name));
    return false;
  } catch {
    return true;
  }
}

async function restoreAll(
  projectDir: string,
  manifestFile: string,
  pins: PinnedNpm[],
  options: RestorePinnedOptions,
): Promise<RestoreResult> {
  const result: RestoreResult = { manifestFile, installed: [], failed: [], warnings: [] };
  for (const pin of pins) {
    const use = `${pin.name}@${pin.version}`;
    try {
      if (!(await needsRestore(projectDir, pin))) continue;
      options.onRestoring?.(use);
      result.warnings.push(
        ...(await restoreNpmExtension(projectDir, pin.name, pin.version, pin.export, options)),
      );
      result.installed.push(use);
    } catch (error) {
      result.failed.push({ use, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}

/** One restore per book at a time: a second caller (open while a build runs) shares the first's result. */
const inFlight = new Map<string, Promise<RestoreResult>>();

/**
 * Download every pinned npm extension of the book whose copy is missing or
 * incomplete. Never throws for a failed download — failures come back in
 * `failed` so each caller can decide (the CLI fails fast, preview and the
 * desktop degrade). An unreadable manifest restores nothing: whoever reads it
 * next reports the real problem.
 */
export async function restorePinnedExtensions(
  projectDir: string,
  options: RestorePinnedOptions = {},
): Promise<RestoreResult> {
  let loaded;
  try {
    loaded = await loadManifestWithPath(options.manifestPath ?? projectDir);
  } catch {
    return { manifestFile: null, installed: [], failed: [], warnings: [] };
  }
  const { manifest, manifestDir, manifestPath } = loaded;
  const pins = pinnedEntries(manifest);
  if (manifestPath === null || pins.length === 0) {
    return { manifestFile: manifestPath && path.basename(manifestPath), installed: [], failed: [], warnings: [] };
  }

  const key = path.resolve(manifestDir);
  const running = inFlight.get(key);
  if (running) return running;
  const run = restoreAll(manifestDir, path.basename(manifestPath), pins, options).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, run);
  return run;
}

/** What went wrong, which extension, and how to retry — one failure as a sentence. */
export function restoreFailureMessage(failure: RestoreFailure, manifestFile: string | null): string {
  return (
    `Could not download ${failure.use} (pinned in ${manifestFile ?? "the manifest"}): ${failure.message.replace(/[.\s]+$/, "")}. ` +
    `Check your connection and run the command again, or install it yourself with \`gutterpress ext add ${failure.use}\`.`
  );
}

/**
 * The CLI's restore step, run before a command loads plugins: restore, print
 * one line per downloaded package, and either fail fast (`build`, `validate`:
 * a final artifact must never silently omit author-configured formatting) or,
 * for the live preview, warn and carry on so one missing package cannot blank
 * the whole preview.
 */
export async function restoreForCommand(
  dir: string,
  options: { manifestPath?: string; failFast: boolean; quiet?: boolean },
): Promise<void> {
  const result = await restorePinnedExtensions(dir, { manifestPath: options.manifestPath });
  const file = result.manifestFile ?? "the manifest";
  // `quiet` keeps stdout clean for machine-readable output (`validate --format json`).
  if (!options.quiet) for (const spec of result.installed) log.info(`Downloaded ${spec} (pinned in ${file})`);
  for (const warning of result.warnings) log.warn(warning);
  const problems = result.failed.map((f) => restoreFailureMessage(f, result.manifestFile));
  if (problems.length === 0) return;
  if (options.failFast) throw new BuildError(problems.join("\n"), EXIT_CODES.PIPELINE);
  for (const problem of problems) log.warn(problem);
}
