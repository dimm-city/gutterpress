/**
 * Theme-manager IPC handlers for the "project-config" capability
 * (SFE-P5c2). Ports `src/routes/api/theme/{active,apply,built-in,
 * import-from-file,import-from-folder,import-from-url,previous,project,
 * read-css,remove,revert}/+server.ts` verbatim.
 */
import { getDesktopHooks } from "../server-bridge/host-hooks";
import type { ApplyThemeTarget } from "../../src/lib/platform/dtos";
import { loadLib } from "./lib-loader";
import { requireProjectDir } from "./validation";

/** List all built-in themes (static metadata). */
export async function themeListBuiltIn(): Promise<unknown> {
  const lib = await loadLib();
  return lib.listBuiltInThemes();
}

/** List themes already imported into the project. */
export async function themeListProject(rawProjectDir: unknown): Promise<unknown> {
  const projectDir = await requireProjectDir(rawProjectDir, "theme:listProject");
  const lib = await loadLib();
  return lib.listProjectThemes(projectDir);
}

/** The currently active theme for the project. Null when none applied. */
export async function themeGetActive(rawProjectDir: unknown): Promise<unknown> {
  const projectDir = await requireProjectDir(rawProjectDir, "theme:getActive");
  const lib = await loadLib();
  return lib.getActiveTheme(projectDir);
}

/** Apply a built-in or project theme. Copies files and wires the manifest. */
export async function themeApply(rawProjectDir: unknown, rawTarget: unknown): Promise<unknown> {
  const projectDir = await requireProjectDir(rawProjectDir, "theme:apply");
  const target = rawTarget as { kind?: unknown; id?: unknown } | undefined;
  if (!target || typeof target.kind !== "string" || typeof target.id !== "string") {
    throw new Error("theme:apply requires a target { kind, id }");
  }
  const lib = await loadLib();
  return lib.applyTheme(projectDir, target as ApplyThemeTarget);
}

/** Open a native folder picker and import the selected folder as a theme. Resolves null when cancelled. */
export async function themeImportFromFolder(rawProjectDir: unknown): Promise<unknown> {
  const hooks = getDesktopHooks();
  if (!hooks) throw new Error("Desktop hooks not registered");
  const projectDir = await requireProjectDir(rawProjectDir, "theme:importFromFolder");
  const res = await hooks.showOpenDialog({ title: "Choose a theme folder", properties: ["openDirectory"] });
  if (res.canceled || res.filePaths.length === 0) return null;
  const lib = await loadLib();
  return lib.importThemeFromFolder(projectDir, res.filePaths[0]!);
}

/** Open a native file picker and import a `.zip` package or bare `.css` as a theme. Resolves null when cancelled. */
export async function themeImportFromFile(rawProjectDir: unknown): Promise<unknown> {
  const hooks = getDesktopHooks();
  if (!hooks) throw new Error("Desktop hooks not registered");
  const projectDir = await requireProjectDir(rawProjectDir, "theme:importFromFile");
  const res = await hooks.showOpenDialog({
    title: "Choose a theme package (.zip) or stylesheet (.css)",
    properties: ["openFile"],
    filters: [{ name: "Theme", extensions: ["zip", "css"] }],
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  const lib = await loadLib();
  return lib.importThemeFromFile(projectDir, res.filePaths[0]!);
}

/** Import a theme from a remote URL (raw CSS or theme folder). */
export async function themeImportFromUrl(rawProjectDir: unknown, rawUrl: unknown): Promise<unknown> {
  const projectDir = await requireProjectDir(rawProjectDir, "theme:importFromUrl");
  if (typeof rawUrl !== "string" || !rawUrl) throw new Error("theme:importFromUrl requires a url");
  const lib = await loadLib();
  return lib.importThemeFromUrl(projectDir, rawUrl);
}

/**
 * Read the raw CSS of a theme (built-in or project) for preview rendering.
 * A null `projectDir` is the built-in-theme read (no project involved).
 */
export async function themeReadCss(rawProjectDir: unknown, rawSource: unknown): Promise<unknown> {
  const projectDir = rawProjectDir == null ? null : await requireProjectDir(rawProjectDir, "theme:readCss");
  const source = rawSource as { kind?: unknown; id?: unknown } | undefined;
  if (!source || typeof source.kind !== "string" || typeof source.id !== "string") {
    throw new Error("theme:readCss requires a source { kind, id }");
  }
  const lib = await loadLib();
  return lib.readThemeCss(projectDir, source as { kind: "builtin" | "project"; id: string });
}

/** Remove a project-local theme by id. */
export async function themeRemove(rawProjectDir: unknown, rawId: unknown): Promise<{ ok: true }> {
  const projectDir = await requireProjectDir(rawProjectDir, "theme:remove");
  if (typeof rawId !== "string" || !rawId) throw new Error("theme:remove requires an id");
  const lib = await loadLib();
  await lib.removeProjectTheme(projectDir, rawId);
  return { ok: true };
}

/** The theme active before the current one — the "Revert" target — or null. */
export async function themeGetPrevious(rawProjectDir: unknown): Promise<unknown> {
  const projectDir = await requireProjectDir(rawProjectDir, "theme:getPrevious");
  const lib = await loadLib();
  return lib.getPreviousTheme(projectDir);
}

/** Re-apply the previously active theme. Throws when there is no previous theme to revert to. */
export async function themeRevert(rawProjectDir: unknown): Promise<unknown> {
  const projectDir = await requireProjectDir(rawProjectDir, "theme:revert");
  const lib = await loadLib();
  return lib.revertTheme(projectDir);
}
