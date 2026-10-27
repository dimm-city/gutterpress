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
 *   - a BUNDLED name (a markdown feature or a look compiled into Gutterpress,
 *     `extension-specifier.ts`) is written as-is — nothing to install, works
 *     offline;
 *   - a PATH (`./x`, `../x`) is referenced IN PLACE. The author put that
 *     folder there; Gutterpress reads it. Nothing is copied;
 *   - an NPM specifier is downloaded, integrity-checked, vendored under
 *     `extensions/npm/` (`npm-plugin-installer.ts`) and written back pinned, as
 *     `name@version`.
 *
 * Nothing is copied into a project here. A bundled look's stylesheet is
 * carried as text on its row of the table in `extension-specifier.ts` and
 * handed to the cascade the way a plugin's `css` export is; the book styles
 * over it from its own `styles:` sheets, which load after every extension.
 * Zip and URL imports land in `extensions/` (extension-import.ts).
 *
 * Cascade order and markdown registration order are BOTH the list order —
 * a later entry loads later and its CSS wins ties — and the project's own
 * `styles:` always come after every extension (`assemble.ts`, #227).
 *
 * Manifest editing uses the `yaml` Document API so comments and formatting
 * round-trip (the same dep `manifest.ts` parses with). Host-side (node:fs);
 * the desktop reaches it through thin SvelteKit server routes.
 */
import { readdir, readFile, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { isSeq, isMap, isScalar, YAMLMap, YAMLSeq, Scalar } from "yaml";
import type { Node } from "yaml";

import { loadPlugin } from "./markdown/plugins.ts";
import { loadManifestDoc, ensureSeq, writeManifestDoc } from "./manifest-doc.ts";
import {
  finalizeNpmPluginInstall,
  installNpmPlugin,
  removeEmptyDirs,
  rollbackNpmPluginInstall,
  type NpmPluginInstallOptions,
} from "./npm-plugin-installer.ts";
import {
  vendoredNpmPluginRoots,
  EXTENSIONS_DIR,
  isExactNpmVersion,
  resolvePackageEntry,
  resolveVendoredPluginInstallRoot,
  vendoredNpmPluginPackageDir,
  vendoredNpmPluginRoot,
} from "./plugin-vendor.ts";
import { FriendlyHttpError, withFetchTimeout } from "./fetch-timeout.ts";
import { npmRegistryUrl } from "./npm-registry.ts";
import { gt as semverGt, rcompare as semverRcompare } from "semver";
import {
  isPathSpecifier,
  parseExtensionSpecifier,
  pinnedNpmSpecifier,
  type ParsedExtensionSpecifier,
} from "./extension-specifier.ts";
import {
  EXTENSION_MANIFEST_FILENAME,
  extensionCarries,
  extensionStyleList,
  readExtensionMeta,
  resolveExtension,
  type ExtensionCarries,
} from "./extension-manifest.ts";
import { BUNDLED_EXTENSIONS, bundledExtension } from "./extension-specifier.ts";
import { slugify, prettify } from "./slug.ts";
import { ensureProjectGitignore } from "./project-gitignore.ts";
import type { ResolvedExtensionConfig } from "../schema/manifest.types.ts";

/** The folder (relative to the project root) a book's extensions live under:
 *  vendored npm copies in `extensions/npm/`, zip and URL imports beside them
 *  (extension-import.ts). Path entries elsewhere are never moved. */
export { EXTENSIONS_DIR } from "./plugin-vendor.ts";

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
  /** Declared stylesheets relative to the folder, in cascade order
   *  (`gutterpress.styles`). Absent when the folder declares none. */
  styles?: string[];
  /** What the extension declares — the badges on the desktop's Looks &
   *  features list. */
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

// ── Serialization ────────────────────────────────────────────────────────────

const mutationQueues = new Map<string, Promise<void>>();

/** One key per book folder, however the path is spelled (Windows paths are case-insensitive). */
export function projectKey(projectDir: string): string {
  const resolved = path.resolve(projectDir);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/** Serialize all extension filesystem + manifest mutations for one project. */
function withMutationLock<T>(projectDir: string, mutation: () => Promise<T>): Promise<T> {
  const key = projectKey(projectDir);
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
    throw new Error("An extension cannot be the book folder itself.");
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
  publish: false,
};

/**
 * Describe one extension folder from its package.json.
 *
 * `labelFrom` turns the declared `name` into the author-facing label: a
 * package.json `name` is an npm-style slug by convention, so a folder the
 * author owns reads better prettified ("clean-book" → "Clean book"), matching
 * the prettified folder-name fallback right beside it. An npm entry passes
 * identity instead — its name IS the install specifier and must read back
 * exactly as it was typed.
 */
async function describeFolder(
  dir: string,
  base: Omit<ProjectExtensionEntry, "label" | "carries">,
  fallbackLabel: string,
  labelFrom: (name: string) => string = prettify,
): Promise<ProjectExtensionEntry> {
  const meta = await readExtensionMeta(dir);
  const styles = extensionStyleList(meta);
  return {
    ...base,
    label: meta.name?.trim() ? labelFrom(meta.name.trim()) : fallbackLabel,
    ...(meta.description?.trim() ? { description: meta.description.trim() } : {}),
    ...(meta.author?.trim() ? { author: meta.author.trim() } : {}),
    ...(meta.preview !== undefined ? { preview: meta.preview } : {}),
    ...(styles.length > 0 ? { styles } : {}),
    carries: extensionCarries(meta),
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
    // The parser only says "bundled" for a name in the same table.
    const bundled = bundledExtension(parsed.name)!;
    return withWarnings({
      ...common,
      kind: "bundled",
      name: parsed.name,
      label: bundled.label,
      description: bundled.description,
      // A bundled look carries its stylesheet as text; everything else bundled is markdown.
      carries: { ...NO_CARRIES, ...(bundled.css !== undefined ? { styles: true } : { markdown: true }) },
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
  if (!existsSync(path.join(pkgDir, EXTENSION_MANIFEST_FILENAME))) {
    // No package.json at all (an unpacked tree that lost it): still a plain
    // markdown-it plugin as far as the list is concerned.
    return withWarnings({ ...base, label: parsed.name, carries: { ...NO_CARRIES, markdown: true } });
  }
  // An npm package's markdown-it entry is the one the installer resolved with
  // full `exports` semantics, not `main` — so `carries.markdown` is true for
  // every npm entry regardless of what package.json's `main` says, except a
  // publishing plugin (experimental, #381), whose entry is its publish module.
  const described = await describeFolder(pkgDir, base, parsed.name, (name) => name);
  return withWarnings({
    ...described,
    carries: { ...described.carries, markdown: !described.carries.publish },
  });
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
      // Wherever the copy may live, the current folder or an older book's.
      for (const root of vendoredNpmPluginRoots(projectDir, parsed.name, parsed.version)) {
        await rm(root, { recursive: true, force: true });
        await removeEmptyDirs([path.dirname(root)]); // the package folder, once its last version is gone
      }
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
 *   - an npm specifier (`name`, `name@version`) is downloaded,
 *     integrity-checked, vendored, load-tested, and written back as
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
  const { name, version, use, warnings } = await vendorNpmExtension(
    projectDir,
    input,
    chosenExport,
    options,
    (use) => upsertEntry(projectDir, use, chosenExport),
  );
  warnings.push(...(await pruneStaleVersions(projectDir, name, [version, ...(await pinnedVersionsOf(projectDir, name))])));
  const entry = (await describeExtension(projectDir, use))!;
  return warnings.length > 0 ? { ...entry, warnings: [...(entry.warnings ?? []), ...warnings] } : entry;
}

/**
 * Download one pinned npm extension again (`name@<exact version>`): the same
 * verified transaction as {@link addExtension}, minus the manifest write — the
 * pin is already there and is never changed. Returns the install's warnings.
 */
export function restoreNpmExtension(
  projectDir: string,
  name: string,
  version: string,
  exportName: string | undefined,
  options: NpmPluginInstallOptions & {
    /** Every version of `name` an enabled manifest entry pins — never pruned. */
    keepVersions?: readonly string[];
  } = {},
): Promise<string[]> {
  return withMutationLock(projectDir, async () => {
    // Another caller (a desktop open racing a build, `ext add`) may have
    // installed it while this one waited its turn; downloading again would
    // swap the tree out from under whoever is loading it.
    if (!(await vendoredCopyNeedsInstall(projectDir, name, version))) return [];
    const restored = await vendorNpmExtension(projectDir, `${name}@${version}`, exportName, options, async () => {});
    return [...restored.warnings, ...(await pruneStaleVersions(projectDir, name, [version, ...(options.keepVersions ?? [])]))];
  });
}

/** True when `extensions/npm/<name>/<version>/` is absent or has no loadable entry — what the loader calls "not installed" or "incomplete". */
export async function vendoredCopyNeedsInstall(projectDir: string, name: string, version: string): Promise<boolean> {
  try {
    const installRoot = await resolveVendoredPluginInstallRoot(projectDir, name, version);
    if (!installRoot) return true;
    await resolvePackageEntry(vendoredNpmPluginPackageDir(installRoot, name));
    return false;
  } catch {
    return true;
  }
}

/**
 * The shared npm install transaction behind `addExtension` and the restore of a
 * pinned extension: download, verify, vendor, load-test, then `commit(use)`
 * (the manifest write — a no-op for a restore, which never changes the
 * manifest). On any failure the vendor tree is rolled back. Also makes sure
 * the book's `.gitignore` keeps what was just downloaded out of its history.
 * Returns the exact pin and the install's warnings.
 */
async function vendorNpmExtension(
  projectDir: string,
  input: string,
  exportName: string | undefined,
  options: AddExtensionOptions,
  commit: (use: string) => Promise<void>,
): Promise<{ name: string; version: string; use: string; warnings: string[] }> {
  const installed = await installNpmPlugin(projectDir, input, options);
  const use = pinnedNpmSpecifier(installed.name, installed.version);
  try {
    await loadPlugin(
      extensionConfigFor({
        use,
        kind: "npm",
        name: installed.name,
        version: installed.version,
        export: exportName,
      }),
      projectDir,
    );
    await options.__testFailBeforeManifestCommit?.();
    await commit(use);
  } catch (cause) {
    try {
      await rollbackNpmPluginInstall(installed);
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
  warnings.push(...(await retireLegacyCopies(projectDir, installed.name)));
  try {
    const { negated } = await ensureProjectGitignore(projectDir);
    if (negated.includes("extensions/npm/")) {
      warnings.push(
        "Your .gitignore re-includes extensions/npm/, so downloaded extensions will be committed with " +
          "your book. They shouldn't be: the manifest pins each version and a build downloads a " +
          "missing copy again.",
      );
    }
  } catch (error) {
    warnings.push(
      `The extension was installed, but .gitignore could not be updated to keep it out of version history: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return { name: installed.name, version: installed.version, use, warnings };
}

/**
 * Once a package is vendored under `extensions/npm/`, the copies a book
 * vendored before 0.11.23 kept under `plugins/npm/<name>/` are dead weight —
 * every version of them, since the current tree now holds what the manifest
 * pins — so they go, and `plugins/npm/` and `plugins/` go too once nothing
 * else is left in them (#436). Returns a warning, never throws: the install
 * itself succeeded.
 */
async function retireLegacyCopies(projectDir: string, name: string): Promise<string[]> {
  // The roots list the current tree first, then the older book's.
  const legacyPackageDir = path.dirname(vendoredNpmPluginRoots(projectDir, name, "0.0.0")[1]!);
  const legacyNpmDir = path.dirname(legacyPackageDir);
  try {
    await rm(legacyPackageDir, { recursive: true, force: true });
    await removeEmptyDirs([path.dirname(legacyNpmDir), legacyNpmDir]);
  } catch (error) {
    return [
      `The extension was installed, but the copy an older version of Gutterpress kept under plugins/npm/ ` +
        `could not be removed: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }
  return [];
}

/** The exact versions of `name` that an enabled manifest entry pins. */
async function pinnedVersionsOf(projectDir: string, name: string): Promise<string[]> {
  const { doc } = await loadManifestDoc(projectDir);
  const seq = doc.get("extensions", true);
  if (!isSeq(seq)) return [];
  const versions: string[] = [];
  for (const item of seq.items as Node[]) {
    const raw = rawEntry(item);
    if (!raw?.enabled) continue;
    try {
      const parsed = parseExtensionSpecifier(raw.use);
      if (parsed.kind === "npm" && parsed.name === name && parsed.version) versions.push(parsed.version);
    } catch {
      // A malformed specifier pins nothing.
    }
  }
  return versions;
}

/**
 * THE pruning rule, shared by `ext add`/`ext update` and the restore of a
 * pinned extension: once a package's pinned version is installed, every other
 * vendored version of THAT package is deleted, except one an enabled manifest
 * entry still pins (`keep`). The folders are a gitignored cache, and the
 * manifest can name only one version of a package, so the rest is dead weight —
 * a re-pin, a pulled pin, or a switched branch used to leave it behind. Only
 * exact version folders of this one package are touched: the installer's
 * `.install-*` staging and `<version>.backup-*` folders are its own to manage.
 * Returns a warning, never throws: the install itself succeeded.
 */
async function pruneStaleVersions(projectDir: string, name: string, keep: readonly string[]): Promise<string[]> {
  // The package folder in the current vendor tree and in an older book's.
  const parents = vendoredNpmPluginRoots(projectDir, name, "0.0.0").map((root) => path.dirname(root));
  try {
    for (const parent of parents) {
      let entries;
      try {
        entries = await readdir(parent, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        let version: string;
        try {
          version = decodeURIComponent(entry.name);
        } catch {
          continue;
        }
        if (!isExactNpmVersion(version) || keep.includes(version)) continue;
        await rm(path.join(parent, entry.name), { recursive: true, force: true });
      }
    }
  } catch (error) {
    return [
      `The extension was installed, but a previous version's downloaded copy could not be removed: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    ];
  }
  return [];
}

// ── Updates ──────────────────────────────────────────────────────────────────
//
// A book pins exact versions and builds offline; nothing here runs from the
// loader, build or preview. Checking is ON DEMAND — `gutterpress ext outdated`,
// `ext update`, and the desktop's Looks & features tab when it is opened — and an
// update is the same `addExtension` an author would run by hand, so the new
// version is downloaded, verified, vendored, load-tested and re-pinned in
// place (and the old version's folder removed) exactly as `ext add` does.

/** One pinned npm extension against npm's `latest` tag. */
export interface ExtensionUpdateCheck {
  /** The specifier as written in the manifest (`name@current`). */
  use: string;
  name: string;
  /** The pinned version. */
  current: string;
  /** npm's `latest` dist-tag (the newest of any kind with `includePrerelease`). */
  latest: string;
  /** `latest` is newer than `current` (semver). */
  outdated: boolean;
}

export interface CheckExtensionUpdatesOptions {
  /** Dependency injection for tests; production uses global fetch. */
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
  /**
   * Compare against the newest published version, pre-releases included
   * (`-alpha`, `-beta`, `-rc`), instead of npm's `latest` dist-tag. Default
   * false: the dist-tag, as `ext outdated` has always done.
   */
  includePrerelease?: boolean;
}

const LATEST_LOOKUP_TIMEOUT_MS = 30_000;
const MAX_PACKUMENT_BYTES = 15 * 1024 * 1024;

/** The `latest` dist-tag and every published version of one package, from the abbreviated packument. */
async function fetchNpmVersions(
  name: string,
  options: CheckExtensionUpdatesOptions,
): Promise<{ latest: unknown; versions: string[] }> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  return withFetchTimeout(
    {
      timeoutMs: LATEST_LOOKUP_TIMEOUT_MS,
      signal: options.signal,
      timeoutMessage: `Looking up ${name} on npm timed out. Check your connection and try again.`,
      offlineMessage: (cause) =>
        `Looking up ${name} on npm failed (${cause instanceof Error ? cause.message : String(cause)}).`,
    },
    async (signal) => {
      const response = await fetchImpl(`${npmRegistryUrl()}/${encodeURIComponent(name)}`, {
        signal,
        redirect: "error",
        headers: { accept: "application/vnd.npm.install-v1+json" },
      });
      if (response.status === 404) throw new FriendlyHttpError(`npm package "${name}" was not found.`);
      if (!response.ok) throw new FriendlyHttpError(`Looking up ${name} on npm failed (HTTP ${response.status}).`);
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > MAX_PACKUMENT_BYTES) {
        throw new FriendlyHttpError(`npm metadata for "${name}" is too large to read.`);
      }
      try {
        const packument = JSON.parse(Buffer.from(bytes).toString("utf8")) as {
          "dist-tags"?: Record<string, unknown>;
          versions?: Record<string, unknown>;
        };
        return {
          latest: packument["dist-tags"]?.latest,
          versions: Object.keys(packument.versions ?? {}).filter(isExactNpmVersion),
        };
      } catch {
        throw new FriendlyHttpError(`npm metadata for "${name}" is not valid JSON.`);
      }
    },
  );
}

/**
 * npm's newest version of one package: the `latest` dist-tag, or with
 * `includePrerelease` the highest published version of any kind.
 */
async function latestNpmVersion(name: string, options: CheckExtensionUpdatesOptions): Promise<string> {
  const { latest, versions } = await fetchNpmVersions(name, options);
  if (options.includePrerelease) {
    const newest = versions.sort(semverRcompare)[0];
    if (newest) return newest;
  }
  if (typeof latest !== "string" || !isExactNpmVersion(latest)) {
    throw new FriendlyHttpError(`npm metadata for "${name}" has no latest version.`);
  }
  return latest;
}

/**
 * Every published version of one npm package, newest first, pre-releases
 * included — what a version picker chooses from (the caller decides whether to
 * show pre-releases). One metadata lookup, the same one the update check makes.
 */
export async function listNpmVersions(
  name: string,
  options: Pick<CheckExtensionUpdatesOptions, "fetch" | "signal"> = {},
): Promise<string[]> {
  return (await fetchNpmVersions(name, options)).versions.sort(semverRcompare);
}

/**
 * Every pinned npm extension of the book against npm's newest version, in manifest
 * order. Bundled, path and unpinned entries are not npm's to answer for and
 * are skipped. One lookup per package, in parallel; a failed lookup throws
 * with the package named.
 */
export async function checkExtensionUpdates(
  projectDir: string,
  options: CheckExtensionUpdatesOptions = {},
): Promise<ExtensionUpdateCheck[]> {
  const entries = await listProjectExtensions(projectDir);
  const pinned = entries.filter((e) => e.kind === "npm" && e.version);
  return Promise.all(
    pinned.map(async (e) => {
      const current = e.version!;
      const latest = await latestNpmVersion(e.name, options);
      return { use: e.use, name: e.name, current, latest, outdated: semverGt(latest, current) };
    }),
  );
}

/** One extension `updateExtensions` moved. */
export interface ExtensionUpdateResult {
  name: string;
  from: string;
  to: string;
}

export interface UpdateExtensionsOptions extends CheckExtensionUpdatesOptions {
  /** Update only this package (its npm name); default every pinned npm entry. */
  only?: string;
  /** Test/specialized-host install limits — see `NpmPluginInstallOptions`. */
  limits?: NpmPluginInstallOptions["limits"];
}

/**
 * Re-pin every outdated npm extension (or just `only`) to npm's `latest`,
 * one `addExtension(name@latest)` each — the same download, verification,
 * vendoring, load test and in-place re-pin as `ext add`, keeping the entry's
 * `export:` and `enabled:` as written and removing the old version's folder.
 * Returns what moved; an up-to-date book returns `[]`.
 */
export async function updateExtensions(
  projectDir: string,
  options: UpdateExtensionsOptions = {},
): Promise<ExtensionUpdateResult[]> {
  let checks = await checkExtensionUpdates(projectDir, options);
  if (options.only) {
    checks = checks.filter((c) => c.name === options.only);
    if (checks.length === 0) {
      throw new Error(`"${options.only}" is not a pinned npm extension of this book.`);
    }
  }
  const updated: ExtensionUpdateResult[] = [];
  for (const check of checks) {
    if (!check.outdated) continue;
    await addExtension(projectDir, pinnedNpmSpecifier(check.name, check.latest), {
      fetch: options.fetch,
      signal: options.signal,
      limits: options.limits,
    });
    updated.push({ name: check.name, from: check.current, to: check.latest });
  }
  return updated;
}

// ── Bundled extensions ───────────────────────────────────────────────────────

/** A bundled extension as the desktop lists it: "Add" writes `use`. */
export interface BundledExtensionInfo {
  use: string;
  /** Short, plain-language name shown as the row title. */
  label: string;
  description: string;
  /** A look (styles only), as opposed to a markdown feature. */
  look: boolean;
}

/** The bundled extensions, in table order. */
export function listBundledExtensions(): BundledExtensionInfo[] {
  return BUNDLED_EXTENSIONS.map((b) => ({
    use: b.name,
    label: b.label,
    description: b.description,
    look: b.css !== undefined,
  }));
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
 * preview thumbnail (the renderer never touches fs). A bundled look answers
 * whether or not the manifest lists it, so a book can show what a look is
 * before adding it. Read-only, so concatenation is fine even though it would
 * not be for an editable surface.
 */
export async function readExtensionCss(projectDir: string, use: string): Promise<string> {
  const direct = bundledExtension(use)?.css;
  if (direct !== undefined) return direct;
  const entry = await describeExtension(projectDir, use);
  if (!entry) throw new Error(`Extension "${use}" is not in the manifest.`);
  return readEntryCss(entry);
}

/** The same, for an entry already described (`listProjectExtensions`), so a caller with the list in hand reads each once. */
export async function readEntryCss(entry: Pick<ProjectExtensionEntry, "use" | "dir">): Promise<string> {
  const direct = bundledExtension(entry.use)?.css;
  if (direct !== undefined) return direct;
  if (!entry.dir) throw new Error(`Extension "${entry.use}" has no stylesheets to preview.`);
  const meta = await readExtensionMeta(entry.dir);
  const sheets = resolveExtension(entry.dir, meta, `Extension "${entry.use}"`).styles ?? [];
  if (sheets.length === 0) throw new Error(`Extension "${entry.use}" declares no stylesheets.`);
  return (await Promise.all(sheets.map((sheet) => readFile(sheet, "utf8")))).join("\n\n");
}
