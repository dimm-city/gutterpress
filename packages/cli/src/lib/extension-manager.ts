/**
 * Extension manager (#265) — read / write / toggle / reorder the project
 * manifest's `extensions:` list, add an extension (a bundled name, a path,
 * an npm specifier, or a copy of a built-in look), and validate every
 * configured extension by attempting to LOAD it through the one loader
 * (CLAUDE.md §5: plain markdown-it plugins and a fail-fast loader).
 *
 * ONE rail. A theme is an extension that carries only styles; a plain
 * markdown-it plugin is an extension that carries only markdown; a component
 * library carries both plus snippets and a catalog. Each is one entry in
 * `extensions:`, added one way:
 *
 *   - a BUNDLED name (the five markdown features compiled into Gutterpress,
 *     `extension-specifier.ts`) is written as-is — nothing to install, works
 *     offline;
 *   - a PATH (`./x`, `../x`) is referenced IN PLACE. The author put that
 *     folder there; Gutterpress reads it. Nothing is copied;
 *   - an NPM specifier is downloaded, verified, vendored with a receipt under
 *     `plugins/npm/` (`npm-plugin-installer.ts`) and written back pinned, as
 *     `name@version`.
 *
 * The three built-in looks are the one thing this module copies INTO a
 * project (`extensions/<id>/`, then referenced by path): a book's look must
 * be the author's own editable files, never a hidden dependency on the CSS
 * embedded in whichever Gutterpress version happens to be installed.
 *
 * Cascade order and markdown registration order are BOTH the list order —
 * a later entry loads later and its CSS wins ties — and the project's own
 * `styles:` always come after every extension (`assemble.ts`, #227).
 *
 * Manifest editing uses the `yaml` Document API so comments and formatting
 * round-trip (the same dep `manifest.ts` parses with). Host-side (node:fs);
 * the desktop reaches it through thin SvelteKit server routes.
 */
