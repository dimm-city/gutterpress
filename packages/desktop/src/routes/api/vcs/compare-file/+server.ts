import { error } from '@sveltejs/kit';
import { friendlyVcsError } from '../../../../../electron/server-bridge/friendly-errors';
import { defineRoute, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

/**
 * One text file at a version beside the file as it is now (#408), as rows
 * the compare view lays out side by side. Read-only.
 */
export const POST: RequestHandler = defineRoute<{ projectDir: string; id: string; path: string }>({
  validate: async (raw) => {
    const body = raw as { projectDir?: string; id?: unknown; path?: unknown };
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
    return { projectDir, id, path };
  },
  call: async ({ body }) => {
    const lib = await loadLib();
    return lib.compareVersionFile(body.projectDir, body.id, body.path);
  },
  onError: (e) => friendlyVcsError(e, 'vcs/compare-file'),
});
