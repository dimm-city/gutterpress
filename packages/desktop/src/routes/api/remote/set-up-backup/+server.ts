import { error } from '@sveltejs/kit';
import { handleRemoteErrors } from '../../../../../electron/server-bridge/friendly-errors';
import { gitIdentityArgs } from '$lib/server/settings';
import { defineRoute, getHostServices, loadLib, requireProjectDir } from '../../_lib/route';
import type { BackupTarget } from '$lib/platform/shared-types';
import type { RequestHandler } from './$types';

// Online backup for a book that started on this computer (#358): create (or
// choose an EMPTY) GitHub repository, set it as the book's online copy and
// push the book's history. The lib returns every expected outcome as data
// (`status: "failed"` + a plain-language message), so the renderer shows that
// message verbatim; only unexpected errors reach handleRemoteErrors.
export const POST: RequestHandler = defineRoute<{ projectDir: string; target: BackupTarget }>({
  validate: async (raw) => {
    const body = raw as { projectDir?: string; target?: Partial<BackupTarget> & Record<string, unknown> };
    const projectDir = await requireProjectDir(body?.projectDir, 'remote:setUpBackup');
    const t = body?.target;
    if (t?.kind === 'create' && typeof t.name === 'string') {
      return {
        projectDir,
        target: { kind: 'create', name: t.name, ...(typeof t.private === 'boolean' ? { private: t.private } : {}) },
      };
    }
    if (t?.kind === 'existing' && typeof t.owner === 'string' && typeof t.name === 'string' && t.owner && t.name) {
      return { projectDir, target: { kind: 'existing', owner: t.owner, name: t.name } };
    }
    error(400, 'remote:setUpBackup requires { projectDir, target: { kind: "create", name } | { kind: "existing", owner, name } }');
  },
  call: ({ body }) =>
    handleRemoteErrors('remote:setUpBackup', async () => {
      const lib = await loadLib();
      const identity = await gitIdentityArgs();
      return lib.setUpOnlineBackup({
        projectDir: body.projectDir,
        target: body.target,
        tokenStore: getHostServices().remote.tokenStore,
        authorName: identity.authorName,
        authorEmail: identity.authorEmail,
      });
    }),
});
