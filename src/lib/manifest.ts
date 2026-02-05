import { readFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { parse as parseYaml } from "yaml";
import type { PrintMdManifest, ResolvedConfig, PluginConfig, ResolvedPluginConfig } from "../schema/manifest.types";
import { DTRPG_PRESET, PRESETS } from "./presets";

/**
 * Load manifest.yaml from a given path or CWD.
 * Returns an empty object if the file doesn't exist.
 */
export async function loadManifest(
  pathOrDir?: string
): Promise<PrintMdManifest> {
  const candidates = pathOrDir
    ? [
        resolve(pathOrDir),
        resolve(pathOrDir, "manifest.yaml"),
        resolve(pathOrDir, "manifest.yml"),
      ]
    : [
        resolve("manifest.yaml"),
        resolve("manifest.yml"),
      ];

  for (const p of candidates) {
    if (existsSync(p) && statSync(p).isFile()) {
      const raw = await readFile(p, "utf8");
      return (parseYaml(raw) as PrintMdManifest) ?? {};
    }
  }
  return {};
}

/**
 * Load manifest.yaml and return both the manifest and the directory it was found in.
 * Returns an empty manifest and the current working directory if no manifest is found.
 */
export async function loadManifestWithPath(
  pathOrDir?: string
): Promise<{ manifest: PrintMdManifest; manifestDir: string }> {
  const candidates = pathOrDir
    ? [
        resolve(pathOrDir),
        resolve(pathOrDir, "manifest.yaml"),
        resolve(pathOrDir, "manifest.yml"),
      ]
    : [
        resolve("manifest.yaml"),
        resolve("manifest.yml"),
      ];

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
 * Normalize a plugin configuration entry from manifest.
 * Accepts either a string path or a PluginConfig object.
 */
function normalizePluginConfig(plugin: string | PluginConfig): ResolvedPluginConfig {
  if (typeof plugin === 'string') {
    return {
      path: plugin,
      priority: 100,
      options: {},
    };
  }
  return {
    path: plugin.path,
    name: plugin.name,
    version: plugin.version,
    priority: plugin.priority ?? 100,
    options: plugin.options ?? {},
  };
}

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

  // Resolve plugins from CLI overrides or manifest
  const rawPlugins = c.plugins ?? m.plugins ?? [];
  const plugins = rawPlugins
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
      html: c.output?.html ?? m.output?.html ?? preset.output.html,
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
  };
}
