<script lang="ts">
  /**
   * SyncToolsPanel — the start screen's Troubleshooting → Sync tab: tools for a
   * book whose online backup (Git/GitHub sync) is stuck. First the cheapest
   * fix — Reconnect GitHub, for the expired login that makes every backup
   * fail with a sign-in error (the device flow's success overwrites the
   * stale token, so no disconnect step). Then the tools for the OPEN book —
   * no folder picker: the routes only ever accept the open book, and a
   * picker that offered any folder was how every button 403'd in
   * 0.11.10-alpha.3 — either Repair online backup (swap in a fresh history,
   * keep files, save and back up) or Scorched earth (back up the whole
   * folder, empty it, download a fresh copy, copy the backed-up files back on
   * top, and — as the final step, whether or not the reset worked — close the
   * book, so the app holds no stale state from before the reset).
   *
   * PWA-clean (§8 / ADR 0004): all host work through `api.*`; the GitHub
   * device flow through `getPlatform()` (the interactive-connect seam
   * ConnectionsSettings uses).
   */
  import { onMount } from "svelte";
  import { api } from "$lib/api";
  import { getPlatform } from "$lib/platform";
  import { friendlyHostError, unwrapRouteError } from "$lib/errors";
  import type { DeviceCodeInfo, RemoteConnection } from "$lib/platform/contract";
  import { cancelInlineConfirm, requestInlineConfirm, type InlineConfirmState } from "$lib/dialog";

  let {
    projectDir = null,
    onCloseBook,
  }: {
    /** The open book, if any — the folder every tool below acts on. */
    projectDir?: string | null;
    /** Close the open book. */
    onCloseBook?: () => Promise<boolean>;
  } = $props();

  // ── Reconnect GitHub ──────────────────────────────────────────────────────
  let github = $state<RemoteConnection | null>(null);
  let ghBusy = $state(false);
  let ghCode = $state<DeviceCodeInfo | null>(null);
  let ghMessage = $state<string | null>(null);
  let ghError = $state<string | null>(null);

  async function loadGitHub() {
    try {
      github = await api.remote.getRemoteConnection();
    } catch {
      github = null;
    }
  }

  async function reconnectGitHub() {
    if (ghBusy) return;
    ghBusy = true;
    ghMessage = null;
    ghError = null;
    try {
      const info = await getPlatform().connectGitHubStart();
      ghCode = info;
      api.shell.openExternal(info.verificationUri).catch(() => {});
      await getPlatform().connectGitHubWait();
      ghCode = null;
      await loadGitHub();
      ghMessage = `Signed in to GitHub${github?.username ? ` as @${github.username}` : ""}. Open the book and back up again.`;
    } catch (e) {
      ghError = friendlyHostError(e instanceof Error ? e.message : String(e));
      ghCode = null;
    } finally {
      ghBusy = false;
    }
  }

  onMount(() => {
    void loadGitHub();
    return () => {
      // A device flow left mid-poll must not keep polling after the tab closes.
      if (ghBusy) getPlatform().connectGitHubCancel().catch(() => {});
    };
  });

  // ── Open-book tools ───────────────────────────────────────────────────────
  let running = $state<"repair" | "scorched" | null>(null);
  let confirm = $state<InlineConfirmState>({});
  let message = $state<string | null>(null);
  let errorMessage = $state<string | null>(null);

  async function run(kind: "repair" | "scorched") {
    const dir = projectDir;
    if (!dir) return;
    const { state, confirmed } = requestInlineConfirm(confirm, kind);
    confirm = state;
    if (!confirmed) return;
    running = kind;
    message = null;
    errorMessage = null;
    try {
      if (kind === "repair") {
        const { outcome } = await api.remote.repairOnlineBackup(dir);
        if (outcome.status === "error") errorMessage = outcome.message ?? "The repair didn't finish.";
        else message = "Online backup repaired.";
      } else {
        const r = await api.remote.scorchedEarth(dir);
        message = `Fresh copy downloaded${r.branch ? ` (${r.branch})` : ""} and your files copied back on top. A full copy of the folder as it was is kept at ${r.backupDir}. Open the book and back up to save the result online.`;
      }
    } catch (e) {
      errorMessage = `${unwrapRouteError(e instanceof Error ? e.message : String(e))} See the Logs tab for details.`;
    } finally {
      // Scorched earth's final step: close the book it just reset.
      if (kind === "scorched" && onCloseBook) {
        try {
          if (!(await onCloseBook())) throw new Error("not closed");
          if (message) message += " The open book was closed.";
        } catch {
          errorMessage = "The book couldn't be closed. Close it before you keep working.";
        }
      }
      running = null;
    }
  }
