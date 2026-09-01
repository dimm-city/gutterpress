/**
 * Publishing capability (SFE-P5c3). Replaces `api.publish.*` (deleted
 * `src/routes/api/publish/**` HTTP routes) with typed IPC through the one
 * shared `bridge()` accessor — the same shape every other capability module
 * uses (SFE-P5b).
 *
 * Its own small module (run note, per the run specification's "publish
 * likely joins build-preview-capability or gets its own — smallest honest
 * shape"): `$lib/export/build-preview-capability.ts` (D10's "build/preview/
 * export" bounded context) owns only the preview/build pipeline — it has no
 * publishing, credential, or manifest-config member, and publishing's
 * consumers (`ConnectionsSettings.svelte`, `PublishWizard.svelte` via
 * `publish-section-controller.svelte.ts`, `+page.svelte`) are a distinct
 * caller set from that module's own (`ExportController`,
 * `ProjectLifecycleController`). Folding seven publish members into
 * build-preview-capability would mix "drive the live preview/export
 * pipeline" with "manage stored publish credentials and provider config" —
 * two different concerns that happen to share the word "publish". A
 * dedicated module keeps each bounded context legible, matching the
 * `vcs-capability.ts` precedent (its own small file despite being adjacent
 * to another named context).
 *
 * Error semantics (run rule 2): every function scrubs the Electron IPC
 * transport prefix (`friendlyHostError`) off a rejection's message before
 * re-throwing, so a caller's existing `e instanceof Error ? e.message :
 * String(e)` handling keeps showing the same author-facing text the deleted
 * HTTP routes used to send as the response body.
 */
import { bridge } from "$lib/platform/bridge";
import { friendlyHostError } from "$lib/errors";
import type { PublishProviderCard, PublishProviderStaticInfo, PublishRunResult } from "$lib/platform/contract";
import type { PreflightRow } from "$lib/preflight";

export type { PublishProviderStaticInfo };

async function call<T>(op: Promise<T>): Promise<T> {
  try {
    return await op;
  } catch (e) {
    throw new Error(friendlyHostError(e instanceof Error ? e.message : String(e)));
  }
}

/** Provider cards: static info + redacted connection status + manifest config. */
export function listProviders(projectDir: string): Promise<PublishProviderCard[]> {
  return call(bridge().publish.listProviders(projectDir));
}

/** Static provider metadata — id/label/credential host. No project needed
 *  (Settings → Connections classification + labels). */
export function providers(): Promise<PublishProviderStaticInfo[]> {
  return call(bridge().publish.providers());
}

/**
 * Store + verify an API key for a provider. The token travels once, to the
 * host; the response is redacted and the key never comes back. An optional
 * `account` label stores a NAMED credential (a user can keep several per
 * provider); empty stores the default.
 */
export function connect(
  projectDir: string,
  providerId: string,
  token: string,
  account?: string,
): Promise<{ connected: boolean; providerId: string }> {
  return call(bridge().publish.connect(projectDir, providerId, token, account));
}

/** Forget a stored key for a provider (the default, or a named `account`). */
export function disconnect(providerId: string, account?: string): Promise<{ ok: boolean }> {
  return call(bridge().publish.disconnect(providerId, account));
}

/** Write NON-SECRET provider settings into the manifest's publish section. */
export function setConfig(
  projectDir: string,
  providerId: string,
  values: Record<string, string>,
): Promise<Record<string, Record<string, unknown>>> {
  return call(bridge().publish.setConfig(projectDir, providerId, values));
}

/**
 * Pre-build publish preflight (#105): run the SOURCE + ASSET checks (no PDF
 * build) for a project, scoped to the selected destinations. Returns the
 * plain-language rows the wizard's Preflight step renders + gates on.
 */
export function preflight(projectDir: string, providerIds: string[]): Promise<PreflightRow[]> {
  return call(bridge().publish.preflight(projectDir, providerIds) as Promise<PreflightRow[]>);
}

/** Publish (or preflight with dryRun). Long-running; resolves with the result. */
export function run(
  projectDir: string,
  providerId: string,
  options?: { dryRun?: boolean; artifactPath?: string },
): Promise<PublishRunResult> {
  return call(bridge().publish.run(projectDir, providerId, options));
}
