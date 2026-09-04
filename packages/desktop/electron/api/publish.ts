/**
 * Publishing IPC handlers — SFE-P5c3 (joins the credentials-sensitive group:
 * publishing needs exactly what `remote:*` needs, the lazily-loaded lib and
 * the safeStorage-backed credential store, so it shares
 * `electron/server-bridge/remote-hooks.ts`'s hooks bag rather than a
 * parallel registration — same choice `src/routes/api/publish/_hooks.ts`
 * made). Ports `src/routes/api/publish/*` `+server.ts` handlers verbatim.
 *
 * IPC has no status-code concept (see `./validation.ts`'s header) so every
 * 400/403/503 the routes threw as `error(status, message)` becomes a plain
 * `Error(message)` here with the exact same message text.
 *
 * `publishPreflight` alone takes no `hooks` — it never touched the remote
 * hooks bag; it only needs the lib (via `./lib-loader.ts`) and the
 * PWA-clean `$lib/preflight` result shaper, matching the deleted route's own
 * `defineRoute` call (no `hooks` option).
 *
 * `publishRun`'s `artifactPath` check is resolved BEFORE the
 * `handlePublishErrors`-wrapped work, not inside it — `handlePublishErrors`
 * replaces any message that doesn't match its author-facing allowlist with a
 * generic "Publishing could not be completed" text, which would otherwise
 * swallow the security-relevant "path is outside the open project" message
 * (the same ordering note the deleted route carried).
 *
 * SECURITY (D12): `publishConnect` is the one function that receives a raw
 * token and gets a connection-status object back from `lib.connectPublishProvider`
 * — the lib's own contract returns only `{connected, providerId}` (never the
 * token), and this handler forwards that result unchanged, exactly as the
 * deleted route did. This claim covers the SUCCESS response only.
 *
 * The ERROR path is a separate claim: `handlePublishErrors` (see
 * `../server-bridge/friendly-errors.ts`) redacts URL userinfo
 * (`//user:token@host/…`) from both the logged copy and the rethrown message
 * a transport failure can carry — a repair added after the original SFE-P5c3
 * "no token in response" tests were found to cover only success shapes.
 * `publish-ipc.test.ts`'s "no token in response" block pins the error-path
 * case separately; do not read the success-path cases alone as proof for both.
 */
import path from "node:path";
import { getRemoteHooks, type RemoteHooks, type TokenStore } from "../server-bridge/remote-hooks";
import { handlePublishErrors } from "../server-bridge/friendly-errors";
import { requireContainedOrPicked, requireProjectDir } from "./validation";
import { loadLib } from "./lib-loader";
import {
  shapePreflight,
  type PreflightRawResult,
  type PreflightRow,
  type PreflightSeverity,
} from "../../src/lib/preflight";
import type { SecureHandle } from "../server-bridge/secure-handle";

/** Lib provider description (mirrors the lib's PublishProviderInfo). */
export interface LibPublishProviderInfo {
  id: string;
  label: string;
  kind: "api" | "guided";
  format: "pdf" | "html";
  /** #221 phase 3, D8 — present only for a provider that supports more than
   *  one format (gdrive: ["pdf", "html"]); absent for every other provider,
   *  which keeps them fixed on `format` above. */
  formats?: Array<"pdf" | "html">;
  description: string;
  configFields: Array<{ key: string; label: string; placeholder?: string }>;
  credential: {
    required: boolean;
    host: string;
    envVar?: string;
    tokenUrl?: string;
    hint?: string;
    /** #221 — "token" (default/absent) = pasted-key connect; "oauth" = the
     *  browser consent flow (gdrive). Drives the wizard's connect UI branch. */
    connect?: "token" | "oauth";
  };
  /** #221 — present when the provider has a folder/destination picker. */
  destinations?: {
    label: string;
    canCreate: boolean;
  };
}

/** One existing destination a provider can publish into (#221, gdrive: a
 *  Drive folder). Mirrors the lib's `PublishProduct`. */
export interface LibPublishDestination {
  id: string;
  title: string;
  url?: string;
}

/** The subset of a live provider object the destinations handlers call —
 *  narrower than the lib's real `PublishProvider` (only what's needed here). */
export interface LibPublishProviderHandle {
  info: LibPublishProviderInfo;
  listDestinations?(req: unknown): Promise<LibPublishDestination[]>;
  createDestination?(req: unknown, name: string): Promise<LibPublishDestination>;
}

