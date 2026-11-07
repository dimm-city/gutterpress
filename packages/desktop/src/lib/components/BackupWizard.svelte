<script lang="ts">
  /**
   * BackupWizard — "Back up online…": a short three-step dialog that replaces
   * the inline set-up form (UX review §5), one screen and one button each:
   *
   *   1. Where should your book be kept?  GitHub (free account) / another
   *      service. "I don't have an account" opens github.com/signup.
   *   2. Sign in to GitHub — the code, big, with Copy (GitHubConnect runs the
   *      device flow). Skipped when GitHub is already signed in.
   *   3. Name your online copy — prefilled from the book's title, private by
   *      default, or "Use one I already made" (the cached list of empty ones).
   *      Then "Sending your book…" and a done screen.
   *
   * It does what the old form did (`api.remote.setUpBackup`); only the words,
   * the steps and the list's speed changed. A failed send keeps the empty
   * online copy that was made, so Try again reuses it instead of making a
   * second one.
   *
   * PWA-clean (§8): api.* routes only.
   */
  import { onMount } from "svelte";
  import { api } from "#lib/api.ts";
  import { dialogBehavior } from "#lib/dialog.ts";
  import { friendlyHostError, unwrapRouteError } from "#lib/errors.ts";
  import { suggestRepositoryName } from "#lib/backup-repo-name.ts";
  import { peekRepositories, refreshRepositories } from "#lib/routes/repo-list-cache.ts";
  import GitHubConnect from "#lib/components/GitHubConnect.svelte";
  import Icon from "#lib/components/Icon.svelte";
  import { OTHER_SERVER_GUIDE } from "#lib/components/GitServerForm.svelte";
  import type { RemoteConnection, RemoteRepository } from "#lib/platform/contract.ts";

  let {
    projectDir,
    onClose,
    onDone,
  }: {
    projectDir: string;
    onClose: () => void;
    /** The book is set up and its first backup is online: the parent re-reads the book's state. */
    onDone: () => void;
  } = $props();

  type Step = "where" | "other" | "signin" | "name" | "sending" | "done";
  let step = $state<Step>("where");
  let github = $state<RemoteConnection | null>(null);
  let repoName = $state("");
  let makePrivate = $state(true);
  let useExisting = $state(false);
  let emptyRepos = $state<RemoteRepository[]>([]);
  let reposLoading = $state(false);
  let reposError = $state<string | null>(null);
  let chosenRepo = $state("");
  let error = $state<string | null>(null);
  let sentTo = $state<{ fullName: string; private: boolean } | null>(null);

  const stepNumber = $derived(step === "where" || step === "other" ? 1 : step === "signin" ? 2 : 3);

  onMount(() => {
    void (async () => {
      github = await api.remote.getRemoteConnection().catch(() => null);
      try {
        repoName = suggestRepositoryName((await api.manifest.read(projectDir)).title);
      } catch {
        repoName = suggestRepositoryName(null);
      }
    })();
  });

  const chooseGitHub = () => {
    error = null;
    step = github?.connected ? "name" : "signin";
  };

  async function signedIn() {
    github = await api.remote.getRemoteConnection().catch(() => github);
    step = "name";
  }

  /** The empty online copies this account has: the list from this session at once, a fresh one behind it. */
  async function chooseExisting(on: boolean) {
    useExisting = on;
    error = null;
    if (!on) return;
    const cached = peekRepositories();
    if (cached) {
      emptyRepos = cached.filter((r) => r.maybeEmpty);
      if (!chosenRepo && emptyRepos[0]) chosenRepo = emptyRepos[0].fullName;
    } else reposLoading = true;
    reposError = null;
    try {
      emptyRepos = (await refreshRepositories()).filter((r) => r.maybeEmpty);
      if (!emptyRepos.some((r) => r.fullName === chosenRepo)) chosenRepo = emptyRepos[0]?.fullName ?? "";
    } catch (e) {
      if (!cached) reposError = friendlyHostError(e instanceof Error ? e.message : String(e));
    } finally {
      reposLoading = false;
    }
  }

  async function send() {
    const picked = emptyRepos.find((r) => r.fullName === chosenRepo);
    if (useExisting && !picked) {
      error = "Choose which empty online copy to use.";
      return;
    }
    error = null;
    step = "sending";
    try {
      const result = await api.remote.setUpBackup(
        projectDir,
        useExisting ? { kind: "existing", owner: picked!.owner, name: picked!.name } : { kind: "create", name: repoName.trim(), private: makePrivate },
      );
      if (result.status !== "connected") {
        // The online copy was made but sending the book failed: it is empty, so keep it
        // selected and let "Try again" reuse it instead of creating a second one.
        if (result.repository) {
          emptyRepos = [result.repository, ...emptyRepos.filter((r) => r.fullName !== result.repository!.fullName)];
          chosenRepo = result.repository.fullName;
          useExisting = true;
        }
        error = result.message;
        step = "name";
        return;
      }
      sentTo = { fullName: result.repository.fullName, private: result.repository.private };
      step = "done";
      onDone();
    } catch (e) {
      error = friendlyHostError(unwrapRouteError(e instanceof Error ? e.message : String(e)));
      step = "name";
    }
  }

  const open = (url: string) => void api.shell.openExternal(url).catch(() => {});
  const close = () => {
    if (step !== "sending") onClose();
  };
