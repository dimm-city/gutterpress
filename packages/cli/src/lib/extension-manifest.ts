/**
 * Extension metadata (#241) — `gutterpress.json`, the ONE package format a
 * theme and a styles-carrying plugin are both degenerate cases of.
 *
 * This module is the "metadata file + resolver" half of #241: it defines the
 * superset shape (`ExtensionMetadata`), reads it off disk (`readExtensionMeta`,
 * trying `gutterpress.json` first and falling back to the pre-existing
 * `theme.json` — the literal mechanism that makes "an existing theme.css +
 * theme.json folder loads completely unchanged" true, since a folder with only
 * `theme.json` resolves to the exact same fields it always has, with the three
 * new ones simply absent), validates it (`assertExtensionContained`), and
 * resolves its declared paths to absolute, existence-checked filesystem paths
 * (`resolveExtension`) — built entirely on {@link resolveDeclaredStyles}
 * (`style-declarations.ts`), the ONE shared declared-path resolver a plugin's
 * `styles` export (#238) and a theme's `styles`/`engineStyles.native` (#239)
 * already both go through. No parallel resolver is introduced here.
 *
 * `theme-manager.ts` re-exports the theme-specific names this module
 * generalizes (`ThemeMetadata` = {@link ExtensionMetadata},
 * `themeStyleList`/`themeEngineStyleList`/`assertThemeSheetsContained` are thin
 * wrappers or straight aliases) — see that file's imports for the rename this
 * issue makes: the theme-specific reader/checker are now specializations of
 * the extension-generic ones defined here, not a second implementation.
 * `markdown/plugins.ts`'s `loadPlugin` is the OTHER consumer: a `plugins:`
 * entry whose `path` names a DIRECTORY (rather than a bare `.js` file) is
 * loaded through {@link resolveExtension} too — see that file's
 * `loadExtensionFromDir`.
 *
 * Deliberately NOT in scope (left to #240/#242/#243, per the issue): this
 * module parses and validates `components`/`snippets` and exposes their
 * resolved paths on {@link ResolvedExtension} — nothing here implements the
 * component registry or merges snippets into any picker.
 *
 * Pure Node fs/path — no subprocess, no bundler, no runtime package.json
 * reads, no computed dynamic imports (CLAUDE.md §1/§3): bundles cleanly under
 * `bun build --compile` and runs in the packaged desktop alike.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { resolveDeclaredStyles } from "./style-declarations.ts";

/** The unified package's metadata filename — checked before the legacy
 *  theme-only filename by {@link readExtensionMeta}. */
export const EXTENSION_MANIFEST_FILENAME = "gutterpress.json";

/** The pre-#241 theme-only metadata filename. Still fully supported: a folder
 *  with only this file (no `gutterpress.json`) is a theme, i.e. "an extension
 *  with only styles" — see {@link readExtensionMeta}. */
export const LEGACY_THEME_MANIFEST_FILENAME = "theme.json";

/**
 * Parsed extension metadata — a superset of the pre-#241 theme metadata
 * shape. Every field is optional, and a folder declaring only the theme-era
 * fields (`name`/`author`/`description`/`preview`/`styles`/`engineStyles`/
 * `tokensFile`) IS a valid extension: "theme ≡ extension with only styles."
 * Symmetrically, a bare `.js` plugin file (no metadata file at all) never
 * constructs one of these — "plugin ≡ extension with only markdown" needs no
 * metadata file until it wants more than a function (see `plugins.ts`'s
 * `loadExtensionFromDir`, which only reaches this type for a `path` that
 * names a folder).
 */
