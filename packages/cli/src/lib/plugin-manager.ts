/**
 * Plugin manager (#30) — read / write / toggle the project manifest's plugin
 * list, import plugins (local folder/file or npm package name), and validate
 * each configured plugin by attempting to LOAD it through the existing lib
 * loader (CLAUDE.md §5: plain markdown-it plugins, fail-fast loader, NO
 * auto-install).
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
 * with). This module is host-side (node:fs); the renderer reaches it via IPC.
 *
 * Bundle-safety (CLAUDE.md §1/§3): no runtime package.json reads, no
 * computed-path dynamic imports, no bundlers. Validation reuses `loadPlugin`
 * from `markdown/plugins.ts`, which already compiles under `bun build --compile`.
 */
import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { parseDocument, isSeq, isMap, isScalar, YAMLMap, YAMLSeq, Scalar } from "yaml";
import type { Node, Document } from "yaml";
import { loadPlugin } from "./markdown/plugins";
import type { ResolvedPluginConfig } from "../schema/manifest.types";

/** Folder (relative to the project root) imported local plugins are copied to. */
export const PLUGINS_DIR = "plugins";

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
  /** One-line author-friendly description. */
  description: string;
  /**
   * True when print-md ships this plugin (see `BUILTIN_OPTIONAL_PLUGINS`):
   * "Add" enables it instantly, no install, works offline. All entries below
   * are built-in — the always-on defaults (attrs/footnote/deflist, applied
   * unconditionally in renderer.ts) are intentionally NOT listed here, since
   * recommending the author "add" something already active is pure confusion.
   */
  builtin: true;
}

/**
 * Curated, BUILT-IN opt-in markdown features. Each is bundled with print-md
 * (`BUILTIN_OPTIONAL_PLUGINS`), so clicking "Add" writes the manifest entry AND
 * the feature works immediately — no terminal, no install, offline. This is the
 * non-technical-author happy path: "turn on a feature → it works".
 */
export const RECOMMENDED_PLUGINS: RecommendedPlugin[] = [
  {
    name: "markdown-it-mark",
    description: "Highlighted text with `==marked==` → `<mark>`.",
    builtin: true,
  },
  {
    name: "markdown-it-sub",
    description: "Subscript text with `H~2~O`.",
    builtin: true,
  },
  {
    name: "markdown-it-sup",
    description: "Superscript text with `29^th^`.",
    builtin: true,
  },
  {
    name: "markdown-it-abbr",
    description: "Abbreviations: define `*[HTML]: Hyper Text…` and get `<abbr>` tooltips.",
    builtin: true,
  },
];

/** A string entry like `./x` or `/x` or `C:\x` is a local file path. */
function isLocalRef(ref: string): boolean {
  return (
    ref.startsWith("./") ||
    ref.startsWith("../") ||
    ref.startsWith("/") ||
    /^[a-zA-Z]:[\\/]/.test(ref)
  );
}

/** Resolve `manifest.yaml`/`.yml` inside a project dir; prefers an existing file. */
function manifestPathFor(projectDir: string): string {
  const yaml = path.join(projectDir, "manifest.yaml");
  const yml = path.join(projectDir, "manifest.yml");
  if (!existsSync(yaml) && existsSync(yml)) return yml;
  return yaml;
}

/** Load the manifest as a yaml Document (empty doc when absent). */
async function loadDoc(projectDir: string): Promise<{ doc: Document.Parsed; file: string }> {
  const file = manifestPathFor(projectDir);
  let text = "";
  try {
    text = await readFile(file, "utf8");
  } catch {
    text = "";
  }
  return { doc: parseDocument(text), file };
}

/** The `plugins:` sequence node, creating it if missing. */
function ensurePluginsSeq(doc: Document.Parsed): YAMLSeq {
  let seq = doc.get("plugins", true);
  if (!isSeq(seq)) {
    const fresh = new YAMLSeq(doc.schema);
    doc.set("plugins", fresh);
    seq = fresh;
  }
  return seq as YAMLSeq;
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
 */
export async function listProjectPlugins(
  projectDir: string,
): Promise<ProjectPluginEntry[]> {
  const { doc } = await loadDoc(projectDir);
  const seq = doc.get("plugins", true);
  if (!isSeq(seq)) return [];

  const out: ProjectPluginEntry[] = [];
  for (const item of seq.items as Node[]) {
    const ref = itemRef(item);
    if (!ref) continue;
    let enabled = true;
    if (isMap(item)) {
      const e = item.get("enabled");
      if (e === false) enabled = false;
    }
    out.push({ ref, kind: refKind(ref), enabled });
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
  const { doc, file } = await loadDoc(projectDir);
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
    seq.items[idx] = map as unknown as Node;
  }

  if (enabled) {
    // Re-enabling: drop the flag so the entry reads cleanly (enabled is default).
    map.delete("enabled");
  } else {
    map.set("enabled", false);
  }

  await writeFile(file, doc.toString(), "utf8");
}

/** Append a plugin item (scalar or map) to the manifest's plugins list. */
async function appendPlugin(
  projectDir: string,
  ref: string,
  item: unknown,
): Promise<void> {
  const { doc, file } = await loadDoc(projectDir);
  const seq = ensurePluginsSeq(doc);
  if (indexOfRef(seq, ref) >= 0) return; // idempotent — already present
  seq.add(item);
  await mkdir(projectDir, { recursive: true });
  await writeFile(file, doc.toString(), "utf8");
}

/**
 * Add an npm-package plugin by NAME to the manifest. Per §5 this does NOT
 * install anything — it only records the manifest entry. The UI surfaces
 * whether the package resolves via {@link validateProjectPlugins}.
 */
export async function addNpmPlugin(
  projectDir: string,
  packageName: string,
): Promise<ProjectPluginEntry> {
  const name = packageName.trim();
  if (!name) throw new Error("A package name is required.");
  if (isLocalRef(name)) {
    throw new Error(
      `"${name}" looks like a path. Use addLocalPlugin to import a local plugin.`,
    );
  }
  await appendPlugin(projectDir, name, new Scalar(name));
  return { ref: name, kind: "npm", enabled: true };
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

  if (info.isDirectory()) {
    await cp(sourcePath, dest, { recursive: true });
  } else {
    await cp(sourcePath, dest);
  }

  const relPath = `./${PLUGINS_DIR}/${base}`;
  await appendPlugin(projectDir, relPath, new Scalar(relPath));
  return { ref: relPath, kind: "local", enabled: true, path: relPath };
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
        ? { path: entry.ref, priority: 100, options: {} }
        : { name: entry.ref, priority: 100, options: {} };
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
