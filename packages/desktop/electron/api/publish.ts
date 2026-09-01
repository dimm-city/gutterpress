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
  description: string;
  configFields: Array<{ key: string; label: string; placeholder?: string }>;
  credential: {
    required: boolean;
    host: string;
    envVar?: string;
    tokenUrl?: string;
    hint?: string;
  };
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
  publishProviderFor?(id: string): { info: LibPublishProviderInfo };
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
          description: info.description,
          fields: info.configFields,
          credentialRequired: info.credential.required,
          ...(info.credential.tokenUrl ? { tokenUrl: info.credential.tokenUrl } : {}),
          ...(info.credential.hint ? { hint: info.credential.hint } : {}),
          connected: status.connected,
          config,
          savedAccounts,
          selectedAccount,
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
    await hooks.tokenStore.delete(key);
    return { ok: true };
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
 * build) for a project, scoped to the selected destinations. No `hooks` bag
 * needed — see this module's header.
 */
export async function publishPreflight(rawProjectDir: unknown, rawProviderIds: unknown): Promise<PreflightRow[]> {
  const projectDir = await requireProjectDir(rawProjectDir, "publish:preflight");
  const providerIds = Array.isArray(rawProviderIds)
    ? rawProviderIds.filter((x): x is string => typeof x === "string")
    : [];

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

  // Provider-awareness (#105): no provider-scoped registry checks exist yet
  // (see the deleted route's own note) — this loop is intentionally a no-op,
  // kept so a future `provider.<id>.*` check category slots in without
  // reshaping this function.
  for (const _providerId of providerIds) {
    void _providerId;
  }

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
}
