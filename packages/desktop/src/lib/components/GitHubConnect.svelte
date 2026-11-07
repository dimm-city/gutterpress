<script lang="ts">
  /**
   * GitHubConnect — the one "Connect GitHub…" control (Accounts, where a
   * connected account's is "Sign in again…", the backup wizard and Book setup →
   * Backup & history). It runs GitHub's device flow in place: the browser
   * opens, the code to type there is shown big ("We opened GitHub in your
   * browser. Type this code there, then come back.") with Copy code, Open
   * GitHub again (for a page closed by mistake) and Cancel, and
   * `onConnected` fires once the credential is stored (a second sign-in
   * replaces the saved one). The Open-from-GitHub dialog keeps its own steps.
   *
   * PWA-clean (§8): api.* routes + getPlatform() only.
   */
  import { onMount, tick, type Snippet } from "svelte";
  import { api } from "#lib/api.ts";
  import { getPlatform } from "#lib/platform/index.ts";
  import { friendlyHostError } from "#lib/errors.ts";
  import { prefetchRepositories } from "#lib/routes/repo-list-cache.ts";
  import type { DeviceCodeInfo } from "#lib/platform/contract.ts";

  let {
    primary = false,
    label = "Connect GitHub…",
    autoStart = false,
    onConnected,
    children,
  }: {
    /** The button is the screen's next step (Online copy), not one row among others (Accounts). */
    primary?: boolean;
    label?: string;
    /** Start the sign-in as soon as this shows (a wizard step whose one job is signing in). */
    autoStart?: boolean;
    onConnected?: () => void;
    /** What sits before the button on its row (Accounts: the name, status and the row's other buttons). */
    children?: Snippet;
  } = $props();

  let busy = $state(false);
  let code = $state<DeviceCodeInfo | null>(null);
  let copied = $state(false);
  let error = $state<string | null>(null);
  // Bumped by Cancel, so the aborted attempt's rejection is not shown as an error.
  let attempt = 0;
  // Focus follows the flow: the disabled button can't hold it, and a removed
  // one drops it to <body>, where Escape no longer reaches the sheet.
  let connectBtn = $state<HTMLButtonElement>();
  let copyBtn = $state<HTMLButtonElement>();

  // A device flow left mid-poll must not keep polling after the view closes.
  onMount(() => {
    if (autoStart) void connect();
    return () => {
      if (busy) getPlatform().connectGitHubCancel().catch(() => {});
    };
  });

  async function connect() {
    if (busy) return;
    const mine = ++attempt;
    busy = true;
    error = null;
    try {
      code = await getPlatform().connectGitHubStart();
      api.shell.openExternal(code.verificationUri).catch(() => {});
      void tick().then(() => copyBtn?.focus());
      const conn = await getPlatform().connectGitHubWait();
      // The list of online copies is what the next step usually needs: have it ready.
      prefetchRepositories(conn?.username ?? "");
      if (mine === attempt) onConnected?.();
    } catch (e) {
      if (mine === attempt) error = friendlyHostError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mine === attempt) stop();
    }
  }

  function stop() {
    busy = false;
    code = null;
    copied = false;
    void tick().then(() => connectBtn?.focus());
  }

  function cancel() {
    attempt++;
    stop();
    getPlatform().connectGitHubCancel().catch(() => {});
  }

  async function copyCode() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code.userCode);
      copied = true;
    } catch {
      // The code stays on screen to type in.
    }
  }
</script>

<div class="gh-connect">
  <div class="gh-row">
    {@render children?.()}
    {#if !(autoStart && busy)}
      <!-- A step whose one job is signing in shows the code alone while it waits, not a disabled button above it. -->
      <button bind:this={connectBtn} class="app-btn {primary ? 'app-btn-primary' : 'app-btn-ghost'}" onclick={connect} disabled={busy}>
        {busy ? "Waiting for you…" : label}
      </button>
    {/if}
  </div>
  {#if code}
    <div class="gh-code">
      <p class="gh-lead">We opened GitHub in your browser. Type this code there, then come back.</p>
      <strong class="user-code">{code.userCode}</strong>
      <div class="gh-buttons">
        <button bind:this={copyBtn} class="app-btn app-btn-ghost" onclick={copyCode}>{copied ? "Copied" : "Copy code"}</button>
        <button class="app-btn app-btn-ghost" onclick={() => code && api.shell.openExternal(code.verificationUri).catch(() => {})}>
          Open GitHub again
        </button>
        <button class="app-btn app-btn-ghost" onclick={cancel}>{autoStart ? "Stop waiting" : "Cancel"}</button>
      </div>
    </div>
  {/if}
  {#if autoStart && busy}
    <p class="gh-wait" role="status"><span class="spin" aria-hidden="true"></span> {code ? "Waiting for you…" : "Contacting GitHub…"}</p>
  {/if}
  {#if error}<p class="gh-error" role="alert">{error}</p>{/if}
</div>

<style>
  .gh-connect { display: flex; flex-direction: column; gap: 8px; }
  .gh-row { display: flex; align-items: center; gap: 10px; }
  .gh-code { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; font-size: 13px; color: var(--app-text-secondary); }
  .gh-lead { margin: 0; }
  .gh-wait { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 13px; color: var(--app-text-muted); }
  .spin {
    width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--app-border); border-top-color: var(--app-accent);
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .gh-buttons { display: flex; flex-wrap: wrap; gap: 8px; }
  .user-code {
    font-family: var(--app-font-mono); font-size: 26px; font-weight: 700; letter-spacing: 0.14em; color: var(--app-text);
    padding: 8px 16px; border: 1px dashed var(--app-border); border-radius: 8px; background: var(--app-surface-sunken); user-select: all;
  }
  .gh-error { margin: 0; font-size: 12px; color: var(--app-error-text); }
</style>
