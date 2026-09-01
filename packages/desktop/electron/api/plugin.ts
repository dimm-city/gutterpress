/**
 * Plugin-manager IPC handlers for the "project-config" capability
 * (SFE-P5c2). Ports `src/routes/api/plugin/{add-local,add-npm,list,
 * recommended,set-enabled,validate}/+server.ts` verbatim.
 *
 * SPECIAL WEIGHT (run note): plugin code EXECUTION already happens
 * host-side (the main process, via the lib's loader) — that does not
 * change here, this run only moves the REQUEST/REPLY transport for
 * managing plugin entries. `plugin:addNpm` preserves the exact
 * receipt/verification pipeline (`lib.addNpmPlugin` — vendoring, tarball
 * verification, schema-v2 receipt, load-test — untouched, called exactly
 * as the route called it) and the native trust confirmation gate
 * (`confirmNpmPluginInstall`) for any package that isn't one of the
 * bundled `RECOMMENDED_PLUGINS`. `plugin:validate` preserves the
 * degrade-and-report per-entry `{ ref, kind, enabled, ok, error? }` shape
 * the Plugins panel renders as "Needs install"/load-error rows — this
 * handler does not change that shape or swallow a per-plugin error.
 */
import { getDesktopHooks } from "../server-bridge/host-hooks";
import { loadLib } from "./lib-loader";
import type { SecureHandle } from "../server-bridge/secure-handle";
import { requireAbsolute, requireProjectDir, requireWithinProjectRoot } from "./validation";

/** List the open project's configured plugins. */
export async function pluginList(rawProjectDir: unknown): Promise<unknown> {
  const projectDir = await requireProjectDir(rawProjectDir, "plugin:list");
  const lib = await loadLib();
  return lib.listProjectPlugins(projectDir);
}

/** Enable or disable a configured plugin by ref. */
export async function pluginSetEnabled(
  rawProjectDir: unknown,
  rawRef: unknown,
  rawEnabled: unknown,
): Promise<{ ok: true }> {
  const projectDir = await requireProjectDir(rawProjectDir, "plugin:setEnabled");
  if (typeof rawRef !== "string") throw new Error("plugin:setEnabled requires a ref string");
  const lib = await loadLib();
  await lib.setPluginEnabled(projectDir, rawRef, Boolean(rawEnabled));
  return { ok: true };
}

/**
 * Download, verify, vendor, and pin an npm plugin (the exact vendored-install
 * pipeline — receipt + verification semantics unchanged). Bundled
 * (`RECOMMENDED_PLUGINS`) packages skip the native trust confirmation;
 * everything else needs it, and a declined confirmation resolves `null`
 * rather than throwing.
 */
export async function pluginAddNpm(
  rawProjectDir: unknown,
  rawPackageName: unknown,
  rawExportName?: unknown,
): Promise<unknown> {
  const projectDir = requireAbsolute(rawProjectDir, "plugin:addNpm");
  await requireWithinProjectRoot(projectDir, "plugin:addNpm");
  if (typeof rawPackageName !== "string" || !rawPackageName.trim()) {
    throw new Error("plugin:addNpm requires a packageName");
  }
  if (rawExportName !== undefined && (typeof rawExportName !== "string" || !rawExportName.trim())) {
    throw new Error("plugin:addNpm exportName must be a non-empty string");
  }
  const packageName = rawPackageName.trim();
  const exportName = typeof rawExportName === "string" ? rawExportName.trim() : undefined;

  const lib = await loadLib();
  const isBundled = lib.RECOMMENDED_PLUGINS.some((plugin) => plugin.name === packageName);
  if (!isBundled) {
    const hooks = getDesktopHooks();
    if (!hooks) throw new Error("Desktop hooks not registered");
    if (!(await hooks.confirmNpmPluginInstall(packageName))) return null;
  }
  return lib.addNpmPlugin(projectDir, packageName, exportName);
}

/** Open a native file/folder picker and import the chosen path as a local plugin. Resolves null when cancelled. */
export async function pluginAddLocal(rawProjectDir: unknown): Promise<unknown> {
  const hooks = getDesktopHooks();
  if (!hooks) throw new Error("Desktop hooks not registered");
  const projectDir = await requireProjectDir(rawProjectDir, "plugin:addLocal");
  const res = await hooks.showOpenDialog({
    title: "Choose a plugin file or folder",
    properties: ["openFile", "openDirectory"],
    filters: [{ name: "Plugin", extensions: ["js", "mjs", "cjs", "ts"] }],
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  const lib = await loadLib();
  return lib.addLocalPlugin(projectDir, res.filePaths[0]!);
}

/** Load-test every configured plugin; reports ok/error per entry (degrade-and-report). */
export async function pluginValidate(rawProjectDir: unknown): Promise<unknown> {
  const projectDir = await requireProjectDir(rawProjectDir, "plugin:validate");
  const lib = await loadLib();
  return lib.validateProjectPlugins(projectDir);
}

/** The curated list of recommended plugins (static, no projectDir needed). */
export async function pluginRecommended(): Promise<unknown> {
  const lib = await loadLib();
  return lib.RECOMMENDED_PLUGINS;
}

/** Register the plugin:* IPC channels (SFE-P6b). */
export function registerPluginHandlers(secureHandle: SecureHandle): void {
  secureHandle("plugin:list", (_e, projectDir: unknown) => pluginList(projectDir));
  secureHandle("plugin:setEnabled", (_e, projectDir: unknown, ref: unknown, enabled: unknown) =>
    pluginSetEnabled(projectDir, ref, enabled),
  );
  secureHandle("plugin:addNpm", (_e, projectDir: unknown, packageName: unknown, exportName?: unknown) =>
    pluginAddNpm(projectDir, packageName, exportName),
  );
  secureHandle("plugin:addLocal", (_e, projectDir: unknown) => pluginAddLocal(projectDir));
  secureHandle("plugin:validate", (_e, projectDir: unknown) => pluginValidate(projectDir));
  secureHandle("plugin:recommended", () => pluginRecommended());
}
