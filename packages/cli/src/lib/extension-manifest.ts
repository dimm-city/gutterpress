/**
 * Extension metadata (#241, #276) — the standard `package.json`, the ONE file
 * a plugin, a look and a component library are all described by.
 *
 * A package maintainer is never asked for a second, Gutterpress-specific
 * manifest: npm's own fields are read as-is (`name`, `description`, `author`,
 * `keywords`, and `main` — the markdown-it plugin module), and everything
 * Gutterpress-specific lives under one optional `"gutterpress"` key
 * (`styles`, `markdown`, `snippets`, `components`, `tokensFile`, `preview`).
 * A plain markdown-it plugin package therefore needs nothing at all to load
 * as an extension; a look needs `gutterpress.styles`; a component library
 * needs `main` + `gutterpress.styles`.
 *
 * This module is the "metadata file + resolver" half of that format: it
 * defines the shape (`ExtensionMetadata`), reads it off disk
 * (`readExtensionMeta`), says which module a folder's markdown-it entry is
 * (`extensionEntry`), validates it (`assertExtensionContained`), and resolves
 * its declared paths to absolute, existence-checked filesystem paths
 * (`resolveExtension`) — built entirely on {@link resolveDeclaredStyles}
 * (`style-declarations.ts`), the ONE shared declared-path resolver a plugin's
 * `styles` export (#238) and a look's `styles` (#239) already both go
 * through. No parallel resolver is introduced here.
 *
 * `extension-manager.ts` (a look is "an extension with only styles") and
 * `markdown/plugins.ts`'s `loadPlugin` (a plugin is "an extension with only
 * markdown") are the two consumers: an `extensions:` entry whose `path` names
 * a DIRECTORY (rather than a bare `.js` file) is loaded through
 * {@link resolveExtension} — see that file's `loadExtensionFromDir`.
 *
 * Deliberately NOT in scope: this module parses and validates
 * `components`/`snippets` and exposes their resolved paths on
 * {@link ResolvedExtension} — nothing here implements the component registry
 * or merges snippets into any picker (`snippets.ts` does the latter).
 *
 * Pure Node fs/path — no subprocess, no bundler, no computed dynamic imports
 * (CLAUDE.md §1/§3): bundles cleanly under `bun build --compile` and runs in
 * the packaged desktop alike.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { resolveDeclaredStyles } from "./style-declarations.ts";

/** The one file an extension describes itself in — npm's own manifest. */
export const EXTENSION_MANIFEST_FILENAME = "package.json";

/** The `package.json` key every Gutterpress-specific field lives under. */
const GUTTERPRESS_KEY = "gutterpress";

/**
 * Parsed extension metadata — npm's standard fields plus the `gutterpress`
 * block's, flattened into the one shape every consumer reads. Every field is
 * optional: a folder declaring only `gutterpress.styles` IS a valid extension
 * ("a look ≡ an extension with only styles"), and a package.json whose `main`
 * is a plain markdown-it plugin with no `gutterpress` key at all is one too
 * ("a plugin ≡ an extension with only markdown"). A bare `.js` plugin file
 * (no package.json beside it) never constructs one of these — see
 * `plugins.ts`'s `loadExtensionFromDir`, which only reaches this type for a
 * `path` that names a folder.
 */
