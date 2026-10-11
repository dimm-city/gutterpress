<script lang="ts">
  /**
   * ProjectConnectionsSection — Book settings → Connections.
   *
   * The open project's connection details: how the folder is set up, its
   * online repository address, branch, whether a server credential is saved,
   * plus the explicit-click-only Test Remote Access probe. Accounts are
   * global (Settings → Accounts), but THIS surface is about one project, so it lives with the
   * rest of the project's settings. Credential management stays in
   * Settings → Accounts; the guidance copy points there.
   *
   * #310: a plain folder gets a next step instead of two facts on a blank
   * page — "Turn on version history" (`api.vcs.enableVersionHistory`, the
   * CLAUDE.md §7 escape hatch's other half). After it, the tab reads as any
   * other git-backed project.
   *
   * #358: a book with version history but no online copy gets "Set up online
   * backup" — with a connected GitHub account the author creates a new
   * repository (private by default) or picks an empty one, and the host
   * connects it and pushes the book's history (`api.remote.setUpBackup`).
   * Afterwards the book is the same as one opened from GitHub.
   *
   * PWA-clean (§8): api.* routes only.
   */
  import { onMount } from "svelte";
  import { api } from "$lib/api";
  import { friendlyHostError } from "$lib/errors";
  import { suggestRepositoryName } from "$lib/backup-repo-name";
  import type {
    ProjectRemoteDiagnosis,
    RemoteAccessResult,
    RemoteConnection,
    RemoteRepository,
  } from "$lib/platform/contract";

  let {
    projectDir,
    onOpenAccounts,
    onVersionHistoryEnabled,
    onBackupSetUp,
  }: {
    projectDir: string | null;
    /** Open the app Settings view on the Accounts tab (to connect a server). */
    onOpenAccounts?: () => void;
    /** Version history was just turned on: the parent re-reads the project's classification so the status bar catches up. */
    onVersionHistoryEnabled?: (projectDir: string) => void;
    /** Online backup was just set up: the parent re-reads the project's classification so the status bar catches up. */
    onBackupSetUp?: (projectDir: string) => void;
  } = $props();

  let loading = $state(true);
  let diag = $state<ProjectRemoteDiagnosis | null>(null);

  // Turn on version history — only ever offered for a plain folder.
  let enabling = $state(false);
  let justEnabled = $state(false);
  let enableError = $state<string | null>(null);

  // Set up online backup (#358) — offered to a versioned book with no online copy.
  let github = $state<RemoteConnection | null>(null);
  let backupMode = $state<"create" | "existing">("create");
  let repoName = $state("");
  let makePrivate = $state(true);
  let emptyRepos = $state<RemoteRepository[]>([]);
  let reposLoading = $state(false);
  let reposError = $state<string | null>(null);
  let chosenRepo = $state("");
  let settingUp = $state(false);
  let backupError = $state<string | null>(null);
  let backupDone = $state<string | null>(null);

  // Test Remote Access — only ever runs on explicit click.
  let testing = $state(false);
  let testResult = $state<RemoteAccessResult | null>(null);

  onMount(() => {
    void load();
  });

  async function load() {
    if (!projectDir) {
      loading = false;
      return;
    }
    loading = true;
    try {
      diag = await (api.remote.diagnoseProjectRemote(projectDir) as Promise<ProjectRemoteDiagnosis>);
    } catch {
      diag = null;
    } finally {
      loading = false;
    }
    if (canSetUpBackup) await loadBackupContext(projectDir);
  }

  // What the set-up form needs: whether GitHub is connected, and the book's
  // title for the repository name's default. Best-effort — the form still works
  // (with a generic name) if either read fails.
  async function loadBackupContext(dir: string) {
    try {
      github = await api.remote.getRemoteConnection();
    } catch {
      github = null;
    }
    if (repoName) return;
    try {
      repoName = suggestRepositoryName((await api.manifest.read(dir)).title);
    } catch {
      repoName = suggestRepositoryName(null);
    }
  }

  async function chooseBackupMode(mode: "create" | "existing") {
    backupMode = mode;
    backupError = null;
    if (mode !== "existing" || emptyRepos.length > 0 || reposLoading) return;
    reposLoading = true;
    reposError = null;
    try {
      const all = await api.remote.listRemoteRepositories();
      emptyRepos = all.filter((r) => r.maybeEmpty);
      if (!chosenRepo && emptyRepos[0]) chosenRepo = emptyRepos[0].fullName;
    } catch (e) {
      reposError = friendlyHostError(e instanceof Error ? e.message : String(e));
    } finally {
      reposLoading = false;
    }
  }

  async function setUpBackup() {
    if (!projectDir || settingUp) return;
    const picked = emptyRepos.find((r) => r.fullName === chosenRepo);
    if (backupMode === "existing" && !picked) {
      backupError = "Choose which empty repository to use.";
      return;
    }
    settingUp = true;
    backupError = null;
    backupDone = null;
    try {
      const result = await api.remote.setUpBackup(
        projectDir,
        backupMode === "create"
          ? { kind: "create", name: repoName.trim(), private: makePrivate }
          : { kind: "existing", owner: picked!.owner, name: picked!.name },
      );
      if (result.status === "connected") {
        backupDone = `Online backup is on. Your book was copied to ${result.repository.fullName} on GitHub${result.repository.private ? " (private)" : ""}.`;
        onBackupSetUp?.(projectDir);
        await load();
      } else {
        backupError = result.message;
        // The repository was made but the copy failed: it is empty, so keep it
        // selected and let "Try again" reuse it instead of creating a second one.
        if (result.repository) {
          emptyRepos = [result.repository, ...emptyRepos.filter((r) => r.fullName !== result.repository!.fullName)];
          chosenRepo = result.repository.fullName;
          backupMode = "existing";
        }
      }
    } catch (e) {
      backupError = friendlyHostError(e instanceof Error ? e.message : String(e));
    } finally {
      settingUp = false;
    }
  }

  async function runRemoteTest() {
    if (!diag?.remoteUrl || testing) return;
    testing = true;
    testResult = null;
    try {
      testResult = (await api.remote.testRemoteAccess(diag.remoteUrl)) as RemoteAccessResult;
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

  // Give a plain folder its history. The parent is told so the status bar's
  // cached classification catches up; the tab then re-reads its own diagnosis
  // and shows the folder as version-history-backed.
  async function turnOnVersionHistory() {
    if (!projectDir || enabling) return;
    enabling = true;
    enableError = null;
    try {
      await api.vcs.enableVersionHistory(projectDir);
      justEnabled = true;
      onVersionHistoryEnabled?.(projectDir);
      await load();
    } catch {
      // The route's own message is a raw JSON envelope naming an internal
      // operation — say what happened in plain words instead.
      enableError =
        "Couldn't turn on version history. Your book is unchanged — try again, and check the app log if it keeps happening.";
    } finally {
      enabling = false;
    }
  }

  const isPlainFolder = $derived(diag?.classification.type === "local-folder");

  // A versioned book with no online copy yet — the one shape #358 sets up.
  const canSetUpBackup = $derived(
    !!diag && !isPlainFolder && !diag.remoteUrl && diag.guidance === "local-only",
  );

  const folderLabel = $derived.by(() => {
    if (!diag) return "—";
    if (isPlainFolder) return "Plain folder";
    return diag.remoteUrl
      ? "Connected folder (has an online repository)"
      : "Local version history";
  });

  const guidanceCopy = $derived.by(() => {
    if (!diag) return null;
    switch (diag.guidance) {
      case "local-only":
        return isPlainFolder
          ? "Version history is off. Turn it on to keep previous versions of your book on this computer, so you can go back to an earlier one. Nothing is uploaded."
          : "This book lives only on this computer. Everything works without a Git server.";
      case "connect-github-to-sync":
        return "This book's online repository is on GitHub. Connect GitHub in Settings > Accounts so Gutterpress can sync for you.";
      case "https-connect-server":
        return "This book's online repository is on a Git server Gutterpress doesn't know yet. Connect that server in Settings > Accounts to prepare it for syncing.";
      case "ready-to-sync":
        return "This server is connected. To back up your work online, click the save status at the bottom of the window and choose Back up now.";
      case "ssh-use-own-tools":
        return "This book's online address uses SSH (git@…). Everything on this computer works — preview, versions, history, restore. To sync, use your usual Git tool.";
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

<section class="block project-connections" aria-label="Book connections">
  <h3>Connections</h3>
  {#if loading}
    <p class="hint">Reading this book's connection status…</p>
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
    {#if justEnabled}
      <p class="hint guidance" role="status">Version history is on — the first version of your book is saved.</p>
    {/if}
    {#if backupDone}
      <p class="hint guidance" role="status">{backupDone}</p>
    {/if}
    {#if guidanceCopy}
      <p class="hint guidance">{guidanceCopy}</p>
    {/if}
    {#if isPlainFolder}
      <button class="primary app-btn-primary" onclick={turnOnVersionHistory} disabled={enabling}>
        {enabling ? "Turning on…" : "Turn on version history"}
      </button>
      {#if enableError}
        <p class="test-result fail" role="alert">{enableError}</p>
      {/if}
    {/if}
    {#if isPlainFolder}
      <p class="hint muted">
        Online backup copies your saved versions to GitHub, so it needs version history first.
      </p>
    {/if}
    {#if canSetUpBackup}
      <div class="backup" aria-label="Set up online backup">
        <h4>Set up online backup</h4>
        {#if !github?.connected}
          <p class="hint">
            Online backup keeps a copy of your book, and every earlier version, on your GitHub account.
            Connect GitHub first.
          </p>
          {#if onOpenAccounts}
            <button class="primary app-btn-primary" onclick={() => onOpenAccounts?.()}>Connect GitHub…</button>
          {/if}
        {:else}
          <p class="hint">
            Signed in to GitHub{github.username ? ` as ${github.username}` : ""}. Your book and its earlier
            versions will be copied there.
          </p>
          <div class="mode-row" role="radiogroup" aria-label="Where to keep the online copy">
            <label>
              <input type="radio" name="backup-mode" checked={backupMode === "create"} onchange={() => void chooseBackupMode("create")} />
              Create a new repository
            </label>
            <label>
              <input type="radio" name="backup-mode" checked={backupMode === "existing"} onchange={() => void chooseBackupMode("existing")} />
              Use an empty repository I already made
            </label>
          </div>
          {#if backupMode === "create"}
            <label class="field" for="backup-repo-name">
              <span class="lbl">Repository name</span>
              <input id="backup-repo-name" class="input" bind:value={repoName} spellcheck="false" autocomplete="off" />
            </label>
            <label class="check">
              <input type="checkbox" bind:checked={makePrivate} />
              Keep it private (only you can see it)
            </label>
          {:else if reposLoading}
            <p class="hint">Looking for your empty repositories…</p>
          {:else if reposError}
            <p class="test-result fail" role="alert">{reposError}</p>
          {:else if emptyRepos.length === 0}
            <p class="hint">
              No empty repositories found on your GitHub account. Create one on github.com (leave "Add a README"
              off), then come back.
            </p>
            <button class="ghost" onclick={() => void api.shell.openExternal("https://github.com/new").catch(() => {})}>
              Open github.com to create one…
            </button>
          {:else}
            <label class="field" for="backup-existing-repo">
              <span class="lbl">Empty repository</span>
              <select id="backup-existing-repo" class="input" bind:value={chosenRepo}>
                {#each emptyRepos as r (r.fullName)}
                  <option value={r.fullName}>{r.fullName}{r.private ? " (private)" : ""}</option>
                {/each}
              </select>
            </label>
          {/if}
          <button
            class="primary app-btn-primary"
            onclick={setUpBackup}
            disabled={settingUp || (backupMode === "create" && !repoName.trim()) || (backupMode === "existing" && !chosenRepo)}
          >
            {settingUp ? "Setting up…" : backupError ? "Try again" : "Set up online backup"}
          </button>
          {#if backupError}
            <p class="test-result fail" role="alert">{backupError}</p>
          {/if}
        {/if}
      </div>
    {/if}
    {#if needsAccounts && onOpenAccounts}
      <button class="ghost" onclick={() => onOpenAccounts?.()}>Open account settings…</button>
    {/if}
    {#if diag.guidance === "ssh-use-own-tools" && diag.provider && diag.provider !== "generic"}
      <p class="hint muted">
        Tip: this address points at a server Gutterpress can work with. If you
        switch the book's address to the web (HTTPS) form with your Git
        tool, Gutterpress will be able to sync once you connect the server.
      </p>
    {/if}
    {#if diag.remoteUrl}
      <p class="hint muted">
        Checks whether Gutterpress can reach this book's online repository.
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
  /* This-project status grid. */
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
  .backup { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; margin-top: 12px; }
  .backup h4 { margin: 0; font-size: 13px; }
  .backup .field { align-self: stretch; }
  .mode-row { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
  .mode-row label, .check { display: flex; gap: 6px; align-items: center; font-size: 13px; }
  .test-row { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
  .test-result { margin: 0; font-size: 13px; line-height: 1.5; }
  .test-result.ok { color: var(--app-text); }
  .test-result.fail { color: var(--app-error-text); }
  /* The primary colors come from the shared .app-btn-primary recipe (theme.css). */
  button.primary { align-self: flex-start; }
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
