/**
 * Template IPC handlers for the "project-config" capability (SFE-P5c2).
 * Ports `src/routes/api/tpl/{built-in,custom,import-from-folder,
 * save-as-template}/+server.ts` verbatim, including `tpl:custom`'s lazy
 * `getDesktopHooks()` resolution (only reached when the caller omits
 * `templatesRoot`, so a caller that always passes one never depends on
 * desktop hooks being registered).
 */
import { join } from "node:path";
import { getDesktopHooks } from "../server-bridge/host-hooks";
import { loadLib } from "./lib-loader";
import { requireProjectDir } from "./validation";

/** List the built-in starter templates (static metadata). */
export async function tplListBuiltIn(): Promise<unknown> {
  const lib = await loadLib();
  return lib.listBuiltInTemplates();
}

/** List the user's saved/imported custom templates. */
export async function tplListCustom(rawTemplatesRoot?: unknown): Promise<unknown> {
  let templatesRoot: string;
  if (typeof rawTemplatesRoot === "string") {
    templatesRoot = rawTemplatesRoot;
  } else {
    const hooks = getDesktopHooks();
    if (!hooks) throw new Error("Desktop hooks not registered");
    templatesRoot = join(hooks.getUserDataPath(), "templates");
  }
  const lib = await loadLib();
  return lib.listCustomTemplates(templatesRoot);
}

/** Open a native folder picker and import the selected folder as a template. Resolves null when cancelled. */
export async function tplImportFromFolder(): Promise<unknown> {
  const hooks = getDesktopHooks();
  if (!hooks) throw new Error("Desktop hooks not registered");
  const res = await hooks.showOpenDialog({
    title: "Choose a template folder",
    properties: ["openDirectory"],
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  const templatesRoot = join(hooks.getUserDataPath(), "templates");
  const lib = await loadLib();
  return lib.importTemplateFromFolder({
    sourceDir: res.filePaths[0]!,
    templatesRoot,
  });
}

/**
 * Save the open project as a reusable custom template. A repo-nested book's
 * out-of-book (`../../shared/...`) refs are made portable per `sharedRefs`
 * (default `"vendor"` — copy them in; `"exclude"` — drop them).
 */
export async function tplSaveAsTemplate(
  rawProjectDir: unknown,
  rawName: unknown,
  rawSharedRefs?: unknown,
): Promise<unknown> {
  const hooks = getDesktopHooks();
  if (!hooks) throw new Error("Desktop hooks not registered");
  const projectDir = await requireProjectDir(rawProjectDir, "tpl:saveAsTemplate");
  const name = typeof rawName === "string" ? rawName : "";
  const sharedRefs = rawSharedRefs === "exclude" ? "exclude" : "vendor";
  const templatesRoot = join(hooks.getUserDataPath(), "templates");
  const lib = await loadLib();
  return lib.saveProjectAsTemplate({
    projectDir,
    name,
    templatesRoot,
    sharedRefs,
  });
}