export interface ExtensionMetadata {
  /** npm `name`. */
  name?: string;
  /** npm `author`, as a string or the object form's `name`. */
  author?: string;
  /** npm `description`. */
  description?: string;
  /**
   * npm `keywords` — informational. `gutterpress` marks a Gutterpress
   * extension and `markdown-it-plugin` a markdown-it plugin, the two tags
   * `gutterpress ext search` finds packages by; nothing here requires either.
   */
  keywords?: string[];
  /**
   * npm `main` — the markdown-it plugin module of a FOLDER extension, by
   * npm's own convention. See {@link extensionEntry} for the entry rule
   * (`gutterpress.markdown` wins when present). NOT used for an npm-installed
   * package: the installer resolves that entry with full `exports` semantics
   * (`npm-plugin-installer.ts`'s `resolvePackageEntry`), and it is never
   * re-derived from `main` here.
   */
  main?: string;
  /** `gutterpress.preview` — an optional preview image path, relative to the
   *  extension folder. */
  preview?: string | null;
  /**
   * `gutterpress.styles` — ordered stylesheets, relative to the extension
   * folder. Absent/empty means exactly "no styles declared": a look declares
   * its sheets, it does not get an implicit `theme.css`.
   */
  styles?: string[];
  /** `gutterpress.tokensFile` — which declared sheet (a path from `styles`)
   *  carries the author-facing `:root` token surface for the Design panel's
   *  guided editor. Purely advisory — nothing in this module enforces or
   *  existence-checks it. */
  tokensFile?: string;
  /**
   * `gutterpress.markdown` — an EXPLICIT markdown-it entry, relative to the
   * extension folder, for the one case npm's `main` can't express: a package
   * whose `main` is not the plugin. Absent is the normal case ({@link
   * extensionEntry} falls back to `main`). CLAUDE.md §5 is unaffected: this
   * field is DATA a loader resolves to a file, then loads through the exact
   * same plain-markdown-it-plugin contract every other plugin module does —
   * no new plugin API is introduced.
   */
  markdown?: string;
  /**
   * `gutterpress.components` — component catalog file, relative to the
   * extension folder (the CSS architecture review's `components.yaml`, #242).
   * Parsed for existence/containment only by this module.
   */
  components?: string;
  /**
   * `gutterpress.snippets` — snippets folder, relative to the extension
   * folder, merged into the project's snippet picker under the extension's
   * name. Parsed for existence/containment only by this module; `snippets.ts`
   * does the merge.
   */
  snippets?: string;
  /**
   * The removed `engineStyles` field (#266), carried through from the
   * `gutterpress` block ONLY so {@link assertExtensionContained} can reject it
   * by name at a write boundary. Never read as a declaration.
   */
  engineStyles?: unknown;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** npm's `author`: `"Ada <ada@example.com>"` or `{ name, email, url }`. */
function authorName(value: unknown): string | undefined {
  return str(value) ?? str(object(value)?.name);
}

/** Map a parsed `package.json` onto {@link ExtensionMetadata}. Unknown fields
 *  are ignored, and a malformed value simply reads as absent — one
 *  hand-edited file must never take down listing every extension. */
function metaFromPackageJson(raw: unknown): ExtensionMetadata {
  const pkg = object(raw);
  if (!pkg) return {};
  const gp = object(pkg[GUTTERPRESS_KEY]) ?? {};
  const keywords = Array.isArray(pkg.keywords)
    ? pkg.keywords.filter((k): k is string => typeof k === "string")
    : undefined;
  return {
    ...(str(pkg.name) ? { name: str(pkg.name) } : {}),
    ...(authorName(pkg.author) ? { author: authorName(pkg.author) } : {}),
    ...(str(pkg.description) ? { description: str(pkg.description) } : {}),
    ...(keywords ? { keywords } : {}),
    ...(str(pkg.main) ? { main: str(pkg.main) } : {}),
    ...("preview" in gp ? { preview: str(gp.preview) ?? null } : {}),
    ...(Array.isArray(gp.styles) ? { styles: declaredList(gp.styles) } : {}),
    ...(str(gp.tokensFile) ? { tokensFile: str(gp.tokensFile) } : {}),
    ...(str(gp.markdown) ? { markdown: str(gp.markdown) } : {}),
    ...(str(gp.components) ? { components: str(gp.components) } : {}),
    ...(str(gp.snippets) ? { snippets: str(gp.snippets) } : {}),
    ...(gp.engineStyles !== undefined ? { engineStyles: gp.engineStyles } : {}),
  };
}

/**
 * Read an extension folder's `package.json`. Tolerant: a missing or
 * unparseable file, or one that is not an object, reads as `{}` — one bad or
 * absent manifest must never take down listing/reading every extension.
 */
export async function readExtensionMeta(dir: string): Promise<ExtensionMetadata> {
  try {
    return metaFromPackageJson(
      JSON.parse(await readFile(path.join(dir, EXTENSION_MANIFEST_FILENAME), "utf8")),
    );
  } catch {
    return {};
  }
}

/** Non-empty declared-string-list normalizer for `styles` — tolerates a
 *  hand-edited file where the field exists but isn't a clean string array. */
function declaredList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    : [];
}

/**
 * An extension's declared stylesheets, relative to its folder, in cascade
 * order. Absent/empty `gutterpress.styles` means exactly "none declared".
 */
export function extensionStyleList(meta: ExtensionMetadata): string[] {
  return declaredList(meta.styles);
}

/**
 * The markdown-it entry of a FOLDER extension: an explicit
 * `gutterpress.markdown` when the package's `main` is not the plugin,
 * otherwise npm's own `main`. `undefined` for a folder that carries no
 * markdown behaviour at all (a look).
 */
export function extensionEntry(meta: ExtensionMetadata): string | undefined {
  return meta.markdown?.trim() || meta.main?.trim() || undefined;
}

/** What an extension declares, by field — the desktop's one-list filter. */
export interface ExtensionCarries {
  markdown: boolean;
  styles: boolean;
  snippets: boolean;
  components: boolean;
}

export function extensionCarries(meta: ExtensionMetadata): ExtensionCarries {
  return {
    markdown: !!extensionEntry(meta),
    styles: extensionStyleList(meta).length > 0,
    snippets: !!meta.snippets?.trim(),
    components: !!meta.components?.trim(),
  };
}

