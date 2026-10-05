import { error } from '@sveltejs/kit';
import { handleRemoteErrors } from '../../../../../electron/server-bridge/friendly-errors';
import { defineRoute, getHostServices, requireAbsolute } from '../../_lib/route';
import type { CloneRepositoryArgs } from '$lib/platform/shared-types';
import type { RequestHandler } from './$types';

// A route, not IPC: this is plain request/response (the only push involved —
// remote:cloneProgress — is a SEPARATE `mainWindow.webContents.send` event the
// host's `cloneRepository` closure fires; it doesn't need this call itself to
// be IPC). `remote.cloneRepository` (electron/main.ts) does the operation.
export const POST: RequestHandler = defineRoute<CloneRepositoryArgs>({
  validate: (raw) => {
    const body = raw as Partial<CloneRepositoryArgs> | undefined;
    if (!body || typeof body.url !== 'string' || !body.url) {
      error(400, 'remote:cloneRepository requires { url, parentDir, folderName }');
    }
    const parentDir = requireAbsolute(body.parentDir, 'remote:cloneRepository');
    return { ...body, url: body.url, parentDir, folderName: body.folderName ?? '' };
  },
  call: ({ body }) =>
    handleRemoteErrors('remote:cloneRepository', () => getHostServices().remote.cloneRepository(body)),
});
