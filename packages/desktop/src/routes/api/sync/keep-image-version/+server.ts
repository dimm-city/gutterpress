/**
 * POST /api/sync/keep-image-version { projectDir, path, oid }
 *
 * Apply the writer's pick from ImageClashPicker: the host writes the chosen
 * blob's exact bytes back to the file and snapshots; normal auto-sync
 * publishes it. The lib validates the oid and the repo-relative path.
 */
import { join } from 'node:path';
import { error } from '@sveltejs/kit';
import { gitIdentityArgs } from '$lib/server/settings';
import { getVcsHooks, type VcsHooks } from '../../../../../electron/server-bridge/vcs-hooks';
import { defineRoute, requireProjectDir, requireWithinProjectRoot } from '../../_lib/route';
import type { RequestHandler } from './$types';

interface LibModule {
  keepImageVersion(options: {
    projectDir: string;
    path: string;
    oid: string;
    authorName?: string;
    authorEmail?: string;
  }): Promise<void>;
}

export const POST: RequestHandler = defineRoute<
  { projectDir: string; path: string; oid: string },
  VcsHooks<LibModule>
>({
  hooks: () => getVcsHooks<LibModule>(),
  hooksUnavailableMessage: 'VCS hooks not registered',
  validate: async (raw) => {
    const body = raw as { projectDir?: unknown; path?: unknown; oid?: unknown };
    const projectDir = await requireProjectDir(body?.projectDir, 'sync:keepImageVersion');
    if (typeof body?.path !== 'string' || body.path.length === 0) {
      error(400, 'sync:keepImageVersion requires a file path');
    }
    if (typeof body?.oid !== 'string' || !/^[0-9a-f]{40}$/.test(body.oid)) {
      error(400, 'sync:keepImageVersion requires a valid version id');
    }
    // Canonical confinement of the WRITE target (not just projectDir): a
    // project-local symlink aliasing an outside directory must not let the
    // chosen bytes be written outside the open project (same policy as the
    // plain fs routes — see fs-routes-scoping.test.ts).
    await requireWithinProjectRoot(join(projectDir, body.path), 'sync:keepImageVersion');
    return { projectDir, path: body.path, oid: body.oid };
  },
  call: async ({ body, hooks }) => {
    const lib = await hooks.loadLib();
    const identity = await gitIdentityArgs();
    await lib.keepImageVersion({ ...body, ...identity });
    return { ok: true };
  },
});
