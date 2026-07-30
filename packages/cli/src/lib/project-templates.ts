/**
 * Project templates (#29) — starter skeletons for the New Project wizard.
 *
 * Two kinds of template share one shape ({@link TemplateInfo}):
 *
 *   - BUILT-IN: shipped as embedded assets (`assets/templates/<id>/`), baked into
 *     the CLI binary via `embedded-assets.ts`. There are four: book, ttrpg, zine,
 *     technical. Listing them is metadata-only (no fs scan needed).
 *
 *   - CUSTOM: saved by the author from an existing project ("Save as template")
 *     or imported from a folder. They live under a host-chosen `templatesRoot`
 *     directory (the desktop passes `<userData>/templates`; the CLI a config dir).
 *     Each is a directory `<templatesRoot>/<id>/` containing the project's files
 *     with the title re-tokenised back to `{{TITLE}}` so it is reusable.
 *
 * This module is pure Node fs (no subprocess, no bundler) so it works under
 * `bun build --compile` and in the packaged desktop alike, and is consumed by
 * BOTH front-ends through the platform seam (CLAUDE.md: shared lib, one impl).
 */
import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { constants as FS, existsSync } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { isMap, isScalar, isSeq } from "yaml";

import type { ProjectTemplateId } from "./project-scaffold.ts";
import { MANIFEST_FILENAMES } from "./manifest.ts";
import { loadManifestDoc, writeManifestDoc, scalarString } from "./manifest-doc.ts";
import { collectStyleDependencies, escapesProjectRoot } from "./asset-inline.ts";
import { slugify, prettify } from "./slug.ts";

/** The built-in templates shipped as embedded assets. */
export const BUILT_IN_TEMPLATE_IDS = [
  "book",
  "ttrpg",
  "zine",
  "technical",
] as const satisfies readonly ProjectTemplateId[];

/** Author-friendly metadata for one template (built-in or custom). */
export interface TemplateInfo {
  /** Stable id. For built-ins, the {@link ProjectTemplateId}; for custom, a slug. */
  id: string;
  /** Display name shown in the wizard. */
  label: string;
  /** One-line description shown under the label. */
  description: string;
  /** `"builtin"` (embedded) or `"custom"` (user-saved / imported). */
  kind: "builtin" | "custom";
  /** For custom templates: absolute directory the files live in. */
  dir?: string;
}

const BUILT_IN_META: Record<
  ProjectTemplateId,
  { label: string; description: string }
> = {
  book: {
    label: "Book",
    description: "A clean starting point for a novel, memoir, or any long-form book.",
  },
  ttrpg: {
    label: "TTRPG supplement",
    description: "Rules, stat blocks, and tables for a tabletop roleplaying supplement.",
  },
  zine: {
    label: "Zine",
    description: "A short, personal zine made to be printed, folded, and shared.",
  },
  technical: {
    label: "Technical document",
    description: "A manual or guide with steps, reference tables, and code examples.",
  },
};

/** List the built-in templates (metadata only — no fs access). */
export async function listBuiltInTemplates(): Promise<TemplateInfo[]> {
  return BUILT_IN_TEMPLATE_IDS.map((id) => ({
    id,
    label: BUILT_IN_META[id].label,
    description: BUILT_IN_META[id].description,
    kind: "builtin" as const,
  }));
}

/** Directory entries we never copy into a template (build output, git, etc.). */
const SKIP_ENTRIES = new Set([
  ".git",
  "node_modules",
  "out",
  "dist",
  "build",
  ".gutterpress",
  ".DS_Store",
]);

/**
 * What to do with manifest references that point OUTSIDE the captured book — a
 * repo-nested book's `../../shared/...` styles and authored plugins, which
 * would dangle once the template is scaffolded somewhere else.
 *
 *  - `"vendor"` (default): copy the referenced files — for a stylesheet, its
 *    whole `@import`/`url()` closure — INTO the template book-local, preserving
 *    the layout so the CSS's own relative refs still resolve, and rewrite the
 *    manifest entries to the book-local paths. Keeps the look; the template is
 *    a self-contained fork of the shared design at save time.
 *  - `"exclude"`: drop the escaping entries (copy nothing), leaving a
 *    book-local-only template.
 */
