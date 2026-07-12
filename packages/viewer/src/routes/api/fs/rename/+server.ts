import { error } from '@sveltejs/kit';
import { rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { getWriteHooks } from '../../../../../electron/server-bridge/write-hooks';
import { isWithinRoot } from '../../../../../electron/server-bridge/fs-guard';
import { defineRoute, requireAbsolute, requireWithinProjectRoot } from '../../_lib/route';
import { requireSegment } from '../_shared/validate-segment';
import type { RequestHandler } from './$types';

// FileTree row action "Rename" (UX review M9). Renames WITHIN the same
// parent directory only (a new name, never a new location) — `newName` is a
// single segment, not a path, so this can never become a move-to-arbitrary-
// destination primitive. Fails (409) rather than silently overwriting an
// existing same-named entry.
export const POST: RequestHandler = defineRoute<{ path: string; newName: string }>({
  validate: (raw) => {
    const body = raw as { path?: string; newName?: string };
    const from = requireWithinProjectRoot(requireAbsolute(body.path, 'fs:rename'), 'fs:rename');
    const newName = requireSegment(body.newName, 'fs:rename newName');
    return { path: from, newName };
  },
  call: async ({ body }) => {
    const dir = path.dirname(body.path);
    const to = requireWithinProjectRoot(path.join(dir, body.newName), 'fs:rename');
    if (path.resolve(to) === path.resolve(body.path)) {
      // Same name — a no-op rename (e.g. the author retyped the existing
      // name and hit Enter). Nothing to do; report the unchanged path.
      return { path: to };
    }
    const exists = await stat(to).then(() => true).catch(() => false);
    if (exists) error(409, `"${body.newName}" already exists here.`);
    await rename(body.path, to);

    const hooks = getWriteHooks();
    if (hooks) {
      const watchedDir = hooks.getWatchedDir();
      if (watchedDir && isWithinRoot(to, watchedDir)) {
        hooks.scheduleAutoSnapshot(watchedDir);
        hooks.scheduleAutoSync(watchedDir);
      }
    }

    return { path: to };
  },
});
