import { existsSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { link, unlink } from "node:fs/promises";
import { isBuiltin } from "node:module";
import { resolve, join, dirname, basename, extname, isAbsolute, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { ResolvedExtensionConfig } from "../../schema/manifest.types";
import {
  isExactNpmVersion,
  isValidNpmPackageName,
  packageResolutionTargets,
  resolvePackageEntry,
  resolveVendoredPluginInstallRoot,
  safePackageTarget,
  vendoredNpmPluginPackageDir,
} from "../plugin-vendor";
// #239: the SAME declared-stylesheet resolver a theme's `styles` resolve
// through (extension-manager.ts) — see
// resolvePluginStyles's doc comment below for why this is the literal
// convergence point, not a parallel re-implementation.
import { resolveDeclaredStyles } from "../style-declarations";
// #241/#276 — a path entry may name an EXTENSION FOLDER (a package.json
// package) instead of a bare JS file. See loadExtensionFromDir below;
// everything else in this file is unchanged.
import {
  type ExtensionMetadata,
  readExtensionMeta,
  assertExtensionContained,
  resolveExtension,
} from "../extension-manifest";

// The plugin author API + the markdown-it factory live in the node-free
// `renderer.ts` so a future browser build can import the pure render core.
// This node-coupled module is the plugin *loader* (`node:fs`/`node:path`/
// `node:url`). The types/values are re-exported below so existing
// callers (`import { applyPlugins, ... } from "./plugins"`) are unaffected.
import type {
  GutterpressMarkerTable,
  GutterpressPlugin,
  GutterpressPluginMetadata,
  LoadedPlugin,
} from "./renderer";
export type {
  GutterpressMarkerDeclaration,
  GutterpressMarkerLabel,
  GutterpressMarkerTable,
  GutterpressPlugin,
  GutterpressPluginMetadata,
  GutterpressPluginExport,
  LoadedPlugin,
} from "./renderer";
export { applyPlugins, collectPluginCss, collectPluginStylePaths, collectPluginStyleGroups } from "./renderer";
export type { PluginStyleGroup } from "./renderer";
import { BUILTIN_OPTIONAL_PLUGINS, collectPluginStyleGroups, collectPluginStylePaths, type PluginStyleGroup } from "./renderer";

/** An imported npm plugin module, plus the directory `styles` (#238) should
 * resolve relative to — `null` when no reliable module directory exists (the
 * bare gutterpress-own-dependency fallback below), in which case a plugin
 * declaring `styles` fails loudly rather than resolving against a guess. */
interface LoadedNpmPackage {
  module: unknown;
  moduleDir: string | null;
  /** The package's root folder — where its `package.json` sits (#265, #276).
   *  `null` for a bare-specifier import, which retains no on-disk path. */
  packageDir: string | null;
  /** The entry module that was imported, when its path is known. */
  entryPath: string | null;
}

// ── Compiled-binary resolver (Bun standalone executables only) ──────────────
//
// A `bun build --compile` binary resolves bare specifiers from on-disk modules
// with its own resolver, and that resolver cannot find a dependency whose
// package.json carries an `exports` map ("Cannot find package 'highlight.js'
// from …/markdown-it-highlightjs/dist/index.js") — the same vendored tree loads
// fine under `bun run` and under Node (the desktop host). So, for importers
// inside a vendored plugin tree the loader has opened, this runtime plugin
// answers bare requests itself: walk the nested `node_modules` the way Node
// does, honour `exports` with the installer's own helper, hand back the file.
// Anything it cannot resolve falls through to Bun's resolver unchanged, and
// nothing outside a vendored tree is ever touched. Node never sees it.

interface BunRuntime {
  plugin?(plugin: {
    name: string;
    setup(build: {
      onResolve(
        options: { filter: RegExp },
        callback: (args: { path: string; importer: string; kind: string }) => { path: string } | undefined,
      ): void;
    }): void;
  }): void;
}

const vendoredRootsOpened = new Set<string>();
let bunVendoredResolverInstalled = false;

function isInsideDir(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(root.endsWith(sep) ? root : root + sep);
}

/** Node-style bare-specifier resolution from `fromDir`, confined to `stopRoot`. */
function resolveBareSpecifierSync(
  specifier: string,
  fromDir: string,
  stopRoot: string,
  condition: "import" | "require",
): string | null {
  const parts = specifier.split("/");
  const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
  const subpath = specifier.slice(name.length).replace(/^\//, "");
  for (let dir = fromDir; isInsideDir(dir, stopRoot); dir = dirname(dir)) {
    const packageDir = join(dir, "node_modules", ...name.split("/"));
    const packageJson = join(packageDir, "package.json");
    if (!existsSync(packageJson)) {
      if (dir === stopRoot) break;
      continue;
    }
    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(readFileSync(packageJson, "utf8")) as Record<string, unknown>;
    } catch {
      return null;
    }
    for (const target of packageResolutionTargets(manifest, subpath, condition)) {
      const rel = safePackageTarget(target.target);
      if (!rel) continue;
      const base = resolve(packageDir, ...rel.split("/"));
      if (!isInsideDir(base, packageDir)) continue;
      const candidates = target.exact
        ? [base]
        : [base, `${base}.mjs`, `${base}.js`, `${base}.cjs`, `${base}.json`, join(base, "index.mjs"), join(base, "index.js"), join(base, "index.cjs")];
      for (const candidate of candidates) {
        try {
          if (statSync(candidate).isFile()) return candidate;
        } catch {
          // next candidate
        }
      }
    }
    return null;
  }
  return null;
}

function installBunVendoredResolver(): void {
  if (bunVendoredResolverInstalled) return;
  bunVendoredResolverInstalled = true;
  const bun = (globalThis as { Bun?: BunRuntime }).Bun;
  if (typeof bun?.plugin !== "function") return;
  bun.plugin({
    name: "gutterpress-vendored-plugins",
    setup(build) {
      build.onResolve({ filter: /^[^./]/ }, (args) => {
        if (!args.importer || isAbsolute(args.path) || /^[a-z]+:/i.test(args.path) || isBuiltin(args.path)) {
          return undefined;
        }
        let root: string | undefined;
        for (const opened of vendoredRootsOpened) {
          if (isInsideDir(args.importer, opened)) {
            root = opened;
            break;
          }
        }
        if (!root) return undefined;
        const resolved = resolveBareSpecifierSync(
          args.path,
          dirname(args.importer),
          root,
          args.kind === "require-call" || args.kind === "require-resolve" ? "require" : "import",
        );
        return resolved ? { path: resolved } : undefined;
      });
    },
  });
}

/**
 * Resolve and import an npm plugin package.
 *
 * Resolution order:
 *   1. The project-local vendored copy `gutterpress ext add` installed
 *      (`plugins/npm/<name>/<version>/`), when the entry is pinned and that
 *      folder exists
 *   2. User's project node_modules (legacy unpinned entries)
 *   3. gutterpress's own dependencies — for built-in/legacy plugins
 *
 * Loading never performs network access. Installation is an explicit
 * `addExtension` action which vendors first and records an exact version.
 */
async function loadNpmPackage(
  packageName: string,
  baseDir: string,
  version?: string,
): Promise<LoadedNpmPackage> {
  // A pinned entry loads from its vendored copy — a plain nested npm tree, so
  // a dynamic `import()` of the package entry is all it takes: Node (and Bun —
  // this is a runtime path, nothing for a bundler to embed) resolves the
  // package's own imports/requires through its `node_modules` the ordinary
  // way, and `import()` loads a CommonJS entry as readily as an ESM one. The
  // one exception is the compiled CLI binary, whose resolver needs the small
  // runtime plugin above for `exports`-bearing dependencies. The folder is
  // authoritative once present: a broken
  // copy is an error pointing at reinstall, never a silent fall-through to
  // some other package of the same name. A pinned entry with NO vendored
  // folder falls through to the legacy lookups below and ends at the "not
  // found — install it" error, which is what the desktop's Features tab
  // surfaces as "Needs install".
  if (version && isValidNpmPackageName(packageName) && isExactNpmVersion(version)) {
    const installRoot = await resolveVendoredPluginInstallRoot(baseDir, packageName, version);
    if (installRoot) {
      const packageDir = vendoredNpmPluginPackageDir(installRoot, packageName);
      let entry: string;
      try {
        entry = await resolvePackageEntry(packageDir);
      } catch (cause) {
        throw new Error(
          `the downloaded copy of ${packageName}@${version} under plugins/npm/ is incomplete ` +
            `(${cause instanceof Error ? cause.message : String(cause)}). ` +
            `Reinstall it with \`gutterpress ext add ${packageName}@${version}\`.`,
          { cause },
        );
      }
      const entryPath = join(packageDir, ...entry.split("/"));
      vendoredRootsOpened.add(installRoot);
      installBunVendoredResolver();
      return {
        module: await import(pathToFileURL(entryPath).href),
        moduleDir: dirname(entryPath),
        packageDir,
        entryPath,
      };
    }
  }

  // Legacy unpinned entry: user's project (manifest dir).
  try {
    const packageDir = join(baseDir, "node_modules", ...packageName.split("/"));
    const packagePath = join(packageDir, ...(await resolvePackageEntry(packageDir)).split("/"));
    return {
      module: await import(pathToFileURL(packagePath).href),
      moduleDir: dirname(packagePath),
      packageDir,
      entryPath: packagePath,
    };
  } catch {
    // Not in user's project — fall through
  }

  // gutterpress's own dependencies. No on-disk path is retained here (a bare
  // specifier import), so `moduleDir: null` — see LoadedNpmPackage's doc.
  try {
    return { module: await import(packageName), moduleDir: null, packageDir: null, entryPath: null };
  } catch {
    // Not found — fall through to error
  }

  // A bare filename that already ends in a JS extension (e.g. `my-plugin.js`)
  // is refused by the manifest parser (extension-specifier.ts) but can still
  // reach here through a direct loader call as a "package name". Templating
  // the generic `./plugins/<name>.js`
  // suggestion onto a name that ALREADY has an extension produces a mangled
  // `my-plugin.js.js` double-extension path that can never work — suggest
  // the working fix (just add `./`) instead.
  const looksLikeJsFilename = /\.(m?js|cjs)$/i.test(packageName);
  const suggestedPath = looksLikeJsFilename
    ? `./${packageName}`
    : `./plugins/${packageName}.js`;

  throw new Error(
    `Extension "${packageName}" not found. Install it with ` +
      `\`gutterpress ext add ${packageName}\` (or Book settings > Features > Advanced in the desktop app),\n` +
      `or reference a local file under \`extensions:\`:\n` +
      `  extensions:\n` +
      `    - ${suggestedPath}`
  );
}

/**
 * Validate a plugin's raw `styles` export shape (#238). `undefined` (not
 * declared) and a non-empty string array both pass through unremarkable; a
 * declared-but-empty array normalizes to `undefined` so downstream code has
 * one "nothing here" value to check. Anything else is an author mistake
 * caught at load time — a final artifact must never silently drop a
 * malformed `styles` export instead of erroring on it.
 */
function validateStylesExport(value: unknown, pluginRef: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((s) => typeof s === "string")) {
    throw new Error(
      `Plugin "${pluginRef}" exports \`styles\` that is not an array of strings.`,
    );
  }
  return value.length > 0 ? (value as string[]) : undefined;
}

/**
 * Validate a plugin's raw `markers` export shape (#240) — a LIGHT, top-level
 * check only: "is this a plain object at all?" The per-declaration shape
 * (tag/class/variants/label/autoCloseAt/alias/preset/deprecated) and every
 * cross-plugin collision are validated centrally by
 * `buildDeclaredMarkerRegistry` (markers.js), once every loaded plugin's
 * table is available — this function only guards against handing that
 * function something it cannot even iterate (`Object.entries` on a string or
 * an array would silently produce nonsense keys). Mirrors
 * {@link validateStylesExport}'s "undefined/empty both pass through as
 * undefined, anything malformed throws now" shape.
 */
function validateMarkersExport(value: unknown, pluginRef: string): GutterpressMarkerTable | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(
      `Plugin "${pluginRef}" exports \`markers\` that is not a plain object.`,
    );
  }
  const table = value as GutterpressMarkerTable;
  return Object.keys(table).length > 0 ? table : undefined;
}

