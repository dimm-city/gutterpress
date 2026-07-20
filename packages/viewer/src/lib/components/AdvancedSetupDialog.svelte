<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  /**
   * Advanced Setup (#14, ADR 0006) — the one place in the app where mild Git
   * vocabulary is allowed ("access token", "branch"), kept gentle. Four
   * sections:
   *
   *   1. Environment status — folder classification, remote, branch, address
   *      type, stored connections. All LOCAL reads (remote:diagnoseProject);
   *      no "Git installed?" row — node-native Git is always available.
   *   2. Test Remote Access — an explicit, user-initiated refs probe (the
   *      `git ls-remote` equivalent), never run automatically.
   *   3. Connect a Git server — the universal token flow for Gitea, Forgejo,
   *      GitLab, Bitbucket, Azure Repos, and any other smart-HTTPS host. The
   *      token is validated with a refs probe BEFORE it is saved, crosses to
   *      the host exactly once, and never persists in renderer state.
   *   4. Provider guidance — short, honest per-provider next steps, including
   *      the SSH limitation (full local features; sync with your own tool).
   *
   * All host work goes through getPlatform() (§8 / ADR 0004).
   */
  import { getPlatform, isDesktop } from "$lib/platform";
  import { api } from "$lib/api";
  import { friendlyHostError } from "$lib/errors";
  import type {
    ProjectRemoteDiagnosis,
    RemoteAccessResult,
    RemoteConnection,
    HostConnectionInfo,
  } from "$lib/platform/contract";
  import {
    dialogBehavior,
    guardedClose,
    requestInlineConfirm,
    cancelInlineConfirm,
    type InlineConfirmState,
  } from "$lib/dialog";

  let {
    open = $bindable(false),
    projectDir,
    triggerEl,
    onClosed,
  }: {
    open?: boolean;
    projectDir: string | null;
    triggerEl?: HTMLButtonElement | undefined;
    /** Called whenever the dialog closes. Useful for post-close refresh. */
    onClosed?: () => void;
  } = $props();

  let diag = $state<ProjectRemoteDiagnosis | null>(null);
  let diagLoading = $state(false);
  let github = $state<RemoteConnection | null>(null);
  let connections = $state<HostConnectionInfo[]>([]);
  let loadError = $state<string | null>(null);
  // Stale-load guard: each load() captures a generation; results from a
  // superseded load (dialog reopened, project switched) are discarded.
  let loadGen = 0;

  // Test Remote Access — only ever runs on explicit click.
  let testing = $state(false);
  let testResult = $state<RemoteAccessResult | null>(null);

  // Connect a Git server.
  let serverInput = $state("");
  let usernameInput = $state("");
  let tokenInput = $state("");
  let connecting = $state(false);
  let connectError = $state<string | null>(null);
  let connectNotice = $state<string | null>(null);
  let tokenUrl = $state<string | null>(null);

  // Connected-servers list.
  let disconnecting = $state<string | null>(null);
  let disconnectError = $state<string | null>(null);
  /** Two-step Disconnect confirm (L2), keyed by host — see `requestDisconnect`. */
  let confirmDisconnect = $state<InlineConfirmState>({});

  let serverInputTimer: ReturnType<typeof setTimeout> | undefined;

  function onDialogMount(_el: HTMLElement) {
    loadGen += 1;
    diag = null;
    testResult = null;
    loadError = null;
    serverInput = "";
    usernameInput = "";
    tokenInput = "";
    connectError = null;
    connectNotice = null;
    disconnectError = null;
    confirmDisconnect = {};
    tokenUrl = null;
    void load();
    return {
      destroy() {
        clearTimeout(serverInputTimer);
        serverInputTimer = undefined;
      },
    };
  }

  function onServerInput(e: Event) {
    serverInput = (e.currentTarget as HTMLInputElement).value;
    clearTimeout(serverInputTimer);
    const value = serverInput.trim();
    if (!value) { tokenUrl = null; return; }
    serverInputTimer = setTimeout(() => {
      api.remote
        .forgeTokenUrl(value)
        .then((url) => { if (serverInput.trim() === value) tokenUrl = url; })
        .catch(() => (tokenUrl = null));
    }, 300);
  }

  async function load() {
    if (!isDesktop()) return;
    const gen = ++loadGen;
    diag = null;
    diagLoading = true;
    try {
      const [conn, list] = await Promise.all([
        api.remote.getRemoteConnection().catch(() => null),
        api.remote.listHostConnections().catch(() => [] as HostConnectionInfo[]),
      ]);
      if (gen !== loadGen) return;
      github = conn;
      connections = list as HostConnectionInfo[];
      if (projectDir) {
        const result = await api.remote.diagnoseProjectRemote(projectDir) as ProjectRemoteDiagnosis;
        if (gen !== loadGen) return;
        diag = result;
        // Pre-fill the connect form with this project's server when it needs one.
        if (result.guidance === "https-connect-server" && result.remoteHost) {
          serverInput = result.remoteHost;
        }
      }
    } catch (e) {
      if (gen === loadGen) loadError = friendlyHostError(e instanceof Error ? e.message : String(e));
    } finally {
      if (gen === loadGen) diagLoading = false;
    }
  }

  async function runRemoteTest() {
    if (!diag?.remoteUrl || testing) return;
    testing = true;
    testResult = null;
    try {
      testResult = await api.remote.testRemoteAccess(diag.remoteUrl) as RemoteAccessResult;
    } catch (e) {
      testResult = { ok: false, reason: "unknown", message: friendlyHostError(e instanceof Error ? e.message : String(e)) };
    } finally {
      testing = false;
    }
  }

  async function connectServer() {
    if (connecting) return;
    connectError = null;
    connectNotice = null;
    connecting = true;
    try {
      const result = await api.remote.connectGenericHost({
        host: serverInput,
        ...(usernameInput.trim() ? { username: usernameInput.trim() } : {}),
        token: tokenInput,
        // Validate against this project's repository when it lives on the
        // same server — a full probe proves repo access, not just reachability.
        ...(diag?.remoteUrl &&
        diag.remoteProtocol === "https" &&
        sameHost(diag.remoteHost, serverInput)
          ? { repoUrl: diag.remoteUrl }
          : {}),
      });
      // The token has done its job — never keep it in renderer state.
      tokenInput = "";
      connectNotice = `Connected to ${result.host}.`;
      connections = await api.remote.listHostConnections().catch(() => connections) as HostConnectionInfo[];
      if (projectDir) {
        diag = await api.remote.diagnoseProjectRemote(projectDir).catch(() => diag) as ProjectRemoteDiagnosis;
      }
    } catch (e) {
      connectError = friendlyHostError(e instanceof Error ? e.message : String(e));
    } finally {
      connecting = false;
    }
  }

  function sameHost(host: string | undefined, input: string): boolean {
    if (!host) return false;
    const typed = input.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
    return typed === host.toLowerCase();
  }

  async function disconnect(host: string) {
    if (disconnecting) return;
    disconnecting = host;
    disconnectError = null;
    try {
      await api.remote.disconnectHost(host);
      connections = connections.filter((c) => c.host !== host);
      if (projectDir) {
        diag = await api.remote.diagnoseProjectRemote(projectDir).catch(() => diag) as ProjectRemoteDiagnosis;
      }
    } catch (e) {
      disconnectError = friendlyHostError(e instanceof Error ? e.message : String(e));
    } finally {
      disconnecting = null;
    }
  }

  /**
   * Inline "Really disconnect?" confirm (L2) — Disconnect deletes a stored
   * access token the dialog's own copy calls the most painful thing to
   * re-acquire in the product, so it gets the same two-step swap
   * CrashRecoveryDialog uses for Discard: the first click arms the button in
   * place, a second click while armed confirms.
   */
  function requestDisconnect(host: string) {
    const { state, confirmed } = requestInlineConfirm(confirmDisconnect, host);
    confirmDisconnect = state;
    if (confirmed) void disconnect(host);
  }

  function cancelDisconnect(host: string, event: MouseEvent) {
    confirmDisconnect = cancelInlineConfirm(confirmDisconnect, host);
    const row = (event.currentTarget as HTMLElement).closest(".conn-row");
    queueMicrotask(() => row?.querySelector<HTMLButtonElement>(".conn-disconnect")?.focus());
  }

  function openLink(url: string) {
    api.shell.openExternal(url).catch(() => {});
  }

  // ── Display helpers ────────────────────────────────────────────────────────

  let folderLabel = $derived.by(() => {
    if (!diag) return "—";
    if (diag.classification.type === "local-folder") return "Plain folder";
    return diag.remoteUrl
      ? "Connected folder (has an online repository)"
      : "Local version history";
  });

  let guidanceCopy = $derived.by(() => {
    if (!diag) return null;
    switch (diag.guidance) {
      case "local-only":
        return "This project lives only on this computer. Everything works without a Git server.";
      case "connect-github-to-sync":
        return "This project's online repository is on GitHub. Use Connect GitHub so print-md can sync for you.";
      case "https-connect-server":
        return "This project's online repository is on a Git server print-md doesn't know yet. Connect that server below to prepare it for syncing.";
      case "ready-to-sync":
        return "This server is connected. Use Sync Changes in the toolbar to send your work to the online repository.";
      case "ssh-use-own-tools":
        return "This project's online address uses SSH (git@…). Everything on this computer works — preview, snapshots, history, restore. To sync, use your usual Git tool.";
    }
  });

  function testLabel(result: RemoteAccessResult): string {
    if (result.ok) {
      const branch = result.defaultBranch ? ` Main version: ${result.defaultBranch}.` : "";
      return `Working — print-md reached the online repository.${branch}`;
    }
    // Defence in depth: the lib's messages are URL-free by construction, but a
    // raw transport string could slip through the catch path — hide any URL
    // (which may carry credentials) and keep the message a readable length.
    const safe = (result.message ?? "")
      .replace(/https?:\/\/\S+/g, "(address hidden)")
      .slice(0, 200)
      .trim();
    return safe || "The connection test failed. See the app log for details.";
  }

  /**
   * M19 — mid-connect dismissal guard: wrapped in `guardedClose` so the
   * backdrop click, the header close button, and Escape (via
   * `dialogBehavior`'s `onClose`) can't dismiss the dialog while a
   * connect-server probe is in flight (previously unguarded on every path).
   */
  const close = guardedClose(() => {
    tokenInput = ""; // belt and braces — never carry a token across closes
    open = false;
    // Focus restoration to `triggerEl` is handled by the dialogBehavior action.
    onClosed?.();
  }, () => connecting);
