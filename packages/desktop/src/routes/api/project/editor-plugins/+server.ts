import { defineRoute, requireProjectDir } from '../../_lib/route';
import { pluginModuleUrl, resolveEditorPlugins } from '../../_lib/plugin-modules';
import type { EditorPluginEntry } from '$lib/api';
import type { RequestHandler } from './$types';

/**
 * The project's manifest plugins, as the RICH EDITOR can load them.
 *
 * The editor parses in the renderer with the same pipeline that prints
 * (`gutterpress/render`), but the project's plugin FUNCTIONS live in project
 * files the SPA cannot import directly. This route resolves each manifest
 * entry — through the shared resolver, which resolves paths exactly as the
 * loader does, including plugins that live beside the project rather than
 * inside it — to a same-origin module URL the client `import()`s, or to a
 * stated reason it cannot be loaded, which the editor surfaces rather than
 * silently parsing with the wrong dialect.
 *
 * Local-path plugins only, for now: a vendored npm plugin's receipt-verified
 * tree may be multi-file CommonJS, which a browser `import()` cannot resolve.
 * Those degrade loudly (markers render as plain text in the editor; content
 * stays byte-safe because unadopted marker lines round-trip as paragraphs).
 */
export const POST: RequestHandler = defineRoute<{ projectDir: string }>({
  validate: async (raw) => {
    const body = raw as { projectDir?: unknown };
    return { projectDir: await requireProjectDir(body.projectDir, 'project/editor-plugins') };
  },
  call: async ({ body }) => {
    const { modules, issues } = await resolveEditorPlugins(body.projectDir);
    const plugins: EditorPluginEntry[] = [
      ...modules.map((mod) => ({
        ref: mod.ref,
        url: pluginModuleUrl(body.projectDir, mod),
        ...(mod.exportName ? { exportName: mod.exportName } : {}),
        ...(mod.options ? { options: mod.options } : {}),
      })),
      ...issues,
    ];
    return { plugins };
  },
});
