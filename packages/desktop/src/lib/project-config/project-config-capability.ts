/**
 * Project-configuration capability (SFE-P5c2, D10's "project config" bounded
 * context). Replaces `api.project.*`/`api.manifest.*`/`api.tpl.*`/
 * `api.snip.*`/`api.media.*`/`api.extension.*`/`api.style.*`
 * (deleted `src/routes/api/{project,manifest,tpl,snip,media,extension,
 * style}/**` HTTP routes) with typed IPC through the one shared `bridge()`
 * accessor — the same shape every other capability module uses (SFE-P5b),
 * following `$lib/files/files-capability.ts`'s precedent (SFE-P5c1) for
 * grouping several related namespaces behind one bounded-context module.
 *
 * Seven namespaces share this one file because they share one bounded
 * context (project/manifest/tpl/snip/media/extension config surfaces all
 * feed `ProjectSettingsView`/`MediaPanel`/`EditorToolbar`/`SnippetPicker`/
 * `NewProjectWizard`/`ExportDialog` — the Project Settings composition root
 * and its adjacent panels) and, per capability-map.md §6, `style` is
 * "build/preview/export-adjacent (CSS editor)" but functionally the same
 * project-styling surface `project.listStyles` already feeds
 * (`StylesSection`/`StylesSectionController` consume both together) — giving
 * it a separate module would be ceremony for one function. `vcs` (local
 * version history) is NOT here — see `$lib/vcs/vcs-capability.ts` — it has
 * no real dependency on this bounded context (SFE-P5b's capability map found
 * `vcs` app-lifecycle-shaped, not project-config-shaped) and carries its own
 * crash-safety weight worth a dedicated file.
 *
 * Every function is a plain, top-level, 1:1-named forward of the deleted
 * `api.<ns>.<method>` call it replaces, so every migrated call site is a
 * name/import swap, not a redesign — the same discipline
 * `files-capability.ts` established.
 *
 * Error semantics (run rule 2): every function scrubs the Electron IPC
 * transport prefix (`friendlyHostError`) off a rejection's message before
 * re-throwing, so a caller's existing `e instanceof Error ? e.message :
 * String(e)` handling keeps showing the same author-facing text the deleted
 * HTTP routes used to send as the response body.
 */
import { bridge } from "../platform/bridge";
import { hostCall } from "../errors";
import type {
  BuiltInStyleSet,
  ExtensionImportResult,
  ExtensionValidationResult,
  MediaImageDetails,
  MediaImageEntry,
  ProjectConfigFields,
  ProjectExtensionEntry,
  ProjectStyle,
  RecommendedExtension,
  SavedTemplateInfo,
  SnippetEntry,
  SnippetSource,
  TemplateInfo,
} from "../platform/dtos";

// ── project ──────────────────────────────────────────────────────────────

/**
 * Resolve the project's editable stylesheets for the CSS editor picker.
 * `repoRoot` (when the open book lives inside a repository) also offers the
 * repo's SHARED stylesheets.
 */
export async function projectListStyles(projectDir: string, repoRoot?: string | null): Promise<ProjectStyle[]> {
  return hostCall(bridge().project.listStyles(projectDir, repoRoot));
}

// ── manifest ─────────────────────────────────────────────────────────────

/** Read the author-facing manifest subset for the Config view's Details section. */
export async function manifestRead(projectDir: string): Promise<ProjectConfigFields> {
  return hostCall(bridge().manifest.read(projectDir));
}

/** Apply the author-facing manifest field updates (one yaml round-trip). */
export async function manifestSetFields(
  projectDir: string,
  updates: ProjectConfigFields,
): Promise<ProjectConfigFields> {
  return hostCall(bridge().manifest.setFields(projectDir, updates));
}

// ── tpl ──────────────────────────────────────────────────────────────────