export interface ExtensionMetadata {
  name?: string;
  author?: string;
  description?: string;
  /** Optional preview image path (relative to the extension folder). */
  preview?: string | null;
  /**
   * Ordered stylesheets, relative to the extension folder. Absent/empty means
   * "no styles declared" here — {@link extensionStyleList} does NOT default
   * to `["theme.css"]`; that default is theme-manager.ts's OWN, layered on
   * top for its theme-shaped callers (a plain markdown-only extension folder
   * has no reason to require a `theme.css` it never declared).
   */
  styles?: string[];
  /** Engine-conditional sheets, relative to the extension folder, appended
   *  after `styles` (mirrors the manifest's own `engineStyles.native`). */
  engineStyles?: { native?: string[] };
  /** Which declared sheet (a path from `styles`) carries the author-facing
   *  `:root` token surface for the Design panel's guided editor. Purely
   *  advisory — nothing in this module enforces or existence-checks it,
   *  matching the pre-#241 theme behavior it generalizes. */
  tokensFile?: string;
  /**
   * Markdown-it entry, relative to the extension folder — a path to a JS
   * module exporting a plugin function exactly like a bare-file plugin
   * (`export default function (md, options) { ... }`, optionally `metadata`/
   * `css`/`styles`, #238). Absent means "no markdown behavior" — the
   * degenerate case that makes a styles-only folder indistinguishable from a
   * theme. CLAUDE.md §5 is unaffected: this field is DATA a loader resolves
   * to a file, then loads through the exact same plain-markdown-it-plugin
   * contract every other plugin module does — no new plugin API is
   * introduced.
   */
  markdown?: string;
  /**
   * Component catalog file, relative to the extension folder (the CSS
   * architecture review's `components.yaml`, #242). Parsed for existence/
   * containment only by this module — the catalog SCHEMA and the registry
   * that reads it are #242's scope, not this one's.
   */
  components?: string;
  /**
   * Snippets folder, relative to the extension folder, merged into the
   * project's snippet picker under the extension's name (#240). Parsed for
   * existence/containment only by this module — the merge itself is #240's
   * scope, not this one's.
   */
  snippets?: string;
}

/** Tolerant JSON read: `{}` for a missing or unparseable file — one bad or
 *  absent metadata file must never take down listing/reading every extension
 *  (mirrors the pre-#241 `readThemeMeta` contract this generalizes). */
