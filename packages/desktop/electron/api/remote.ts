/**
 * Remote/GitHub/sync IPC handlers — SFE-P5c3, the credentials-sensitive
 * group. Ports `src/routes/api/remote/*`/`src/routes/api/sync/*`
 * `+server.ts` handlers verbatim: same validation, same `handleRemoteErrors`
 * wrapping, same hooks bag (`electron/server-bridge/remote-hooks.ts` /
 * `sync-settings-hooks.ts` — UNCHANGED; `electron/main.ts`'s
 * `remoteHooksImpl`/`syncSettingsHooksImpl` closures, including the
 * `cloneRepository` closure that needs live `mainWindow`/`safeSend` access
 * for its clone-progress push, are reused as-is through `getRemoteHooks()`/
 * `getSyncSettingsHooks()`).
 *
 * IPC has no status-code concept (see `./validation.ts`'s header) so every
 * 400/403/503 the routes threw as `error(status, message)` becomes a plain
 * `Error(message)` here with the EXACT same message text — that text is what
 * every real caller (the capability module, `friendlyHostError`-scrubbed) reads.
 *
 * SECURITY (D12): token values never cross into the renderer.
 *  - `remoteGetConnection`/`remoteListConnections` return only what
 *    `TokenStore.status()`/`listRedacted()` themselves produce — already
 *    redacted by that interface's own contract, unchanged here.
 *  - `remoteConnectGenericHost` is the one function that RECEIVES a raw
 *    token and gets one back from `lib.connectGenericHost` (which echoes the
 *    validated credential, including `token`, so the caller can store it) —
 *    this handler explicitly builds a NEW object with only `connected`/
 *    `host`/`username`, exactly as the deleted route did, so the credential
 *    object (and its `token` field) never reaches the return value.
 *  - `remoteSync`/`remoteCloneRepository` pass the `TokenStore` object BY
 *    REFERENCE into the lib, never a raw token string; their results are the
 *    lib's own sync/clone outcome shapes, which carry no credential material.
 */
import { getRemoteHooks, type RemoteHooks, type LibModule as RemoteLibModule, type TokenStore } from "../server-bridge/remote-hooks";
import { getSyncSettingsHooks, type SyncSettingsHooks } from "../server-bridge/sync-settings-hooks";
import { handleRemoteErrors } from "../server-bridge/friendly-errors";
import { gitIdentityArgs } from "./git-identity-args";
import { requireAbsolute, requireProjectDir } from "./validation";
import type { CloneRepositoryArgs } from "../bridge-types";

function getHooks(): RemoteHooks<RemoteLibModule, TokenStore> | null {
  return getRemoteHooks<RemoteLibModule, TokenStore>();
}

function requireHooks(): RemoteHooks<RemoteLibModule, TokenStore> {
  const hooks = getHooks();
  if (!hooks) throw new Error("Remote hooks not available");
  return hooks;
}

function requireSyncHooks(): SyncSettingsHooks {
  const hooks = getSyncSettingsHooks();
  if (!hooks) throw new Error("Sync settings hooks not registered");
  return hooks;
}

// ── Managed GitHub integration (#15, ADR 0006) ──────────────────────────────
// connectGitHubStart/Wait/Cancel and the cloneProgress push stay exactly as
// they are (electron/main.ts's own secureHandle registrations) — untouched
// by this run (rule 8: push streams stay IPC as they are).

/** Forget the stored GitHub connection. */
export async function remoteDisconnectGitHub(): Promise<{ ok: boolean }> {
  const hooks = requireHooks();
  return handleRemoteErrors("remote:disconnectGitHub", async () => {
    await hooks.tokenStore.delete(hooks.GITHUB_HOST);
    return { ok: true };
  });
}

/**
 * Redacted connection status for a host (default github.com). NEVER returns
 * the token — only what `TokenStore.status()` itself returns.
 */
export async function remoteGetConnection(
  rawHost: unknown,
): Promise<{ connected: boolean; username?: string; label?: string }> {
  const hooks = requireHooks();
  const host = typeof rawHost === "string" && rawHost ? rawHost : hooks.GITHUB_HOST;
  return hooks.tokenStore.status(host);
}

/** Repositories the user granted the Gutterpress GitHub App. */
export async function remoteListRepositories(): Promise<unknown[]> {
  const hooks = requireHooks();
  return handleRemoteErrors("remote:listRepositories", async () => {
    const credential = await hooks.tokenStore.get(hooks.GITHUB_HOST);
    if (!credential) {
      throw new Error("Connect GitHub first to see your repositories.");
    }
    const lib = await hooks.loadLib();
    if (!lib.listGitHubRepositories) {
      throw new Error("listGitHubRepositories not available in this version of the lib");
    }
    return lib.listGitHubRepositories(credential);
  });
}

