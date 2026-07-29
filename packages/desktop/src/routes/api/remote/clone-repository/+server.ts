import { error } from '@sveltejs/kit';
import {
  getHooks,
  handleRemoteErrors,
  type CloneRepositoryArgs,
  type LibModule,
  type RemoteHooks,
  type TokenStore,
} from '../_hooks';
import { defineRoute, requireAbsolute } from '../../_lib/route';
import type { RequestHandler } from './$types';

// ARCH review #8: remote:cloneRepository was IPC despite being a plain
// request/response (the only push involved — remote:cloneProgress — is a
// SEPARATE `mainWindow.webContents.send` event the hooks.cloneRepository
// closure still fires; it doesn't need this call itself to be IPC). Its
// remote:* siblings were all already routes. hooks.cloneRepository
// (electron/main.ts) does the full original operation.
export const POST: RequestHandler = defineRoute<
  CloneRepositoryArgs,
  RemoteHooks<LibModule, TokenStore>
>({
  hooks: getHooks,
  hooksUnavailableMessage: 'Remote hooks not available',
  validate: (raw) => {
    const body = raw as Partial<CloneRepositoryArgs> | undefined;
    if (!body || typeof body.url !== 'string' || !body.url) {
      error(400, 'remote:cloneRepository requires { url, parentDir, folderName }');
    }
    const parentDir = requireAbsolute(body.parentDir, 'remote:cloneRepository');
    return { ...body, url: body.url, parentDir, folderName: body.folderName ?? '' };
  },
  call: ({ hooks, body }) =>
    handleRemoteErrors('remote:cloneRepository', () => hooks.cloneRepository(body)),
});
