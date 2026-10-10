/**
 * Restore a book's pinned npm extensions.
 *
 * Downloaded extensions (`plugins/npm/<name>/<version>/`) are not part of a
 * book's git history (see project-gitignore.ts), so a fresh clone has the
 * manifest's `extensions: [name@1.2.3]` pins and none of the files. This is the
 * one step that downloads them again. It is deliberately SEPARATE from the
 * plugin loader, which stays offline: the shared "load the book's plugins"
 * seams (`loadBuildPlugins` for every build and export, `executeValidation`
 * for every check run) call it first, the CLI's live preview calls it before
 * serving, and the desktop calls it when a book is opened.
 *
 * What it does, and nothing more:
 *   - reads the manifest's `extensions:` list;
 *   - for each enabled npm entry pinned to an exact version whose downloaded
 *     copy is missing or incomplete, installs EXACTLY that version through the
 *     same verified path `ext add` uses (registry resolution, SRI check,
 *     vendor, load-test);
 *   - then removes the package's other downloaded versions (a gitignored
 *     cache: see `pruneStaleVersions` in extension-manager.ts), so a pulled
 *     pin or a switched branch leaves one copy, not a pile;
 *   - never changes the manifest or a pin, never picks another version, and
 *     never touches unpinned, local-path or bundled entries;
 *   - does nothing — no network — when every copy is present, so a book whose
 *     extensions are installed works offline;
 *   - stops at the first package npm cannot be reached for (no connection, DNS,
 *     timeout): the rest would fail the same way, so they are reported as
 *     missing-while-offline without being tried, and `offline` is set.
 */
import path from "node:path";

import { log } from "../utils/logger.ts";
import { BuildError, EXIT_CODES } from "./build-error.ts";
import { FetchUnavailableError } from "./fetch-timeout.ts";
import { projectKey, restoreNpmExtension, vendoredCopyNeedsInstall } from "./extension-manager.ts";
import { parseExtensionSpecifier } from "./extension-specifier.ts";
import { loadManifestWithPath } from "./manifest.ts";
import type { NpmPluginInstallOptions } from "./npm-plugin-installer.ts";
import { isExactNpmVersion } from "./plugin-vendor.ts";

export interface RestorePinnedOptions extends NpmPluginInstallOptions {
  /** An explicit `--manifest` file; the book folder is then that file's folder. */
  manifestPath?: string;
  /**
   * Progress for a UI: nothing is reported when every copy is present; else a
   * `start` (the packages to download), one `package` event as each starts
   * and ends, and an `end`. A caller that joins a run already in flight for
   * the same book gets that run's result but no events.
   */
  onProgress?: (event: RestoreProgress) => void;
}

/** One step of a restore, for a progress indicator. `spec` is `name@version`. */
export type RestoreProgress =
  | { type: "start"; specs: string[] }
  | { type: "package"; spec: string; index: number; total: number; state: "downloading" | "done" | "failed"; message?: string }
  | { type: "end"; installed: string[]; failed: RestoreFailure[] };

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
  /** npm could not be reached, so every package still missing was reported as failed without being tried. */
  offline: boolean;
}

/** The reason each still-missing package carries once npm is unreachable. */
const OFFLINE_REASON = "you appear to be offline (npm can't be reached)";

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

