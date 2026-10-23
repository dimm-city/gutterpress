/**
 * Publishing plugins (EXPERIMENTAL, #381 — may change or be removed).
 *
 * A publishing plugin is an ordinary extension package flagged
 * `"gutterpress": { "publish": true }` whose entry exports a named `publish`
 * function ({@link PublishPluginFunction}). This module is the one place the
 * publish path learns about them:
 *   - discovery reads each enabled entry's package.json only — no import, no
 *     restore, no network — so listing destinations can never break;
 *   - lookup by id restores the book's pins (a fresh clone has none of the
 *     files) and then finds the plugin;
 *   - the adapter makes a plugin a {@link PublishProvider} of kind "plugin",
 *     so run-publish, the CLI and the desktop routes treat it like any
 *     built-in.
 *
 * Built-in ids always win, and a built-in id never reaches the plugin path:
 * publishing to `itch` still loads no plugins and touches no network.
 *
 * Not a spec shim — experimental tooling. Removal: this file and its test,
 * the `publish` flag branches in extension-manifest.ts, markdown/plugins.ts,
 * extension-manager.ts and commands/ext.ts, the run-publish call, the docs.
 */
import { stat } from "node:fs/promises";
import path from "node:path";

import type { ResolvedExtensionConfig } from "../../schema/manifest.types.ts";
import { log } from "../../utils/logger.ts";
import { readExtensionMeta } from "../extension-manifest.ts";
import { loadManifestWithPath, resolveConfig } from "../manifest.ts";
import type { PublishPluginLocation } from "../markdown/plugins.ts";
import { resolveVendoredPluginInstallRoot, vendoredNpmPluginPackageDir } from "../plugin-vendor.ts";
import { listPublishProviders, publishProviderFor } from "./registry.ts";
import type {
  PublishPluginFunction,
  PublishPluginResult,
  PublishProvider,
  PublishProviderInfo,
} from "./types.ts";

/** The book whose `extensions:` are searched — the pair runPublish takes. */
export interface PublishBook {
  projectDir: string;
  manifestPath?: string;
}

interface Publisher extends PublishPluginLocation {
  id: string;
  description?: string;
}

interface BookExtensions {
  baseDir: string;
  extensions: ResolvedExtensionConfig[];
}

/** The two manifest keys core reads from a `publish.<id>` section; a plugin
 *  gets the rest. */
const RESERVED_SETTINGS = new Set(["format", "credential"]);

const isBuiltIn = (id: string) => listPublishProviders().some((p) => p.id === id);
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function bookExtensions(book: PublishBook): Promise<BookExtensions> {
  const { manifest, manifestDir } = await loadManifestWithPath(book.manifestPath ?? book.projectDir, {
    explicit: book.manifestPath !== undefined,
  });
  return { baseDir: manifestDir, extensions: resolveConfig({}, manifest).extensions };
}

/** Where the entry's package sits when it is on disk; `null` otherwise.
 *  Never throws. */
async function locate(config: ResolvedExtensionConfig, baseDir: string): Promise<PublishPluginLocation | null> {
  try {
    if (config.path) {
      const dir = path.resolve(baseDir, config.path);
      return (await stat(dir)).isDirectory() ? { dir, installRoot: null, ref: config.use } : null;
    }
    if (!config.name || !config.version) return null;
    const installRoot = await resolveVendoredPluginInstallRoot(baseDir, config.name, config.version);
    return installRoot
      ? { dir: vendoredNpmPluginPackageDir(installRoot, config.name), installRoot, ref: config.use }
      : null;
  } catch {
    return null;
  }
}

/** The book's enabled publishers, in manifest order. A name that is already
 *  a destination is skipped with a warning. */
async function discover({ baseDir, extensions }: BookExtensions): Promise<Publisher[]> {
  const found: Publisher[] = [];
  for (const config of extensions) {
    const location = await locate(config, baseDir);
    if (!location) continue;
    const meta = await readExtensionMeta(location.dir);
    if (!meta.publish) continue;
    const id = config.path ? meta.name?.trim() : config.name;
    if (!id) {
      log.warn(`Publishing plugin "${config.use}" is skipped: its package.json has no "name".`);
      continue;
    }
    if (isBuiltIn(id) || found.some((p) => p.id === id)) {
      log.warn(`Publishing plugin "${id}" is skipped: a publish destination already has that name.`);
      continue;
    }
    const description = meta.description?.trim();
    found.push({ id, ...(description ? { description } : {}), ...location });
  }
  return found;
}

