<script lang="ts">
  /**
   * AccountsView — the one place to manage who you are and every account
   * Gutterpress connects to, all saved on this computer and used by every
   * book: one page in the shared AppView layer, like Settings, the same from
   * the start screen and over a book (it never reads the open book). Four
   * groups, each listing what is saved:
   *
   *   Your name and email — saved with each version; same settings keys and
   *                    save-on-change as before, moved here from Settings,
   *                    with the group's Reset (both back to empty).
   *   GitHub         — Connect (the device flow, GitHubConnect), then Test
   *                    sign-in, Sign in again… (an expired sign-in that makes
   *                    every backup fail; the flow's success replaces the
   *                    saved one) and Disconnect.
   *   Other Git servers — GitLab, Gitea, Forgejo, Bitbucket, Azure Repos or
   *                    any https server: Add, Edit and Remove (GitServerForm).
   *   Publishing     — a key for each provider that takes one, or Google
   *                    Drive's sign-in: Add, Edit and Remove (PublishKeyForm).
   *
   * Each group has one Add button that reveals a compact form in place, and
   * each saved account an Edit that opens the same form under its row. Edit
   * replaces the stored secret: a saved token is never read back or shown, so
   * it is pasted again, and the form drops it the moment it is saved. The
   * in-task sign-ins stay where the task is (Book setup → Online copy, the Publish
   * wizard), and they save to the same store.
   *
   * Everything here reads REDACTED entries only (host/username/label — never
   * token values), sorted by `groupAccounts`. A Git server is removed by its
   * host, a publishing account through the provider route and the account's
   * name (the redacted listing does not expose the store's compound key).
   * Entries whose ciphertext no longer decrypts (OS keyring changed —
   * HostConnectionInfo.unreadable) say "Needs signing in again" instead of
   * silently looking healthy; Edit is the way back.
   *
   * PWA-clean (§8): api.* routes and getPlatform() only.
   */
  import { onMount, tick } from "svelte";
  import AppView from "#lib/components/AppView.svelte";
  import GitHubConnect from "#lib/components/GitHubConnect.svelte";
  import GitServerForm from "#lib/components/GitServerForm.svelte";
  import PublishKeyForm from "#lib/components/PublishKeyForm.svelte";
  import { api, type PublishProviderStaticInfo } from "#lib/api.ts";
  import { groupAccounts, providersWithKeys, replaceHint } from "#lib/accounts.ts";
  import { friendlyHostError, unwrapRouteError } from "#lib/errors.ts";
  import { useSettings } from "#lib/settings.svelte.ts";
  import type { HostConnectionInfo, RemoteConnection } from "#lib/platform/contract.ts";
  import { keepInView, requestInlineConfirm, cancelInlineConfirm, type InlineConfirmState } from "#lib/dialog.ts";

  let {
    onClose,
    focus,
  }: {
    onClose: () => void;
    /** Open with the cursor in this field (the "Add your name & email" banner). */
    focus?: "name";
  } = $props();

  const settings = useSettings();
  const s = $derived(settings.current);

  let loading = $state(true);
  let loadFailed = $state(false);
  let github = $state<RemoteConnection | null>(null);
  let entries = $state<HostConnectionInfo[]>([]);
  let providers = $state<PublishProviderStaticInfo[]>([]);

  const groups = $derived(groupAccounts(entries, providers));
  const addable = $derived(providersWithKeys(providers));
  const addableNames = $derived(new Intl.ListFormat("en", { type: "conjunction" }).format(addable.map((p) => p.label)));

  // The one inline form that is open: "add-server", "add-publishing", or the
  // row's own id ("server:<host>", "publishing:<key>") for Edit.
  let open = $state<string | null>(null);
  let addProviderId = $state("");
  const addProvider = $derived(addable.find((p) => p.id === addProviderId) ?? addable[0]);
  // What the last save said, shown in the group it belongs to.
  let notice = $state<{ group: string; text: string } | null>(null);

  // Two-step Remove confirm (a stored token is the most painful thing
  // to re-acquire, so removal arms in place and confirms on a second click).
  let confirmRemove = $state<InlineConfirmState>({});
  let removing = $state<string | null>(null);
  let removeError = $state<{ id: string; text: string } | null>(null);
  // Saving, removing or closing a form replaces the control holding focus;
  // Escape only reaches the sheet from inside it.
  let rootEl = $state<HTMLElement>();

  onMount(() => {
    void load();
  });

  async function load() {
    loadFailed = false;
    try {
      [github, entries, providers] = await Promise.all([
        api.remote.getRemoteConnection(),
        api.remote.listHostConnections(),
        api.publish.providers(),
      ]);
    } catch {
      loadFailed = true;
    } finally {
      loading = false;
    }
  }

  async function keepFocus() {
    await tick();
    rootEl?.focus();
  }

  /** A control that appears where the one clicked was (the armed Remove, the Add form's picker) takes focus, so Escape still closes the page. */
  function focusNow(node: HTMLElement) {
    node.focus();
  }

  // ── The inline forms ───────────────────────────────────────────────────────
  function toggleForm(id: string) {
    open = open === id ? null : id;
    notice = null;
    removeError = null;
  }
  /** Cancel inside a form: the form is gone, so focus goes back to the page. */
  function closeForm() {
    open = null;
    void keepFocus();
  }

  /** A form saved an account: close it, say so, and show the new list. */
  async function afterSave(group: string, text: string) {
    open = null;
    notice = { group, text };
    await load();
    await keepFocus();
  }

  // ── Removal ────────────────────────────────────────────────────────────────
  function requestRemove(id: string, run: () => Promise<unknown>) {
    const { state, confirmed } = requestInlineConfirm(confirmRemove, id);
    confirmRemove = state;
    if (confirmed) void remove(id, run);
  }
  function keep(id: string) {
    confirmRemove = cancelInlineConfirm(confirmRemove, id);
    void keepFocus();
  }
  async function remove(id: string, run: () => Promise<unknown>) {
    if (removing) return;
    removing = id;
    removeError = null;
    notice = null;
    try {
      await run();
      await load();
    } catch (e) {
      removeError = { id, text: friendlyHostError(unwrapRouteError(e instanceof Error ? e.message : String(e))) };
    } finally {
      removing = null;
    }
    await keepFocus();
  }

  // ── GitHub: Test sign-in (read-only, so one click, no confirm) ──────────────
  let testing = $state(false);
  let testResult = $state<string | null>(null);
  let testOk = $state(false);

  async function testGitHub() {
    testing = true;
    testResult = null;
    try {
      await api.remote.listRemoteRepositories();
      testOk = true;
      testResult = `Working. Gutterpress reached GitHub${github?.username ? ` as @${github.username}` : ""}.`;
    } catch (e) {
      testOk = false;
      testResult = friendlyHostError(unwrapRouteError(e instanceof Error ? e.message : String(e)));
    } finally {
      testing = false;
    }
  }

  async function reconnected() {
    await load();
    testOk = true;
    testResult = `Signed in to GitHub${github?.username ? ` as @${github.username}` : ""}. Books back up with the new sign-in.`;
    await keepFocus();
  }