/**
 * Extract the plugin function from a loaded module, handling the various
 * shapes Node/Bun produce for ESM/CJS interop:
 *
 *   - ESM default export:           module.default
 *   - CJS `module.exports = fn`:    module.default (via interop) or module itself
 *   - Double-wrapped (rare):        module.default.default
 */
function extractPluginExports(
  pluginModule: unknown,
  pluginRef: string,
  exportName?: string,
): {
  plugin: GutterpressPlugin;
  metadata?: GutterpressPluginMetadata;
  css?: string;
  /** Author-declared, module-relative paths (#238) — NOT YET resolved to
   * absolute paths; the caller (`loadPlugin`) does that. */
  styles?: string[];
  /** Author-declared marker table (#240), unresolved — `createMarkdownRenderer`
   * (renderer.ts) merges it with every other loaded plugin's table. */
  markers?: GutterpressMarkerTable;
} {
  const mod = pluginModule !== null && (typeof pluginModule === "object" || typeof pluginModule === "function")
    ? pluginModule as Record<string, unknown>
    : {};
  let plugin: GutterpressPlugin | undefined;
  let metadata = mod.metadata as GutterpressPluginMetadata | undefined;
  let css = mod.css as string | undefined;
  let styles = validateStylesExport(mod.styles, pluginRef);
  let markers = validateMarkersExport(mod.markers, pluginRef);

  if (exportName && typeof mod[exportName] === "function") {
    plugin = mod[exportName] as GutterpressPlugin;
  } else if (exportName) {
    const available = Object.entries(mod)
      .filter(([, value]) => typeof value === "function")
      .map(([name]) => name)
      .sort();
    throw new Error(
      `Plugin "${pluginRef}" does not export a plugin function named "${exportName}".` +
        (available.length > 0 ? ` Available function exports: ${available.join(", ")}.` : ""),
    );
  } else if (typeof mod.default === "function") {
    plugin = mod.default as GutterpressPlugin;
  } else if (typeof pluginModule === "function") {
    plugin = pluginModule as GutterpressPlugin;
  } else if (
    typeof mod.default === "object" &&
    mod.default !== null &&
    typeof (mod.default as Record<string, unknown>).default === "function"
  ) {
    const inner = mod.default as Record<string, unknown>;
    plugin = inner.default as GutterpressPlugin;
    metadata = (inner.metadata as GutterpressPluginMetadata | undefined) ?? metadata;
    css = (inner.css as string | undefined) ?? css;
    styles = validateStylesExport(inner.styles, pluginRef) ?? styles;
    markers = validateMarkersExport(inner.markers, pluginRef) ?? markers;
  }

  if (typeof plugin !== "function") {
    throw new Error(
      `Plugin "${pluginRef}" does not export a valid plugin function. ` +
        `Expected \`export default function (md, options) { ... }\` ` +
        `or CommonJS \`module.exports = function (md, options) { ... }\`.`
    );
  }

  return { plugin, metadata, css, styles, markers };
}

