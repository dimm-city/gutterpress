/**
 * Extension specifiers (#265) — the one string that names an extension in the
 * manifest's `extensions:` list. Its FORM says what it is; there is no
 * `path:`/`name:` wrapper anywhere:
 *
 *   1. a BUNDLED name — a markdown feature or a look compiled into
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
// The built-in looks, inlined as text so the loader needs no file on disk.
import cleanBookCss from "../assets/themes/clean-book/theme.css" with { type: "text" };
import zineCss from "../assets/themes/zine/theme.css" with { type: "text" };
import technicalDocCss from "../assets/themes/technical-doc/theme.css" with { type: "text" };
import academicCss from "../assets/themes/academic/theme.css" with { type: "text" };

/**
 * The extensions compiled into Gutterpress. Writing one of these names in
 * `extensions:` installs nothing: the loader resolves it from the bundle, so
 * it works offline and in the compiled binary.
 *
 * A markdown feature loads from `BUILTIN_OPTIONAL_PLUGINS`
 * (`markdown/renderer.ts`, keyed by the same name; a test pins the two
 * together). A look is its stylesheet, inlined here as text, so the loader
 * hands it straight to the cascade and nothing is read from disk or copied
 * into a book. Both carry their author-facing words here.
 */
export interface BundledExtension {
  /** The specifier an author writes. */
  name: string;
  /** Short, plain-language name shown as the row title. */
  label: string;
  /** One line in plain words. Backtick spans mark "what to type" (the desktop
   *  sets them in code type), so keep them paired and keep HTML tags out. */
  description: string;
  /** A look's stylesheet. Absent for a markdown feature. */
  css?: string;
}

export const BUNDLED_EXTENSIONS: readonly BundledExtension[] = [
  {
    name: "markdown-it-mark",
    label: "Highlight",
    description: "Highlight text by wrapping it in `==double equals==`.",
  },
  {
    name: "markdown-it-sub",
    label: "Subscript",
    description: "Lower text below the line, like the 2 in `H~2~O`.",
  },
  {
    name: "markdown-it-sup",
    label: "Superscript",
    description: "Raise text above the line, like the th in `29^th^`.",
  },
  {
    name: "markdown-it-abbr",
    label: "Abbreviations",
    description: "Explain an abbreviation when readers hover over it. Define it once, like `*[GPS]: Global Positioning System`.",
  },
  {
    name: "gutterpress-gfm-alerts",
    label: "Callouts",
    description: "Turn a quote into a boxed note: start it with `> [!NOTE]` (or `TIP`, `IMPORTANT`, `WARNING`, `CAUTION`).",
  },
  {
    name: "gutterpress-math",
    label: "Math",
    description: "Write LaTeX math between dollar signs: `$E = mc^2$` in a line, or `$$` … `$$` on lines of their own.",
  },
  {
    name: "clean-book",
    label: "Clean book",
    description: "A calm, classic book look: serif body, generous margins, restrained accents.",
    css: cleanBookCss,
  },
  {
    name: "zine",
    label: "Zine",
    description: "High-contrast, punchy sans-serif look for short photocopier-friendly zines.",
    css: zineCss,
  },
  {
    name: "technical-doc",
    label: "Technical doc",
    description: "Clean sans-serif manual look with clear hierarchy, code styling, and tidy tables.",
    css: technicalDocCss,
  },
  {
    name: "academic",
    label: "Academic",
    description: "A journal-article look: serif text, justified and hyphenated, ruled tables, notes and references set smaller.",
    css: academicCss,
  },
];

export function bundledExtension(name: string): BundledExtension | undefined {
  return BUNDLED_EXTENSIONS.find((e) => e.name === name);
}

export function isBundledExtension(name: string): boolean {
  return bundledExtension(name) !== undefined;
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
      `"${spec}" looks like a path; write it as "./${spec}". A specifier that does not ` +
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