async function readJsonMetaFile(jsonPath: string): Promise<ExtensionMetadata> {
  try {
    const parsed = JSON.parse(await readFile(jsonPath, "utf8")) as ExtensionMetadata;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Read an extension folder's metadata: `gutterpress.json` when present,
 * otherwise the legacy `theme.json` — ONE reader for both filenames, which is
 * what makes "the theme verbs keep working on the extension format" true
 * everywhere a real on-disk extension/theme folder is read (project themes,
 * apply, import, revert). `gutterpress.json` wins outright when present (no
 * silent merge with a sibling `theme.json` — a package declares itself
 * through exactly one file), matching {@link readJsonMetaFile}'s tolerant
 * contract when that one file is missing or broken.
 */
export async function readExtensionMeta(dir: string): Promise<ExtensionMetadata> {
  const extensionPath = path.join(dir, EXTENSION_MANIFEST_FILENAME);
  if (existsSync(extensionPath)) {
    return readJsonMetaFile(extensionPath);
  }
  return readJsonMetaFile(path.join(dir, LEGACY_THEME_MANIFEST_FILENAME));
}

/** Non-empty declared-string-list normalizer shared by every list field this
 *  metadata carries (`styles`, `engineStyles.native`) — tolerates a
 *  hand-edited file where the field exists but isn't a clean string array. */
function declaredList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    : [];
}

/**
 * An extension's declared stylesheets, relative to its folder, in cascade
 * order. UNLIKE `theme-manager.ts`'s `themeStyleList` (which layers a
 * `["theme.css"]` default on top of this for its theme-shaped callers), an
 * absent/empty `styles` here means exactly "none declared" — a markdown-only
 * extension folder must not be forced to carry a `theme.css` it never wanted.
 */
export function extensionStyleList(meta: ExtensionMetadata): string[] {
  return declaredList(meta.styles);
}

/** An extension's declared engine-conditional sheets, relative to its folder. */
export function extensionEngineStyleList(meta: ExtensionMetadata): string[] {
  return declaredList(meta.engineStyles?.native);
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
 *
 * Generalizes the pre-#241 theme-only `assertThemeSheetsContained` (still
 * exported under that name from `theme-manager.ts`, now a re-export of this
 * function) to the three new fields: a `gutterpress.json`-formatted theme
 * folder can declare `markdown`/`components`/`snippets` too, so the SAME
 * write-boundary guard must cover them, not just `styles`/`engineStyles`.
 * `tokensFile` is included even though it is advisory/unenforced elsewhere —
 * defense in depth against a future consumer reading it unchecked.
 *
 * A WRITE-BOUNDARY guard, not a read-path check (mirrors the theme-only
 * predecessor): callers invoke this before copying anything or wiring a
 * manifest, never from a plain listing/read path, so one hand-edited
 * metadata file cannot take down listing every extension.
 */
export function assertExtensionContained(meta: ExtensionMetadata): void {
  const declared = [
    ...extensionStyleList(meta),
    ...extensionEngineStyleList(meta),
    ...(meta.markdown ? [meta.markdown] : []),
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
 * {@link resolveDeclaredStyles} a plugin's `styles` export and a theme's
 * `styles`/`engineStyles.native` already resolve through, so a broken
 * declaration (a missing file) throws HERE, at load/apply time, instead of
 * failing silently deep in the render pipeline (or never, for `components`/
 * `snippets`, which nothing yet reads — #240/#242).
 *
 * `tokensFile` is the one exception, kept as declared (relative, not
 * existence-checked) — it stays purely advisory, matching
 * `ThemeInfo.tokensFile`'s pre-#241 contract.
 */
export interface ResolvedExtension {
  /** Absolute path to the markdown-it entry module, when declared. */
  markdown?: string;
  /** Absolute paths, in cascade order, when any are declared. */
  styles?: string[];
  /** Absolute paths, in cascade order, when any are declared. */
  engineStyles?: string[];
  /** Declared-relative path of the `:root` token surface — advisory. */
  tokensFile?: string;
  /** Absolute path to the component catalog file, when declared (#242). */
  components?: string;
  /** Absolute path to the snippets folder, when declared (#240). */
  snippets?: string;
}

/**
 * Resolve every path {@link ExtensionMetadata} declares, relative to `dir`
 * (the extension's own folder). `subject` names the declaring thing for a
 * resolution error, e.g. `Plugin "my-extension"` — passed straight through to
 * `resolveDeclaredStyles`, so a broken `markdown`/`components`/`snippets`
 * entry throws the same "declares stylesheet ... but no file exists" shape a
 * broken `styles` entry always has (the wording says "stylesheet" for every
 * field — a small, accepted cost of resolving all of them through one
 * function rather than inventing per-field messages).
 */
export function resolveExtension(
  dir: string,
  meta: ExtensionMetadata,
  subject: string,
): ResolvedExtension {
  const styles = resolveDeclaredStyles(extensionStyleList(meta), dir, subject);
  const engineStyles = resolveDeclaredStyles(extensionEngineStyleList(meta), dir, subject);
  const [markdown] =
    resolveDeclaredStyles(meta.markdown ? [meta.markdown] : undefined, dir, subject) ?? [];
  const [components] =
    resolveDeclaredStyles(meta.components ? [meta.components] : undefined, dir, subject) ?? [];
  const [snippets] =
    resolveDeclaredStyles(meta.snippets ? [meta.snippets] : undefined, dir, subject) ?? [];

  return {
    ...(markdown ? { markdown } : {}),
    ...(styles ? { styles } : {}),
    ...(engineStyles ? { engineStyles } : {}),
    ...(meta.tokensFile?.trim() ? { tokensFile: meta.tokensFile.trim() } : {}),
    ...(components ? { components } : {}),
    ...(snippets ? { snippets } : {}),
  };
}
