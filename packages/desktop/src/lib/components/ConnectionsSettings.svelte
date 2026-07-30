<script lang="ts">
  /**
   * Settings → Accounts — the ONE central place to see and manage every
   * stored credential. Section order (owner request 2026-07-30): GitHub
   * first — it sits directly under the author's name & email, the identity
   * it carries — then publishing accounts, then other Git servers. The open
   * project's sync diagnostics (the "This project" section) moved to
   * Project settings → Connections (ProjectConnectionsSection.svelte,
   * 2026-07-30); the diagnosis is still fetched here because the Git-server
   * connect form uses it for host prefill and repo-scoped validation.
   *
   * The former Advanced Setup dialog (#14, ADR 0006) is consolidated here:
   * its duplicate connect-a-Git-server form and connected-servers list are
   * gone; its unique pieces live on in the single Git-servers section (the
   * debounced token-URL helper, the repo-scoped validation against the open
   * project's remote, the host prefill, the provider guidance).
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
   * verify-before-store token flow (validated with a refs probe BEFORE it is
   * saved — against this project's repository when it lives on the same
   * server); publishing keys verify against the provider, which for some
   * providers needs the open project's manifest — so that form asks for an
   * open project when none is.
   *
   * PWA-clean (§8): api.* routes + getPlatform() only.
   */
  import { onMount } from "svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { api, type PublishProviderStaticInfo } from "$lib/api";
  import { getPlatform, isDesktop } from "$lib/platform";
  import { friendlyHostError } from "$lib/errors";
  import type {
    HostConnectionInfo,
    RemoteConnection,
    DeviceCodeInfo,
    ProjectRemoteDiagnosis,
  } from "$lib/platform/contract";
  import { requestInlineConfirm, cancelInlineConfirm, type InlineConfirmState } from "$lib/dialog";

  let { projectDir = null as string | null }: { projectDir?: string | null } = $props();

  let loading = $state(true);
  let loadError = $state<string | null>(null);
  let github = $state<RemoteConnection | null>(null);
  let entries = $state<HostConnectionInfo[]>([]);
  let providers = $state<PublishProviderStaticInfo[]>([]);
  /** The open project's remote diagnosis (null when no project is open). */
  let diag = $state<ProjectRemoteDiagnosis | null>(null);

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
  /** Forge token-settings URL for the typed server, resolved debounced. */
  let tokenUrl = $state<string | null>(null);
  let serverInputTimer: ReturnType<typeof setTimeout> | undefined;

  // Add-a-publishing-key form.
  let pubProviderId = $state("");
  let pubToken = $state("");
  let pubAccount = $state("");
  let pubBusy = $state(false);
  let pubError = $state<string | null>(null);
  let pubNotice = $state<string | null>(null);

  // Two-step Remove confirm (L2 — a stored token is the most painful thing
  // to re-acquire, so removal arms in place and confirms on a second click).
  let confirmRemove = $state<InlineConfirmState>({});
  let removing = $state<string | null>(null);
  let removeError = $state<string | null>(null);

  onMount(() => {
    void load();
    return () => {
      clearTimeout(serverInputTimer);
      serverInputTimer = undefined;
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
      const [conn, list, provs, d] = await Promise.all([
        api.remote.getRemoteConnection().catch(() => null),
        api.remote.listHostConnections().catch(() => [] as HostConnectionInfo[]),
        api.publish.providers().catch(() => [] as PublishProviderStaticInfo[]),
        projectDir
          ? (api.remote.diagnoseProjectRemote(projectDir) as Promise<ProjectRemoteDiagnosis>).catch(() => null)
          : Promise.resolve(null),
      ]);
      github = conn;
      entries = list as HostConnectionInfo[];
      providers = provs;
      diag = d;
      if (!pubProviderId) {
        pubProviderId = providers.find((p) => p.credentialRequired)?.id ?? "";
      }
      // Pre-fill the connect form with this project's server when it needs one.
      if (!serverInput && d?.guidance === "https-connect-server" && d.remoteHost) {
        serverInput = d.remoteHost;
        refreshTokenUrl(d.remoteHost);
      }
    } catch (e) {
      loadError = friendlyHostError(e instanceof Error ? e.message : String(e));
    } finally {
      loading = false;
    }
  }

  async function refreshDiag() {
    if (!projectDir) return;
    diag = await (api.remote.diagnoseProjectRemote(projectDir) as Promise<ProjectRemoteDiagnosis>).catch(() => diag);
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

  // ── Git server connect (verify-before-store; project-aware) ────────────────
  function onServerInput(e: Event) {
    serverInput = (e.currentTarget as HTMLInputElement).value;
    refreshTokenUrl(serverInput.trim());
  }

  /** Debounced forge lookup: shows a "create a token here" link for known
   *  server types (Gitea/GitLab/…), so authors aren't left guessing. */
  function refreshTokenUrl(value: string) {
    clearTimeout(serverInputTimer);
    if (!value) {
      tokenUrl = null;
      return;
    }
    serverInputTimer = setTimeout(() => {
      api.remote
        .forgeTokenUrl(value)
        .then((url) => {
          if (serverInput.trim() === value) tokenUrl = url;
        })
        .catch(() => (tokenUrl = null));
    }, 300);
  }

  function sameHost(host: string | undefined, input: string): boolean {
    if (!host) return false;
    const typed = input.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
    return typed === host.toLowerCase();
  }

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
        // Validate against this project's repository when it lives on the
        // same server — a full probe proves repo access, not just reachability.
        ...(diag?.remoteUrl && diag.remoteProtocol === "https" && sameHost(diag.remoteHost, serverInput)
          ? { repoUrl: diag.remoteUrl }
          : {}),
      });
      serverToken = ""; // the token has done its job — never keep it in state
      serverInput = "";
      serverUser = "";
      tokenUrl = null;
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
      // A removed server credential changes the project's sync readiness.
      await refreshDiag();
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

    <!-- GitHub (writing sync) — FIRST, directly under the author's name &
         email on both Accounts surfaces (owner request 2026-07-30): signing
         in to GitHub is the step that makes that identity travel with the
         work. -->
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

    <!-- Other Git servers — the ONE connect-a-server surface (the former
         Advanced-setup duplicate form/list are consolidated here). -->
    <section class="conn-group">
      <h4>Git servers</h4>
      <p class="hint">Access tokens for Gitea, Forgejo, GitLab, Bitbucket, Azure Repos, and other servers your books sync with. The token is checked with the server before it is saved.</p>
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
        <input type="text" placeholder="Server (e.g. git.example.com)" value={serverInput} oninput={onServerInput} spellcheck="false" autocomplete="off" />
        <input type="text" placeholder="Username (optional)" value={serverUser} oninput={(e) => (serverUser = (e.currentTarget as HTMLInputElement).value)} />
        <!-- "new-password" actually suppresses autofill/save prompts;
             browsers ignore "off" on password fields. -->
        <input type="password" placeholder="Access token" value={serverToken} oninput={(e) => (serverToken = (e.currentTarget as HTMLInputElement).value)} autocomplete="new-password" />
        <button class="ghost" onclick={connectServer} disabled={serverBusy || !serverInput.trim() || !serverToken.trim()}>
          {serverBusy ? "Checking…" : "Connect"}
        </button>
      </div>
      {#if tokenUrl}
        <p class="hint">
          Create a token on your server:
          <button class="inline-link" onclick={() => tokenUrl && api.shell.openExternal(tokenUrl).catch(() => {})}>open the token settings page</button>
        </p>
      {/if}
      {#if serverNotice}<p class="notice">{serverNotice}</p>{/if}
      {#if serverError}<p class="error" role="alert">{serverError}</p>{/if}

      <!-- Provider guidance — short, honest per-provider next steps. -->
      <details class="provider-help">
        <summary>Which server do you use?</summary>
        <dl class="provider-list">
          <dt>GitHub</dt>
          <dd>
            Use <strong>Connect GitHub</strong> above — it signs you in from
            your browser with a short code. No tokens to paste.
          </dd>
          <dt>Gitea or Forgejo</dt>
          <dd>
            Create an access token on your server (Settings &gt; Applications),
            then connect the server above. Or clone the repository with your
            usual Git tools and open the folder in Gutterpress.
          </dd>
          <dt>GitLab</dt>
          <dd>
            Create a personal access token (Preferences &gt; Access tokens) with
            read and write access to repositories, then connect the server
            above. Or clone with your usual Git tools and open the folder.
          </dd>
          <dt>Bitbucket</dt>
          <dd>
            Create an app password (Personal settings &gt; App passwords) with
            repository read and write, then connect bitbucket.org above. Or
            clone with your usual Git tools and open the folder.
          </dd>
          <dt>Azure Repos</dt>
          <dd>
            Create a personal access token (User settings &gt; Personal access
            tokens) with Code read &amp; write, then connect dev.azure.com
            above. Or clone with your usual Git tools and open the folder.
          </dd>
          <dt>SSH addresses (git@…)</dt>
          <dd>
            Projects opened from an SSH clone keep every local feature —
            preview, snapshots, history, restore. Gutterpress can't sync over
            SSH, so sync with your usual Git tool, or switch the project to
            the web (HTTPS) address and connect the server here.
          </dd>
        </dl>
      </details>
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
  /* Provider guidance — collapsed by default so the section stays scannable. */
  .provider-help { margin-top: 10px; }
  .provider-help summary {
    cursor: pointer;
    font-size: 12px;
    color: var(--app-text-secondary);
  }
  .provider-list { margin: 8px 0 0; font-size: 12px; line-height: 1.5; }
  .provider-list dt { font-weight: 600; color: var(--app-text); margin-top: 8px; }
  .provider-list dt:first-child { margin-top: 0; }
  .provider-list dd { margin: 2px 0 0; color: var(--app-text-secondary); }
</style>
