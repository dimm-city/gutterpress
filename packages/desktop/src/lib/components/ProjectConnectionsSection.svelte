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
   *                         the sync controller's `backup`) or a Sync now
   *                         run here (`readyView`), never from the setup
   *                         alone. Sync now / Try again run the page's
   *                         Sync (`onBackUpNow`); a rejected sign-in
   *                         gets the sign-in step again.
   *        own-tools      — an SSH (or other non-https) address.
   *      Then one line about this computer ("Saved · last version 10 minutes
   *      ago") with Save a version and Version history…, which replaces the
   *      tab's content with the Version history view (ProjectActivityView; its
   *      back button returns here). "Look at this version" is the one thing it
   *      cannot do in place: the page's preview shows the comparison, so Book
   *      setup closes (`onLookAt`).
   *   2. Revisions (RevisionsList), whenever version history is on.
   *   3. If backing up keeps failing (ready), collapsed: Test connection (a
   *      read-only probe of this book's online copy; the GitHub sign-in itself
   *      is tested in Accounts), Sign in again (Accounts) for GitHub books,
   *      Repair the online copy (`onRepair`: fresh versions under the files,
   *      then a backup) and Start over from the online copy
   *      (`api.remote.scorchedEarth`: keep a safety folder, empty the folder,
   *      download the online copy, put the files back on top and — whether or
   *      not that worked — close the book, so the app holds no stale state;
   *      Book setup closes with it, so the outcome is a toast).
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
  import ProjectActivityView from "#lib/components/ProjectActivityView.svelte";
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
    logFilePath = null,
    viewingId = null,
    onLookAt,
    onStopLooking,
    onCloseBook,
    onOpenAccounts,
    toast = null,
  }: {
    projectDir: string | null;
    /** The online copy's last word for this book: the host's status stream or the last Sync. */
    backup?: LastBackup | null;
    /** Automatic versions keep failing, and why (the host said so). */
    versionsProblem?: { message: string | null } | null;
    /** Version history was just turned on: the parent re-reads the project's classification so the status bar catches up. */
    onVersionHistoryEnabled?: (projectDir: string) => void;
    /** The online copy was just set up or signed in to: the parent re-reads the project's state so the status bar catches up. */
    onBackupSetUp?: (projectDir: string) => void;
    /** Another revision was just opened, made or renamed: the files under `projectDir` changed under the open editor. */
    onProjectFilesChanged?: () => void;
    /** Sync now: the page's own pass, which gets the latest then backs up (its toasts and editor refresh). */
    onBackUpNow?: () => Promise<void>;
    /** Repair the online copy: the page's repair (its toasts and editor refresh). */
    onRepair?: () => Promise<void>;
    /** Save a version now: the page's own save (its toast); resolves "unchanged" when there was nothing new. */
    onSaveVersion?: () => Promise<"saved" | "unchanged">;
    /** The newest operation log, for Version history's Technical details. */
    logFilePath?: string | null;
    /** The version the preview is showing beside the live book, if any. */
    viewingId?: string | null;
    /** Look at this version: the parent closes Book setup and shows it in the preview. */
    onLookAt?: (id: string, label: string) => void;
    onStopLooking?: () => void;
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

  // The Version history card's list.
  let historyEl = $state<{ refreshHistory: () => void }>();

  /** A backup finished: reload the Version history list. */
  export function refreshHistory() {
    historyEl?.refreshHistory();
  }

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
      actionError = friendlyHostError(unwrapRouteError(e instanceof Error ? e.message : String(e)));
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

  // The page's Sync, run from here; the sync controller's `backup` is the headline.
  const backUpNow = () =>
    act(async (dir) => {
      running = "back-up";
      try {
        await onBackUpNow?.();
      } finally {
        running = null;
      }
      // A pass can send a new revision online and make a version.
      revisionsEl?.refresh();
      void loadFacts(dir);
      return null;
    });

  // Save a version: the page saves and toasts; this line catches up.
  async function saveVersion() {
    if (!projectDir || !onSaveVersion || savingVersion) return;
    savingVersion = true;
    try {
      nothingNew = (await onSaveVersion()) === "unchanged";
      historyEl?.refreshHistory();
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

  /** The status card: a shape and tone, a short title, and one line under it. */
  type Tone = "ok" | "warn" | "pending" | "plain";
  const status = $derived.by((): { icon: "circle-check" | "triangle-alert" | "refresh-cw" | "cloud-upload" | "cloud" | "laptop" | "history" | "info"; tone: Tone; title: string; detail: string } | null => {
    if (!diag) return null;
    switch (situation) {
      case "no-versions":
        return { icon: "history", tone: "plain", title: "Version history is off", detail: "Turn it on to keep earlier versions on this computer, so you can go back. Nothing is uploaded." };
      case "local-only":
        return { icon: "laptop", tone: "plain", title: "Saved on this computer only", detail: "An online copy keeps your book, and every earlier version, safe on GitHub, so you can get it back if this computer is lost." };
      case "connect-github":
        return { icon: "triangle-alert", tone: "warn", title: "Sign in to back up", detail: `This book's online copy is on GitHub: ${githubRepo}.` };
      case "connect-server":
        return { icon: "triangle-alert", tone: "warn", title: "Sign in to back up", detail: `This book's online copy is on ${diag.remoteHost}.` };
      case "ready": {
        if (!ready) return null;
        const state = backup?.state;
        const tone: Tone = ready.ok ? "ok" : state === "syncing" ? "pending" : ready.action === "try-again" || ready.action === "sign-in" ? "warn" : "plain";
        const icon = ready.ok ? "circle-check" : state === "syncing" ? "refresh-cw" : tone === "warn" ? "triangle-alert" : state === "unsent" ? "cloud-upload" : "cloud";
        const copy = diag.remoteUrl ? onlineCopyName(diag.remoteUrl) : "";
        return { icon, tone, title: ready.headline, detail: ready.headline.includes(copy) ? ready.detail : `${copy} · ${ready.detail}` };
      }
      default:
        return {
          icon: "info",
          tone: "plain",
          title: "Backed up with your own Git tool",
          detail: diag.remoteProtocol === "ssh"
            ? "This book's online copy uses an SSH address (git@…), which Gutterpress can't back up over."
            : `This book's online copy is at ${diag.remoteUrl}. Gutterpress backs up only to https:// addresses.`,
        };
    }
  });
</script>

<div class="online-copy" bind:this={sectionEl} tabindex="-1">
  {#if loading}
    <p class="hint">Checking this book's online copy…</p>
  {:else if !diag || !status}
    <p class="hint">Couldn't read this book's online copy status. <button class="ghost small" onclick={load}>Try again</button></p>
  {:else}
    <!-- 1. Where the book is kept: one sentence and its one next step. -->
    <section class="section-card status {status.tone}" aria-labelledby="online-status-title">
      <div class="status-row">
        <span class="status-icon"><Icon name={status.icon} size={18} /></span>
        <div class="status-text">
          <h3 id="online-status-title">{status.title}</h3>
          <p>{status.detail}</p>
        </div>
        <div class="status-action">
          {#if situation === "no-versions"}
            <button class="app-btn-primary" onclick={turnOnVersions} disabled={busy}>{busy ? "Turning on…" : "Turn on version history"}</button>
          {:else if situation === "local-only" && !settingUp}
            <button class="app-btn-primary" onclick={() => (settingUp = true)}>Keep this book safe online…</button>
          {:else if situation === "ready" && ready && (ready.action === "back-up" || ready.action === "try-again")}
            <button class="app-btn-primary" onclick={backUpNow} disabled={busy}>
              {running === "back-up" ? "Syncing…" : ready.action === "try-again" ? "Try again" : "Sync now"}
            </button>
          {/if}
        </div>
      </div>

      {#if situation === "local-only" && settingUp}
        <div class="status-body">
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
            <div class="row">
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
            </div>
          {/if}
          <p class="hint">
            Another Git server (GitLab, Gitea, Bitbucket…)?
            <button class="link" onclick={() => void api.shell.openExternal(OTHER_SERVER_GUIDE).catch(() => {})}>
              How to back up there <Icon name="external-link" size={11} />
            </button>
          </p>
        </div>
      {:else if situation === "connect-github" || (situation === "ready" && ready?.action === "sign-in" && diag.provider === "github")}
        <div class="status-body"><GitHubConnect primary label="Sign in…" onConnected={githubConnected} /></div>
      {:else if situation === "connect-server" || (situation === "ready" && ready?.action === "sign-in")}
        <div class="status-body">
          <GitServerForm host={diag.remoteHost ?? ""} tokenUrl={diag.tokenSettingsUrl} repoUrl={diag.remoteUrl} submitLabel="Sign in" onConnected={serverConnected} />
        </div>
      {:else if situation === "own-tools" && diag.remoteProtocol === "ssh"}
        <div class="status-body">
          <p class="hint">Keep backing up with your usual Git tool, or give the book its https:// address with that tool and come back here to sign in:</p>
          <code>git remote set-url origin https://…</code>
        </div>
      {/if}

      {#if done}<p class="status-note done" role="status" bind:this={doneEl} tabindex="-1">{done}</p>{/if}
      {#if actionError}<p class="status-note error" role="alert" bind:this={errorEl} tabindex="-1">{actionError}</p>{/if}

      {#if situation === "ready" && ready}
        <details class="trouble">
          <summary>Backing up keeps failing?</summary>
          <div class="tools">
            <div class="tool">
              <div><strong>Test connection</strong><p class="hint">Checks that Gutterpress can reach this book's online copy. Nothing is changed or uploaded.</p></div>
              <button class="ghost small" onclick={() => void testConnection()} disabled={busy || testing}>{testing ? "Testing…" : "Test connection"}</button>
            </div>
            {#if testResult}<p class="result" class:failed={!testOk} role="status">{testResult}</p>{/if}
            {#if onOpenAccounts && diag.provider === "github"}
              <div class="tool">
                <div><strong>Sign in again</strong><p class="hint">Opens Accounts, where you sign in to GitHub again.</p></div>
                <button class="ghost small" onclick={onOpenAccounts}>Sign in again</button>
              </div>
            {/if}
            <div class="tool">
              <div><strong>Repair the online copy</strong><p class="hint">Replaces this book's versions with a fresh download from the online copy. Your files stay as they are. Then a version is saved and backed up.</p></div>
              <button
                class="ghost small"
                onclick={() => void repair()}
                onblur={() => (confirm = cancelInlineConfirm(confirm, "repair"))}
                disabled={busy}
              >{running === "repair" ? "Repairing…" : confirm["repair"] ? "Really repair?" : "Repair the online copy"}</button>
            </div>
            <div class="tool">
              <div><strong>Start over from the online copy</strong><p class="hint">The last resort. Keeps a safety folder with everything as it is now, downloads a fresh start from the online copy, then puts your files back on top. The book closes at the end.</p></div>
              <button
                class="ghost small danger"
                onclick={() => void startOver()}
                onblur={() => (confirm = cancelInlineConfirm(confirm, "start-over"))}
                disabled={busy}
              >{running === "start-over" ? "Working…" : confirm["start-over"] ? "Really start over?" : "Start over from the online copy"}</button>
            </div>
          </div>
        </details>
      {/if}
    </section>

    {#if situation !== "no-versions" && projectDir}
      <!-- 2. Revisions. -->
      <RevisionsList bind:this={revisionsEl} {projectDir} hasOnlineCopy={!!diag.remoteUrl} disabled={busy} onChanged={revisionsChanged} />

      <!-- 3. Version history of the revision you're working on. -->
      <section class="section-card" aria-labelledby="version-history-title">
        <header class="section-head">
          <div>
            <h3 id="version-history-title">Version history</h3>
            {#if facts}<p class="section-sub">{versionsLine({ ...facts, now: Date.now() })}</p>{/if}
          </div>
          <button class="ghost" onclick={() => void saveVersion()} disabled={busy || savingVersion || !onSaveVersion}>
            <Icon name="save" size={14} /> {savingVersion ? "Saving…" : "Save a version"}
          </button>
        </header>
        {#if versionsProblem}
          <p class="section-note warn">
            Automatic versions aren't working right now. Try Save a version. If that fails, close any other program that
            might be using your book folder.
          </p>
        {/if}
        {#if nothingNew}<p class="section-note" role="status">{NOTHING_NEW_NOTICE}</p>{/if}
        <ProjectActivityView
          bind:this={historyEl}
          {projectDir}
          {logFilePath}
          hasRemote={!!diag.remoteUrl}
          {viewingId}
          onRestored={onProjectFilesChanged}
          {onLookAt}
          {onStopLooking}
        />
      </section>
    {/if}
  {/if}
</div>

<style>
  @import "../styles/config-section-shared.css";

  .online-copy { display: flex; flex-direction: column; gap: 16px; max-width: 820px; }
  /* Focus lands on these after an action; they are not controls. */
  .online-copy, .done, .error { outline: none; }

  .status-row { display: flex; align-items: center; gap: 14px; padding: 16px; }
  .status-icon {
    display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
    width: 36px; height: 36px; border-radius: 50%;
    background: var(--app-surface-sunken); color: var(--app-text-muted);
  }
  .status.ok .status-icon { background: var(--app-success-bg); color: var(--app-success-strong); }
  .status.warn .status-icon { background: var(--app-warning-bg); color: var(--app-warning-text); }
  .status.pending .status-icon { background: var(--app-info-bg); color: var(--app-info-text); }
  .status-text { flex: 1; min-width: 0; }
  .status-text h3 { margin: 0; font-size: 15px; font-weight: 600; color: var(--app-text); overflow-wrap: anywhere; }
  .status-text p { margin: 3px 0 0; font-size: 12.5px; line-height: 1.45; color: var(--app-text-muted); overflow-wrap: anywhere; }
  .status-action { flex-shrink: 0; }
  .status-body {
    display: flex; flex-direction: column; align-items: flex-start; gap: 10px;
    padding: 0 16px 16px 66px;
  }
  .status-body .field { align-self: stretch; max-width: 420px; }
  .status-note { margin: 0; padding: 0 16px 14px 66px; font-size: 13px; }
  .done { color: var(--app-success-text); }
  .check { display: flex; gap: 6px; align-items: center; font-size: 13px; }

  .trouble { border-top: 1px solid var(--app-border-subtle); }
  .trouble summary {
    padding: 10px 16px; cursor: pointer; font-size: 12.5px; color: var(--app-text-muted);
  }
  .trouble summary:hover { color: var(--app-text); }
  .tools { display: flex; flex-direction: column; }
  .tool {
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    padding: 10px 16px; border-top: 1px solid var(--app-border-subtle);
  }
  .tool strong { font-size: 13px; font-weight: 600; color: var(--app-text); }
  .tool .hint { margin-top: 2px; }
  .tool button { flex-shrink: 0; }
  .result { margin: 0; padding: 0 16px 10px; font-size: 12px; color: var(--app-text-secondary); overflow-wrap: anywhere; }
  .result.failed { color: var(--app-error-text); }
  .tool .danger { color: var(--app-error-text); border-color: var(--app-error-text); }
  .warn { color: var(--app-warning-text); }
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
