/**
 * Stylesheet resolution — the SINGLE source of truth for "which stylesheet(s)
 * does this project use?". Both the renderer (which `<link>`s them into the
 * book) and the desktop's Design/Edit-CSS surface (which edits them) consume
 * `resolveActiveStyles`, so the file an author edits is always the file the
 * preview renders. Keeping these in one place is what prevents the
 * "updating the design doesn't change the preview" class of bug.
 *
 * Pure Node fs/path + the lib's manifest parser — NO subprocess, NO bundler, NO
 * runtime package.json reads — so it bundles under `bun build --compile` and
 * runs in the packaged desktop (CLAUDE.md §1/§3).
 *
 * - `resolveActiveStyles` → the ACTIVE set (rendered AND edited): the manifest
 *   `styles:` list if present, else the first conventional stylesheet the
 *   project actually has, else `[]` (no stylesheet — never a phantom link).
 * - `listProjectStyles` → the active set (marked `active`) plus the project's
 *   OTHER discovered `.css` files, for the editor's "switch stylesheet" picker.
 */
import { existsSync } from "node:fs";
import { inlineStyles } from "./asset-inline.ts";
import { composeBookCss } from "./markdown/assemble.ts";
import { loadPluginsWithCss } from "./markdown/plugins.ts";
import type { ResolvedPluginConfig } from "../schema/manifest.types.ts";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { loadManifestWithPath, resolveConfig } from "./manifest.ts";

/** One resolvable project stylesheet for the CSS editor's picker. */
export interface ProjectStyle {
  /** Absolute path to the `.css` file. */
  path: string;
  /** Project-relative, "/"-separated display name (e.g. `themes/dark/theme.css`). */
  displayName: string;
  /** True when this stylesheet is in the manifest `styles:` list (the active set). */
  active: boolean;
}

/** Subdirectories we scan (one level) for additional stylesheets. */
const STYLES_SUBDIR = "styles";
const THEMES_SUBDIR = "themes";

/**
 * Conventional single-stylesheet locations, in priority order, used when a
 * project has no manifest `styles:`. `styles/book.css` is what `gutterpress new`
 * and "set up as a book" scaffold; the `css/*` names are the legacy convention.
 */
const FALLBACK_PRIORITY = [
  "styles/book.css",
  "css/print.css",
  "css/index.css",
  "css/style.css",
  "css/main.css",
];

/** Project-relative, forward-slash display path for an absolute css path. */
function relDisplay(projectDir: string, absPath: string): string {
  return path.relative(projectDir, absPath).split(path.sep).join("/");
}

/** `readdir` with file types; a missing/unreadable dir yields []. */
async function dirEntries(dir: string): Promise<import("node:fs").Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Absolute paths of `.css` files directly inside an already-listed dir. */
function cssFilesFrom(dir: string, entries: import("node:fs").Dirent[]): string[] {
  return entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".css"))
    .map((e) => path.join(dir, e.name));
}

/**
 * Discover candidate stylesheets under a project: root `.css`, `styles/*.css`,
 * and `themes/<id>/theme.css`. Returns absolute paths (deduped). The three
 * top-level directory reads are independent, so they run in parallel.
 */
async function discoverCssFiles(projectDir: string): Promise<string[]> {
  const stylesDir = path.join(projectDir, STYLES_SUBDIR);
  const cssDir = path.join(projectDir, "css");
  const themesRoot = path.join(projectDir, THEMES_SUBDIR);
  const [rootEntries, stylesEntries, cssEntries, themeEntries] = await Promise.all([
    dirEntries(projectDir),
    dirEntries(stylesDir),
    dirEntries(cssDir),
    dirEntries(themesRoot),
  ]);

  const found = new Set<string>([
    ...cssFilesFrom(projectDir, rootEntries),
    ...cssFilesFrom(stylesDir, stylesEntries),
    ...cssFilesFrom(cssDir, cssEntries),
  ]);

  // themes/<id>/theme.css — one level of theme folders.
  for (const entry of themeEntries) {
    if (!entry.isDirectory()) continue;
    const themeCss = path.join(themesRoot, entry.name, "theme.css");
    if (existsSync(themeCss)) found.add(themeCss);
  }

  return [...found];
}

