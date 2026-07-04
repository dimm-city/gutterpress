import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isAbsolute } from 'node:path';
import { gitIdentityArgs } from '$lib/server/settings';
import { getVcsHooks } from '../../../../../electron/server-bridge/vcs-hooks';
import { friendlyVcsError } from '../../../../../electron/server-bridge/friendly-errors';

// Local type — do NOT import from contract.ts or the lib (keeps SPA bundle clean).
interface LibModule {
  detectProjectSource: (dir: string) => Promise<unknown>;
  providerFor: (source: unknown) => {
    initVersionHistory: (opts: { projectDir: string; initialMessage?: string; authorName?: string; authorEmail?: string }) => Promise<unknown>;
  };
  capabilitiesFor: (source: unknown) => unknown;
}

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => ({})) as { projectDir?: unknown };
  const projectDir = body.projectDir;
  if (typeof projectDir !== 'string' || !isAbsolute(projectDir)) {
    return error(400, 'vcs/enable-version-history requires an absolute projectDir');
  }

  try {
    const hooks = getVcsHooks<LibModule>();
    if (!hooks) return error(503, 'VCS hooks not registered');
    const lib = await hooks.loadLib();
    const source = await lib.detectProjectSource(projectDir);
    await lib.providerFor(source).initVersionHistory({
      projectDir,
      initialMessage: 'Initial snapshot',
      ...(await gitIdentityArgs()),
    });
    // Re-classify so the renderer gets the upgraded source + capabilities.
    const upgraded = await lib.detectProjectSource(projectDir);
    return json({ source: upgraded, capabilities: lib.capabilitiesFor(upgraded) });
  } catch (e) {
    if (e && typeof e === 'object' && 'status' in e) throw e; // rethrow SvelteKit errors
    const { status, message } = friendlyVcsError(e, 'enableVersionHistory', 'vcs/enable-version-history');
    throw error(status, message);
  }
};
