<script lang="ts">
  /**
   * Settings → Accounts: every stored credential, listed so the author can see
   * and revoke it. Accounts are added where they are needed — GitHub here or in
   * Book setup → Backup (GitHubConnect), publishing keys in the Publish wizard,
   * another Git server in the book's Backup tab — so this list has no forms.
   *
   * Everything here reads REDACTED entries only (host/username/label — never
   * token values). Removal deletes by the entry's RAW store key via
   * remote:disconnectHost, which works uniformly for bare-host git entries
   * AND compound `<host>#<account>` publish keys. Entries whose ciphertext no
   * longer decrypts (OS keyring changed — HostConnectionInfo.unreadable) say
   * "Needs reconnecting" instead of silently looking healthy.
   *
   * PWA-clean (§8): api.* routes only.
   */
  import { onMount, tick } from "svelte";
  import GitHubConnect from "#lib/components/GitHubConnect.svelte";
  import { api, type PublishProviderStaticInfo } from "#lib/api.ts";
  import { friendlyHostError } from "#lib/errors.ts";
  import type { HostConnectionInfo, RemoteConnection } from "#lib/platform/contract.ts";
  import { requestInlineConfirm, cancelInlineConfirm, type InlineConfirmState } from "#lib/dialog.ts";

  let loading = $state(true);
  let loadFailed = $state(false);
  let github = $state<RemoteConnection | null>(null);
  let entries = $state<HostConnectionInfo[]>([]);
  let providers = $state<PublishProviderStaticInfo[]>([]);

  // Two-step Remove confirm (a stored token is the most painful thing
  // to re-acquire, so removal arms in place and confirms on a second click).
  let confirmRemove = $state<InlineConfirmState>({});
  let removing = $state<string | null>(null);
  let removeError = $state<string | null>(null);
  // A connect or a removal replaces the row holding focus; Escape only
  // reaches the Settings sheet from inside it.
  let rootEl = $state<HTMLElement>();

  onMount(() => {
    void load();
  });

  async function load() {
    loading = true;
    loadFailed = false;
    try {
      [github, entries, providers] = await Promise.all([
        api.remote.getRemoteConnection(),
        api.remote.listHostConnections(),
        api.publish.providers().catch(() => [] as PublishProviderStaticInfo[]),
      ]);
    } catch {
      loadFailed = true;
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
    if (idx > -1) return e.host.slice(idx + 1);
    // The default (unnamed) credential. For oauth-connected providers
    // (gdrive) `username` is deliberately EMPTY on the default entry — the
    // compound-key convention reserves `username` for a NAMED account's
    // label, so the connected email lives only in `label`
    // (e.g. "Google Drive — a@b.com", set by connect-google.ts). Recover it
    // here instead of falling through to "default". Token-based providers
    // never take this branch: their default entry's label is just the
    // provider name, and the strip below would be a no-op anyway.
    if (!e.username && e.kind === "google-oauth" && e.label) {
      return e.label.replace(/^Google Drive\s*—\s*/, "");
    }
    return e.username || "default";
  }

  // ── Removal (raw store key — works for bare-host AND compound keys) ─────────
  function requestRemove(key: string) {
    const { state, confirmed } = requestInlineConfirm(confirmRemove, key);
    confirmRemove = state;
    if (confirmed) void remove(key);
  }
  function keep(key: string) {
    confirmRemove = cancelInlineConfirm(confirmRemove, key);
  }
  async function remove(key: string) {
    if (removing) return;
    removing = key;
    removeError = null;
    try {
      if (key === "github.com") await api.remote.disconnectGitHub();
      else await api.remote.disconnectHost(key);
      await load();
    } catch (e) {
      removeError = friendlyHostError(e instanceof Error ? e.message : String(e));
    } finally {
      removing = null;
    }
    await keepFocus();
  }

  async function keepFocus() {
    await tick();
    rootEl?.focus();
  }
</script>

{#snippet removable(key: string, question: string, action: string)}
  {#if confirmRemove[key]}
    <span class="confirm">
      {question}
      <button class="app-btn danger" onclick={() => requestRemove(key)} disabled={!!removing}>{action}</button>
      <button class="app-btn app-btn-ghost" onclick={() => keep(key)}>Keep</button>
    </span>
  {:else}
    <button class="app-btn app-btn-ghost" onclick={() => requestRemove(key)} disabled={!!removing}>{action}</button>
  {/if}
{/snippet}

<div class="accounts" bind:this={rootEl} tabindex="-1">
{#if loading}
  <p class="hint">Loading your accounts…</p>
{:else if loadFailed}
  <p class="hint">Couldn't load your accounts. <button class="app-btn app-btn-ghost" onclick={load}>Try again</button></p>
{:else}
  {#if github?.connected}
    <div class="acct">
      <span class="acct-name">GitHub</span>
      <span class="acct-detail">{github.username ? `Connected as @${github.username}` : "Connected"}</span>
      {@render removable("github.com", "Disconnect GitHub? Books stop backing up until you connect again.", "Disconnect")}
    </div>
  {:else}
    <GitHubConnect onConnected={() => void load().then(keepFocus)}>
      <span class="acct-name">GitHub</span>
      <span class="acct-detail">Not connected</span>
    </GitHubConnect>
  {/if}
  {#each publishEntries as entry (entry.host)}
    <div class="acct">
      <span class="acct-name">{providerLabelFor(entry)}</span>
      <span class="acct-detail">
        {accountLabelFor(entry)}
        {#if entry.unreadable}<span class="warn">Needs reconnecting</span>{/if}
      </span>
      {@render removable(entry.host, "Remove this key?", "Remove")}
    </div>
  {/each}
  {#each gitServers as entry (entry.host)}
    <div class="acct">
      <span class="acct-name">{entry.host}</span>
      <span class="acct-detail">{#if entry.unreadable}<span class="warn">Needs reconnecting</span>{/if}</span>
      {@render removable(entry.host, "Remove this key?", "Remove")}
    </div>
  {/each}
  {#if removeError}<p class="error" role="alert">{removeError}</p>{/if}
{/if}
<p class="hint">Publishing accounts are added when you publish. Another Git server is added in the book's Setup &gt; Backup.</p>
</div>

<style>
  .accounts { display: flex; flex-direction: column; gap: 8px; outline: none; }
  .acct { display: flex; align-items: center; gap: 10px; min-height: 32px; font-size: 13px; }
  /* Also GitHubConnect's row: its children are this component's markup, so these rules reach them. */
  .acct-name { min-width: 120px; color: var(--app-text); font-weight: 600; font-size: 13px; }
  .acct-detail { flex: 1; min-width: 0; color: var(--app-text-muted); font-size: 13px; }
  .warn { margin-left: 8px; color: var(--app-warning-text); }
  .confirm { display: inline-flex; align-items: center; gap: 8px; color: var(--app-text-secondary); }
  .hint { margin: 0; font-size: 12px; line-height: 1.4; color: var(--app-text-muted); }
  .error { margin: 0; font-size: 12px; color: var(--app-error-text); }
  .danger { background: transparent; color: var(--app-error-text); border-color: var(--app-error-text); }
</style>
