/**
 * Extension package import (#106, #265) — bring a look into a project from a
 * `.zip` package, a bare `.css` file, or an http(s) URL. NO new format: a
 * `.zip` is unzipped to its root (the folder holding `theme.css`), a bare
 * `.css` is wrapped into a one-file folder, a URL is fetched into one, and
 * every path then lands in `extensions/<id>/` and is added to the manifest's
 * `extensions:` list through the one rail (`extension-manager.ts`).
 *
 * Every declared sheet is validated first (exists — via the same
 * `resolveDeclaredStyles` a plugin's `styles` export resolves through — and
 * print-safe). The zip/css/URL surface still needs a `theme.css` to LOCATE
 * the package root; a folder the author already has needs no import at all —
 * `gutterpress ext add ./that-folder` references it in place.
 */
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { unzipSync } from "fflate";

import { checkCss, ruleSyntax, type PrintSafeWarning } from "./printsafe.ts";
import {
  addExtension,
  EXTENSIONS_DIR,
  uniqueExtensionId,
  type ProjectExtensionEntry,
} from "./extension-manager.ts";
import { FriendlyHttpError, withFetchTimeout } from "./fetch-timeout.ts";
import { prettify } from "./slug.ts";
// #239: the SAME declared-stylesheet resolver extension-manager.ts's addExtension/
// importThemeFromFolder and plugins.ts's resolvePluginStyles use.
import { resolveDeclaredStyles } from "./style-declarations.ts";
// #241: metadata may now be named gutterpress.json instead of theme.json —
// same superset shape, same tolerant-missing/invalid-JSON contract. The
// anchor a zip/css-text import locates its root BY stays theme.css (see this
// file's header) — only WHICH metadata file is read once that root is found
// generalizes here.
import {
  assertExtensionContained,
  extensionStyleListWithDefault,
  readExtensionMeta,
  EXTENSION_MANIFEST_FILENAME,
} from "./extension-manifest.ts";

/** Reject a raw archive larger than this before unzipping (zip-bomb surface). */
export const MAX_THEME_ARCHIVE_BYTES = 25 * 1024 * 1024;
/** Reject an archive whose entries expand past this in total (zip-bomb surface). */
const MAX_THEME_UNZIPPED_BYTES = 25 * 1024 * 1024;

/** A non-fatal issue surfaced to the author after a successful import. */
export interface ExtensionImportWarning {
  code: "print-safety" | "no-theme-json" | "unnamed-theme" | "extra-files";
  message: string;
}

