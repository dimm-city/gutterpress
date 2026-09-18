import { getHooks, handleRemoteErrors, type LibModule, type RemoteHooks, type TokenStore } from '../_hooks';
import { defineRoute, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

/**
 * Fetch every branch the project's remote has, so Settings → Saving's copy
 * picker lists copies created somewhere else (#273). Reads the network but
 * only ever writes remote-tracking refs — no local branch, no working-tree
 * change — so it is safe to call with unsaved work open.
 *
 * Best-effort by contract: an older lib, no remote, no credential, or being
 * offline all resolve to `{ refreshed: false }`. The picker then lists
 * whatever is already on disk rather than showing an error over a control the
 * author never explicitly asked to sync.
 */
export const POST: RequestHandler = defineRoute<
  { projectDir: string },
  RemoteHooks<LibModule, TokenStore>
>({
  hooks: getHooks,
  hooksUnavailableMessage: 'Remote hooks not available',
  validate: async (raw) => ({
    projectDir: await requireProjectDir((raw as { projectDir?: string })?.projectDir, 'remote:refreshCopies'),
  }),
  call: async ({ body, hooks }) =>
    handleRemoteErrors('remote:refreshCopies', async () => {
      const lib = await hooks.loadLib();
      if (!lib.refreshRemoteCopies) return { refreshed: false };
      return lib.refreshRemoteCopies({ projectDir: body.projectDir, tokenStore: hooks.tokenStore });
    }),
});
