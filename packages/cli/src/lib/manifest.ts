import { readFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { parse as parseYaml } from "yaml";
import type { PrintMdManifest, ResolvedConfig, PluginConfig, ResolvedPluginConfig } from "../schema/manifest.types";
import { DTRPG_PRESET, PRESETS } from "./presets";

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
  return (
    str.startsWith('./') ||
    str.startsWith('../') ||
    str.startsWith('/') ||
    // Windows absolute paths
    /^[a-zA-Z]:[\\/]/.test(str)
  );
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

/**
 * Tracks manifests we've already warned about so deprecation notices fire
 * once per process even if `resolveConfig` is called repeatedly (e.g. on
 * every preview regen).
 */
let outputHtmlDeprecationWarned = false;
let allowedCalloutsDeprecationWarned = false;

/**
 * Merge CLI args > manifest > preset defaults into a fully-resolved config.
 * Any field explicitly set in `cliOverrides` wins, then manifest, then preset.
 */
export function resolveConfig(
  cliOverrides: Partial<PrintMdManifest>,
  manifest: PrintMdManifest
): ResolvedConfig {
  const presetName = cliOverrides.preset ?? manifest.preset ?? "dtrpg";
  const preset = PRESETS[presetName] ?? DTRPG_PRESET;

  const m = manifest;
  const c = cliOverrides;

  // Deprecation: `output.html` is no longer configurable — the rendered book
  // HTML is always written as `book.html` and the viewer's iframe loads it
  // by that fixed name. Warn once per process if a manifest still sets it.
  if (
    !outputHtmlDeprecationWarned &&
    (m.output?.html !== undefined || c.output?.html !== undefined)
  ) {
    outputHtmlDeprecationWarned = true;
    // eslint-disable-next-line no-console
    console.warn(
      "[print-md] manifest field `output.html` is deprecated and ignored. " +
        "The rendered book HTML is always written as `book.html`."
    );
  }

  // Deprecation: `validate.source.allowedCallouts` is a no-op as of 2026-05-17
  // (the `:::` container syntax and its validation check were removed).
  if (
    !allowedCalloutsDeprecationWarned &&
    ((m.validate?.source?.allowedCallouts?.length ?? 0) > 0 ||
      (c.validate?.source?.allowedCallouts?.length ?? 0) > 0)
  ) {
    allowedCalloutsDeprecationWarned = true;
    // eslint-disable-next-line no-console
    console.warn(
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
    styles: c.styles ?? m.styles ?? preset.styles,
    plugins,
    source: {
      files: c.source?.files ?? m.source?.files ?? preset.source.files,
      assets: c.source?.assets ?? m.source?.assets ?? preset.source.assets,
    },
    output: {
      dir: c.output?.dir ?? m.output?.dir ?? preset.output.dir,
      filename: c.output?.filename ?? m.output?.filename ?? preset.output.filename,
    },
    pdfx: {
      flavor: c.pdfx?.flavor ?? m.pdfx?.flavor ?? preset.pdfx.flavor,
      icc: c.pdfx?.icc ?? m.pdfx?.icc ?? preset.pdfx.icc,
      stripAnnotations: c.pdfx?.stripAnnotations ?? m.pdfx?.stripAnnotations ?? preset.pdfx.stripAnnotations,
    },
    page: {
      width: c.page?.width ?? m.page?.width ?? preset.page.width,
      height: c.page?.height ?? m.page?.height ?? preset.page.height,
      tolerance: c.page?.tolerance ?? m.page?.tolerance ?? preset.page.tolerance,
    },
    ink: {
      maxTac: c.ink?.maxTac ?? m.ink?.maxTac ?? preset.ink.maxTac,
      tacTolerance: c.ink?.tacTolerance ?? m.ink?.tacTolerance ?? preset.ink.tacTolerance,
    },
    lint: {
      enabled: c.lint?.enabled ?? m.lint?.enabled ?? preset.lint.enabled,
      configPath: c.lint?.configPath !== undefined
        ? c.lint.configPath
        : m.lint?.configPath !== undefined
          ? m.lint.configPath
          : preset.lint.configPath,
    },
    validate: {
      enabled: c.validate?.enabled ?? m.validate?.enabled ?? preset.validate.enabled,
      checks: { ...preset.validate.checks, ...m.validate?.checks, ...c.validate?.checks },
      source: {
        markdownlint: c.validate?.source?.markdownlint !== undefined
          ? c.validate.source.markdownlint
          : m.validate?.source?.markdownlint !== undefined
            ? m.validate.source.markdownlint
            : preset.validate.source.markdownlint,
        htmlhint: c.validate?.source?.htmlhint !== undefined
          ? c.validate.source.htmlhint
          : m.validate?.source?.htmlhint !== undefined
            ? m.validate.source.htmlhint
            : preset.validate.source.htmlhint,
        stylelint: c.validate?.source?.stylelint !== undefined
          ? c.validate.source.stylelint
          : m.validate?.source?.stylelint !== undefined
            ? m.validate.source.stylelint
            : preset.validate.source.stylelint,
        allowedCallouts: c.validate?.source?.allowedCallouts
          ?? m.validate?.source?.allowedCallouts
          ?? preset.validate.source.allowedCallouts,
      },
      assets: {
        maxImageSize: c.validate?.assets?.maxImageSize ?? m.validate?.assets?.maxImageSize ?? preset.validate.assets.maxImageSize,
        minImageDpi: c.validate?.assets?.minImageDpi ?? m.validate?.assets?.minImageDpi ?? preset.validate.assets.minImageDpi,
        allowedColorSpaces: c.validate?.assets?.allowedColorSpaces ?? m.validate?.assets?.allowedColorSpaces ?? preset.validate.assets.allowedColorSpaces,
        allowAlpha: c.validate?.assets?.allowAlpha ?? m.validate?.assets?.allowAlpha ?? preset.validate.assets.allowAlpha,
        approvedFontFiles: c.validate?.assets?.approvedFontFiles ?? m.validate?.assets?.approvedFontFiles ?? preset.validate.assets.approvedFontFiles,
        requireFontLicense: c.validate?.assets?.requireFontLicense ?? m.validate?.assets?.requireFontLicense ?? preset.validate.assets.requireFontLicense,
      },
      pdf: {
        requireBookmarks: c.validate?.pdf?.requireBookmarks ?? m.validate?.pdf?.requireBookmarks ?? preset.validate.pdf.requireBookmarks,
        requireTocLinks: c.validate?.pdf?.requireTocLinks ?? m.validate?.pdf?.requireTocLinks ?? preset.validate.pdf.requireTocLinks,
        minImageResolution: c.validate?.pdf?.minImageResolution ?? m.validate?.pdf?.minImageResolution ?? preset.validate.pdf.minImageResolution,
        forbidTransparency: c.validate?.pdf?.forbidTransparency ?? m.validate?.pdf?.forbidTransparency ?? preset.validate.pdf.forbidTransparency,
        requireBleed: c.validate?.pdf?.requireBleed ?? m.validate?.pdf?.requireBleed ?? preset.validate.pdf.requireBleed,
        bleedSize: c.validate?.pdf?.bleedSize ?? m.validate?.pdf?.bleedSize ?? preset.validate.pdf.bleedSize,
      },
      heuristics: {
        maxDecorativeLayers: c.validate?.heuristics?.maxDecorativeLayers ?? m.validate?.heuristics?.maxDecorativeLayers ?? preset.validate.heuristics.maxDecorativeLayers,
        textDensityRange: {
          min: c.validate?.heuristics?.textDensityRange?.min ?? m.validate?.heuristics?.textDensityRange?.min ?? preset.validate.heuristics.textDensityRange.min,
          max: c.validate?.heuristics?.textDensityRange?.max ?? m.validate?.heuristics?.textDensityRange?.max ?? preset.validate.heuristics.textDensityRange.max,
        },
        maxParagraphsPerSection: c.validate?.heuristics?.maxParagraphsPerSection ?? m.validate?.heuristics?.maxParagraphsPerSection ?? preset.validate.heuristics.maxParagraphsPerSection,
      },
    },
  };
}
