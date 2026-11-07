<script lang="ts">
  /**
   * ProjectConnectionsSection — Book setup → Backup & history (it was "Online
   * copy"): three parts and a drawer, built for two questions — "Is my work
   * safe?" and "Can I go back / try another draft?":
   *
   *   1. Status card — one title, one line and at most one primary button, from
   *      the table in `backupCard` (routes/backup-card.ts): version history off,
   *      not backed up online yet (Back up online… opens BackupWizard), checking,
   *      safe, ahead, behind, both, decide, offline, sign-in lost, can't find,
   *      paused. A sign-in step sits under it when one is needed; "Checking the
   *      online copy…" / "Checked 20 s ago" says how fresh it is.
   *   2. History — the newest versions (the author's own note is the title),
   *      Save a version, See all (the Version history screen over this one,
   *      `onBrowseVersions`).
   *   3. Drafts (RevisionsList) — separate lines of work, plus any saved copies
   *      kept after a repair (#508).
   *   4. "Something wrong with the online copy?" — Check the connection, Repair
   *      (a confirm that names what would be set aside) and, under More…, Start
   *      over. It opens by itself only after two backups in a row failed for a
   *      reason other than being offline, and is left out while offline (Try
   *      again is the whole answer).
   *
   * What it reads comes from the shared online-copy snapshot
   * (`online-copy-cache`): the tab renders at once from the last one, refreshes
   * behind itself only when it is over a minute old, and the first page of
   * Version history is fetched as the tab opens.
   *
   * PWA-clean (§8): api.* routes only.
   */
  import { onMount, tick } from "svelte";
  import { api, type VersionEntry } from "#lib/api.ts";
  import { friendlyHostError, unwrapRouteError } from "#lib/errors.ts";
  import { cancelInlineConfirm, dialogBehavior, requestInlineConfirm, type InlineConfirmState } from "#lib/dialog.ts";
  import { useSettings } from "#lib/settings.svelte.ts";
  import { backupState, onlineCopyName } from "#lib/backup-state.ts";
  import { NOTHING_NEW_NOTICE, versionsLine } from "#lib/save-status.ts";
  import { versionTitle, whenShort } from "#lib/routes/version-timeline.ts";
  import { agoFull, backupCard, checkedAgo, repairSetAsideText, type CardAction } from "#lib/routes/backup-card.ts";
  import * as onlineCopy from "#lib/routes/online-copy-cache.ts";
  import BackupWizard from "#lib/components/BackupWizard.svelte";
  import GitHubConnect from "#lib/components/GitHubConnect.svelte";
  import GitServerForm from "#lib/components/GitServerForm.svelte";
  import Icon from "#lib/components/Icon.svelte";
  import RevisionsList from "#lib/components/RevisionsList.svelte";
  import type { ToastController } from "#lib/components/Toast.svelte";
  import type { LastBackup } from "#lib/backup-state.ts";
  import type { ProjectRemoteDiagnosis, RemoteAccessResult } from "#lib/platform/contract.ts";

  let {
    projectDir,
    backup = null,
    versionsProblem = null,
    onVersionHistoryEnabled,
    onBackupSetUp,
    onProjectFilesChanged,
    onBackUpNow,
    onGetLatest,
    onRepair,
    onSaveVersion,
    onBrowseVersions,
    onCloseBook,
    onOpenAccounts,
    onReviewDecisions,
    decide = 0,
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
    /** Another draft was just opened, made or renamed: the files under `projectDir` changed under the open editor. */
    onProjectFilesChanged?: () => void;
    /** Back up now / Update / Try again: the page's own pass, which gets the latest then backs up (its toasts and editor refresh). */
    onBackUpNow?: () => Promise<void>;
    /** Get the changes: the page's own pass that gets the latest and sends nothing (its toasts and editor refresh). */
    onGetLatest?: () => Promise<void>;
    /** Repair the online copy: the page's repair (its toasts and editor refresh). */
    onRepair?: () => Promise<string | null | void>;
    /** Save a version now: the page's own save (its toast); resolves "unchanged" when there was nothing new. */
    onSaveVersion?: () => Promise<"saved" | "unchanged">;
    /** Open the Version history screen over this one, on a version or the newest. */
    onBrowseVersions?: (id?: string) => void;
    /** Close the open book: Start over from the online copy ends with it. */
    onCloseBook?: () => Promise<boolean>;
    /** Open the Accounts page, over this one. */
    onOpenAccounts?: () => void;
    /** "Choose…" on the two-takes card: opens the Problems list on them (the host reports a count once it can). */
    onReviewDecisions?: () => void;
    /** Passages with two takes waiting for a decision (the same count the status bar shows). */
    decide?: number;
    /** Start over's outcome: Book setup closes with the book, so it is a toast. */
    toast?: ToastController | null;
  } = $props();

  const settings = useSettings();

  // The shared snapshot: what the book's online copy is, whether it is being checked, and when it was.
  let loading = $state(true);
  let diag = $state<ProjectRemoteDiagnosis | null>(null);
  let checking = $state(false);
  let checkedAt = $state<number | null>(null);
  let revisions = $state<import("#lib/platform/contract.ts").RevisionList | null>(null);
  let now = $state(Date.now());
  const situation = $derived(diag ? backupState(diag) : null);
  /** What the last action changed ("Signed in to git.example.com."). */
  let done = $state<string | null>(null);
  /** The one action of the current situation is running. */
  let busy = $state(false);
  let running = $state<"back-up" | "get-latest" | "repair" | "start-over" | null>(null);
  let confirm = $state<InlineConfirmState>({});
  let actionError = $state<string | null>(null);
  // Where focus goes after an action: the button that ran it is disabled or
  // gone, and Escape only reaches Book setup from inside it.
  let sectionEl = $state<HTMLElement>();
  let doneEl = $state<HTMLElement>();
  let errorEl = $state<HTMLElement>();

  let bookName = $state<string | undefined>(undefined);
  let wizardOpen = $state(false);
  /** "Sign in again" was asked for on a card that otherwise shows another button (can't find). */
  let signInOpen = $state(false);

  const autoBackup = $derived(settings.current.versionHistory.autoSync);
  const onGitHub = $derived(diag?.provider === "github");
  /** "GitHub · ada/harbor-lights", or the server and path. */
  const where = $derived.by(() => {
    if (!diag?.remoteUrl) return "";
    const name = onlineCopyName(diag.remoteUrl);
    return onGitHub ? `GitHub · ${name.replace(/^[^/]*\//, "")}` : name;
  });

  /** Whether the open draft is online, and how many others exist only here: "safe" needs the open draft online. */
  const drafts = $derived.by(() => {
    const list = revisions?.revisions;
    const current = list?.find((r) => r.current);
    if (!list || !current) return undefined;
    return {
      currentBackedUp: current.where === "online" && !current.notBackedUp,
      othersOnlyHere: list.filter((r) => !r.current && r.where === "this-computer").length,
    };
  });

  const card = $derived(
    situation
      ? backupCard({ situation, backup: decide > 0 ? { ...(backup ?? { state: "idle" as const, lastSyncAt: null }), decide } : backup, checking, where, github: onGitHub, autoBackup, now, bookName, drafts })
      : null,
  );

  // This computer: the newest version and what has changed since.
  let facts = $state<{ lastVersionAt: number | null; changedFiles: number | null; stale: boolean } | null>(null);
  let nothingNew = $state(false);
  let savingVersion = $state(false);
  let revisionsEl = $state<{ refresh: () => void }>();

  /** The newest versions, for the History card. */
  let recent = $state<VersionEntry[]>([]);

  /** A backup finished, or a version was restored: the newest versions may have changed. */
  export function refreshHistory() {
    onlineCopy.dropVersionsPage(projectDir ?? "");
    // A backup (automatic, from the status bar, or from here) may have sent drafts online or brought versions in.
    if (projectDir) {
      void onlineCopy.refresh(projectDir, { network: false });
      void loadFacts(projectDir);
    }
  }

  function apply(snap: onlineCopy.OnlineCopySnapshot): void {
    diag = snap.diag;
    checking = snap.checking;
    checkedAt = snap.checkedAt;
    revisions = snap.revisions;
  }

  onMount(() => {
    const dir = projectDir;
    const stop = dir ? onlineCopy.subscribe(dir, apply) : () => {};
    const tickId = setInterval(() => (now = Date.now()), 15_000);
    void load();
    if (dir) void api.manifest.read(dir).then((m) => (bookName = m.title || undefined)).catch(() => {});
    return () => {
      stop();
      clearInterval(tickId);
      if (dir) onlineCopy.dropVersionsPage(dir);
    };
  });

  /** The tab shows what the last snapshot knew at once; it is refreshed behind itself when it is over a minute old. */
  async function load() {
    if (!projectDir) {
      loading = false;
      return;
    }
    try {
      apply(await onlineCopy.get(projectDir));
    } catch {
      diag = null;
    } finally {
      loading = false;
    }
    if (situation && situation !== "no-versions") {
      void loadFacts(projectDir);
      // The first page of Version history, so "See all" opens at once.
      onlineCopy.prefetchVersions(projectDir);
    }
  }

  /** After an action that changed where the book is kept: forget the snapshot and read it all again. */
  async function reload() {
    if (!projectDir) return;
    onlineCopy.invalidate(projectDir);
    loading = !diag;
    try {
      apply(await onlineCopy.refresh(projectDir, { fresh: true }));
    } catch {
      diag = null;
    } finally {
      loading = false;
    }
    if (situation && situation !== "no-versions") {
      void loadFacts(projectDir);
      onlineCopy.prefetchVersions(projectDir);
    }
  }

  /** Best-effort: the line says nothing rather than guessing when the lookup fails. */
  async function loadFacts(dir: string) {
    try {
      const [page, pending] = await Promise.all([api.vcs.listSnapshotsPage(dir, { limit: 5 }), api.vcs.unversionedChanges(dir)]);
      recent = page.entries;
      facts = { lastVersionAt: page.entries[0]?.timestamp ?? null, changedFiles: pending.changedFiles, stale: pending.stale };
      if ((pending.changedFiles ?? 0) > 0) nothingNew = false;
    } catch {
      facts = null;
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
      await reload();
      return "Version history is on. The first version is saved.";
    });

  /** The wizard's send failed after its window was closed: say so, and read the book's state again. */
  function wizardFailed(message: string) {
    toast?.error(message);
    void reload();
  }

  /** The wizard finished: the book is set up and sent. */
  function wizardDone() {
    if (projectDir) onBackupSetUp?.(projectDir);
    void reload();
  }

  // The server accepted the sign-in (GitServerForm checked it against this book's online copy
  // and saved it): the book is now set up to back up there.
  const serverConnected = (_result: { host: string }) =>
    act(async (dir) => {
      onBackupSetUp?.(dir);
      signInOpen = false;
      await reload();
      return null;
    });

  const githubConnected = () =>
    act(async (dir) => {
      onBackupSetUp?.(dir);
      signInOpen = false;
      await reload();
      return null;
    });

  // The page's passes, run from here; the sync controller's `backup` is the headline.
  const pass = (kind: "back-up" | "get-latest", run: (() => Promise<void>) | undefined) =>
    act(async (dir) => {
      running = kind;
      try {
        await run?.();
      } finally {
        running = null;
      }
      // A pass can bring in versions, send a new draft online and make a version: read it all again.
      onlineCopy.dropVersionsPage(dir);
      void onlineCopy.refresh(dir, { fresh: true });
      void loadFacts(dir);
      return null;
    });
  const backUpNow = () => pass("back-up", onBackUpNow);
  const getLatest = () => pass("get-latest", onGetLatest);

  // Save a version: the page saves and toasts; this line catches up.
  async function saveVersion() {
    if (!projectDir || !onSaveVersion || savingVersion) return;
    savingVersion = true;
    try {
      nothingNew = (await onSaveVersion()) === "unchanged";
      onlineCopy.dropVersionsPage(projectDir);
      await loadFacts(projectDir);
    } catch {
      // The page shows the failure toast.
    } finally {
      savingVersion = false;
    }
  }

  /** Another draft is open (or renamed): the files and the newest version may have changed. Nothing here goes online again. */
  function draftsChanged() {
    onProjectFilesChanged?.();
    if (projectDir) {
      onlineCopy.dropVersionsPage(projectDir);
      void loadFacts(projectDir);
    }
  }

  // ── The primary button ─────────────────────────────────────────────────────
  const LABELS: Record<Exclude<CardAction, null>, string> = {
    "turn-on-versions": "Turn on version history",
    "set-up-backup": "Back up online…",
    "back-up": "Back up now",
    "get-changes": "Get changes",
    update: "Update",
    "try-again": "Try again",
    "sign-in": "Sign in",
    "review-decisions": "Choose…",
    "check-address": "Check the online link",
  };
  const busyLabel = (a: CardAction): string | null =>
    a === "turn-on-versions" && busy ? "Turning on…"
    : a === "back-up" || a === "update" || a === "try-again" ? (running === "back-up" ? "Backing up…" : null)
    : a === "get-changes" && running === "get-latest" ? "Getting changes…"
    : null;

  function runAction(a: CardAction) {
    switch (a) {
      case "turn-on-versions": void turnOnVersions(); break;
      case "set-up-backup": wizardOpen = true; break;
      case "back-up": case "update": case "try-again": void backUpNow(); break;
      case "get-changes": void getLatest(); break;
      case "review-decisions": onReviewDecisions?.(); break;
      case "check-address":
        troubleOpen = true;
        void testConnection();
        break;
      case "sign-in": signInOpen = true; break;
      default: break;
    }
  }

  /** Back up automatically: the same switch as Settings → Saving. */
  function setAutoBackup(on: boolean) {
    settings.set({ versionHistory: { autoSync: on } });
    void api.sync.setAutoSync(on).catch(() => {});
  }

  // ── Something wrong with the online copy? ──────────────────────────────────
  let troubleOpen = $state(false);
  let moreOpen = $state(false);
  let testing = $state(false);
  let testResult = $state<string | null>(null);
  let testOk = $state(false);
  let repairAsk = $state(false);
  /** What a repair would set aside (the host's preview, when it has one). */
  let setAside = $state<{ revisions: string[]; versions: number } | null>(null);
  let setAsideLoading = $state(false);
  /** Saved copies from earlier repairs that this one would move into the safety folder too. */
  let savedCopies = $state(0);
  /** Where the last repair put the old history, for "Show in folder". */
  let repairBackup = $state<string | null>(null);

  // Two backups in a row that failed for a reason other than being offline: open the drawer.
  $effect(() => {
    if (!projectDir || !backup) return;
    const seen = backup as { lastSyncAt: string | null; message?: string; seenAt?: number };
    // Counted per distinct status (its time and message), so reopening the tab never adds one.
    const n = onlineCopy.noteBackupResult(projectDir, backup.state, `${seen.lastSyncAt}|${seen.seenAt ?? ""}|${seen.message ?? ""}`);
    // Only while the latest word is itself a failure (being offline, or a good backup, leaves the drawer as the author had it).
    if (n >= 2 && (backup.state === "error" || backup.state === "auth" || (backup.state as string) === "not-found")) troubleOpen = true;
  });

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
    if (result.ok) return "Gutterpress can reach the online copy and your sign-in works.";
    // Defence in depth: the lib's messages are URL-free by construction, but a
    // raw transport string could slip through the catch path — hide any URL
    // (which may carry credentials) and keep the message a readable length.
    const safe = result.message
      .replace(/https?:\/\/\S+/g, "(address hidden)")
      .slice(0, 200)
      .trim();
    return safe || "The test failed. See Troubleshooting > Logs for details.";
  }

  /** The repair confirm: says what would be set aside before anything happens. */
  async function askRepair() {
    repairAsk = true;
    setAside = null;
    if (!projectDir) return;
    // The host's preview (what exists only on this computer), when this version of it has one.
    setAsideLoading = true;
    try {
      const r = await api.remote.previewRepair(projectDir);
      // `unreadable`: this computer's history couldn't be read, so no honest list: keep the generic wording.
      setAside = r?.unreadable ? null : (r?.setAside ?? null);
      savedCopies = r?.unreadable ? 0 : (r?.repairCopies ?? 0);
    } catch {
      setAside = null;
    } finally {
      setAsideLoading = false;
    }
  }

  const setAsideText = $derived(repairSetAsideText(setAside, savedCopies));

  const showBackupFolder = () => {
    if (repairBackup) void api.remote.showRepairBackup(repairBackup).catch(() => {});
  };

  async function repair() {
    repairAsk = false;
    running = "repair";
    repairBackup = null;
    await act(async () => {
      repairBackup = (await onRepair?.()) || null;
      return repairBackup ? "Repaired. Your old version history is kept in a safety folder outside your book." : null;
    });
    running = null;
    if (projectDir) onlineCopy.dropVersionsPage(projectDir);
    void reload();
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
      message = `Started over from the online copy, with your files put back on top. A safety folder with everything as it was is kept at ${r.backupDir}. Open the book and back up to save the result.`;
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

  const when = (ms: number): string => new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  const needsSignIn = $derived(
    card?.action === "sign-in" || (signInOpen && !!card),
  );
</script>

<div class="online-copy" bind:this={sectionEl} tabindex="-1">
  {#if loading}
    <p class="hint">Checking this book's online copy…</p>
  {:else if !diag || !card || !situation}
    <p class="hint">Couldn't read this book's backup status. <button class="ghost small" onclick={load}>Try again</button></p>
  {:else}
    <!-- 1. Is my work safe? One sentence and its one next step. -->
    <section class="section-card status {card.tone}" aria-labelledby="online-status-title">
      <div class="status-row">
        <span class="status-icon"><Icon name={card.icon} size={18} /></span>
        <div class="status-text">
          <h3 id="online-status-title">{card.title}</h3>
          <p>{card.detail}</p>
          {#if card.showChecked && checkedAt !== null && !checking}<p class="checked">Checked {checkedAgo(checkedAt, now)}.</p>{/if}
          {#if card.note}<p class="note">{card.note}</p>{/if}
        </div>
        <div class="status-action">
          {#if card.action && card.action !== "sign-in" && (card.action !== "review-decisions" || onReviewDecisions)}
            <button class="app-btn-primary" onclick={() => runAction(card.action)} disabled={busy}>
              {busyLabel(card.action) ?? LABELS[card.action]}
            </button>
          {/if}
          {#if card.secondary}
            <button class="ghost" onclick={() => runAction(card.secondary ?? null)} disabled={busy}>{card.secondary === "sign-in" ? "Sign in again" : LABELS[card.secondary]}</button>
          {/if}
        </div>
      </div>

      {#if situation === "ready" && checking}
        <p class="check-line" role="status"><span class="spin" aria-hidden="true"></span> Checking the online copy…</p>
      {/if}

      {#if needsSignIn && situation !== "own-tools"}
        <div class="status-body">
          {#if onGitHub}
            <GitHubConnect primary label="Sign in to GitHub" onConnected={githubConnected} />
          {:else}
            <GitServerForm host={diag.remoteHost ?? ""} tokenUrl={diag.tokenSettingsUrl} repoUrl={diag.remoteUrl} submitLabel="Sign in" showTitle={false} onConnected={serverConnected} />
          {/if}
        </div>
      {:else if situation === "own-tools"}
        <div class="status-body">
          {#if diag.remoteProtocol === "ssh"}
            <p class="hint">Keep backing up with your usual tool, or ask whoever set up the online copy for its web address (it starts with https://) and Gutterpress can back it up for you.</p>
          {:else}
            <p class="hint">This book's online copy is at {diag.remoteUrl}. Gutterpress backs up only to web addresses that start with https://.</p>
          {/if}
        </div>
      {/if}

      {#if done}<p class="status-note done" role="status" bind:this={doneEl} tabindex="-1">{done}{#if repairBackup} <button class="link" onclick={showBackupFolder}>Show in folder</button>{/if}</p>{/if}
      {#if actionError}<p class="status-note error" role="alert" bind:this={errorEl} tabindex="-1">{actionError}</p>{/if}
    </section>

    {#if situation !== "no-versions" && projectDir}
      <!-- 2. History: where you have been, and the way back. -->
      <section class="section-card" aria-labelledby="version-history-title">
        <header class="section-head">
          <div>
            <h3 id="version-history-title">History</h3>
            {#if facts}<p class="section-sub">{versionsLine({ ...facts, now: Date.now() })}</p>{/if}
          </div>
          <div class="head-actions">
            <button class="ghost" onclick={() => void saveVersion()} disabled={busy || savingVersion || !onSaveVersion}>
              <Icon name="save" size={14} /> {savingVersion ? "Saving…" : "Save a version"}
            </button>
            <button
              class="ghost"
              onclick={() => onBrowseVersions?.()}
              onpointerenter={() => projectDir && onlineCopy.prefetchVersions(projectDir)}
              onfocus={() => projectDir && onlineCopy.prefetchVersions(projectDir)}
              disabled={!onBrowseVersions}
            >
              <Icon name="history" size={14} /> See all
            </button>
          </div>
        </header>
        {#if versionsProblem}
          <p class="section-note warn">
            Automatic versions aren't working right now. Try Save a version. If that fails, close any other program that
            might be using your book folder.
          </p>
        {/if}
        {#if nothingNew}<p class="section-note" role="status">{NOTHING_NEW_NOTICE}</p>{/if}
        <ul class="recent" aria-label="Newest versions">
          {#each recent as v (v.id)}
            <li>
              <button class="recent-row" onclick={() => onBrowseVersions?.(v.id)} disabled={!onBrowseVersions}>
                <span class="recent-main">
                  <span class="recent-title">{versionTitle(v.message)}</span>
                  <span class="recent-sub">{whenShort(v.timestamp, now)} · {agoFull(v.timestamp, now)}</span>
                </span>
                {#if v.backedUp === true}<span class="where ok"><Icon name="circle-check" size={13} /> Backed up</span>{/if}
                {#if v.backedUp === false}<span class="where"><Icon name="laptop" size={13} /> Only on this computer</span>{/if}
                <Icon name="chevron-right" size={14} />
              </button>
            </li>
          {:else}
            <li class="section-note">No versions yet.</li>
          {/each}
        </ul>
        <div class="section-foot">
          <button class="ghost small" onclick={() => onBrowseVersions?.()} disabled={!onBrowseVersions}>Go back to one of these…</button>
          {#if situation === "ready"}
            <label class="auto">
              <input type="checkbox" checked={autoBackup} onchange={(e) => setAutoBackup(e.currentTarget.checked)} />
              Back up automatically
            </label>
          {/if}
        </div>
      </section>

      <!-- 3. Drafts: other lines of work, and (after a repair) the saved copies. -->
      <RevisionsList bind:this={revisionsEl} {projectDir} hasOnlineCopy={!!diag.remoteUrl} disabled={busy} onChanged={draftsChanged} />

      <!-- 4. The tools, out of the way. -->
      {#if situation === "ready"}
        <details class="trouble section-card" bind:open={troubleOpen}>
          <summary><Icon name="chevron-right" size={13} /> Something wrong with the online copy?</summary>
          <div class="tools">
            <div class="tool">
              <div>
                <strong>Check the connection</strong>
                {#if testResult}
                  <p class="result" class:failed={!testOk} role="status"><Icon name={testOk ? "circle-check" : "triangle-alert"} size={14} /> {testResult}</p>
                {/if}
                <p class="hint">Checks that Gutterpress can reach the online copy and that your sign-in works. Nothing is changed or uploaded.{#if backup?.state === "offline"}{" "}A network setting (a proxy or a firewall) can look like being offline.{/if}</p>
              </div>
              <button class="ghost small" onclick={() => void testConnection()} disabled={busy || testing}>{testing ? "Checking…" : "Check the connection"}</button>
            </div>
            {#if onOpenAccounts && onGitHub}
              <div class="tool">
                <div><strong>Sign in again</strong><p class="hint">Opens Accounts, where you sign in to GitHub again.</p></div>
                <button class="ghost small" onclick={onOpenAccounts}>Sign in again</button>
              </div>
            {/if}
            <div class="tool">
              <div><strong>Repair</strong><p class="hint">Fixes backups that keep failing. Gutterpress sets this book's version history aside, downloads a fresh copy from the online copy, then puts your current files back on top. Your current files don't change.</p></div>
              <button class="ghost small" onclick={() => void askRepair()} disabled={busy}>{running === "repair" ? "Repairing…" : "Repair…"}</button>
            </div>
            {#if !moreOpen}
              <div class="tool more"><button class="link" onclick={() => (moreOpen = true)}>More…</button></div>
            {:else}
              <div class="tool">
                <div><strong>Start over from the online copy</strong><p class="hint">The last resort. Keeps a safety folder with everything as it is now, downloads a fresh start from the online copy, then puts your files back on top. The book closes at the end.</p></div>
                <button
                  class="ghost small danger"
                  onclick={() => void startOver()}
                  onblur={() => (confirm = cancelInlineConfirm(confirm, "start-over"))}
                  disabled={busy}
                >{running === "start-over" ? "Working…" : confirm["start-over"] ? "Really start over?" : "Start over…"}</button>
              </div>
            {/if}
          </div>
        </details>
      {/if}
    {/if}
  {/if}
</div>

{#if wizardOpen && projectDir}
  <BackupWizard {projectDir} onClose={() => (wizardOpen = false)} onDone={wizardDone} onFailed={wizardFailed} />
{/if}

{#if repairAsk}
  <div class="dlg-backdrop" role="presentation" onclick={() => (repairAsk = false)}></div>
  <div class="dlg-shell repair-dialog" use:dialogBehavior={{ onClose: () => (repairAsk = false), labelledBy: "repair-title", initialFocus: ".dlg-ghost" }}>
    <header class="dlg-header"><h2 id="repair-title">Repair backups?</h2></header>
    <div class="dlg-body">
      <p>Repair sets this book's version history aside, downloads a fresh copy from the online copy, then puts your current files back on top. Your current files don't change, and you stay on the same draft. Then a version is saved and backed up. A draft that was only on this computer keeps its files and is backed up online under its own name.</p>
      <p class:checking-aside={setAsideLoading}>{setAsideLoading ? "Checking what is only on this computer…" : setAsideText}</p>
    </div>
    <footer class="dlg-actions">
      <button class="dlg-ghost" onclick={() => (repairAsk = false)}>Cancel</button>
      <button class="dlg-primary app-btn-primary" onclick={() => void repair()} disabled={setAsideLoading}>Repair</button>
    </footer>
  </div>
{/if}

<style>
  @import "../styles/config-section-shared.css";
  @import "../styles/dialog-shell.css";

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
  .status-action { flex-shrink: 0; display: flex; gap: 6px; }
  .status-body {
    display: flex; flex-direction: column; align-items: flex-start; gap: 10px;
    padding: 0 16px 16px 66px;
  }
  .status-note { margin: 0; padding: 0 16px 14px 66px; font-size: 13px; }
  .done { color: var(--app-success-text); }
  .check { display: flex; gap: 6px; align-items: center; font-size: 13px; }
  .head-actions { display: flex; gap: 6px; flex-shrink: 0; }
  .recent { list-style: none; margin: 0; padding: 0; }
  .recent li + li { border-top: 1px solid var(--app-border-subtle); }
  .recent-row {
    display: flex; align-items: center; gap: 12px; width: 100%; padding: 9px 12px 9px 16px;
    border: 0; border-radius: 0; background: none; color: var(--app-text-muted); text-align: left;
  }
  .recent-row:hover:not(:disabled) { background: var(--app-surface-hover); }
  .recent-title { font-size: 13px; font-weight: 600; color: var(--app-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .trouble { overflow: hidden; }
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
  .result { margin: 0; font-size: 12px; color: var(--app-text-secondary); overflow-wrap: anywhere; }
  .result.failed { color: var(--app-error-text); }
  .tool .danger { color: var(--app-error-text); border-color: var(--app-error-text); }
  .warn { color: var(--app-warning-text); }
  .check-line { display: flex; align-items: center; gap: 6px; margin: 0; padding: 0 16px 12px 66px; font-size: 12px; color: var(--app-text-muted); }
  .check-line:empty { display: none; }
  .spin {
    width: 11px; height: 11px; border-radius: 50%; flex-shrink: 0;
    border: 2px solid var(--app-border); border-top-color: var(--app-accent);
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spin { animation-duration: 3s; } }
  .auto { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; font-size: 12.5px; color: var(--app-text-secondary); }
  .auto input { margin: 0; }
  .section-foot { display: flex; align-items: center; gap: 12px; }
  .status-text .checked, .status-text .note { margin: 4px 0 0; font-size: 12px; color: var(--app-text-muted); }
  .trouble summary { color: var(--app-text-secondary); display: flex; align-items: center; gap: 6px; }
  .trouble[open] summary :global(svg) { transform: rotate(90deg); }
  .result { display: flex; align-items: center; gap: 6px; padding: 4px 0 0; }
  .result :global(svg) { color: var(--app-success-strong); flex-shrink: 0; }
  .result.failed :global(svg) { color: var(--app-error-text); }
  .repair-dialog .dlg-actions { padding-top: 12px; }
  .repair-dialog :global(.dlg-ghost:focus-visible) { outline: 2px solid var(--app-focus-ring); outline-offset: 2px; }
  .recent-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .recent-sub { font-size: 12px; color: var(--app-text-muted); }
  .where { display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0; font-size: 12px; color: var(--app-text-muted); }
  .where.ok :global(svg) { color: var(--app-success-strong); }
  .repair-dialog { width: min(480px, 92vw); }
  .repair-dialog .dlg-body { display: flex; flex-direction: column; gap: 10px; padding: 16px 18px 6px; font-size: 13px; line-height: 1.5; color: var(--app-text-secondary); }
  .repair-dialog .dlg-body p { margin: 0; }
  .tool.more { justify-content: flex-start; }
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