export type SharedRefMode = "vendor" | "exclude";

export interface SaveProjectAsTemplateOptions {
  /** Absolute path of the project to capture. */
  projectDir: string;
  /** Author-supplied template name. */
  name: string;
  /** Absolute directory custom templates are stored under. */
  templatesRoot: string;
  /** How to handle out-of-book (`../../shared/...`) refs. Defaults to `"vendor"`. */
  sharedRefs?: SharedRefMode;
}

/** The book-local vendor folder new entries are rewritten under (docs convention). */
const VENDOR_DIR = "shared";

/** POSIX-separator path, for manifest entries and portability across hosts. */
function toManifestPath(p: string): string {
  return p.split(path.sep).join("/");
}

/**
 * Deepest directory that is an ancestor of every one of `absFiles`. Used as the
 * base whose layout the vendor copy preserves, so a stylesheet and the fonts /
 * partials it references keep their relative offsets and its `url()`/`@import`
 * still resolve after the move.
 */
function commonAncestorDir(absFiles: string[]): string {
  const dirSegs = absFiles.map((f) => path.resolve(f).split(path.sep).slice(0, -1));
  if (dirSegs.length === 0) return "";
  let common = dirSegs[0]!;
  for (const segs of dirSegs.slice(1)) {
    let i = 0;
    while (i < common.length && i < segs.length && common[i] === segs[i]) i++;
    common = common.slice(0, i);
  }
  return common.join(path.sep) || path.sep;
}

/** Pick a top-level vendor folder in `templateDir` that doesn't collide with a copied entry. */
function pickVendorDir(templateDir: string, base: string): string {
  const preferred = path.basename(base) || VENDOR_DIR;
  if (!existsSync(path.join(templateDir, preferred))) return preferred;
  for (let n = 1; ; n++) {
    const candidate = `${preferred}-${n}`;
    if (!existsSync(path.join(templateDir, candidate))) return candidate;
  }
}

/** The outcome of reconciling a captured book's out-of-book manifest refs. */
export interface SharedRefOutcome {
  /** Book-local paths the escaping refs were vendored to (`"vendor"` mode). */
  vendoredRefs: string[];
  /** Manifest entries dropped because they pointed outside the book (`"exclude"` mode). */
  excludedRefs: string[];
}

/** A `.gutterpress-template.json` metadata sidecar written into each custom template. */
const TEMPLATE_META_FILE = ".gutterpress-template.json";

/**
 * Reconcile a captured book's OUT-OF-BOOK manifest refs (`../../shared/...`
 * styles and authored plugin `path:` entries) so the template is portable —
 * see {@link SharedRefMode}. Operates on the template's COPIED manifest
 * (`templateDir`) but resolves the referenced files against the ORIGINAL
 * `sourceProjectDir`, since that is where they actually live. Comment- and
 * formatting-preserving (yaml Document API). A no-op when nothing escapes.
 */
