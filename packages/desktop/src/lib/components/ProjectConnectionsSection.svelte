<script lang="ts">
  /**
   * ProjectConnectionsSection — Project settings → Connections.
   *
   * The open project's connection details: how the folder is set up, its
   * online repository address, branch, whether a server credential is saved,
   * plus the explicit-click-only Test Remote Access probe. Moved here from
   * the app Settings' Connections (now Accounts) tab (2026-07-30) — accounts
   * are global, but THIS surface is about one project, so it lives with the
   * rest of the project's settings. Credential management stays in
   * Settings → Accounts; the guidance copy points there.
   *
   * PWA-clean (§8): the remote capability module only (SFE-P5c3: remote
   * moved off `api.*` HTTP routes to typed IPC).
   */
  import { onMount } from "svelte";
  import { diagnoseProjectRemote, testRemoteAccess } from "$lib/remote/remote-capability";
  import { friendlyHostError } from "$lib/errors";
  import type { ProjectRemoteDiagnosis, RemoteAccessResult } from "$lib/platform/contract";
  import { isDesktop } from "$lib/platform";

  let {
    projectDir,
    onOpenAccounts,
  }: {
    projectDir: string | null;
    /** Open the app Settings view on the Accounts tab (to connect a server). */
    onOpenAccounts?: () => void;
  } = $props();

  let loading = $state(true);
  let diag = $state<ProjectRemoteDiagnosis | null>(null);

  // Test Remote Access — only ever runs on explicit click.
  let testing = $state(false);
  let testResult = $state<RemoteAccessResult | null>(null);

  onMount(() => {
    void load();
  });

  async function load() {
    if (!isDesktop() || !projectDir) {
      loading = false;
      return;
    }
    loading = true;
    try {
      diag = await diagnoseProjectRemote(projectDir);
    } catch {
      diag = null;
    } finally {
      loading = false;
    }
  }

  async function runRemoteTest() {
    if (!diag?.remoteUrl || testing) return;
    testing = true;
    testResult = null;
    try {
      testResult = await testRemoteAccess(diag.remoteUrl);
    } catch (e) {
      testResult = {
        ok: false,
        reason: "unknown",
        message: friendlyHostError(e instanceof Error ? e.message : String(e)),
      };
    } finally {
      testing = false;
    }
  }

  const folderLabel = $derived.by(() => {
    if (!diag) return "—";
    if (diag.classification.type === "local-folder") return "Plain folder";
    return diag.remoteUrl
      ? "Connected folder (has an online repository)"
      : "Local version history";
  });

  const guidanceCopy = $derived.by(() => {
    if (!diag) return null;
    switch (diag.guidance) {
      case "local-only":
        return "This project lives only on this computer. Everything works without a Git server.";
      case "connect-github-to-sync":
        return "This project's online repository is on GitHub. Connect GitHub in Settings > Accounts so Gutterpress can sync for you.";
      case "https-connect-server":
        return "This project's online repository is on a Git server Gutterpress doesn't know yet. Connect that server in Settings > Accounts to prepare it for syncing.";
      case "ready-to-sync":
        return "This server is connected. Use Sync Changes in the toolbar to send your work to the online repository.";
      case "ssh-use-own-tools":
        return "This project's online address uses SSH (git@…). Everything on this computer works — preview, snapshots, history, restore. To sync, use your usual Git tool.";
    }
  });

  const needsAccounts = $derived(
    diag?.guidance === "connect-github-to-sync" || diag?.guidance === "https-connect-server",
  );

  function testLabel(result: RemoteAccessResult): string {
    if (result.ok) {
      const branch = result.defaultBranch ? ` Main version: ${result.defaultBranch}.` : "";
      return `Working — Gutterpress reached the online repository.${branch}`;
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
</script>

<section class="block project-connections" aria-label="Project connections">
  <h3>Connections</h3>
  {#if !isDesktop()}
    <p class="hint">Connection details are available in the desktop app.</p>
  {:else if loading}
    <p class="hint">Reading this project's connection status…</p>
  {:else if !diag}
    <p class="hint muted">Could not read this folder's status.</p>
  {:else}
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
    </dl>
    {#if guidanceCopy}
      <p class="hint guidance">{guidanceCopy}</p>
    {/if}
    {#if needsAccounts && onOpenAccounts}
      <button class="ghost" onclick={() => onOpenAccounts?.()}>Open account settings…</button>
    {/if}
    {#if diag.guidance === "ssh-use-own-tools" && diag.provider && diag.provider !== "generic"}
      <p class="hint muted">
        Tip: this address points at a server Gutterpress can work with. If you
        switch the project's address to the web (HTTPS) form with your Git
        tool, Gutterpress will be able to sync once you connect the server.
      </p>
    {/if}
    {#if diag.remoteUrl}
      <p class="hint muted">
        Checks whether Gutterpress can reach this project's online repository.
        Nothing is changed or uploaded.
      </p>
      <div class="test-row">
        <button class="ghost" onclick={runRemoteTest} disabled={testing}>
          {testing ? "Testing…" : "Test remote access"}
        </button>
        {#if testResult}
          <p class="test-result" class:ok={testResult.ok} class:fail={!testResult.ok} role="status">
            {testLabel(testResult)}
          </p>
        {/if}
      </div>
    {/if}
  {/if}
</section>

<style>
  @import "$lib/styles/config-section-shared.css";

  .hint { font-size: 11px; line-height: 1.4; color: var(--app-text-muted); margin: 4px 0 8px; }
  .hint.muted { font-style: italic; }
  .hint.guidance { color: var(--app-text); font-size: 12px; }
  /* This-project status grid (ported from the former Advanced setup). */
  .status-grid {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 4px 14px;
    margin: 6px 0 0;
    font-size: 13px;
  }
  .status-grid dt { color: var(--app-text-muted); }
  .status-grid dd { margin: 0; }
  .mono { font-family: var(--app-font-mono); font-size: 12px; word-break: break-all; }
  .test-row { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
  .test-result { margin: 0; font-size: 13px; line-height: 1.5; }
  .test-result.ok { color: var(--app-text); }
  .test-result.fail { color: var(--app-error-text); }
  button.ghost {
    align-self: flex-start;
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
</style>
