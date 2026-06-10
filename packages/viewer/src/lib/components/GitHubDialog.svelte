<script lang="ts">
  /**
   * "Open from GitHub" flow (#15, ADR 0006): Connect (device-flow code) →
   * choose repository → choose branch + destination folder → download → the
   * project opens through the same path as any local folder. All copy is
   * author-friendly — no clone/remote/token vocabulary. The renderer never
   * sees a token: connection status is redacted by the host.
   */
  import { tick } from "svelte";
  import { getPlatform, isDesktop } from "$lib/platform";
  import type {
    DeviceCodeInfo,
    RemoteRepository,
    RemoteBranch,
    CloneProgressEvent,
  } from "$lib/platform/contract";

  let {
    open = $bindable(false),
    onOpened,
    onAdvancedSetup,
    triggerEl,
  }: {
    open?: boolean;
    /** Called with the new local project folder once the download finishes. */
    onOpened?: (projectDir: string) => void;
    /** "Using a different Git host?" — closes this dialog, opens Advanced Setup (#14). */
    onAdvancedSetup?: () => void;
    triggerEl?: HTMLButtonElement | undefined;
  } = $props();

  type Step = "connect" | "code" | "repos" | "configure" | "cloning";
  let step = $state<Step>("connect");
  let error = $state<string | null>(null);
  let busy = $state(false);

  let username = $state<string | null>(null);
  let code = $state<DeviceCodeInfo | null>(null);

  let repos = $state<RemoteRepository[]>([]);
  let reposLoading = $state(false);
  let filter = $state("");
  /**
   * GitHub App "choose repositories" page, supplied (redacted-status payload)
   * by the host. A first-time user always starts with zero installations, so
   * the empty repo list MUST offer this page or the picker dead-ends.
   */
  let installUrl = $state<string | null>(null);

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
  let installBtn = $state<HTMLButtonElement | undefined>(undefined);

  let filteredRepos = $derived(
    repos.filter((r) =>
      r.fullName.toLowerCase().includes(filter.trim().toLowerCase()),
    ),
  );

  $effect(() => {
    if (open) {
      // Full reset — a previous session's repos/branches/destination must
      // never leak into a reopen; init() repopulates from the host.
      error = null;
      filter = "";
      code = null;
      selectedRepo = null;
      cloneProgress = null;
      closeBlocked = false;
      username = null;
      installUrl = null;
      repos = [];
      branches = [];
      branch = "";
      destination = null;
      folderName = "";
      step = "connect";
      // Lead with the primary action (Connect); if init() finds an existing
      // connection it moves to the repo list and focuses the search input.
      queueMicrotask(() => (connectBtn ?? dialogEl)?.focus());
      void init();
    }
  });

  async function init() {
    if (!isDesktop()) return;
    try {
      const conn = await getPlatform().getRemoteConnection();
      installUrl = conn.installUrl ?? null;
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
      platform.openExternal(info.verificationUri).catch(() => {});
      const conn = await platform.connectGitHubWait();
      username = conn.username ?? null;
      await loadRepos();
    } catch (e) {
      // The user may have closed the dialog mid-flow — only surface errors
      // while it is still open.
      if (open) {
        error = e instanceof Error ? e.message : String(e);
        step = "connect";
      }
    } finally {
      busy = false;
    }
  }

  /**
   * Fetch the repo list. `manageFocus: false` is the background-refresh mode
   * (window regained focus) — it must never steal the user's focus.
   */
  async function loadRepos(manageFocus = true) {
    step = "repos";
    reposLoading = true;
    error = null;
    if (manageFocus) {
      // Park focus on the dialog while loading so it can't fall to <body>
      // when the previous step's controls unmount.
      await tick();
      dialogEl?.focus();
    }
    try {
      repos = await getPlatform().listRemoteRepositories();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      reposLoading = false;
    }
    if (manageFocus) {
      await tick();
      // The search input is the primary action when there is a list; with no
      // repositories yet, the "Choose repositories on GitHub" button is.
      (repos.length > 0 ? filterEl : (installBtn ?? filterEl))?.focus();
    }
  }

  /** Re-fetch when the user returns from choosing repositories on GitHub. */
  function onWindowFocus() {
    if (open && step === "repos" && !reposLoading) void loadRepos(false);
  }

  function openInstallPage() {
    if (installUrl) getPlatform().openExternal(installUrl).catch(() => {});
  }

  /** Hand off to Advanced Setup (#14) — shared by the connect + repos steps. */
  function goAdvancedSetup() {
    open = false;
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
    getPlatform()
      .listRemoteBranches(repo.owner, repo.name)
      .then((list) => {
        if (list.length > 0) branches = list;
      })
      .catch(() => {});
  }

  async function pickDestination() {
    const dir = await getPlatform().openFolder();
    if (dir) destination = dir;
  }

  async function startClone() {
    if (!selectedRepo || !destination) return;
    error = null;
    step = "cloning";
    cloneProgress = null;
    closeBlocked = false;
    const platform = getPlatform();
    const unsubscribe = platform.onCloneProgress((p) => (cloneProgress = p));
    try {
      const { projectDir } = await platform.cloneRemoteRepository({
        url: `${selectedRepo.htmlUrl}.git`,
        parentDir: destination,
        folderName: folderName.trim() || selectedRepo.name,
        branch,
        owner: selectedRepo.owner,
        repo: selectedRepo.name,
        installationId: selectedRepo.installationId,
      });
      open = false;
      triggerEl?.focus();
      onOpened?.(projectDir);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      step = "configure";
    } finally {
      unsubscribe();
    }
  }

  async function disconnect() {
    try {
      await getPlatform().disconnectGitHub();
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
    triggerEl?.focus();
  }

  function progressLabel(p: CloneProgressEvent | null): string {
    if (!p) return "Starting download…";
    if (p.total) {
      const pct = Math.min(100, Math.round((p.loaded / p.total) * 100));
      return `Downloading your project… ${pct}%`;
    }
    return "Downloading your project…";
  }

  function trapFocus(e: KeyboardEvent) {
    if (e.key !== "Tab") return;
    const focusable = Array.from(
      dialogEl?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
</script>

{#if open}
  <div class="backdrop" onclick={close} role="presentation"></div>

  <div
    bind:this={dialogEl}
    class="dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="github-dialog-title"
    tabindex="-1"
    onkeydown={trapFocus}
  >
    <header class="dialog-header">
      <h2 id="github-dialog-title">
        {#if step === "connect" || step === "code"}Connect GitHub{:else if step === "repos"}Choose a repository{:else if step === "configure"}Open project{:else}Downloading…{/if}
      </h2>
      <button
        class="close"
        onclick={close}
        disabled={step === "cloning"}
        title="Close (Esc)"
        aria-label="Close"
      >&times;</button>
    </header>

    <div class="dialog-body">
      <!-- Persistent live region: announcing the user code from a node that
           already exists is reliable; a region mounted WITH its content is
           routinely skipped by screen readers. -->
      <div class="sr-only" role="status" aria-live="assertive">
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
            >Open Advanced setup</button>
          </p>
        {/if}
        <footer class="actions">
          <button class="ghost" onclick={close}>Cancel</button>
          <button bind:this={connectBtn} class="primary" onclick={connect} disabled={busy}>
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
              onclick={() => code && getPlatform().openExternal(code.verificationUri).catch(() => {})}
            >{code.verificationUri}</button>
          {/if}
        </p>
        <footer class="actions">
          <button class="ghost" onclick={close}>Cancel</button>
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
          <!-- First-time state: a GitHub App starts with zero installations.
               Never a dead end — install, refresh, and Advanced setup are all
               one click away, and returning to this window refreshes the list
               automatically. -->
          <p class="hint">
            No book projects found yet. print-md can only see repositories you
            choose on GitHub. We'll open that page for you — pick your book
            repositories, then come back here and the list will update.
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
                  {#if repo.private}<span class="badge">Private</span>{/if}
                </button>
              </li>
            {/each}
          </ul>
          {#if installUrl}
            <p class="hint subtle">
              Don't see your book?
              <button type="button" class="link-btn" onclick={openInstallPage}
              >Choose repositories on GitHub</button>
            </p>
          {/if}
        {/if}
        {#if onAdvancedSetup}
          <p class="hint subtle">
            Or paste a repository address in
            <button type="button" class="link-btn" onclick={goAdvancedSetup}
            >Advanced setup</button>
          </p>
        {/if}
        <footer class="actions">
          <button class="ghost" onclick={close}>Cancel</button>
          {#if !reposLoading && repos.length === 0}
            <button class="ghost" onclick={() => loadRepos()}>Refresh</button>
            {#if installUrl}
              <button bind:this={installBtn} class="primary" onclick={openInstallPage}>
                Choose repositories on GitHub
              </button>
            {/if}
          {/if}
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
            <button class="ghost" onclick={pickDestination}>Browse…</button>
          </div>
        </div>
        <footer class="actions">
          <button class="ghost" onclick={() => (step = "repos")}>Back</button>
          <button class="ghost" onclick={close}>Cancel</button>
          <button
            class="primary"
            onclick={startClone}
            disabled={!destination || !folderName.trim()}
          >Open project</button>
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

<!-- onfocus: the user installs the GitHub App in the browser and alt-tabs
     back — the repo list refreshes itself, no manual step. Svelte removes the
     listener with the component, and onWindowFocus self-gates on open/step. -->
<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape" && open) close();
  }}
  onfocus={onWindowFocus}
/>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: var(--app-backdrop);
    z-index: 1000;
  }
  .dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(560px, 92vw);
    max-height: 80vh;
    background: var(--app-surface);
    color: var(--app-text-secondary);
    border-radius: 8px;
    box-shadow: 0 14px 40px var(--app-shadow-lg);
    z-index: 1001;
    display: flex;
    flex-direction: column;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    overflow: hidden;
  }
  .dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid var(--app-border-subtle);
    flex-shrink: 0;
  }
  .dialog-header h2 { margin: 0; font-size: 16px; font-weight: 600; }
  .close {
    background: transparent;
    border: 0;
    color: var(--app-text-muted);
    font-size: 22px;
    line-height: 1;
    cursor: pointer;
    padding: 0 4px;
  }
  .close:hover:not(:disabled) { color: var(--app-text); }
  .close:disabled { opacity: 0.4; cursor: default; }
  .dialog-body {
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    overflow-y: auto;
    flex: 1;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  .hint { font-size: 13px; margin: 0; line-height: 1.5; }
  .hint.subtle { color: var(--app-text-faint); font-size: 12px; }
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
    font-family: ui-monospace, monospace;
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
    font-family: ui-monospace, monospace;
    font-size: 12px;
    color: var(--app-text-faint);
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
  .badge {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--app-text-faint);
    border: 1px solid var(--app-border);
    border-radius: 4px;
    padding: 1px 6px;
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
  .actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    padding-top: 16px;
    border-top: 1px solid var(--app-border-subtle);
  }
  .actions button {
    padding: 6px 14px;
    font-size: 13px;
    border-radius: 4px;
    cursor: pointer;
    border: 1px solid transparent;
  }
  .actions button:disabled { opacity: 0.45; cursor: default; }
  .actions .primary { background: var(--app-focus-ring); color: var(--app-text-on-accent); }
  .actions .primary:not(:disabled):hover { background: var(--app-accent-hover); }
  .actions .ghost { background: transparent; color: var(--app-text-muted); border-color: var(--app-border); }
  .actions .ghost:hover { background: var(--app-surface-hover); color: var(--app-text); }
</style>