import { cp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { isSeq, isMap, isScalar, YAMLMap, YAMLSeq, Scalar } from "yaml";
import type { Node } from "yaml";

import { clearVendoredPluginResolver, loadPlugin } from "./markdown/plugins.ts";
import { loadManifestDoc, ensureSeq, writeManifestDoc } from "./manifest-doc.ts";
import {
  finalizeNpmPluginInstall,
  installNpmPlugin,
  rollbackNpmPluginInstall,
  type NpmPluginInstallOptions,
} from "./npm-plugin-installer.ts";
import {
  resolveVendoredPluginInstallRoot,
  vendoredNpmPluginPackageDir,
  vendoredNpmPluginRoot,
} from "./plugin-vendor.ts";
import {
  isPathSpecifier,
  parseExtensionSpecifier,
  pinnedNpmSpecifier,
  type ParsedExtensionSpecifier,
} from "./extension-specifier.ts";
import {
  EXTENSION_MANIFEST_FILENAME,
  LEGACY_THEME_MANIFEST_FILENAME,
  extensionCarries,
  extensionStyleListWithDefault,
  readExtensionMeta,
  resolveExtension,
  type ExtensionCarries,
} from "./extension-manifest.ts";
import { getAssetsDir } from "./embedded-assets.ts";
import { slugify, prettify } from "./slug.ts";
import type { ResolvedExtensionConfig } from "../schema/manifest.types.ts";

/** Folder (relative to the project root) extensions this module COPIES land in
 *  (built-in looks, zip/URL imports). Path entries elsewhere are never moved. */
export const EXTENSIONS_DIR = "extensions";

/** The vendored npm tree stays where 0.10.8 put it. */
export { PLUGINS_DIR } from "./plugin-vendor.ts";

/** How an `extensions:` entry resolves — the form of its specifier decides. */
export type ExtensionSourceKind = "bundled" | "path" | "npm";

/** One configured extension, as surfaced to the CLI and the desktop. */
export interface ProjectExtensionEntry {
  /** The specifier exactly as written in the manifest — the stable ref every
   *  other call takes (`setExtensionEnabled`, `removeExtension`, …). */
  use: string;
  kind: ExtensionSourceKind;
  /** Package name (bundled, npm) or the path specifier (path). */
  name: string;
  /** Exact pinned version, from the specifier, for an npm entry. */
  version?: string;
  /** Named module export selected as the plugin function. */
  export?: string;
  /** Per-project enable flag. Absent in the manifest defaults to `true`. */
  enabled: boolean;
  /** Display name: the metadata's `name`, else the package name / folder name. */
  label: string;
  description?: string;
  author?: string;
  /** Preview image path relative to the extension folder, when declared. */
  preview?: string | null;
  /** The sheet carrying the `:root` token surface, relative to the folder,
   *  when declared (`gutterpress.json`'s `tokensFile`). */
  tokensFile?: string;
  /** Declared stylesheets relative to the folder, in cascade order (`theme.css`
   *  by default for a metadata-less look). Absent when there is no folder. */
  styles?: string[];
  /** What the extension declares — the desktop shows styles-carrying entries
   *  in its Look view and markdown-carrying ones in Features; one list. */
  carries: ExtensionCarries;
  /** Absolute folder its metadata was read from. Absent for a bundled name,
   *  a bare JS file, an uninstalled npm entry, or a missing path. */
  dir?: string;
  /** Non-fatal notices: not installed, not found, unparseable specifier, … */
  warnings?: string[];
}

/** Result of attempting to load one configured extension. */
export interface ExtensionValidationResult {
  use: string;
  kind: ExtensionSourceKind;
  /** Mirrors the manifest enable flag. Disabled extensions are not load-tested. */
  enabled: boolean;
  /** `true` when the extension loaded OK (or is disabled and skipped). */
  ok: boolean;
  /** The loader's fail-fast error message when `ok` is `false`. */
  error?: string;
}

/** A curated, bundled markdown feature an author can turn on. */
export interface RecommendedExtension {
  /** The bundled name — also the manifest entry "Add" writes. */
  use: string;
  /** Short, plain-language feature name shown as the row title. */
  label: string;
  /** One-line author-friendly description. */
  description: string;
}

/**
 * The bundled markdown features (`BUNDLED_EXTENSIONS`): adding one writes the
 * manifest entry AND the feature works immediately — no terminal, no install,
 * offline. The always-on defaults (attrs/footnote/deflist, applied
 * unconditionally in renderer.ts) are deliberately NOT listed: recommending
 * the author "add" something already active is pure confusion.
 */
export const RECOMMENDED_EXTENSIONS: RecommendedExtension[] = [
  {
    use: "markdown-it-mark",
    label: "Highlight",
    description: "Highlighted text with `==marked==` -> `<mark>`.",
  },
  {
    use: "markdown-it-sub",
    label: "Subscript",
    description: "Subscript text with `H~2~O`.",
  },
  {
    use: "markdown-it-sup",
    label: "Superscript",
    description: "Superscript text with `29^th^`.",
  },
  {
    use: "markdown-it-abbr",
    label: "Abbreviations",
    description: "Define `*[HTML]: Hyper Text...` and get `<abbr>` tooltips.",
  },
  {
    // Not a real npm package — Gutterpress's own code (#237), named to fit
    // the "keyed by npm name" shape. See BUILTIN_OPTIONAL_PLUGINS (renderer.ts).
    use: "gutterpress-gfm-alerts",
    label: "Callouts",
    description: "GitHub-style `> [!NOTE]` alert boxes (Note/Tip/Important/Warning/Caution).",
  },
];

/** The built-in looks shipped as embedded assets (ids are folder names). */
export const BUILT_IN_STYLE_SET_IDS = ["clean-book", "zine", "technical-doc"] as const;
export type BuiltInStyleSetId = (typeof BUILT_IN_STYLE_SET_IDS)[number];

/** A built-in look, as listed for the desktop's Look view. */
export interface BuiltInStyleSet {
  id: BuiltInStyleSetId;
  name: string;
  description: string;
}

// ── Serialization ────────────────────────────────────────────────────────────

const mutationQueues = new Map<string, Promise<void>>();

/** Serialize all extension filesystem + manifest mutations for one project. */
function withMutationLock<T>(projectDir: string, mutation: () => Promise<T>): Promise<T> {
  const resolved = path.resolve(projectDir);
  const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  const previous = mutationQueues.get(key) ?? Promise.resolve();
  const run = previous.then(mutation, mutation);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  mutationQueues.set(key, tail);
  void tail.then(() => {
    if (mutationQueues.get(key) === tail) mutationQueues.delete(key);
  });
  return run;
}

// ── Manifest entries ─────────────────────────────────────────────────────────

/** The specifier of one `extensions:` item — the scalar, or a map's `use`. */
function entryUse(item: unknown): string | null {
  if (isScalar(item)) return typeof item.value === "string" ? item.value.trim() : null;
  if (isMap(item)) {
    const u = item.get("use");
    return typeof u === "string" ? u.trim() : null;
  }
  return null;
}

interface RawEntry {
  use: string;
  export?: string;
  enabled: boolean;
}

function rawEntry(item: unknown): RawEntry | null {
  const use = entryUse(item);
  if (!use) return null;
  if (!isMap(item)) return { use, enabled: true };
  const x = item.get("export");
  return {
    use,
    ...(typeof x === "string" && x.trim() ? { export: x.trim() } : {}),
    enabled: item.get("enabled") !== false,
  };
}

/**
 * Two specifiers name the same extension when they are equal, or when both
 * are npm specifiers for the same package (a re-install re-pins the version
 * in place instead of adding a second entry).
 */
export function sameExtension(a: string, b: string): boolean {
  if (a.trim() === b.trim()) return true;
  let pa: ParsedExtensionSpecifier;
  let pb: ParsedExtensionSpecifier;
  try {
    pa = parseExtensionSpecifier(a);
    pb = parseExtensionSpecifier(b);
  } catch {
    return false;
  }
  return pa.kind === "npm" && pb.kind === "npm" && pa.name === pb.name;
}

function indexOfUse(seq: YAMLSeq, use: string): number {
  const items = seq.items as Node[];
  const exact = items.findIndex((item) => entryUse(item) === use.trim());
  if (exact >= 0) return exact;
  return items.findIndex((item) => {
    const u = entryUse(item);
    return !!u && sameExtension(u, use);
  });
}

/** A manifest-form path for `abs`: relative to the project, `/`-separated, `./`-prefixed. */
function manifestPathFor(projectDir: string, abs: string): string {
  const rel = path.relative(path.resolve(projectDir), abs).split(path.sep).join("/");
  if (rel === "") {
    throw new Error("An extension cannot be the project folder itself.");
  }
  if (isPathSpecifier(rel)) return rel; // `../x`, or an absolute path on another drive
  return `./${rel}`;
}

// ── Describe ─────────────────────────────────────────────────────────────────

const NO_CARRIES: ExtensionCarries = {
  markdown: false,
  styles: false,
  snippets: false,
  components: false,
};

function hasMetadataFile(dir: string): boolean {
  return (
    existsSync(path.join(dir, EXTENSION_MANIFEST_FILENAME)) ||
    existsSync(path.join(dir, LEGACY_THEME_MANIFEST_FILENAME))
  );
}

async function describeFolder(
  dir: string,
  base: Omit<ProjectExtensionEntry, "label" | "carries">,
  fallbackLabel: string,
): Promise<ProjectExtensionEntry> {
  const meta = await readExtensionMeta(dir);
  const styles = extensionStyleListWithDefault(meta, dir);
  return {
    ...base,
    label: meta.name?.trim() || fallbackLabel,
    ...(meta.description?.trim() ? { description: meta.description.trim() } : {}),
    ...(meta.author?.trim() ? { author: meta.author.trim() } : {}),
    ...(meta.preview !== undefined ? { preview: meta.preview } : {}),
    ...(meta.tokensFile?.trim() ? { tokensFile: meta.tokensFile.trim() } : {}),
    ...(styles.length > 0 ? { styles } : {}),
    carries: extensionCarries(meta, dir),
    dir,
  };
}

async function describeEntry(projectDir: string, raw: RawEntry): Promise<ProjectExtensionEntry> {
  const warnings: string[] = [];
  let parsed: ParsedExtensionSpecifier | null = null;
  try {
    parsed = parseExtensionSpecifier(raw.use);
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : String(error));
  }
  const common = {
    use: raw.use,
    enabled: raw.enabled,
    ...(raw.export ? { export: raw.export } : {}),
  };
  const withWarnings = (entry: ProjectExtensionEntry): ProjectExtensionEntry =>
    warnings.length > 0 ? { ...entry, warnings: [...(entry.warnings ?? []), ...warnings] } : entry;

  if (!parsed) {
    return withWarnings({ ...common, kind: "npm", name: raw.use, label: raw.use, carries: NO_CARRIES });
  }

  if (parsed.kind === "bundled") {
    const bundledName = parsed.name;
    const rec = RECOMMENDED_EXTENSIONS.find((r) => r.use === bundledName);
    return withWarnings({
      ...common,
      kind: "bundled",
      name: bundledName,
      label: rec?.label ?? bundledName,
      ...(rec ? { description: rec.description } : {}),
      carries: { ...NO_CARRIES, markdown: true },
    });
  }

  if (parsed.kind === "path") {
    const abs = path.resolve(projectDir, parsed.path);
    const base = { ...common, kind: "path" as const, name: parsed.path };
    let info;
    try {
      info = await stat(abs);
    } catch {
      warnings.push(`Not found: ${abs}`);
      return withWarnings({ ...base, label: path.basename(abs), carries: NO_CARRIES });
    }
    if (info.isDirectory()) {
      return withWarnings(await describeFolder(abs, base, prettify(path.basename(abs))));
    }
    // A bare JS module: a plain markdown-it plugin, no metadata to read.
    return withWarnings({
      ...base,
      label: path.basename(abs),
      carries: { ...NO_CARRIES, markdown: true },
    });
  }

  // npm
  const base = {
    ...common,
    kind: "npm" as const,
    name: parsed.name,
    ...(parsed.version ? { version: parsed.version } : {}),
  };
  if (!parsed.version) {
    warnings.push(
      `Not pinned — run \`gutterpress ext add ${parsed.name}\` to install it and pin an exact version.`,
    );
    return withWarnings({ ...base, label: parsed.name, carries: { ...NO_CARRIES, markdown: true } });
  }
  let installRoot: string | null = null;
  try {
    installRoot = await resolveVendoredPluginInstallRoot(projectDir, parsed.name, parsed.version);
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : String(error));
  }
  if (!installRoot) {
    warnings.push(`Not installed — run \`gutterpress ext add ${raw.use}\`.`);
    return withWarnings({ ...base, label: parsed.name, carries: { ...NO_CARRIES, markdown: true } });
  }
  const pkgDir = vendoredNpmPluginPackageDir(installRoot, parsed.name);
  if (!hasMetadataFile(pkgDir)) {
    // A package with no gutterpress.json is a plain markdown-it plugin.
    return withWarnings({ ...base, label: parsed.name, carries: { ...NO_CARRIES, markdown: true } });
  }
  return withWarnings(await describeFolder(pkgDir, base, parsed.name));
}

