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
 *     directory (the viewer passes `<userData>/templates`; the CLI a config dir).
 *     Each is a directory `<templatesRoot>/<id>/` containing the project's files
 *     with the title re-tokenised back to `{{TITLE}}` so it is reusable.
 *
 * This module is pure Node fs (no subprocess, no bundler) so it works under
 * `bun build --compile` and in the packaged viewer alike, and is consumed by
 * BOTH front-ends through the platform seam (CLAUDE.md: shared lib, one impl).
 */
import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { constants as FS } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";

import type { ProjectTemplateId } from "./project-scaffold.ts";
import { MANIFEST_FILENAMES } from "./manifest.ts";
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
  ".print-md",
  ".DS_Store",
]);

export interface SaveProjectAsTemplateOptions {
  /** Absolute path of the project to capture. */
  projectDir: string;
  /** Author-supplied template name. */
  name: string;
  /** Absolute directory custom templates are stored under. */
  templatesRoot: string;
}

/** A `.print-md-template.json` metadata sidecar written into each custom template. */
const TEMPLATE_META_FILE = ".print-md-template.json";

/**
 * Capture an existing project as a reusable custom template. Copies the whole
 * project tree (minus build/VCS dirs) into `<templatesRoot>/<slug(name)>/`, then
 * re-tokenises the project's title back to `{{TITLE}}` in the manifest so the
 * saved template scaffolds cleanly for the next book. Refuses to overwrite an
 * existing template directory (never deletes user data).
 */
export async function saveProjectAsTemplate(
  options: SaveProjectAsTemplateOptions,
): Promise<TemplateInfo> {
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

  // Re-tokenise the manifest so the template is reusable: replace the concrete
  // title/authors/output filename with the {{...}} placeholders the scaffolder
  // fills back in. Best-effort — a project may have an unusual manifest.
  const manifestName = MANIFEST_FILENAMES.find((name) =>
    entries.some((entry) => entry.name === name)
  );
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
  };
}

/** Replace concrete title/authors/output values in a manifest with placeholders. */
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
    .replace(/^(authors:[^\n]*\n[ \t]*-[ \t]*).*$/m, '$1"{{AUTHOR}}"')
    .replace(/^(\s*filename:\s*).*$/m, '$1"{{OUTPUT_PDF}}"');
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
