/**
 * Snippets (#29) — short, reusable markdown fragments stored per-project.
 *
 * Storage model (Occam's razor): each snippet is a plain `.md` file under the
 * project's `snippets/` folder. No database, no app-config store — the simplest
 * thing that works, and it travels with the project (and through version
 * history) for free. Both the CLI and the viewer host use this ONE module.
 *
 * Variable substitution is a deliberately tiny `{{name}}` → value map. The two
 * pure functions (`extractVariables`, `substituteVariables`) carry no IO and are
 * directly unit-tested; the fs helpers are thin wrappers used by the host IPC.
 */
import { readdir, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { slugify, prettify } from "./slug.ts";

/** Folder (relative to the project root) snippets live in. */
export const SNIPPETS_DIR = "snippets";

/** One snippet's metadata for the picker (no body — read lazily). */
export interface SnippetEntry {
  /** Display name (derived from the `.md` filename stem, prettified). */
  name: string;
  /** The on-disk filename, e.g. `callout.md`. Stable id for read/delete. */
  fileName: string;
  /** Distinct `{{variable}}` names parsed from the body, in first-seen order. */
  variables: string[];
}

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

/**
 * Parse the distinct `{{variable}}` placeholder names from a template, in the
 * order they first appear. Whitespace inside the braces is ignored. Pure.
 */
export function extractVariables(template: string): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const m of template.matchAll(PLACEHOLDER_RE)) {
    const name = m[1]!;
    if (!seen.has(name)) {
      seen.add(name);
      order.push(name);
    }
  }
  return order;
}

/**
 * Replace every `{{name}}` placeholder with `values[name]`. A name with no
 * provided value becomes the empty string (the caller prompts for values, so an
 * unanswered field simply collapses). Non-placeholder braces are left intact.
 * Pure.
 */
export function substituteVariables(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(PLACEHOLDER_RE, (_full, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? values[name]! : "",
  );
}

/** Resolve a snippet filename safely inside the project's snippets/ dir. */
function resolveSnippetPath(projectDir: string, fileName: string): string {
  const dir = path.resolve(projectDir, SNIPPETS_DIR);
  const full = path.resolve(dir, fileName);
  if (full !== path.join(dir, path.basename(fileName)) || path.dirname(full) !== dir) {
    throw new Error(`Unsafe snippet filename: ${fileName}`);
  }
  return full;
}

/**
 * List the project's snippets (newest filesystem order is not guaranteed; sort
 * for the picker). Returns `[]` when the `snippets/` folder doesn't exist.
 */
export async function listSnippets(projectDir: string): Promise<SnippetEntry[]> {
  const dir = path.join(projectDir, SNIPPETS_DIR);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const entries: SnippetEntry[] = [];
  for (const fileName of names) {
    if (!fileName.toLowerCase().endsWith(".md")) continue;
    let body = "";
    try {
      body = await readFile(path.join(dir, fileName), "utf8");
    } catch {
      continue;
    }
    entries.push({
      name: prettify(fileName.replace(/\.md$/i, "")),
      fileName,
      variables: extractVariables(body),
    });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}

/** Read one snippet's raw body. Refuses path traversal. */
export async function readSnippet(
  projectDir: string,
  fileName: string,
): Promise<string> {
  return readFile(resolveSnippetPath(projectDir, fileName), "utf8");
}

/**
 * Save a snippet body under `snippets/<slug(name)>.md`, creating the folder when
 * absent. Returns the stored entry (with its filename + parsed variables). The
 * returned `name` echoes the author-supplied name, while `fileName` is the
 * slugified storage name.
 */
export async function saveSnippet(
  projectDir: string,
  name: string,
  body: string,
): Promise<SnippetEntry> {
  const stem = slugify(name);
  if (!stem) throw new Error(`Could not derive a filename from "${name}".`);
  const fileName = `${stem}.md`;
  const dir = path.join(projectDir, SNIPPETS_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(resolveSnippetPath(projectDir, fileName), body, "utf8");
  return { name, fileName, variables: extractVariables(body) };
}

/** Delete a snippet by filename. Refuses path traversal. */
export async function deleteSnippet(
  projectDir: string,
  fileName: string,
): Promise<void> {
  await rm(resolveSnippetPath(projectDir, fileName), { force: true });
}