/**
 * List the project's configured extensions, in manifest (= cascade) order,
 * each described from its metadata. Returns `[]` when there is no manifest
 * or no `extensions:` list. Tolerant: a missing folder, an uninstalled npm
 * entry, or an unparseable specifier is reported in `warnings`, never thrown
 * — one bad entry must not blank the list for every other one.
 */
export async function listProjectExtensions(projectDir: string): Promise<ProjectExtensionEntry[]> {
  const { doc } = await loadManifestDoc(projectDir);
  const seq = doc.get("extensions", true);
  if (!isSeq(seq)) return [];
  const out: ProjectExtensionEntry[] = [];
  for (const item of seq.items as Node[]) {
    const raw = rawEntry(item);
    if (!raw) continue;
    out.push(await describeEntry(projectDir, raw));
  }
  return out;
}

/** One configured extension by specifier, or `null`. */
export async function describeExtension(
  projectDir: string,
  use: string,
): Promise<ProjectExtensionEntry | null> {
  return (await listProjectExtensions(projectDir)).find((e) => sameExtension(e.use, use)) ?? null;
}

/** The loader config for a listed entry — what `validate` and `add` load-test. */
export function extensionConfigFor(entry: {
  use: string;
  kind: ExtensionSourceKind;
  name: string;
  version?: string;
  export?: string;
}): ResolvedExtensionConfig {
  return {
    use: entry.use,
    ...(entry.kind === "path"
      ? { path: entry.name }
      : { name: entry.name, ...(entry.version ? { version: entry.version } : {}) }),
    ...(entry.export ? { export: entry.export } : {}),
    options: {},
  };
}

