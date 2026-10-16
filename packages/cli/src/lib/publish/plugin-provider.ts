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
 *   - the adapter makes a plugin a {@link PublishProvider}, so run-publish,
 *     the CLI and the desktop routes treat it like any built-in.
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

interface Publisher {
  id: string;
  description?: string;
  config: ResolvedExtensionConfig;
  /** The manifest's directory — what path entries and vendored copies resolve against. */
  baseDir: string;
}

interface BookExtensions {
  baseDir: string;
  extensions: ResolvedExtensionConfig[];
}

const isBuiltIn = (id: string) => listPublishProviders().some((p) => p.id === id);
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function bookExtensions(book: PublishBook): Promise<BookExtensions> {
  const { manifest, manifestDir } = await loadManifestWithPath(book.manifestPath ?? book.projectDir, {
    explicit: book.manifestPath !== undefined,
  });
  return { baseDir: manifestDir, extensions: resolveConfig({}, manifest).extensions };
}

/** The entry's package folder when it is on disk; `null` otherwise. Never throws. */
async function packageDirOf(config: ResolvedExtensionConfig, baseDir: string): Promise<string | null> {
  try {
    if (config.path) {
      const dir = path.resolve(baseDir, config.path);
      return (await stat(dir)).isDirectory() ? dir : null;
    }
    if (!config.name || !config.version) return null;
    const root = await resolveVendoredPluginInstallRoot(baseDir, config.name, config.version);
    return root ? vendoredNpmPluginPackageDir(root, config.name) : null;
  } catch {
    return null;
  }
}

/** The book's enabled publishers, in manifest order. A name that is already
 *  a destination is skipped with a warning. */
async function discover({ baseDir, extensions }: BookExtensions): Promise<Publisher[]> {
  const found: Publisher[] = [];
  for (const config of extensions) {
    const dir = await packageDirOf(config, baseDir);
    if (!dir) continue;
    const meta = await readExtensionMeta(dir);
    const id = config.path ? meta.name?.trim() : config.name;
    if (!meta.publish || !id) continue;
    if (isBuiltIn(id) || found.some((p) => p.id === id)) {
      log.warn(`Publishing plugin "${id}" is skipped: a publish destination already has that name.`);
      continue;
    }
    const description = meta.description?.trim();
    found.push({ id, ...(description ? { description } : {}), config, baseDir });
  }
  return found;
}

/** Built-in providers, then the book's enabled publishing plugins. Reads
 *  package.json only; a book whose manifest can't be read lists the built-ins. */
export async function listBookPublishProviders(book: PublishBook): Promise<PublishProviderInfo[]> {
  const plugins = await bookExtensions(book).then(discover, () => []);
  return [...listPublishProviders(), ...plugins.map((p) => pluginProvider(p).info)];
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

function pluginProvider(p: Publisher): PublishProvider {
  const info: PublishProviderInfo = {
    id: p.id,
    label: p.id,
    kind: "api",
    format: "pdf",
    formats: ["pdf", "html"],
    description: p.description ?? "Publishing plugin",
    configFields: [],
    // The plugin owns its credentials; core stores none for it.
    credential: { required: false, host: "" },
    experimental: true,
  };
  let loading: Promise<PublishPluginFunction> | undefined;
  const load = () =>
    (loading ??= import("../markdown/plugins.ts").then((m) => m.loadPublishFunction(p.config, p.baseDir)));

  return {
    info,
    async authenticate() {
      return { ok: true };
    },
    // Loading here makes --dry-run meaningful and reports a broken plugin as
    // a preflight error, which reaches the author verbatim.
    async preflight() {
      try {
        await load();
        return [];
      } catch (e) {
        return [
          {
            severity: "error",
            id: "plugin/load-failed",
            message: `Publishing plugin "${p.id}" could not be loaded: ${messageOf(e)}`,
          },
        ];
      }
    },
    async upload(req) {
      const publish = await load();
      const onProgress = req.deps.onProgress ?? (() => {});
      onProgress(`${p.id} is an experimental publishing plugin.`);
      const { format, path: artifactPath } = req.artifact;
      let returned: PublishPluginResult | void;
      try {
        returned = await publish(format === "html" ? artifactPath : path.dirname(artifactPath), {
          project: { dir: req.project.projectDir, title: req.project.title, authors: [...req.project.authors] },
          artifacts: { [format]: artifactPath },
          settings: { ...req.config },
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
