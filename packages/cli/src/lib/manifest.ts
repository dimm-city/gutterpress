import { readFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { parse as parseYaml, YAMLParseError } from "yaml";
import type { GutterpressManifest, ResolvedConfig, PluginConfig, ResolvedPluginConfig } from "../schema/manifest.types";
import { resolvePreset, warnOnce, type VendorPreset } from "./presets";
import { overlayPreset, publishTargetFor, resolveTargets } from "./targets";
import { UsageError } from "./cli-args";

/**
 * The manifest file name Gutterpress recognizes.
 * Single source of truth — any code that needs to find/match a manifest file
 * (project scanning, GitHub repo book discovery, …) should consume this
 * instead of hardcoding the names.
 */
export const MANIFEST_FILENAMES = [
  "manifest.yaml",
] as const;

/** True when a directory contains any recognized project manifest file. */
export function hasProjectManifest(dir: string): boolean {
  return MANIFEST_FILENAMES.some((name) => {
    const candidate = resolve(dir, name);
    try {
      return statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
}

/**
 * Load a recognized manifest from a given path or CWD.
 * Returns an empty object if the file doesn't exist.
 */
export async function loadManifest(
  pathOrDir?: string
): Promise<GutterpressManifest> {
  // Thin wrapper over loadManifestWithPath — the candidate-resolution loop
  // lives there; callers that don't need the directory use this.
  const { manifest } = await loadManifestWithPath(pathOrDir);
  return manifest;
}

/**
 * Load a recognized manifest and return its contents, directory, and resolved path.
 * Returns an empty manifest, a null path, and the current working directory if none is found —
 * UNLESS `explicit` is set (ARCH finding #12/PR #98): a caller that resolved
 * `pathOrDir` from a user-supplied `--manifest` flag (as opposed to a project
 * directory being scanned for a manifest that may legitimately not exist) must
 * pass `{ explicit: true }` so a missing/typo'd path throws instead of
 * silently resolving to an empty manifest. A typo like `--manifest
 * ./typo.yaml` previously fell through to the "no manifest" default AND left
 * `manifestDir` pointing at the nonexistent path itself
 * (`resolve("./typo.yaml")`), so a later `path.resolve(manifestDir,
 * config.output.dir)` could create build output beneath a directory named
 * after the missing file.
 */
export async function loadManifestWithPath(
  pathOrDir?: string,
  opts?: { explicit?: boolean }
): Promise<{
  manifest: GutterpressManifest;
  manifestDir: string;
  manifestPath: string | null;
}> {
  const candidates = pathOrDir
    ? [resolve(pathOrDir), ...MANIFEST_FILENAMES.map((name) => resolve(pathOrDir, name))]
    : MANIFEST_FILENAMES.map((name) => resolve(name));

  for (const p of candidates) {
    if (existsSync(p) && statSync(p).isFile()) {
      const raw = await readFile(p, "utf8");
      try {
        const manifest = (parseYaml(raw) as GutterpressManifest) ?? {};
        return { manifest, manifestDir: dirname(p), manifestPath: p };
      } catch (error) {
        if (!(error instanceof YAMLParseError)) throw error;
        const position = error.linePos?.[0];
        const location = position
          ? ` at line ${position.line}, column ${position.col}`
          : "";
        const summary = (error.message.split("\n", 1)[0] ?? error.message).replace(
          /\s+at line \d+, column \d+:?$/,
          ""
        );
        throw new UsageError(`Invalid YAML in "${p}"${location}: ${summary}`);
      }
    }
  }

  if (opts?.explicit && pathOrDir !== undefined) {
    throw new UsageError(
      `manifest not found: ${pathOrDir}. Pass an existing file or a directory containing ${MANIFEST_FILENAMES.join(" or ")}.`
    );
  }

  // If no manifest found, return empty manifest and the input dir or cwd
  const manifestDir = pathOrDir ? resolve(pathOrDir) : resolve('.');
  return { manifest: {}, manifestDir, manifestPath: null };
}

/**
 * Check if a string looks like a file path (vs npm package name).
 * File paths start with './', '../', '/', or contain path separators with extensions.
 */
function isFilePath(str: string): boolean {
  if (
    str.startsWith('./') ||
    str.startsWith('../') ||
    str.startsWith('/') ||
    // Windows absolute paths
    /^[a-zA-Z]:[\\/]/.test(str)
  ) {
    return true;
  }
  // Bare relative path with no `./` prefix (e.g. `plugins/my-plugin.js`) — a
  // very natural thing for a non-technical author to write. Per this
  // function's own documented contract: a path SEPARATOR combined with a
  // recognized JS module EXTENSION is a file path, never an npm package
  // name. Without a JS extension it stays ambiguous with a legitimate scoped
  // package name (`@org/name`), so only slash+extension triggers this (ARCH
  // finding #57 — previously this fell through to npm resolution and
  // produced an npm-package install dead-end that could never work).
  return /[\\/].*\.(m?js|cjs)$/i.test(str);
}

/**
 * Normalize a plugin configuration entry from manifest.
 * Accepts either a string path/name or a PluginConfig object.
 *
 * String detection:
 * - Starts with './', '../', '/' → treated as local file path
 * - Otherwise → treated as npm package name
 */
function normalizePluginConfig(plugin: string | PluginConfig): ResolvedPluginConfig {
  if (typeof plugin === 'string') {
    if (isFilePath(plugin)) {
      return {
        path: plugin,
        priority: 100,
        options: {},
      };
    }
    // Treat as npm package name
    return {
      name: plugin,
      priority: 100,
      options: {},
    };
  }
  return {
    path: plugin.path,
    name: plugin.name,
    ...(plugin.version ? { version: plugin.version } : {}),
    ...(plugin.export ? { export: plugin.export } : {}),
    priority: plugin.priority ?? 100,
    options: plugin.options ?? {},
  };
}

type PlainObject = Record<string, unknown>;

/** Recursion helper's "every nested plain object stays optional too" type. */
type DeepPartial<T> = T extends PlainObject
  ? { [K in keyof T]?: DeepPartial<T[K]> }
  : T;

function isPlainObject(v: unknown): v is PlainObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Recursively merge a "closed shape" nested config object — cli overrides
 * manifest overrides preset, leaf-by-leaf, at any depth (e.g.
 * `validate.heuristics.textDensityRange.min`, three levels deep). Keys always
 * come from `preset`'s own shape, NOT the union with `cli`/`manifest`, so a
 * key the manifest type happens to carry alongside real ones but `preset`
 * (and `ResolvedConfig`) doesn't declare — e.g. the deprecated `output.html`
 * — can never leak into the resolved result; deprecated fields get their own
 * explicit warn-and-ignore check instead (see `resolveConfig` below).
 *
 * A leaf value (anything that isn't a plain object — string, number,
 * boolean, array, or `null`) resolves with the same `??` precedence the old
 * hand-written chain used almost everywhere: the first of (cli, manifest,
 * preset) that isn't `null`/`undefined` wins. The old code special-cased four
 * fields (`lint.configPath`, `validate.source.{markdownlint,htmlhint,
 * stylelint}`) with a `!== undefined` ternary instead of `??`, so an explicit
 * manifest `null` would win over the preset default rather than falling
 * through to it — but every preset default for those four fields is already
 * `null`, so `??` resolves to the exact same value for every preset in this
 * codebase. `??` is also the right behavior for `styles` (ARCH #2): a
 * manifest author who writes `styles:` with nothing under it gets `null` from
 * the yaml parser, and that must fall through to `resolveActiveStyles`'s own
 * discovery, not crash trying to `.filter()` a `null`.
 *
 * ARCH finding #24: replaces ~40 hand-written `c.x ?? m.x ?? preset.x` lines
 * with this one small typed deep-merge. `validate.checks` — an OPEN
 * dictionary keyed by check id, where a manifest can introduce ids the preset
 * never declared — is intentionally NOT run through this (a closed-shape
 * merge would silently drop custom check ids); it keeps its own one-line
 * `{...preset, ...manifest, ...cli}` union merge in `resolveConfig`.
 */
function mergeShape<T extends PlainObject>(
  cli: DeepPartial<T> | null | undefined,
  manifest: DeepPartial<T> | null | undefined,
  preset: T
): T {
  const out: PlainObject = {};
  for (const key of Object.keys(preset)) {
    const presetValue = preset[key];
    const manifestValue = manifest ? (manifest as PlainObject)[key] : undefined;
    const cliValue = cli ? (cli as PlainObject)[key] : undefined;
    out[key] = isPlainObject(presetValue)
      ? mergeShape(
          cliValue as PlainObject | undefined,
          manifestValue as PlainObject | undefined,
          presetValue
        )
      : cliValue ?? manifestValue ?? presetValue;
  }
  return out as T;
}

/**
 * Merge CLI args > manifest > preset defaults into a fully-resolved config.
 * Any field explicitly set in `cliOverrides` wins, then manifest, then preset.
 */
export function resolveConfig(
  cliOverrides: Partial<GutterpressManifest>,
  manifest: GutterpressManifest
): ResolvedConfig {
  const presetName = cliOverrides.preset ?? manifest.preset;
  return resolveWithPreset(cliOverrides, manifest, resolvePreset(presetName));
}

/**
 * Resolve the config AS ONE PUBLISH TARGET SEES IT (ADR 0008): the target's
 * policy overlay is merged onto the preset before the manifest merges over
 * both, giving the single precedence chain cli > manifest > target > preset.
 * The author's explicit manifest values always beat the target's policy —
 * the same sovereignty rule presets follow.
 */
export function resolveConfigForTarget(
  cliOverrides: Partial<GutterpressManifest>,
  manifest: GutterpressManifest,
  targetId: string
): ResolvedConfig {
  const presetName = cliOverrides.preset ?? manifest.preset;
  const preset = resolvePreset(presetName);
  return resolveWithPreset(cliOverrides, manifest, overlayPreset(preset, publishTargetFor(targetId)));
}

/**
 * `custom` supplies no geometry, so the manifest (or CLI) must: width and
 * height in points are required, tolerance defaults to 0.5pt. The error
 * names exactly what to add — this is the contract that makes
 * `preset: custom` safe to offer non-technical authors.
 */
function resolveCustomPage(
  c: Partial<GutterpressManifest>,
  m: GutterpressManifest
): ResolvedConfig["page"] {
  const width = c.page?.width ?? m.page?.width;
  const height = c.page?.height ?? m.page?.height;
  const missing = [
    width === undefined ? "page.width" : null,
    height === undefined ? "page.height" : null,
  ].filter((f): f is string => f !== null);
  if (missing.length > 0) {
    throw new UsageError(
      `preset: custom requires ${missing.join(" and ")} in manifest.yaml ` +
        "(points; 72pt = 1in). Example for US Letter:\n" +
        "  page:\n    width: 612\n    height: 792"
    );
  }
  return {
    width: width!,
    height: height!,
    tolerance: c.page?.tolerance ?? m.page?.tolerance ?? 0.5,
  };
}

function resolveWithPreset(
  cliOverrides: Partial<GutterpressManifest>,
  manifest: GutterpressManifest,
  preset: VendorPreset
): ResolvedConfig {

  const m = manifest;
  const c = cliOverrides;

  // Deprecated-keys table (ARCH #24): manifest/CLI fields that still parse
  // (so old manifests don't break) but no longer affect resolution — each
  // gets a one-line once-per-process notice instead of being threaded
  // through the merge above.
  // `output:` and `source.assets:` are gone entirely (not merely ignored): the
  // output location is a convention (lib/output-paths.ts) and the asset set is
  // derived from the book's own references (lib/asset-inline.ts). A manifest
  // that still carries either gets one actionable error rather than silently
  // building to a place the author no longer controls.
  const legacy = m as { output?: unknown; source?: { assets?: unknown } };
  if (legacy.output !== undefined || legacy.source?.assets !== undefined) {
    const stale = [
      legacy.output !== undefined ? "`output`" : null,
      legacy.source?.assets !== undefined ? "`source.assets`" : null,
    ].filter(Boolean);
    throw new UsageError(
      `Manifest field(s) ${stale.join(" and ")} are no longer supported — remove them.\n` +
        "  Output goes to `dist/<title-slug>/` automatically (use `--out` for a one-off location).\n" +
        "  Assets are discovered from what your book actually references, so no list is needed."
    );
  }
  if (
    (m.validate?.source?.allowedCallouts?.length ?? 0) > 0 ||
    (c.validate?.source?.allowedCallouts?.length ?? 0) > 0
  ) {
    warnOnce(
      "allowed-callouts-deprecated",
      "[gutterpress] manifest field `validate.source.allowedCallouts` is " +
        "deprecated and ignored. The `:::` container syntax it gated was " +
        "removed 2026-05-17. See docs/migrations/2026-05-removing-container-syntax.md."
    );
  }

  // Pagination engine: the native engine is the only engine. `engine:`/
  // `--engine` still parse (so an old manifest/CLI invocation doesn't
  // hard-fail) but are now a no-op: every build resolves to "native"
  // regardless of the value requested, and an explicit "paged" gets a one-line
  // warning instead of silently changing behavior.
  const requestedEngine = c.engine ?? m.engine ?? "native";
  if (requestedEngine !== "paged" && requestedEngine !== "native") {
    throw new UsageError(`Unknown engine "${String(requestedEngine)}". Expected: paged | native`);
  }
  if (requestedEngine === "paged") {
    warnOnce(
      "engine-paged-removed",
      "[gutterpress] The native engine is the only engine. " +
        "\"engine: paged\" is ignored — building natively."
    );
  }
  if ((m.engineStyles?.paged?.length ?? 0) > 0) {
    warnOnce(
      "engine-styles-paged-removed",
      "[gutterpress] engineStyles.paged is ignored — the native engine is the only engine."
    );
  }
  const engine = "native" as const;

  // Resolve plugins from CLI overrides or manifest. A plugin entry with
  // `enabled: false` (#30 per-project toggle) stays in the manifest but is
  // skipped here so it is never loaded at build/preview time.
  const rawPlugins = c.plugins ?? m.plugins ?? [];
  const plugins = rawPlugins
    .filter((p) => typeof p === "string" || p.enabled !== false)
    .map(normalizePluginConfig)
    .sort((a, b) => b.priority - a.priority); // Higher priority loads first

  return {
    title: c.title ?? m.title ?? "Document",
    authors: c.authors ?? m.authors ?? [],
    engine,
    // ARCH #2: no preset fallback here — resolveActiveStyles (style-resolver.ts)
    // is the single source of default-stylesheet truth (styles/book.css, else
    // the first discovered .css, else []). Baking a preset default in here
    // defeated that documented fallback chain on every real render path.
    // Engine-conditional stylesheets append AFTER the base list (see
    // GutterpressManifest.engineStyles). Loaded last so furniture wins.
    // `engineStyles.paged` is ignored (warned above) — only `.native` applies.
    styles: (() => {
      const base = c.styles ?? m.styles;
      const extra = m.engineStyles?.native;
      if (!extra || extra.length === 0) return base;
      return [...(base ?? []), ...extra];
    })(),
    plugins,
    targets: resolveTargets(c.targets ?? m.targets, preset.defaultTargets),
    source: mergeShape(c.source, m.source, preset.source),
    pdfx: mergeShape(c.pdfx, m.pdfx, preset.pdfx),
    // Default (both presets) is signature: 1 = no padding — postprocess only
    // pads when > 1, so a book that never asks for one gets none.
    print: mergeShape(c.print, m.print, preset.print),
    page: preset.page ? mergeShape(c.page, m.page, preset.page) : resolveCustomPage(c, m),
    ink: mergeShape(c.ink, m.ink, preset.ink),
    lint: mergeShape(c.lint, m.lint, preset.lint),
    validate: {
      enabled: c.validate?.enabled ?? m.validate?.enabled ?? preset.validate.enabled,
      checks: { ...preset.validate.checks, ...m.validate?.checks, ...c.validate?.checks },
      source: mergeShape(c.validate?.source, m.validate?.source, preset.validate.source),
      assets: mergeShape(c.validate?.assets, m.validate?.assets, preset.validate.assets),
      pdf: mergeShape(c.validate?.pdf, m.validate?.pdf, preset.validate.pdf),
      heuristics: mergeShape(
        c.validate?.heuristics,
        m.validate?.heuristics,
        preset.validate.heuristics
      ),
    },
  };
}
