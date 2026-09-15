/**
 * Extension IPC handlers for the "project-config" capability - the one
 * `extensions:` rail (#265) the Look and Features tabs both drive. Ports
 * main's `src/routes/api/extension/{list,recommended,built-in,validate,
 * add,add-local,add-built-in,remove,set-enabled,reorder,read-css,
 * import-from-file,import-from-url}/+server.ts` (deleted with the local
 * server, SFE-P5d) onto `secureHandle` channels, the same way the plugin
 * and theme registrars this file replaces did for the pre-#265 routes.
 *
 * SPECIAL WEIGHT: `extension:add` keeps the discipline the route had - the
 * project-dir guard runs first, an npm specifier goes through the native
 * trust gate (`confirmNpmPluginInstall`; a declined gate resolves `null`,
 * not an install), a bundled feature never prompts, and a PATH is confined:
 * project-relative and inside the project, never absolute (an absolute path
 * only ever comes from the host's own picker, `extension:addLocal`). The
 * vendored-install pipeline underneath (`lib.addExtension` - receipt,
 * verification, load-test) is called exactly as the route called it.
 */
import path from "node:path";
import { getDesktopHooks } from "../server-bridge/host-hooks";
import { loadLib } from "./lib-loader";
import type { SecureHandle } from "../server-bridge/secure-handle";
import { requireProjectDir, requireWithinProjectRoot } from "./validation";

function requireNonEmptyString(value: unknown, message: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(message);
  return value;
}

/** Every configured extension, in manifest (= cascade) order. */
export async function extensionList(rawProjectDir: unknown): Promise<unknown> {
  const projectDir = await requireProjectDir(rawProjectDir, "extension:list");
  const lib = await loadLib();
  return lib.listProjectExtensions(projectDir);
}

/** The bundled markdown features an author can turn on with no install (static). */
export async function extensionRecommended(): Promise<unknown> {
  const lib = await loadLib();
  return lib.RECOMMENDED_EXTENSIONS;
}

/** The built-in looks (static metadata). */
export async function extensionListBuiltIn(): Promise<unknown> {
  const lib = await loadLib();
  return lib.listBuiltInStyleSets();
}

/** Load-test every configured extension; reports ok/error per entry (degrade-and-report). */
export async function extensionValidate(rawProjectDir: unknown): Promise<unknown> {
  const projectDir = await requireProjectDir(rawProjectDir, "extension:validate");
  const lib = await loadLib();
  return lib.validateProjectExtensions(projectDir);
}

/**
 * Add by specifier: a bundled feature name (written as-is), an npm package
 * (downloaded, verified, vendored, pinned - behind the native trust gate;
 * `null` when the author cancels it), or a project-relative `./path`
 * (referenced in place). `exportName` selects a named plugin function for
 * packages without a default export.
 */
export async function extensionAdd(
  rawProjectDir: unknown,
  rawSpecifier: unknown,
  rawExportName?: unknown,
): Promise<unknown> {
  const projectDir = await requireProjectDir(rawProjectDir, "extension:add");
  const specifier = requireNonEmptyString(rawSpecifier, "extension:add requires a specifier").trim();
  if (rawExportName !== undefined && (typeof rawExportName !== "string" || !rawExportName.trim())) {
    throw new Error("extension:add exportName must be a non-empty string");
  }
  const exportName = typeof rawExportName === "string" ? rawExportName.trim() : undefined;

  const lib = await loadLib();
  const kind = lib.parseExtensionSpecifier(specifier).kind;
  if (kind === "path") {
    if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
      throw new Error(
        "extension:add takes a project-relative path (./x or ../x) - choose an absolute path with extension:addLocal",
      );
    }
    await requireWithinProjectRoot(path.resolve(projectDir, specifier), "extension:add");
  }
  if (kind === "npm") {
    const hooks = getDesktopHooks();
    if (!hooks) throw new Error("Desktop hooks not registered");
    if (!(await hooks.confirmNpmPluginInstall(specifier))) return null;
  }
  return lib.addExtension(projectDir, specifier, exportName ? { exportName } : {});
}

