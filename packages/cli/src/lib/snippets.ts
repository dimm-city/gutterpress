/**
 * Snippets (#29) — short, reusable markdown fragments stored per-project.
 *
 * Storage model (Occam's razor): each snippet is a plain `.md` file under the
 * project's `snippets/` folder. No database, no app-config store — the simplest
 * thing that works, and it travels with the project (and through version
 * history) for free. Both the CLI and the desktop host use this ONE module.
 *
 * Variable substitution is a deliberately tiny `{{name}}` → value map. The two
 * pure functions (`extractVariables`, `substituteVariables`) carry no IO and are
 * directly unit-tested; the fs helpers are thin wrappers used by the host IPC.
 *
 * Snippets come from three LEVELS — the book (`<projectDir>/snippets/`), its
 * installed extensions (package.json's `gutterpress.snippets` folder, #242),
 * and core (reserved: Gutterpress ships none yet). Every entry says which
 * level it came from (`source`), and same-named snippets at different levels
 * all stay listed. Where only ONE copy can be used — a component's example
 * snippet, inserted by `@` autocomplete — the book's copy wins, then the
 * extension's, then core's ({@link listMarkerComponents}).
 *
 * Writes stay book-only: `saveSnippet`/`deleteSnippet` only ever touch
 * `<projectDir>/snippets/`. The library is recomputed from scratch on every
 * call, so a removed or disabled extension's snippets simply stop appearing.
 */
import { readdir, readFile, writeFile, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";

import { slugify, prettify } from "./slug.ts";
import { pathEscapesFolder, readExtensionMeta } from "./extension-manifest.ts";
import { extensionConfigFor, listProjectExtensions, type ProjectExtensionEntry } from "./extension-manager.ts";
import { loadPlugin } from "./markdown/plugins.ts";
import { buildDeclaredMarkerRegistry } from "./markdown/markers.js";

/** Folder (relative to the project root) snippets live in. */
export const SNIPPETS_DIR = "snippets";

/**
 * Which level a snippet comes from. `project` is the book's own (the only
 * level `saveSnippet`/`deleteSnippet` touch, so the only one the picker offers
 * to delete); `extension` is read-only, from an enabled extension — `name` is
 * its display name, `ref` its manifest specifier; `core` is reserved for
 * snippets Gutterpress itself will ship.
 */
export type SnippetSource =
  | { kind: "project" }
  | { kind: "extension"; ref: string; name: string }
  | { kind: "core" };

/** Precedence when one copy must be chosen: book, then extension, then core. */
const LEVEL_RANK: Record<SnippetSource["kind"], number> = { project: 0, extension: 1, core: 2 };

/** One snippet, as the picker lists it. */
export interface SnippetEntry {
  /** Display name (derived from the filename stem, prettified). */
  name: string;
  /** The file, relative to its level's snippets folder (an extension
   *  component's explicit `snippet:` path is relative to the extension). */
  fileName: string;
  /** Distinct `{{variable}}` names parsed from the body, in first-seen order. */
  variables: string[];
  /** The snippet's text. */
  body: string;
  /** Which level it comes from — see {@link SnippetSource}. */
  source: SnippetSource;
  /** Set when this is the example snippet for that component (marker name). */
  component?: string;
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

/** Resolve a snippet filename safely as a direct child of the project's snippets/ dir. */
function resolveSnippetPath(projectDir: string, fileName: string): string {
  const dir = path.resolve(projectDir, SNIPPETS_DIR);
  const full = path.resolve(dir, fileName);
  if (full !== path.join(dir, path.basename(fileName)) || path.dirname(full) !== dir) {
    throw new Error(`Unsafe snippet filename: ${fileName}`);
  }
  return full;
}

/** `{name, fileName, variables, body}` for every `.md` file directly inside
 *  `dir` (newest-filesystem-order is not guaranteed; sorted for the picker).
 *  Returns `[]` when `dir` doesn't exist, or (silently) can't be read — the
 *  SAME tolerant shape `listSnippets` always had for a project with no
 *  `snippets/` folder, now shared with #242's per-extension scan so one
 *  missing/unreadable extension folder degrades to "no snippets from it"
 *  instead of an error. An individual unreadable FILE is skipped the same
 *  way, not fatal to the rest of the listing. */
async function scanSnippetFiles(
  dir: string,
): Promise<Array<{ name: string; fileName: string; variables: string[]; body: string }>> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const entries: Array<{ name: string; fileName: string; variables: string[]; body: string }> = [];
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
      body,
    });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}