async function reconcileSharedRefs(
  templateDir: string,
  sourceProjectDir: string,
  mode: SharedRefMode,
): Promise<SharedRefOutcome> {
  const { doc, file } = await loadManifestDoc(templateDir);
  const escapes = (p: string): boolean =>
    escapesProjectRoot(sourceProjectDir, path.resolve(sourceProjectDir, p));

  // The escaping `styles:` entries (scalars) and authored-plugin file paths
  // (a plugin item is a bare string OR a `{ path }` map; npm entries have no
  // resolvable file and are skipped).
  const stylesSeq = doc.get("styles", true);
  const styleNodes = isSeq(stylesSeq) ? stylesSeq.items : [];
  const escapingStyles = styleNodes
    .map((node) => ({ node, value: scalarString(node) }))
    .filter((s): s is { node: (typeof styleNodes)[number]; value: string } =>
      s.value !== null && escapes(s.value),
    );

  const pluginsSeq = doc.get("plugins", true);
  const pluginNodes = isSeq(pluginsSeq) ? pluginsSeq.items : [];
  const escapingPlugins = pluginNodes
    .map((node) => {
      const value = isMap(node) ? scalarString(node.get("path", true)) : scalarString(node);
      return { node, value };
    })
    .filter((p): p is { node: (typeof pluginNodes)[number]; value: string } =>
      p.value !== null && escapes(p.value),
    );

  if (escapingStyles.length === 0 && escapingPlugins.length === 0) {
    return { vendoredRefs: [], excludedRefs: [] };
  }

  if (mode === "exclude") {
    const excludedRefs = [
      ...escapingStyles.map((s) => s.value),
      ...escapingPlugins.map((p) => p.value),
    ];
    if (isSeq(stylesSeq)) {
      stylesSeq.items = styleNodes.filter((n) => !escapingStyles.some((s) => s.node === n));
      if (stylesSeq.items.length === 0) doc.delete("styles");
    }
    if (isSeq(pluginsSeq)) {
      pluginsSeq.items = pluginNodes.filter((n) => !escapingPlugins.some((p) => p.node === n));
      if (pluginsSeq.items.length === 0) doc.delete("plugins");
    }
    await writeManifestDoc(file, doc);
    return { vendoredRefs: [], excludedRefs };
  }

  // vendor: copy each escaping ref's file(s) in and rewrite the entry.
  // A stylesheet drags its whole `@import`/`url()` closure; a plugin is its one
  // referenced file (best-effort — a plugin with its own relative imports would
  // need those copied too, but authored plugins are single self-contained files
  // per CLAUDE.md §5). Only files that live OUTSIDE the book are vendored; a
  // closure entry already inside it is part of the tree copy already.
  const styleClosure = await collectStyleDependencies(
    sourceProjectDir,
    escapingStyles.map((s) => s.value),
  );
  const pluginFiles = escapingPlugins.map((p) => path.resolve(sourceProjectDir, p.value));
  const externalFiles = [...new Set([...styleClosure, ...pluginFiles])].filter((f) =>
    escapesProjectRoot(sourceProjectDir, f),
  );

  const base = commonAncestorDir(externalFiles);
  const vendorDir = pickVendorDir(templateDir, base);

  // Copy every external file that exists, preserving its offset from `base`.
  for (const abs of externalFiles) {
    if (!existsSync(abs)) continue; // missing at source — the build reports it
    const dest = path.join(templateDir, vendorDir, path.relative(base, abs));
    await mkdir(path.dirname(dest), { recursive: true });
    await cp(abs, dest);
  }

  // Rewrite each escaping entry to its new book-local path.
  const bookLocal = (value: string): string =>
    toManifestPath(path.join(vendorDir, path.relative(base, path.resolve(sourceProjectDir, value))));
  const vendoredRefs: string[] = [];
  for (const { node, value } of escapingStyles) {
    if (isScalar(node)) {
      node.value = bookLocal(value);
      vendoredRefs.push(node.value as string);
    }
  }
  for (const { node, value } of escapingPlugins) {
    const rewritten = bookLocal(value);
    if (isMap(node)) node.set("path", rewritten);
    else if (isScalar(node)) node.value = rewritten;
    vendoredRefs.push(rewritten);
  }

  await writeManifestDoc(file, doc);
  return { vendoredRefs, excludedRefs: [] };
}

/**
 * Capture an existing project as a reusable custom template. Copies the whole
 * project tree (minus build/VCS dirs) into `<templatesRoot>/<slug(name)>/`,
 * reconciles any out-of-book (`../../shared/...`) refs so the template is
 * portable ({@link SharedRefMode} — vendor by default), then re-tokenises the
 * project's title back to `{{TITLE}}` in the manifest so the saved template
 * scaffolds cleanly for the next book. Refuses to overwrite an existing
 * template directory (never deletes user data).
 */
