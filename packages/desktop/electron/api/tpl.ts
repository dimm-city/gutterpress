/**
 * Template IPC handlers for the "project-config" capability (SFE-P5c2).
 * Ports `src/routes/api/tpl/{built-in,custom,import-from-folder,
 * save-as-template}/+server.ts`, with one deliberate narrowing: the deleted
 * `tpl/custom` route accepted an optional caller-supplied `templatesRoot`
 * verbatim (a straight port of equally-unvalidated route code, not a
 * regression). Migration review (SFE-P5c2 round 1) found it had zero real
 * callers — `NewProjectWizard.svelte` is the only call site and always
 * calls `tplListCustom()` with no argument — and, unvalidated, it let a
 * caller enumerate any absolute directory on disk. Rather than add
 * containment validation for a parameter nothing exercises, it is dropped:
 * `tplListCustom` always computes the templates root host-side, the same
 * way `tplImportFromFolder`/`tplSaveAsTemplate` below already do.
 */
import { join } from "node:path";
import { getDesktopHooks } from "../server-bridge/host-hooks";
import { loadLib } from "./lib-loader";
import { requireProjectDir } from "./validation";
import type { SecureHandle } from "../server-bridge/secure-handle";

/** List the built-in starter templates (static metadata). */
export async function tplListBuiltIn(): Promise<unknown> {
  const lib = await loadLib();
  return lib.listBuiltInTemplates();
}

/** List the user's saved/imported custom templates. */
export async function tplListCustom(): Promise<unknown> {
  const hooks = getDesktopHooks();
  if (!hooks) throw new Error("Desktop hooks not registered");
  const templatesRoot = join(hooks.getUserDataPath(), "templates");
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

/** Register the tpl:* IPC channels (SFE-P6b). */
export function registerTplHandlers(secureHandle: SecureHandle): void {
  secureHandle("tpl:listBuiltIn", () => tplListBuiltIn());
  secureHandle("tpl:listCustom", () => tplListCustom());
  secureHandle("tpl:importFromFolder", () => tplImportFromFolder());
  secureHandle("tpl:saveAsTemplate", (_e, projectDir: unknown, name: unknown, sharedRefs?: unknown) =>
    tplSaveAsTemplate(projectDir, name, sharedRefs),
  );
}
