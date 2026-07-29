/**
 * Plugin manager (#30) — read / write / toggle the project manifest's plugin
 * list, import plugins (local folder/file or installed npm package), and validate
 * each configured plugin by attempting to LOAD it through the existing lib
 * loader (CLAUDE.md §5: plain markdown-it plugins and a fail-fast loader).
 *
 * Storage model (Occam's razor): plugins already live in `manifest.yaml` as a
 * `plugins:` list of strings or objects (see `manifest.types.ts`). The
 * enable/disable toggle is the SIMPLEST manifest representation — an optional
 * `enabled: false` flag on the entry. A disabled entry stays in the manifest
 * (so the toggle is reversible and the entry's options/version survive), and
 * `resolveConfig` skips `enabled === false` entries at build time.
 *
 * Manifest editing uses the `yaml` library's Document API so existing comments
 * and formatting round-trip cleanly (the same `yaml` dep `manifest.ts` parses
 * with). This module is host-side (node:fs); the renderer reaches it through a
 * thin SvelteKit server route.
 *
 * Bundle-safety (CLAUDE.md §1/§3): no bundlers or computed-path dynamic
 * imports. Validation reuses `loadPlugin` from `markdown/plugins.ts`, which
 * already compiles under `bun build --compile`.
 */
import { randomUUID } from "node:crypto";
import { cp, lstat, mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { isSeq, isMap, isScalar, YAMLMap, YAMLSeq, Scalar } from "yaml";
import type { Node } from "yaml";
import { clearVendoredPluginResolver, loadPlugin } from "./markdown/plugins";
import { loadManifestDoc, ensureSeq, writeManifestDoc } from "./manifest-doc";
import {
  finalizeNpmPluginInstall,
  installNpmPlugin,
  rollbackNpmPluginInstall,
  type NpmPluginInstallOptions,
} from "./npm-plugin-installer";
import { parseNpmPluginSpec, PLUGINS_DIR } from "./plugin-vendor";
import type { ResolvedPluginConfig } from "../schema/manifest.types";

/** Folder (relative to the project root) imported local plugins are copied to. */
export { PLUGINS_DIR } from "./plugin-vendor";

/** How a plugin entry is referenced in the manifest. */
export type PluginKind = "local" | "npm";

/** One configured plugin, as surfaced to the manager UI. */
export interface ProjectPluginEntry {
  /** Stable reference: the manifest `path` (local) or `name` (npm). */
  ref: string;
  /** `"local"` when referenced by file path, `"npm"` when by package name. */
  kind: PluginKind;
  /** Per-project enable flag. Absent in the manifest defaults to `true`. */
  enabled: boolean;
  /** Exact installed npm version. Absent for local, built-in, and legacy entries. */
  version?: string;
  /** Named module export selected as the plugin function. */
  export?: string;
  /** Non-fatal install notices, currently used for legacy SHA-1 registry entries. */
  warnings?: string[];
}

interface PluginManagerInstallOptions extends NpmPluginInstallOptions {
  exportName?: string;
  __testFailBeforeManifestCommit?: () => void | Promise<void>;
}

const pluginMutationQueues = new Map<string, Promise<void>>();

/** Serialize all plugin filesystem + manifest mutations for one project. */
function withPluginMutationLock<T>(
  projectDir: string,
  mutation: () => Promise<T>,
): Promise<T> {
  const resolved = path.resolve(projectDir);
  const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  const previous = pluginMutationQueues.get(key) ?? Promise.resolve();
  const run = previous.then(mutation, mutation);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  pluginMutationQueues.set(key, tail);
  void tail.then(() => {
    if (pluginMutationQueues.get(key) === tail) pluginMutationQueues.delete(key);
  });
  return run;
}

/** Result of attempting to load one configured plugin. */
export interface PluginValidationResult {
  ref: string;
  kind: PluginKind;
  /** Mirrors the manifest enable flag. Disabled plugins are not load-tested. */
  enabled: boolean;
  /** `true` when the plugin loaded OK (or is disabled and skipped). */
  ok: boolean;
  /** The loader's fail-fast error message when `ok` is `false`. */
  error?: string;
}

/** A curated markdown feature an author can turn on. */
export interface RecommendedPlugin {
  /** The npm package name (also the manifest entry that "Add" writes). */
  name: string;
  /** Short, plain-language feature name shown as the row title (the package
   *  name is demoted to secondary text — a non-technical author shouldn't have
   *  to read `markdown-it-*` ids to pick a feature). */
  label: string;
  /** One-line author-friendly description. */
  description: string;
  /**
   * True when gutterpress ships this plugin (see `BUILTIN_OPTIONAL_PLUGINS`):
   * "Add" enables it instantly, no install, works offline. All entries below
   * are built-in — the always-on defaults (attrs/footnote/deflist, applied
   * unconditionally in renderer.ts) are intentionally NOT listed here, since
   * recommending the author "add" something already active is pure confusion.
   */
  builtin: true;
}

/**
 * Curated, BUILT-IN opt-in markdown features. Each is bundled with gutterpress
 * (`BUILTIN_OPTIONAL_PLUGINS`), so clicking "Add" writes the manifest entry AND
 * the feature works immediately — no terminal, no install, offline. This is the
 * non-technical-author happy path: "turn on a feature → it works".
 */
export const RECOMMENDED_PLUGINS: RecommendedPlugin[] = [
  {
    name: "markdown-it-mark",
    label: "Highlight",
    description: "Highlighted text with `==marked==` → `<mark>`.",
    builtin: true,
  },
  {
    name: "markdown-it-sub",
    label: "Subscript",
    description: "Subscript text with `H~2~O`.",
    builtin: true,
  },
  {
    name: "markdown-it-sup",
    label: "Superscript",
    description: "Superscript text with `29^th^`.",
    builtin: true,
  },
  {
    name: "markdown-it-abbr",
    label: "Abbreviations",
    description: "Define `*[HTML]: Hyper Text…` and get `<abbr>` tooltips.",
    builtin: true,
  },
];

/**
 * A string entry like `./x` or `/x` or `C:\x` is a local file path.
 *
 * Also detects bare relative paths that lack the `./` prefix (e.g.
 * `plugins/my-plugin.js`): npm package names cannot contain `/` unless
 * scoped (`@scope/name`), and never end in a file extension.
 */
function isLocalRef(ref: string): boolean {
  return (
    ref.startsWith("./") ||
    ref.startsWith("../") ||
    ref.startsWith("/") ||
    /^[a-zA-Z]:[\\/]/.test(ref) ||
    // A file extension → definitely a local file, not an npm name.
    /\.(m?js|cjs|ts)$/i.test(ref) ||
    // Contains a path separator but isn't a scoped npm package.
    // (npm names can only contain "/" in the "@scope/name" form.)
    (!ref.startsWith("@") && ref.includes("/"))
  );
}

/** The string ref of one plugins-list item (path for objects, the scalar otherwise). */
function itemRef(item: unknown): string | null {
  if (isScalar(item)) return typeof item.value === "string" ? item.value : null;
  if (isMap(item)) {
    const p = item.get("path");
    const n = item.get("name");
    if (typeof p === "string") return p;
    if (typeof n === "string") return n;
  }
  return null;
}

function refKind(ref: string): PluginKind {
  return isLocalRef(ref) ? "local" : "npm";
}

/**
 * List the project's configured plugins with their per-project enable flag.
 * Returns `[]` when there is no manifest or no `plugins:` list.
 *
 * For object-form entries, the kind is taken from the manifest KEY (`path:` →
 * local, `name:` → npm) rather than guessing from the value. This correctly
 * classifies e.g. `path: plugins/foo.js` (no `./` prefix) as local. Scalar
 * (string) entries fall back to the {@link isLocalRef} heuristic.
 */
export async function listProjectPlugins(
  projectDir: string,
): Promise<ProjectPluginEntry[]> {
  const { doc } = await loadManifestDoc(projectDir);
  const seq = doc.get("plugins", true);
  if (!isSeq(seq)) return [];

  const out: ProjectPluginEntry[] = [];
  for (const item of seq.items as Node[]) {
    const ref = itemRef(item);
    if (!ref) continue;
    let enabled = true;
    let kind: PluginKind;
    let version: string | undefined;
    let exportName: string | undefined;
    if (isMap(item)) {
      const e = item.get("enabled");
      if (e === false) enabled = false;
      // The manifest key explicitly says local (path:) or npm (name:).
      if (item.has("path")) kind = "local";
      else if (item.has("name")) kind = "npm";
      else kind = refKind(ref);
      const v = item.get("version");
      if (kind === "npm" && typeof v === "string") version = v;
      const x = item.get("export");
      if (typeof x === "string") exportName = x;
    } else {
      kind = refKind(ref);
    }
    out.push({
      ref,
      kind,
      enabled,
      ...(version ? { version } : {}),
      ...(exportName ? { export: exportName } : {}),
    });
  }
  return out;
}

/** Find the seq index of the item whose ref matches. */
function indexOfRef(seq: YAMLSeq, ref: string): number {
  return (seq.items as Node[]).findIndex((item) => itemRef(item) === ref);
}

/**
 * Set the per-project enabled flag for the plugin identified by `ref` (its
 * path or npm name). A string-form entry is normalised to an object entry so
 * the flag can be attached. Persists to the manifest (preserving comments).
 * Throws when no entry matches `ref`.
 */
export async function setPluginEnabled(
  projectDir: string,
  ref: string,
  enabled: boolean,
): Promise<void> {
  return withPluginMutationLock(projectDir, () => setPluginEnabledUnlocked(projectDir, ref, enabled));
}

async function setPluginEnabledUnlocked(
  projectDir: string,
  ref: string,
  enabled: boolean,
): Promise<void> {
  const { doc, file } = await loadManifestDoc(projectDir);
  const seq = doc.get("plugins", true);
  if (!isSeq(seq)) {
    throw new Error(`No plugins are configured in ${path.basename(file)}.`);
  }
  const idx = indexOfRef(seq, ref);
  if (idx < 0) {
    throw new Error(`Plugin "${ref}" is not in the manifest.`);
  }

  const item = seq.items[idx] as Node;
  let map: YAMLMap;
  if (isMap(item)) {
    map = item;
  } else {
    // Normalise a scalar string entry into an object so we can attach the flag.
    map = new YAMLMap(doc.schema);
    const key = isLocalRef(ref) ? "path" : "name";
    map.set(key, ref);
    seq.items[idx] = map;
  }

  if (enabled) {
    // Re-enabling: drop the flag so the entry reads cleanly (enabled is default).
    map.delete("enabled");
  } else {
    map.set("enabled", false);
  }

  await writeManifestDoc(file, doc);
}

/** Append a plugin item (scalar or map) to the manifest's plugins list. */
async function appendPlugin(
  projectDir: string,
  ref: string,
  item: unknown,
): Promise<void> {
  const { doc, file } = await loadManifestDoc(projectDir);
  const seq = ensureSeq(doc, "plugins");
  if (indexOfRef(seq, ref) >= 0) return; // idempotent — already present
  seq.add(item);
  await writeManifestDoc(file, doc);
}

/** Record an installed npm plugin, preserving existing options/priority/toggle fields. */
async function recordInstalledNpmPlugin(
  projectDir: string,
  name: string,
  version: string,
  exportName?: string,
): Promise<void> {
  const { doc, file } = await loadManifestDoc(projectDir);
  const seq = ensureSeq(doc, "plugins");
  const idx = indexOfRef(seq, name);
  let map: YAMLMap;
  if (idx >= 0 && isMap(seq.items[idx])) {
    map = seq.items[idx] as YAMLMap;
  } else {
    map = new YAMLMap(doc.schema);
    if (idx >= 0) seq.items[idx] = map;
    else seq.add(map);
  }
  map.delete("path");
  map.set("name", name);
  map.set("version", version);
  if (exportName) map.set("export", exportName);
  else map.delete("export");
  await writeManifestDoc(file, doc);
}

/**
 * Install an npm markdown-it plugin without an external package manager, then
 * record its exact version in the manifest. Built-in optional plugins remain
 * offline: adding one only records its bundled package name.
 */
export async function addNpmPlugin(
  projectDir: string,
  packageSpec: string,
  exportName?: string,
): Promise<ProjectPluginEntry> {
  return addNpmPluginWithOptions(projectDir, packageSpec, { exportName });
}

/** @internal Dependency/fault injection for focused installer tests. */
export async function addNpmPluginWithOptions(
  projectDir: string,
  packageSpec: string,
  options: PluginManagerInstallOptions = {},
): Promise<ProjectPluginEntry> {
  return withPluginMutationLock(projectDir, () => addNpmPluginUnlocked(projectDir, packageSpec, options));
}

async function addNpmPluginUnlocked(
  projectDir: string,
  packageSpec: string,
  options: PluginManagerInstallOptions,
): Promise<ProjectPluginEntry> {
  const input = packageSpec.trim();
  if (isLocalRef(input)) {
    throw new Error(
      `"${input}" looks like a path. Use addLocalPlugin to import a local plugin.`,
    );
  }
  const requested = parseNpmPluginSpec(input);
  const existing = (await listProjectPlugins(projectDir)).find(
    (entry) => entry.kind === "npm" && entry.ref === requested.name,
  );
  const exportName = options.exportName?.trim() || existing?.export;
  if (!requested.selector && RECOMMENDED_PLUGINS.some((plugin) => plugin.name === requested.name)) {
    if (exportName) {
      throw new Error(`Bundled plugin "${requested.name}" does not need a named export.`);
    }
    await appendPlugin(projectDir, requested.name, new Scalar(requested.name));
    return { ref: requested.name, kind: "npm", enabled: true };
  }

  const installed = await installNpmPlugin(projectDir, input, options);
  try {
    await loadPlugin(
      {
        name: installed.name,
        version: installed.version,
        ...(exportName ? { export: exportName } : {}),
        priority: 100,
        options: {},
      },
      projectDir,
    );
    await options.__testFailBeforeManifestCommit?.();
    await recordInstalledNpmPlugin(
      projectDir,
      installed.name,
      installed.version,
      exportName,
    );
  } catch (cause) {
    try {
      await rollbackNpmPluginInstall(installed);
      clearVendoredPluginResolver(projectDir, installed.name, installed.version);
    } catch (rollbackError) {
      throw new Error(
        `Plugin install failed and its previous vendor tree could not be restored: ` +
          `${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
        { cause },
      );
    }
    throw new Error(
      `Downloaded ${installed.name}@${installed.version}, but it is not a loadable markdown-it plugin: ` +
        `${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
  const warnings = [...installed.warnings];
  await finalizeNpmPluginInstall(installed).catch((error) => {
    warnings.push(
      `The plugin was installed, but an old backup could not be removed: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  });
  return {
    ref: installed.name,
    kind: "npm",
    enabled: true,
    version: installed.version,
    ...(exportName ? { export: exportName } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

/**
 * Import a local plugin by copying the source file OR folder into the
 * project's `plugins/` directory and adding a manifest entry that references
 * the copied path (so the plugin travels with the project). Returns the new
 * entry. Throws when `sourcePath` does not exist.
 */
export async function addLocalPlugin(
  projectDir: string,
  sourcePath: string,
): Promise<ProjectPluginEntry & { path: string }> {
  return withPluginMutationLock(projectDir, () => addLocalPluginUnlocked(projectDir, sourcePath));
}

async function addLocalPluginUnlocked(
  projectDir: string,
  sourcePath: string,
): Promise<ProjectPluginEntry & { path: string }> {
  let info;
  try {
    info = await stat(sourcePath);
  } catch {
    throw new Error(`Plugin source not found: ${sourcePath}`);
  }

  const base = path.basename(sourcePath);
  const destDir = path.join(projectDir, PLUGINS_DIR);
  await mkdir(destDir, { recursive: true });
  const dest = path.join(destDir, base);
  const staging = path.join(destDir, `.import-${randomUUID()}`);
  const backup = path.join(destDir, `.backup-${randomUUID()}`);
  let hasBackup = false;

  try {
    if (info.isDirectory()) {
      await cp(sourcePath, staging, { recursive: true });
    } else {
      await cp(sourcePath, staging);
    }
    try {
      await lstat(dest);
      await rename(dest, backup);
      hasBackup = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    try {
      await rename(staging, dest);
    } catch (error) {
      if (hasBackup) await rename(backup, dest);
      throw error;
    }

    const relPath = `./${PLUGINS_DIR}/${base}`;
    try {
      await appendPlugin(projectDir, relPath, new Scalar(relPath));
    } catch (error) {
      await rm(dest, { recursive: true, force: true });
      if (hasBackup) await rename(backup, dest);
      throw error;
    }
    if (hasBackup) await rm(backup, { recursive: true, force: true }).catch(() => {});
    return { ref: relPath, kind: "local", enabled: true, path: relPath };
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Validate every configured plugin by attempting to LOAD it through the
 * existing lib loader (`loadPlugin`). Disabled plugins are reported as
 * disabled and NOT load-tested. Loader errors are CAUGHT and surfaced per
 * plugin (never thrown through) so the UI can flag erroring plugins clearly.
 *
 * This reuses the fail-fast loader path verbatim (§5) — including its
 * "not found / install it" message for unresolvable npm packages — rather than
 * reimplementing resolution.
 */
export async function validateProjectPlugins(
  projectDir: string,
): Promise<PluginValidationResult[]> {
  const entries = await listProjectPlugins(projectDir);
  const out: PluginValidationResult[] = [];

  for (const entry of entries) {
    if (!entry.enabled) {
      out.push({ ref: entry.ref, kind: entry.kind, enabled: false, ok: true });
      continue;
    }
    const config: ResolvedPluginConfig =
      entry.kind === "local"
        ? {
            path: entry.ref,
            ...(entry.export ? { export: entry.export } : {}),
            priority: 100,
            options: {},
          }
        : {
            name: entry.ref,
            ...(entry.version ? { version: entry.version } : {}),
            ...(entry.export ? { export: entry.export } : {}),
            priority: 100,
            options: {},
          };
    try {
      await loadPlugin(config, projectDir);
      out.push({ ref: entry.ref, kind: entry.kind, enabled: true, ok: true });
    } catch (e) {
      out.push({
        ref: entry.ref,
        kind: entry.kind,
        enabled: true,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return out;
}
