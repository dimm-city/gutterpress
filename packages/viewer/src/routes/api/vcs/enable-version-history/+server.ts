import { gitIdentityArgs } from '$lib/server/settings';
import { friendlyVcsError } from '../../../../../electron/server-bridge/friendly-errors';
import { defineRoute, loadLib, requireAbsolute } from '../../_lib/route';
import type { RequestHandler } from './$types';

// Local type — do NOT import from contract.ts or the lib (keeps SPA bundle clean).
interface LibModule {
  detectProjectSource: (dir: string) => Promise<unknown>;
  providerFor: (source: unknown) => {
    initVersionHistory: (opts: {
      projectDir: string;
      initialMessage?: string;
      authorName?: string;
      authorEmail?: string;
    }) => Promise<unknown>;
  };
  capabilitiesFor: (source: unknown) => unknown;
}

export const POST: RequestHandler = defineRoute<{ projectDir: string }>({
  validate: (raw) => ({
    projectDir: requireAbsolute((raw as { projectDir?: string }).projectDir, 'vcs/enable-version-history'),
  }),
  call: async ({ body }) => {
    const lib = (await loadLib()) as unknown as LibModule;
    const source = await lib.detectProjectSource(body.projectDir);
    await lib.providerFor(source).initVersionHistory({
      projectDir: body.projectDir,
      initialMessage: 'Initial snapshot',
      ...(await gitIdentityArgs()),
    });
    // Re-classify so the renderer gets the upgraded source + capabilities.
    const upgraded = await lib.detectProjectSource(body.projectDir);
    return { source: upgraded, capabilities: lib.capabilitiesFor(upgraded) };
  },
  onError: (e) => friendlyVcsError(e, 'enableVersionHistory', 'vcs/enable-version-history'),
});
