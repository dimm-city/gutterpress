import { error } from '@sveltejs/kit';
import {
  getHooks,
  handleRemoteErrors,
  type LibModule,
  type RemoteHooks,
  type ResolveSyncConflictsArgs,
  type TokenStore,
} from '../_hooks';
import { defineRoute, requireAbsolute } from '../../_lib/route';
import type { RequestHandler } from './$types';

const HEX40 = /^[0-9a-f]{40}$/i;

// ARCH review #8: remote:resolveSyncConflicts was IPC despite being a plain
// request/response. Its remote:* siblings were all already routes.
// hooks.resolveSyncConflicts (electron/main.ts) does the full original
// operation, including re-arming the auto-sync conflict latch on success.
export const POST: RequestHandler = defineRoute<
  ResolveSyncConflictsArgs,
  RemoteHooks<LibModule, TokenStore>
>({
  hooks: getHooks,
  hooksUnavailableMessage: 'Remote hooks not available',
  validate: (raw) => {
    const body = raw as Partial<ResolveSyncConflictsArgs> | undefined;
    const projectDir = requireAbsolute(body?.projectDir, 'remote:resolveSyncConflicts');
    if (
      !body ||
      !Array.isArray(body.resolutions) ||
      body.resolutions.length === 0 ||
      !body.resolutions.every(
        (r) =>
          r &&
          typeof r.path === 'string' &&
          r.path.length > 0 &&
          (r.choice === 'mine' || r.choice === 'theirs' || r.choice === 'both'),
      )
    ) {
      error(400, 'remote:resolveSyncConflicts requires a non-empty resolutions list');
    }
    if (
      typeof body.localId !== 'string' ||
      typeof body.remoteId !== 'string' ||
      !HEX40.test(body.localId) ||
      !HEX40.test(body.remoteId)
    ) {
      error(400, 'remote:resolveSyncConflicts requires valid version ids');
    }
    return { projectDir, resolutions: body.resolutions, localId: body.localId, remoteId: body.remoteId };
  },
  call: ({ hooks, body }) =>
    handleRemoteErrors('remote:resolveSyncConflicts', () => hooks.resolveSyncConflicts(body)),
});
