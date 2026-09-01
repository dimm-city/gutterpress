/**
 * Project-configuration capability (SFE-P5c2, D10's "project config" bounded
 * context). Replaces `api.project.*`/`api.manifest.*`/`api.tpl.*`/
 * `api.snip.*`/`api.media.*`/`api.plugin.*`/`api.theme.*`/`api.style.*`
 * (deleted `src/routes/api/{project,manifest,tpl,snip,media,plugin,theme,
 * style}/**` HTTP routes) with typed IPC through the one shared `bridge()`
 * accessor — the same shape every other capability module uses (SFE-P5b),
 * following `$lib/files/files-capability.ts`'s precedent (SFE-P5c1) for
 * grouping several related namespaces behind one bounded-context module.
 *
 * Eight namespaces share this one file because they share one bounded
 * context (project/manifest/tpl/snip/media/plugin/theme config surfaces all
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
import { friendlyHostError } from "../errors";
import type {
  ApplyThemeTarget,
  MediaImageDetails,
  MediaImageEntry,
  PluginValidationResult,
  ProjectConfigFields,
  ProjectPluginEntry,
  ProjectStyle,
  RecommendedPlugin,
  SavedTemplateInfo,
  SnippetEntry,
  TemplateInfo,
  ThemeImportResult,
  ThemeInfo,
} from "../platform/dtos";

async function call<T>(op: Promise<T>): Promise<T> {
  try {
    return await op;
  } catch (e) {
    throw new Error(friendlyHostError(e instanceof Error ? e.message : String(e)));
  }
}

// ── project ──────────────────────────────────────────────────────────────

/**
 * Resolve the project's editable stylesheets for the CSS editor picker.
 * `repoRoot` (when the open book lives inside a repository) also offers the
 * repo's SHARED stylesheets.
 */
export async function projectListStyles(projectDir: string, repoRoot?: string | null): Promise<ProjectStyle[]> {
  return call(bridge().project.listStyles(projectDir, repoRoot));
}

// ── manifest ─────────────────────────────────────────────────────────────

/** Read the author-facing manifest subset for the Config view's Details section. */
export async function manifestRead(projectDir: string): Promise<ProjectConfigFields> {
  return call(bridge().manifest.read(projectDir));
}

/** Apply the author-facing manifest field updates (one yaml round-trip). */
export async function manifestSetFields(
  projectDir: string,
  updates: ProjectConfigFields,
): Promise<ProjectConfigFields> {
  return call(bridge().manifest.setFields(projectDir, updates));
}

// ── tpl ──────────────────────────────────────────────────────────────────

/** List the built-in starter templates (static metadata). */
export async function tplListBuiltIn(): Promise<TemplateInfo[]> {
  return call(bridge().tpl.listBuiltIn());
}

/** List the user's saved/imported custom templates. */
export async function tplListCustom(): Promise<TemplateInfo[]> {
  return call(bridge().tpl.listCustom());
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
  return call(bridge().tpl.saveAsTemplate(opts));
}

/** Open a native folder picker and import the selected folder as a template. Resolves null when cancelled. */
export async function tplImportFromFolder(): Promise<TemplateInfo | null> {
  return call(bridge().tpl.importFromFolder());
}

// ── snip ─────────────────────────────────────────────────────────────────

/** List the open project's snippets. */
export async function snipList(projectDir: string): Promise<SnippetEntry[]> {
  return call(bridge().snip.list(projectDir));
}

/** Read one snippet's raw body. */
export async function snipRead(projectDir: string, fileName: string): Promise<string> {
  return call(bridge().snip.read(projectDir, fileName));
}

/** Save a snippet body under the project's snippets/ folder. */
export async function snipSave(projectDir: string, name: string, body: string): Promise<SnippetEntry> {
  return call(bridge().snip.save(projectDir, name, body));
}

/** Delete a snippet by filename. */
export async function snipDelete(projectDir: string, fileName: string): Promise<{ ok: boolean }> {
  return call(bridge().snip.delete(projectDir, fileName));
}

// ── media ────────────────────────────────────────────────────────────────

/** List all image files under a project directory (recursive, bounded). */
export async function mediaListImages(projectDir: string): Promise<MediaImageEntry[]> {
  return call(bridge().media.listImages(projectDir));
}

/** Generate a small (<=192px) thumbnail data URL for an image. Returns null when unavailable. */
export async function mediaThumbnail(imagePath: string): Promise<string | null> {
  return call(bridge().media.thumbnail(imagePath));
}

