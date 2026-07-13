/**
 * Theme manager (#32) — list / apply / import print-md themes.
 *
 * A THEME is a folder containing `theme.css` plus optional `theme.json`
 * metadata (`name`, `author`, `description`, `preview`). A theme MAY bundle
 * fonts/assets alongside `theme.css`; apply copies the WHOLE folder so the
 * theme is self-contained and travels with the project.
 *
 * Two sources, one {@link ThemeInfo} shape:
 *
 *   - BUILT-IN: shipped as embedded assets (`assets/themes/<id>/`), baked into
 *     the CLI binary via `embedded-assets.ts` (CLAUDE.md §4). Four ship:
 *     clean-book, ttrpg-supplement, zine, technical-doc.
 *
 *   - PROJECT: a theme that lives inside the open project under `themes/<id>/`.
 *     These appear after the author APPLIES a built-in theme or IMPORTS one
 *     (from a folder or a URL). They are listed by scanning `themes/`.
 *
 * APPLY = COPY (not reference). Rationale (Occam + self-containment): copying
 * the theme folder into `themes/<id>/` means the project carries its own CSS +
 * fonts with no external path dependency, so preview/build/PDF and version
 * control all see one tree. The manifest's `styles:` list is then wired so the
 * theme's `theme.css` is the active stylesheet. We treat any `styles:` entry
 * matching `themes/<id>/theme.css` as "the active theme" — applying a new theme
 * removes the previous theme's entry and adds the new one, leaving the
 * project's OWN (non-theme) stylesheets untouched. This is the SIMPLEST
 * representation that makes the active theme both readable and switchable.
 *
 * This module is pure Node fs + the global `fetch` (URL import) — NO subprocess,
 * NO bundler, NO runtime package.json reads — so it works under
 * `bun build --compile` and in the packaged viewer alike (CLAUDE.md §1/§3), and
 * is consumed by BOTH front-ends through the platform seam (one impl).
 */
