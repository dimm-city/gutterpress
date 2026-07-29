/**
 * Theme package import (#106) — bring a theme into a project from a `.zip`
 * package or a bare `.css` file, formalizing the existing theme-folder format
 * (a folder with a required `theme.css` + optional `theme.json` + optional
 * bundled assets). NO new format is invented: a `.zip` is unzipped to its
 * theme root and a bare `.css` is wrapped into a one-file theme folder, and
 * both then reuse {@link importThemeFromFolder}.
 *
 * Host-side only (node fs + fflate + postcss via `checkCss`) — reached by the
 * desktop through the `api/theme/import-from-file` server route (CLAUDE.md §8),
 * and shared with the CLI (§7 "shared lib, not duplicated"). The pure decision
 * helpers (zip-root location, path-safety, findings → reject/warn mapping,
 * unexpected-file detection) are exported separately so they unit-test without
 * touching the filesystem.
 *
 * Bundle-safe (§1/§3): fflate is a normal pure-JS dep, no runtime package.json
 * reads, no computed dynamic imports.
 */
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { unzipSync } from "fflate";

import { checkCss, ruleSyntax, type PrintSafeWarning } from "./printsafe.ts";
import { importThemeFromFolder, type ThemeInfo } from "./theme-manager.ts";
import { prettify } from "./slug.ts";

/** Reject a raw archive larger than this before unzipping (zip-bomb surface). */
export const MAX_THEME_ARCHIVE_BYTES = 25 * 1024 * 1024;
/** Reject an archive whose entries expand past this in total (zip-bomb surface). */
export const MAX_THEME_UNZIPPED_BYTES = 25 * 1024 * 1024;

/** A non-fatal issue surfaced to the author after a successful import. */
export interface ThemeImportWarning {
  code: "print-safety" | "no-theme-json" | "unnamed-theme" | "extra-files";
  message: string;
}

/** Outcome of a `.zip` / `.css` import: the imported theme + any warnings. */
export interface ThemeImportResult {
  theme: ThemeInfo;
  warnings: ThemeImportWarning[];
}

// ── Pure decision helpers (unit-tested; no fs) ───────────────────────────────

/**
 * Is this zip entry name unsafe to extract? Rejects absolute paths (posix or
 * Windows drive), and any `..` segment (zip-slip / path traversal). Callers
 * ALSO do a resolved-containment check as defense-in-depth.
 */
export function isUnsafeZipEntryPath(name: string): boolean {
  const norm = name.replace(/\\/g, "/");
  if (norm.length === 0) return true;
  if (norm.startsWith("/")) return true; // absolute posix
  if (/^[a-zA-Z]:/.test(norm)) return true; // windows drive (C:...)
  return norm.split("/").some((seg) => seg === "..");
}

/**
 * Locate the theme root inside a zip's entry names: the directory that directly
 * contains `theme.css`, allowed at the archive root (`""`) or exactly one level
 * down. Returns the root prefix (`""` for root, or the single sub-directory
 * name), or `null` when there is no unambiguous theme root (none, or more than
 * one candidate folder each holding a `theme.css`).
 */
export function locateThemeRoot(names: string[]): string | null {
  const files = names
    .map((n) => n.replace(/\\/g, "/"))
    .filter((n) => n.length > 0 && !n.endsWith("/"));
  if (files.includes("theme.css")) return "";
  const roots = new Set<string>();
  for (const f of files) {
    const m = f.match(/^([^/]+)\/theme\.css$/);
    if (m) roots.add(m[1]!);
  }
  if (roots.size === 1) return [...roots][0]!;
  return null;
}

/**
 * Split print-safety findings into the one that REJECTS the import (a CSS
 * syntax/parse failure — the stylesheet is unusable) vs. WARN findings the
 * author should still see (remote URLs, risky print effects, paged.js crash
 * selectors) that import anyway. The discriminator is the rule id, not
 * severity: `no-remote-urls`/`no-pagedjs-crash-selectors` are `error`-severity
 * but the #106 spec still imports them with a warning; only `syntax-error`
 * refuses.
 */
export function classifyThemeCssFindings(findings: PrintSafeWarning[]): {
  reject: PrintSafeWarning | null;
  warnings: PrintSafeWarning[];
} {
  const reject = findings.find((f) => f.rule === ruleSyntax) ?? null;
  const warnings = reject ? [] : findings.filter((f) => f.rule !== ruleSyntax);
  return { reject, warnings };
}