/**
 * True when a declared relative path escapes its own folder (absolute, or a
 * `..` segment) — the traversal shape every containment check in this
 * package rejects.
 *
 * Exported (#242) for `snippets.ts`'s installed-extension snippet merge,
 * which needs this SAME single-field check but cannot use
 * {@link assertExtensionContained}: that guard throws on ANY escaping field
 * (styles/markdown/components/tokensFile too), which is correct for a
 * write-boundary check at install/apply time but wrong for a tolerant
 * listing — an extension with a broken, unrelated `styles` entry must not
 * make its perfectly fine `snippets` folder disappear from the picker (the
 * same "one hand-edited file must not take down listing everyone else's"
 * doctrine {@link readExtensionMeta}'s tolerant JSON parse already follows).
 */
export function pathEscapesFolder(rel: string): boolean {
  return path.isAbsolute(rel) || rel.split(/[\\/]/).includes("..");
}

/**
 * Every path an extension declares must live INSIDE its own folder — an
 * extension is self-contained by contract (apply/install copies the whole
 * folder), and an imported/vendored package is untrusted input: a `../` or
 * absolute entry would make apply/load read a file from anywhere on disk.
 * `tokensFile` is included even though it is advisory/unenforced elsewhere —
 * defense in depth against a future consumer reading it unchecked.
 *
 * A WRITE-BOUNDARY guard, not a read-path check: callers invoke this before
 * copying anything or wiring a manifest, never from a plain listing/read
 * path, so one hand-edited manifest cannot take down listing every extension.
 * The removed `engineStyles` field (#266) is rejected here for the same
 * reason: the error names the replacement, and it fires only where something
 * would be copied or wired, never while listing.
 */
export function assertExtensionContained(meta: ExtensionMetadata): void {
  if (meta.engineStyles !== undefined) {
    throw new Error(
      "The extension's metadata declares `engineStyles`, which was removed — " +
        "move its entries to the end of `styles`.",
    );
  }
  const entry = extensionEntry(meta);
  const declared = [
    ...extensionStyleList(meta),
    ...(entry ? [entry] : []),
    ...(meta.components ? [meta.components] : []),
    ...(meta.snippets ? [meta.snippets] : []),
    ...(meta.tokensFile ? [meta.tokensFile] : []),
  ];
  for (const rel of declared) {
    if (pathEscapesFolder(rel)) {
      throw new Error(
        `Extension metadata declares "${rel}" outside its own folder; an extension must be self-contained.`,
      );
    }
  }
}

/**
 * An extension's declared paths, resolved to absolute, existence-checked
 * filesystem paths — every list/single-path field goes through the SAME
 * {@link resolveDeclaredStyles} a plugin's `styles` export and a look's
 * `styles` already resolve through, so a broken declaration (a missing file)
 * throws HERE, at load/apply time, instead of failing silently deep in the
 * render pipeline (or never, for `components`, which nothing yet reads).
 *
 * `tokensFile` is the one exception, kept as declared (relative, not
 * existence-checked) — it stays purely advisory.
 */
export interface ResolvedExtension {
  /** Absolute path to the markdown-it entry module, when the folder has one. */
  markdown?: string;
  /** Absolute paths, in cascade order, when any are declared. */
  styles?: string[];
  /** Declared-relative path of the `:root` token surface — advisory. */
  tokensFile?: string;
  /** Absolute path to the component catalog file, when declared (#242). */
  components?: string;
  /** Absolute path to the snippets folder, when declared. */
  snippets?: string;
}

/**
 * Resolve every path {@link ExtensionMetadata} declares, relative to `dir`
 * (the extension's own folder). `subject` names the declaring thing for a
 * resolution error, e.g. `Plugin "my-extension"` — passed straight through to
 * `resolveDeclaredStyles`, so a broken entry throws the same "declares
 * stylesheet ... but no file exists" shape a broken `styles` entry always has
 * (the wording says "stylesheet" for every field — a small, accepted cost of
 * resolving all of them through one function rather than inventing per-field
 * messages).
 *
 * `markdown` resolves {@link extensionEntry} — the FOLDER rule. An
 * npm-installed package's entry is whatever the installer resolved with full
 * `exports` semantics, so `plugins.ts` calls this without `main` for that
 * path; see its npm branch.
 */
export function resolveExtension(
  dir: string,
  meta: ExtensionMetadata,
  subject: string,
): ResolvedExtension {
  const entry = extensionEntry(meta);
  const styles = resolveDeclaredStyles(extensionStyleList(meta), dir, subject);
  const [markdown] = resolveDeclaredStyles(entry ? [entry] : undefined, dir, subject) ?? [];
  const [components] =
    resolveDeclaredStyles(meta.components ? [meta.components] : undefined, dir, subject) ?? [];
  const [snippets] =
    resolveDeclaredStyles(meta.snippets ? [meta.snippets] : undefined, dir, subject) ?? [];

  return {
    ...(markdown ? { markdown } : {}),
    ...(styles ? { styles } : {}),
    ...(meta.tokensFile?.trim() ? { tokensFile: meta.tokensFile.trim() } : {}),
    ...(components ? { components } : {}),
    ...(snippets ? { snippets } : {}),
  };
}