/** Inspect an image file — file size + header metadata (dimensions, DPI, alpha, color space). */
export async function mediaInspect(imagePath: string): Promise<MediaImageDetails | null> {
  return call(bridge().media.inspect(imagePath));
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
  return call(bridge().media.importImage(projectDir, src));
}

// ── plugin ───────────────────────────────────────────────────────────────

/** List the open project's configured plugins. */
export async function pluginList(projectDir: string): Promise<ProjectPluginEntry[]> {
  return call(bridge().plugin.list(projectDir));
}

/** Enable or disable a configured plugin by ref. */
export async function pluginSetEnabled(
  projectDir: string,
  ref: string,
  enabled: boolean,
): Promise<{ ok: boolean }> {
  return call(bridge().plugin.setEnabled(projectDir, ref, enabled));
}

/** Download, verify, vendor, and pin an npm plugin (built-ins only need configuring). */
export async function pluginAddNpm(
  projectDir: string,
  packageName: string,
  exportName?: string,
): Promise<ProjectPluginEntry | null> {
  return call(bridge().plugin.addNpm(projectDir, packageName, exportName));
}

/** Open a native file picker and import the chosen file/folder as a local plugin. Resolves null when cancelled. */
export async function pluginAddLocal(projectDir: string): Promise<ProjectPluginEntry | null> {
  return call(bridge().plugin.addLocal(projectDir));
}

/** Load-test every configured plugin; reports ok/error per entry (degrade-and-report). */
export async function pluginValidate(projectDir: string): Promise<PluginValidationResult[]> {
  return call(bridge().plugin.validate(projectDir));
}

/** The curated list of recommended plugins (static, no projectDir needed). */
export async function pluginRecommended(): Promise<RecommendedPlugin[]> {
  return call(bridge().plugin.recommended());
}

// ── theme ────────────────────────────────────────────────────────────────

/** List all built-in themes (static metadata). */
export async function themeListBuiltIn(): Promise<ThemeInfo[]> {
  return call(bridge().theme.listBuiltIn());
}

/** List themes already imported into the project. */
export async function themeListProject(projectDir: string): Promise<ThemeInfo[]> {
  return call(bridge().theme.listProject(projectDir));
}

/** The currently active theme for the project. Null when none applied. */
export async function themeGetActive(projectDir: string): Promise<ThemeInfo | null> {
  return call(bridge().theme.getActive(projectDir));
}

/** Apply a built-in or project theme. Copies files and wires the manifest. */
export async function themeApply(projectDir: string, target: ApplyThemeTarget): Promise<ThemeInfo> {
  return call(bridge().theme.apply(projectDir, target));
}

/** Open a native folder picker and import the selected folder as a theme. Resolves null when cancelled. */
export async function themeImportFromFolder(projectDir: string): Promise<ThemeInfo | null> {
  return call(bridge().theme.importFromFolder(projectDir));
}

/** Open a native file picker and import a `.zip` package or bare `.css` as a theme. Resolves null when cancelled. */
export async function themeImportFromFile(projectDir: string): Promise<ThemeImportResult | null> {
  return call(bridge().theme.importFromFile(projectDir));
}

/** Import a theme from a remote URL (raw CSS or theme folder). */
export async function themeImportFromUrl(projectDir: string, url: string): Promise<ThemeInfo> {
  return call(bridge().theme.importFromUrl(projectDir, url));
}

/** Read the raw CSS of a theme (built-in or project) for preview rendering. */
export async function themeReadCss(
  projectDir: string | null,
  source: { kind: "builtin" | "project"; id: string },
): Promise<string> {
  return call(bridge().theme.readCss(projectDir, source));
}

/** Remove a project-local theme by id. */
export async function themeRemove(projectDir: string, id: string): Promise<{ ok: true }> {
  return call(bridge().theme.remove(projectDir, id));
}

/** The theme active before the current one — the "Revert" target — or null. */
export async function themeGetPrevious(projectDir: string): Promise<ThemeInfo | null> {
  return call(bridge().theme.getPrevious(projectDir));
}

/** Re-apply the previously active theme. */
export async function themeRevert(projectDir: string): Promise<ThemeInfo> {
  return call(bridge().theme.revert(projectDir));
}

// ── style ────────────────────────────────────────────────────────────────

/** Replace the manifest's active `styles:` list (reorder + toggle). */
export async function styleSetActive(projectDir: string, paths: string[]): Promise<string[]> {
  return call(bridge().style.setActive(projectDir, paths));
}