/** Static publish-provider metadata (no project needed) — the electron-owned
 *  twin of `$lib/publish/publish-capability.ts`'s own declaration (same
 *  double-declaration pattern `electron/api/fs.ts`'s `DirEntry`/
 *  `ProjectFileEntry` already use against `$lib/files/files-capability.ts`:
 *  `contract.ts`'s renderer-side TS program cannot reach into `electron/`,
 *  and `electron/`'s own program has no `$lib` alias, so the shape is
 *  declared once on each side instead of imported across the boundary). */
export interface PublishProviderStaticInfo {
  id: string;
  label: string;
  kind: "api" | "guided";
  credentialRequired: boolean;
  credentialHost: string | null;
  tokenUrl: string | null;
  hint: string | null;
  /** #221 — "oauth" = the browser consent flow (gdrive); null/absent = the
   *  existing paste-an-API-key flow. Drives Connections' add-a-key branch. */
  connectKind: "token" | "oauth" | null;
}

/** The dependency bag the lib's publish functions take (see the route's own). */
interface PublishRouteDeps {
  tokenStore: TokenStore;
  credentialAccount?: string;
  onProgress?: (line: string) => void;
}

interface LibPublishSavedAccount {
  account: string;
  label: string;
  createdAt: number;
}

interface PublishLibModule {
  listPublishProviders?(): LibPublishProviderInfo[];
  publishProviderFor?(id: string): LibPublishProviderHandle;
  /**
   * Resolve the `PublishRequest`-shaped object a provider's
   * `listDestinations`/`createDestination` needs — #221's destinations
   * handlers are the only current callers. `unknown` is intentional: the
   * real shape is the lib's `PublishRequest`, and these handlers only ever
   * pass it straight through to a provider method, never read its fields.
   */
  resolvePublishRequest?(
    options: { projectDir: string; providerId: string },
    deps: PublishRouteDeps,
  ): Promise<unknown>;
  /** Best-effort revoke at Google (never throws) — used by disconnect for
   *  `kind: "google-oauth"` credentials, mirroring the CLI's `--disconnect`. */
  revokeGoogleCredential?(refreshToken: string): Promise<void>;
  /** Delete a stored credential by its TokenStore key, best-effort revoking
   *  it first when its kind supports one (currently google-oauth) — the one
   *  shared implementation behind `publish:disconnect` AND
   *  `remote:disconnectHost`. Never awaits the revoke itself (delete must
   *  resolve immediately, even offline); an older lib without it falls back
   *  to a bare delete. */
  disconnectPublishCredential?(key: string, deps: Pick<PublishRouteDeps, "tokenStore">): Promise<void>;
  publishConnectionStatus?(
    info: LibPublishProviderInfo,
    deps: PublishRouteDeps,
    account?: string,
  ): Promise<{ connected: boolean; source?: "env" | "store" }>;
  listPublishAccounts?(
    info: LibPublishProviderInfo,
    deps: PublishRouteDeps,
  ): Promise<LibPublishSavedAccount[]>;
  publishCredentialKey?(host: string, account?: string): string;
  connectPublishProvider?(
    options: { projectDir: string; providerId: string; token: string; account?: string },
    deps: PublishRouteDeps,
  ): Promise<{ connected: boolean; providerId: string }>;
  readPublishSettings?(projectDir: string): Promise<Record<string, Record<string, unknown>>>;
  setPublishProviderConfig?(
    projectDir: string,
    providerId: string,
    values: Record<string, unknown>,
  ): Promise<Record<string, Record<string, unknown>>>;
  runPublish?(
    options: { projectDir: string; providerId: string; artifactPath?: string; dryRun?: boolean },
    deps: PublishRouteDeps,
  ): Promise<{ ok: boolean; providerId: string; issues: unknown[]; outcome?: unknown; error?: string }>;
}

function getHooks(): RemoteHooks<PublishLibModule, TokenStore> | null {
  return getRemoteHooks<PublishLibModule, TokenStore>();
}

function requireHooks(): RemoteHooks<PublishLibModule, TokenStore> {
  const hooks = getHooks();
  if (!hooks) throw new Error("Publish hooks not available");
  return hooks;
}

/**
 * The provider lookup + capability check + `PublishRequest` resolution the
 * two destinations handlers both do identically before making their own,
 * different, final call into the provider. `capability` names which optional
 * method the caller is about to use, purely for the "can't do that" error
 * message — the handlers still call it themselves afterward.
 */