/** Outcome of a `.zip` / `.css` / URL import: the added entry + any warnings. */
export interface ExtensionImportResult {
  entry: ProjectExtensionEntry;
  warnings: ExtensionImportWarning[];
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
 * author should still see (remote URLs, risky print effects) that import
 * anyway. The discriminator is the rule id, not severity: `no-remote-urls` is
 * `error`-severity but the #106 spec still imports it with a warning; only
 * `syntax-error` refuses.
 */
export function classifyThemeCssFindings(findings: PrintSafeWarning[]): {
  reject: PrintSafeWarning | null;
  warnings: PrintSafeWarning[];
} {
  const reject = findings.find((f) => f.rule === ruleSyntax) ?? null;
  const warnings = reject ? [] : findings.filter((f) => f.rule !== ruleSyntax);
  return { reject, warnings };
}

// #241: gutterpress.json joins theme.json as a recognized metadata filename —
// a package using the new format must not get a false "unexpected file"
// warning for its own metadata file.
const KNOWN_THEME_FILES = new Set(["theme.css", "theme.json", EXTENSION_MANIFEST_FILENAME]);
const ALLOWED_ASSET_EXTS = new Set([
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".avif",
  ".css",
]);

/**
 * From a theme folder's relative file paths, return the ones that are neither
 * `theme.css`/`theme.json`/`gutterpress.json`, a recognized bundled asset
 * (font/image/css), nor one the metadata itself declared (#241 —
 * `declaredExtras`: the extension's `markdown`/`components`/`snippets`
 * entries, when present, passed as relative paths; a `snippets` folder
 * suppresses everything under it, not just the exact entry). These trigger a
 * non-fatal "unexpected extra files" warning — the import still copies the
 * whole folder.
 */
export function unexpectedThemeFiles(relPaths: string[], declaredExtras: string[] = []): string[] {
  const extras = declaredExtras.map((p) => p.replace(/\\/g, "/"));
  const isDeclared = (p: string): boolean =>
    extras.some((extra) => p === extra || p.startsWith(`${extra}/`));
  return relPaths
    .map((p) => p.replace(/\\/g, "/"))
    .filter((p) => p.length > 0 && !p.endsWith("/"))
    .filter((p) => {
      if (isDeclared(p)) return false;
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

/**
 * Validate an already-extracted folder, then land it in `extensions/<id>/`
 * and add it to the manifest. REJECTS (throws) when `theme.css` is missing
 * or fails to parse, OR (#239) when the metadata declares an ADDITIONAL
 * sheet that is missing or fails to parse — a broken multi-sheet look is
 * rejected at import time, not at first render. Otherwise collects WARN
 * findings (print-safety, missing/unnamed metadata, unexpected extra files)
 * and returns them with the added entry.
 *
 * The anchor is `theme.css` specifically: every caller guarantees one exists
 * in `sourceDir` before this runs (`importExtensionFromZip`'s
 * `locateThemeRoot` requires it to find the zip's root at all; the `.css`
 * and URL wrappers write it themselves). A folder without one needs no
 * import — `gutterpress ext add ./folder` references it in place.
 */
async function finalizeExtensionImport(
  projectDir: string,
  sourceDir: string,
  relPaths: string[],
  fallbackName: string,
): Promise<ExtensionImportResult> {
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

  const warnings: ExtensionImportWarning[] = [];
  for (const w of printFindings) {
    warnings.push({ code: "print-safety", message: w.message });
  }

  // #241: gutterpress.json is checked first, theme.json second — same
  // fallback order every real on-disk theme read uses (readExtensionMeta).
  // The warning `code` stays "no-theme-json" (the desktop's dtos.ts carries
  // its own copy of this union, decoupled from the lib per CLAUDE.md §8) even
  // though the wording now covers either filename.
  const metaExists =
    existsSync(path.join(sourceDir, EXTENSION_MANIFEST_FILENAME)) ||
    existsSync(path.join(sourceDir, "theme.json"));
  const meta = metaExists ? await readExtensionMeta(sourceDir) : {};
  if (!metaExists) {
    warnings.push({
      code: "no-theme-json",
      message:
        "No gutterpress.json or theme.json found — the theme's name was taken from the file/folder name.",
    });
  } else if (!meta.name || !meta.name.trim()) {
    warnings.push({
      code: "unnamed-theme",
      message:
        'The metadata file has no "name" — the theme\'s name was taken from the file/folder name.',
    });
  }

  // #239: the metadata file may declare layered sheets (and engine-conditional
  // ones) beyond the anchor theme.css — validate every one exists and is
  // print-safe, exactly like theme.css itself. Existence resolution goes
  // through the SAME resolveDeclaredStyles a plugin's `styles` export
  // resolves through (plugins.ts) and extension-manager.ts's addExtension/
  // importThemeFromFolder now also use — one resolver, three call sites, not
  // a parallel re-implementation here. Print-safety linting stays layered on
  // top: it is an import-specific richness (WARN, don't just reject)
  // that plugin loading has no equivalent of.
  assertExtensionContained(meta);
  const metaFilename = existsSync(path.join(sourceDir, EXTENSION_MANIFEST_FILENAME))
    ? EXTENSION_MANIFEST_FILENAME
    : "theme.json";
  const extraSheets = [
    ...new Set(extensionStyleListWithDefault(meta, sourceDir)),
  ].filter((rel) => rel !== "theme.css");
  const extraSheetPaths = resolveDeclaredStyles(extraSheets, sourceDir, metaFilename) ?? [];
  for (let i = 0; i < extraSheets.length; i++) {
    const rel = extraSheets[i]!;
    const sheetPath = extraSheetPaths[i]!;
    const sheetCss = await readFile(sheetPath, "utf8");
    const { reject: sheetReject, warnings: sheetFindings } = classifyThemeCssFindings(
      checkCss(sheetCss, rel),
    );
    if (sheetReject) {
      throw new Error(`${rel} could not be parsed — ${sheetReject.message}`);
    }
    for (const w of sheetFindings) {
      warnings.push({ code: "print-safety", message: `${rel}: ${w.message}` });
    }
  }

  // #241: markdown/components/snippets are declared-but-unenforced here
  // (same "advisory, not existence-checked by this flow" treatment
  // tokensFile already had) — only suppressed from the "unexpected extra
  // files" warning below so a well-formed extension package doesn't get a
  // false positive for its own declared plugin/catalog/snippets. Whichever
  // flow actually consumes a field is what existence-checks it: `markdown`
  // via the build's loader (plugins.ts's `resolveExtension`
  // call), `snippets` by `snippets.ts`'s `listMergedSnippets` (#242, tolerant
  // rather than throwing — see that module), `components` by its own future
  // catalog-reader consumer (not yet built).
  const declaredExtras = [meta.markdown, meta.components, meta.snippets].filter(
    (p): p is string => typeof p === "string" && p.trim().length > 0,
  );
  const extra = unexpectedThemeFiles(relPaths, declaredExtras);
  if (extra.length > 0) {
    const shown = extra.slice(0, 6).join(", ");
    warnings.push({
      code: "extra-files",
      message: `The theme bundles files that aren't a stylesheet or common asset: ${shown}${extra.length > 6 ? ", …" : ""}`,
    });
  }

  const id = await uniqueExtensionId(projectDir, meta.name?.trim() || fallbackName);
  const dest = path.join(projectDir, EXTENSIONS_DIR, id);
  await mkdir(path.dirname(dest), { recursive: true });
  await cp(sourceDir, dest, { recursive: true });
  const entry = await addExtension(projectDir, `./${EXTENSIONS_DIR}/${id}`);
  return { entry, warnings };
}

/**
 * Import a theme from a `.zip` package. Unzips in memory (fflate), rejects
 * unsafe paths and over-cap archives, locates the theme root (at the archive
 * root or one folder down), extracts just that subtree to a temp folder, and
 * finalizes via {@link finalizeExtensionImport}. Lands the theme in
 * `themes/<uniqueId>/` (never overwrites an existing theme).
 */
export async function importExtensionFromZip(
  projectDir: string,
  archive: Uint8Array,
): Promise<ExtensionImportResult> {
  if (archive.length > MAX_THEME_ARCHIVE_BYTES) {
    throw new Error(`Extension package is too large (max ${mb(MAX_THEME_ARCHIVE_BYTES)}).`);
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
      `Extension package expands to more than ${mb(MAX_THEME_UNZIPPED_BYTES)} and was rejected.`,
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
    return await finalizeExtensionImport(projectDir, tmp, relPaths, root || "imported-look");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/**
 * Import a theme from a bare `.css` file by wrapping it into a one-file theme
 * folder (`theme.css` + a synthesized `theme.json` naming it). REJECTS a CSS
 * that fails to parse.
 */
export async function importExtensionFromCssText(
  projectDir: string,
  css: string,
  name: string,
): Promise<ExtensionImportResult> {
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
    const result = await finalizeExtensionImport(projectDir, tmp, ["theme.css", "theme.json"], displayName);
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
 * {@link importExtensionFromZip}, `.css` → {@link importExtensionFromCssText}. The
 * desktop's host reads the path from a native file picker and calls this.
 */
export async function importExtensionFromFile(
  projectDir: string,
  filePath: string,
): Promise<ExtensionImportResult> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".zip") {
    const buf = await readFile(filePath);
    return importExtensionFromZip(
      projectDir,
      new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
    );
  }
  if (ext === ".css") {
    const css = await readFile(filePath, "utf8");
    return importExtensionFromCssText(projectDir, css, prettify(path.basename(filePath, ".css")));
  }
  throw new Error("Choose a .zip extension package or a .css stylesheet.");
}

// ── URL import ───────────────────────────────────────────────────────────────

/** Treat a URL as raw CSS when it ends in .css; otherwise as a look folder. */
function looksLikeCssUrl(url: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".css");
  } catch {
    return url.toLowerCase().endsWith(".css");
  }
}

/** Total deadline per fetch (covers the body read; a look is one small CSS/JSON file). */
const FETCH_TIMEOUT_MS = 30_000;

async function fetchText(url: string): Promise<string> {
  // Only http(s). Bun's global fetch will happily read file:// (and other
  // schemes), which would turn this into an arbitrary local-file read.
  let scheme: string;
  try {
    scheme = new URL(url).protocol;
  } catch {
    throw new Error(`Invalid URL "${url}".`);
  }
  if (scheme !== "http:" && scheme !== "https:") {
    throw new Error(`The URL must be http(s) — got "${scheme}".`);
  }
  return withFetchTimeout(
    {
      timeoutMs: FETCH_TIMEOUT_MS,
      timeoutMessage: `Fetching ${url} timed out. Check your connection and try again.`,
      offlineMessage: `Couldn't reach ${url}. Check your connection and try again.`,
    },
    async (signal) => {
      const res = await fetch(url, { signal });
      if (!res.ok) {
        throw new FriendlyHttpError(`Failed to fetch ${url} (HTTP ${res.status}).`);
      }
      return res.text();
    },
  );
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
 * Import a look from a URL using the global `fetch` (bundle-safe — no node
 * http client). Two shapes: a `.css` URL is the look's `theme.css`, with
 * metadata synthesised from the URL; a base URL (no `.css`) fetches
 * `<base>/theme.json` (optional) and `<base>/theme.css` (required). Bundled
 * fonts are not followed — authors wanting bundled assets use a folder or a
 * `.zip`. The fetched files go through the same validation as a `.zip`.
 */
export async function importExtensionFromUrl(
  projectDir: string,
  url: string,
): Promise<ExtensionImportResult> {
  const trimmed = url.trim();
  if (!trimmed) throw new Error("A URL is required.");

  let css: string;
  let meta: Record<string, unknown> = {};
  let baseName: string;
  if (looksLikeCssUrl(trimmed)) {
    css = await fetchText(trimmed);
    baseName = path.basename(new URL(trimmed, "https://x/").pathname, ".css") || "look";
  } else {
    const base = trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
    css = await fetchText(`${base}theme.css`);
    try {
      const parsed = JSON.parse(await fetchText(`${base}theme.json`)) as unknown;
      if (parsed && typeof parsed === "object") meta = parsed as Record<string, unknown>;
    } catch {
      // theme.json is optional for folder URLs.
    }
    baseName =
      (typeof meta.name === "string" && meta.name) ||
      path.basename(new URL(base, "https://x/").pathname.replace(/\/$/, "")) ||
      "look";
  }
  if (!css.trim()) throw new Error(`Fetched CSS from ${trimmed} was empty.`);
  assertLooksLikeCss(css, trimmed);

  const tmp = await mkdtemp(path.join(tmpdir(), "gutterpress-ext-"));
  try {
    await writeFile(path.join(tmp, "theme.css"), css, "utf8");
    const finalMeta = {
      name: (typeof meta.name === "string" && meta.name) || prettify(baseName),
      ...(typeof meta.author === "string" ? { author: meta.author } : {}),
      ...(typeof meta.description === "string" ? { description: meta.description } : {}),
      preview: typeof meta.preview === "string" ? meta.preview : null,
    };
    await writeFile(path.join(tmp, "theme.json"), JSON.stringify(finalMeta, null, 2), "utf8");
    return await finalizeExtensionImport(projectDir, tmp, ["theme.css", "theme.json"], baseName);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
