import { error } from '@sveltejs/kit';
import { friendlyVcsError } from '../../../../../electron/server-bridge/friendly-errors';
import { defineRoute, loadLib, requireProjectDir } from '../../_lib/route';
import type { CompareBase } from '#lib/platform/shared-types.ts';
import type { RequestHandler } from './$types';

/**
 * One text file's two texts for the compare view (#408): before and after
 * the version (`base: "previous"`, the default), or the version beside the
 * file as it is now (`"current"`). The view diffs them. Read-only.
 */
export const POST: RequestHandler = defineRoute<{ projectDir: string; id: string; path: string; base: CompareBase }>({
  validate: async (raw) => {
    const body = raw as { projectDir?: string; id?: unknown; path?: unknown; base?: unknown };
    const projectDir = await requireProjectDir(body.projectDir, 'vcs/compare-file');
    const id = body.id;
    if (typeof id !== 'string' || !/^[0-9a-f]{40}$/i.test(id)) {
      error(400, 'vcs/compare-file requires a valid snapshot id');
    }
    const path = body.path;
    // Repo-relative, inside the book: the lib refuses anything else too.
    if (typeof path !== 'string' || path.trim() === '' || path.startsWith('/') || /^[a-zA-Z]:/.test(path) || path.split(/[\\/]/).includes('..')) {
      error(400, 'vcs/compare-file requires a file path inside the book');
    }
    const base = body.base ?? 'previous';
    if (base !== 'previous' && base !== 'current') error(400, 'vcs/compare-file requires base "previous" or "current"');
    return { projectDir, id, path, base };
  },
  call: async ({ body }) => {
    const lib = await loadLib();
    return lib.compareVersionFile(body.projectDir, body.id, body.path, body.base);
  },
  onError: (e) => friendlyVcsError(e, 'vcs/compare-file'),
});
