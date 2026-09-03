/**
 * Extension scaffolding (#245 + #233) — `gutterpress new --kind plugin|theme`.
 *
 * The sibling of `project-scaffold.ts`: that module creates a BOOK, this one
 * creates an EXTENSION — the other kind of thing an author makes. Same shape
 * deliberately (copy an embedded template, substitute placeholders, never
 * overwrite), same error type, so the CLI's exit-code mapping and the
 * desktop's error handling cover both with one implementation each.
 *
 * Kept as its own module rather than folded into `project-scaffold.ts`: the
 * two share nothing but the slug helper and the error class, and a book
 * scaffold carries preset/target/page/version-history machinery an extension
 * has no concept of. One file per thing being created is the smaller surface.
 *
 * WHAT THE TWO KINDS ARE
 *
 *   plugin — markdown behaviour + component CSS + snippets + a runnable test
 *            harness. Loaded by a book through `plugins: - path: <folder>`.
 *   theme  — the layered CSS architecture from #233 (tokens / base /
 *            components / page-templates / page-rules / book), each file
 *            carrying its OWNS / MUST NOT CONTAIN contract header. Loaded by
 *            a book through `gutterpress theme import` + `apply`.
 *
 * Both emit a `gutterpress.json` in #241's format and nothing more: this
 * module CONSUMES that format, it does not extend it. There is no `kind:`
 * field — a plugin is "an extension with markdown", a theme is "an extension
 * with only styles", and the metadata says so by what it declares rather than
 * by a label.
 *
 * Pure Node fs/path over the embedded templates (`embedded-assets.ts`,
 * CLAUDE.md §4) — no subprocess, no bundler, no runtime package.json reads.
 * Works under `bun build --compile` and in the packaged desktop alike.
 *
 * NEVER deletes or overwrites: an existing target throws `target-exists`,
 * matching `scaffoldProject`'s no-data-loss contract.
 */
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants as FS } from "node:fs";
import path from "node:path";

import { getAssetPath } from "./embedded-assets.ts";
import { slugify } from "./slug.ts";
import type { CreateProjectError, CreateProjectErrorCode } from "./project-scaffold.ts";

/** Which starter package to create. */
export type ExtensionKind = "plugin" | "theme";

/** The kinds `--kind` accepts, for CLI help text and pickers. */
export const EXTENSION_KINDS = ["plugin", "theme"] as const satisfies readonly ExtensionKind[];

/**
 * The class/property prefix a scaffolded extension is FORBIDDEN to take.
 * `gp-` is Gutterpress core's own vocabulary (CLAUDE.md §6); an extension
 * using it does not conflict with core, it silently overrides it.
 */
export const RESERVED_PREFIX = "gp-";

/**
 * Files each kind writes, as `embedded asset key` → `path inside the new
 * folder`. Source and destination names differ in exactly two places, both
 * for the reason documented in `embedded-assets.ts`: a template that would
 * otherwise be compiled (`plugin.js`) or COLLECTED AND RUN (`plugin.test.js`)
 * by this package's own toolchain carries a `.tpl` suffix at rest.
 */
const TEMPLATE_FILES: Record<ExtensionKind, ReadonlyArray<readonly [string, string]>> = {
  plugin: [
    ["gutterpress.json", "gutterpress.json"],
    ["package.json", "package.json"],
    ["README.md", "README.md"],
    ["plugin.js.tpl", "plugin.js"],
    ["styles/plugin.css", "styles/plugin.css"],
    ["snippets/term-box.md", "snippets/term-box.md"],
    ["test/fixture.md", "test/fixture.md"],
    ["test/expected.html", "test/expected.html"],
    ["test/plugin.test.js.tpl", "test/plugin.test.js"],
  ],
  theme: [
    ["gutterpress.json", "gutterpress.json"],
    ["README.md", "README.md"],
    ["components.yaml", "components.yaml"],
    ["snippets/callout.md", "snippets/callout.md"],
    ["styles/tokens.css", "styles/tokens.css"],
    ["styles/base.css", "styles/base.css"],
    ["styles/components.css", "styles/components.css"],
    ["styles/page-templates.css", "styles/page-templates.css"],
    ["styles/page-rules.css", "styles/page-rules.css"],
    ["styles/book.css", "styles/book.css"],
  ],
};