/**
 * Path-plugin ESM cache — keyed by resolved absolute file path, and only
 * reused while the file's mtime matches the cached entry. Bun/Node never
 * evict ESM module-map entries, so unconditionally busting on every load
 * (`?v=${Date.now()}`) would reload every path-plugin on every preview render
 * and leak a fresh module instance forever in the long-lived Electron host.
 * Keying on mtime means an untouched file is served from cache (bounded
 * growth, proportional to distinct plugin paths — not load count) while an
 * edited file is still always reloaded.
 */
interface CachedPathPlugin {
  mtimeMs: number;
  module: unknown;
  /** The hard-linked shadow file this module was loaded from, if any. */
  shadowPath: string | null;
}
const pathPluginCache = new Map<string, CachedPathPlugin>();

/** Test-only: reset the path-plugin cache between test cases. */
export function __resetPathPluginCacheForTests(): void {
  pathPluginCache.clear();
}

// A query string is NOT a reliable cache-buster here: Node keys its ESM
// module registry by the full URL (query included), but Bun's local `file://`
// loader resolves the cache key by REAL PATH and ignores query/hash strings
// entirely — confirmed empirically: neither a `?v=` query nor a symlink
// pointing at the edited file busts it (Bun follows symlinks to their
// realpath before the registry lookup). Since the standalone CLI binary
// (`bun build --compile`, §1) runs on Bun's own embedded runtime for real
// end users of `gutterpress preview`, a query-only bust would silently never
// take effect there. A hard link IS a distinct realpath (unlike a symlink, it
// has no "target" to resolve through), so importing a same-directory shadow
// hard link named by mtime forces a genuinely fresh module on BOTH runtimes,
// with zero content duplication, while same-directory placement preserves
// the plugin's own relative imports (resolved against the importing
// module's real directory, which the shadow link shares with the original).
const liveShadowPaths = new Set<string>();
let exitCleanupRegistered = false;
function ensureExitCleanupRegistered(): void {
  if (exitCleanupRegistered) return;
  exitCleanupRegistered = true;
  process.on("exit", () => {
    for (const shadowPath of liveShadowPaths) {
      try {
        unlinkSync(shadowPath);
      } catch {
        // best effort — nothing to do if it's already gone
      }
    }
  });
}