// ── Toggle / reorder / remove ────────────────────────────────────────────────

/**
 * Set the per-project enabled flag for the extension `use` names. A bare
 * string entry becomes the object form to carry `enabled: false`; re-enabling
 * drops the flag and collapses an object with nothing else left back to the
 * bare string. Persists to the manifest (preserving comments). Throws when no
 * entry matches.
 */
export async function setExtensionEnabled(
  projectDir: string,
  use: string,
  enabled: boolean,
): Promise<void> {
  return withMutationLock(projectDir, async () => {
    const { doc, file } = await loadManifestDoc(projectDir);
    const seq = doc.get("extensions", true);
    const idx = isSeq(seq) ? indexOfUse(seq, use) : -1;
    if (!isSeq(seq) || idx < 0) throw new Error(`Extension "${use}" is not in the manifest.`);
    const item = seq.items[idx] as Node;

    if (enabled) {
      if (isMap(item)) {
        item.delete("enabled");
        if (item.items.length === 1 && typeof item.get("use") === "string") {
          seq.items[idx] = new Scalar(item.get("use") as string);
        }
      }
    } else if (isMap(item)) {
      item.set("enabled", false);
    } else {
      const map = new YAMLMap(doc.schema);
      map.set("use", entryUse(item));
      map.set("enabled", false);
      seq.items[idx] = map;
    }
    await writeManifestDoc(file, doc);
  });
}