</script>

{#if open}
  <div class="dlg-backdrop" onclick={close} role="presentation"></div>

  <div
    class="dlg-shell"
    use:dialogBehavior={{ onClose: close, triggerEl, labelledBy: "advanced-setup-title", focusContainer: true }}
    use:onDialogMount
  >
    <header class="dlg-header">
      <h2 id="advanced-setup-title">Advanced setup</h2>
      <button class="dlg-close" onclick={close} disabled={connecting} title="Close (Esc)" aria-label="Close"><Icon name="x" size={16} /></button>
    </header>

    <div class="dialog-body">
      {#if loadError}
        <p class="error" role="alert">{loadError}</p>
      {/if}

      <!-- 1. Environment status -->
      <section aria-labelledby="adv-status-h">
        <h3 id="adv-status-h">This project</h3>
        {#if !projectDir}
          <p class="hint subtle">Open a project folder to see its status here.</p>
        {:else if diagLoading}
          <p class="hint subtle">Checking this folder…</p>
        {:else if diag}
          <dl class="status-grid">
            <dt>Folder</dt>
            <dd>{folderLabel}</dd>
            <dt>Online repository</dt>
            <dd class="mono">{diag.remoteUrl ?? "None"}</dd>
            {#if diag.branch}
              <dt>Branch</dt>
              <dd class="mono">{diag.branch}</dd>
            {/if}
            {#if diag.remoteUrl}
              <dt>Address type</dt>
              <dd>{diag.remoteProtocol === "ssh" ? "SSH (git@…)" : "Web (HTTPS)"}</dd>
              <dt>Server connection</dt>
              <dd>{diag.credentialPresent ? "Saved on this computer" : "Not saved yet"}</dd>
            {/if}
            <dt>GitHub</dt>
            <dd>
              {github?.connected
                ? `Connected${github.username ? ` as @${github.username}` : ""}`
                : "Not connected"}
            </dd>
          </dl>
          {#if guidanceCopy}
            <p class="hint guidance">{guidanceCopy}</p>
          {/if}
          {#if diag.guidance === "ssh-use-own-tools" && diag.provider && diag.provider !== "generic"}
            <p class="hint subtle">
              Tip: this address points at a server print-md can work with. If you
              switch the project's address to the web (HTTPS) form with your Git
              tool, print-md will be able to sync once you connect the server.
            </p>
          {/if}
        {/if}
      </section>

      <!-- 2. Test remote access — explicit click only -->
      {#if projectDir && diag?.remoteUrl}
        <section aria-labelledby="adv-test-h">
          <h3 id="adv-test-h">Test remote access</h3>
          <p class="hint subtle">
            Checks whether print-md can reach this project's online repository.
            Nothing is changed or uploaded.
          </p>
          <div class="test-row">
            <button class="dlg-ghost" onclick={runRemoteTest} disabled={testing}>
              {testing ? "Testing…" : "Test remote access"}
            </button>
            {#if testResult}
              <p
                class="test-result"
                class:ok={testResult.ok}
                class:fail={!testResult.ok}
                role="status"
              >
                {testLabel(testResult)}
              </p>
            {/if}
          </div>
        </section>
      {/if}

      <!-- 3. Connect a Git server (the generic token flow) -->
      <section aria-labelledby="adv-connect-h">
        <h3 id="adv-connect-h">Connect a Git server</h3>
        <p class="hint subtle">
          For Gitea, Forgejo, GitLab, Bitbucket, Azure Repos, or any other Git
          server reachable over the web. You'll need an access token from your
          Git server — a long code that lets print-md act on your behalf.
        </p>
        <label class="field">
          <span>Server address</span>
          <input
            type="text"
            value={serverInput}
            oninput={onServerInput}
            placeholder="git.example.com"
            spellcheck="false"
            autocomplete="off"
          />
        </label>
        {#if tokenUrl}
          <p class="hint subtle">
            Create a token on your server:
            <button type="button" class="link-btn" onclick={() => openLink(tokenUrl!)}>
              open the token settings page
            </button>
          </p>
        {/if}
        <label class="field">
          <span>Username (if your server needs one)</span>
          <input
            type="text"
            bind:value={usernameInput}
            spellcheck="false"
            autocomplete="off"
          />
        </label>
        <label class="field">
          <span>Access token from your Git server</span>
          <!-- "new-password" actually suppresses autofill/save prompts;
               browsers ignore "off" on password fields. -->
          <input
            type="password"
            bind:value={tokenInput}
            spellcheck="false"
            autocomplete="new-password"
          />
        </label>
        {#if connectError}
          <p class="error" role="alert">{connectError}</p>
        {/if}
        {#if connectNotice}
          <p class="hint ok" role="status">{connectNotice}</p>
        {/if}
        <div class="connect-actions">
          <button
            class="dlg-primary app-btn-primary"
            onclick={connectServer}
            disabled={connecting || !serverInput.trim() || !tokenInput.trim()}
          >
            {connecting ? "Checking the connection…" : "Connect server"}
          </button>
        </div>

        {#if connections.length > 0}
          <h4>Connected servers</h4>
          {#if disconnectError}
            <p class="error" role="alert">{disconnectError}</p>
          {/if}
          <ul class="conn-list" role="list" aria-label="Connected servers">
            {#each connections as conn (conn.host)}
              {@const armed = confirmDisconnect[conn.host] ?? false}
              <li role="listitem" class="conn-row">
                <span class="conn-label">
                  {conn.label ?? conn.host}
                  {#if conn.kind === "github-oauth"}<span class="badge">GitHub</span>{/if}
                </span>
                <!-- Two-step confirm (L2) — a single persistent button whose
                     label/class swap in place, so arming never loses focus. -->
                <button
                  class="dlg-ghost small conn-disconnect"
                  class:dlg-danger-armed={armed}
                  onclick={() => requestDisconnect(conn.host)}
                  disabled={disconnecting !== null}
                >
                  {disconnecting === conn.host
                    ? "Removing…"
                    : armed
                      ? "Really disconnect?"
                      : "Disconnect"}
                </button>
                {#if armed}
                  <button class="dlg-ghost small" onclick={(e) => cancelDisconnect(conn.host, e)}>Cancel</button>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <!-- 4. Provider guidance -->
      <section aria-labelledby="adv-providers-h">
        <h3 id="adv-providers-h">Which server do you use?</h3>
        <dl class="provider-list">
          <dt>GitHub</dt>
          <dd>
            Use <strong>Connect GitHub</strong> (in the Open window) — it signs
            you in from your browser with a short code. No tokens to paste.
          </dd>
          <dt>Gitea or Forgejo</dt>
          <dd>
            Create an access token on your server (Settings → Applications),
            then connect the server above. Or clone the repository with your
            usual Git tools and open the folder in print-md.
          </dd>
          <dt>GitLab</dt>
          <dd>
            Create a personal access token (Preferences → Access tokens) with
            read and write access to repositories, then connect the server
            above. Or clone with your usual Git tools and open the folder.
          </dd>
          <dt>Bitbucket</dt>
          <dd>
            Create an app password (Personal settings → App passwords) with
            repository read and write, then connect bitbucket.org above. Or
            clone with your usual Git tools and open the folder.
          </dd>
          <dt>Azure Repos</dt>
          <dd>
            Create a personal access token (User settings → Personal access
            tokens) with Code read &amp; write, then connect dev.azure.com
            above. Or clone with your usual Git tools and open the folder.
          </dd>
          <dt>SSH addresses (git@…)</dt>
          <dd>
            Projects opened from an SSH clone keep every local feature —
            preview, snapshots, history, restore. print-md can't sync over
            SSH, so sync with your usual Git tool, or switch the project to
            the web (HTTPS) address and connect the server here.
          </dd>
        </dl>
      </section>
    </div>
  </div>
{/if}

<style>
  @import "$lib/styles/dialog-shell.css";

  .dlg-shell {
    width: min(560px, 92vw);
    max-height: 84vh;
  }
  .dialog-body {
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 18px;
    overflow-y: auto;
    flex: 1;
  }
  section { display: flex; flex-direction: column; gap: 8px; }
  h3 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--app-text);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  h4 { margin: 10px 0 0; font-size: 12px; font-weight: 600; color: var(--app-text-muted); }
  .hint { font-size: 13px; margin: 0; line-height: 1.5; }
  .hint.subtle { color: var(--app-text-muted); font-size: 12px; }
  .hint.ok { color: var(--app-text); }
  .hint.guidance { color: var(--app-text); }
  .error { color: var(--app-error-text); font-size: 12px; margin: 0; }
  .mono { font-family: var(--app-font-mono); font-size: 12px; word-break: break-all; }
  .link-btn {
    background: none;
    border: 0;
    color: var(--app-focus-ring);
    cursor: pointer;
    font-size: inherit;
    padding: 0;
    text-decoration: underline;
  }
  .status-grid {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 4px 14px;
    margin: 0;
    font-size: 13px;
  }
  .status-grid dt { color: var(--app-text-muted); }
  .status-grid dd { margin: 0; }
  .test-row { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
  .test-result { margin: 0; font-size: 13px; line-height: 1.5; }
  .test-result.ok { color: var(--app-text); }
  .test-result.fail { color: var(--app-error-text); }
  .field { display: flex; flex-direction: column; gap: 6px; }
  .field > span { font-size: 12px; color: var(--app-text-muted); font-weight: 500; }
  .field input {
    background: var(--app-surface-sunken);
    border: 1px solid var(--app-border);
    color: var(--app-text-secondary);
    padding: 8px 10px;
    border-radius: 6px;
    font-size: 13px;
    width: 100%;
    box-sizing: border-box;
  }
  .field input:focus { outline: none; border-color: var(--app-focus-ring); }
  .connect-actions { display: flex; justify-content: flex-end; }
  /* Unlike most dialogs, none of these buttons live in a `.dlg-actions`
     footer (there isn't one here) — `.dlg-primary`/`.dlg-ghost` only get
     color/hover from the shared sheet, so the base sizing normally supplied
     by `.dlg-actions button` needs restating locally.
     FIX ROUND 1: this rule used to restate the color-bearing `border`
     shorthand (`1px solid transparent`), which — because Svelte's scope hash
     raises `.dlg-primary`/`.dlg-ghost` here to two classes (0,2,0) — always
     outranked the shared sheet's `.dlg-ghost` border-color (0,1,0) AND its
     `.dlg-danger-armed` border-color (also 0,1,0), leaving standalone ghosts
     (Test remote access, Disconnect) borderless and the armed "Really
     disconnect?" button missing its red border. Restating only width/style
     here (no color) lets the shared sheet's per-variant rules — including
     `.dlg-danger-armed`, which wins the tie there by source order — supply
     border-color as designed. */
  .dlg-primary,
  .dlg-ghost {
    padding: 6px 14px;
    font-size: 13px;
    border-radius: 4px;
    cursor: pointer;
    border-width: 1px;
    border-style: solid;
  }
  button:disabled { opacity: 0.45; cursor: default; }
  /* Original had no border-radius override for .small (so it inherited the
     base 4px above) — restate it, or the shared sheet's 5px would win. */
  .dlg-ghost.small { padding: 3px 10px; font-size: 12px; border-radius: 4px; }
  .conn-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .conn-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 6px 8px;
    border-radius: 6px;
    background: var(--app-surface-sunken);
    font-size: 13px;
  }
  .conn-label { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .badge {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--app-text-muted);
    border: 1px solid var(--app-border);
    border-radius: 4px;
    padding: 1px 6px;
    flex-shrink: 0;
  }
  .provider-list { margin: 0; font-size: 13px; line-height: 1.5; }
  .provider-list dt { font-weight: 600; color: var(--app-text); margin-top: 8px; }
  .provider-list dt:first-child { margin-top: 0; }
  .provider-list dd { margin: 2px 0 0; color: var(--app-text-secondary); }
</style>
