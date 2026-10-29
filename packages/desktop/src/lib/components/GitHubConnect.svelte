<script lang="ts">
  /**
   * GitHubConnect — the one "Connect GitHub…" control (Accounts, where a
   * connected account's is "Sign in again…", and Book setup → Online copy). It runs
   * GitHub's device flow in place: the
   * browser opens, the code to enter is shown with Copy code, Open GitHub
   * again (for a page closed by mistake) and Cancel, and
   * `onConnected` fires once the credential is stored (a second sign-in
   * replaces the saved one). The Open-from-GitHub dialog keeps its own steps.
   *
   * PWA-clean (§8): api.* routes + getPlatform() only.
   */
  import { onMount, tick, type Snippet } from "svelte";
  import { api } from "#lib/api.ts";
  import { getPlatform } from "#lib/platform/index.ts";
  import { friendlyHostError } from "#lib/errors.ts";
  import type { DeviceCodeInfo } from "#lib/platform/contract.ts";

  let {
    primary = false,
    label = "Connect GitHub…",
    onConnected,
    children,
  }: {
    /** The button is the screen's next step (Online copy), not one row among others (Accounts). */
    primary?: boolean;
    label?: string;
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
  onMount(() => () => {
    if (busy) getPlatform().connectGitHubCancel().catch(() => {});
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
      await getPlatform().connectGitHubWait();
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
    <button bind:this={connectBtn} class="app-btn {primary ? 'app-btn-primary' : 'app-btn-ghost'}" onclick={connect} disabled={busy}>
      {busy ? "Waiting for GitHub…" : label}
    </button>
  </div>
  {#if code}
    <p class="gh-code">
      Enter this code on the GitHub page that opened: <strong class="user-code">{code.userCode}</strong>
      <button bind:this={copyBtn} class="app-btn app-btn-ghost" onclick={copyCode}>{copied ? "Copied" : "Copy code"}</button>
      <button class="app-btn app-btn-ghost" onclick={() => code && api.shell.openExternal(code.verificationUri).catch(() => {})}>
        Open GitHub again
      </button>
      <button class="app-btn app-btn-ghost" onclick={cancel}>Cancel</button>
    </p>
  {/if}
  {#if error}<p class="gh-error" role="alert">{error}</p>{/if}
</div>

<style>
  .gh-connect { display: flex; flex-direction: column; gap: 8px; }
  .gh-row { display: flex; align-items: center; gap: 10px; }
  .gh-code { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0; font-size: 13px; color: var(--app-text-secondary); }
  .user-code { font-family: var(--app-font-mono); font-size: 15px; letter-spacing: 0.1em; color: var(--app-text); }
  .gh-error { margin: 0; font-size: 12px; color: var(--app-error-text); }
</style>
