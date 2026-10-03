import { handlePublishErrors } from '../_hooks';
import { defineRoute, loadLib } from '../../_lib/route';
import type { RequestHandler } from './$types';

/**
 * Static publish-provider metadata — id/label/credential host/token URL. No
 * project required (unlike publish:list, which merges manifest config): the
 * Settings → Connections tab uses this to classify stored credentials into
 * "publishing accounts" vs "Git servers" and to label them, independent of
 * whatever project happens to be open.
 */
export const POST: RequestHandler = defineRoute<Record<string, never>>({
  call: async () =>
    handlePublishErrors('publish:providers', async () => {
      const lib = await loadLib();
      return lib.listPublishProviders().map((info) => ({
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