/** Built-in providers, then the book's enabled publishing plugins. Reads
 *  package.json only; a book whose manifest can't be read lists the built-ins. */
export async function listBookPublishProviders(book: PublishBook): Promise<PublishProviderInfo[]> {
  const plugins = await bookExtensions(book).then(discover, () => []);
  return [...listPublishProviders(), ...plugins.map(infoFor)];
}

/**
 * The provider for `id`: a built-in (exactly as `publishProviderFor`), else
 * one of the book's publishing plugins. An npm entry of that name is restored
 * first, so a fresh clone can publish. Throws on an unknown id, naming every
 * destination the book has.
 */
export async function resolvePublishProvider(id: string, book: PublishBook): Promise<PublishProvider> {
  if (isBuiltIn(id)) return publishProviderFor(id);
  const ext = await bookExtensions(book);
  const npmEntry = ext.extensions.some((c) => !c.path && c.name === id);
  if (npmEntry) {
    // Imported here so `--list` and a built-in publish never load the
    // installer graph. The restore's "Downloaded …" lines go to stderr, which
    // the desktop host discards; its failure message reaches the author.
    const { restoreForCommand } = await import("../extension-restore.ts");
    await restoreForCommand(book.projectDir, { manifestPath: book.manifestPath, failFast: true });
  }
  const publishers = await discover(ext);
  const publisher = publishers.find((p) => p.id === id);
  if (publisher) return pluginProvider(publisher);
  if (npmEntry) {
    throw new Error(
      `"${id}" is in this book's extensions but is not a publishing plugin ` +
        `(its package.json has no "gutterpress": { "publish": true }).`,
    );
  }
  const known = [...listPublishProviders().map((p) => p.id), ...publishers.map((p) => p.id)].join(", ");
  throw new Error(`Unknown publish provider "${id}". Available: ${known}.`);
}

/** An http(s) URL, normalised; anything else is dropped — `--open` hands it
 *  to the OS. */
function httpUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function infoFor(p: Publisher): PublishProviderInfo {
  return {
    id: p.id,
    label: p.id,
    kind: "plugin",
    format: "pdf",
    formats: ["pdf", "html"],
    description: p.description ?? "Publishing plugin",
    // No settings form yet: settings are edited in the manifest.
    configFields: [],
    // The plugin owns its credentials; core stores none for it.
    credential: { required: false, host: "" },
    experimental: true,
  };
}

function pluginProvider(p: Publisher): PublishProvider {
  let loading: Promise<PublishPluginFunction> | undefined;
  // Imported here so a built-in publish never loads the markdown-it loader.
  const load = () => (loading ??= import("../markdown/plugins.ts").then((m) => m.loadPublishFunction(p)));

  return {
    info: infoFor(p),
    async authenticate() {
      return { ok: true };
    },
    // Loading here makes --dry-run meaningful and reports a broken plugin as
    // a preflight error, which reaches the author verbatim.
    async preflight() {
      try {
        await load();
      } catch (e) {
        return [
          {
            severity: "error",
            id: "plugin/load-failed",
            message: `Publishing plugin "${p.id}" could not be loaded: ${messageOf(e)}`,
          },
        ];
      }
      return [
        {
          severity: "info",
          id: "plugin/experimental",
          message: `${p.id} is an experimental publishing plugin.`,
        },
      ];
    },
    async upload(req) {
      const publish = await load();
      const onProgress = req.deps.onProgress ?? (() => {});
      const { format, path: artifactPath } = req.artifact;
      const settings = Object.fromEntries(Object.entries(req.config).filter(([k]) => !RESERVED_SETTINGS.has(k)));
      let returned: PublishPluginResult | void;
      try {
        returned = await publish(format === "html" ? artifactPath : path.dirname(artifactPath), {
          project: { dir: req.project.projectDir, title: req.project.title, authors: [...req.project.authors] },
          artifact: { format, path: artifactPath },
          settings,
          log: (message) => onProgress(String(message)),
        });
      } catch (e) {
        throw new Error(`Publishing plugin "${p.id}": ${messageOf(e)}`);
      }
      const result: PublishPluginResult = returned && typeof returned === "object" ? returned : {};
      const url = httpUrl(result.url);
      const detail = typeof result.detail === "string" && result.detail ? result.detail : undefined;
      return { kind: "published", ...(url ? { url } : {}), ...(detail ? { detail } : {}) };
    },
  };
}