/** The book's own snippets only — `<projectDir>/snippets/`. */
export async function listSnippets(projectDir: string): Promise<SnippetEntry[]> {
  const files = await scanSnippetFiles(path.join(projectDir, SNIPPETS_DIR));
  return files.map((file) => ({ ...file, source: { kind: "project" } as const }));
}

/**
 * Save a snippet body under `snippets/<slug(name)>.md`, creating the folder when
 * absent. Returns the stored entry (with its filename + parsed variables). The
 * returned `name` echoes the author-supplied name, while `fileName` is the
 * slugified storage name.
 *
 * #242: always writes to (and returns a `source` naming) the PROJECT's own
 * folder — "Save selection as snippet" keeps writing to the project even
 * when the picker is currently showing a merged list that includes
 * extension-provided entries (the issue's suggested shape, point 4). There is
 * no parameter that could redirect this into an extension's folder.
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
  return { name, fileName, variables: extractVariables(body), body, source: { kind: "project" } };
}

/**
 * Delete a snippet by filename. Refuses path traversal.
 *
 * #242: project snippets ONLY — `resolveSnippetPath` hard-scopes every path
 * to `<projectDir>/snippets/`, so this function is structurally incapable of
 * reaching into an installed extension's folder no matter what `fileName` a
 * caller passes (there is no argument that names an extension at all). An
 * extension's own snippet files are therefore never at risk from the
 * picker's delete button — the safety is in the function signature, not in
 * a check the picker has to remember to make.
 */
export async function deleteSnippet(
  projectDir: string,
  fileName: string,
): Promise<void> {
  await rm(resolveSnippetPath(projectDir, fileName), { force: true });
}

// ── The snippet library: book, extension and core levels ───────────────────

/**
 * One plugin-declared marker (a "component", `export const markers`) the
 * project can use, with the example snippet the editor inserts for it.
 * Unrelated to the `gutterpress.components` catalog file, which nothing reads.
 */
export interface MarkerComponent {
  /** The marker name, without `@` — e.g. `term-box`. */
  name: string;
  /** The extension that declares it. */
  source: Extract<SnippetSource, { kind: "extension" }>;
  /** The variant names the marker accepts as its bare word (`@name <variant>`),
   *  as the renderer resolves them — an alias lists its target's. A variant
   *  only adds a class, so one snippet serves them all. */
  variants: string[];
  /** The winning example snippet's body (book, then extension, then core). */
  snippet?: string;
}

/** An extension's declared snippets folder, relative to the extension, or
 *  null when it declares none (or one that escapes its folder). */
async function declaredSnippetsFolder(entry: ProjectExtensionEntry): Promise<string | null> {
  if (!entry.dir || !entry.carries.snippets) return null;
  const rel = (await readExtensionMeta(entry.dir)).snippets?.trim();
  return rel && !pathEscapesFolder(rel) ? rel : null;
}

/** An extension's declared markers, or undefined when it has none or fails
 *  to load (load errors are reported by the Features tab and Problems). */
async function declaredMarkers(
  entry: ProjectExtensionEntry,
  projectDir: string,
): Promise<Record<string, { snippet?: unknown }> | undefined> {
  if (!entry.carries.markdown) return undefined;
  try {
    return (await loadPlugin(extensionConfigFor(entry), projectDir)).markers;
  } catch {
    return undefined;
  }
}

/**
 * Every snippet at every level, plus every component with its winning
 * snippet. Order: the book's snippets, then each extension's (alphabetical by
 * display name), each run alphabetical by snippet name.
 *
 * A component's snippet is, at the extension level, the marker's own
 * `snippet:` path (relative to the extension folder) or by default
 * `<snippets folder>/<name>.md` (folder: `gutterpress.snippets`, else
 * `snippets`); at the book level, `snippets/<name>.md`. Each match is tagged
 * `component` in the list; the highest level wins for the component.
 */