/** Native picker for a folder or plugin file on disk, referenced in place (never copied). Resolves null when cancelled. */
export async function extensionAddLocal(rawProjectDir: unknown): Promise<unknown> {
  const hooks = getDesktopHooks();
  if (!hooks) throw new Error("Desktop hooks not registered");
  const projectDir = await requireProjectDir(rawProjectDir, "extension:addLocal");
  const res = await hooks.showOpenDialog({
    title: "Choose an extension folder or plugin file",
    properties: ["openFile", "openDirectory"],
    filters: [{ name: "Extension", extensions: ["js", "mjs", "cjs", "ts"] }],
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  const lib = await loadLib();
  return lib.addExtension(projectDir, res.filePaths[0]!);
}

/** Copy a built-in look into `extensions/<id>/` and add it as `./extensions/<id>`. */
export async function extensionAddBuiltIn(rawProjectDir: unknown, rawId: unknown): Promise<unknown> {
  const projectDir = await requireProjectDir(rawProjectDir, "extension:addBuiltIn");
  const id = requireNonEmptyString(rawId, "extension:addBuiltIn requires an id").trim();
  const lib = await loadLib();
  return lib.addBuiltInStyleSet(projectDir, id);
}

/** Drop one entry. A path entry's folder is never touched; an npm entry's vendored copy is deleted. */
export async function extensionRemove(rawProjectDir: unknown, rawUse: unknown): Promise<{ ok: true }> {
  const projectDir = await requireProjectDir(rawProjectDir, "extension:remove");
  const use = requireNonEmptyString(rawUse, "extension:remove requires a use string");
  const lib = await loadLib();
  await lib.removeExtension(projectDir, use);
  return { ok: true };
}

/** Flip one entry's per-project `enabled` flag. */
export async function extensionSetEnabled(
  rawProjectDir: unknown,
  rawUse: unknown,
  rawEnabled: unknown,
): Promise<{ ok: true }> {
  const projectDir = await requireProjectDir(rawProjectDir, "extension:setEnabled");
  const use = requireNonEmptyString(rawUse, "extension:setEnabled requires a use string");
  const lib = await loadLib();
  await lib.setExtensionEnabled(projectDir, use, Boolean(rawEnabled));
  return { ok: true };
}

/** Rewrite the list order - the CSS cascade and markdown registration order. Must name every `use` exactly once. */
export async function extensionReorder(rawProjectDir: unknown, rawOrder: unknown): Promise<{ ok: true }> {
  const projectDir = await requireProjectDir(rawProjectDir, "extension:reorder");
  if (!Array.isArray(rawOrder) || !rawOrder.every((u) => typeof u === "string" && u.trim())) {
    throw new Error("extension:reorder requires order: string[]");
  }
  const lib = await loadLib();
  await lib.reorderExtensions(projectDir, rawOrder as string[]);
  return { ok: true };
}

/** A configured extension's stylesheets, concatenated, for a sample thumbnail (entries with a folder only). */
export async function extensionReadCss(rawProjectDir: unknown, rawUse: unknown): Promise<unknown> {
  const projectDir = await requireProjectDir(rawProjectDir, "extension:readCss");
  const use = requireNonEmptyString(rawUse, "extension:readCss requires a use string");
  const lib = await loadLib();
  return lib.readExtensionCss(projectDir, use);
}

/** Native picker for a `.zip` package or bare `.css`, imported into `extensions/<id>/` (#106). Resolves null when cancelled. */
export async function extensionImportFromFile(rawProjectDir: unknown): Promise<unknown> {
  const hooks = getDesktopHooks();
  if (!hooks) throw new Error("Desktop hooks not registered");
  const projectDir = await requireProjectDir(rawProjectDir, "extension:importFromFile");
  const res = await hooks.showOpenDialog({
    title: "Choose an extension package (.zip) or stylesheet (.css)",
    properties: ["openFile"],
    filters: [{ name: "Extension", extensions: ["zip", "css"] }],
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  const lib = await loadLib();
  return lib.importExtensionFromFile(projectDir, res.filePaths[0]!);
}

/** Import a look from an http(s) URL (raw CSS or a folder URL) into `extensions/<id>/`. */
export async function extensionImportFromUrl(rawProjectDir: unknown, rawUrl: unknown): Promise<unknown> {
  const projectDir = await requireProjectDir(rawProjectDir, "extension:importFromUrl");
  const url = requireNonEmptyString(rawUrl, "extension:importFromUrl requires a url").trim();
  const lib = await loadLib();
  return lib.importExtensionFromUrl(projectDir, url);
}

/** Register the extension:* IPC channels. */
export function registerExtensionHandlers(secureHandle: SecureHandle): void {
  secureHandle("extension:list", (_e, projectDir: unknown) => extensionList(projectDir));
  secureHandle("extension:recommended", () => extensionRecommended());
  secureHandle("extension:listBuiltIn", () => extensionListBuiltIn());
  secureHandle("extension:validate", (_e, projectDir: unknown) => extensionValidate(projectDir));
  secureHandle("extension:add", (_e, projectDir: unknown, specifier: unknown, exportName?: unknown) =>
    extensionAdd(projectDir, specifier, exportName),
  );
  secureHandle("extension:addLocal", (_e, projectDir: unknown) => extensionAddLocal(projectDir));
  secureHandle("extension:addBuiltIn", (_e, projectDir: unknown, id: unknown) =>
    extensionAddBuiltIn(projectDir, id),
  );
  secureHandle("extension:remove", (_e, projectDir: unknown, use: unknown) => extensionRemove(projectDir, use));
  secureHandle("extension:setEnabled", (_e, projectDir: unknown, use: unknown, enabled: unknown) =>
    extensionSetEnabled(projectDir, use, enabled),
  );
  secureHandle("extension:reorder", (_e, projectDir: unknown, order: unknown) =>
    extensionReorder(projectDir, order),
  );
  secureHandle("extension:readCss", (_e, projectDir: unknown, use: unknown) => extensionReadCss(projectDir, use));
  secureHandle("extension:importFromFile", (_e, projectDir: unknown) => extensionImportFromFile(projectDir));
  secureHandle("extension:importFromUrl", (_e, projectDir: unknown, url: unknown) =>
    extensionImportFromUrl(projectDir, url),
  );
}