</script>

<div class="dlg-backdrop" role="presentation" onclick={close}></div>
<div class="dlg-shell wizard" use:dialogBehavior={{ onClose: close, labelledBy: "wizard-title", initialFocus: "button.choice, input, .dlg-primary" }}>
  <header class="dlg-header">
    <h2 id="wizard-title">
      {#if step === "where" || step === "other"}Where should your book be kept?
      {:else if step === "signin"}Sign in to GitHub
      {:else if step === "name"}Name your online copy
      {:else if step === "sending"}Sending your book…
      {:else}Your book is backed up{/if}
    </h2>
    {#if step !== "sending"}
      <button class="dlg-close" onclick={close} aria-label="Close" title="Close (Esc)"><Icon name="x" size={16} /></button>
    {/if}
  </header>

  <div class="dlg-body">
    {#if step !== "done" && step !== "sending"}<p class="steps" aria-label="Step {stepNumber} of 3">Step {stepNumber} of 3</p>{/if}

    {#if step === "where"}
      <button class="choice" onclick={chooseGitHub}>
        <Icon name="github" size={22} />
        <span><strong>GitHub <span class="free">(free account)</span></strong>
          <small>GitHub is a website that keeps your book and every earlier version safe. You'll need a free account.</small></span>
        <Icon name="chevron-right" size={16} />
      </button>
      <button class="choice" onclick={() => (step = "other")}>
        <Icon name="cloud" size={22} />
        <span><strong>Another service I use…</strong>
          <small>Such as GitLab, Gitea or Bitbucket.</small></span>
        <Icon name="chevron-right" size={16} />
      </button>
      <p class="hint">
        <button class="link" onclick={() => open("https://github.com/signup")}>I don't have a GitHub account <Icon name="external-link" size={11} /></button>
        Make one (it takes a minute), then come back here.
      </p>
    {:else if step === "other"}
      <p>Gutterpress can back up to other services too, but the online copy has to be set up there first, then connected to this book with the tool that service gives you.</p>
      <button class="link" onclick={() => open(OTHER_SERVER_GUIDE)}>How to back up there <Icon name="external-link" size={11} /></button>
    {:else if step === "signin"}
      <p>GitHub will ask you to type a short code. Gutterpress opens the page for you.</p>
      <GitHubConnect primary autoStart label="Sign in to GitHub" onConnected={signedIn} />
    {:else if step === "name"}
      <p class="hint ok"><Icon name="circle-check" size={14} /> Signed in to GitHub{github?.username ? ` as @${github.username}` : ""}.</p>
      {#if !useExisting}
        <label class="field">
          <span class="lbl">Name</span>
          <input class="input" bind:value={repoName} spellcheck="false" autocomplete="off" />
        </label>
        <label class="check">
          <input type="checkbox" bind:checked={makePrivate} />
          Private: only you can see it
        </label>
        <button class="link" onclick={() => void chooseExisting(true)}>Use one I already made</button>
      {:else}
        {#if reposLoading}
          <p class="hint" role="status">Searching your online copies…</p>
        {:else if reposError}
          <p class="error" role="alert">{reposError}</p>
        {:else if emptyRepos.length === 0}
          <p class="hint">
            No empty online copies found on your GitHub account. Make one on github.com (leave "Add a README" off), then come back.
          </p>
          <button class="ghost" onclick={() => open("https://github.com/new")}>Open github.com to make one…</button>
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
        <button class="link" onclick={() => void chooseExisting(false)}>Make a new one instead</button>
      {/if}
      {#if error}<p class="error" role="alert">{error}</p>{/if}
    {:else if step === "sending"}
      <p role="status">This can take a moment for a book with many pictures.</p>
      <div class="progress-track" aria-hidden="true"><div class="progress-fill"></div></div>
    {:else}
      <p class="done" role="status"><Icon name="circle-check" size={18} /> Done. Your book is backed up. Gutterpress will keep it up to date.</p>
      {#if sentTo}<p class="hint">Kept at {sentTo.fullName} on GitHub{sentTo.private ? " (private)" : ""}.</p>{/if}
    {/if}
  </div>

  <footer class="dlg-actions">
    {#if step === "where"}
      <button class="dlg-ghost" onclick={close}>Cancel</button>
    {:else if step === "other"}
      <button class="dlg-ghost" onclick={() => (step = "where")}>Back</button>
    {:else if step === "signin"}
      <button class="dlg-ghost" onclick={() => (step = "where")}>Back</button>
    {:else if step === "name"}
      <button class="dlg-ghost" onclick={() => (step = github?.connected ? "where" : "signin")}>Back</button>
      <button class="dlg-primary app-btn-primary" onclick={() => void send()} disabled={useExisting ? !chosenRepo : !repoName.trim()}>
        {error ? "Try again" : "Back up my book"}
      </button>
    {:else if step === "done"}
      <button class="dlg-primary app-btn-primary" onclick={onClose}>Close</button>
    {/if}
  </footer>
</div>

<style>
  @import "../styles/dialog-shell.css";

  .wizard { width: min(520px, 92vw); }
  .dlg-body { display: flex; flex-direction: column; gap: 12px; padding: 14px 20px 6px; font-size: 13px; color: var(--app-text-secondary); }
  .dlg-body p { margin: 0; line-height: 1.5; }
  .steps { font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--app-text-muted); }
  .choice {
    display: flex; align-items: center; gap: 14px; width: 100%; padding: 14px 16px; text-align: left;
    border: 1px solid var(--app-border); border-radius: 8px; background: var(--app-surface-raised); color: var(--app-text);
  }
  .choice:hover, .choice:focus-visible { border-color: var(--app-focus-ring); background: var(--app-surface-hover); }
  .choice > span { flex: 1; display: flex; flex-direction: column; gap: 3px; }
  .choice strong { font-size: 14px; }
  .choice .free { font-weight: 400; color: var(--app-text-muted); }
  .choice small { font-size: 12.5px; line-height: 1.45; color: var(--app-text-secondary); }
  .hint { font-size: 12.5px; color: var(--app-text-muted); }
  .hint.ok { display: flex; align-items: center; gap: 6px; color: var(--app-success-text); }
  .field { display: flex; flex-direction: column; gap: 5px; }
  .lbl { font-size: 12.5px; font-weight: 600; color: var(--app-text); }
  .input { box-sizing: border-box; width: 100%; padding: 8px 10px; font: inherit; font-size: 13px; }
  .check { display: flex; gap: 6px; align-items: center; }
  .error { color: var(--app-error-text); font-size: 12.5px; }
  .done { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; color: var(--app-success-text); }
  .link {
    display: inline-flex; align-items: center; gap: 3px; align-self: flex-start; padding: 0; border: 0; background: none;
    color: var(--app-link); font-size: 12.5px; text-decoration: underline; text-underline-offset: 2px;
  }
  .link:hover { color: var(--app-link-hover); }
  .progress-track { height: 6px; border-radius: 3px; background: var(--app-surface-sunken); overflow: hidden; }
  .progress-fill { width: 35%; height: 100%; border-radius: 3px; background: var(--app-focus-ring); animation: slide 1.2s ease-in-out infinite alternate; }
  @keyframes slide { from { margin-left: 0; } to { margin-left: 65%; } }
</style>
