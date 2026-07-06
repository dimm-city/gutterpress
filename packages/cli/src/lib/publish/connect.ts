/**
 * Shared connect flow (#35) — one implementation for both front-ends (the CLI
 * `--connect` flag and the viewer's publish:connect route), with the ordering
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
import type { PublishDeps } from "./types.ts";

/** A TokenStore view that answers `host` with `candidate`, delegating the rest. */
function overlayStore(
  inner: TokenStore,
  host: string,
  candidate: HostCredential,
): TokenStore {
  return {
    get: async (h) =>
      h.trim().toLowerCase() === host ? candidate : inner.get(h),
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
  const token = options.token.trim();
  if (!token) throw new Error("Paste an API key first.");

  const host = info.credential.host;
  const candidate: HostCredential = {
    host,
    kind: "token",
    token,
    label: info.label,
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
    tokenStore: overlayStore(deps.tokenStore, host, candidate),
  };
  const auth = await provider.authenticate({ ...req, deps: trialDeps });
  if (!auth.ok) {
    throw new Error(auth.message ?? `${info.label} didn't accept that key.`);
  }

  await deps.tokenStore.set(host, candidate);
  return { connected: true, providerId: info.id };
}