export async function saveProjectAsTemplate(
  options: SaveProjectAsTemplateOptions,
): Promise<TemplateInfo & SharedRefOutcome> {
  const { projectDir, name, templatesRoot } = options;
  const id = slugify(name);
  if (!id) throw new Error(`Could not derive a template id from "${name}".`);

  const dir = path.join(templatesRoot, id);
  let exists = true;
  try {
    await access(dir, FS.F_OK);
  } catch {
    exists = false;
  }
  if (exists) {
    throw new Error(
      `A template named "${name}" already exists. Choose a different name.`,
    );
  }

  await mkdir(dir, { recursive: true });

  // Copy each top-level entry except build/VCS noise.
  const entries = await readdir(projectDir, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_ENTRIES.has(entry.name)) continue;
    if (entry.name === TEMPLATE_META_FILE) continue;
    await cp(
      path.join(projectDir, entry.name),
      path.join(dir, entry.name),
      { recursive: true },
    );
  }

  const manifestName = MANIFEST_FILENAMES.find((name) =>
    entries.some((entry) => entry.name === name)
  );

  // Make out-of-book refs portable BEFORE re-tokenising (both edit the copied
  // manifest; keeping them separate leaves each step simple).
  const shared: SharedRefOutcome = manifestName
    ? await reconcileSharedRefs(dir, projectDir, options.sharedRefs ?? "vendor")
    : { vendoredRefs: [], excludedRefs: [] };

  // Re-tokenise the manifest so the template is reusable: replace the concrete
  // title/authors with the {{...}} placeholders the scaffolder fills back in.
  // Best-effort — a project may have an unusual manifest.
  if (manifestName) await retokeniseManifest(path.join(dir, manifestName));

  // Write a metadata sidecar so the label survives even if the id is renamed.
  await writeFile(
    path.join(dir, TEMPLATE_META_FILE),
    JSON.stringify({ label: name }, null, 2),
    "utf8",
  );

  return {
    id,
    label: name,
    description: "Your saved template.",
    kind: "custom",
    dir,
    ...shared,
  };
}

/**
 * Replace concrete title/authors values in a manifest with placeholders.
 *
 * NOTE: this used to also re-tokenise `output.filename` back to
 * `{{OUTPUT_PDF}}`. `output:` is no longer a valid manifest field —
 * `resolveConfig` throws a `UsageError` if a manifest still carries one — so
 * a project a user can actually save as a template can never have a
 * `filename:` key to rewrite. That branch (and the `{{OUTPUT_PDF}}` token
 * it produced) was removed rather than kept as permanently-dead pattern
 * matching.
 */
async function retokeniseManifest(manifestPath: string): Promise<void> {
  let text: string;
  try {
    text = await readFile(manifestPath, "utf8");
  } catch {
    return; // No manifest — leave the template as-is.
  }
  text = text
    .replace(/^title:\s*.*$/m, 'title: "{{TITLE}}"')
    // Re-tokenise ONLY the first list item that belongs to the `authors:` block
    // (anchored to the `authors:` key) — not just any first `- item`, which
    // would clobber a `source.files:` entry in manifests that list source
    // before authors. Inline `authors:` (no block list) is left as-is.
    .replace(/^(authors:[^\n]*\n[ \t]*-[ \t]*).*$/m, '$1"{{AUTHOR}}"');
  await writeFile(manifestPath, text, "utf8");
}

/**
 * List custom templates saved under `templatesRoot`. Returns `[]` when the root
 * doesn't exist. Each subdirectory is a template; its label comes from the
 * metadata sidecar (falling back to a prettified id).
 */
export async function listCustomTemplates(
  templatesRoot: string,
): Promise<TemplateInfo[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(templatesRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: TemplateInfo[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(templatesRoot, entry.name);
    let label = prettify(entry.name);
    try {
      const meta = JSON.parse(
        await readFile(path.join(dir, TEMPLATE_META_FILE), "utf8"),
      ) as { label?: string };
      if (typeof meta.label === "string" && meta.label) label = meta.label;
    } catch {
      // No/!valid sidecar — keep the prettified id.
    }
    out.push({ id: entry.name, label, description: "Your saved template.", kind: "custom", dir });
  }
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}

/**
 * Import a template from an arbitrary folder by copying it under `templatesRoot`.
 * Thin wrapper around the same copy logic as save-as-template, used by the
 * wizard's "Import template…" action. Refuses to overwrite an existing id.
 */
export async function importTemplateFromFolder(options: {
  sourceDir: string;
  name?: string;
  templatesRoot: string;
}): Promise<TemplateInfo> {
  const { sourceDir, templatesRoot } = options;
  const srcStat = await stat(sourceDir);
  if (!srcStat.isDirectory()) {
    throw new Error("The chosen path is not a folder.");
  }
  const name = options.name?.trim() || prettify(path.basename(sourceDir));
  return saveProjectAsTemplate({ projectDir: sourceDir, name, templatesRoot });
}
