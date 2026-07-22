<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  /**
   * "Open from GitHub" flow (#15, ADR 0006): Connect (device-flow code) →
   * choose repository → choose branch + destination folder → download → the
   * project opens through the same path as any local folder. All copy is
   * author-friendly — no clone/remote/token vocabulary. The renderer never
   * sees a token: connection status is redacted by the host.
   */
  import { tick } from "svelte";
  import { getPlatform, isDesktop } from "$lib/platform";
  import { api } from "$lib/api";
  import { basenameOf } from "$lib/platform/paths";
  import { friendlyHostError } from "$lib/errors";
  import type {
    DeviceCodeInfo,
    RemoteRepository,
    RemoteBranch,
    RepoBook,
    CloneProgressEvent,
  } from "$lib/platform/contract";
  import { dialogBehavior } from "$lib/dialog";

  let {
    open = $bindable(false),
    onOpened,
    onAdvancedSetup,
    onClosed,
    triggerEl,
  }: {
    open?: boolean;
    /** Called with the new local project folder once the download finishes. */
    onOpened?: (projectDir: string) => void;
    /** "Using a different Git host?" — closes this dialog, opens Advanced Setup (#14). */
    onAdvancedSetup?: () => void;
    /** Called whenever the dialog closes (any path). Useful for post-close refresh. */
    onClosed?: () => void;
    triggerEl?: HTMLButtonElement | undefined;
  } = $props();

  type Step = "connect" | "code" | "repos" | "configure" | "books" | "cloning";
  let step = $state<Step>("connect");
  let error = $state<string | null>(null);
  let busy = $state(false);

  // "Choose a book" step (multi-book repositories). Populated after the
  // configure step; loadGen invalidates an in-flight lookup when the user
  // navigates away (stale-load guard — the Advanced-setup dialog established the pattern).
  let books = $state<RepoBook[]>([]);
  let booksLoading = $state(false);
  let loadGen = 0;

  let username = $state<string | null>(null);
  let code = $state<DeviceCodeInfo | null>(null);

  let repos = $state<RemoteRepository[]>([]);
  let reposLoading = $state(false);
  let filter = $state("");

  let selectedRepo = $state<RemoteRepository | null>(null);
  let branches = $state<RemoteBranch[]>([]);
  let branch = $state("");
  let destination = $state<string | null>(null);
  let folderName = $state("");

  let cloneProgress = $state<CloneProgressEvent | null>(null);
  /** True when the user tried to close the dialog mid-download. */
  let closeBlocked = $state(false);
  let dialogEl = $state<HTMLDivElement | undefined>(undefined);
  let connectBtn = $state<HTMLButtonElement | undefined>(undefined);
  let filterEl = $state<HTMLInputElement | undefined>(undefined);
  let refreshBtn = $state<HTMLButtonElement | undefined>(undefined);

  let filteredRepos = $derived(
    repos.filter((r) =>
      r.fullName.toLowerCase().includes(filter.trim().toLowerCase()),
    ),
  );

  function onDialogMount(_el: HTMLElement) {
    error = null;
    filter = "";
    code = null;
    selectedRepo = null;
    cloneProgress = null;
    closeBlocked = false;
    username = null;
    repos = [];
    branches = [];
    branch = "";
    destination = null;
    folderName = "";
    books = [];
    booksLoading = false;
    loadGen++;
    step = "connect";
    queueMicrotask(() => (connectBtn ?? dialogEl)?.focus());
    void init();
  }

  async function init() {
    if (!isDesktop()) return;
    try {
      const conn = await api.remote.getRemoteConnection();
      if (conn.connected) {
        username = conn.username ?? null;
        await loadRepos();
      }
    } catch {
      /* stay on connect step */
    }
  }

  async function connect() {
    error = null;
    busy = true;
    const platform = getPlatform();
    try {
      const info = await platform.connectGitHubStart();
      code = info;
      step = "code";
      // Open the verification page for the user; the code stays visible here.
      api.shell.openExternal(info.verificationUri).catch(() => {});
      const conn = await platform.connectGitHubWait();
      username = conn.username ?? null;
      await loadRepos();
    } catch (e) {
      // The user may have closed the dialog mid-flow — only surface errors
      // while it is still open.
      if (open) {
        // This path is IPC-bridged (getPlatform() → ipcRenderer.invoke), so
        // unlike the api.remote.* fetch routes (sanitized host-side) the raw
        // "Error invoking remote method '…':" transport prefix can reach here
        // unscrubbed (L11) — scrub it before it reaches the writer.
        error = friendlyHostError(e instanceof Error ? e.message : String(e));
        step = "connect";
      }
    } finally {
      busy = false;
    }
  }

  /**
   * Fetch the repo list. The host returns it most-recently-pushed first
   * (the API's `sort=pushed`) — render in that order, never re-sort.
   */
  async function loadRepos() {
    step = "repos";
    reposLoading = true;
    error = null;
    // Park focus on the dialog while loading so it can't fall to <body>
    // when the previous step's controls unmount.
    await tick();
    dialogEl?.focus();
    try {
      repos = await api.remote.listRemoteRepositories() as RemoteRepository[];
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      reposLoading = false;
    }
    await tick();
    // The search input is the primary action when there is a list; with no
    // repositories the Refresh button is.
    (repos.length > 0 ? filterEl : (refreshBtn ?? filterEl))?.focus();
  }

  /** Hand off to Advanced Setup (#14) — shared by the connect + repos steps. */
  function goAdvancedSetup() {
    open = false;
    onClosed?.();
    // No triggerEl?.focus() here: Advanced Setup opens next and takes focus
    // itself; it restores focus when IT closes.
    onAdvancedSetup?.();
  }

  async function chooseRepo(repo: RemoteRepository) {
    selectedRepo = repo;
    branch = repo.defaultBranch;
    folderName = repo.name;
    branches = [{ name: repo.defaultBranch }];
    destination = null;
    step = "configure";
    // Branch list loads in the background; the default is already selected.
    api.remote
      .listRemoteBranches(repo.owner, repo.name)
      .then((list) => {
        if (list.length > 0) branches = list as RemoteBranch[];
      })
      .catch(() => {});
  }

  async function pickDestination() {
    const pathStr = await api.dialog.openDirectory();
    if (pathStr) destination = pathStr;
  }

  /**
   * Configure-step submit: look for the books inside the chosen repo+branch
   * first. More than one → the author picks which book to open ("books"
   * step); exactly one → open it directly; none (or a lookup failure) →
   * open the repository root, exactly as before. The WHOLE repository is
   * downloaded once either way (ADR 0006 D2) — the chosen folder just
   * becomes the project that opens.
   */
  async function openProject() {
    if (!selectedRepo || !destination || busy) return;
    error = null;
    busy = true;
    booksLoading = true;
    const gen = ++loadGen;
    let found: RepoBook[] = [];
    try {
      found = await api.remote.listRepoBooks(
        selectedRepo.owner,
        selectedRepo.name,
        branch,
      ) as RepoBook[];
    } catch {
      // Book discovery is best-effort — fall back to the repository root.
      found = [];
    } finally {
      booksLoading = false;
      busy = false;
    }
    if (gen !== loadGen || step !== "configure") return; // user navigated away
    if (found.length > 1) {
      books = found;
      step = "books";
      await tick();
      dialogEl?.querySelector<HTMLButtonElement>(".repo-row")?.focus();
      return;
    }
    await startClone(found.length === 1 ? found[0].path : "");
  }

  async function startClone(subPath: string) {
    if (!selectedRepo || !destination) return;
    error = null;
    step = "cloning";
    cloneProgress = null;
    closeBlocked = false;
    const platform = getPlatform();
    // NOTE: block body on purpose — an expression body `(p) => (cloneProgress = p)`
    // implicitly RETURNS the Svelte $state proxy, which contextBridge then tries
    // (and fails) to structured-clone back to the preload: one uncaught
    // "An object could not be cloned" per progress event (0.5.0-rc.3 storm).
    // Push-channel callbacks must never return a value.
    const unsubscribe = platform.onCloneProgress((p) => {
      cloneProgress = p;
    });
    try {
      const { projectDir } = await platform.cloneRemoteRepository({
        url: `${selectedRepo.htmlUrl}.git`,
        parentDir: destination,
        folderName: folderName.trim() || selectedRepo.name,
        branch,
        owner: selectedRepo.owner,
        repo: selectedRepo.name,
        ...(subPath ? { subPath } : {}),
      });
      open = false;
      triggerEl?.focus();
      onClosed?.();
      onOpened?.(projectDir);
    } catch (e) {
      // Also IPC-bridged (platform.cloneRemoteRepository) — same L11 scrub.
      error = friendlyHostError(e instanceof Error ? e.message : String(e));
      step = "configure";
    } finally {
      unsubscribe();
    }
  }

  async function disconnect() {
    try {
      await api.remote.disconnectGitHub();
    } catch {
      /* non-fatal */
    }
    username = null;
    repos = [];
    step = "connect";
  }

  function close() {
    // Downloading can't be safely interrupted yet — tell the user instead of
    // silently ignoring the attempt.
    if (step === "cloning") {
      closeBlocked = true;
      return;
    }
    if (step === "code") {
      getPlatform().connectGitHubCancel().catch(() => {});
    }
    open = false;
    // Focus restoration to `triggerEl` is handled by the dialogBehavior action.
    onClosed?.();
  }

  function progressLabel(p: CloneProgressEvent | null): string {
    if (!p) return "Starting download…";
    if (p.total) {
      const pct = Math.min(100, Math.round((p.loaded / p.total) * 100));
      return `Downloading your project… ${pct}%`;
    }
    return "Downloading your project…";
  }

