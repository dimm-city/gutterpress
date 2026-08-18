import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { defineRoute, loadLib, requireProjectDir } from '../../_lib/route';
import type { EditorPluginEntry } from '$lib/api';
import type { RequestHandler } from './$types';

/**
 * The project's manifest plugins, as the RICH EDITOR can load them.
 *
 * The editor parses in the renderer with the same pipeline that prints
 * (`gutterpress/render`), but the project's plugin FUNCTIONS live in project
 * files the SPA cannot import directly. This route resolves each manifest
 * entry to a same-origin module URL (`api/project/plugin-module`) the client
 * `import()`s — or to a stated reason it cannot be loaded, which the editor
 * surfaces rather than silently parsing with the wrong dialect.
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
    const lib = await loadLib();
    const manifest = await lib.loadManifest(body.projectDir);
    const config = lib.resolveConfig({}, manifest ?? {});
    const plugins: EditorPluginEntry[] = (config.plugins ?? []).map((p) => {
      const ref = p.path ?? p.name ?? '(unspecified)';
      if (!p.path) {
        return {
          ref,
          error:
            'vendored npm plugins are not loaded by the rich editor yet — ' +
            'its markers show as plain markdown here (preview and PDF are unaffected)',
        };
      }
      const abs = resolve(body.projectDir, p.path);
      if (!(abs + sep).startsWith(body.projectDir + sep) || abs === body.projectDir) {
        return { ref, error: 'plugin path resolves outside the project' };
      }
      if (!/\.(m?js|cjs)$/i.test(abs)) {
        return { ref, error: 'plugin is not a .js/.mjs/.cjs module' };
      }
      if (!existsSync(abs)) {
        return { ref, error: `plugin file not found: ${p.path}` };
      }
      return {
        ref,
        url:
          `/api/project/plugin-module?dir=${encodeURIComponent(body.projectDir)}` +
          `&rel=${encodeURIComponent(p.path)}`,
        ...(p.export ? { exportName: p.export } : {}),
        ...(p.options && Object.keys(p.options).length > 0 ? { options: p.options } : {}),
      };
    });
    return { plugins };
  },
});