/**
 * THE canonical "which stylesheet does this project use?" resolver — consumed by
 * BOTH the renderer (to `<link>` them) and the editor (to edit them), so they
 * can never disagree. Returns project-relative paths:
 *   1. the manifest `styles:` list, if it has any entries; else
 *   2. the first conventional stylesheet the project actually has
 *      (`FALLBACK_PRIORITY`); else
 *   3. the first discovered `.css` anywhere we scan (deterministic); else
 *   4. `[]` — the project has no stylesheet (an honest empty, never a phantom
 *      link to a missing file).
 * `manifestStyles` is the manifest's `styles:` value (the caller already has it
 * resolved); pass `undefined` to have it read from the manifest.
 */
export async function resolveActiveStyles(
  projectDir: string,
  manifestStyles?: string[],
): Promise<string[]> {
  let configured = manifestStyles;
  if (configured === undefined) {
    const { manifest } = await loadManifestWithPath(projectDir);
    configured = Array.isArray(manifest.styles) ? manifest.styles : [];
  }
  const manifest = configured.filter((s) => typeof s === "string" && s.trim().length > 0);
  if (manifest.length > 0) return manifest;

  for (const rel of FALLBACK_PRIORITY) {
    if (existsSync(path.join(projectDir, rel))) return [rel];
  }

  const discovered = await discoverCssFiles(projectDir);
  if (discovered.length > 0) {
    const first = discovered
      .map((abs) => relDisplay(projectDir, abs))
      .sort((a, b) => a.localeCompare(b))[0]!;
    return [first];
  }
  return [];
}

/**
 * Conventional locations for a multi-book repo's SHARED stylesheets, relative to
 * the repository root. Mirrors the layout the docs prescribe (`shared/styles/`,
 * `shared/themes/<id>/theme.css`) plus the repo-root equivalents of the
 * single-project convention.
 */
const SHARED_STYLE_ROOTS = ["shared", "."];

/**
 * Discover the repository's shared stylesheets, as absolute paths.
 *
 * `listProjectStyles` used to scan only inside the book (2026-07-29 audit), so a
 * `../../shared/...` entry showed up in the desktop Styles picker ONLY while it
 * was listed in the manifest. Unchecking it removed the manifest entry and the
 * next listing dropped it entirely — no way to re-enable it, or to add one, from
 * the UI a non-technical author actually uses; hand-editing `manifest.yaml` was
 * the only way back. Shared stylesheets were second-class in exactly the surface
 * meant to make them easy.
 */
async function discoverSharedCssFiles(repoRoot: string): Promise<string[]> {
  const found = new Set<string>();
  for (const rel of SHARED_STYLE_ROOTS) {
    const base = path.resolve(repoRoot, rel);
    for (const abs of await discoverCssFiles(base)) found.add(abs);
  }
  return [...found];
}

/**
 * Resolve a project's editable stylesheets for the picker: the ACTIVE set
 * (`resolveActiveStyles`, marked `active: true`) followed by the project's OTHER
 * discovered `.css` files (alphabetical). `projectDir` must be absolute. Returns
 * `[]` for a project with no stylesheets at all.
 *
 * Pass `repoRoot` for a book that lives inside a repository: the repo's shared
 * stylesheets are then offered too (see {@link discoverSharedCssFiles}), named
 * the way the manifest stores them — project-relative, e.g.
 * `../../shared/styles/components.css` — so toggling one on writes the right
 * entry. Omit it (or pass the project itself) for the single-project case, which
 * behaves exactly as before.
 */
