/**
 * Extension specifiers (#265) — the one string that names an extension in the
 * manifest's `extensions:` list. Its FORM says what it is; there is no
 * `path:`/`name:` wrapper anywhere:
 *
 *   1. a BUNDLED name — one of the five markdown features compiled into
 *      Gutterpress — resolves to the bundled copy and never touches the
 *      network. Bundled names shadow npm;
 *   2. `./x`, `../x`, `/x` (or a Windows drive path) is a PATH, resolved
 *      against the manifest's directory — Node's own rule, so a scoped npm
 *      name is never ambiguous;
 *   3. anything else is an NPM specifier, and `name@version` pins it — npm's
 *      own syntax. The pin is part of the specifier, not a separate field.
 *
 * Kept free of loader and filesystem imports so `manifest.ts` (resolution)
 * and `extension-manager.ts` (install) parse a specifier the same way.
 */
import { parseNpmPluginSpec } from "./plugin-vendor.ts";

/**
 * The markdown features compiled into Gutterpress (`BUILTIN_OPTIONAL_PLUGINS`,
 * `markdown/renderer.ts` — a test pins the two lists together). Writing one
 * of these names installs nothing: the loader resolves it from the bundle.
 */
export const BUNDLED_EXTENSIONS = [
  "markdown-it-mark",
  "markdown-it-sub",
  "markdown-it-sup",
  "markdown-it-abbr",
  "gutterpress-gfm-alerts",
] as const;

export type BundledExtensionName = (typeof BUNDLED_EXTENSIONS)[number];

export function isBundledExtension(name: string): name is BundledExtensionName {
  return (BUNDLED_EXTENSIONS as readonly string[]).includes(name);
}

/** `./x`, `../x`, `/x`, or a Windows drive path (`C:\x`). Nothing else is a path. */
export function isPathSpecifier(use: string): boolean {
  return (
    use.startsWith("./") ||
    use.startsWith("../") ||
    use.startsWith("/") ||
    /^[a-zA-Z]:[\\/]/.test(use)
  );
}

export type ParsedExtensionSpecifier =
  | { kind: "path"; path: string }
  | { kind: "bundled"; name: string }
  | { kind: "npm"; name: string; version?: string };

/**
 * Parse one specifier. Throws a plain `Error` whose message says what to
 * write instead — callers wrap it with the entry's position.
 */
export function parseExtensionSpecifier(use: string): ParsedExtensionSpecifier {
  const spec = use.trim();
  if (!spec) {
    throw new Error("An extension specifier is required — an npm package name, or a ./ path.");
  }
  if (isPathSpecifier(spec)) return { kind: "path", path: spec };

  // A bare `plugins/foo.js` is a very natural thing to write. It is not a
  // path (rule 2) and it cannot be an npm name either, so say which one the
  // author almost certainly meant before the npm parser complains.
  if (/\.(m?js|cjs)$/i.test(spec) || (!spec.startsWith("@") && spec.includes("/"))) {
    throw new Error(
      `"${spec}" looks like a path — write it as "./${spec}". A specifier that does not ` +
        "start with ./, ../ or / is an npm package name.",
    );
  }

  const parsed = parseNpmPluginSpec(spec);
  if (isBundledExtension(parsed.name)) {
    if (parsed.selector !== undefined) {
      throw new Error(
        `"${parsed.name}" is bundled with Gutterpress and always resolves to the bundled copy — ` +
          `drop "@${parsed.selector}".`,
      );
    }
    return { kind: "bundled", name: parsed.name };
  }
  return parsed.selector === undefined
    ? { kind: "npm", name: parsed.name }
    : { kind: "npm", name: parsed.name, version: parsed.selector };
}

/**
 * The specifier an `ext add` writes back for an npm install: the exact
 * version is part of the specifier, so the manifest reads `name@1.2.3`.
 */
export function pinnedNpmSpecifier(name: string, version: string): string {
  return `${name}@${version}`;
}
