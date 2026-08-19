import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { error } from '@sveltejs/kit';
import { requireProjectDir } from '../../../_lib/fs-guard';
import {
  decodeSegment,
  resolveEditorPlugins,
  withinRoot,
} from '../../../_lib/plugin-modules';
import type { RequestHandler } from './$types';

/**
 * Serve one project plugin file as an importable ES module.
 *
 * GET, not the house `defineRoute` POST: this URL is the target of a dynamic
 * `import()` from the SPA (see `$lib/editor/project-plugins.ts`), and module
 * fetches are GETs. Same-origin, so no CORS surface.
 *
 * ## Why the path shape
 *
 * `/api/project/plugin-module/<project>/<pluginDir>/<file...>`, both
 * directories base64url-encoded. A plugin that imports its own files
 * (`import { callout } from "./rules/callout.js"`) makes the browser resolve
 * that specifier against THIS url, so a path-shaped url serves the sibling
 * with no source rewriting. A query string would be dropped by that
 * resolution, which is why neither directory travels as one.
 *
 * ## What may be served
 *
 * The manifest is the authority (`resolveEditorPlugins`): `<pluginDir>` must
 * be the folder of a plugin THIS project declares, and the file must sit
 * inside it with a module extension. A book whose plugin lives beside it
 * rather than inside it — `../shared-design/plugins/x.js`, which the loader
 * and therefore the preview and the PDF accept — is served here too; an
 * invented path is not, whatever it points at.
 *
 * `no-store` so editing a plugin file is picked up on the next
 * project-renderer rebuild rather than pinned by the HTTP cache.
 */
export const GET: RequestHandler = async ({ params }) => {
  const segments = (params.path ?? '').split('/').filter(Boolean);
  if (segments.length < 3) throw error(400, 'plugin module path is incomplete');

  const [projectSeg, rootSeg, ...fileSegs] = segments;
  let projectDir: string;
  let root: string;
  try {
    projectDir = decodeSegment(projectSeg!);
    root = decodeSegment(rootSeg!);
  } catch {
    throw error(400, 'plugin module path is malformed');
  }
  projectDir = await requireProjectDir(projectDir, 'project/plugin-module');

  // The manifest decides which directories exist as far as this route is
  // concerned; anything else is refused before a byte is read.
  const { modules } = await resolveEditorPlugins(projectDir);
  if (!modules.some((m) => m.root === root)) {
    throw error(403, 'not a plugin directory of this project');
  }

  const abs = resolve(root, ...fileSegs.map((s) => decodeURIComponent(s)));
  if (!withinRoot(root, abs)) throw error(400, 'plugin path escapes its plugin directory');
  if (!/\.(m?js|cjs)$/i.test(abs)) throw error(400, 'not a plugin module');

  let code: string;
  try {
    code = await readFile(abs, 'utf-8');
  } catch {
    throw error(404, `plugin file not found: ${abs}`);
  }
  return new Response(code, {
    headers: {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
};