/** List the built-in starter templates (static metadata). */
export async function tplListBuiltIn(): Promise<TemplateInfo[]> {
  return hostCall(bridge().tpl.listBuiltIn());
}

/** List the user's saved/imported custom templates. */
export async function tplListCustom(): Promise<TemplateInfo[]> {
  return hostCall(bridge().tpl.listCustom());
}

/**
 * Save the open project as a reusable custom template. A repo-nested book's
 * out-of-book (`../../shared/...`) refs are made portable per `sharedRefs`
 * (default `"vendor"` — copy them in; `"exclude"` — drop them).
 */
export async function tplSaveAsTemplate(opts: {
  projectDir: string;
  name: string;
  sharedRefs?: "vendor" | "exclude";
}): Promise<SavedTemplateInfo> {
  return hostCall(bridge().tpl.saveAsTemplate(opts));
}

/** Open a native folder picker and import the selected folder as a template. Resolves null when cancelled. */
export async function tplImportFromFolder(): Promise<TemplateInfo | null> {
  return hostCall(bridge().tpl.importFromFolder());
}

// ── snip ─────────────────────────────────────────────────────────────────

/** List the open project's snippets, MERGED with every installed, active
 *  extension's own `snippets` folder (#242) - each entry's `source` says which. */
export async function snipList(projectDir: string): Promise<SnippetEntry[]> {
  return hostCall(bridge().snip.list(projectDir));
}

/** Read one PROJECT snippet's raw body (`source.kind === "project"` entries only). */
export async function snipRead(projectDir: string, fileName: string): Promise<string> {
  return hostCall(bridge().snip.read(projectDir, fileName));
}

/** Read one EXTENSION-provided snippet's raw body (#242) - `source` is the
 *  exact object the list handed back; the host re-derives the extension's
 *  folder from `source.ref` itself rather than trusting a path from here. */
export async function snipReadExtension(
  projectDir: string,
  source: Extract<SnippetSource, { kind: "extension" }>,
  fileName: string,
): Promise<string> {
  return hostCall(bridge().snip.readExtension(projectDir, { kind: source.kind, ref: source.ref }, fileName));
}

/** Save a snippet body under the project's snippets/ folder. */
export async function snipSave(projectDir: string, name: string, body: string): Promise<SnippetEntry> {
  return hostCall(bridge().snip.save(projectDir, name, body));
}

/** Delete a snippet by filename. */
export async function snipDelete(projectDir: string, fileName: string): Promise<{ ok: boolean }> {
  return hostCall(bridge().snip.delete(projectDir, fileName));
}

// ── media ────────────────────────────────────────────────────────────────

/** List all image files under a project directory (recursive, bounded). */
export async function mediaListImages(projectDir: string): Promise<MediaImageEntry[]> {
  return hostCall(bridge().media.listImages(projectDir));
}

/** Generate a small (<=192px) thumbnail data URL for an image. Returns null when unavailable. */
export async function mediaThumbnail(imagePath: string): Promise<string | null> {
  return hostCall(bridge().media.thumbnail(imagePath));
}

/** Inspect an image file — file size + header metadata (dimensions, DPI, alpha, color space). */
export async function mediaInspect(imagePath: string): Promise<MediaImageDetails | null> {
  return hostCall(bridge().media.inspect(imagePath));
}

/**
 * Import an author-picked image (absolute path, from anywhere on disk — e.g.
 * a native file dialog) into the given project, returning the
 * project-relative markdown `src` to use. The ONE host-side implementation
 * of the import policy (UX review M10) — `EditorToolbar` and `MediaPanel`
 * both call this, neither does its own path/fs math (CLAUDE.md §8).
 */
export async function mediaImportImage(
  projectDir: string,
  src: string,
): Promise<{ src: string; copied: boolean }> {
  return hostCall(bridge().media.importImage(projectDir, src));
}

// ── extension ────────────────────────────────────────────────────────────
//
// The one `extensions:` rail (#265): the Look and Features tabs are two
// views over this same list and verb set.

