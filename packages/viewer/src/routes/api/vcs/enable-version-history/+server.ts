import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isAbsolute } from 'node:path';
import { gitIdentityArgs } from '$lib/server/settings';

// Local type — do NOT import from contract.ts or the lib (keeps SPA bundle clean).
interface LibModule {
  detectProjectSource: (dir: string) => Promise<unknown>;
  providerFor: (source: unknown) => {
    initVersionHistory: (opts: { projectDir: string; initialMessage?: string; authorName?: string; authorEmail?: string }) => Promise<unknown>;
  };
  capabilitiesFor: (source: unknown) => unknown;
}

const VCS_FRIENDLY_ERROR =
  /no changes since the last snapshot|no version history yet|your work is safe|project files were not changed|requires an absolute project path|valid snapshot id|already inside a versioned project/i;

function friendlyError(e: unknown, op: string): never {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`[vcs/enable-version-history] failed: ${msg}`);
  if (e instanceof Error && (e as Error & { stack?: string }).stack) {
    console.error((e as Error & { stack?: string }).stack);
  }
  if (VCS_FRIENDLY_ERROR.test(msg)) {
    throw error(422, msg);
  }
  throw error(500, `Version history could not complete the ${op} operation. See the app log for details.`);
}

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => ({})) as { projectDir?: unknown };
  const projectDir = body.projectDir;
  if (typeof projectDir !== 'string' || !isAbsolute(projectDir)) {
    return error(400, 'vcs/enable-version-history requires an absolute projectDir');
  }

  try {
    const hooks = (globalThis as unknown as Record<string, { loadLib: () => Promise<LibModule> }>).__printMdVcsHooks__;
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
    friendlyError(e, 'enableVersionHistory');
  }
};