async function restoreAll(
  projectDir: string,
  manifestFile: string,
  pins: PinnedNpm[],
  options: RestorePinnedOptions,
): Promise<RestoreResult> {
  const result: RestoreResult = { manifestFile, installed: [], failed: [], warnings: [], offline: false };
  const missing: PinnedNpm[] = [];
  for (const pin of pins) if (await vendoredCopyNeedsInstall(projectDir, pin.name, pin.version)) missing.push(pin);
  if (missing.length === 0) return result;

  const report = options.onProgress ?? (() => {});
  const specs = missing.map((pin) => `${pin.name}@${pin.version}`);
  report({ type: "start", specs });
  for (const [index, pin] of missing.entries()) {
    const spec = specs[index]!;
    const step = { type: "package", spec, index, total: missing.length } as const;
    if (result.offline) {
      result.failed.push({ use: spec, message: OFFLINE_REASON });
      report({ ...step, state: "failed", message: OFFLINE_REASON });
      continue;
    }
    report({ ...step, state: "downloading" });
    try {
      result.warnings.push(
        ...(await restoreNpmExtension(projectDir, pin.name, pin.version, pin.export, {
          ...options,
          keepVersions: pins.filter((other) => other.name === pin.name).map((other) => other.version),
        })),
      );
      result.installed.push(spec);
      report({ ...step, state: "done" });
    } catch (error) {
      // A network-level failure (not a 404, integrity or load error) means
      // npm is unreachable: say so, rather than echo a socket error.
      if (error instanceof FetchUnavailableError) result.offline = true;
      const message = result.offline ? OFFLINE_REASON : error instanceof Error ? error.message : String(error);
      result.failed.push({ use: spec, message });
      report({ ...step, state: "failed", message });
    }
  }
  report({ type: "end", installed: result.installed, failed: result.failed });
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
    return { manifestFile: null, installed: [], failed: [], warnings: [], offline: false };
  }
  const { manifest, manifestDir, manifestPath } = loaded;
  const pins = pinnedEntries(manifest);
  if (manifestPath === null || pins.length === 0) {
    return { manifestFile: manifestPath && path.basename(manifestPath), installed: [], failed: [], warnings: [], offline: false };
  }

  const key = projectKey(manifestDir);
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
    `Check your internet connection and try again, or install it yourself with \`gutterpress ext add ${failure.use}\`.`
  );
}

/**
 * One sentence for a restore that could not reach npm: which extensions are
 * missing, and that they have to be installed while online — after which the
 * book works offline.
 */
export function restoreOfflineMessage(failed: RestoreFailure[], manifestFile: string | null): string {
  const list = failed.map((f) => f.use).join(", ");
  return (
    `You appear to be offline, and this book's extensions are not installed yet: ${list} ` +
    `(pinned in ${manifestFile ?? "the manifest"}). Connect to the internet and try again to install them; ` +
    `once installed, they work offline.`
  );
}

/**
 * The restore step every command and host path that loads a book's plugins
 * runs first: restore, print one line per downloaded package, and either fail
 * fast (build, export, validate and the checks: a final artifact must never
 * silently omit author-configured formatting) or, for the live preview, warn
 * and carry on so one missing package cannot blank the whole preview.
 *
 * It is called from the shared "load the book's plugins" seams themselves
 * (`loadBuildPlugins`, `executeValidation`), not from each command, so a new
 * command that builds or checks cannot forget it. The loader stays offline.
 */
export async function restoreForCommand(
  dir: string,
  options: { manifestPath?: string; failFast: boolean },
): Promise<void> {
  const result = await restorePinnedExtensions(dir, { manifestPath: options.manifestPath });
  const file = result.manifestFile ?? "the manifest";
  // Progress goes to stderr: stdout belongs to a command's result
  // (`validate --format json` must stay parseable).
  for (const spec of result.installed) console.error(`Downloaded ${spec} (pinned in ${file})`);
  for (const warning of result.warnings) log.warn(warning);
  // Offline: one sentence for all of them (the advice is the same), plus any
  // that failed for another reason before npm became unreachable.
  const offline = result.failed.filter((f) => result.offline && f.message === OFFLINE_REASON);
  const problems = [
    ...result.failed.filter((f) => !offline.includes(f)).map((f) => restoreFailureMessage(f, result.manifestFile)),
    ...(offline.length > 0 ? [restoreOfflineMessage(offline, result.manifestFile)] : []),
  ];
  if (problems.length === 0) return;
  if (options.failFast) throw new BuildError(problems.join("\n"), EXIT_CODES.PIPELINE);
  for (const problem of problems) log.warn(problem);
}
