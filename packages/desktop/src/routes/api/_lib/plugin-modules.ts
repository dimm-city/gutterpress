import { existsSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { loadLib } from './route';

/**
 * The project's manifest plugins, resolved the way the PRODUCT resolves them.
 *
 * One resolver, used by both editor plugin routes, so the module list and the
 * module server can never disagree about what this book's plugins are.
 *
 * ## The rule, and the bug it replaces
 *
 * A manifest `path` entry is `resolve(projectDir, path)` — no containment
 * check — because that is exactly what the loader does
 * (`packages/cli/src/lib/markdown/plugins.ts`), and books rely on it: a
 * design system shared by several books lives BESIDE them, and its plugin is
 * referenced as `../shared-design/plugins/x.js`. The editor routes used to
 * demand the file sit inside the project directory, so a real book's plugin
 * loaded for the preview and the PDF and was refused by the editor — its
 * markers showed as plain markdown, and the surface rendered nothing like
 * the book it was editing.
 *
 * Fail-closed is preserved by making the MANIFEST the authority rather than a
 * directory box: the only files this API will serve are the declared plugin
 * modules and their neighbours (see `root` below). A same-origin script
 * cannot name a path the book does not already load at build time.
 */
export interface EditorPluginModule {
  /** How the manifest names it — the string shown to the author on failure. */
  ref: string;
  /** Absolute path of the plugin module. */
  abs: string;
  /**
   * The directory served alongside it, i.e. the plugin's own folder.
   *
   * A plugin split across files (`./rules/callout.js`) is ordinary, and the
   * browser resolves those specifiers against the module's own URL — which is
   * why the served URL is path-shaped, not a query. Anything above this
   * folder is refused, so "a plugin may load its own files" does not become
   * "the renderer may read the disk".
   */
  root: string;
  exportName?: string;
  options?: Record<string, unknown>;
}

export interface EditorPluginResolution {
  modules: EditorPluginModule[];
  /** Entries that cannot be loaded, with the reason to show the author. */
  issues: Array<{ ref: string; error: string }>;
}

const MODULE_EXT = /\.(m?js|cjs)$/i;

/** True when `abs` is inside `root` (or is a file directly in it). */
export function withinRoot(root: string, abs: string): boolean {
  return abs.startsWith(root.endsWith(sep) ? root : root + sep);
}

export async function resolveEditorPlugins(projectDir: string): Promise<EditorPluginResolution> {
  const lib = await loadLib();
  const manifest = await lib.loadManifest(projectDir);
  const config = lib.resolveConfig({}, manifest ?? {});

  const modules: EditorPluginModule[] = [];
  const issues: Array<{ ref: string; error: string }> = [];

  for (const p of config.plugins ?? []) {
    const ref = p.path ?? p.name ?? '(unspecified)';
    if (!p.path) {
      issues.push({
        ref,
        error:
          'vendored npm plugins are not loaded by the rich editor yet — ' +
          'its markers show as plain markdown here (preview and PDF are unaffected)',
      });
      continue;
    }
    // Same resolution as the loader: relative to the project, free to leave it.
    const abs = resolve(projectDir, p.path);
    if (!MODULE_EXT.test(abs)) {
      issues.push({ ref, error: 'plugin is not a .js/.mjs/.cjs module' });
      continue;
    }
    if (!existsSync(abs)) {
      issues.push({ ref, error: `plugin file not found: ${p.path}` });
      continue;
    }
    modules.push({
      ref,
      abs,
      root: dirname(abs),
      ...(p.export ? { exportName: p.export } : {}),
      ...(p.options && Object.keys(p.options).length > 0 ? { options: p.options } : {}),
    });
  }

  return { modules, issues };
}

/** URL-safe base64 of a path, for the path-shaped module URL. */
export const encodeSegment = (value: string): string =>
  Buffer.from(value, 'utf8').toString('base64url');

export const decodeSegment = (value: string): string =>
  Buffer.from(value, 'base64url').toString('utf8');

/**
 * The module URL for one plugin file.
 *
 * Path-shaped on purpose: a relative `import` inside the plugin resolves
 * against this URL, so `./rules/callout.js` lands on the sibling file's own
 * URL with no source rewriting anywhere. Both directories travel in the path
 * (not the query) because relative resolution drops a query string.
 */
export function pluginModuleUrl(projectDir: string, mod: EditorPluginModule): string {
  const rel = mod.abs.slice(mod.root.length + 1).split(sep).map(encodeURIComponent).join('/');
  return (
    `/api/project/plugin-module/${encodeSegment(projectDir)}/${encodeSegment(mod.root)}/${rel}`
  );
}