/** Branches of a chosen repository. */
export async function remoteListBranches(rawOwner: unknown, rawRepo: unknown): Promise<unknown[]> {
  const hooks = requireHooks();
  return handleRemoteErrors("remote:listBranches", async () => {
    if (
      typeof rawOwner !== "string" ||
      typeof rawRepo !== "string" ||
      !rawOwner ||
      !rawRepo
    ) {
      throw new Error("remote:listBranches requires owner and repo");
    }
    const credential = await hooks.tokenStore.get(hooks.GITHUB_HOST);
    if (!credential) {
      throw new Error("Connect GitHub first to see your repositories.");
    }
    const lib = await hooks.loadLib();
    if (!lib.listGitHubBranches) {
      throw new Error("listGitHubBranches not available in this version of the lib");
    }
    return lib.listGitHubBranches(credential, rawOwner, rawRepo);
  });
}

/** Book folders (manifest.yaml/.yml) inside a repository branch. */
export async function remoteListRepoBooks(
  rawOwner: unknown,
  rawRepo: unknown,
  rawBranch: unknown,
): Promise<unknown[]> {
  const hooks = requireHooks();
  return handleRemoteErrors("remote:listRepoBooks", async () => {
    if (
      typeof rawOwner !== "string" ||
      typeof rawRepo !== "string" ||
      typeof rawBranch !== "string" ||
      !rawOwner ||
      !rawRepo ||
      !rawBranch
    ) {
      throw new Error("remote:listRepoBooks requires owner, repo and branch");
    }
    const credential = await hooks.tokenStore.get(hooks.GITHUB_HOST);
    if (!credential) {
      throw new Error("Connect GitHub first to see your repositories.");
    }
    const lib = await hooks.loadLib();
    if (!lib.listRepoBooks) {
      throw new Error("listRepoBooks not available in this version of the lib");
    }
    return lib.listRepoBooks(credential, rawOwner, rawRepo, rawBranch);
  });
}

// ── Advanced Setup (#14, ADR 0006 D3/D7) ────────────────────────────────────

/** Classify the project's remote situation for the environment panel. */
export async function remoteDiagnoseProject(rawProjectDir: unknown): Promise<unknown> {
  const hooks = requireHooks();
  const projectDir = await requireProjectDir(rawProjectDir, "remote:diagnoseProject");
  return handleRemoteErrors("remote:diagnoseProject", async () => {
    const lib = await hooks.loadLib();
    if (!lib.diagnoseProjectRemote) {
      throw new Error("diagnoseProjectRemote not available in this version of the lib");
    }
    return lib.diagnoseProjectRemote(projectDir, { tokenStore: hooks.tokenStore });
  });
}

/** Explicit, user-initiated remote probe (the git ls-remote equivalent). */
export async function remoteTestRemoteAccess(rawUrl: unknown): Promise<unknown> {
  const hooks = requireHooks();
  return handleRemoteErrors("remote:testRemoteAccess", async () => {
    if (typeof rawUrl !== "string" || !rawUrl.trim()) {
      throw new Error("remote:testRemoteAccess requires a remote URL");
    }
    const lib = await hooks.loadLib();
    if (!lib.testRemoteAccess) {
      throw new Error("testRemoteAccess not available in this version of the lib");
    }
    // Use the stored credential for the remote's host, when one exists.
    // Credentials are keyed hostname[:port]; a self-hosted forge on a port
    // still resolves. SSH/scp-like URLs don't parse — lib classifies without auth.
    let credential: unknown = null;
    try {
      const u = new URL(rawUrl);
      const host = u.port ? `${u.hostname}:${u.port}` : u.hostname;
      credential = await hooks.tokenStore.get(host);
    } catch {
      // SSH/scp-like URL → skip credential lookup
    }
    return lib.testRemoteAccess({
      url: rawUrl,
      ...(credential ? { credential } : {}),
    });
  });
}

/**
 * Validate + store a credential for any smart-HTTPS Git host. Response is
 * redacted — never includes the token (see this module's header).
 */
