import { getHooks, handlePublishErrors, type LibPublishProviderInfo } from '../_hooks';
import { defineRoute, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

/**
 * Provider cards for the Publish panel: static info (incl. the provider's
 * declared settings fields) + redacted connection status + the project's
 * non-secret `publish.*` manifest settings.
 */
export const POST: RequestHandler = defineRoute<
  { projectDir: string },
  NonNullable<ReturnType<typeof getHooks>>
>({
  hooks: getHooks,
  hooksUnavailableMessage: 'Publish hooks not available',
  // In `validate`, not `call` — see publish/run's note on handlePublishErrors.
  validate: async (raw) => ({
    projectDir: await requireProjectDir((raw as { projectDir?: unknown }).projectDir, 'publish:list'),
  }),
  call: async ({ body, hooks }) =>
    handlePublishErrors('publish:list', async () => {
      const lib = await hooks.loadLib();
      if (
        !lib.listPublishProviders ||
        !lib.readPublishSettings ||
        !lib.publishConnectionStatus
      ) {
        throw new Error('Publishing is not available in this version of the lib');
      }
      const settings = await lib.readPublishSettings(body.projectDir);
      const cards = await Promise.all(
        lib.listPublishProviders().map(async (info: LibPublishProviderInfo) => {
          const raw = settings[info.id] ?? {};
          // Book-level selected account (manifest `publish.<id>.credential`);
          // "" = the default credential. It's a selection reference, NOT a
          // provider setting, so it's excluded from the rendered config fields.
          const selectedAccount =
            typeof raw.credential === 'string' ? raw.credential.trim() : '';
          const config: Record<string, string> = {};
          for (const [k, v] of Object.entries(raw)) {
            if (k === 'credential') continue;
            if (typeof v === 'string' || typeof v === 'number') config[k] = String(v);
          }
          // "connected" (env var or stored key) is evaluated for the SELECTED
          // account — the same shared definition the CLI's --list uses.
          const status = await lib.publishConnectionStatus!(
            info,
            { tokenStore: hooks.tokenStore, credentialAccount: selectedAccount },
            selectedAccount,
          );
          // Redacted saved credentials for the picker (default + named).
          const savedAccounts = lib.listPublishAccounts
            ? await lib.listPublishAccounts(info, { tokenStore: hooks.tokenStore })
            : [];
          return {
            id: info.id,
            label: info.label,
            kind: info.kind,
            format: info.format,
            // #221 phase 3, D8 — present only for a provider that supports
            // more than one format (gdrive); the wizard renders a PDF/Website
            // choice only when this is set.
            ...(info.formats && info.formats.length > 1 ? { formats: info.formats } : {}),
            description: info.description,
            fields: info.configFields,
            credentialRequired: info.credential.required,
            ...(info.credential.tokenUrl ? { tokenUrl: info.credential.tokenUrl } : {}),
            ...(info.credential.hint ? { hint: info.credential.hint } : {}),
            // #221 — "oauth" swaps the wizard's paste-a-key form for a
            // Connect button; absent/"token" is every provider's existing
            // paste-a-key behavior, unchanged.
            ...(info.credential.connect === 'oauth' ? { connectKind: 'oauth' as const } : {}),
            connected: status.connected,
            config,
            savedAccounts,
            selectedAccount,
            // #221 D9 — present only for providers with a folder/destination
            // picker (gdrive); the wizard renders the picker only when this is set.
            ...(info.destinations ? { destinations: info.destinations } : {}),
          };
        }),
      );
      return cards;
    }),
});
