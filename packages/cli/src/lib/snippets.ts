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
 * #242 — an installed extension may now ALSO contribute snippets, declared as
 * `gutterpress.json`'s `snippets` field (#241, `extension-manifest.ts`). This
 * module — "the snippet host" the issue names — is deliberately the ONE place
 * that merge happens: `listMergedSnippets` is the sole new entry point the
 * picker calls; `readExtensionSnippet` is its lazy-body-read counterpart.
 * Everything below `extractVariables`/`substituteVariables`/`listSnippets`/
 * `readSnippet`/`saveSnippet`/`deleteSnippet` is UNCHANGED — the author's own
 * `snippets/` folder is still read, written, and deleted exactly as before,
 * by the exact same functions, so nothing about the existing project-snippet
 * flow can regress. This is a second READ path layered on top, not a second
 * snippet subsystem: no new storage format, no new substitution rules, no
 * change to what `saveSnippet`/`deleteSnippet` are allowed to touch (still
 * only ever `<projectDir>/snippets/`).
 *
 * Where an extension's snippets are discovered — and where they deliberately
 * are NOT — is documented on {@link listInstalledExtensions}. The three
 * questions #242 asks every implementer to settle are answered right where
 * the code makes each call:
 *
 *   - PRECEDENCE / collision  → {@link listMergedSnippets}'s doc comment.
 *   - PROVENANCE in the UI    → {@link SnippetEntry.source}'s doc comment
 *     (the picker reads this field; nothing here renders UI).
 *   - REMOVAL                 → {@link listInstalledExtensions}'s doc comment
 *     ("removal" needs no delete code of its own: the merge is recomputed
 *     from scratch on every call, so an uninstalled extension's snippets
 *     simply stop being enumerated on the very next list).
 */