export async function remoteConnectGenericHost(
  rawArgs: unknown,
): Promise<{ connected: boolean; host: string; username?: string }> {
  const hooks = requireHooks();
  return handleRemoteErrors("remote:connectGenericHost", async () => {
    const body = rawArgs as
      | { host?: unknown; username?: unknown; token?: unknown; repoUrl?: unknown }
      | undefined;
    if (
      !body ||
      typeof body.host !== "string" ||
      typeof body.token !== "string" ||
      !body.host.trim() ||
      !body.token.trim()
    ) {
      throw new Error("remote:connectGenericHost requires { host, token }");
    }
    const lib = await hooks.loadLib();
    if (!lib.connectGenericHost) {
      throw new Error("connectGenericHost not available in this version of the lib");
    }
    // Validates with a refs probe BEFORE returning — a bad paste never
    // reaches the credential store.
    const credential = await lib.connectGenericHost({
      host: body.host,
      ...(typeof body.username === "string" && body.username ? { username: body.username } : {}),
      token: body.token,
      ...(typeof body.repoUrl === "string" && body.repoUrl ? { repoUrl: body.repoUrl } : {}),
    });
    await hooks.tokenStore.set(credential.host, credential);
    // Response must NOT include the token — only redacted status.
    return {
      connected: true,
      host: credential.host,
      ...(credential.username ? { username: credential.username } : {}),
    };
  });
}

/** Forget the stored connection for a host. */
export async function remoteDisconnectHost(rawHost: unknown): Promise<{ ok: boolean }> {
  const hooks = requireHooks();
  return handleRemoteErrors("remote:disconnectHost", async () => {
    if (typeof rawHost !== "string" || !rawHost.trim()) {
      throw new Error("remote:disconnectHost requires a host");
    }
    await hooks.tokenStore.delete(rawHost);
    return { ok: true };
  });
}

/** Redacted list of stored connections (host/username/label — no tokens). */
export async function remoteListConnections(): Promise<unknown[]> {
  const hooks = requireHooks();
  return hooks.tokenStore.listRedacted();
}

/** Token-settings deep link for recognized forges; null when unknown. */
export async function remoteForgeTokenUrl(rawHost: unknown): Promise<string | null> {
  const hooks = requireHooks();
  if (typeof rawHost !== "string" || !rawHost.trim()) return null;
  const lib = await hooks.loadLib();
  if (!lib.knownForgeTokenUrl) return null;
  return lib.knownForgeTokenUrl(rawHost);
}

// ── Sync (#15 sync phase, ADR 0006 D5) ──────────────────────────────────────

/** Snapshot-first sync of the project to its online repository. */
export async function remoteSync(rawProjectDir: unknown, rawMessage: unknown): Promise<unknown> {
  const hooks = requireHooks();
  const projectDir = await requireProjectDir(rawProjectDir, "remote:sync");
  return handleRemoteErrors("remote:sync", async () => {
    const lib = await hooks.loadLib();
    if (!lib.syncProject) {
      throw new Error("syncProject not available in this version of the lib");
    }
    return lib.syncProject({
      projectDir,
      tokenStore: hooks.tokenStore,
      ...(await gitIdentityArgs()),
      ...(typeof rawMessage === "string" && rawMessage.trim() ? { message: rawMessage.trim() } : {}),
    });
  });
}

/**
 * Download ("clone") a repository into a new local project folder.
 * `hooks.cloneRepository` (electron/main.ts's `remoteHooksImpl`) does the
 * full original operation — folder-name sanitization, credential lookup,
 * and the `remote:cloneProgress` push — unchanged by this run.
 */
export async function remoteCloneRepository(rawArgs: unknown): Promise<{ projectDir: string }> {
  const hooks = requireHooks();
  const body = rawArgs as Partial<CloneRepositoryArgs> | undefined;
  if (!body || typeof body.url !== "string" || !body.url) {
    throw new Error("remote:cloneRepository requires { url, parentDir, folderName }");
  }
  const parentDir = requireAbsolute(body.parentDir, "remote:cloneRepository");
  const validated: CloneRepositoryArgs = {
    ...body,
    url: body.url,
    parentDir,
    folderName: body.folderName ?? "",
  } as CloneRepositoryArgs;
  return handleRemoteErrors("remote:cloneRepository", () => hooks.cloneRepository(validated));
}

// ── Auto-sync settings (transparent-sync plan §4.3) — restored to IPC ──────

/** Enable or disable the auto-sync master switch. */
export async function syncSetAutoSync(rawEnabled: unknown): Promise<{ ok: boolean; autoSync: boolean }> {
  const hooks = requireSyncHooks();
  if (typeof rawEnabled !== "boolean") {
    throw new Error("sync:setAutoSync requires a boolean");
  }
  return hooks.setAutoSync(rawEnabled);
}

/**
 * The last sync status the host emitted for a project, or null. The
 * queryable counterpart to the fire-and-forget `sync:status` push channel.
 */
export async function syncGetStatus(rawProjectDir: unknown): Promise<object | null> {
  const hooks = requireSyncHooks();
  if (typeof rawProjectDir !== "string" || !rawProjectDir) {
    throw new Error("sync:status requires a projectDir");
  }
  return hooks.getStatus(rawProjectDir);
}
