/**
 * Shared helpers for the publish routes (#35).
 *
 * Publishing needs what the remote:* routes need — the lib and the
 * safeStorage-backed credential store (`getHostServices().remote.tokenStore`)
 * — plus the person's private per-book settings ({@link publishDeps}).
 *
 * SECURITY: token values never appear in responses. Connect passes the raw
 * token to the lib (which verifies BEFORE storing); every read path returns
 * redacted status only.
 */
import path from 'node:path';
import { getHostServices, loadLib, type LibModule } from '../_lib/route';

export { handlePublishErrors } from '../../../../electron/server-bridge/friendly-errors';

let selections: { file: string; store: InstanceType<LibModule['PublishSelectionsStore']> } | null = null;

/**
 * The deps every publish route hands the lib: the credential store, and this
 * person's PRIVATE publish settings for each book (`userData/publish-selections.json`,
 * `0600`): the saved account a book publishes with, a Google Drive folder, an
 * output folder outside the book. They are read over the manifest's values and
 * never written into the manifest (see the lib's `savePublishSettings`). One
 * store for the process, so its writes queue behind one another.
 */
export async function publishDeps() {
  const lib = await loadLib();
  const file = path.join(getHostServices().desktop.getUserDataPath(), 'publish-selections.json');
  if (selections?.file !== file) selections = { file, store: new lib.PublishSelectionsStore(file) };
  return { tokenStore: getHostServices().remote.tokenStore, selections: selections.store };
}

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
  const req = await lib.resolvePublishRequest({ projectDir, providerId }, await publishDeps());
  return { provider, req };
}
