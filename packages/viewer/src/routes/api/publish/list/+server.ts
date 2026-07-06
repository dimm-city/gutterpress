import { error } from '@sveltejs/kit';
import { getHooks, handlePublishErrors } from '../_hooks';
import { jsonRoute, requireAbsolute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

/**
 * Provider cards for the Publish panel: static info (incl. the provider's
 * declared settings fields) + redacted connection status + the project's
 * non-secret `publish.*` manifest settings.
 */
export const POST: RequestHandler = jsonRoute(async (body: { projectDir?: string }) => {
  const hooks = getHooks();
  if (!hooks) error(503, 'Publish hooks not available');
  return handlePublishErrors('publish:list', async () => {
    const projectDir = requireAbsolute(body.projectDir, 'publish:list');
    const lib = await hooks.loadLib();
    if (
      !lib.listPublishProviders ||
      !lib.readPublishSettings ||
      !lib.publishConnectionStatus
    ) {
      throw new Error('Publishing is not available in this version of the lib');
    }
    const settings = await lib.readPublishSettings(projectDir);
    const cards = await Promise.all(
      lib.listPublishProviders().map(async (info) => {
        // One shared definition of "connected" (env var or stored key) — the
        // same the CLI's --list uses, so the two surfaces can't disagree.
        const status = await lib.publishConnectionStatus!(info, {
          tokenStore: hooks.tokenStore,
        });
        const raw = settings[info.id] ?? {};
        const config: Record<string, string> = {};
        for (const [k, v] of Object.entries(raw)) {
          if (typeof v === 'string' || typeof v === 'number') config[k] = String(v);
        }
        return {
          id: info.id,
          label: info.label,
          kind: info.kind,
          format: info.format,
          description: info.description,
          fields: info.configFields,
          credentialRequired: info.credential.required,
          ...(info.credential.tokenUrl ? { tokenUrl: info.credential.tokenUrl } : {}),
          ...(info.credential.hint ? { hint: info.credential.hint } : {}),
          connected: status.connected,
          config,
        };
      }),
    );
    return cards;
  });
});