/**
 * The shadow-link name carries the PROCESS id, not just the plugin's mtime.
 *
 * With an mtime-only name the path would be fully deterministic, so two
 * preview processes rendering different books that SHARE one authored plugin
 * — `path: ../../shared/plugins/x.js`, the normative multi-book layout — would
 * compute the SAME shadow path. The first `link()` wins; the loser hits EEXIST
 * and falls through to a plain `import(pluginPath)`, cached under the NEW
 * mtime so it is never retried. The ESM registry never evicts, so from the
 * second collision onward that fallback answers with the PREVIOUS module: the
 * author edits a shared plugin and one of their two open books keeps
 * rendering the old one, silently and permanently.
 */
function shadowPathFor(pluginPath: string, mtimeMs: number): string {
  const ext = extname(pluginPath);
  const stem = basename(pluginPath, ext);
  const token = String(mtimeMs).replace(/\./g, "-");
  return join(
    dirname(pluginPath),
    `.${stem}.gutterpress-reload-${process.pid}-${token}${ext}`,
  );
}

/**
 * Import a file-based plugin module, reusing a previous import when the file
 * is unchanged (resolved path + mtime) and forcing a genuinely fresh import
 * (via a same-directory hard-link shadow file, see above) only when the
 * file's mtime has moved since the last load. The previous shadow link is
 * removed once the new one has loaded successfully.
 */