async function resolveDestinationProvider(
  hooks: RemoteHooks<PublishLibModule, TokenStore>,
  projectDir: string,
  providerId: string,
  capability: "listDestinations" | "createDestination",
): Promise<{ provider: LibPublishProviderHandle; req: unknown }> {
  const lib = await hooks.loadLib();
  if (!lib.publishProviderFor || !lib.resolvePublishRequest) {
    throw new Error("Publishing is not available in this version of the lib");
  }
  const provider = lib.publishProviderFor(providerId);
  if (!provider[capability]) {
    const reason = capability === "listDestinations" ? "has no folder picker" : "can't create new folders";
    throw new Error(`${provider.info.label} ${reason}.`);
  }
  const req = await lib.resolvePublishRequest({ projectDir, providerId }, { tokenStore: hooks.tokenStore });
  return { provider, req };
}

/** Provider cards: static info + redacted connection status + manifest config. */
export async function publishListProviders(rawProjectDir: unknown): Promise<unknown[]> {
  const hooks = requireHooks();
  const projectDir = await requireProjectDir(rawProjectDir, "publish:list");
  return handlePublishErrors("publish:list", async () => {
    const lib = await hooks.loadLib();
    if (!lib.listPublishProviders || !lib.readPublishSettings || !lib.publishConnectionStatus) {
      throw new Error("Publishing is not available in this version of the lib");
    }
    const settings = await lib.readPublishSettings(projectDir);
    const cards = await Promise.all(
      lib.listPublishProviders().map(async (info) => {
        const raw = settings[info.id] ?? {};
        const selectedAccount = typeof raw.credential === "string" ? raw.credential.trim() : "";
        const config: Record<string, string> = {};
        for (const [k, v] of Object.entries(raw)) {
          if (k === "credential") continue;
          if (typeof v === "string" || typeof v === "number") config[k] = String(v);
        }
        const status = await lib.publishConnectionStatus!(
          info,
          { tokenStore: hooks.tokenStore, credentialAccount: selectedAccount },
          selectedAccount,
        );
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
          // #221 — "oauth" swaps the wizard's paste-a-key form for a Connect
          // button; absent/"token" is every provider's existing paste-a-key
          // behavior, unchanged.
          ...(info.credential.connect === "oauth" ? { connectKind: "oauth" as const } : {}),
          connected: status.connected,
          config,
          savedAccounts,
          selectedAccount,
          // #221 D9 — present only for providers with a folder/destination
          // picker (gdrive); the wizard renders the picker only when set.
          ...(info.destinations ? { destinations: info.destinations } : {}),
        };
      }),
    );
    return cards;
  });
}

/** Static provider metadata — id/label/credential host. No project needed. */
export async function publishProviders(): Promise<PublishProviderStaticInfo[]> {
  const hooks = requireHooks();
  return handlePublishErrors("publish:providers", async () => {
    const lib = await hooks.loadLib();
    if (!lib.listPublishProviders) {
      throw new Error("Publishing is not available in this version of the lib");
    }
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
      connectKind: info.credential.connect === "oauth" ? ("oauth" as const) : null,
    }));
  });
}

/**
 * Store + verify an API key for a provider. Response is redacted — never
 * includes the token (see this module's header).
 */
export async function publishConnect(
  rawProjectDir: unknown,
  rawProviderId: unknown,
  rawToken: unknown,
  rawAccount: unknown,
): Promise<{ connected: boolean; providerId: string }> {
  const hooks = requireHooks();
  const projectDir = await requireProjectDir(rawProjectDir, "publish:connect");
  const providerId = typeof rawProviderId === "string" ? rawProviderId : undefined;
  const token = typeof rawToken === "string" ? rawToken : undefined;
  const account = typeof rawAccount === "string" ? rawAccount : undefined;
  return handlePublishErrors("publish:connect", async () => {
    if (!providerId || typeof token !== "string" || !token.trim()) {
      throw new Error("publish:connect requires { providerId, token }");
    }
    const lib = await hooks.loadLib();
    if (!lib.connectPublishProvider) {
      throw new Error("Publishing is not available in this version of the lib");
    }
    const trimmedAccount = (account ?? "").trim();
    return lib.connectPublishProvider(
      { projectDir, providerId, token, ...(trimmedAccount ? { account: trimmedAccount } : {}) },
      { tokenStore: hooks.tokenStore },
    );
  });
}