/**
 * Rewrite the list in the given order — the author's cascade. `order` must
 * name every current entry exactly once (by its `use`); anything else is a
 * stale view and is refused rather than guessed at.
 */
export async function reorderExtensions(projectDir: string, order: string[]): Promise<void> {
  return withMutationLock(projectDir, async () => {
    const { doc, file } = await loadManifestDoc(projectDir);
    const seq = doc.get("extensions", true);
    if (!isSeq(seq)) throw new Error(`No extensions are configured in ${path.basename(file)}.`);
    const items = seq.items as Node[];
    const current = items.map((item) => entryUse(item));
    const wanted = order.map((u) => u.trim());
    const sameSet =
      current.length === wanted.length &&
      [...current].sort().join("\n") === [...wanted].sort().join("\n");
    if (!sameSet) {
      throw new Error(
        "The new order must list every configured extension exactly once — reload the list and try again.",
      );
    }
    const remaining = [...items];
    seq.items = wanted.map((u) => {
      const i = remaining.findIndex((item) => entryUse(item) === u);
      return remaining.splice(i, 1)[0]!;
    });
    await writeManifestDoc(file, doc);
  });
}

/**
 * Remove an extension's manifest entry. An npm entry's vendored tree is
 * deleted too (it is Gutterpress's own private copy); a path entry's folder
 * is the author's and is never touched. Throws when no entry matches.
 */
export async function removeExtension(projectDir: string, use: string): Promise<void> {
  return withMutationLock(projectDir, async () => {
    const { doc, file } = await loadManifestDoc(projectDir);
    const seq = doc.get("extensions", true);
    const idx = isSeq(seq) ? indexOfUse(seq, use) : -1;
    if (!isSeq(seq) || idx < 0) throw new Error(`Extension "${use}" is not in the manifest.`);
    const written = entryUse(seq.items[idx])!;
    seq.items.splice(idx, 1);
    if (seq.items.length === 0) doc.delete("extensions");
    await writeManifestDoc(file, doc);

    let parsed: ParsedExtensionSpecifier | null = null;
    try {
      parsed = parseExtensionSpecifier(written);
    } catch {
      return;
    }
    if (parsed.kind === "npm" && parsed.version) {
      await rm(vendoredNpmPluginRoot(projectDir, parsed.name, parsed.version), {
        recursive: true,
        force: true,
      });
      clearVendoredPluginResolver(projectDir, parsed.name, parsed.version);
    }
  });
}

// ── Add ──────────────────────────────────────────────────────────────────────

export interface AddExtensionOptions extends NpmPluginInstallOptions {
  /** Named module export to use as the plugin function (npm and path only). */
  exportName?: string;
  /** @internal fault injection for the installer tests. */
  __testFailBeforeManifestCommit?: () => void | Promise<void>;
}

