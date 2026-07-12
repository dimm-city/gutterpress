import { error } from '@sveltejs/kit';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getWriteHooks } from '../../../../../electron/server-bridge/write-hooks';
import { isWithinRoot } from '../../../../../electron/server-bridge/fs-guard';
import { defineRoute, requireAbsolute, requireWithinProjectRoot } from '../../_lib/route';
import { requireSegment } from '../_shared/validate-segment';
import type { RequestHandler } from './$types';

// FileTree row/toolbar "New chapter" (UX review M9). `dir` + `name` (not a
// full path) so path-joining stays host-side (`path.join`) — the renderer
// never hand-builds a path with `/`, the exact mistake M10 flagged for the
// image-import flows. Fails (409) rather than silently overwriting when a
// file already exists at the target — this is a CREATE, not a save.
export const POST: RequestHandler = defineRoute<{ dir: string; name: string; content: string }>({
  validate: (raw) => {
    const body = raw as { dir?: string; name?: string; content?: unknown };
    const dir = requireWithinProjectRoot(requireAbsolute(body.dir, 'fs:createFile'), 'fs:createFile');
    const name = requireSegment(body.name, 'fs:createFile name');
    const content = typeof body.content === 'string' ? body.content : '';
    return { dir, name, content };
  },
  call: async ({ body }) => {
    const target = requireWithinProjectRoot(path.join(body.dir, body.name), 'fs:createFile');
    await mkdir(body.dir, { recursive: true });
    try {
      await writeFile(target, body.content, { encoding: 'utf-8', flag: 'wx' });
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code === 'EEXIST') {
        error(409, `"${body.name}" already exists here.`);
      }
      throw e;
    }

    // Same auto-snapshot/sync arming write-file does (#44) — a newly
    // created chapter must be captured by the normal debounce, not wait for
    // an unrelated edit elsewhere to notice it.
    const hooks = getWriteHooks();
    if (hooks) {
      const watchedDir = hooks.getWatchedDir();
      if (watchedDir && isWithinRoot(target, watchedDir)) {
        hooks.scheduleAutoSnapshot(watchedDir);
        hooks.scheduleAutoSync(watchedDir);
      }
    }

    const s = await stat(target);
    return { path: target, mtimeMs: s.mtimeMs };
  },
});