/** The file each kind is most useful to open first. */
const OPEN_FILE: Record<ExtensionKind, string> = {
  plugin: "plugin.js",
  theme: "styles/tokens.css",
};

/** One-line description written into a scaffold that supplies none. */
const DEFAULT_DESCRIPTION: Record<ExtensionKind, string> = {
  plugin: "A Gutterpress plugin.",
  theme: "A Gutterpress theme.",
};

const DEFAULT_AUTHOR = "Anonymous";

/** Inputs the CLI / desktop collect. Only `name`, `kind` and `parentDir` are
 *  required; everything else is derived. */
export interface ScaffoldExtensionOptions {
  /** Human-friendly package name, e.g. "Field Notes". Required. */
  name: string;
  /** Which starter to create. Required. */
  kind: ExtensionKind;
  /** Absolute path to the PARENT directory the folder is created in. */
  parentDir: string;
  /** Folder name under `parentDir`. Defaults to a slug of `name`. */
  folderName?: string;
  /**
   * Class / custom-property / marker prefix this package claims. Defaults to
   * the slug plus a hyphen (`field-notes-`). A trailing hyphen is added when
   * missing — the templates concatenate it directly onto a name, so
   * `.${PREFIX}callout` has to produce `.field-notes-callout`.
   */
  prefix?: string;
  /** Author display name. Defaults to "Anonymous". */
  author?: string;
  /** One-line description for the metadata and the README. */
  description?: string;
}

export interface ScaffoldExtensionResult {
  /** Absolute path of the created folder. */
  extensionDir: string;
  /** Absolute path of its `gutterpress.json`. */
  manifestPath: string;
  kind: ExtensionKind;
  /** Folder name / package name that was used. */
  slug: string;
  /** The prefix baked into the scaffolded files. */
  prefix: string;
  /** Absolute path of the file worth opening first. */
  openFile: string;
  /** Every file written, relative to `extensionDir`, in write order. */
  files: string[];
}

class ExtensionScaffoldError extends Error implements CreateProjectError {
  code: CreateProjectErrorCode;
  constructor(code: CreateProjectErrorCode, message: string) {
    super(message);
    this.name = "CreateProjectError";
    this.code = code;
  }
}

/**
 * Normalize an author-supplied prefix, or derive one from the slug.
 *
 * The prefix is the single most load-bearing convention an extension has
 * (#245's "which conventions are load-bearing and why"), so it is validated
 * here rather than left to fail as a puzzling CSS bug later: it must read
 * like a CSS identifier, and it must not be core's.
 */
export function resolveExtensionPrefix(slug: string, requested?: string): string {
  const raw = (requested ?? `${slug}-`).trim();
  const prefix = raw.endsWith("-") ? raw : `${raw}-`;

  if (!/^[a-z][a-z0-9-]*-$/.test(prefix)) {
    throw new ExtensionScaffoldError(
      "invalid-name",
      `"${raw}" is not a usable prefix. Use lower-case letters, digits and hyphens, ` +
        `starting with a letter — for example "${slug}-" or "fn-".`,
    );
  }
  if (prefix === RESERVED_PREFIX) {
    throw new ExtensionScaffoldError(
      "invalid-name",
      `"${RESERVED_PREFIX}" is reserved for Gutterpress core's own classes and custom ` +
        `properties. Taking it would silently override them — choose your own prefix.`,
    );
  }
  return prefix;
}

/**
 * A camelCase JavaScript identifier for the slug, used as the scaffolded
 * plugin function's name. Prefixed with `_` only if the slug starts with a
 * digit, which is the one way a slug can fail to be a valid identifier.
 */
