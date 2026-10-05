import { error } from '@sveltejs/kit';
import path from 'node:path';
import { gitIdentityArgs } from '$lib/server/settings';
import { scheduleAutoWriteEffects } from '../../../../../electron/server-bridge/write-hooks';
import { holdDeleted } from '../_shared/recently-deleted';
import { defineRoute, getHostServices, loadLib, requireAbsolute, requireWithinProjectRoot } from '../../_lib/route';
import type { RequestHandler } from './$types';

// FileTree row action "Delete" (UX review M9). The destructive path: the
// CLIENT already requires an inline two-step confirm before calling this
// (the W4 armed-confirm pattern) — this route owns the SECOND safety net,
// mirroring vcs/restore-snapshot's discipline ("the lib snapshots the
// current state before restoring, so the operation can never lose author
// work"): when the project has version history, the working tree is
// snapshotted FIRST, so the deleted content stays reachable through Version
// History even if the confirm was a mis-click. Local-folder projects (no
// version history yet) have no snapshot to take — the inline confirm is
// their only safety net, same as every other destructive action in the app
// today (theme Remove, M7).
//
// The item is moved aside rather than removed (#313), so the "Deleted … Undo"
// toast can bring it back through fs/undo-delete — see recently-deleted.ts.

export const POST: RequestHandler = defineRoute<{ path: string; projectDir: string }>({
  validate: async (raw) => {
    const body = raw as { path?: string; projectDir?: string };
    const projectDir = await requireWithinProjectRoot(
      requireAbsolute(body.projectDir, 'fs:delete'),
      'fs:delete',
    );
    const target = await requireWithinProjectRoot(requireAbsolute(body.path, 'fs:delete'), 'fs:delete');
    if (path.resolve(target) === path.resolve(projectDir)) {
      error(400, 'fs:delete cannot delete the book folder');
    }
    return { path: target, projectDir };
  },
  call: async ({ body }) => {
    const lib = await loadLib();
    try {
      const source = await lib.detectProjectSource(body.projectDir);
      if (lib.capabilitiesFor(source).canSnapshot) {
        // The log identifies the REPO, not the opened book — the snapshot
        // commits the whole repository (see recovery-paths.ts's
        // operationLogSlug).
        const repoRoot = lib.repoRootForSource(source, body.projectDir);
        await lib.providerFor(source).snapshot({
          projectDir: body.projectDir,
          message: `Before deleting ${path.basename(body.path)}`,
          ...(await gitIdentityArgs()),
          logFile: getHostServices().vcs.operationLogPath(path.basename(repoRoot)),
        });
      }
    } catch (e) {
      // "Nothing new to save" means the pre-delete state is ALREADY the most
      // recent snapshot — safe to proceed. Any other snapshot failure must
      // abort the delete rather than delete with no safety net (mirrors
      // restoreVersionWithBackup: a failed backup blocks the destructive op).
      if (!lib.isNoChangesError(e)) {
        throw new Error(
          `Could not save a safety snapshot before deleting — nothing was deleted. (${
            e instanceof Error ? e.message : String(e)
          })`,
        );
      }
    }

    const undoToken = await holdDeleted(body.path);

    scheduleAutoWriteEffects(body.path);

    return { ok: true as const, undoToken };
  },
});