const KNOWN_THEME_FILES = new Set(["theme.css", "theme.json"]);
const ALLOWED_ASSET_EXTS = new Set([
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".avif",
  ".css",
]);

/**
 * From a theme folder's relative file paths, return the ones that are neither
 * `theme.css`/`theme.json` nor a recognized bundled asset (font/image/css).
 * These trigger a non-fatal "unexpected extra files" warning — the import
 * still copies the whole folder.
 */
export function unexpectedThemeFiles(relPaths: string[]): string[] {
  return relPaths
    .map((p) => p.replace(/\\/g, "/"))
    .filter((p) => p.length > 0 && !p.endsWith("/"))
    .filter((p) => {
      const base = p.split("/").pop()!.toLowerCase();
      if (KNOWN_THEME_FILES.has(base)) return false;
      const dot = base.lastIndexOf(".");
      const ext = dot >= 0 ? base.slice(dot) : "";
      return !ALLOWED_ASSET_EXTS.has(ext);
    });
}

// ── Host import pipeline ─────────────────────────────────────────────────────

function mb(n: number): string {
  return `${Math.round(n / (1024 * 1024))}MB`;
}

/** Best-effort read of a theme.json; `null` when absent or unparseable. */
async function readThemeJson(p: string): Promise<{ name?: string } | null> {
  try {
    const parsed = JSON.parse(await readFile(p, "utf8")) as { name?: string };
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return null;
  }
}

/**
 * Validate an already-extracted theme folder, then hand it to
 * {@link importThemeFromFolder}. REJECTS (throws) when `theme.css` is missing
 * or fails to parse; otherwise collects WARN findings (print-safety, missing/
 * unnamed theme.json, unexpected extra files) and returns them with the
 * imported theme.
 */
async function finalizeThemeImport(
  projectDir: string,
  sourceDir: string,
  relPaths: string[],
): Promise<ThemeImportResult> {
  const cssPath = path.join(sourceDir, "theme.css");
  if (!existsSync(cssPath)) {
    throw new Error("A theme must contain a theme.css file.");
  }
  const css = await readFile(cssPath, "utf8");
  const { reject, warnings: printFindings } = classifyThemeCssFindings(
    checkCss(css, "theme.css"),
  );
  if (reject) {
    throw new Error(`theme.css could not be parsed — ${reject.message}`);
  }

  const warnings: ThemeImportWarning[] = [];
  for (const w of printFindings) {
    warnings.push({ code: "print-safety", message: w.message });
  }

  const jsonPath = path.join(sourceDir, "theme.json");
  if (!existsSync(jsonPath)) {
    warnings.push({
      code: "no-theme-json",
      message:
        "No theme.json found — the theme's name was taken from the file/folder name.",
    });
  } else {
    const meta = await readThemeJson(jsonPath);
    if (!meta || !meta.name || !meta.name.trim()) {
      warnings.push({
        code: "unnamed-theme",
        message:
          'theme.json has no "name" — the theme\'s name was taken from the file/folder name.',
      });
    }
  }

  const extra = unexpectedThemeFiles(relPaths);
  if (extra.length > 0) {
    const shown = extra.slice(0, 6).join(", ");
    warnings.push({
      code: "extra-files",
      message: `The theme bundles files that aren't a stylesheet or common asset: ${shown}${extra.length > 6 ? ", …" : ""}`,
    });
  }

  const theme = await importThemeFromFolder(projectDir, sourceDir);
  return { theme, warnings };
}

/**
 * Import a theme from a `.zip` package. Unzips in memory (fflate), rejects
 * unsafe paths and over-cap archives, locates the theme root (at the archive
 * root or one folder down), extracts just that subtree to a temp folder, and
 * finalizes via {@link finalizeThemeImport}. Lands the theme in
 * `themes/<uniqueId>/` (never overwrites an existing theme).
 */
