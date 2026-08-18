import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { error } from '@sveltejs/kit';
import { requireProjectDir } from '../../_lib/fs-guard';
import type { RequestHandler } from './$types';

/**
 * Serve one project plugin file as an importable ES module.
 *
 * GET, not the house `defineRoute` POST: this URL is the target of a dynamic
 * `import()` from the SPA (see `$lib/editor/project-plugins.ts`), and module
 * fetches are GETs. Same-origin, so no CORS surface.
 *
 * Guarded like every fs route: `dir` must be a host-approved project root and
 * `rel` must resolve strictly inside it, with a module extension. `no-store`
 * so editing a plugin file during development is picked up on the next
 * project-renderer rebuild rather than pinned by the HTTP cache.
 */
export const GET: RequestHandler = async ({ url }) => {
  const dir = await requireProjectDir(url.searchParams.get('dir'), 'project/plugin-module');
  const rel = url.searchParams.get('rel') ?? '';
  const abs = resolve(dir, rel);
  if (!(abs + sep).startsWith(dir + sep) || abs === dir) {
    throw error(400, 'plugin path resolves outside the project');
  }
  if (!/\.(m?js|cjs)$/i.test(abs)) {
    throw error(400, 'not a plugin module');
  }
  let code: string;
  try {
    code = await readFile(abs, 'utf-8');
  } catch {
    throw error(404, `plugin file not found: ${rel}`);
  }
  return new Response(code, {
    headers: {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
};