async function loadCachedPathPluginModule(pluginPath: string): Promise<unknown> {
  const mtimeMs = statSync(pluginPath).mtimeMs;
  const cached = pathPluginCache.get(pluginPath);
  if (cached && cached.mtimeMs === mtimeMs) {
    return cached.module;
  }

  const shadowPath = shadowPathFor(pluginPath, mtimeMs);
  let pluginModule: unknown;
  let shadowActive = false;
  try {
    await link(pluginPath, shadowPath);
    shadowActive = true;
    ensureExitCleanupRegistered();
    liveShadowPaths.add(shadowPath);
    pluginModule = await import(pathToFileURL(shadowPath).href);
  } catch (error) {
    if (shadowActive) {
      // The shadow link was created but the import itself failed (e.g. a
      // syntax error in the edited plugin) — clean up and propagate the real
      // error rather than silently falling back.
      liveShadowPaths.delete(shadowPath);
      await unlink(shadowPath).catch(() => {});
      throw error;
    }
    // Could not even create the shadow link (read-only directory, or a stale
    // link of the same name left by a crashed prior process) — fall back to
    // a plain, uncached import so the load still succeeds when possible.
    pluginModule = await import(pathToFileURL(pluginPath).href);
  }

  const previousShadow = cached?.shadowPath;
  pathPluginCache.set(pluginPath, {
    mtimeMs,
    module: pluginModule,
    shadowPath: shadowActive ? shadowPath : null,
  });
  if (previousShadow) {
    liveShadowPaths.delete(previousShadow);
    await unlink(previousShadow).catch(() => {});
  }
  return pluginModule;
}

/**
 * Load a single plugin from a file path or npm package.
 *
 * Throws if the plugin cannot be resolved, imported, or doesn't export a
 * valid plugin function. The error message identifies which manifest entry
 * failed so users can find it.
 *
 * Path plugins always go through the mtime cache (see the call below): it is
 * correct in both a one-shot CLI build and the long-lived Electron host that
 * runs `runBuild` in-process, so no caller-selected cache mode is needed.
 */
/**
 * Resolve a plugin's declared `styles` (#238) to absolute, existence-checked
 * paths, relative to `moduleDir` (the plugin's own file/package directory).
 * `undefined`/`[]` input returns `undefined` — a plugin with no `styles`
 * export pays zero cost here. A `moduleDir` of `null` (the bare
 * gutterpress-own-dependency npm fallback — see `LoadedNpmPackage`) is a
 * plugin-specific failure checked here; the existence check on each declared
 * file is NOT plugin-specific — that half is
 * {@link resolveDeclaredStyles} (`style-declarations.ts`), the SAME function
 * `extension-manager.ts`'s `addExtension`/`readExtensionCss` resolve an
 * theme's `styles` through (#239). This is the literal
 * code-sharing that makes a theme and a styles-carrying plugin resolve their
 * declared stylesheets identically, not through two parallel
 * implementations that could drift.
 */
function resolvePluginStyles(
  rawStyles: string[] | undefined,
  moduleDir: string | null,
  pluginRef: string,
): string[] | undefined {
  if (!rawStyles || rawStyles.length === 0) return undefined;
  if (!moduleDir) {
    throw new Error(
      `Plugin "${pluginRef}" exports \`styles\` but its module directory could not be resolved.`,
    );
  }
  return resolveDeclaredStyles(rawStyles, moduleDir, `Plugin "${pluginRef}"`);
}

/** A path entry that names a directory rather than a bare JS
 *  file loads no markdown-it function of its own — every author-visible
 *  effect of loading it is its declared styles (#241's "theme ≡ extension
 *  with only styles" realized through the `extensions:` list: a folder with
 *  NO `markdown` is functionally indistinguishable from a look added
 *  through `gutterpress ext add`, right down to reusing the same
 *  metadata reader). `md.use()` on a no-op is harmless — every consumer of
 *  `LoadedPlugin` (`applyPlugins`, `collectPluginCss`,
 *  `collectPluginStylePaths`) keeps working unmodified. */
function noopPlugin(): void {}

/** Build a `LoadedPlugin.metadata` object from a `package.json`'s own
 *  `name`/`description`/`author` — `undefined` when none are set, matching
 *  every other optional-metadata contract in this file. */
function extensionMetadata(meta: ExtensionMetadata): GutterpressPluginMetadata | undefined {
  if (!meta.name && !meta.description && !meta.author) return undefined;
  return {
    ...(meta.name ? { name: meta.name } : {}),
    ...(meta.description ? { description: meta.description } : {}),
    ...(meta.author ? { author: meta.author } : {}),
  };
}

/**
 * The migration line appended to the "declares nothing" error when the folder
 * still carries a pre-0.10.10 `gutterpress.json`/`theme.json`. Gutterpress no
 * longer reads either file, so an author whose look suddenly stops loading
 * needs to see the file that is being ignored AND the package.json shape that
 * replaces it — not just "there is nothing to load".
 */
