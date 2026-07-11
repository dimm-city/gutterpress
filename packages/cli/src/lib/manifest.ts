import { readFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { parse as parseYaml } from "yaml";
import type { PrintMdManifest, ResolvedConfig, PluginConfig, ResolvedPluginConfig } from "../schema/manifest.types";
import { resolvePreset, warnOnce } from "./presets";

/**
 * The manifest file names print-md recognizes, in lookup-preference order.
 * Single source of truth — any code that needs to find/match a manifest file
 * (project scanning, GitHub repo book discovery, …) should consume this
 * instead of hardcoding the names.
 */
export const MANIFEST_FILENAMES = ["manifest.yaml", "manifest.yml"] as const;

/**
 * Load manifest.yaml from a given path or CWD.
 * Returns an empty object if the file doesn't exist.
 */
export async function loadManifest(
  pathOrDir?: string
): Promise<PrintMdManifest> {
  // Thin wrapper over loadManifestWithPath — the candidate-resolution loop
  // lives there; callers that don't need the directory use this.
  const { manifest } = await loadManifestWithPath(pathOrDir);
  return manifest;
}

/**
 * Load manifest.yaml and return both the manifest and the directory it was found in.
 * Returns an empty manifest and the current working directory if no manifest is found.
 */
export async function loadManifestWithPath(
  pathOrDir?: string
): Promise<{ manifest: PrintMdManifest; manifestDir: string }> {
  const candidates = pathOrDir
    ? [resolve(pathOrDir), ...MANIFEST_FILENAMES.map((name) => resolve(pathOrDir, name))]
    : MANIFEST_FILENAMES.map((name) => resolve(name));

  for (const p of candidates) {
    if (existsSync(p) && statSync(p).isFile()) {
      const raw = await readFile(p, "utf8");
      const manifest = (parseYaml(raw) as PrintMdManifest) ?? {};
      return { manifest, manifestDir: dirname(p) };
    }
  }

  // If no manifest found, return empty manifest and the input dir or cwd
  const manifestDir = pathOrDir ? resolve(pathOrDir) : resolve('.');
  return { manifest: {}, manifestDir };
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
  // produced a "bun add plugins/my-plugin.js" dead-end that could never work).
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
  cliOverrides: Partial<PrintMdManifest>,
  manifest: PrintMdManifest
): ResolvedConfig {
  const presetName = cliOverrides.preset ?? manifest.preset;
  const preset = resolvePreset(presetName);

  const m = manifest;
  const c = cliOverrides;

  // Deprecated-keys table (ARCH #24): manifest/CLI fields that still parse
  // (so old manifests don't break) but no longer affect resolution — each
  // gets a one-line once-per-process notice instead of being threaded
  // through the merge above.
  if (m.output?.html !== undefined || c.output?.html !== undefined) {
    warnOnce(
      "output-html-deprecated",
      "[print-md] manifest field `output.html` is deprecated and ignored. " +
        "The rendered book HTML is always written as `book.html`."
    );
  }
  if (
    (m.validate?.source?.allowedCallouts?.length ?? 0) > 0 ||
    (c.validate?.source?.allowedCallouts?.length ?? 0) > 0
  ) {
    warnOnce(
      "allowed-callouts-deprecated",
      "[print-md] manifest field `validate.source.allowedCallouts` is " +
        "deprecated and ignored. The `:::` container syntax it gated was " +
        "removed 2026-05-17. See docs/migrations/2026-05-removing-container-syntax.md."
    );
  }

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
    // ARCH #2: no preset fallback here — resolveActiveStyles (style-resolver.ts)
    // is the single source of default-stylesheet truth (styles/book.css, else
    // the first discovered .css, else []). Baking a preset default in here
    // defeated that documented fallback chain on every real render path.
    styles: c.styles ?? m.styles,
    plugins,
    source: mergeShape(c.source, m.source, preset.source),
    output: mergeShape(c.output, m.output, preset.output),
    pdfx: mergeShape(c.pdfx, m.pdfx, preset.pdfx),
    page: mergeShape(c.page, m.page, preset.page),
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