/** Every configured extension, in manifest (= cascade) order. */
export async function extensionList(projectDir: string): Promise<ProjectExtensionEntry[]> {
  return hostCall(bridge().extension.list(projectDir));
}

/** The bundled markdown features an author can turn on with no install (static). */
export async function extensionRecommended(): Promise<RecommendedExtension[]> {
  return hostCall(bridge().extension.recommended());
}

/** The built-in looks (static metadata). */
export async function extensionListBuiltIn(): Promise<BuiltInStyleSet[]> {
  return hostCall(bridge().extension.listBuiltIn());
}

/** Load-test every configured extension; reports ok/error per entry (degrade-and-report). */
export async function extensionValidate(projectDir: string): Promise<ExtensionValidationResult[]> {
  return hostCall(bridge().extension.validate(projectDir));
}

/**
 * Add by specifier: a bundled feature name (written as-is), an npm package
 * `name`/`name@version` (downloaded, verified, vendored, pinned - behind the
 * native trust gate; null when the author cancels it), or a project-relative
 * `./path` (referenced in place). `exportName` selects a named plugin
 * function for packages without a default export.
 */
export async function extensionAdd(
  projectDir: string,
  specifier: string,
  exportName?: string,
): Promise<ProjectExtensionEntry | null> {
  return hostCall(bridge().extension.add(projectDir, specifier, exportName));
}

/** Native picker for a folder or plugin file on disk, referenced in place (never copied). Null when cancelled. */
export async function extensionAddLocal(projectDir: string): Promise<ProjectExtensionEntry | null> {
  return hostCall(bridge().extension.addLocal(projectDir));
}

/** Copy a built-in look into `extensions/<id>/` and add it as `./extensions/<id>`. */
export async function extensionAddBuiltIn(projectDir: string, id: string): Promise<ProjectExtensionEntry> {
  return hostCall(bridge().extension.addBuiltIn(projectDir, id));
}

/** Drop one entry. A path entry's folder is never touched; an npm entry's vendored copy is deleted. */
export async function extensionRemove(projectDir: string, use: string): Promise<{ ok: true }> {
  return hostCall(bridge().extension.remove(projectDir, use));
}

/** Flip one entry's per-project `enabled` flag. */
export async function extensionSetEnabled(
  projectDir: string,
  use: string,
  enabled: boolean,
): Promise<{ ok: true }> {
  return hostCall(bridge().extension.setEnabled(projectDir, use, enabled));
}

/** Rewrite the list order - the CSS cascade and markdown registration order. Must name every `use` exactly once. */
export async function extensionReorder(projectDir: string, order: string[]): Promise<{ ok: true }> {
  return hostCall(bridge().extension.reorder(projectDir, order));
}

/** A configured extension's stylesheets, concatenated, for a sample thumbnail (entries with a folder only). */
export async function extensionReadCss(projectDir: string, use: string): Promise<string> {
  return hostCall(bridge().extension.readCss(projectDir, use));
}

/** Native picker for a `.zip` package or bare `.css`, imported into `extensions/<id>/` (#106). Null when cancelled. */
export async function extensionImportFromFile(projectDir: string): Promise<ExtensionImportResult | null> {
  return hostCall(bridge().extension.importFromFile(projectDir));
}

/** Import a look from an http(s) URL (raw CSS or a folder URL) into `extensions/<id>/`. */
export async function extensionImportFromUrl(projectDir: string, url: string): Promise<ExtensionImportResult> {
  return hostCall(bridge().extension.importFromUrl(projectDir, url));
}

// ── style ────────────────────────────────────────────────────────────────

/** Replace the manifest's active `styles:` list (reorder + toggle). */
export async function styleSetActive(projectDir: string, paths: string[]): Promise<string[]> {
  return hostCall(bridge().style.setActive(projectDir, paths));
}