function staleManifestHint(dir: string): string {
  const stale = ["gutterpress.json", "theme.json"].find((name) =>
    existsSync(join(dir, name)),
  );
  if (!stale) return "";
  return (
    `\n\nThis folder still has a ${stale}. Gutterpress no longer reads it — ` +
    "describe the extension in package.json instead:\n" +
    "  {\n" +
    '    "name": "my-extension",\n' +
    '    "description": "What it does",\n' +
    '    "author": "You",\n' +
    '    "main": "plugin.js",\n' +
    '    "gutterpress": { "styles": ["theme.css"] }\n' +
    "  }\n" +
    "(`main` only if the package carries a markdown-it plugin; " +
    "`gutterpress.styles` only if it carries stylesheets.)"
  );
}

/**
 * Load a path entry (#241, #276) that names a DIRECTORY instead of a bare JS
 * file — an extension package described by its `package.json`: a markdown-it
 * entry (`extensionEntry` in extension-manifest.ts: `gutterpress.markdown`, else npm's own
 * `main`) loaded exactly like a bare-file plugin (same cache, same export
 * extraction, same `styles` export handling), and `gutterpress.styles`
 * (resolved through the SAME {@link resolveExtension} →
 * `resolveDeclaredStyles` chain a look's own declared sheets and a plain
 * plugin's `styles` export already go through).
 *
 * No entry is the "styles only" case — see {@link noopPlugin}. An entry
 * present is "plugin ≡ extension with only markdown" PLUS whatever styles the
 * SAME package.json also declares: the extension's own styles are ordered
 * BEFORE the loaded module's own `styles` export (an author who wants the
 * module's own styles to win at equal specificity should rely on cascade
 * order within that module's CSS itself, exactly as they would for two files
 * in one plain `styles` export).
 *
 * `tokensFile`/`components`/`snippets` are parsed and validated (existence +
 * containment, via `resolveExtension`) but not otherwise consumed HERE —
 * `snippets.ts`'s `listMergedSnippets` (#242) is the actual snippet-picker
 * consumer, reached through its own `listInstalledExtensions` (which reads
 * `extension-manifest.ts`'s `readExtensionMeta` directly, tolerantly, rather
 * than through this throwing `resolveExtension` call); a `components.yaml`
 * catalog reader is the remaining consumer still to be built.
 */
async function loadExtensionFromDir(
  extensionDir: string,
  config: ResolvedExtensionConfig,
  pluginRef: string,
): Promise<LoadedPlugin> {
  const meta = await readExtensionMeta(extensionDir);
  assertExtensionContained(meta);
  const resolved = resolveExtension(extensionDir, meta, `Plugin "${pluginRef}"`);
  const extensionStyles = resolved.styles ?? [];
  const name = config.name ?? meta.name ?? pluginRef;

  // A folder with NEITHER a markdown-it entry NOR any styles declares nothing
  // at all — almost certainly a mistake (a `path:` meant for a bare JS file,
  // pointed at a folder instead; or a package with no package.json that was
  // never meant to be referenced this way). Fail loudly here rather than
  // silently succeeding as a no-op with no observable effect, matching this
  // loader's fail-fast doctrine everywhere else (CLAUDE.md §5).
  if (!resolved.markdown && extensionStyles.length === 0) {
    throw new Error(
      `Extension folder "${pluginRef}" declares no markdown-it plugin (\`main\`) and no ` +
        "`gutterpress.styles` in its package.json — there is nothing to load. Point " +
        "`path` at a JS file directly for a plain plugin, or describe the package in " +
        "package.json." + staleManifestHint(extensionDir),
    );
  }

  if (!resolved.markdown) {
    return {
      name,
      plugin: noopPlugin,
      ...(extensionMetadata(meta) ? { metadata: extensionMetadata(meta) } : {}),
      ...(extensionStyles.length > 0 ? { styles: extensionStyles } : {}),
      options: config.options,
    };
  }

  const pluginModule = await loadCachedPathPluginModule(resolved.markdown);
  const { plugin, metadata, css, styles: rawStyles, markers } = extractPluginExports(
    pluginModule,
    pluginRef,
    config.export,
  );
  const ownStyles = resolvePluginStyles(rawStyles, dirname(resolved.markdown), pluginRef);
  const styles = [...extensionStyles, ...(ownStyles ?? [])];

  return {
    name,
    plugin,
    // The plugin module's OWN `metadata` export wins when present (it is
    // more specific — describing the exact code that loaded); the folder's
    // package.json name/description/author is the fallback, not an override,
    // so a component library's package-level metadata still surfaces for a
    // `plugin.js` that exports none of its own.
    metadata: metadata ?? extensionMetadata(meta),
    css,
    ...(styles.length > 0 ? { styles } : {}),
    // #240 × #241: an extension folder's markdown entry declares `markers`
    // exactly as a bare-file plugin does, and `createMarkdownRenderer` builds
    // the declared-marker registry from `LoadedPlugin.markers`. Omitting it
    // here (the shape this function shipped with) silently dropped every
    // declared marker of any plugin loaded as a FOLDER — `@callout` parsed as
    // a plain paragraph, with no warning, while the identical module loaded
    // by a direct `path: …/plugin.js` worked. The two load paths must produce
    // the same LoadedPlugin.
    ...(markers ? { markers } : {}),
    options: config.options,
  };
}

