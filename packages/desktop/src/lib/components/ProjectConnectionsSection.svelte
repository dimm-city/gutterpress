<script lang="ts">
  /**
   * ProjectConnectionsSection — Book setup → Online copy: the one place for
   * where this book is kept, from top to bottom:
   *
   *   1. Status — one headline and at most one primary button, from six
   *      situations (`backupState`, #442):
   *        no-versions    — a plain folder: Turn on version history.
   *        local-only     — versions, no online copy: Keep this book safe
   *                         online… (connect GitHub, then create a new online
   *                         copy or use an empty one the author made,
   *                         `api.remote.setUpBackup`, #358).
   *        connect-github — the online copy is on GitHub: sign in here.
   *        connect-server — the online copy is on another server: a token for
   *                         THAT server, whose address comes from the book,
   *                         never typed.
   *        ready          — access is set up. What it says about the last
   *                         backup comes from the host's last status (live,
   *                         the sync controller's `backup`) or a Back up now
   *                         run here (`readyView`), never from the setup
   *                         alone. Back up now / Try again run the page's
   *                         Back up now (`onBackUpNow`); a rejected sign-in
   *                         gets the sign-in step again.
   *        own-tools      — an SSH (or other non-https) address.
   *      Then one line about this computer ("Saved · last version 10 minutes
   *      ago") with Save a version and Version history….
   *   2. Revisions (RevisionsList), whenever version history is on.
   *   3. If backing up keeps failing (ready), collapsed: Test connection (a
   *      read-only probe of this book's online copy; the GitHub sign-in itself
   *      is tested in Accounts), Repair the online copy (`onRepair`: fresh
   *      versions under the files, then a backup), Start over from the online
   *      copy (`api.remote.scorchedEarth`: keep a safety folder, empty the
   *      folder, download the online copy, put the files back on top and —
   *      whether or not that worked — close the book, so the app holds no
   *      stale state; Book setup closes with it, so the outcome is a toast)
   *      and Sign in again (Accounts) for GitHub books.
   *
   * PWA-clean (§8): api.* routes only.
   */
  import { onMount, tick } from "svelte";
  import { api } from "#lib/api.ts";
  import { friendlyHostError, unwrapRouteError } from "#lib/errors.ts";
  import { cancelInlineConfirm, requestInlineConfirm, type InlineConfirmState } from "#lib/dialog.ts";
  import { useSettings } from "#lib/settings.svelte.ts";
  import { suggestRepositoryName } from "#lib/backup-repo-name.ts";
  import { backupState, onlineCopyName, readyView, type LastBackup } from "#lib/backup-state.ts";
  import { NOTHING_NEW_NOTICE, versionsLine } from "#lib/save-status.ts";
  import GitHubConnect from "#lib/components/GitHubConnect.svelte";
  import GitServerForm, { OTHER_SERVER_GUIDE } from "#lib/components/GitServerForm.svelte";
  import Icon from "#lib/components/Icon.svelte";
  import RevisionsList from "#lib/components/RevisionsList.svelte";
  import type { ToastController } from "#lib/components/Toast.svelte";
  import type { ProjectRemoteDiagnosis, RemoteAccessResult, RemoteConnection, RemoteRepository } from "#lib/platform/contract.ts";

  let {
    projectDir,
    backup = null,
    versionsProblem = null,
    onVersionHistoryEnabled,
    onBackupSetUp,
    onProjectFilesChanged,
    onBackUpNow,
    onRepair,
    onSaveVersion,
    onShowVersions,
    onCloseBook,
    onOpenAccounts,
    toast = null,
  }: {
    projectDir: string | null;
    /** The online copy's last word for this book: the host's status stream or the last Back up now. */
    backup?: LastBackup | null;
    /** Automatic versions keep failing, and why (the host said so). */
    versionsProblem?: { message: string | null } | null;
    /** Version history was just turned on: the parent re-reads the project's classification so the status bar catches up. */
    onVersionHistoryEnabled?: (projectDir: string) => void;
    /** The online copy was just set up or signed in to: the parent re-reads the project's state so the status bar catches up. */
    onBackupSetUp?: (projectDir: string) => void;
    /** Another revision was just opened, made or renamed: the files under `projectDir` changed under the open editor. */
    onProjectFilesChanged?: () => void;
    /** Back up now: the page's own backup (its toasts and editor refresh). */
    onBackUpNow?: () => Promise<void>;
    /** Repair the online copy: the page's repair (its toasts and editor refresh). */
    onRepair?: () => Promise<void>;
    /** Save a version now: the page's own save (its toast); resolves "unchanged" when there was nothing new. */
    onSaveVersion?: () => Promise<"saved" | "unchanged">;
    /** Version history…: the parent closes Book setup and opens the view. */
    onShowVersions?: () => void;
    /** Close the open book: Start over from the online copy ends with it. */
    onCloseBook?: () => Promise<boolean>;
    /** Open the Accounts page, over this one. */
    onOpenAccounts?: () => void;
    /** Start over's outcome: Book setup closes with the book, so it is a toast. */
    toast?: ToastController | null;
  } = $props();

  const settings = useSettings();

  let loading = $state(true);
  let diag = $state<ProjectRemoteDiagnosis | null>(null);
  const situation = $derived(diag ? backupState(diag) : null);
  /** What the last action changed ("Signed in to git.example.com."). */
  let done = $state<string | null>(null);
  /** The one action of the current situation is running. */
  let busy = $state(false);
  let running = $state<"back-up" | "repair" | "start-over" | null>(null);
  let confirm = $state<InlineConfirmState>({});
  let actionError = $state<string | null>(null);
  // Where focus goes after an action: the button that ran it is disabled or
  // gone, and Escape only reaches Book setup from inside it.
  let sectionEl = $state<HTMLElement>();
  let doneEl = $state<HTMLElement>();
  let errorEl = $state<HTMLElement>();

  // local-only: set up an online copy (#358).
  let settingUp = $state(false);
  let github = $state<RemoteConnection | null>(null);
  let useExisting = $state(false);
  let repoName = $state("");
  let makePrivate = $state(true);
  let emptyRepos = $state<RemoteRepository[]>([]);
  let reposLoading = $state(false);
  let reposError = $state<string | null>(null);
  let chosenRepo = $state("");

  // ready: the last backup, from the host's status (kept live) or one run here.
  const ready = $derived(
    diag?.remoteUrl
      ? readyView(onlineCopyName(diag.remoteUrl), backup, settings.current.versionHistory.autoSync, Date.now())
      : null,
  );

  // This computer: the newest version and what has changed since.
  let facts = $state<{ lastVersionAt: number | null; changedFiles: number | null; stale: boolean } | null>(null);
  let nothingNew = $state(false);
  let savingVersion = $state(false);
  let revisionsEl = $state<{ refresh: () => void }>();

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
      diag = await api.remote.diagnoseProjectRemote(projectDir);
    } catch {
      diag = null;
    } finally {
      loading = false;
    }
    if (situation === "local-only") await loadBackupContext(projectDir);
    if (situation && situation !== "no-versions") void loadFacts(projectDir);
  }

  /** Best-effort: the line says nothing rather than guessing when the lookup fails. */
  async function loadFacts(dir: string) {
    try {
      const [page, pending] = await Promise.all([api.vcs.listSnapshotsPage(dir, { limit: 1 }), api.vcs.unversionedChanges(dir)]);
      facts = { lastVersionAt: page.entries[0]?.timestamp ?? null, changedFiles: pending.changedFiles, stale: pending.stale };
      if ((pending.changedFiles ?? 0) > 0) nothingNew = false;
    } catch {
      facts = null;
    }
  }

  // What the set-up form needs: whether GitHub is connected, and the book's
  // title for the online copy's default name. Best-effort — the form still works
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
        throw new Error("Couldn't turn on version history. Your book is unchanged. Try again, and check the app log if it keeps happening.");
      }
      onVersionHistoryEnabled?.(dir);
      await load();
      return "Version history is on. The first version is saved.";
    });

  const setUpBackup = () =>
    act(async (dir) => {
      const picked = emptyRepos.find((r) => r.fullName === chosenRepo);
      if (useExisting && !picked) throw new Error("Choose which empty online copy to use.");
      const result = await api.remote.setUpBackup(
        dir,
        useExisting
          ? { kind: "existing", owner: picked!.owner, name: picked!.name }
          : { kind: "create", name: repoName.trim(), private: makePrivate },
      );
      if (result.status !== "connected") {
        // The online copy was made but sending the book failed: it is empty, so keep it
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
      return `Your online copy is set up. Your book was sent to ${result.repository.fullName} on GitHub${result.repository.private ? " (private)" : ""}.`;
    });

  // The server accepted the token (GitServerForm checked it against this book's online copy
  // and saved it): the book is now set up to back up there.
  const serverConnected = (result: { host: string }) =>
    act(async (dir) => {
      onBackupSetUp?.(dir);
      await load();
      return `Signed in to ${result.host}.`;
    });

  const githubConnected = () =>
    act(async (dir) => {
      if (situation === "local-only") {
        await loadBackupContext(dir);
        return null;
      }
      onBackupSetUp?.(dir);
      await load();
      return null;
    });

  // The page's Back up now, run from here; the sync controller's `backup` is the headline.
  const backUpNow = () =>
    act(async () => {
      running = "back-up";
      await onBackUpNow?.();
      running = null;
      revisionsEl?.refresh();
      if (projectDir) void loadFacts(projectDir);
      return null;
    });

  // Save a version: the page saves and toasts; this line catches up.
  async function saveVersion() {
    if (!projectDir || !onSaveVersion || savingVersion) return;
    savingVersion = true;
    try {
      nothingNew = (await onSaveVersion()) === "unchanged";
      await loadFacts(projectDir);
    } catch {
      // The page shows the failure toast.
    } finally {
      savingVersion = false;
    }
  }

  /** Another revision is open (or renamed): the files and the newest version may have changed. */
  function revisionsChanged() {
    onProjectFilesChanged?.();
    if (projectDir) void loadFacts(projectDir);
  }

  // ── A backup that keeps failing (ready) ────────────────────────────────────
  // Test connection: read-only, so it runs on one click with no confirm.
  let testing = $state(false);
  let testResult = $state<string | null>(null);
  let testOk = $state(false);

  async function testConnection() {
    if (!diag?.remoteUrl || testing) return;
    testing = true;
    testResult = null;
    try {
      const result = await api.remote.testRemoteAccess(diag.remoteUrl);
      testOk = result.ok;
      testResult = testLabel(result);
    } catch (e) {
      testOk = false;
      testResult = testLabel({ ok: false, reason: "unknown", message: friendlyHostError(unwrapRouteError(e instanceof Error ? e.message : String(e))) });
    } finally {
      testing = false;
    }
  }

  function testLabel(result: RemoteAccessResult): string {
    if (result.ok) {
      const main = result.defaultBranch ? ` Main revision: ${result.defaultBranch}.` : "";
      return `Working — Gutterpress reached the online copy.${main}`;
    }
    // Defence in depth: the lib's messages are URL-free by construction, but a
    // raw transport string could slip through the catch path — hide any URL
    // (which may carry credentials) and keep the message a readable length.
    const safe = result.message
      .replace(/https?:\/\/\S+/g, "(address hidden)")
      .slice(0, 200)
      .trim();
    return safe || "The test failed. See Troubleshooting > Logs for details.";
  }

  // Repair and Start over arm in place and run on the second click.
  async function repair() {
    const { state, confirmed } = requestInlineConfirm(confirm, "repair");
    confirm = state;
    if (!confirmed) return;
    running = "repair";
    await act(async () => {
      await onRepair?.();
      return null;
    });
    running = null;
    revisionsEl?.refresh();
  }

  async function startOver() {
    const dir = projectDir;
    // Read now: closing the book unmounts this view before the outcome is shown.
    const notify = toast;
    const { state, confirmed } = requestInlineConfirm(confirm, "start-over");
    confirm = state;
    if (!confirmed || !dir || busy) return;
    busy = true;
    running = "start-over";
    let message: string | null = null;
    let failure: string | null = null;
    try {
      const r = await api.remote.scorchedEarth(dir);
      message = `Started over from the online copy${r.branch ? ` (${r.branch})` : ""}, with your files put back on top. A safety folder with everything as it was is kept at ${r.backupDir}. Open the book and back up to save the result.`;
    } catch (e) {
      failure = `${unwrapRouteError(e instanceof Error ? e.message : String(e))} See Troubleshooting > Logs for details.`;
    }
    // The final step, whether or not the reset worked: close the book it reset.
    let closed = false;
    try {
      closed = (await onCloseBook?.()) ?? false;
    } catch {
      closed = false;
    }
    busy = false;
    running = null;
    if (!closed) failure = `${failure ? `${failure} ` : ""}The book couldn't be closed. Close it before you keep working.`;
    if (failure) notify?.error(failure);
    else if (message) notify?.success(message);
  }

  const githubRepo = $derived(diag?.remoteUrl ? onlineCopyName(diag.remoteUrl).replace(/^[^/]*\//, "") : "");
</script>

<section class="online-copy" bind:this={sectionEl} tabindex="-1">
  {#if loading}
    <p class="hint">Checking this book's online copy…</p>
  {:else if !diag}
    <p class="hint">Couldn't read this book's online copy status. <button class="ghost small" onclick={load}>Try again</button></p>
  {:else}
    {#if done}<p class="done" role="status" bind:this={doneEl} tabindex="-1">{done}</p>{/if}

    {#if situation === "no-versions"}
      <p class="headline">Version history is off for this book.</p>
      <p class="hint">Turn it on to keep earlier versions on this computer, so you can go back. Nothing is uploaded.</p>
      <button class="app-btn-primary" onclick={turnOnVersions} disabled={busy}>
        {busy ? "Turning on…" : "Turn on version history"}
      </button>
    {:else if situation === "local-only"}
      <p class="headline">Saved on this computer only.</p>
      {#if !settingUp}
        <p class="hint">An online copy keeps your book, and every earlier version, safe on GitHub, so you can get it back if this computer is lost.</p>
        <button class="app-btn-primary" onclick={() => (settingUp = true)}>Keep this book safe online…</button>
      {:else}
        <h3>Set up an online copy</h3>
        <p class="hint">Keeps your book, and every earlier version, in an online copy on GitHub.</p>
        {#if !github?.connected}
          <GitHubConnect primary onConnected={githubConnected} />
        {:else}
          <p class="hint">Signed in to GitHub{github.username ? ` as @${github.username}` : ""}.</p>
          {#if !useExisting}
            <label class="field">
              <span class="lbl">Name of the online copy</span>
              <input class="input" bind:value={repoName} spellcheck="false" autocomplete="off" />
            </label>
            <label class="check">
              <input type="checkbox" bind:checked={makePrivate} />
              Private: only you can see it
            </label>
          {:else if reposLoading}
            <p class="hint">Looking for your empty online copies…</p>
          {:else if reposError}
            <p class="error" role="alert">{reposError}</p>
          {:else if emptyRepos.length === 0}
            <p class="hint">
              No empty online copies found on your GitHub account. Create one on github.com (GitHub calls it a repository;
              leave "Add a README" off), then come back.
            </p>
            <button class="ghost" onclick={() => void api.shell.openExternal("https://github.com/new").catch(() => {})}>
              Open github.com to create one…
            </button>
          {:else}
            <label class="field">
              <span class="lbl">Empty online copy</span>
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
            {useExisting ? "Create a new online copy" : "Use an empty one you already made on GitHub"}
          </button>
        {/if}
        <p class="hint">
          Another Git server (GitLab, Gitea, Bitbucket…)?
          <button class="link" onclick={() => void api.shell.openExternal(OTHER_SERVER_GUIDE).catch(() => {})}>
            How to back up there <Icon name="external-link" size={11} />
          </button>
        </p>
      {/if}
    {:else if situation === "connect-github"}
      <p class="headline">This book's online copy is on GitHub: {githubRepo}. Sign in to back it up.</p>
      <GitHubConnect primary label="Sign in…" onConnected={githubConnected} />
    {:else if situation === "connect-server"}
      <p class="headline">This book's online copy is on {diag.remoteHost}. Sign in to back it up.</p>
      <GitServerForm host={diag.remoteHost ?? ""} tokenUrl={diag.tokenSettingsUrl} repoUrl={diag.remoteUrl} submitLabel="Sign in" onConnected={serverConnected} />
    {:else if situation === "ready" && ready}
      <p class="headline" class:ok={ready.ok}>
        {#if ready.ok}<Icon name="circle-check" size={15} />{/if}
        {ready.headline}
      </p>
      <p class="hint">{ready.detail}</p>
      {#if ready.action === "back-up" || ready.action === "try-again"}
        <button class="app-btn-primary" onclick={backUpNow} disabled={busy}>
          {running === "back-up" ? "Backing up…" : ready.action === "try-again" ? "Try again" : "Back up now"}
        </button>
      {:else if ready.action === "sign-in"}
        {#if diag.provider === "github"}
          <GitHubConnect primary label="Sign in…" onConnected={githubConnected} />
        {:else}
          <GitServerForm host={diag.remoteHost ?? ""} tokenUrl={diag.tokenSettingsUrl} repoUrl={diag.remoteUrl} submitLabel="Sign in" onConnected={serverConnected} />
        {/if}
      {/if}
    {:else if diag.remoteProtocol === "ssh"}
      <p class="headline">This book's online copy uses an SSH address (git@…).</p>
      <p class="hint">
        Gutterpress can't back up over SSH. Keep backing up with your usual Git tool, or give the book its https://
        address with that tool and come back here to sign in:
      </p>
      <code>git remote set-url origin https://…</code>
    {:else}
      <p class="headline">This book's online copy is at {diag.remoteUrl}.</p>
      <p class="hint">Gutterpress backs up only to https:// addresses. Keep backing up with your usual Git tool.</p>
    {/if}

    {#if situation && situation !== "no-versions" && projectDir}
      <!-- This computer: the newest version, and the two ways to the rest. -->
      <div class="this-computer">
        {#if facts}<p class="line">{versionsLine({ ...facts, now: Date.now() })}</p>{/if}
        {#if versionsProblem}
          <p class="hint">
            Automatic versions aren't working right now. Try Save a version. If that fails, close any other program that
            might be using your book folder.
          </p>
        {/if}
        {#if nothingNew}<p class="hint" role="status">{NOTHING_NEW_NOTICE}</p>{/if}
        <div class="row">
          <button class="ghost" onclick={() => void saveVersion()} disabled={busy || savingVersion || !onSaveVersion}>
            {savingVersion ? "Saving a version…" : "Save a version"}
          </button>
          <button class="ghost" onclick={() => onShowVersions?.()} disabled={!onShowVersions}>Version history…</button>
        </div>
      </div>

      <RevisionsList bind:this={revisionsEl} {projectDir} hasOnlineCopy={!!diag.remoteUrl} disabled={busy} onChanged={revisionsChanged} />
    {/if}

    {#if situation === "ready" && ready}
      <details class="failing">
        <summary>If backing up keeps failing</summary>
        <div class="tools">
          <button class="ghost" onclick={() => void testConnection()} disabled={busy || testing}>
            {testing ? "Testing…" : "Test connection"}
          </button>
          <span class="hint">Checks that Gutterpress can reach this book's online copy. Nothing is changed or uploaded.</span>
          {#if testResult}<p class="result" class:failed={!testOk} role="status">{testResult}</p>{/if}
          <button
            class="ghost"
            onclick={() => void repair()}
            onblur={() => (confirm = cancelInlineConfirm(confirm, "repair"))}
            disabled={busy}
          >{running === "repair" ? "Repairing…" : confirm["repair"] ? "Really repair?" : "Repair the online copy"}</button>
          <span class="hint">Replaces this book's versions with a fresh download from the online copy. Your files stay as they are. Then a version is saved and backed up.</span>
          <button
            class="ghost danger"
            onclick={() => void startOver()}
            onblur={() => (confirm = cancelInlineConfirm(confirm, "start-over"))}
            disabled={busy}
          >{running === "start-over" ? "Working…" : confirm["start-over"] ? "Really start over?" : "Start over from the online copy"}</button>
          <span class="hint">The last resort. Keeps a safety folder with everything as it is now, downloads a fresh start from the online copy, then puts your files back on top. The book closes at the end.</span>
          {#if onOpenAccounts && diag.provider === "github"}
            <button class="ghost" onclick={onOpenAccounts}>Sign in again</button>
            <span class="hint">Opens Accounts, where you sign in to GitHub again.</span>
          {/if}
        </div>
      </details>
    {/if}

    {#if actionError}<p class="error" role="alert" bind:this={errorEl} tabindex="-1">{actionError}</p>{/if}
  {/if}
</section>

<style>
  @import "../styles/config-section-shared.css";

  .online-copy { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; }
  /* Focus lands on these after an action; they are not controls. */
  .online-copy, .done, .error { outline: none; }
  .online-copy .field { align-self: stretch; max-width: 420px; }
  .headline { margin: 0; font-size: 14px; font-weight: 600; line-height: 1.45; color: var(--app-text); }
  .headline.ok { display: inline-flex; align-items: center; gap: 6px; }
  .headline.ok :global(svg) { color: var(--app-success-strong); }
  h3 { margin: 6px 0 0; font-size: 13px; font-weight: 600; color: var(--app-text); }
  .done { margin: 0; font-size: 13px; color: var(--app-success-text); }
  .check { display: flex; gap: 6px; align-items: center; font-size: 13px; }
  .this-computer { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; padding-top: 4px; }
  .this-computer .line { margin: 0; font-size: 13px; color: var(--app-text); }
  .failing { align-self: stretch; }
  .failing summary { cursor: pointer; font-size: 13px; font-weight: 600; color: var(--app-text); }
  .failing .tools { margin-top: 8px; }
  /* Each tool's button beside what it does, the buttons one column so the descriptions line up. */
  .tools { display: grid; grid-template-columns: max-content minmax(0, 1fr); align-items: center; gap: 8px 12px; }
  .tools .hint { margin: 0; }
  .result { grid-column: 1 / -1; margin: 0; font-size: 12px; color: var(--app-text-secondary); overflow-wrap: anywhere; }
  .result.failed { color: var(--app-error-text); }
  .tools .danger { color: var(--app-error-text); border-color: var(--app-error-text); }
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
