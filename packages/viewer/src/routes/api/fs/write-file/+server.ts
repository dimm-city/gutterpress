import { json, error } from '@sveltejs/kit';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({})) as { path?: string; content?: string };
    const filePath = body.path;
    const content = body.content;
    if (!filePath) return error(400, 'path is required');
    if (content === undefined) return error(400, 'content is required');
    if (!path.isAbsolute(filePath)) return error(400, `fs:writeFile requires an absolute path, got: ${filePath}`);

    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content, 'utf-8');

    // Trigger auto-snapshot/sync debounce for edits inside the open project.
    // The hooks are registered by main.ts on startup via globalThis.
    const hooks = (globalThis as unknown as { __printMdWriteHooks__?: { scheduleAutoSnapshot: (d: string) => void; scheduleAutoSync: (d: string) => void; getWatchedDir: () => string | null } }).__printMdWriteHooks__;
    if (hooks) {
      const watchedDir = hooks.getWatchedDir();
      if (watchedDir) {
        const resolved = path.resolve(filePath);
        const root = path.resolve(watchedDir);
        if (resolved === root || resolved.startsWith(root + path.sep)) {
          hooks.scheduleAutoSnapshot(watchedDir);
          hooks.scheduleAutoSync(watchedDir);
        }
      }
    }

    const s = await stat(filePath);
    return json({ mtimeMs: s.mtimeMs });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