/** Write `{use, export?}` (a bare string when there is nothing else), replacing a matching entry in place. */
async function upsertEntry(projectDir: string, use: string, exportName?: string): Promise<void> {
  const { doc, file } = await loadManifestDoc(projectDir);
  const seq = ensureSeq(doc, "extensions");
  const idx = indexOfUse(seq, use);
  if (idx >= 0) {
    // Re-adding re-pins in place (npm) and keeps options/enabled as written.
    const item = seq.items[idx] as Node;
    if (isMap(item)) {
      item.set("use", use);
      if (exportName) item.set("export", exportName);
      else item.delete("export");
      if (item.items.length === 1) seq.items[idx] = new Scalar(use);
    } else if (exportName) {
      const map = new YAMLMap(doc.schema);
      map.set("use", use);
      map.set("export", exportName);
      seq.items[idx] = map;
    } else {
      seq.items[idx] = new Scalar(use);
    }
  } else if (exportName) {
    const map = new YAMLMap(doc.schema);
    map.set("use", use);
    map.set("export", exportName);
    seq.add(map);
  } else {
    seq.add(new Scalar(use));
  }
  await writeManifestDoc(file, doc);
}

/** The path branch of {@link addExtension}: load-test, then reference in place. */
async function addPathExtension(
  projectDir: string,
  abs: string,
  exportName: string | undefined,
): Promise<ProjectExtensionEntry> {
  try {
    await stat(abs);
  } catch {
    throw new Error(`Extension not found: ${abs}`);
  }
  const use = manifestPathFor(projectDir, abs);
  await loadPlugin(extensionConfigFor({ use, kind: "path", name: use, export: exportName }), projectDir);
  await upsertEntry(projectDir, use, exportName);
  return (await describeExtension(projectDir, use))!;
}

/**
 * Add an extension to the project, one way whatever it is:
 *
 *   - a bundled name is written as-is;
 *   - a path (`./x`, `../x`, or absolute) is load-tested and written relative
 *     to the project, referenced in place;
 *   - an npm specifier (`name`, `name@version`) is downloaded, verified,
 *     vendored with a receipt, load-tested, and written back as
 *     `name@<exact version>`. On any failure the vendor tree is rolled back.
 *
 * Idempotent: adding what is already listed re-pins/updates that entry.
 * Returns the described entry.
 */
export async function addExtension(
  projectDir: string,
  specifier: string,
  options: AddExtensionOptions = {},
): Promise<ProjectExtensionEntry> {
  return withMutationLock(projectDir, () => addExtensionUnlocked(projectDir, specifier, options));
}

