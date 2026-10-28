<script lang="ts">
  /**
   * ProjectConnectionsSection — Book setup → Backup: where this book is kept,
   * and the one next step. Six situations (`backupState`, #442), each with one
   * headline and at most one primary button:
   *
   *   no-versions    — a plain folder: Turn on previous versions.
   *   local-only     — versions, no online copy: connect GitHub right here,
   *                    then Back up to GitHub — a new repository or an empty
   *                    one the author made (`api.remote.setUpBackup`, #358).
   *   connect-github — the online copy is on GitHub: connect GitHub here.
   *   connect-server — the online copy is on another server: a token for THAT
   *                    server, whose address comes from the book, never typed.
   *   ready          — access is set up. What it says about the last
   *                    backup comes from the host's last status (the status
   *                    bar's source, live) or a backup run here (`readyView`),
   *                    never from the setup alone. Back up now / Try again run
   *                    the same sync as the status bar's Back up now; a
   *                    rejected sign-in gets the connect step again. With two
   *                    or more copies (git branches), the copy switcher (#273).
   *   own-tools      — an SSH (or other non-https) address.
   *
   * Connection diagnostics and the connection test live in Troubleshooting →
   * Sync, where a failing backup is looked into.
   *
   * PWA-clean (§8): api.* routes, plus getPlatform() for the sync-status stream.
   */
  import { onMount, tick } from "svelte";
  import { api } from "#lib/api.ts";
  import { friendlyHostError } from "#lib/errors.ts";
  import { useSettings } from "#lib/settings.svelte.ts";
  import { suggestRepositoryName } from "#lib/backup-repo-name.ts";
  import { backupFromOutcome, backupState, onlineCopyName, readyView, type LastBackup } from "#lib/backup-state.ts";
  import { combinedFilesMessage, keptBothMessage } from "#lib/routes/sync-controller.svelte.ts";
  import { getPlatform } from "#lib/platform/index.ts";
  import GitHubConnect from "#lib/components/GitHubConnect.svelte";
  import Icon from "#lib/components/Icon.svelte";
  import type { ProjectRemoteDiagnosis, RemoteConnection, RemoteRepository } from "#lib/platform/contract.ts";

  let {
    projectDir,
    onVersionHistoryEnabled,
    onBackupSetUp,
    onProjectFilesChanged,
  }: {
    projectDir: string | null;
    /** Version history was just turned on: the parent re-reads the project's classification so the status bar catches up. */
    onVersionHistoryEnabled?: (projectDir: string) => void;
    /** Online backup was just set up or connected: the parent re-reads the project's state so the status bar catches up. */
    onBackupSetUp?: (projectDir: string) => void;
    /** Another copy was just checked out: the files under `projectDir` changed under the open editor. */
    onProjectFilesChanged?: () => void;
  } = $props();

  const OTHER_SERVER_GUIDE =
    "https://gutterpress.dimm.city/docs/desktop/versions-and-backup/#back-up-to-another-git-server";

  const settings = useSettings();

  let loading = $state(true);
  let diag = $state<ProjectRemoteDiagnosis | null>(null);
  const situation = $derived(diag ? backupState(diag) : null);
  /** What the last action changed ("Connected to git.example.com."). */
  let done = $state<string | null>(null);
  /** The one action of the current situation is running. */
  let busy = $state(false);
  let actionError = $state<string | null>(null);
  // Where focus goes after an action: the button that ran it is disabled or
  // gone, and Escape only reaches Book setup from inside it.
  let sectionEl = $state<HTMLElement>();
  let doneEl = $state<HTMLElement>();
  let errorEl = $state<HTMLElement>();

  // local-only: set up online backup (#358).
  let github = $state<RemoteConnection | null>(null);
  let useExisting = $state(false);
  let repoName = $state("");
  let makePrivate = $state(true);
  let emptyRepos = $state<RemoteRepository[]>([]);
  let reposLoading = $state(false);
  let reposError = $state<string | null>(null);
  let chosenRepo = $state("");

  // connect-server.
  let serverUser = $state("");
  let serverToken = $state("");

  // ready: the last backup — the host's last status, kept live, or one run here.
  let lastBackup = $state<LastBackup | null>(null);
  const ready = $derived(
    diag?.remoteUrl
      ? readyView(onlineCopyName(diag.remoteUrl), lastBackup, settings.current.versionHistory.autoSync, Date.now())
      : null,
  );

  // ready: the copy this book is on (#273).
  let copies = $state<{ current: string | null; branches: string[]; remoteOnly: string[] } | null>(null);
  /** The online check failed, so the list may be missing copies made elsewhere. */
  let copiesStale = $state(false);
  let selectedCopy = $state("");

  onMount(() => {
    void load();
    return getPlatform().onSyncStatus((status) => {
      if (status.projectDir === projectDir && status.source !== "versions") lastBackup = status;
    });
  });

  async function load() {
    if (!projectDir) {
      loading = false;
      return;
    }
    loading = true;
    try {
      diag = await api.remote.diagnoseProjectRemote(projectDir);
    } catch {
      diag = null;
    } finally {
      loading = false;
    }
    if (situation === "local-only") await loadBackupContext(projectDir);
    if (situation === "ready") {
      lastBackup = await api.sync.getStatus(projectDir).catch(() => null);
      // Not awaited: the online check can take a while offline, and nothing waits on the list.
      void loadCopies(projectDir);
    }
  }

  // What the set-up form needs: whether GitHub is connected, and the book's
  // title for the repository name's default. Best-effort — the form still works
  // (with a generic name) if either read fails.
  async function loadBackupContext(dir: string) {
    github = await api.remote.getRemoteConnection().catch(() => null);
    if (repoName) return;
    try {
      repoName = suggestRepositoryName((await api.manifest.read(dir)).title);
    } catch {
      repoName = suggestRepositoryName(null);
    }
  }

  async function chooseExisting(on: boolean) {
    useExisting = on;
    actionError = null;
    if (!on || emptyRepos.length > 0 || reposLoading) return;
    reposLoading = true;
    reposError = null;
    try {
      emptyRepos = (await api.remote.listRemoteRepositories()).filter((r) => r.maybeEmpty);
      if (!chosenRepo && emptyRepos[0]) chosenRepo = emptyRepos[0].fullName;
    } catch (e) {
      reposError = friendlyHostError(e instanceof Error ? e.message : String(e));
    } finally {
      reposLoading = false;
    }
  }

  /** Run the situation's one action: `done` on success, `actionError` on failure; focus follows. */
  async function act(run: (dir: string) => Promise<string | null>) {
    if (!projectDir || busy) return;
    busy = true;
    actionError = null;
    let message: string | null = null;
    try {
      message = await run(projectDir);
      if (message) done = message;
    } catch (e) {
      actionError = friendlyHostError(e instanceof Error ? e.message : String(e));
    } finally {
      busy = false;
    }
    await tick();
    (actionError ? errorEl : message ? doneEl : sectionEl)?.focus();
  }

  const turnOnVersions = () =>
    act(async (dir) => {
      try {
        await api.vcs.enableVersionHistory(dir);
      } catch {
        // The route's own message names an internal operation — say what happened.
        throw new Error("Couldn't turn on previous versions. Your book is unchanged. Try again, and check the app log if it keeps happening.");
      }
      onVersionHistoryEnabled?.(dir);
      await load();
      return "Previous versions are on. The first version is saved.";
    });

  const setUpBackup = () =>
    act(async (dir) => {
      const picked = emptyRepos.find((r) => r.fullName === chosenRepo);
      if (useExisting && !picked) throw new Error("Choose which empty repository to use.");
      const result = await api.remote.setUpBackup(
        dir,
        useExisting
          ? { kind: "existing", owner: picked!.owner, name: picked!.name }
          : { kind: "create", name: repoName.trim(), private: makePrivate },
      );
      if (result.status !== "connected") {
        // The repository was made but the copy failed: it is empty, so keep it
        // selected and let "Try again" reuse it instead of creating a second one.
        if (result.repository) {
          emptyRepos = [result.repository, ...emptyRepos.filter((r) => r.fullName !== result.repository!.fullName)];
          chosenRepo = result.repository.fullName;
          useExisting = true;
        }
        throw new Error(result.message);
      }
      onBackupSetUp?.(dir);
      await load();
      return `Online backup is on. Your book was copied to ${result.repository.fullName} on GitHub${result.repository.private ? " (private)" : ""}.`;
    });

  const connectServer = () =>
    act(async (dir) => {
      if (!diag?.remoteHost) return null;
      const result = await api.remote.connectGenericHost({
        host: diag.remoteHost,
        ...(serverUser.trim() ? { username: serverUser.trim() } : {}),
        token: serverToken,
        // Checked against this book's repository: proves access to it, not just to the server.
        ...(diag.remoteUrl ? { repoUrl: diag.remoteUrl } : {}),
      });
      serverToken = ""; // the token has done its job — never keep it in state
      serverUser = "";
      onBackupSetUp?.(dir);
      await load();
      forgetRejectedSignIn();
      return `Connected to ${result.host}.`;
    });

  const githubConnected = () =>
    act(async (dir) => {
      if (situation === "local-only") {
        await loadBackupContext(dir);
        return null;
      }
      onBackupSetUp?.(dir);
      await load();
      forgetRejectedSignIn();
      return null;
    });

  // A sign-in that was just checked and saved answers the last backup's
  // "didn't accept the saved sign-in"; with automatic backup off nothing else would.
  function forgetRejectedSignIn() {
    if (lastBackup?.state === "auth") lastBackup = null;
  }

  // The status bar's Back up now, run from here: the same sync, its result shown in the headline.
  const backUpNow = () =>
    act(async (dir) => {
      lastBackup = { state: "syncing", lastSyncAt: null };
      const at = () => new Date().toISOString();
      try {
        const outcome = await api.remote.syncChanges(dir);
        lastBackup = backupFromOutcome(outcome, at());
        if (outcome.filesChanged || (outcome.status === "synced" && outcome.mergedRemoteChanges)) onProjectFilesChanged?.();
        if (outcome.status !== "synced" && outcome.status !== "up-to-date") return null;
        const kept = [
          outcome.combinedFiles?.length ? combinedFilesMessage(outcome.combinedFiles) : null,
          outcome.keptBothFiles?.length ? keptBothMessage(outcome.keptBothFiles) : null,
        ].filter(Boolean);
        return kept.length ? kept.join(" ") : null;
      } catch (e) {
        lastBackup = { state: "error", lastSyncAt: at(), message: friendlyHostError(e instanceof Error ? e.message : String(e)) };
        return null;
      }
    });

  /**
   * `listBranches` reads refs off disk, so a copy pushed from somewhere else
   * is invisible until this clone fetches. Refreshing first is what makes a
   * copy created on another machine — or by a pull request opened for you —
   * show up here without dropping to a terminal. Best-effort: offline simply
   * lists what is already on disk.
   */
  async function loadCopies(dir: string, refresh = true) {
    if (refresh) {
      const r = await api.remote.refreshCopies(dir).catch(() => ({ refreshed: false, reason: "offline" as const }));
      copiesStale = !r.refreshed && r.reason !== "no-remote";
    }
    copies = await api.vcs.listBranches(dir).catch(() => null);
    selectedCopy = copies?.current ?? "";
  }

  const switchCopy = () =>
    act(async (dir) => {
      await api.vcs.switchBranch(dir, selectedCopy);
      await loadCopies(dir, false);
      // The workspace reconciles the open editor buffer; the file tree and
      // preview follow the checkout's writes through the folder watcher.
      onProjectFilesChanged?.();
      return null;
    });

  const githubRepo = $derived(diag?.remoteUrl ? onlineCopyName(diag.remoteUrl).replace(/^[^/]*\//, "") : "");
</script>

{#snippet serverForm(host: string, tokenUrl: string | null)}
  <label class="field">
    <span class="lbl">Username (optional)</span>
    <input class="input" bind:value={serverUser} autocomplete="username" spellcheck="false" />
  </label>
  <label class="field">
    <span class="lbl">Access token</span>
    <!-- "new-password" actually suppresses autofill/save prompts; browsers ignore "off" on password fields. -->
    <input class="input" type="password" bind:value={serverToken} autocomplete="new-password" />
  </label>
  <button class="link" onclick={() => void api.shell.openExternal(tokenUrl ?? OTHER_SERVER_GUIDE).catch(() => {})}>
    {tokenUrl ? `Create a token on ${host}` : "How to make an access token"} <Icon name="external-link" size={11} />
  </button>
  <button class="app-btn-primary" onclick={connectServer} disabled={busy || !serverToken.trim()}>
    {busy ? "Checking…" : "Connect"}
  </button>
{/snippet}

<section class="backup" bind:this={sectionEl} tabindex="-1">
  {#if loading}
    <p class="hint">Checking this book's backup…</p>
  {:else if !diag}
    <p class="hint">Couldn't read this book's backup status. <button class="ghost small" onclick={load}>Try again</button></p>
  {:else}
    {#if done}<p class="done" role="status" bind:this={doneEl} tabindex="-1">{done}</p>{/if}

    {#if situation === "no-versions"}
      <p class="headline">Previous versions are off for this book.</p>
      <p class="hint">Turn them on to keep earlier versions on this computer, so you can go back. Nothing is uploaded.</p>
      <button class="app-btn-primary" onclick={turnOnVersions} disabled={busy}>
        {busy ? "Turning on…" : "Turn on previous versions"}
      </button>
    {:else if situation === "local-only"}
      <p class="headline">Saved on this computer only.</p>
      <h3>Back it up online</h3>
      <p class="hint">Keeps a copy of your book, and every earlier version, on GitHub.</p>
      {#if !github?.connected}
        <GitHubConnect primary onConnected={githubConnected} />
      {:else}
        <p class="hint">Signed in to GitHub{github.username ? ` as @${github.username}` : ""}.</p>
        {#if !useExisting}
          <label class="field">
            <span class="lbl">Repository name</span>
            <input class="input" bind:value={repoName} spellcheck="false" autocomplete="off" />
          </label>
          <label class="check">
            <input type="checkbox" bind:checked={makePrivate} />
            Private: only you can see it
          </label>
        {:else if reposLoading}
          <p class="hint">Looking for your empty repositories…</p>
        {:else if reposError}
          <p class="error" role="alert">{reposError}</p>
        {:else if emptyRepos.length === 0}
          <p class="hint">
            No empty repositories found on your GitHub account. Create one on github.com (leave "Add a README"
            off), then come back.
          </p>
          <button class="ghost" onclick={() => void api.shell.openExternal("https://github.com/new").catch(() => {})}>
            Open github.com to create one…
          </button>
        {:else}
          <label class="field">
            <span class="lbl">Empty repository</span>
            <select class="input" bind:value={chosenRepo}>
              {#each emptyRepos as r (r.fullName)}
                <option value={r.fullName}>{r.fullName}{r.private ? " (private)" : ""}</option>
              {/each}
            </select>
          </label>
        {/if}
        <button
          class="app-btn-primary"
          onclick={setUpBackup}
          disabled={busy || (useExisting ? !chosenRepo : !repoName.trim())}
        >
          {busy ? "Setting up…" : actionError ? "Try again" : "Back up to GitHub"}
        </button>
        <button class="link" onclick={() => void chooseExisting(!useExisting)}>
          {useExisting ? "Create a new repository" : "Use an empty repository you already made"}
        </button>
      {/if}
      <p class="hint">
        Another Git server (GitLab, Gitea, Bitbucket…)?
        <button class="link" onclick={() => void api.shell.openExternal(OTHER_SERVER_GUIDE).catch(() => {})}>
          How to back up there <Icon name="external-link" size={11} />
        </button>
      </p>
    {:else if situation === "connect-github"}
      <p class="headline">This book's online copy is on GitHub: {githubRepo}. Connect GitHub to back it up.</p>
      <GitHubConnect primary onConnected={githubConnected} />
    {:else if situation === "connect-server"}
      <p class="headline">This book's online copy is on {diag.remoteHost}. Connect it to back the book up.</p>
      {@render serverForm(diag.remoteHost ?? "", diag.tokenSettingsUrl)}
    {:else if situation === "ready" && ready}
      <p class="headline" class:ok={ready.ok}>
        {#if ready.ok}<Icon name="circle-check" size={15} />{/if}
        {ready.headline}
      </p>
      <p class="hint">{ready.detail}</p>
      {#if ready.action === "back-up" || ready.action === "try-again"}
        <button class="ghost" onclick={backUpNow} disabled={busy}>
          {ready.action === "try-again" ? "Try again" : "Back up now"}
        </button>
      {:else if ready.action === "sign-in"}
        {#if diag.provider === "github"}
          <GitHubConnect primary onConnected={githubConnected} />
        {:else}
          {@render serverForm(diag.remoteHost ?? "", diag.tokenSettingsUrl)}
        {/if}
      {/if}
      <!-- Vocabulary: "copy", never "branch". -->
      {#if copies && copies.branches.length >= 2}
        {@const onlineOnly = new Set(copies.remoteOnly)}
        <div class="copy-row">
          <label for="backup-copy">Copy you're working on</label>
          <select id="backup-copy" class="input" bind:value={selectedCopy} disabled={busy}>
            {#each copies.branches as name (name)}
              <option value={name}>{name}{onlineOnly.has(name) ? " (online only)" : ""}</option>
            {/each}
          </select>
          <button class="ghost" onclick={switchCopy} disabled={busy || selectedCopy === copies.current}>
            {busy ? "Switching…" : "Switch"}
          </button>
        </div>
        {#if copiesStale}
          <p class="hint">Couldn't check online for other copies. This list shows the copies on this computer.</p>
        {/if}
      {/if}
    {:else if diag.remoteProtocol === "ssh"}
      <p class="headline">This book's online copy uses an SSH address (git@…).</p>
      <p class="hint">
        Gutterpress can't back up over SSH. Keep backing up with your usual Git tool, or give the book its https://
        address with that tool and come back here to connect it:
      </p>
      <code>git remote set-url origin https://…</code>
    {:else}
      <p class="headline">This book's online copy is at {diag.remoteUrl}.</p>
      <p class="hint">Gutterpress backs up only to https:// addresses. Keep backing up with your usual Git tool.</p>
    {/if}

    {#if actionError}<p class="error" role="alert" bind:this={errorEl} tabindex="-1">{actionError}</p>{/if}
  {/if}
</section>

<style>
  @import "../styles/config-section-shared.css";

  .backup { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; }
  /* Focus lands on these after an action; they are not controls. */
  .backup, .done, .error { outline: none; }
  .backup .field { align-self: stretch; max-width: 420px; }
  .headline { margin: 0; font-size: 14px; font-weight: 600; line-height: 1.45; color: var(--app-text); }
  .headline.ok { display: inline-flex; align-items: center; gap: 6px; }
  .headline.ok :global(svg) { color: var(--app-success-strong); }
  h3 { margin: 6px 0 0; font-size: 13px; font-weight: 600; color: var(--app-text); }
  .done { margin: 0; font-size: 13px; color: var(--app-success-text); }
  .check { display: flex; gap: 6px; align-items: center; font-size: 13px; }
  .copy-row { display: flex; align-items: center; gap: 8px; font-size: 13px; }
  .copy-row select { width: auto; }
  code { font-family: var(--app-font-mono); font-size: 12px; color: var(--app-text-secondary); }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--app-link);
    font-size: 12px;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .link:hover { color: var(--app-link-hover); }
</style>
