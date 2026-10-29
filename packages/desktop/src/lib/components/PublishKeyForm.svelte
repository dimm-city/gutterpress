<script lang="ts">
  /**
   * PublishKeyForm — adds or replaces one publishing account without a book
   * open (the Accounts page): a key pasted for itch.io, Azure Static Web Apps
   * or Shopify, checked with the provider before it is saved
   * (api.publish.connect with no project), or Google Drive's browser sign-in
   * (connectGoogleStart/Wait/Cancel). The Publish wizard keeps its own entry,
   * which also picks the account a book uses.
   *
   * A new account may be given a name, so several can be kept for one
   * provider; saving under a name that already exists replaces that key, which
   * is how a key is edited (a saved key is never read back, so it is pasted
   * again). The key lives here only until it is saved: it is cleared at once,
   * and a failed check keeps it so it can be fixed.
   *
   * PWA-clean (§8): api.* routes and getPlatform() only.
   */
  import { onMount, tick } from "svelte";
  import { api, type PublishProviderStaticInfo } from "#lib/api.ts";
  import { friendlyHostError, unwrapRouteError } from "#lib/errors.ts";
  import { getPlatform } from "#lib/platform/index.ts";
  import { savedAccount, type PublishAccount } from "#lib/accounts.ts";
  import Icon from "#lib/components/Icon.svelte";

  let {
    provider,
    account = "",
    askAccount = false,
    saved = [],
    hint,
    submitLabel = "Add",
    takeFocus = false,
    onConnected,
    onCancel,
  }: {
    provider: PublishProviderStaticInfo;
    /** The account being replaced (Edit): "" is the default account. */
    account?: string;
    /** Ask for an optional name for the account (Add). */
    askAccount?: boolean;
    /** The accounts already saved, so a name that would replace one says so. */
    saved?: PublishAccount[];
    /** What to tell the author before the fields; the provider's own hint when left out. */
    hint?: string;
    submitLabel?: string;
    /** Put the cursor in the field to fill first when the form appears. */
    takeFocus?: boolean;
    /** The account is saved. */
    onConnected: () => void | Promise<void>;
    onCancel?: () => void;
  } = $props();

  let typedAccount = $state("");
  let token = $state("");
  let busy = $state(false);
  let error = $state<string | null>(null);
  /** Google's sign-in page, while the browser is being waited on. */
  let signInUrl = $state<string | null>(null);
  let nameEl = $state<HTMLInputElement>();
  let tokenEl = $state<HTMLInputElement>();
  // The button that starts the sign-in is replaced by the waiting line's, and a removed
  // control drops focus to <body>, where Escape no longer reaches the page.
  let submitEl = $state<HTMLButtonElement>();
  let cancelEl = $state<HTMLButtonElement>();
  // A sign-in that was cancelled settles late; only the latest attempt may touch the form.
  let attempt = 0;

  const oauth = $derived(provider.connectKind === "oauth");
  const name = $derived((askAccount ? typedAccount : account).trim());
  const replaces = $derived(askAccount ? savedAccount(saved, provider.id, name) : undefined);

  onMount(() => {
    if (takeFocus) (tokenEl ?? nameEl)?.focus();
    // A sign-in left waiting must not outlive the page.
    return () => {
      if (signInUrl) getPlatform().connectGoogleCancel().catch(() => {});
    };
  });

  const failed = (e: unknown) => friendlyHostError(unwrapRouteError(e instanceof Error ? e.message : String(e)));

  async function submit() {
    if (busy || !token.trim()) return;
    busy = true;
    error = null;
    try {
      await api.publish.connect(null, provider.id, token, name || undefined);
      token = ""; // the key has done its job: never keep it in state
      await onConnected();
    } catch (e) {
      error = failed(e);
      tokenEl?.focus();
    } finally {
      busy = false;
    }
  }

  async function signIn() {
    if (busy) return;
    const mine = ++attempt;
    busy = true;
    error = null;
    try {
      const { authUrl } = await getPlatform().connectGoogleStart(name || undefined);
      if (mine !== attempt) return;
      signInUrl = authUrl;
      void tick().then(() => cancelEl?.focus());
      await getPlatform().connectGoogleWait();
      if (mine === attempt) await onConnected();
    } catch (e) {
      if (mine === attempt) error = failed(e);
    } finally {
      if (mine === attempt) {
        busy = false;
        signInUrl = null;
        void tick().then(() => submitEl?.focus());
      }
    }
  }

  function cancelSignIn() {
    attempt++;
    busy = false;
    signInUrl = null;
    void tick().then(() => submitEl?.focus());
    getPlatform().connectGoogleCancel().catch(() => {});
  }
</script>

<form class="key-form" onsubmit={(e) => { e.preventDefault(); void (oauth ? signIn() : submit()); }}>
  {#if hint ?? provider.hint}<p class="hint">{hint ?? provider.hint}</p>{/if}
  {#if !oauth}
    <label class="field">
      <span class="lbl">API key</span>
      <!-- "new-password" actually suppresses autofill/save prompts; browsers ignore "off" on password fields. -->
      <input bind:this={tokenEl} bind:value={token} type="password" autocomplete="new-password" />
    </label>
    {#if provider.tokenUrl}
      <button type="button" class="link" onclick={() => void api.shell.openExternal(provider.tokenUrl!).catch(() => {})}>
        Create a key on {provider.label} <Icon name="external-link" size={11} />
      </button>
    {/if}
  {/if}
  {#if askAccount}
    <label class="field">
      <span class="lbl">Account name (optional)</span>
      <input bind:this={nameEl} bind:value={typedAccount} placeholder="Leave blank for your default" autocomplete="off" spellcheck="false" />
    </label>
    {#if replaces}
      <p class="hint">{replaces.account ? `A key named ${replaces.label} is already saved. Adding this replaces it.` : `Your default ${provider.label} account is already saved. Adding this replaces it.`}</p>
    {/if}
  {/if}
  {#if signInUrl}
    <p class="waiting"><Icon name="refresh-cw" size={13} /> Waiting for your browser. Choose your Google account and click Allow.</p>
    <div class="actions">
      <button type="button" class="link" onclick={() => void api.shell.openExternal(signInUrl!).catch(() => {})}>
        Open the sign-in page again <Icon name="external-link" size={11} />
      </button>
      <button bind:this={cancelEl} type="button" class="app-btn app-btn-ghost" onclick={cancelSignIn}>Cancel</button>
    </div>
  {:else}
    <div class="actions">
      <button bind:this={submitEl} type="submit" class="app-btn app-btn-primary" disabled={busy || (!oauth && !token.trim())}>
        {oauth ? `Connect ${provider.label}` : busy ? "Checking…" : submitLabel}
      </button>
      {#if onCancel}<button type="button" class="app-btn app-btn-ghost" onclick={onCancel}>Cancel</button>{/if}
    </div>
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</form>

<style>
  .key-form { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; }
  .field { display: flex; flex-direction: column; gap: 3px; align-self: stretch; max-width: 420px; }
  .lbl { font-size: 13px; font-weight: 600; color: var(--app-text); }
  input { box-sizing: border-box; width: 100%; padding: 7px 9px; font: inherit; font-size: 13px; }
  .actions { display: flex; align-items: center; gap: 8px; }
  .hint { margin: 0; font-size: 12px; line-height: 1.4; color: var(--app-text-muted); }
  .waiting { display: flex; align-items: center; gap: 6px; margin: 0; font-size: 13px; color: var(--app-text-secondary); }
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
