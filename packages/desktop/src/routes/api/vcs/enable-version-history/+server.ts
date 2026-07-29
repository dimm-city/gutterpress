import { gitIdentityArgs } from '$lib/server/settings';
import { friendlyVcsError } from '../../../../../electron/server-bridge/friendly-errors';
import { defineRoute, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

// NOTE (audit D7): no SPA action calls api.vcs.enableVersionHistory yet — the
// "turn a plain local-folder into a versioned project" escape hatch (CLAUDE.md
// §7) is implemented end-to-end here but not surfaced in the UI. Intentionally
// retained ahead of the version-history milestone (#13); wire a StatusBar /
// Settings action to api.vcs.enableVersionHistory when that feature lands.

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
  validate: async (raw) => ({
    projectDir: await requireProjectDir((raw as { projectDir?: string }).projectDir, 'vcs/enable-version-history'),
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