/** Forget a stored key for a provider (the default, or a named `account`). */
export async function publishDisconnect(
  rawProviderId: unknown,
  rawAccount: unknown,
): Promise<{ ok: boolean }> {
  const hooks = requireHooks();
  return handlePublishErrors("publish:disconnect", async () => {
    if (!rawProviderId || typeof rawProviderId !== "string") {
      throw new Error("publish:disconnect requires { providerId }");
    }
    const lib = await hooks.loadLib();
    if (!lib.publishProviderFor) {
      throw new Error("Publishing is not available in this version of the lib");
    }
    const provider = lib.publishProviderFor(rawProviderId);
    const host = provider.info.credential.host;
    const account = typeof rawAccount === "string" ? rawAccount.trim() : "";
    const key = account && lib.publishCredentialKey ? lib.publishCredentialKey(host, account) : host;
    // disconnectPublishCredential (shared with remote:disconnectHost, and with
    // the CLI's --disconnect via its own awaitRevoke:true) deletes the local
    // credential FIRST (#221 C5), THEN starts a best-effort revoke at Google
    // without awaiting it when the credential's kind supports one — so
    // awaiting the call here still returns as soon as the local delete is
    // done, while the revoke (its own ~10s network timeout) keeps running in
    // the background.
    if (lib.disconnectPublishCredential) {
      await lib.disconnectPublishCredential(key, { tokenStore: hooks.tokenStore });
    } else {
      // Fallback for an older lib that predates the shared helper — same
      // read/delete/revoke shape, just inlined.
      const existing = await hooks.tokenStore.get(key);
      await hooks.tokenStore.delete(key);
      if (existing?.kind === "google-oauth" && lib.revokeGoogleCredential) {
        void lib.revokeGoogleCredential(existing.token);
      }
    }
    return { ok: true };
  });
}

/**
 * Existing places a provider can publish into (#221 D9, gdrive: app-visible
 * Drive folders) — provider-neutral by design (precedent: `publish:list`'s
 * `listProducts`), so a future Dropbox/OneDrive provider needs no new
 * channel. The wizard renders a picker only when `PublishProviderCard.destinations`
 * is present (`publish:list` threads that flag from `info.destinations`).
 */
export async function publishListDestinations(
  rawProjectDir: unknown,
  rawProviderId: unknown,
): Promise<LibPublishDestination[]> {
  const hooks = requireHooks();
  const projectDir = await requireProjectDir(rawProjectDir, "publish:destinations:list");
  const providerId = typeof rawProviderId === "string" ? rawProviderId : undefined;
  return handlePublishErrors("publish:destinations:list", async () => {
    if (!providerId) throw new Error("publish:destinations:list requires { providerId }");
    const { provider, req } = await resolveDestinationProvider(hooks, projectDir, providerId, "listDestinations");
    return provider.listDestinations!(req);
  });
}

/** Create a new destination (#221 D9, gdrive: a Drive folder at My Drive root). */
export async function publishCreateDestination(
  rawProjectDir: unknown,
  rawProviderId: unknown,
  rawName: unknown,
): Promise<LibPublishDestination> {
  const hooks = requireHooks();
  const projectDir = await requireProjectDir(rawProjectDir, "publish:destinations:create");
  const providerId = typeof rawProviderId === "string" ? rawProviderId : undefined;
  const name = typeof rawName === "string" ? rawName.trim() : "";
  return handlePublishErrors("publish:destinations:create", async () => {
    if (!providerId || !name) throw new Error("publish:destinations:create requires { providerId, name }");
    const { provider, req } = await resolveDestinationProvider(hooks, projectDir, providerId, "createDestination");
    return provider.createDestination!(req, name);
  });
}

/** Write NON-SECRET provider settings into the manifest's publish section. */
export async function publishSetConfig(
  rawProjectDir: unknown,
  rawProviderId: unknown,
  rawValues: unknown,
): Promise<Record<string, Record<string, unknown>>> {
  const hooks = requireHooks();
  const projectDir = await requireProjectDir(rawProjectDir, "publish:setConfig");
  const providerId = typeof rawProviderId === "string" ? rawProviderId : undefined;
  const values = rawValues && typeof rawValues === "object" ? (rawValues as Record<string, unknown>) : undefined;
  return handlePublishErrors("publish:setConfig", async () => {
    if (!providerId || !values) {
      throw new Error("publish:setConfig requires { providerId, values }");
    }
    const lib = await hooks.loadLib();
    if (!lib.setPublishProviderConfig || !lib.publishProviderFor) {
      throw new Error("Publishing is not available in this version of the lib");
    }
    const provider = lib.publishProviderFor(providerId);
    const cleanValues: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) {
      if (v === null || typeof v === "string" || typeof v === "number") cleanValues[k] = v;
    }
    return lib.setPublishProviderConfig(projectDir, provider.info.id, cleanValues);
  });
}