import { readdir, readFile, writeFile, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";

import { slugify, prettify } from "./slug.ts";
import { pathEscapesFolder, readExtensionMeta } from "./extension-manifest.ts";
import { listProjectPlugins } from "./plugin-manager.ts";
import { getActiveTheme, THEMES_DIR } from "./theme-manager.ts";

/** Folder (relative to the project root) snippets live in. */
export const SNIPPETS_DIR = "snippets";

/**
 * Where a merged-list entry came from (#242).
 *
 * `{ kind: "project" }` — the author's own snippet, from `<projectDir>/
 * snippets/`. This is the ONLY provenance `saveSnippet`/`deleteSnippet` ever
 * produce or touch, and therefore the ONLY provenance the picker may offer to
 * edit or delete — a `source` this shape is the single flag the UI needs to
 * gate those actions, so "can this be deleted" never drifts out of sync with
 * "where did this come from" (one field, not two that could disagree).
 *
 * `{ kind: "plugin" | "theme", ref, name }` — a READ-ONLY snippet merged in
 * from an installed, currently-ACTIVE extension (see
 * {@link listInstalledExtensions} for exactly which extensions qualify).
 * `name` is the extension's display name — the picker's group label, so an
 * author always sees WHICH extension a snippet came from, never just "not
 * mine". `ref` is the same stable identifier {@link listProjectPlugins} (a
 * plugin's manifest `path`) or {@link getActiveTheme} (a theme's project id)
 * already hand out; it is round-tripped back into {@link readExtensionSnippet}
 * so that function can re-derive the extension's folder itself from a small,
 * validated identifier instead of trusting a filesystem path a caller could
 * construct.
 */
export type SnippetSource =
  | { kind: "project" }
  | { kind: "plugin" | "theme"; ref: string; name: string };

/** One snippet's metadata for the picker (no body — read lazily). */
export interface SnippetEntry {
  /** Display name (derived from the `.md` filename stem, prettified). */
  name: string;
  /** The on-disk filename, e.g. `callout.md`. Stable id for read/delete
   *  WITHIN its own source — an extension entry's `fileName` is only ever
   *  resolved back to a file via {@link readExtensionSnippet} (which also
   *  needs `source`), never via the project-only {@link readSnippet}. */
  fileName: string;
  /** Distinct `{{variable}}` names parsed from the body, in first-seen order. */
  variables: string[];
  /** Provenance (#242) — see {@link SnippetSource}. */
  source: SnippetSource;
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

/**
 * Resolve `fileName` safely as a DIRECT (non-nested, non-traversing) child of
 * `dir`. Shared by the project's own `snippets/` resolution and (#242) an
 * extension's declared snippets folder — the identical "no slashes, no `..`"
 * shape either root needs, written once rather than copied.
 */
function resolveSafeChildFile(dir: string, fileName: string): string {
  const full = path.resolve(dir, fileName);
  if (full !== path.join(dir, path.basename(fileName)) || path.dirname(full) !== dir) {
    throw new Error(`Unsafe snippet filename: ${fileName}`);
  }
  return full;
}

/** Resolve a snippet filename safely inside the project's snippets/ dir. */
function resolveSnippetPath(projectDir: string, fileName: string): string {
  return resolveSafeChildFile(path.resolve(projectDir, SNIPPETS_DIR), fileName);
}

/** Bare `{name, fileName, variables}` for every `.md` file directly inside
 *  `dir` (newest-filesystem-order is not guaranteed; sorted for the picker).
 *  Returns `[]` when `dir` doesn't exist, or (silently) can't be read — the
 *  SAME tolerant shape `listSnippets` always had for a project with no
 *  `snippets/` folder, now shared with #242's per-extension scan so one
 *  missing/unreadable extension folder degrades to "no snippets from it"
 *  instead of an error. An individual unreadable FILE is skipped the same
 *  way, not fatal to the rest of the listing. */
async function scanSnippetFiles(
  dir: string,
): Promise<Array<{ name: string; fileName: string; variables: string[] }>> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const entries: Array<{ name: string; fileName: string; variables: string[] }> = [];
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

/**
 * List the project's OWN snippets only — `<projectDir>/snippets/`, exactly as
 * before #242. The picker itself now calls {@link listMergedSnippets} (which
 * calls this as its first step); this stays exported and unchanged in
 * behavior because it is independently useful (and independently tested) as
 * "just the author's own snippets", with no extension-discovery cost paid by
 * a caller that doesn't need it.
 */
export async function listSnippets(projectDir: string): Promise<SnippetEntry[]> {
  const files = await scanSnippetFiles(path.join(projectDir, SNIPPETS_DIR));
  return files.map((file) => ({ ...file, source: { kind: "project" } as const }));
}

/** Read one snippet's raw body. Refuses path traversal. Project snippets
 *  only — see {@link readExtensionSnippet} for the merged-list counterpart
 *  that reads an extension-provided entry instead. */
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
  return { name, fileName, variables: extractVariables(body), source: { kind: "project" } };
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

// ── Extension snippet merge (#242) ──────────────────────────────────────────

/** One installed extension folder that declares a (trimmed, non-empty)
 *  `snippets` path — everything {@link listMergedSnippets}/
 *  {@link readExtensionSnippet} need to enumerate or re-locate it. Module-
 *  private: callers only ever see the merged {@link SnippetEntry} list, never
 *  this intermediate shape. */
interface InstalledExtension {
  /** Stable identifier round-tripped through {@link SnippetSource.ref}: a
   *  plugin's manifest `path`, or the active theme's project id. Used ONLY
   *  to re-find this same extension later — never written to disk, never
   *  itself a filesystem path. */
  ref: string;
  kind: "plugin" | "theme";
  /** Absolute path to the extension's OWN folder (where its gutterpress.json
   *  or theme.json lives) — may lie outside `projectDir` for a plugin `path:`
   *  entry shared across a multi-book repo, exactly as `loadPlugin` already
   *  allows (see this interface's doc comment on trust below). */
  dir: string;
  /** Display name for the picker's group header. */
  name: string;
  /** The metadata's OWN `snippets` field, trimmed and confirmed non-empty —
   *  still relative, NOT yet existence- or containment-checked (that is
   *  {@link extensionSnippetsDir}'s job, done tolerantly at each use). */
  snippetsRel: string;
}

/**
 * Discover which installed extensions are currently ACTIVE for this project
 * — i.e. actually contributing to the book being built right now, not merely
 * present on disk — and declare a `snippets` folder. Two families, matching
 * the only two places #241 metadata is read from a real on-disk folder that
 * THIS project actually loads:
 *
 *   - The project's ACTIVE theme ({@link getActiveTheme}) — deliberately NOT
 *     every folder `listProjectThemes` would return. Applying a theme keeps
 *     the OUTGOING theme's folder on disk (so "Revert to previous theme" has
 *     something to revert to); that dormant folder's CSS is no longer in the
 *     manifest's `styles:` list, so markup for its classes would render
 *     unstyled with no indication why. Only the theme actually wired into
 *     `styles:` qualifies.
 *   - Every ENABLED `plugins:` entry whose `path` names a DIRECTORY
 *     ({@link listProjectPlugins}, `kind === "local"`) — the ONLY plugin
 *     shape `markdown/plugins.ts`'s `loadExtensionFromDir` ever reads a
 *     gutterpress.json/theme.json out of. A `disabled` entry is skipped for
 *     the same reason a dormant theme is: `loadPlugins` never loads it, so
 *     nothing it declares (styles, markdown, OR snippets) is live. An
 *     npm-installed plugin (`kind === "npm"`) is skipped too, but for a
 *     different reason — `loadPlugin` resolves a `name:`-only entry through
 *     `loadNpmPackage`, which never reaches `loadExtensionFromDir` at all
 *     today, so even a vendored package that happens to bundle a
 *     `gutterpress.json` has no metadata this build actually consults. This
 *     is not a permanent restriction, just an accurate reflection of what
 *     the loader currently wires up: the day an npm-installed extension's
 *     `gutterpress.json` becomes load-bearing, this function gains it for
 *     free (same `readExtensionMeta` call, different `dir`).
 *
 * REMOVAL (#242, point 3): uninstalling/removing an extension needs no
 * dedicated cleanup code here. This function re-derives the list from
 * scratch on every call by re-reading the manifest and the theme's own
 * metadata — a plugin entry removed from `plugins:` (or a theme no longer
 * active) simply stops being returned on the very next call, taking its
 * snippets out of {@link listMergedSnippets}'s result with it. The author's
 * OWN snippets, read by the entirely separate {@link listSnippets} call this
 * function's caller also makes, are untouched either way.
 *
 * Tolerant throughout, matching every other "list installed X" surface in
 * this codebase (`listProjectThemes`, `listProjectPlugins`): a missing
 * folder, an unparseable metadata file, or a declared `snippets` path that
 * escapes its own folder is silently skipped rather than thrown — one
 * misconfigured or malicious extension must not blank the picker for every
 * OTHER extension, or for the author's own snippets.
 */
async function listInstalledExtensions(projectDir: string): Promise<InstalledExtension[]> {
  const out: InstalledExtension[] = [];

  // ThemeInfo.snippets (#241) is already the parsed, trimmed-if-present
  // field getActiveTheme's own themeInfo() builder produces — no second
  // metadata read needed here.
  const activeTheme = await getActiveTheme(projectDir);
  const themeSnippets = activeTheme?.snippets?.trim();
  if (activeTheme && themeSnippets) {
    out.push({
      ref: activeTheme.id,
      kind: "theme",
      dir: path.join(projectDir, THEMES_DIR, activeTheme.id),
      name: activeTheme.name,
      snippetsRel: themeSnippets,
    });
  }

  for (const entry of await listProjectPlugins(projectDir)) {
    if (entry.kind !== "local" || !entry.enabled) continue;
    const dir = path.resolve(projectDir, entry.ref);
    let isExtensionDir = false;
    try {
      isExtensionDir = (await stat(dir)).isDirectory();
    } catch {
      continue; // ref no longer resolves to anything — stale/uninstalled.
    }
    if (!isExtensionDir) continue; // a bare .js file plugin has no metadata to read.

    const meta = await readExtensionMeta(dir);
    const snippetsRel = meta.snippets?.trim();
    if (!snippetsRel) continue;
    out.push({
      ref: entry.ref,
      kind: "plugin",
      dir,
      // Falls back to a prettified folder name for an extension whose
      // gutterpress.json/theme.json declares `snippets` but no `name` —
      // mirrors themeInfo()'s own `prettify(id)` fallback so an unnamed
      // extension still gets a readable group label instead of the raw
      // manifest ref (e.g. "./plugins/dc-components").
      name: meta.name?.trim() || prettify(path.basename(dir)),
      snippetsRel,
    });
  }

  return out;
}

/**
 * Resolve one installed extension's snippets folder to an absolute path, or
 * `null` when its declared `snippets` value escapes its own folder — a
 * TOLERANT sibling of `extension-manifest.ts`'s `resolveExtension` (which
 * would throw), for the same reason {@link listInstalledExtensions} is
 * tolerant throughout: this is a read/list path, not the write-boundary
 * guard `assertExtensionContained` exists for.
 */
function extensionSnippetsDir(ext: InstalledExtension): string | null {
  if (pathEscapesFolder(ext.snippetsRel)) return null;
  return path.join(ext.dir, ext.snippetsRel);
}

/**
 * The project's own snippets, merged with every installed-and-active
 * extension's (#242) — this is "the snippet host" the picker actually calls;
 * `listSnippets` above is now just its first ingredient.
 *
 * PRECEDENCE / collision (issue's suggested shape, point 2): when an
 * extension snippet's FILENAME — the slugified identity `saveSnippet` itself
 * derives a name into, so two different-cased spellings of the same name
 * collide exactly as they would on a real re-save — matches a project
 * snippet's, the project one wins outright and the extension's copy is
 * dropped from this call's result. It is not renamed, not kept reachable
 * under a second key, and nothing on disk is touched: the comparison and the
 * drop happen freshly on every call, so the instant the author renames (or
 * deletes) their colliding snippet, the extension's becomes visible again
 * with no separate "restore" step. Rationale: the moment an author saves
 * their own snippet under a name an extension already used, the natural
 * reading is "I'm overriding this one for my project" — a picker entry that
 * silently stays inserted from the extension forever after would contradict
 * that, and a picker entry that just isn't there is a far smaller surprise
 * than two identically-named rows the author has to guess between.
 *
 * This precedence rule is PROJECT-vs-EXTENSION only. Two different
 * extensions that each happen to ship a same-named snippet are NOT
 * deduplicated against each other — both survive, each under its own group
 * header (see GROUPING below), because there is no ambiguity to resolve:
 * unlike the project-vs-extension case, neither copy could be mistaken for
 * "the author's own", so there is nothing here for one to silently win over.
 *
 * GROUPING: the result is ordered project-first (`listSnippets`'s own
 * alphabetical order), then one contiguous run per extension — extensions
 * alphabetical by display name, each run alphabetical by snippet name. The
 * picker groups purely by noticing `source` change between consecutive
 * entries; there is no separate grouped/tree shape to keep in sync with this
 * flat list.
 */
export async function listMergedSnippets(projectDir: string): Promise<SnippetEntry[]> {
  const project = await listSnippets(projectDir);
  const projectFileNames = new Set(project.map((entry) => entry.fileName.toLowerCase()));
  const merged: SnippetEntry[] = [...project];

  const extensions = (await listInstalledExtensions(projectDir)).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const ext of extensions) {
    const dir = extensionSnippetsDir(ext);
    if (!dir) continue;
    for (const file of await scanSnippetFiles(dir)) {
      if (projectFileNames.has(file.fileName.toLowerCase())) continue; // project wins
      merged.push({ ...file, source: { kind: ext.kind, ref: ext.ref, name: ext.name } });
    }
  }
  return merged;
}

/**
 * Read one extension-provided snippet's raw body (#242) — the read-only
 * counterpart to `readSnippet` for entries `listMergedSnippets` tagged with
 * an extension `source`.
 *
 * Deliberately NOT a raw-path read: `source` carries only the same small,
 * stable `{ kind, ref }` pair `listMergedSnippets` already handed back (see
 * {@link SnippetSource}), and this function re-runs the EXACT SAME discovery
 * {@link listMergedSnippets} used ({@link listInstalledExtensions}) to find
 * the matching extension's folder again, rather than trusting any path a
 * caller could construct directly — the same defense-in-depth stance
 * `resolveSnippetPath` already takes for the project's own snippets, now
 * extended to a second, per-extension root instead of a single project one.
 *
 * Throws when `source` no longer resolves to an installed, active extension
 * (it was disabled, uninstalled, or the theme was switched since the list
 * was fetched — the picker's existing `error` display already handles a
 * thrown read the same way a vanished project snippet would) or when
 * `fileName` escapes that extension's snippets folder.
 */
export async function readExtensionSnippet(
  projectDir: string,
  source: { kind: "plugin" | "theme"; ref: string },
  fileName: string,
): Promise<string> {
  const ext = (await listInstalledExtensions(projectDir)).find(
    (candidate) => candidate.kind === source.kind && candidate.ref === source.ref,
  );
  if (!ext) {
    throw new Error(`Extension "${source.ref}" is not installed or is no longer active.`);
  }
  const dir = extensionSnippetsDir(ext);
  if (!dir) {
    throw new Error(`Extension "${source.ref}" does not declare a usable snippets folder.`);
  }
  return readFile(resolveSafeChildFile(dir, fileName), "utf8");
}