function identifierFor(slug: string): string {
  const camel = slug.replace(/-([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
  return /^[0-9]/.test(camel) ? `_${camel}` : camel;
}

/** JSON-escape a value destined for a double-quoted string in a .json template. */
function escapeJsonScalar(value: string): string {
  // Slice off the quotes JSON.stringify adds — the template already has them.
  return JSON.stringify(value).slice(1, -1);
}

/**
 * Create a plugin or theme starter package.
 *
 * Resolves with a {@link ScaffoldExtensionResult}; throws a
 * {@link CreateProjectError} (the SAME error type `scaffoldProject` throws, so
 * one `catch` handles both) on any precondition failure.
 */
export async function scaffoldExtension(
  options: ScaffoldExtensionOptions,
): Promise<ScaffoldExtensionResult> {
  const kind = options.kind;
  if (kind !== "plugin" && kind !== "theme") {
    throw new ExtensionScaffoldError(
      "invalid-name",
      `Unknown extension kind "${String(kind)}". Choose one of: ${EXTENSION_KINDS.join(", ")}.`,
    );
  }

  const name = (options.name ?? "").trim();
  if (!name) {
    throw new ExtensionScaffoldError("invalid-name", "A name is required.");
  }

  const slug = (options.folderName ?? slugify(name)).trim();
  if (!slug || slug !== slugify(slug)) {
    throw new ExtensionScaffoldError(
      "invalid-name",
      `Could not derive a valid folder name from "${name}".`,
    );
  }

  // Validated BEFORE anything touches disk, so a bad prefix never leaves a
  // half-written folder behind.
  const prefix = resolveExtensionPrefix(slug, options.prefix);

  const parentDir = options.parentDir;
  if (!parentDir || !path.isAbsolute(parentDir)) {
    throw new ExtensionScaffoldError(
      "parent-not-writable",
      "The save location must be an absolute path.",
    );
  }
  try {
    await access(parentDir, FS.W_OK);
  } catch {
    throw new ExtensionScaffoldError(
      "parent-not-writable",
      `The chosen save location can't be written to: ${parentDir}`,
    );
  }

  const extensionDir = path.join(parentDir, slug);
  let targetExists = true;
  try {
    await access(extensionDir, FS.F_OK);
  } catch {
    targetExists = false;
  }
  if (targetExists) {
    throw new ExtensionScaffoldError(
      "target-exists",
      `A folder named "${slug}" already exists here. Choose a different name or location.`,
    );
  }

  const author = (options.author ?? "").trim() || DEFAULT_AUTHOR;
  const description = (options.description ?? "").trim() || DEFAULT_DESCRIPTION[kind];

  // Two substitution tables, because the same value needs different escaping
  // depending on where it lands. A name containing a `"` would produce
  // unparseable JSON otherwise — and a scaffold that emits a broken
  // gutterpress.json is worse than no scaffold at all.
  const plain: Record<string, string> = {
    "{{NAME}}": name,
    "{{SLUG}}": slug,
    "{{PREFIX}}": prefix,
    "{{AUTHOR}}": author,
    "{{DESCRIPTION}}": description,
    "{{IDENT}}": identifierFor(slug),
  };
  const jsonSafe: Record<string, string> = Object.fromEntries(
    Object.entries(plain).map(([token, value]) => [token, escapeJsonScalar(value)]),
  );

  const entries = TEMPLATE_FILES[kind];
  const written: string[] = [];

  try {
    await mkdir(extensionDir, { recursive: true });
    for (const [assetName, relDest] of entries) {
      const src = await getAssetPath(`extension-templates/${kind}/${assetName}`);
      const dest = path.join(extensionDir, relDest);
      await mkdir(path.dirname(dest), { recursive: true });

      // Every template file is text. `.json` gets the escaped table so a name
      // containing a quote still produces parseable JSON — a scaffold that
      // emits a broken gutterpress.json is worse than no scaffold at all.
      const text = await readFile(src, "utf8");
      const table = relDest.endsWith(".json") ? jsonSafe : plain;
      await writeFile(dest, substitute(text, table), "utf8");
      written.push(relDest);
    }
  } catch (e) {
    throw new ExtensionScaffoldError(
      "scaffold-io",
      `Could not create the ${kind} files: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  return {
    extensionDir,
    manifestPath: path.join(extensionDir, "gutterpress.json"),
    kind,
    slug,
    prefix,
    openFile: path.join(extensionDir, OPEN_FILE[kind]),
    files: written,
  };
}

/** Replace every placeholder token in a template's text. */
function substitute(text: string, table: Record<string, string>): string {
  let out = text;
  for (const [token, value] of Object.entries(table)) {
    out = out.split(token).join(value);
  }
  return out;
}