export async function loadPlugin(
  config: ResolvedExtensionConfig,
  baseDir: string,
): Promise<LoadedPlugin> {
  const pluginRef = config.use;
  let pluginModule: unknown;
  let pluginName: string;
  /** Directory `styles` (#238) resolves relative to — see resolvePluginStyles. */
  let moduleDir: string | null = null;
  /** An npm package's own package.json metadata (#265, #276). */
  let packageMeta: ExtensionMetadata | undefined;
  let packageStyles: string[] = [];

  if (!config.path && !config.name) {
    throw new Error(
      "Plugin manifest entry must specify either `path` or `name`. " +
        "Got an empty plugin config."
    );
  }

  // Built-in opt-in plugins resolve from the bundled registry — no project
  // install, no network, works offline and in the compiled binary. This is the
  // happy path for the desktop's recommended plugins.
  if (
    !config.path &&
    !config.version &&
    config.name &&
    BUILTIN_OPTIONAL_PLUGINS[config.name]
  ) {
    return {
      name: config.name,
      plugin: BUILTIN_OPTIONAL_PLUGINS[config.name]!,
      options: config.options,
    };
  }

  // #241 — a `path` entry may name an EXTENSION FOLDER (a package.json
  // package) instead of a bare JS file. Dispatched here, before
  // the generic file-load try/catch below, because a folder produces a
  // structurally different LoadedPlugin (see loadExtensionFromDir) rather
  // than participating in the shared pluginModule/moduleDir plumbing that
  // follows. A path that does not exist at all, or exists as a plain file,
  // falls through unchanged to that existing code — this branch changes
  // behavior ONLY for a `path` that resolves to a real directory.
  if (config.path) {
    const candidatePath = resolve(baseDir, config.path);
    if (existsSync(candidatePath) && statSync(candidatePath).isDirectory()) {
      try {
        return await loadExtensionFromDir(candidatePath, config, pluginRef);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to load plugin "${pluginRef}": ${errorMsg}`);
      }
    }
  }

  try {
    if (config.path) {
      const pluginPath = resolve(baseDir, config.path);

      if (!existsSync(pluginPath)) {
        throw new Error(
          `Plugin file not found: ${pluginPath} ` +
            `(resolved from manifest entry path="${config.path}")`
        );
      }

      // Always route through the mtime cache. A bare
      // `import(pathToFileURL(...).href)` is NOT freshness-safe when the
      // process outlives one build: the desktop runs `runBuild` in-process in
      // the long-lived Electron host (a memoized lib import, never a child
      // process), so a second build/export in the same session would serve the
      // FIRST build's plugin module from Node's ESM registry (which never
      // evicts) — a stale-plugin regression. The mtime cache reloads on any
      // edit and reuses an untouched file, correct in both a one-shot CLI
      // build and the long-lived host.
      pluginModule = await loadCachedPathPluginModule(pluginPath);
      pluginName = config.name ?? config.path;
      // #238: `styles` resolves relative to the plugin's OWN file, wherever
      // that lives (in-project, or a multi-book repo's shared `plugins/`).
      moduleDir = dirname(pluginPath);
    } else {
      const loaded = await loadNpmPackage(config.name!, baseDir, config.version);
      pluginModule = loaded.module;
      moduleDir = loaded.moduleDir;
      pluginName = config.name!;
      // #265/#276 — every npm package has a package.json, so every npm
      // extension is read like any folder: its `gutterpress.styles` are
      // included (validated and contained through the same resolveExtension
      // chain a folder's go through) and its name/description/author back the
      // module's own metadata; its snippets reach the picker through
      // listProjectExtensions.
      //
      // The entry is NOT re-derived here: the installer already resolved it
      // with full `exports`/`main` semantics (resolvePackageEntry), so this
      // call is made WITHOUT `main` — the folder entry rule is switched off,
      // and only an EXPLICIT `gutterpress.markdown` is resolved. That field is
      // accepted only when it names the same file the package entry resolved
      // to, so a package cannot hand the loader a second, different plugin.
      if (loaded.packageDir) {
        const meta = await readExtensionMeta(loaded.packageDir);
        assertExtensionContained(meta);
        const resolved = resolveExtension(
          loaded.packageDir,
          { ...meta, main: undefined },
          `Plugin "${pluginRef}"`,
        );
        if (
          resolved.markdown &&
          loaded.entryPath &&
          resolve(resolved.markdown) !== resolve(loaded.entryPath)
        ) {
          throw new Error(
            `its package.json declares gutterpress.markdown "${meta.markdown}" but the package ` +
              `entry is "${relative(loaded.packageDir, loaded.entryPath)}" — an npm extension's ` +
              "markdown-it plugin is its package entry, so declare that file or drop the field.",
          );
        }
        packageMeta = meta;
        packageStyles = resolved.styles ?? [];
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load plugin "${pluginRef}": ${errorMsg}`);
  }

  const { plugin, metadata, css, styles: rawStyles, markers } = extractPluginExports(
    pluginModule,
    pluginRef,
    config.export,
  );
  const ownStyles = resolvePluginStyles(rawStyles, moduleDir, pluginRef);
  const styles =
    packageStyles.length > 0 ? [...packageStyles, ...(ownStyles ?? [])] : ownStyles;

  return {
    name: pluginName,
    plugin,
    // As in loadExtensionFromDir: the module's own `metadata` export wins,
    // the package's package.json is the fallback.
    metadata: metadata ?? (packageMeta ? extensionMetadata(packageMeta) : undefined),
    css,
    styles,
    markers,
    options: config.options,
  };
}

/**
 * Load all plugins from the resolved configuration.
 *
 * Two failure modes, selected by whether `onError` is supplied:
 *
 *   - **Fail-fast (no `onError`)** — the default for build/export/validate. If
 *     any plugin fails to load, the whole operation aborts with the underlying
 *     error. A final artifact must never silently omit author-configured
 *     formatting.
 *   - **Degrade-and-report (`onError` supplied)** — for the LIVE PREVIEW. A
 *     plugin that can't load (e.g. a vendored folder was omitted when a
 *     project was copied) is skipped, `onError` is invoked with the
 *     offending ref + error, and the rest of the document still renders. This
 *     is NOT silent skipping (the failure mode §5 warns against): the caller
 *     surfaces every skip loudly (preview warns in its log; the Plugins panel
 *     shows the plugin error with fix instructions).
 *
 * Path plugins are loaded through the mtime cache in `loadPlugin` regardless
 * of mode: an edited plugin reloads across renders while an
 * unedited one is never re-imported, correct in both a one-shot CLI build and
 * the long-lived Electron host.
 */
export async function loadPlugins(
  configs: ResolvedExtensionConfig[],
  baseDir: string,
  onError?: (pluginRef: string, error: Error) => void
): Promise<LoadedPlugin[]> {
  const plugins: LoadedPlugin[] = [];
  for (const config of configs) {
    if (!onError) {
      plugins.push(await loadPlugin(config, baseDir));
      continue;
    }
    try {
      plugins.push(await loadPlugin(config, baseDir));
    } catch (error) {
      onError(
        config.use,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }
  return plugins;
}

/** Result of {@link loadPluginsWithCss}: loaded plugins ready for `applyPlugins`
 * plus their CSS, grouped per extension for the renderer. */
export interface LoadedPluginsWithCss {
  /** `undefined` (not `[]`) when there were no configs to load — matches the
   * `plugins?:` field the renderer options expect, so callers can pass this
   * straight through without an `?? []` at every call site. */
  plugins: LoadedPlugin[] | undefined;
  /** Each extension's CSS — its stylesheet files and `css` export — in load
   * order, each destined for its own cascade layer (`renderChapters`). `[]`
   * when no loaded plugin has any. */
  pluginStyles: PluginStyleGroup[];
  /**
   * #238 — absolute paths of every plugin-declared `styles` file, flattened
   * in plugin load order. `[]` when no loaded plugin declares any (including
   * when `configs` was empty), so callers can pass this straight through to
   * `renderChapters`'s `pluginStylePaths` without an `?? []` guard.
   */
  pluginStylePaths: string[];
}

/**
 * Shared "load plugins -> collect their CSS" preamble for both real render
 * paths — build/export's fail-fast `renderBook` (build-runner.ts) and the
 * live preview's degrade-and-report `renderPreviewBook`
 * (preview/file-watcher.ts), which differ ONLY in whether `onError` is
 * supplied. `onError` presence selects fail-fast vs degrade-and-report (see
 * {@link loadPlugins}).
 *
 * A `configs` of `undefined`/empty short-circuits WITHOUT calling
 * `loadPlugins` at all (`plugins: undefined`, `pluginStyles: []`): nothing is
 * plugin-loaded when the manifest declares no plugins.
 */
export async function loadPluginsWithCss(
  configs: ResolvedExtensionConfig[] | undefined | null,
  baseDir: string,
  onError?: (pluginRef: string, error: Error) => void
): Promise<LoadedPluginsWithCss> {
  if (!configs || configs.length === 0) {
    return { plugins: undefined, pluginStyles: [], pluginStylePaths: [] };
  }
  const plugins = await loadPlugins(configs, baseDir, onError);
  return {
    plugins,
    pluginStyles: collectPluginStyleGroups(plugins),
    pluginStylePaths: collectPluginStylePaths(plugins),
  };
}
