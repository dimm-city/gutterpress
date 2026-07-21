<script lang="ts">
  /**
   * Settings → Connections — the ONE central place to see and manage every
   * stored credential: the GitHub account (writing sync), other Git servers
   * (Gitea/GitLab/Bitbucket/Azure Repos tokens), and publishing accounts
   * (itch.io, Azure Static Web Apps, Shopify keys — incl. named accounts).
   *
   * Everything here reads REDACTED entries only (host/username/label —
   * never token values). Removal deletes by the entry's RAW store key via
   * remote:disconnectHost, which works uniformly for bare-host git entries
   * AND compound `<host>#<account>` publish keys. Entries whose ciphertext no
   * longer decrypts (OS keyring changed — HostConnectionInfo.unreadable) are
   * badged "Needs reconnecting" instead of silently looking healthy.
   *
   * Adding: GitHub uses the same device flow the Open-from-GitHub dialog
   * runs (code shown inline; browser opened); Git servers use the
   * verify-before-store token flow; publishing keys verify against the
   * provider, which for some providers needs the open project's manifest —
   * so that form asks for an open project when none is.
   *
   * PWA-clean (§8): api.* routes + getPlatform() only.
   */
  import { onMount } from "svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { api, type PublishProviderStaticInfo } from "$lib/api";
  import { getPlatform, isDesktop } from "$lib/platform";
  import { friendlyHostError } from "$lib/errors";
  import type { HostConnectionInfo, RemoteConnection, DeviceCodeInfo } from "$lib/platform/contract";
  import { requestInlineConfirm, cancelInlineConfirm, type InlineConfirmState } from "$lib/dialog";

  let { projectDir = null as string | null }: { projectDir?: string | null } = $props();

  let loading = $state(true);
  let loadError = $state<string | null>(null);
  let github = $state<RemoteConnection | null>(null);
  let entries = $state<HostConnectionInfo[]>([]);
  let providers = $state<PublishProviderStaticInfo[]>([]);

  // GitHub device flow (same flow GitHubDialog runs, inline).
  let ghBusy = $state(false);
  let ghCode = $state<DeviceCodeInfo | null>(null);
  let ghError = $state<string | null>(null);

  // Add-a-Git-server form (verify-before-store).
  let serverInput = $state("");
  let serverUser = $state("");
  let serverToken = $state("");
  let serverBusy = $state(false);
  let serverError = $state<string | null>(null);
  let serverNotice = $state<string | null>(null);

  // Add-a-publishing-key form.
  let pubProviderId = $state("");
  let pubToken = $state("");
  let pubAccount = $state("");
  let pubBusy = $state(false);
  let pubError = $state<string | null>(null);
  let pubNotice = $state<string | null>(null);

  // Two-step Remove confirm (same pattern as AdvancedSetupDialog's Disconnect).
  let confirmRemove = $state<InlineConfirmState>({});
  let removing = $state<string | null>(null);
  let removeError = $state<string | null>(null);

  onMount(() => {
    void load();
    return () => {
      // A device flow left mid-poll must not keep polling after the tab closes.
      if (ghBusy) getPlatform().connectGitHubCancel().catch(() => {});
    };
  });

  async function load() {
    if (!isDesktop()) {
      loading = false;
      return;
    }
    loading = true;
    loadError = null;
    try {
      const [conn, list, provs] = await Promise.all([
        api.remote.getRemoteConnection().catch(() => null),
        api.remote.listHostConnections().catch(() => [] as HostConnectionInfo[]),
        api.publish.providers().catch(() => [] as PublishProviderStaticInfo[]),
      ]);
      github = conn;
      entries = list as HostConnectionInfo[];
      providers = provs;
      if (!pubProviderId) {
        pubProviderId = providers.find((p) => p.credentialRequired)?.id ?? "";
      }
    } catch (e) {
      loadError = friendlyHostError(e instanceof Error ? e.message : String(e));
    } finally {
      loading = false;
    }
  }

  // ── Classification: publishing accounts vs Git servers ─────────────────────
  const publishHosts = $derived(
    new Set(providers.map((p) => p.credentialHost).filter((h): h is string => !!h)),
  );
  function baseHost(key: string): string {
    return key.split("#")[0] ?? key;
  }
  function isPublishEntry(e: HostConnectionInfo): boolean {
    return e.host.includes("#") || publishHosts.has(baseHost(e.host));
  }
  const gitServers = $derived(
    entries.filter((e) => !isPublishEntry(e) && baseHost(e.host) !== "github.com"),
  );
  const publishEntries = $derived(entries.filter((e) => isPublishEntry(e)));
  function providerLabelFor(e: HostConnectionInfo): string {
    return providers.find((p) => p.credentialHost === baseHost(e.host))?.label ?? baseHost(e.host);
  }
  function accountLabelFor(e: HostConnectionInfo): string {
    const idx = e.host.indexOf("#");
    return idx > -1 ? e.host.slice(idx + 1) : "default";
  }

  // ── GitHub device flow ──────────────────────────────────────────────────────
  async function connectGitHub() {
    if (ghBusy) return;
    ghBusy = true;
    ghError = null;
    try {
      const info = await getPlatform().connectGitHubStart();
      ghCode = info;
      api.shell.openExternal(info.verificationUri).catch(() => {});
      await getPlatform().connectGitHubWait();
      ghCode = null;
      await load();
    } catch (e) {
      ghError = friendlyHostError(e instanceof Error ? e.message : String(e));
      ghCode = null;
    } finally {
      ghBusy = false;
    }
  }

  async function disconnectGitHub() {
    try {
      await api.remote.disconnectGitHub();
      await load();
    } catch (e) {
      removeError = friendlyHostError(e instanceof Error ? e.message : String(e));
    }
  }

  // ── Git server connect (verify-before-store) ────────────────────────────────
  async function connectServer() {
    if (serverBusy) return;
    serverBusy = true;
    serverError = null;
    serverNotice = null;
    try {
      const result = await api.remote.connectGenericHost({
        host: serverInput,
        ...(serverUser.trim() ? { username: serverUser.trim() } : {}),
        token: serverToken,
      });
      serverToken = ""; // the token has done its job — never keep it in state
      serverInput = "";
      serverUser = "";
      serverNotice = `Connected to ${result.host}.`;
      await load();
    } catch (e) {
      serverError = friendlyHostError(e instanceof Error ? e.message : String(e));
    } finally {
      serverBusy = false;
    }
  }

  // ── Publishing key connect (verify-before-store; needs an open project) ─────
  async function connectPublish() {
    if (pubBusy || !projectDir || !pubProviderId) return;
    pubBusy = true;
    pubError = null;
    pubNotice = null;
    try {
      await api.publish.connect(projectDir, pubProviderId, pubToken, pubAccount.trim() || undefined);
      pubToken = "";
      pubAccount = "";
      const label = providers.find((p) => p.id === pubProviderId)?.label ?? pubProviderId;
      pubNotice = `Connected ${label}.`;
      await load();
    } catch (e) {
      pubError = friendlyHostError(e instanceof Error ? e.message : String(e));
    } finally {
      pubBusy = false;
    }
  }

  // ── Removal (raw store key — works for bare-host AND compound keys) ─────────
  function requestRemove(key: string) {
    const { state, confirmed } = requestInlineConfirm(confirmRemove, key);
    confirmRemove = state;
    if (confirmed) void remove(key);
  }
  function cancelRemove(key: string) {
    confirmRemove = cancelInlineConfirm(confirmRemove, key);
  }
  async function remove(key: string) {
    if (removing) return;
    removing = key;
    removeError = null;
    try {
      await api.remote.disconnectHost(key);
      entries = entries.filter((c) => c.host !== key);
    } catch (e) {
      removeError = friendlyHostError(e instanceof Error ? e.message : String(e));
    } finally {
      removing = null;
    }
  }

  const selectedProvider = $derived(providers.find((p) => p.id === pubProviderId) ?? null);