export async function listProjectStyles(
  projectDir: string,
  opts: { repoRoot?: string } = {},
): Promise<ProjectStyle[]> {
  const repoRoot =
    opts.repoRoot && path.resolve(opts.repoRoot) !== path.resolve(projectDir)
      ? path.resolve(opts.repoRoot)
      : null;
  const [{ manifest }, ownCss, sharedCss] = await Promise.all([
    loadManifestWithPath(projectDir),
    discoverCssFiles(projectDir),
    repoRoot ? discoverSharedCssFiles(repoRoot) : Promise.resolve([]),
  ]);
  const discoveredAbs = [...new Set([...ownCss, ...sharedCss])];
  const activeRels = await resolveActiveStyles(
    projectDir,
    Array.isArray(manifest.styles) ? manifest.styles : undefined,
  );

  const out: ProjectStyle[] = [];
  const seen = new Set<string>();

  // 1. Active styles first (exactly what the renderer links), in order.
  for (const rel of activeRels) {
    const abs = path.resolve(projectDir, rel);
    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push({ path: abs, displayName: relDisplay(projectDir, abs), active: true });
  }

  // 2. Other discovered files, excluding any already active. Sorted by path.
  const discovered = discoveredAbs
    .filter((abs) => !seen.has(abs))
    .map((abs) => ({ path: abs, displayName: relDisplay(projectDir, abs), active: false }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  out.push(...discovered);
  return out;
}

/**
 * The WHOLE stylesheet a built book renders with, fully inlined.
 *
 * All four layers `assembleBookHtml` composes, in its order: Gutterpress's
 * marker layout primitives, then its `gp-*` author vocabulary, then user
 * plugin CSS, then the author's own stylesheets last so project rules win at
 * equal specificity. Any caller that wants "what the book looks like" needs
 * all four.
 *
 * This returned only the project's own stylesheet at first, and the rich
 * editor — its only caller — silently lost the other three. Measured on the
 * user guide, none of `.page`, `.section`, `.chapter`, `.gp-columns-2`,
 * `.gp-bleed` or `.gp-pin` reached the editing surface, so every structural
 * marker and every author utility class rendered unstyled. Worse than
 * cosmetic: `MARKER_CSS` is where `.page`/`.spread`/`.gp-page-break` get their
 * `break-before`, and the editor derives its pagination from the break
 * declarations it can see — so on a book that marks pages with `@page` and
 * writes no `break-*` CSS of its own, `breakMappingCss()` emitted NOTHING and
 * every deliberate page break was ignored.
 *
 * Composing here rather than in the caller is the point: the editor asks for
 * "the book's CSS" and gets the same bytes the PDF is built from, so the two
 * cannot drift.
 *
 * Fonts and images referenced by the stylesheet are already `data:` URIs after
 * inlining, so the result is self-contained and needs no asset staging.
 */
export async function resolveProjectCss(
  projectDir: string,
  manifestStyles?: string[],
  plugins?: ResolvedPluginConfig[] | null,
): Promise<{ css: string; styles: string[]; warnings: string[] }> {
  const warnings: string[] = [];
  // One manifest read, shared with the plugin resolution below.
  const { manifest } = await loadManifestWithPath(projectDir);
  const styles = await resolveActiveStyles(
    projectDir,
    manifestStyles ?? (Array.isArray(manifest.styles) ? manifest.styles : []),
  );
  let projectCss = "";
  if (styles.length > 0) {
    const inlined = await inlineStyles(projectDir, styles);
    projectCss = inlined.css;
    warnings.push(...(inlined.warnings ?? []));
  }

  // Degrade-and-report, the mode the LIVE surfaces use (CLAUDE.md §5): one
  // uninstalled plugin must not blank an author's editor, but every skip is
  // surfaced rather than swallowed.
  //
  // Resolved from the manifest when not supplied, the same way
  // `resolveActiveStyles` resolves `styles` — so a caller that just has a
  // project directory gets the book's real configuration rather than silently
  // getting none of it.
  let pluginCss = "";
  try {
    const configs = plugins === undefined ? resolveConfig({}, manifest).plugins : plugins;
    const loaded = await loadPluginsWithCss(configs, projectDir, (ref, err) =>
      warnings.push(`plugin ${ref} did not load: ${err.message}`),
    );
    pluginCss = loaded.pluginCss;
  } catch (err) {
    warnings.push(`plugin CSS unavailable: ${err instanceof Error ? err.message : String(err)}`);
  }

  // The SAME recipe `assembleBookHtml` uses — one definition, so the editor
  // and the PDF cannot end up on different stylesheets (this used to be a
  // copied array literal, which is how the editor once lost three of the
  // four layers).
  return { css: composeBookCss(pluginCss, projectCss), styles, warnings };
}
