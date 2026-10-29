<script module lang="ts">
  /** The guide to making an access token, for a server whose token page we don't know. */
  export const OTHER_SERVER_GUIDE =
    "https://gutterpress.dimm.city/docs/desktop/versions-and-backup/#back-up-to-another-git-server";
</script>

<script lang="ts">
  /**
   * GitServerForm — the one "connect a Git server" form: the server's address
   * (asked, or already known), an optional username and the access token. The
   * server checks them (api.remote.connectGenericHost) before anything is
   * saved, so a wrong token never reaches the store. Book setup → Backup uses
   * it for the server the book names, with that book's repository as the check;
   * the Accounts page adds a server with it and edits a saved one — saving
   * again replaces the saved username and token (a saved token is never read
   * back, so it is pasted again).
   *
   * The token lives here only until the server has accepted it: it is cleared
   * the moment it is saved, and a failed check keeps it so it can be fixed.
   *
   * PWA-clean (§8): api.* routes only.
   */
  import { onMount, untrack } from "svelte";
  import { api } from "#lib/api.ts";
  import { friendlyHostError, unwrapRouteError } from "#lib/errors.ts";
  import Icon from "#lib/components/Icon.svelte";

  let {
    host: knownHost,
    username: savedUsername = "",
    repoUrl,
    tokenUrl,
    hint,
    submitLabel = "Connect",
    takeFocus = false,
    onConnected,
    onCancel,
  }: {
    /** The server, when it is already known; otherwise its address is asked. */
    host?: string;
    /** The username already saved for this server (Edit). */
    username?: string;
    /** A repository on the server to check the token against (Backup: this book's). */
    repoUrl?: string;
    /** Where the server makes tokens, when the caller knows it; otherwise the guide that lists where each server does. */
    tokenUrl?: string | null;
    hint?: string;
    submitLabel?: string;
    /** Put the cursor in the field to fill first (the address, or the token of a known server) when the form appears. */
    takeFocus?: boolean;
    /** The server accepted the token and it is saved. */
    onConnected: (result: { host: string }) => void | Promise<void>;
    onCancel?: () => void;
  } = $props();

  let address = $state("");
  let username = $state(untrack(() => savedUsername));
  let token = $state("");
  let busy = $state(false);
  let error = $state<string | null>(null);
  let addressEl = $state<HTMLInputElement>();
  let tokenEl = $state<HTMLInputElement>();

  const host = $derived((knownHost ?? address).trim());

  onMount(() => {
    if (takeFocus) (addressEl ?? tokenEl)?.focus();
  });

  async function submit() {
    if (busy || !host || !token.trim()) return;
    busy = true;
    error = null;
    try {
      const result = await api.remote.connectGenericHost({
        host,
        ...(username.trim() ? { username: username.trim() } : {}),
        token,
        ...(repoUrl ? { repoUrl } : {}),
      });
      token = ""; // the token has done its job: never keep it in state
      await onConnected(result);
    } catch (e) {
      error = friendlyHostError(unwrapRouteError(e instanceof Error ? e.message : String(e)));
      tokenEl?.focus();
    } finally {
      busy = false;
    }
  }
</script>

<form class="server-form" onsubmit={(e) => { e.preventDefault(); void submit(); }}>
  {#if hint}<p class="hint">{hint}</p>{/if}
  {#if knownHost === undefined}
    <label class="field">
      <span class="lbl">Server address</span>
      <input bind:this={addressEl} bind:value={address} placeholder="git.example.com" autocomplete="off" spellcheck="false" />
    </label>
  {/if}
  <label class="field">
    <span class="lbl">Username (optional)</span>
    <input bind:value={username} autocomplete="username" spellcheck="false" />
  </label>
  <label class="field">
    <span class="lbl">Access token</span>
    <!-- "new-password" actually suppresses autofill/save prompts; browsers ignore "off" on password fields. -->
    <input bind:this={tokenEl} bind:value={token} type="password" autocomplete="new-password" />
  </label>
  <button type="button" class="link" onclick={() => void api.shell.openExternal(tokenUrl ?? OTHER_SERVER_GUIDE).catch(() => {})}>
    {tokenUrl ? `Create a token on ${host}` : "How to make an access token"} <Icon name="external-link" size={11} />
  </button>
  <div class="actions">
    <button type="submit" class="app-btn app-btn-primary" disabled={busy || !host || !token.trim()}>
      {busy ? "Checking…" : submitLabel}
    </button>
    {#if onCancel}<button type="button" class="app-btn app-btn-ghost" onclick={onCancel}>Cancel</button>{/if}
  </div>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</form>

<style>
  .server-form { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; }
  .field { display: flex; flex-direction: column; gap: 3px; align-self: stretch; max-width: 420px; }
  .lbl { font-size: 13px; font-weight: 600; color: var(--app-text); }
  input { box-sizing: border-box; width: 100%; padding: 7px 9px; font: inherit; font-size: 13px; }
  .actions { display: flex; gap: 8px; }
  .hint { margin: 0; font-size: 12px; line-height: 1.4; color: var(--app-text-muted); }
  .error { margin: 0; font-size: 12px; color: var(--app-error-text); }
  .link {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--app-link);
    font-size: 12px;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .link:hover { color: var(--app-link-hover); }
</style>