</script>

{#if open}
  <div class="dlg-backdrop" onclick={close} role="presentation"></div>

  <div
    bind:this={dialogEl}
    class="dlg-shell"
    use:dialogBehavior={{ onClose: close, triggerEl, labelledBy: "github-dialog-title" }}
    use:onDialogMount
  >
    <header class="dlg-header">
      <h2 id="github-dialog-title">
        {#if step === "connect" || step === "code"}Connect GitHub{:else if step === "repos"}Choose a repository{:else if step === "configure"}Open project{:else if step === "books"}Choose a book{:else}Downloading…{/if}
      </h2>
      <button
        class="dlg-close"
        onclick={close}
        disabled={step === "cloning"}
        title="Close (Esc)"
        aria-label="Close"
      ><Icon name="x" size={16} /></button>
    </header>

    <div class="dialog-body">
      <!-- Persistent live region: announcing the user code from a node that
           already exists is reliable; a region mounted WITH its content is
           routinely skipped by screen readers. -->
      <div class="dlg-sr-only" role="status" aria-live="assertive">
        {code ? `Your GitHub sign-in code is ${code.userCode}. Enter it on the GitHub page that opened.` : ""}
      </div>

      {#if error}
        <p class="error" role="alert">{error}</p>
      {/if}

      {#if step === "connect"}
        <p class="hint">
          Connect your GitHub account to open the book projects stored there.
          A browser window will ask you to enter a short code — that's it.
        </p>
        {#if onAdvancedSetup}
          <p class="hint subtle">
            Using a different Git host (Gitea, GitLab, Bitbucket, …)?
            <button
              type="button"
              class="link-btn"
              onclick={goAdvancedSetup}
            >Open Connections settings</button>
          </p>
        {/if}
        <footer class="dlg-actions">
          <button class="dlg-ghost" onclick={close}>Cancel</button>
          <button bind:this={connectBtn} class="dlg-primary app-btn-primary" onclick={connect} disabled={busy}>
            {busy ? "Contacting GitHub…" : "Connect GitHub"}
          </button>
        </footer>
      {:else if step === "code"}
        <p class="hint">Enter this code on the GitHub page that just opened:</p>
        <div class="user-code">{code?.userCode}</div>
        <p class="hint subtle">
          Waiting for you to approve in the browser…
          {#if code}
            If the page didn't open, visit
            <button
              type="button"
              class="link-btn"
              onclick={() => code && api.shell.openExternal(code.verificationUri).catch(() => {})}
            >{code.verificationUri}</button>
          {/if}
        </p>
        <footer class="dlg-actions">
          <button class="dlg-ghost" onclick={close}>Cancel</button>
        </footer>
      {:else if step === "repos"}
        {#if username}
          <p class="hint subtle connected-line">
            Connected as <strong>@{username}</strong>
            <button type="button" class="link-btn" onclick={disconnect}>Disconnect</button>
          </p>
        {/if}
        {#if reposLoading || repos.length > 0}
          <input
            bind:this={filterEl}
            type="text"
            class="filter"
            placeholder="Search repositories…"
            aria-label="Search repositories"
            bind:value={filter}
            spellcheck="false"
            autocomplete="off"
          />
        {/if}
        {#if reposLoading}
          <p class="hint subtle">Loading your repositories…</p>
        {:else if repos.length === 0}
          <!-- The OAuth `repo` scope sees every repository the account can
               access, so an empty list means the account truly has none yet. -->
          <p class="hint">
            There are no repositories on this GitHub account yet. Once you (or
            a collaborator) create one, use Refresh and it will show up here.
          </p>
        {:else if filteredRepos.length === 0}
          <p class="hint subtle">No repositories match your search.</p>
        {:else}
          <!-- Pick-and-go list: each repo is a real button (native keyboard
               + focus semantics), not a listbox with managed selection. -->
          <ul class="repo-list" role="list" aria-label="Your repositories">
            {#each filteredRepos as repo (repo.fullName)}
              <li role="listitem">
                <button type="button" class="repo-row" onclick={() => chooseRepo(repo)}>
                  <span class="repo-name">{repo.fullName}</span>
                  {#if repo.private}<span class="dlg-badge">Private</span>{/if}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
        {#if onAdvancedSetup}
          <p class="hint subtle">
            Or connect a different Git server in
            <button type="button" class="link-btn" onclick={goAdvancedSetup}
            >Connections settings</button>
          </p>
        {/if}
        <footer class="dlg-actions">
          <button class="dlg-ghost" onclick={close}>Cancel</button>
          <button
            bind:this={refreshBtn}
            class="dlg-ghost"
            onclick={() => loadRepos()}
            disabled={reposLoading}
          >Refresh</button>
        </footer>
      {:else if step === "configure" && selectedRepo}
        <p class="hint"><strong>{selectedRepo.fullName}</strong></p>
        <label class="field">
          <span>Version to open</span>
          <select bind:value={branch}>
            {#each branches as b (b.name)}
              <option value={b.name}>
                {b.name}{b.name === selectedRepo.defaultBranch ? " (recommended)" : ""}
              </option>
            {/each}
          </select>
        </label>
        <label class="field">
          <span>Save it on this computer as</span>
          <input type="text" bind:value={folderName} spellcheck="false" autocomplete="off" />
        </label>
        <div class="field">
          <span>Where to save it</span>
          <div class="dest-row">
            <span class="dest-path">{destination ?? "Choose a folder…"}</span>
            <button class="dlg-ghost" onclick={pickDestination}>Browse…</button>
          </div>
        </div>
        <footer class="dlg-actions">
          <button class="dlg-ghost" onclick={() => (step = "repos")}>Back</button>
          <button class="dlg-ghost" onclick={close}>Cancel</button>
          <button
            class="dlg-primary app-btn-primary"
            onclick={openProject}
            disabled={!destination || !folderName.trim() || busy}
          >{booksLoading ? "Looking inside…" : "Open project"}</button>
        </footer>
      {:else if step === "books" && selectedRepo}
        <p class="hint">
          <strong>{selectedRepo.fullName}</strong> contains more than one book.
          Which one would you like to open?
        </p>
        <!-- svelte-ignore a11y_no_redundant_roles -- list-style:none strips
             list semantics in some screen readers; role="list" restores it. -->
        <ul class="repo-list" role="list" aria-label="Books in this repository">
          {#each books as book (book.path)}
            <li role="listitem">
              <button type="button" class="repo-row" onclick={() => startClone(book.path)}>
                <span class="repo-name">{book.name}</span>
                <span class="book-path">{book.path === "" ? "whole folder" : book.path}</span>
              </button>
            </li>
          {/each}
        </ul>
        <p class="hint subtle">
          The whole folder is saved on this computer either way — this just
          chooses which book opens.
        </p>
        <footer class="dlg-actions">
          <button class="dlg-ghost" onclick={() => (step = "configure")}>Back</button>
          <button class="dlg-ghost" onclick={close}>Cancel</button>
        </footer>
      {:else if step === "cloning"}
        <p class="hint" role="status" aria-live="polite">{progressLabel(cloneProgress)}</p>
        {#if cloneProgress?.total}
          {@const pct = Math.min(100, Math.round((cloneProgress.loaded / cloneProgress.total) * 100))}
          <div
            class="progress-track"
            role="progressbar"
            aria-label="Download progress"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={pct}
          >
            <div class="progress-fill" style:width={`${pct}%`}></div>
          </div>
        {:else}
          <!-- Indeterminate animation is purely decorative until totals exist. -->
          <div class="progress-track" aria-hidden="true">
            <div class="progress-fill indeterminate"></div>
          </div>
        {/if}
        {#if closeBlocked}
          <p class="hint subtle" role="status">Download in progress — please wait.</p>
        {/if}
      {/if}
    </div>
  </div>
{/if}


<style>
  @import "$lib/styles/dialog-shell.css";

  .dlg-shell {
    width: min(560px, 92vw);
    max-height: 80vh;
  }
  .dialog-body {
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    overflow-y: auto;
    flex: 1;
  }
  .hint { font-size: 13px; margin: 0; line-height: 1.5; }
  .hint.subtle { color: var(--app-text-muted); font-size: 12px; }
  .connected-line { display: flex; align-items: center; gap: 8px; }
  .error { color: var(--app-error-text); font-size: 12px; margin: 0; }
  .link-btn {
    background: none;
    border: 0;
    color: var(--app-focus-ring);
    cursor: pointer;
    font-size: inherit;
    padding: 0;
    text-decoration: underline;
  }
  .user-code {
    font-family: var(--app-font-mono);
    font-size: 28px;
    font-weight: 700;
    letter-spacing: 0.15em;
    text-align: center;
    padding: 14px;
    border: 1px dashed var(--app-border);
    border-radius: 8px;
    background: var(--app-surface-sunken);
    user-select: all;
  }
  .filter,
  .field input,
  .field select {
    background: var(--app-surface-sunken);
    border: 1px solid var(--app-border);
    color: var(--app-text-secondary);
    padding: 8px 10px;
    border-radius: 6px;
    font-size: 13px;
    width: 100%;
    box-sizing: border-box;
  }
  .filter:focus,
  .field input:focus,
  .field select:focus {
    outline: none;
    border-color: var(--app-focus-ring);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .field > span { font-size: 12px; color: var(--app-text-muted); font-weight: 500; }
  .dest-row { display: flex; gap: 8px; align-items: center; }
  .dest-path {
    flex: 1;
    font-family: var(--app-font-mono);
    font-size: 12px;
    color: var(--app-text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .repo-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 280px;
    overflow-y: auto;
  }
  /* Each row is a <button> — reset chrome, keep the row look. */
  .repo-row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 10px;
    border-radius: 6px;
    cursor: pointer;
    border: 1px solid transparent;
    font-size: 13px;
    font-family: inherit;
    text-align: left;
    background: transparent;
    color: inherit;
  }
  .repo-row:hover,
  .repo-row:focus {
    background: var(--app-surface-sunken);
    border-color: var(--app-focus-ring);
    outline: none;
  }
  .repo-name {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .book-path {
    font-size: 11px;
    color: var(--app-text-muted);
    font-family: var(--app-font-mono);
    flex-shrink: 0;
  }
  .progress-track {
    height: 6px;
    border-radius: 3px;
    background: var(--app-surface-sunken);
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    background: var(--app-focus-ring);
    border-radius: 3px;
    transition: width 0.2s;
  }
  .progress-fill.indeterminate {
    width: 35%;
    animation: slide 1.2s ease-in-out infinite alternate;
  }
  @keyframes slide {
    from { margin-left: 0; }
    to { margin-left: 65%; }
  }
  /* In-flow footer (last item inside the scrolling body) — restore its
     original spacing; the shared default assumes a pinned bar. */
  .dlg-actions {
    padding: 16px 0 0;
  }
</style>
