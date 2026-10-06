import { gitIdentityArgs } from '$lib/server/settings';
import { friendlyVcsError } from '../../../../../electron/server-bridge/friendly-errors';
import { defineRoute, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

// The "turn a plain local-folder into a versioned project" half of the
// CLAUDE.md §7 escape hatch. Book settings → Connections calls it for a
// plain folder (ProjectConnectionsSection, #310).

export const POST: RequestHandler = defineRoute<{ projectDir: string }>({
  validate: async (raw) => ({
    projectDir: await requireProjectDir((raw as { projectDir?: string }).projectDir, 'vcs/enable-version-history'),
  }),
  call: async ({ body }) => {
    const lib = await loadLib();
    const source = await lib.detectProjectSource(body.projectDir);
    // The first version commits everything now: keep build output (dist/) out
    // of it, exactly like new-book setup and "Set up as a book" do.
    await lib.ensureGitignoreHasDist(body.projectDir);
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