</script>

<div class="sync-tools">
  <p class="intro">Fix a book whose online backup keeps failing.</p>

  <section class="tool">
    <h3>Reconnect GitHub</h3>
    <p class="hint">If backups stopped with a sign-in or permission error, your GitHub login has probably expired. Reconnecting signs you in again and replaces the saved login. Your books and their history are not touched.</p>
    <div class="gh-row">
      <span class="gh-status">
        {#if github?.connected}Connected as {github.username ? `@${github.username}` : "GitHub"}{:else}Not connected{/if}
      </span>
      <button class="app-btn-primary" onclick={() => void reconnectGitHub()} disabled={ghBusy || running !== null}>
        {ghBusy ? "Waiting for GitHub…" : "Reconnect GitHub…"}
      </button>
    </div>
    {#if ghCode}
      <p class="hint code-hint">Enter this code on the GitHub page that opened: <strong class="user-code">{ghCode.userCode}</strong></p>
    {/if}
    {#if ghMessage}<p class="result" role="status">{ghMessage}</p>{/if}
    {#if ghError}<p class="result error" role="alert">{ghError}</p>{/if}
  </section>

  <h3 class="group">This book</h3>
  {#if projectDir}
    <p class="folder-row"><code class="folder">{projectDir}</code></p>
  {:else}
    <p class="hint">Open the book whose backup is failing, then come back here.</p>
  {/if}

  <section class="tool">
    <h3>Repair online backup</h3>
    <p class="hint">Downloads a fresh copy of the online history and puts it under your files. Your files stay as they are; files only the online copy has come back. Then a version is saved and backed up. The old history is kept aside.</p>
    <button
      class="app-btn-primary"
      onclick={() => void run("repair")}
      onblur={() => (confirm = cancelInlineConfirm(confirm, "repair"))}
      disabled={!projectDir || running !== null}
    >{running === "repair" ? "Repairing…" : confirm["repair"] ? "Really repair?" : "Repair online backup"}</button>
  </section>

  <section class="tool danger">
    <h3>Scorched earth</h3>
    <p class="hint">The last resort. Copies the whole folder to a backup, deletes everything in it, downloads a fresh copy from online, then copies your files from the backup back on top (everything except the old history). Your files win; files only the online copy has stay. The backup is never deleted. If that book is open, it is closed at the end.</p>
    <button
      class="danger-btn"
      onclick={() => void run("scorched")}
      onblur={() => (confirm = cancelInlineConfirm(confirm, "scorched"))}
      disabled={!projectDir || running !== null}
    >{running === "scorched" ? "Working…" : confirm["scorched"] ? "Really start over from online?" : "Scorched earth"}</button>
  </section>

  {#if message}<p class="result" role="status">{message}</p>{/if}
  {#if errorMessage}<p class="result error" role="alert">{errorMessage}</p>{/if}
</div>

<style>
  .sync-tools { font-size: 13px; }
  .intro { margin: 0 0 14px; font-size: 12px; color: var(--app-text-muted); }
  .folder-row { margin: 0 0 16px; }
  .folder { font-family: var(--app-font-mono); font-size: 12px; word-break: break-all; }
  .tool {
    padding: 10px 12px;
    border-radius: 6px;
    background: var(--app-surface-raised);
    margin-bottom: 8px;
    border-left: 3px solid var(--app-info-text);
  }
  .tool.danger { border-left-color: var(--app-error-text); }
  .tool h3 { margin: 0 0 6px; font-size: 13px; }
  .group { margin: 18px 0 8px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--app-text-muted); }
  .gh-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .gh-status { font-size: 12px; color: var(--app-text-secondary); }
  .code-hint { margin: 10px 0 0; }
  .user-code { font-family: var(--app-font-mono); font-size: 15px; letter-spacing: 0.1em; color: var(--app-text); }
  .hint { font-size: 12px; color: var(--app-text-muted); margin: 0 0 10px; }
  button { padding: 5px 12px; font-size: 12px; border-radius: 4px; border-width: 1px; border-style: solid; cursor: pointer; }
  button:disabled { opacity: 0.6; cursor: not-allowed; }
  .danger-btn { background: var(--app-error-bg); color: var(--app-error-text); border-color: var(--app-error-text); }
  .result { margin: 12px 0 0; font-size: 12px; overflow-wrap: anywhere; }
  .result.error { color: var(--app-error-text); }
</style>