export async function importThemeFromZip(
  projectDir: string,
  archive: Uint8Array,
): Promise<ThemeImportResult> {
  if (archive.length > MAX_THEME_ARCHIVE_BYTES) {
    throw new Error(`Theme package is too large (max ${mb(MAX_THEME_ARCHIVE_BYTES)}).`);
  }

  // Enforce path-safety and the unzipped-size cap in fflate's `filter`, which
  // runs per entry BEFORE that entry is decompressed (using the central
  // directory's `originalSize`). A zip bomb therefore aborts once the running
  // total crosses the cap instead of fully inflating into memory first — the
  // post-hoc check it replaced could not prevent the OOM it documented.
  let files: Record<string, Uint8Array>;
  let total = 0;
  let unsafePath: string | null = null;
  let overCap = false;
  try {
    files = unzipSync(archive, {
      filter: (file) => {
        if (file.name.endsWith("/")) return false; // directory entry
        if (unsafePath || overCap) return false; // already rejecting — skip the rest
        if (isUnsafeZipEntryPath(file.name)) {
          unsafePath = file.name;
          return false;
        }
        total += file.originalSize;
        if (total > MAX_THEME_UNZIPPED_BYTES) {
          overCap = true;
          return false;
        }
        return true;
      },
    });
  } catch {
    throw new Error("That file is not a valid .zip package.");
  }
  if (unsafePath !== null) {
    throw new Error(`The package contains an unsafe path and was rejected: ${unsafePath}`);
  }
  if (overCap) {
    throw new Error(
      `Theme package expands to more than ${mb(MAX_THEME_UNZIPPED_BYTES)} and was rejected.`,
    );
  }

  const root = locateThemeRoot(Object.keys(files));
  if (root === null) {
    throw new Error(
      "No theme.css found in the package. A theme needs a theme.css at the package root or inside a single folder.",
    );
  }
  const prefix = root === "" ? "" : `${root}/`;

  const tmp = await mkdtemp(path.join(tmpdir(), "gutterpress-theme-"));
  try {
    const relPaths: string[] = [];
    for (const [name, data] of Object.entries(files)) {
      if (name.endsWith("/")) continue;
      const norm = name.replace(/\\/g, "/");
      if (prefix && !norm.startsWith(prefix)) continue;
      const rel = prefix ? norm.slice(prefix.length) : norm;
      if (!rel || rel.split("/").some((seg) => seg === "..")) continue;
      const dest = path.join(tmp, rel);
      // Defense-in-depth: the extracted file must stay inside the temp dir.
      if (dest !== tmp && !dest.startsWith(tmp + path.sep)) {
        throw new Error(`The package contains an unsafe path and was rejected: ${name}`);
      }
      relPaths.push(rel);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, data);
    }
    return await finalizeThemeImport(projectDir, tmp, relPaths);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/**
 * Import a theme from a bare `.css` file by wrapping it into a one-file theme
 * folder (`theme.css` + a synthesized `theme.json` naming it). REJECTS a CSS
 * that fails to parse.
 */
export async function importThemeFromCssText(
  projectDir: string,
  css: string,
  name: string,
): Promise<ThemeImportResult> {
  const { reject } = classifyThemeCssFindings(checkCss(css, "theme.css"));
  if (reject) {
    throw new Error(`The CSS could not be parsed — ${reject.message}`);
  }
  const displayName = name.trim() || "Imported theme";

  const tmp = await mkdtemp(path.join(tmpdir(), "gutterpress-theme-"));
  try {
    await writeFile(path.join(tmp, "theme.css"), css, "utf8");
    await writeFile(
      path.join(tmp, "theme.json"),
      JSON.stringify({ name: displayName }, null, 2),
      "utf8",
    );
    const result = await finalizeThemeImport(projectDir, tmp, ["theme.css", "theme.json"]);
    // The source was a single stylesheet with no packaged metadata — surface
    // that even though we synthesized a theme.json for the name.
    result.warnings.unshift({
      code: "no-theme-json",
      message: "A single CSS file was imported — its name came from the file name.",
    });
    return result;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/**
 * Import a theme from a local file path, dispatched by extension: `.zip` →
 * {@link importThemeFromZip}, `.css` → {@link importThemeFromCssText}. The
 * desktop's host reads the path from a native file picker and calls this.
 */
export async function importThemeFromFile(
  projectDir: string,
  filePath: string,
): Promise<ThemeImportResult> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".zip") {
    const buf = await readFile(filePath);
    return importThemeFromZip(
      projectDir,
      new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
    );
  }
  if (ext === ".css") {
    const css = await readFile(filePath, "utf8");
    return importThemeFromCssText(projectDir, css, prettify(path.basename(filePath, ".css")));
  }
  throw new Error("Choose a .zip theme package or a .css stylesheet.");
}