</script>

{#snippet removable(id: string, question: string, action: string, run: () => Promise<unknown>)}
  {#if confirmRemove[id]}
    <span class="confirm">
      {question}
      <button class="app-btn danger" use:focusNow onclick={() => requestRemove(id, run)} disabled={!!removing}>{action}</button>
      <button class="app-btn app-btn-ghost" onclick={() => keep(id)}>Keep</button>
    </span>
  {:else}
    <button class="app-btn app-btn-ghost" onclick={() => requestRemove(id, run)} disabled={!!removing}>{action}</button>
  {/if}
{/snippet}

<!-- One saved account's line: what it is, then Edit and Remove. The Edit form opens under it. -->
{#snippet line(id: string, name: string, detail: string, unreadable: boolean, edit: string, question: string, run: () => Promise<unknown>)}
  <div class="acct">
    <span class="acct-name">{name}</span>
    <span class="acct-detail">
      {detail}
      {#if unreadable}<span class="warn">Needs signing in again</span>{/if}
    </span>
    {#if !confirmRemove[id]}
      <button class="app-btn app-btn-ghost" onclick={() => toggleForm(id)} aria-expanded={open === id}>{edit}</button>
    {/if}
    {@render removable(id, question, "Remove", run)}
  </div>
  {#if removeError?.id === id}<p class="error" role="alert">{removeError.text}</p>{/if}
{/snippet}

<AppView
  title="Accounts"
  icon="circle-user"
  measure={640}
  {onClose}
  closeLabel="Close accounts"
  closeTitle="Close (Esc)"
  initialFocus={focus === "name" ? "#accounts-name" : undefined}
>
<div class="accounts" bind:this={rootEl} tabindex="-1">
  <p class="hint">Who you are and the accounts Gutterpress uses, saved on this computer. Every book uses them.</p>

  <section class="group" aria-labelledby="accounts-identity">
    <div class="group-head">
      <h2 id="accounts-identity">Your name and email</h2>
      <button type="button" class="app-btn app-btn-ghost reset" onclick={() => settings.resetSection("gitIdentity")} aria-label="Reset Your name and email" title="Reset Your name and email to the defaults">Reset</button>
    </div>
    <p class="hint">
      Saved with each version, so the version history shows who changed what. Left empty, a version uses the name and
      email already set for Git on this computer, or else "gutterpress".
    </p>
    <div class="field">
      <label for="accounts-name">Name</label>
      <input id="accounts-name" type="text" autocomplete="name" value={s.gitIdentity.authorName} onchange={(e) => settings.set({ gitIdentity: { authorName: e.currentTarget.value } })} />
    </div>
    <div class="field">
      <label for="accounts-email">Email</label>
      <input id="accounts-email" type="email" autocomplete="email" value={s.gitIdentity.authorEmail} onchange={(e) => settings.set({ gitIdentity: { authorEmail: e.currentTarget.value } })} />
    </div>
  </section>

  {#if loading}
    <p class="hint">Loading your accounts…</p>
  {:else if loadFailed}
    <p class="hint">Couldn't load your accounts. <button class="app-btn app-btn-ghost" onclick={() => { loading = true; void load(); }}>Try again</button></p>
  {:else}
    <section class="group" aria-labelledby="accounts-github">
      <h2 id="accounts-github">GitHub</h2>
      {#if github?.connected}
        <div class="acct">
          <span class="acct-detail">{github.username ? `Connected as @${github.username}` : "Connected"}</span>
          {@render removable("github.com", "Disconnect GitHub? Books stop backing up until you sign in again.", "Disconnect", () => api.remote.disconnectGitHub())}
        </div>
        {#if removeError?.id === "github.com"}<p class="error" role="alert">{removeError.text}</p>{/if}
        <div class="acct-more">
          <GitHubConnect label="Sign in again…" onConnected={() => void reconnected()}>
            <button class="app-btn app-btn-ghost" onclick={() => void testGitHub()} disabled={testing}>
              {testing ? "Testing…" : "Test sign-in"}
            </button>
          </GitHubConnect>
          {#if testResult}<p class="result" class:error={!testOk} role="status">{testResult}</p>{/if}
        </div>
      {:else}
        <GitHubConnect onConnected={() => void load().then(keepFocus)}>
          <span class="acct-detail">Not connected</span>
        </GitHubConnect>
      {/if}
    </section>

    <section class="group" aria-labelledby="accounts-servers">
      <h2 id="accounts-servers">Other Git servers</h2>
      <p class="hint">GitLab, Gitea, Forgejo, Bitbucket, Azure Repos, or any server with an https:// address. Books on it back up with the token saved here.</p>
      {#each groups.servers as server (server.host)}
        {@render line(`server:${server.host}`, server.host, server.username, server.unreadable, "Edit", "Remove this server? Books that back up there stop until you sign in to it again.", () => api.remote.disconnectHost(server.host))}
        {#if open === `server:${server.host}`}
          <div class="form edit" use:keepInView>
            <GitServerForm
              host={server.host}
              username={server.username}
              hint="Your saved token can't be shown. Paste the token again to save your changes."
              submitLabel="Save"
              takeFocus
              onConnected={() => afterSave("servers", `Saved ${server.host}.`)}
              onCancel={closeForm}
            />
          </div>
        {/if}
      {:else}
        <p class="hint">No Git servers saved.</p>
      {/each}
      {#if notice?.group === "servers"}<p class="done" role="status">{notice.text}</p>{/if}
      {#if open === "add-server"}
        <div class="form" use:keepInView>
          <GitServerForm takeFocus onConnected={(r) => afterSave("servers", `Saved ${r.host}.`)} onCancel={closeForm} />
        </div>
      {:else}
        <button class="app-btn app-btn-ghost self-start" onclick={() => toggleForm("add-server")}>Add a Git server…</button>
      {/if}
    </section>

    <section class="group" aria-labelledby="accounts-publishing">
      <h2 id="accounts-publishing">Publishing</h2>
      <p class="hint">Keys that let Gutterpress publish a book for you: {addableNames}.</p>
      {#each groups.publishing as acct (acct.key)}
        {@render line(`publishing:${acct.key}`, acct.provider.label, acct.label, acct.unreadable, acct.provider.connectKind === "oauth" ? "Sign in again…" : "Edit", acct.provider.connectKind === "oauth" ? "Remove this sign-in?" : "Remove this key?", () => api.publish.disconnect(acct.provider.id, acct.account || undefined))}
        {#if open === `publishing:${acct.key}`}
          <div class="form edit" use:keepInView>
            <PublishKeyForm
              provider={acct.provider}
              account={acct.account}
              hint={replaceHint(acct.provider)}
              submitLabel="Save"
              takeFocus
              onConnected={() => afterSave("publishing", acct.provider.connectKind === "oauth" ? `Connected ${acct.provider.label}.` : `Saved your ${acct.provider.label} key.`)}
              onCancel={closeForm}
            />
          </div>
        {/if}
      {:else}
        <p class="hint">No publishing accounts saved.</p>
      {/each}
      {#if notice?.group === "publishing"}<p class="done" role="status">{notice.text}</p>{/if}
      {#if open === "add-publishing" && addProvider}
        <div class="form" use:keepInView>
          <label class="pick">
            <span class="lbl">Publish to</span>
            <select id="accounts-provider" use:focusNow value={addProvider.id} onchange={(e) => (addProviderId = e.currentTarget.value)}>
              {#each addable as p (p.id)}<option value={p.id}>{p.label}</option>{/each}
            </select>
          </label>
          {#key addProvider.id}
            <PublishKeyForm
              provider={addProvider}
              askAccount
              saved={groups.publishing}
              onConnected={() => afterSave("publishing", addProvider.connectKind === "oauth" ? `Connected ${addProvider.label}.` : `Saved your ${addProvider.label} key.`)}
              onCancel={closeForm}
            />
          {/key}
        </div>
      {:else}
        <button class="app-btn app-btn-ghost self-start" onclick={() => toggleForm("add-publishing")}>Add a publishing account…</button>
      {/if}
    </section>
  {/if}
</div>
</AppView>

<style>
  .accounts { display: flex; flex-direction: column; gap: 22px; outline: none; }
  .group { display: flex; flex-direction: column; gap: 8px; }
  h2 { margin: 0 0 2px; font-size: 15px; font-weight: 600; color: var(--app-text); }
  /* A group's heading and its Reset, as on the Settings page. */
  .group-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .group-head h2 { margin: 0; }
  .reset { padding: 3px 10px; font-size: 12px; }
  /* Wraps, so a long Remove question takes its own line instead of crushing the row. */
  .acct { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; min-height: 32px; font-size: 13px; }
  /* GitHub's second line: Test sign-in, Sign in again…. */
  .acct-more { display: flex; flex-direction: column; gap: 8px; }
  /* Also GitHubConnect's row: its children are this component's markup, so these rules reach them. */
  .acct-name { min-width: 120px; color: var(--app-text); font-weight: 600; font-size: 13px; }
  .acct-detail { flex: 1 1 160px; min-width: 0; color: var(--app-text-muted); font-size: 13px; overflow-wrap: anywhere; }
  .warn { margin-left: 8px; color: var(--app-warning-text); }
  .confirm { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 8px; color: var(--app-text-secondary); }
  /* An open form sits under its row, in line with the account's name and details. */
  .form { display: flex; flex-direction: column; gap: 10px; padding: 4px 0 6px; }
  .form.edit { padding-left: 130px; }
  .self-start { align-self: flex-start; }
  .hint { margin: 0; font-size: 12px; line-height: 1.4; color: var(--app-text-muted); }
  .done { margin: 0; font-size: 12px; color: var(--app-success-text); }
  .error { margin: 0; font-size: 12px; color: var(--app-error-text); }
  .result { margin: 0; font-size: 12px; color: var(--app-text-secondary); overflow-wrap: anywhere; }
  .result.error { color: var(--app-error-text); }
  .danger { background: transparent; color: var(--app-error-text); border-color: var(--app-error-text); }

  .field { display: grid; grid-template-columns: 120px minmax(0, 320px); align-items: center; gap: 16px; font-size: 13px; color: var(--app-text-secondary); }
  .field input {
    padding: 6px 8px;
    font: inherit;
  }
  /* The provider picker reads like the form's own fields. */
  .pick { display: flex; flex-direction: column; gap: 3px; max-width: 420px; }
  .lbl { font-size: 13px; font-weight: 600; color: var(--app-text); }
  .pick select { padding: 7px 9px; font: inherit; font-size: 13px; }
</style>
