import path from 'node:path';
import { error } from '@sveltejs/kit';
import { defineRoute, getHostServices, requireAbsolute } from '../../_lib/route';
import type { RequestHandler } from './$types';

/**
 * Reveal the folder a repair moved the book's old history into
 * (`movedGitTo` / the repair result's backup folder) in the OS file manager.
 * Only a path inside the app's repair-backups folder is accepted: this is not a
 * general reveal. The old history can be looked at there; it can't be brought
 * back from inside the app.
 */
export const POST: RequestHandler = defineRoute<{ filePath: string }>({
  validate: (raw) => {
    const filePath = requireAbsolute((raw as { filePath?: unknown } | null)?.filePath, 'remote:showRepairBackup');
    // repairBackupDir(slug) is <userData>/repair-backups/<slug>/<stamp>.
    const root = path.dirname(path.dirname(getHostServices().vcs.repairBackupDir('x')));
    const rel = path.relative(root, path.resolve(filePath));
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
      error(403, 'remote:showRepairBackup: that folder is not a repair backup');
    }
    return { filePath: path.resolve(filePath) };
  },
  call: async ({ body }) => {
    getHostServices().desktop.showItemInFolder(body.filePath);
    return { ok: true };
  },
});
