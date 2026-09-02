import { getHooks, handlePublishErrors, type LibPublishProviderInfo } from '../_hooks';
import { defineRoute } from '../../_lib/route';
import type { RequestHandler } from './$types';

/**
 * Static publish-provider metadata — id/label/credential host/token URL. No
 * project required (unlike publish:list, which merges manifest config): the
 * Settings → Connections tab uses this to classify stored credentials into
 * "publishing accounts" vs "Git servers" and to label them, independent of
 * whatever project happens to be open.
 */
export const POST: RequestHandler = defineRoute<
  Record<string, never>,
  NonNullable<ReturnType<typeof getHooks>>
>({
  hooks: getHooks,
  hooksUnavailableMessage: 'Publish hooks not available',
  call: async ({ hooks }) =>
    handlePublishErrors('publish:providers', async () => {
      const lib = await hooks.loadLib();
      if (!lib.listPublishProviders) {
        throw new Error('Publishing is not available in this version of the lib');
      }
      return lib.listPublishProviders().map((info: LibPublishProviderInfo) => ({
        id: info.id,
        label: info.label,
        kind: info.kind,
        credentialRequired: info.credential.required,
        credentialHost: info.credential.host || null,
        tokenUrl: info.credential.tokenUrl ?? null,
        hint: info.credential.hint ?? null,
        // #221 — "oauth" swaps Connections' add-a-key form for a Connect
        // button; null/absent is every provider's existing paste-a-key path.
        connectKind: info.credential.connect === 'oauth' ? 'oauth' : null,
      }));
    }),
});