/**
 * Pre-build publish preflight (#105): run the SOURCE + ASSET checks (no PDF
 * build) for a project. No `hooks` bag needed — see this module's header.
 */
export async function publishPreflight(rawProjectDir: unknown, _rawProviderIds: unknown): Promise<PreflightRow[]> {
  const projectDir = await requireProjectDir(rawProjectDir, "publish:preflight");

  const lib = await loadLib();
  const execution = await lib.executeValidation({
    input: projectDir,
    category: "source,asset",
    phase: "pre-build",
  });

  const dirPrefix = projectDir.replace(/[\\/]+$/, "") + path.sep;
  const raws: PreflightRawResult[] = execution.report.results.map((res) => {
    const abs = res.file ? path.resolve(res.file) : undefined;
    const rel =
      abs && abs.startsWith(dirPrefix)
        ? abs.slice(dirPrefix.length).split(path.sep).join("/")
        : abs
          ? path.basename(abs)
          : undefined;
    return {
      checkId: res.checkId,
      category: res.checkId.split(".")[0] ?? "source",
      severity: res.severity as PreflightSeverity,
      message: res.message,
      filePath: abs,
      file: rel,
      line: res.line,
      column: res.column,
    };
  });

  // Provider-awareness (#105): the renderer still sends `providerIds`, but no
  // provider-scoped check category exists yet, so nothing reads it.
  return shapePreflight(raws);
}

/**
 * Run a publish (or a --dry-run preflight). Returns the lib's structured
 * result plus the progress lines captured during the run.
 */
export async function publishRun(
  rawProjectDir: unknown,
  rawProviderId: unknown,
  rawArtifactPath: unknown,
  rawDryRun: unknown,
): Promise<unknown> {
  const hooks = requireHooks();
  const projectDir = await requireProjectDir(rawProjectDir, "publish:run");
  const providerId = typeof rawProviderId === "string" ? rawProviderId : undefined;
  // Resolved and scoped BEFORE the handlePublishErrors wrap — see this
  // module's header.
  const artifactPath =
    typeof rawArtifactPath === "string" && rawArtifactPath
      ? await requireContainedOrPicked(path.resolve(projectDir, rawArtifactPath), "publish:run")
      : undefined;
  const dryRun = Boolean(rawDryRun);
  return handlePublishErrors("publish:run", async () => {
    if (!providerId) throw new Error("publish:run requires { providerId }");
    const lib = await hooks.loadLib();
    if (!lib.runPublish) {
      throw new Error("Publishing is not available in this version of the lib");
    }
    const log: string[] = [];
    const result = await lib.runPublish(
      {
        projectDir,
        providerId,
        ...(artifactPath ? { artifactPath } : {}),
        ...(dryRun ? { dryRun: true } : {}),
      },
      {
        tokenStore: hooks.tokenStore,
        onProgress: (line: string) => {
          log.push(line);
          if (log.length > 500) log.shift();
        },
      },
    );
    return { ...result, log };
  });
}

/** Register the publish:* IPC channels (SFE-P6b). */
export function registerPublishHandlers(secureHandle: SecureHandle): void {
  secureHandle("publish:list", (_e, projectDir: unknown) => publishListProviders(projectDir));
  secureHandle("publish:providers", () => publishProviders());
  secureHandle(
    "publish:connect",
    (_e, projectDir: unknown, providerId: unknown, token: unknown, account?: unknown) =>
      publishConnect(projectDir, providerId, token, account),
  );
  secureHandle("publish:disconnect", (_e, providerId: unknown, account?: unknown) =>
    publishDisconnect(providerId, account),
  );
  secureHandle(
    "publish:setConfig",
    (_e, projectDir: unknown, providerId: unknown, values: unknown) =>
      publishSetConfig(projectDir, providerId, values),
  );
  secureHandle("publish:preflight", (_e, projectDir: unknown, providerIds: unknown) =>
    publishPreflight(projectDir, providerIds),
  );
  secureHandle(
    "publish:run",
    (_e, projectDir: unknown, providerId: unknown, artifactPath?: unknown, dryRun?: unknown) =>
      publishRun(projectDir, providerId, artifactPath, dryRun),
  );
  secureHandle("publish:listDestinations", (_e, projectDir: unknown, providerId: unknown) =>
    publishListDestinations(projectDir, providerId),
  );
  secureHandle("publish:createDestination", (_e, projectDir: unknown, providerId: unknown, name: unknown) =>
    publishCreateDestination(projectDir, providerId, name),
  );
}
