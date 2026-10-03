/**
 * Shared helpers for the publish routes (#35).
 *
 * Publishing needs exactly what the remote:* routes need — the lib and the
 * safeStorage-backed credential store (`getHostServices().remote.tokenStore`).
 *
 * SECURITY: token values never appear in responses. Connect passes the raw
 * token to the lib (which verifies BEFORE storing); every read path returns
 * redacted status only.
 */
import { getHostServices, loadLib, type LibModule } from '../_lib/route';

export { handlePublishErrors } from '../../../../electron/server-bridge/friendly-errors';

/**
 * The provider lookup + capability check + `PublishRequest` resolution the
 * two destinations routes (`destinations/list`, `destinations/create`) both
 * do identically before making their own, different, final call into the
 * provider. `capability` names which optional method the caller is about to
 * use, purely for the "can't do that" error message — the routes still call
 * it themselves afterward.
 */
export async function resolveDestinationProvider(
  projectDir: string,
  providerId: string,
  capability: 'listDestinations' | 'createDestination',
): Promise<{
  provider: ReturnType<LibModule['publishProviderFor']>;
  req: Awaited<ReturnType<LibModule['resolvePublishRequest']>>;
}> {
  const lib = await loadLib();
  const provider = lib.publishProviderFor(providerId);
  if (!provider[capability]) {
    const reason = capability === 'listDestinations' ? 'has no folder picker' : "can't create new folders";
    throw new Error(`${provider.info.label} ${reason}.`);
  }
  const req = await lib.resolvePublishRequest(
    { projectDir, providerId },
    { tokenStore: getHostServices().remote.tokenStore },
  );
  return { provider, req };
}
