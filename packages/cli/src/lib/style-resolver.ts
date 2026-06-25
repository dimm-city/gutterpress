/**
 * Style resolver — resolve a project's editable stylesheets for the viewer's
 * CSS editor (audit B2/G1).
 *
 * The CSS editor must open the file that actually styles the book — the
 * manifest's `styles:` list (the ACTIVE set) — and let the author switch among
 * the project's other stylesheets (root `.css`, `styles/*.css`,
 * `themes/<id>/theme.css`). `findProjectCssFile` in the renderer only knew
 * about the alphabetical-first ROOT `.css`, so after applying a theme it opened
 * the wrong file.
 *
 * This is the SHARED resolution used by both front-ends (CLI + viewer) through
 * the platform seam. It is pure Node fs/path + the lib's manifest parser — NO
 * subprocess, NO bundler, NO runtime package.json reads — so it bundles cleanly
 * under `bun build --compile` and runs in the packaged viewer (CLAUDE.md §1/§3).
 *
 * Resolution:
 *   1. Read the manifest `styles:` list (relative to the manifest dir). Each
 *      entry is an ACTIVE stylesheet, returned in manifest order, marked
 *      `active: true` — even if the file is missing (so the editor can surface
 *      a wired-but-missing stylesheet).
 *   2. Discover other `.css` files: the project root, `styles/`, and each
 *      `themes/<id>/theme.css`. Anything already in the manifest list is NOT
 *      duplicated. Discovered (non-active) files are sorted alphabetically by
 *      their relative path and appended after the active set.
 *
 * When there are no manifest styles, ALL discovered files are returned (none
 * active), alphabetically — preserving the old alphabetical-fallback behaviour.
 */
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { loadManifestWithPath } from "./manifest.ts";

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

/** Project-relative, forward-slash display path for an absolute css path. */
function relDisplay(projectDir: string, absPath: string): string {
  return path.relative(projectDir, absPath).split(path.sep).join("/");
}

/** List `.css` files directly inside `dir` (absolute paths). Missing dir → []. */
async function cssFilesIn(dir: string): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".css"))
    .map((e) => path.join(dir, e.name));
}

/**
 * Discover candidate stylesheets under a project: root `.css`, `styles/*.css`,
 * and `themes/<id>/theme.css`. Returns absolute paths (deduped).
 */
async function discoverCssFiles(projectDir: string): Promise<string[]> {
  const found = new Set<string>();

  for (const p of await cssFilesIn(projectDir)) found.add(p);
  for (const p of await cssFilesIn(path.join(projectDir, STYLES_SUBDIR))) found.add(p);

  // themes/<id>/theme.css — one level of theme folders.
  const themesRoot = path.join(projectDir, THEMES_SUBDIR);
  let themeEntries: import("node:fs").Dirent[] = [];
  try {
    themeEntries = await readdir(themesRoot, { withFileTypes: true });
  } catch {
    themeEntries = [];
  }
  for (const entry of themeEntries) {
    if (!entry.isDirectory()) continue;
    const themeCss = path.join(themesRoot, entry.name, "theme.css");
    if (existsSync(themeCss)) found.add(themeCss);
  }

  return [...found];
}

/**
 * Resolve a project's editable stylesheets: the manifest `styles:` set (active,
 * in order) followed by the other discovered `.css` files (alphabetical).
 * `projectDir` must be an absolute path. Returns `[]` for a project with no
 * stylesheets.
 */
export async function listProjectStyles(projectDir: string): Promise<ProjectStyle[]> {
  const { manifest, manifestDir } = await loadManifestWithPath(projectDir);

  const activeRels = Array.isArray(manifest.styles) ? manifest.styles : [];
  const out: ProjectStyle[] = [];
  const seen = new Set<string>();

  // 1. Active styles first, in manifest order. Resolved relative to the
  //    manifest dir (the lib resolves `styles:` against the manifest location).
  for (const rel of activeRels) {
    if (typeof rel !== "string" || rel.trim().length === 0) continue;
    const abs = path.resolve(manifestDir, rel);
    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push({ path: abs, displayName: relDisplay(projectDir, abs), active: true });
  }

  // 2. Discovered files (root, styles/, themes/*/theme.css), excluding any
  //    already listed as active. Sorted alphabetically by display path.
  const discovered = (await discoverCssFiles(projectDir))
    .filter((abs) => !seen.has(abs))
    .map((abs) => ({
      path: abs,
      displayName: relDisplay(projectDir, abs),
      active: false,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  out.push(...discovered);
  return out;
}