async function collectLibrary(
  projectDir: string,
): Promise<{ snippets: SnippetEntry[]; components: MarkerComponent[] }> {
  const groups: Array<{ label: string; snippets: SnippetEntry[] }> = [];
  const components: MarkerComponent[] = [];

  // Pass 1: each enabled, loadable extension's snippet files and raw markers.
  const loaded: Array<{
    entry: ProjectExtensionEntry;
    source: MarkerComponent["source"];
    folder: string | null;
    snippets: SnippetEntry[];
    markers: Record<string, { snippet?: unknown }> | undefined;
  }> = [];
  for (const entry of await listProjectExtensions(projectDir)) {
    if (!entry.enabled) continue;
    const source: MarkerComponent["source"] = { kind: "extension", ref: entry.use, name: entry.label };
    const folder = await declaredSnippetsFolder(entry);
    const snippets: SnippetEntry[] = folder
      ? (await scanSnippetFiles(path.join(entry.dir!, folder))).map((file) => ({ ...file, source }))
      : [];
    loaded.push({ entry, source, folder, snippets, markers: await declaredMarkers(entry, projectDir) });
  }

  // Resolve every declaration through the renderer's own registry, so the
  // editor and the renderer agree on aliases and variants. Registry errors
  // (a name two plugins both declare, a malformed declaration) are already
  // reported by validation / Problems, so here they just mean "no components
  // listed" rather than a failed listing; snippet files are still listed.
  let registry: Map<string, { deprecated?: string; variants?: Record<string, string> }> | undefined;
  try {
    registry = buildDeclaredMarkerRegistry(
      loaded.flatMap((l) => (l.markers ? [{ pluginName: l.entry.label, markers: l.markers }] : [])),
    );
  } catch {
    registry = undefined;
  }

  // Pass 2: components, and the link from each to its snippet file.
  for (const { entry, source, folder, snippets, markers } of loaded) {
    for (const [name, decl] of Object.entries(registry ? (markers ?? {}) : {})) {
      const resolved = registry!.get(name);
      if (!resolved || resolved.deprecated !== undefined) continue;
      components.push({ name, source, variants: Object.keys(resolved.variants ?? {}) });
      if (!entry.dir) continue;
      const own = typeof decl.snippet === "string" && decl.snippet.trim() ? decl.snippet.trim() : null;
      const rel = own ?? path.join(folder ?? SNIPPETS_DIR, `${name}.md`);
      if (pathEscapesFolder(rel)) continue;
      const listed =
        folder && path.dirname(path.join(entry.dir, rel)) === path.join(entry.dir, folder)
          ? snippets.find((s) => s.fileName === path.basename(rel))
          : undefined;
      if (listed) {
        listed.component = name;
        continue;
      }
      const body = await readFile(path.join(entry.dir, rel), "utf8").catch(() => null);
      if (body === null) continue;
      snippets.push({
        name: prettify(path.basename(rel).replace(/\.md$/i, "")),
        fileName: rel.split(path.sep).join("/"),
        variables: extractVariables(body),
        body,
        source,
        component: name,
      });
    }

    if (snippets.length) {
      snippets.sort((a, b) => a.name.localeCompare(b.name));
      groups.push({ label: entry.label, snippets });
    }
  }

  // The book's own `snippets/<component>.md` is that component's snippet too.
  const book = await listSnippets(projectDir);
  const names = new Set(components.map((c) => c.name));
  for (const s of book) {
    const stem = s.fileName.replace(/\.md$/i, "").toLowerCase();
    if (names.has(stem)) s.component = stem;
  }

  groups.sort((a, b) => a.label.localeCompare(b.label));
  const snippets = [...book, ...groups.flatMap((g) => g.snippets)];

  for (const component of components) {
    let best: SnippetEntry | undefined;
    for (const s of snippets) {
      if (s.component !== component.name) continue;
      if (s.source.kind === "extension" && s.source.ref !== component.source.ref) continue;
      if (!best || LEVEL_RANK[s.source.kind] < LEVEL_RANK[best.source.kind]) best = s;
    }
    if (best) component.snippet = best.body;
  }
  components.sort((a, b) => a.name.localeCompare(b.name));
  return { snippets, components };
}

/** Every snippet the project can insert, from every level — see {@link collectLibrary}. */
export async function listMergedSnippets(projectDir: string): Promise<SnippetEntry[]> {
  return (await collectLibrary(projectDir)).snippets;
}

/** Every component the project's enabled extensions declare, each with its
 *  winning example snippet (book > extension > core) — see {@link collectLibrary}. */
export async function listMarkerComponents(projectDir: string): Promise<MarkerComponent[]> {
  return (await collectLibrary(projectDir)).components;
}