import { cp, mkdir, readFile, readdir, stat, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { isSeq, Scalar } from "yaml";
import type { Node } from "yaml";

import { getAssetPath } from "./embedded-assets.ts";
import { loadManifestDoc, writeManifestDoc, ensureSeq, scalarString } from "./manifest-doc.ts";
import { slugify, prettify } from "./slug.ts";

/** Folder (relative to the project root) themes are copied into on apply/import. */
export const THEMES_DIR = "themes";

/** The built-in themes shipped as embedded assets (ids are folder names). */
export const BUILT_IN_THEME_IDS = [
  "clean-book",
  "ttrpg-supplement",
  "zine",
  "technical-doc",
] as const;

export type BuiltInThemeId = (typeof BUILT_IN_THEME_IDS)[number];

/** Parsed `theme.json` metadata (every field optional in the file). */
export interface ThemeMetadata {
  name?: string;
  author?: string;
  description?: string;
  /** Optional preview image path (relative to the theme folder). */
  preview?: string | null;
}

/** Author-friendly metadata for one theme (built-in or project). */
export interface ThemeInfo {
  /** Stable id (a built-in id, or a slug for imported/applied themes). */
  id: string;
  /** Display name. */
  name: string;
  /** Theme author, when known. */
  author?: string;
  /** One-line description. */
  description: string;
  /** `"builtin"` (embedded) or `"project"` (copied into the project). */
  kind: "builtin" | "project";
  /** Optional preview image path relative to the theme folder. */
  preview?: string | null;
}

/** A built-in theme resolved to disk (extracted from the embedded assets). */
export interface ResolvedTheme {
  info: ThemeInfo;
  /** Absolute path to the theme's `theme.css` (in the extracted assets dir). */
  cssPath: string;
  /** Absolute path to the theme's folder. */
  dir: string;
}

/** Which theme to apply: a built-in id, or a project theme already on disk. */
export type ApplyThemeTarget =
  | { kind: "builtin"; id: BuiltInThemeId | string }
  | { kind: "project"; id: string };

const BUILT_IN_FALLBACK_META: Record<BuiltInThemeId, { name: string; description: string }> = {
  "clean-book": {
    name: "Clean Book",
    description: "A calm, classic book look: serif body, generous margins.",
  },
  "ttrpg-supplement": {
    name: "TTRPG Supplement",
    description: "Bold display headings, parchment fills, boxed stat blocks.",
  },
  zine: {
    name: "Zine",
    description: "High-contrast, punchy sans-serif for short printed zines.",
  },
  "technical-doc": {
    name: "Technical Document",
    description: "Clean sans-serif manual with clear hierarchy and code styling.",
  },
};

/** Parse a `theme.json` (best-effort: tolerate missing/invalid JSON). */
async function readThemeMeta(jsonPath: string): Promise<ThemeMetadata> {
  try {
    const text = await readFile(jsonPath, "utf8");
    const parsed = JSON.parse(text) as ThemeMetadata;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Build a ThemeInfo from a folder's metadata + id, supplying sane fallbacks. */
function themeInfo(
  id: string,
  kind: "builtin" | "project",
  meta: ThemeMetadata,
): ThemeInfo {
  return {
    id,
    name: meta.name?.trim() || prettify(id),
    author: meta.author?.trim() || undefined,
    description: meta.description?.trim() || "",
    kind,
    preview: meta.preview ?? null,
  };
}

/** Slugify a theme name/url into a safe directory id (never empty — "theme"). */
function themeSlug(name: string): string {
  return slugify(name, "theme");
}

/**
 * Guard a theme `id` that becomes a path segment under the project's themes/
 * dir. Any id that isn't a clean slug (contains `/`, `\`, `..`, etc.) is
 * rejected — these ids drive `cp`/`rm -rf`/`readFile`, so a traversal here is a
 * data-loss/exfiltration vector. Returns the resolved themes-dir path.
 */
function themeDirFor(projectDir: string, id: string): string {
  if (typeof id !== "string" || id.length === 0 || themeSlug(id) !== id) {
    throw new Error(`Invalid theme id "${id}".`);
  }
  return path.join(projectDir, THEMES_DIR, id);
}

/** List the built-in themes (metadata read from the extracted embedded assets). */
export async function listBuiltInThemes(): Promise<ThemeInfo[]> {
  const out: ThemeInfo[] = [];
  for (const id of BUILT_IN_THEME_IDS) {
    let meta: ThemeMetadata = {};
    try {
      meta = await readThemeMeta(await getAssetPath(`${THEMES_DIR}/${id}/theme.json`));
    } catch {
      meta = {};
    }
    // Fall back to the static table if the embedded json could not be read.
    if (!meta.name) meta.name = BUILT_IN_FALLBACK_META[id as BuiltInThemeId]?.name;
    if (!meta.description) {
      meta.description = BUILT_IN_FALLBACK_META[id as BuiltInThemeId]?.description;
    }
    out.push(themeInfo(id, "builtin", meta));
  }
  return out;
}

/** Resolve a built-in theme to its extracted `theme.css` + parsed metadata. */
export async function resolveBuiltInTheme(id: string): Promise<ResolvedTheme> {
  if (!(BUILT_IN_THEME_IDS as readonly string[]).includes(id)) {
    throw new Error(`Unknown built-in theme: "${id}".`);
  }
  const cssPath = await getAssetPath(`${THEMES_DIR}/${id}/theme.css`);
  const jsonPath = await getAssetPath(`${THEMES_DIR}/${id}/theme.json`);
  if (!existsSync(cssPath)) {
    throw new Error(`Built-in theme "${id}" is missing its theme.css.`);
  }
  const meta = await readThemeMeta(jsonPath);
  if (!meta.name) meta.name = BUILT_IN_FALLBACK_META[id as BuiltInThemeId]?.name;
  if (!meta.description) {
    meta.description = BUILT_IN_FALLBACK_META[id as BuiltInThemeId]?.description;
  }
  return { info: themeInfo(id, "builtin", meta), cssPath, dir: path.dirname(cssPath) };
}

/**
 * List the themes that live inside the project under `themes/<id>/` (each a
 * folder with a `theme.css`). Returns `[]` when there is no `themes/` folder.
 */
export async function listProjectThemes(projectDir: string): Promise<ThemeInfo[]> {
  const root = path.join(projectDir, THEMES_DIR);
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: ThemeInfo[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    if (!existsSync(path.join(dir, "theme.css"))) continue;
    const meta = await readThemeMeta(path.join(dir, "theme.json"));
    out.push(themeInfo(entry.name, "project", meta));
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// ── Manifest wiring ──────────────────────────────────────────────────────────

/** The relative `styles:` href for a project theme's css. */
function themeStyleHref(id: string): string {
  return `${THEMES_DIR}/${id}/theme.css`;
}

/** Match any `themes/<id>/theme.css` style entry; capture the id. */
const THEME_HREF_RE = new RegExp(`^${THEMES_DIR}/([^/]+)/theme\\.css$`);

/**
 * Read the project's currently active theme (the theme whose `theme.css` is in
 * the manifest `styles:` list AND whose folder exists under `themes/`). Returns
 * `null` when no theme is applied.
 */
export async function getActiveTheme(projectDir: string): Promise<ThemeInfo | null> {
  const { doc } = await loadManifestDoc(projectDir);
  const seq = doc.get("styles", true);
  if (!isSeq(seq)) return null;
  for (const item of seq.items as Node[]) {
    const href = scalarString(item);
    if (!href) continue;
    const m = href.match(THEME_HREF_RE);
    if (!m) continue;
    const id = m[1]!;
    const dir = path.join(projectDir, THEMES_DIR, id);
    if (!existsSync(path.join(dir, "theme.css"))) continue;
    const meta = await readThemeMeta(path.join(dir, "theme.json"));
    return themeInfo(id, "project", meta);
  }
  return null;
}

/**
 * Wire the manifest `styles:` list so `themes/<id>/theme.css` is the active
 * theme: remove any previous theme `theme.css` entry, then append the new
 * one. The project's own (non-theme) stylesheets are preserved. Comments and
 * formatting round-trip via the yaml Document API.
 */
async function setActiveThemeStyle(projectDir: string, id: string): Promise<void> {
  const { doc, file } = await loadManifestDoc(projectDir);
  const seq = ensureSeq(doc, "styles");
  const href = themeStyleHref(id);

  // Drop any existing theme style entry (we keep exactly one active theme).
  const kept = (seq.items as Node[]).filter((item) => {
    const h = scalarString(item);
    return !(h && THEME_HREF_RE.test(h));
  });
  seq.items = kept;
  seq.add(new Scalar(href));

  // ARCH finding #25: route the write through the shared writeManifestDoc
  // (manifest-doc.ts) instead of a bespoke mkdir+writeFile pair, so there is
  // one manifest-write implementation, not two that can silently diverge.
  await writeManifestDoc(file, doc);
}

// ── Apply ──────────────────────────────────────────────────────────────────

/**
 * Apply a theme to the project: COPY the theme folder into `themes/<id>/`
 * (built-in themes are copied out of the embedded assets; project themes are
 * already present) and wire the manifest so its `theme.css` is the active
 * stylesheet. Returns the applied {@link ThemeInfo}.
 *
 * No-data-loss mandate (UX review M6): a project theme's `theme.css` is the
 * exact file the Design panel writes token edits into, so re-copying a
 * built-in over an EXISTING `themes/<id>/` would silently discard every
 * customization the author made after the first apply. Applying a built-in
 * therefore never overwrites an existing project theme folder — if one is
 * already there (customized or not), the built-in is copied into a fresh id
 * (via the same {@link uniqueThemeId} helper import/folder-import uses) and
 * THAT becomes active, leaving the original folder untouched. In the normal UI flow the
 * Appearance grid hides a built-in card once its project copy exists (so this
 * path isn't reachable by clicking Apply twice); this guard is the
 * defense-in-depth backstop for any other caller of this function.
 */
export async function applyTheme(
  projectDir: string,
  target: ApplyThemeTarget,
): Promise<ThemeInfo> {
  let info: ThemeInfo;

  if (target.kind === "builtin") {
    const resolved = await resolveBuiltInTheme(target.id);
    let destId = target.id;
    if (existsSync(path.join(projectDir, THEMES_DIR, destId, "theme.css"))) {
      destId = await uniqueThemeId(projectDir, target.id);
    }
    const destDir = path.join(projectDir, THEMES_DIR, destId);
    await mkdir(destDir, { recursive: true });
    // Copy the whole theme folder (css + json + any bundled fonts/assets).
    await cp(resolved.dir, destDir, { recursive: true });
    // The copied theme now lives in the project — surface it as a project theme.
    info = themeInfo(destId, "project", await readThemeMeta(path.join(destDir, "theme.json")));
  } else {
    const dir = themeDirFor(projectDir, target.id);
    if (!existsSync(path.join(dir, "theme.css"))) {
      throw new Error(`Theme "${target.id}" is not present in this project.`);
    }
    info = themeInfo(target.id, "project", await readThemeMeta(path.join(dir, "theme.json")));
  }

  await setActiveThemeStyle(projectDir, info.id);
  return info;
}

// ── Import ───────────────────────────────────────────────────────────────────

/** Ensure a unique id under the project's themes/ folder (suffix on collision). */
async function uniqueThemeId(projectDir: string, base: string): Promise<string> {
  const root = path.join(projectDir, THEMES_DIR);
  let id = themeSlug(base);
  let n = 2;
  while (existsSync(path.join(root, id))) {
    id = `${themeSlug(base)}-${n++}`;
  }
  return id;
}

/**
 * Import a theme from a local folder by copying it into the project's
 * `themes/<id>/`. The folder MUST contain a `theme.css`. Metadata comes from
 * its `theme.json` (synthesised from the folder name when absent). The imported
 * theme becomes available to {@link applyTheme}; importing does NOT auto-apply.
 */
export async function importThemeFromFolder(
  projectDir: string,
  sourceDir: string,
): Promise<ThemeInfo> {
  let info;
  try {
    info = await stat(sourceDir);
  } catch {
    throw new Error(`Theme source not found: ${sourceDir}`);
  }
  if (!info.isDirectory()) {
    throw new Error("The chosen path is not a folder.");
  }
  if (!existsSync(path.join(sourceDir, "theme.css"))) {
    throw new Error("A theme folder must contain a theme.css file.");
  }

  const meta = await readThemeMeta(path.join(sourceDir, "theme.json"));
  const base = meta.name || path.basename(sourceDir);
  const id = await uniqueThemeId(projectDir, base);
  const destDir = path.join(projectDir, THEMES_DIR, id);
  await mkdir(path.dirname(destDir), { recursive: true });
  await cp(sourceDir, destDir, { recursive: true });
  return themeInfo(id, "project", await readThemeMeta(path.join(destDir, "theme.json")));
}

/** Treat a URL as raw CSS when it ends in .css; otherwise as a theme folder. */
function looksLikeCssUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.pathname.toLowerCase().endsWith(".css");
  } catch {
    return url.toLowerCase().endsWith(".css");
  }
}

async function fetchText(url: string): Promise<string> {
  // Only http(s). Bun's global fetch will happily read file:// (and other
  // schemes), which would turn theme-import into an arbitrary local-file read.
  let scheme: string;
  try {
    scheme = new URL(url).protocol;
  } catch {
    throw new Error(`Invalid theme URL "${url}".`);
  }
  if (scheme !== "http:" && scheme !== "https:") {
    throw new Error(`Theme URL must be http(s) — got "${scheme}".`);
  }
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url} (HTTP ${res.status}).`);
  }
  return res.text();
}

/** Reject content that is obviously HTML (a 200 error/SPA page), not CSS. */
function assertLooksLikeCss(text: string, url: string): void {
  if (/^\s*<(?:!doctype|html|head|body)\b/i.test(text)) {
    throw new Error(
      `The content at ${url} looks like HTML, not CSS — check the URL points at a stylesheet.`,
    );
  }
}

/**
 * Import a theme from a URL using the global `fetch` (bundle-safe — no node http
 * client). Two shapes are supported:
 *
 *   - RAW CSS: a `…/theme.css` (or any `.css`) URL → fetched as the theme's
 *     `theme.css`; metadata is synthesised from the URL.
 *   - THEME FOLDER: a base URL (no `.css`) → we fetch `<base>/theme.json`
 *     (optional) and `<base>/theme.css` (required) to assemble the theme.
 *
 * The fetched theme is written into the project's `themes/<id>/`. Bundled fonts
 * are NOT followed for URL imports (a single CSS file + optional metadata) to
 * keep the fetch surface small and predictable; authors wanting bundled assets
 * use folder import.
 */
export async function importThemeFromUrl(
  projectDir: string,
  url: string,
): Promise<ThemeInfo> {
  const trimmed = url.trim();
  if (!trimmed) throw new Error("A theme URL is required.");

  let css: string;
  let meta: ThemeMetadata = {};
  let baseName: string;

  if (looksLikeCssUrl(trimmed)) {
    css = await fetchText(trimmed);
    baseName = path.basename(new URL(trimmed, "https://x/").pathname, ".css") || "theme";
  } else {
    const base = trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
    css = await fetchText(`${base}theme.css`);
    try {
      const metaText = await fetchText(`${base}theme.json`);
      const parsed = JSON.parse(metaText) as ThemeMetadata;
      if (parsed && typeof parsed === "object") meta = parsed;
    } catch {
      // theme.json is optional for folder URLs.
    }
    baseName =
      meta.name ||
      path.basename(new URL(base, "https://x/").pathname.replace(/\/$/, "")) ||
      "theme";
  }

  if (!css.trim()) {
    throw new Error(`Fetched theme CSS from ${trimmed} was empty.`);
  }
  assertLooksLikeCss(css, trimmed);

  const id = await uniqueThemeId(projectDir, meta.name || baseName);
  const destDir = path.join(projectDir, THEMES_DIR, id);
  await mkdir(destDir, { recursive: true });
  await writeFile(path.join(destDir, "theme.css"), css, "utf8");
  const finalMeta: ThemeMetadata = {
    name: meta.name || prettify(id),
    author: meta.author,
    description: meta.description,
    preview: meta.preview ?? null,
  };
  await writeFile(
    path.join(destDir, "theme.json"),
    JSON.stringify(finalMeta, null, 2),
    "utf8",
  );
  return themeInfo(id, "project", finalMeta);
}

/**
 * Read a theme's CSS for previewing. Built-in themes read from the embedded
 * assets; project themes read from `themes/<id>/theme.css`. Used by the host to
 * feed the renderer a sample-render thumbnail (the renderer never touches fs).
 */
export async function readThemeCss(
  projectDir: string | null,
  source: { kind: "builtin" | "project"; id: string },
): Promise<string> {
  if (source.kind === "builtin") {
    const resolved = await resolveBuiltInTheme(source.id);
    return readFile(resolved.cssPath, "utf8");
  }
  if (!projectDir) throw new Error("A project is required to read a project theme.");
  const cssPath = path.join(themeDirFor(projectDir, source.id), "theme.css");
  if (!existsSync(cssPath)) {
    throw new Error(`Theme "${source.id}" has no theme.css in this project.`);
  }
  return readFile(cssPath, "utf8");
}

/**
 * Remove an imported/applied project theme folder. If it was the active theme,
 * its `styles:` entry is dropped too. Never touches built-in (embedded) themes.
 */
export async function removeProjectTheme(projectDir: string, id: string): Promise<void> {
  // themeDirFor rejects any non-slug id BEFORE the rm -rf — a traversal here
  // would delete arbitrary directories (no-data-loss mandate).
  const dir = themeDirFor(projectDir, id);
  if (existsSync(dir)) {
    await rm(dir, { recursive: true, force: true });
  }
  const { doc, file } = await loadManifestDoc(projectDir);
  const seq = doc.get("styles", true);
  if (isSeq(seq)) {
    const href = themeStyleHref(id);
    const before = seq.items.length;
    seq.items = (seq.items as Node[]).filter((item) => scalarString(item) !== href);
    if (seq.items.length !== before) {
      // ARCH finding #25: same shared write path as setActiveThemeStyle.
      await writeManifestDoc(file, doc);
    }
  }
}
