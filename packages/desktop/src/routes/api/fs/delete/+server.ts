import { error } from '@sveltejs/kit';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { gitIdentityArgs } from '$lib/server/settings';
import { scheduleAutoWriteEffects } from '../../../../../electron/server-bridge/write-hooks';
import { getVcsHooks, type VcsHooks } from '../../../../../electron/server-bridge/vcs-hooks';
import { defineRoute, requireAbsolute, requireWithinProjectRoot } from '../../_lib/route';
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
// Local type — a narrow slice of the lib's real surface, not the full
// generated type (same rationale as vcs/save-snapshot's own `LibModule`).
interface ProjectSourceLike {
  type: string;
}
interface LibModule {
  detectProjectSource: (dir: string) => Promise<ProjectSourceLike>;
  capabilitiesFor: (source: ProjectSourceLike) => { canSnapshot: boolean };
  providerFor: (source: ProjectSourceLike) => {
    snapshot: (opts: {
      projectDir: string;
      message: string;
      logFile?: string;
      authorName?: string;
      authorEmail?: string;
    }) => Promise<unknown>;
  };
  isNoChangesError: (e: unknown) => boolean;
}

export const POST: RequestHandler = defineRoute<
  { path: string; projectDir: string },
  VcsHooks<LibModule>
>({
  hooks: () => getVcsHooks<LibModule>(),
  hooksUnavailableMessage: 'VCS hooks not registered',
  validate: async (raw) => {
    const body = raw as { path?: string; projectDir?: string };
    const projectDir = await requireWithinProjectRoot(
      requireAbsolute(body.projectDir, 'fs:delete'),
      'fs:delete',
    );
    const target = await requireWithinProjectRoot(requireAbsolute(body.path, 'fs:delete'), 'fs:delete');
    if (path.resolve(target) === path.resolve(projectDir)) {
      error(400, 'fs:delete cannot delete the project root');
    }
    return { path: target, projectDir };
  },
  call: async ({ body, hooks }) => {
    const lib = await hooks.loadLib();
    try {
      const source = await lib.detectProjectSource(body.projectDir);
      if (lib.capabilitiesFor(source).canSnapshot) {
        await lib.providerFor(source).snapshot({
          projectDir: body.projectDir,
          message: `Before deleting ${path.basename(body.path)}`,
          ...(await gitIdentityArgs()),
          logFile: hooks.operationLogPath(path.basename(body.projectDir)),
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

    await rm(body.path, { recursive: true, force: false });

    scheduleAutoWriteEffects(body.path);

    return { ok: true as const };
  },
});