</script>

<div class="connections">
  {#if !isDesktop()}
    <p class="hint">Connections are managed in the desktop app.</p>
  {:else if loading}
    <p class="hint">Loading your connections…</p>
  {:else}
    {#if loadError}<p class="error" role="alert">{loadError}</p>{/if}

    <!-- GitHub (writing sync) -->
    <section class="conn-group">
      <h4>GitHub</h4>
      <p class="hint">Keeps your books synced with repositories on GitHub.</p>
      {#if github?.connected}
        <div class="conn-row">
          <span class="conn-name"><Icon name="github" size={14} />{github.username ? `Connected as @${github.username}` : "Connected"}</span>
          {#if confirmRemove["github.com"]}
            <span class="confirm-pair">
              <button class="danger" onclick={disconnectGitHub}>Really disconnect?</button>
              <button class="ghost" onclick={() => cancelRemove("github.com")}>Keep</button>
            </span>
          {:else}
            <!-- Arms the two-step confirm; the armed branch routes through the
                 dedicated disconnectGitHub flow, not the raw-key delete. -->
            <button class="ghost" onclick={() => requestRemove("github.com")} disabled={!!removing}>Disconnect</button>
          {/if}
        </div>
      {:else}
        <div class="conn-row">
          <span class="conn-name muted">Not connected</span>
          <button class="ghost" onclick={connectGitHub} disabled={ghBusy}>
            {ghBusy ? "Waiting for GitHub…" : "Connect GitHub…"}
          </button>
        </div>
        {#if ghCode}
          <p class="hint code-hint">
            Enter this code on the GitHub page that opened:
            <strong class="user-code">{ghCode.userCode}</strong>
          </p>
        {/if}
        {#if ghError}<p class="error" role="alert">{ghError}</p>{/if}
      {/if}
    </section>

    <!-- Other Git servers -->
    <section class="conn-group">
      <h4>Git servers</h4>
      <p class="hint">Access tokens for Gitea, Forgejo, GitLab, Bitbucket, Azure Repos, and other servers your books sync with.</p>
      {#each gitServers as entry (entry.host)}
        <div class="conn-row">
          <span class="conn-name">
            {entry.label ?? entry.host}
            {#if entry.unreadable}<span class="badge warn">Needs reconnecting</span>{/if}
          </span>
          {#if confirmRemove[entry.host]}
            <span class="confirm-pair">
              <button class="danger" onclick={() => remove(entry.host)}>Really remove?</button>
              <button class="ghost" onclick={() => cancelRemove(entry.host)}>Keep</button>
            </span>
          {:else}
            <button class="ghost" onclick={() => requestRemove(entry.host)} disabled={!!removing}>Remove</button>
          {/if}
        </div>
      {:else}
        <p class="hint muted">No Git servers connected yet.</p>
      {/each}
      <div class="add-form">
        <input type="text" placeholder="Server (e.g. git.example.com)" value={serverInput} oninput={(e) => (serverInput = (e.currentTarget as HTMLInputElement).value)} />
        <input type="text" placeholder="Username (optional)" value={serverUser} oninput={(e) => (serverUser = (e.currentTarget as HTMLInputElement).value)} />
        <input type="password" placeholder="Access token" value={serverToken} oninput={(e) => (serverToken = (e.currentTarget as HTMLInputElement).value)} />
        <button class="ghost" onclick={connectServer} disabled={serverBusy || !serverInput.trim() || !serverToken.trim()}>
          {serverBusy ? "Checking…" : "Connect"}
        </button>
      </div>
      {#if serverNotice}<p class="notice">{serverNotice}</p>{/if}
      {#if serverError}<p class="error" role="alert">{serverError}</p>{/if}
    </section>

    <!-- Publishing accounts -->
    <section class="conn-group">
      <h4>Publishing accounts</h4>
      <p class="hint">API keys used to publish your books (itch.io, Azure Static Web Apps, Shopify…). Keys are stored once and available to every project.</p>
      {#each publishEntries as entry (entry.host)}
        <div class="conn-row">
          <span class="conn-name">
            {providerLabelFor(entry)}
            <span class="badge">{accountLabelFor(entry)}</span>
            {#if entry.unreadable}<span class="badge warn">Needs reconnecting</span>{/if}
          </span>
          {#if confirmRemove[entry.host]}
            <span class="confirm-pair">
              <button class="danger" onclick={() => remove(entry.host)}>Really remove?</button>
              <button class="ghost" onclick={() => cancelRemove(entry.host)}>Keep</button>
            </span>
          {:else}
            <button class="ghost" onclick={() => requestRemove(entry.host)} disabled={!!removing}>Remove</button>
          {/if}
        </div>
      {:else}
        <p class="hint muted">No publishing accounts yet.</p>
      {/each}
      <div class="add-form">
        <select value={pubProviderId} onchange={(e) => (pubProviderId = (e.currentTarget as HTMLSelectElement).value)}>
          {#each providers.filter((p) => p.credentialRequired) as p (p.id)}
            <option value={p.id}>{p.label}</option>
          {/each}
        </select>
        <input type="password" placeholder="API key" value={pubToken} oninput={(e) => (pubToken = (e.currentTarget as HTMLInputElement).value)} />
        <input type="text" placeholder="Account label (optional)" value={pubAccount} oninput={(e) => (pubAccount = (e.currentTarget as HTMLInputElement).value)} />
        <button class="ghost" onclick={connectPublish} disabled={pubBusy || !projectDir || !pubProviderId || !pubToken.trim()}>
          {pubBusy ? "Checking…" : "Add"}
        </button>
      </div>
      {#if !projectDir}
        <p class="hint muted">Open a project to add a publishing key — the key is checked with the platform first, and some checks read the project's settings. Saved keys work across all projects.</p>
      {/if}
      {#if selectedProvider?.tokenUrl}
        <p class="hint">Create a key at: <button class="inline-link" onclick={() => selectedProvider?.tokenUrl && api.shell.openExternal(selectedProvider.tokenUrl).catch(() => {})}>{selectedProvider.tokenUrl}</button></p>
      {/if}
      {#if pubNotice}<p class="notice">{pubNotice}</p>{/if}
      {#if pubError}<p class="error" role="alert">{pubError}</p>{/if}
    </section>

    {#if removeError}<p class="error" role="alert">{removeError}</p>{/if}
  {/if}
</div>

<style>
  .connections { display: flex; flex-direction: column; gap: 18px; }
  .conn-group h4 {
    margin: 0 0 2px;
    font-size: 10.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--app-text-muted);
    border-bottom: 1px solid var(--app-border-subtle);
    padding-bottom: 6px;
  }
  .hint { font-size: 11px; line-height: 1.4; color: var(--app-text-muted); margin: 4px 0 8px; }
  .hint.muted { font-style: italic; }
  .notice { font-size: 12px; color: var(--app-success-text); margin: 6px 0 0; }
  .error { font-size: 12px; color: var(--app-error-text); margin: 6px 0 0; }
  .conn-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 6px 0;
    font-size: 13px;
  }
  .conn-name { display: inline-flex; align-items: center; gap: 7px; color: var(--app-text-secondary); min-width: 0; }
  .conn-name.muted { color: var(--app-text-muted); }
  .badge {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 8px;
    border: 1px solid var(--app-border);
    color: var(--app-text-muted);
  }
  .badge.warn { color: var(--app-warning-text); border-color: var(--app-warning-text); }
  .confirm-pair { display: inline-flex; gap: 6px; }
  button.ghost, button.danger, button.inline-link {
    background: transparent;
    border: 1px solid var(--app-border);
    color: var(--app-text-muted);
    font-size: 11px;
    padding: 3px 8px;
    border-radius: 4px;
    cursor: pointer;
  }
  button.ghost:hover:not(:disabled) { background: var(--app-surface-hover); color: var(--app-text); }
  button.ghost:disabled { opacity: 0.5; cursor: default; }
  button.danger { color: var(--app-error-text); border-color: var(--app-error-text); }
  button.inline-link {
    border: none;
    padding: 0;
    text-decoration: underline;
    text-underline-offset: 2px;
    font-size: 11px;
  }
  .code-hint { font-size: 12px; }
  .user-code { font-family: var(--app-font-mono); letter-spacing: 0.12em; font-size: 14px; }
  .add-form { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .add-form input, .add-form select {
    flex: 1 1 140px;
    min-width: 120px;
    background: var(--app-surface-sunken);
    border: 1px solid var(--app-control-border);
    color: var(--app-text-secondary);
    padding: 5px 8px;
    border-radius: 6px;
    font-size: 12px;
  }
  .add-form button { flex: 0 0 auto; }
</style>