async function addExtensionUnlocked(
  projectDir: string,
  specifier: string,
  options: AddExtensionOptions,
): Promise<ProjectExtensionEntry> {
  const input = specifier.trim();
  const exportName = options.exportName?.trim() || undefined;

  // An absolute path (a picker's result, or what the CLI resolved from the
  // shell) is a path even though it is not `./`-spelled.
  if (path.isAbsolute(input)) return addPathExtension(projectDir, input, exportName);

  const parsed = parseExtensionSpecifier(input);
  if (parsed.kind === "path") {
    return addPathExtension(projectDir, path.resolve(projectDir, parsed.path), exportName);
  }
  if (parsed.kind === "bundled") {
    if (exportName) throw new Error(`Bundled extension "${parsed.name}" does not take a named export.`);
    await upsertEntry(projectDir, parsed.name);
    return (await describeExtension(projectDir, parsed.name))!;
  }

  const existing = await describeExtension(projectDir, parsed.name);
  const chosenExport = exportName ?? existing?.export;
  const installed = await installNpmPlugin(projectDir, input, options);
  const use = pinnedNpmSpecifier(installed.name, installed.version);
  try {
    await loadPlugin(
      extensionConfigFor({
        use,
        kind: "npm",
        name: installed.name,
        version: installed.version,
        export: chosenExport,
      }),
      projectDir,
    );
    await options.__testFailBeforeManifestCommit?.();
    await upsertEntry(projectDir, use, chosenExport);
  } catch (cause) {
    try {
      await rollbackNpmPluginInstall(installed);
      clearVendoredPluginResolver(projectDir, installed.name, installed.version);
    } catch (rollbackError) {
      throw new Error(
        `Extension install failed and its previous vendor tree could not be restored: ` +
          `${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
        { cause },
      );
    }
    throw new Error(
      `Downloaded ${use}, but it is not a loadable markdown-it plugin: ` +
        `${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
  const warnings = [...installed.warnings];
  await finalizeNpmPluginInstall(installed).catch((error) => {
    warnings.push(
      `The extension was installed, but an old backup could not be removed: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  });
  const entry = (await describeExtension(projectDir, use))!;
  return warnings.length > 0 ? { ...entry, warnings: [...(entry.warnings ?? []), ...warnings] } : entry;
}

// ── Built-in looks ───────────────────────────────────────────────────────────

/** List the built-in looks (metadata read from the embedded assets). */
export async function listBuiltInStyleSets(): Promise<BuiltInStyleSet[]> {
  const assets = await getAssetsDir();
  const out: BuiltInStyleSet[] = [];
  for (const id of BUILT_IN_STYLE_SET_IDS) {
    const meta = await readExtensionMeta(path.join(assets, "themes", id));
    out.push({
      id,
      name: meta.name?.trim() || prettify(id),
      description: meta.description?.trim() || "",
    });
  }
  return out;
}

/** A folder name under `extensions/` not yet taken: `<slug>`, `<slug>-2`, … */
export async function uniqueExtensionId(projectDir: string, base: string): Promise<string> {
  const slug = slugify(base) || "extension";
  let candidate = slug;
  for (let n = 2; existsSync(path.join(projectDir, EXTENSIONS_DIR, candidate)); n++) {
    candidate = `${slug}-${n}`;
  }
  return candidate;
}

/**
 * Copy a built-in look into `extensions/<id>/` and add it to the manifest as
 * `./extensions/<id>`. The copy is deliberate (see the module doc): the look
 * becomes the author's own editable files. Idempotent — a folder already
 * there is kept as it is and only (re-)referenced.
 */
export async function addBuiltInStyleSet(
  projectDir: string,
  id: string,
): Promise<ProjectExtensionEntry> {
  if (!(BUILT_IN_STYLE_SET_IDS as readonly string[]).includes(id)) {
    throw new Error(`Unknown built-in look "${id}" (one of: ${BUILT_IN_STYLE_SET_IDS.join(", ")}).`);
  }
  return withMutationLock(projectDir, async () => {
    const dest = path.join(projectDir, EXTENSIONS_DIR, id);
    if (!existsSync(dest)) {
      const src = path.join(await getAssetsDir(), "themes", id);
      await mkdir(path.dirname(dest), { recursive: true });
      await cp(src, dest, { recursive: true });
    }
    return addExtensionUnlocked(projectDir, `./${EXTENSIONS_DIR}/${id}`, {});
  });
}

// ── Validate / read ──────────────────────────────────────────────────────────

/**
 * Validate every configured extension by attempting to LOAD it through the
 * one loader. Disabled entries are reported as disabled and NOT load-tested.
 * Loader errors are caught and surfaced per entry (never thrown through) so
 * the desktop can flag an erroring extension with its fix instructions.
 */
export async function validateProjectExtensions(
  projectDir: string,
): Promise<ExtensionValidationResult[]> {
  const out: ExtensionValidationResult[] = [];
  for (const entry of await listProjectExtensions(projectDir)) {
    if (!entry.enabled) {
      out.push({ use: entry.use, kind: entry.kind, enabled: false, ok: true });
      continue;
    }
    try {
      await loadPlugin(extensionConfigFor(entry), projectDir);
      out.push({ use: entry.use, kind: entry.kind, enabled: true, ok: true });
    } catch (e) {
      out.push({
        use: entry.use,
        kind: entry.kind,
        enabled: true,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return out;
}

/**
 * Read an extension's stylesheets, concatenated in cascade order, for a
 * preview thumbnail (the renderer never touches fs). Read-only, so
 * concatenation is fine even though it would not be for an editable surface.
 */
export async function readExtensionCss(projectDir: string, use: string): Promise<string> {
  const entry = await describeExtension(projectDir, use);
  if (!entry) throw new Error(`Extension "${use}" is not in the manifest.`);
  if (!entry.dir) throw new Error(`Extension "${use}" has no stylesheets to preview.`);
  const meta = await readExtensionMeta(entry.dir);
  const sheets = resolveExtension(entry.dir, meta, `Extension "${use}"`).styles ?? [];
  if (sheets.length === 0) throw new Error(`Extension "${use}" declares no stylesheets.`);
  const parts: string[] = [];
  for (const sheet of sheets) parts.push(await readFile(sheet, "utf8"));
  return parts.join("\n\n");
}
