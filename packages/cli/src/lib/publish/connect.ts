/**
 * Shared connect flow (#35) — one implementation for both front-ends (the CLI
 * `--connect` flag and the desktop's publish:connect route), with the ordering
 * that keeps the credential store safe:
 *
 *   1. Resolve the request (manifest parse) BEFORE touching the store — a
 *      broken manifest can't leave a half-stored key.
 *   2. Verify the PASTED token, not whatever `resolvePublishCredential` would
 *      pick: the trial deps clear the env (so an exported BUTLER_API_KEY
 *      can't shadow the paste) and overlay the candidate on a read-only view
 *      of the store (so the existing credential is untouched).
 *   3. Persist only after the platform accepted it — a failed verify leaves
 *      any previously working key exactly as it was.
 */
import type { HostCredential, TokenStore } from "../remote-auth/token-store.ts";
import { publishProviderFor } from "./registry.ts";
import { resolvePublishRequest } from "./run-publish.ts";
import { publishCredentialKey, type PublishDeps } from "./types.ts";

/** A TokenStore view that answers `key` with `candidate`, delegating the rest. */
function overlayStore(
  inner: TokenStore,
  key: string,
  candidate: HostCredential,
): TokenStore {
  const wanted = key.trim().toLowerCase();
  return {
    get: async (h) =>
      h.trim().toLowerCase() === wanted ? candidate : inner.get(h),
    // The trial store is read-only by construction — providers only read.
    set: async () => {},
    delete: async () => {},
    list: async () => [candidate],
  };
}

export interface ConnectPublishProviderOptions {
  projectDir: string;
  providerId: string;
  /** The pasted API key. NEVER log this. */
  token: string;
  /**
   * Optional account label for a NAMED credential — lets a user keep several
   * credentials for one provider (e.g. two itch.io accounts). Stored under the
   * compound `<host>#<account>` key; empty means the default (bare-host) entry.
   */
  account?: string;
  manifestPath?: string;
}

/**
 * Verify `token` with the platform, then store it. Throws a friendly,
 * token-free error when the provider needs no key, the paste is empty, or
 * the platform rejects it — leaving the store untouched in every case.
 */
export async function connectPublishProvider(
  options: ConnectPublishProviderOptions,
  deps: PublishDeps,
): Promise<{ connected: true; providerId: string }> {
  const provider = publishProviderFor(options.providerId);
  const info = provider.info;
  if (!info.credential.required) {
    throw new Error(
      `${info.label} needs no API key — just publish when you're ready.`,
    );
  }
  if (info.credential.connect === "oauth") {
    // This provider has no key to paste — it connects through a browser
    // consent flow (google-auth.ts's GoogleAuthProvider is the gdrive
    // implementation). Reject here rather than storing an unverifiable
    // pasted value under its credential host.
    throw new Error(
      `${info.label} connects through your browser, not a pasted key — run ` +
        `"gutterpress publish --provider ${info.id} --connect" or use the desktop app's Connect button.`,
    );
  }
  const token = options.token.trim();
  if (!token) throw new Error("Paste an API key first.");

  const host = info.credential.host;
  const account = (options.account ?? "").trim();
  // Named account → compound `<host>#<account>` key; no account → the legacy
  // bare-host entry (so existing single-credential setups are unchanged).
  const key = publishCredentialKey(host, account);
  const candidate: HostCredential = {
    host, // the REAL host — redacted listings filter accounts by this
    kind: "token",
    token,
    // `username` carries the account label so a picker can recover it from
    // `list()`/`listRedacted()` (which don't expose the compound store key);
    // the default (unnamed) credential has none.
    ...(account ? { username: account } : {}),
    // The account name is what a picker shows; fall back to the provider label
    // for the unnamed/default credential.
    label: account || info.label,
    createdAt: Date.now(),
  };

  const req = await resolvePublishRequest(
    {
      projectDir: options.projectDir,
      providerId: info.id,
      ...(options.manifestPath ? { manifestPath: options.manifestPath } : {}),
    },
    deps,
  );
  const trialDeps: PublishDeps = {
    ...deps,
    env: {}, // the pasted key must be the one verified — no env shadowing
    // Verify THIS account's key, overriding any manifest/selection default so
    // `authenticate` resolves the candidate under the compound key.
    credentialAccount: account || undefined,
    tokenStore: overlayStore(deps.tokenStore, key, candidate),
  };
  const auth = await provider.authenticate({ ...req, deps: trialDeps });
  if (!auth.ok) {
    throw new Error(auth.message ?? `${info.label} didn't accept that key.`);
  }

  await deps.tokenStore.set(key, candidate);
  return { connected: true, providerId: info.id };
}
