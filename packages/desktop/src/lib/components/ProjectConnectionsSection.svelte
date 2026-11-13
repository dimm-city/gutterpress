<script lang="ts">
  /**
   * ProjectConnectionsSection — Book setup → Online (it was "Online
   * copy"), built for two questions — "Is my work safe?" and "Can I go back /
   * try another draft?":
   *
   *   0. A banner from Drafts (RevisionsList), first, when a switch didn't
   *      finish or a repair kept saved copies.
   *   1. Status card — the one statement of whether the work is safe: the
   *      counts ("7 versions aren't online yet · 2 new from Grace" / "Everything
   *      is online") or the situation's title from `backupCard`
   *      (routes/backup-card.ts: version history off, not online yet, sign in,
   *      checking, offline, paused, can't find…), where the book is kept and
   *      when it was last checked, the "Send changes automatically" switch, ONE
   *      primary button (Back up now, or the situation's own) and a quiet Get latest when there is something
   *      to get. A sign-in step sits under it when one is needed.
   *   2. Waiting (WaitingChanges) — Going up / Coming down, each row opening
   *      Version history on its version; hidden when nothing is waiting.
   *   3. Saved versions — Save a version…, today's automatic versions in one
   *      line, the newest named versions, See all versions (the Version history
   *      screen over this one, `onBrowseVersions`). Beside it from ~1100 px:
   *   4. Drafts (RevisionsList) — separate lines of work.
   *   5. "Something wrong with the online copy?" — Check the connection, Repair
   *      (a confirm that names what would be set aside) and, under More…, Start
   *      over. It opens by itself only after two backups in a row failed for a
   *      reason other than being offline.
   *
   * What it reads comes from the shared online-copy snapshot
   * (`online-copy-cache`) and one shared first page of Version history
   * (`versionsPage`), which the status counts, Waiting and Saved versions all
   * use; a version's changed files are looked up once (they never change). The
   * tab paints at once from what it last read (`online-view-cache`).
   *
   * PWA-clean (§8): api.* routes only.
   */
  import { onMount, tick } from "svelte";
  import { api, type OnlineVersionEntry, type VersionChanges, type VersionEntry } from "#lib/api.ts";
  import { friendlyHostError, unwrapRouteError } from "#lib/errors.ts";
  import { cancelInlineConfirm, dialogBehavior, requestInlineConfirm, type InlineConfirmState } from "#lib/dialog.ts";
  import { useSettings } from "#lib/settings.svelte.ts";
  import { backupState, onlineCopyName } from "#lib/backup-state.ts";
  import { NOTHING_NEW_NOTICE, versionsLine } from "#lib/save-status.ts";
  import { savedSummary, versionTitle, waitingRows, whenRange, whenShort } from "#lib/routes/version-timeline.ts";
  import { backupCard, checkedAgo, repairSetAsideText, type CardAction } from "#lib/routes/backup-card.ts";
  import * as onlineCopy from "#lib/routes/online-copy-cache.ts";
  import BackupWizard from "#lib/components/BackupWizard.svelte";
  import GitHubConnect from "#lib/components/GitHubConnect.svelte";
  import GitServerForm from "#lib/components/GitServerForm.svelte";
  import Icon from "#lib/components/Icon.svelte";
  import RevisionsList from "#lib/components/RevisionsList.svelte";
  import WaitingChanges from "#lib/components/WaitingChanges.svelte";
  import * as view from "#lib/routes/online-view-cache.ts";
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
  // Reopening the tab paints from the last snapshot at once; the refresh behind it swaps in new data quietly.
  const seen = projectDir ? onlineCopy.peek(projectDir) : undefined;
  const seenView = projectDir ? view.peek(projectDir) : undefined;
  let loading = $state(!seen);
  let diag = $state<ProjectRemoteDiagnosis | null>(seen?.diag ?? null);
  let checking = $state(seen?.checking ?? false);
  let checkedAt = $state<number | null>(seen?.checkedAt ?? null);
  let revisions = $state<import("#lib/platform/contract.ts").RevisionList | null>(seen?.revisions ?? null);
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

  // This computer: the first page of versions (shared with Version history), what the newest
  // waiting ones changed, and the edits not in a version yet. Online: the versions not here yet.
  let page = $state<{ entries: VersionEntry[]; hasMore: boolean } | null>(seenView?.page ?? null);
  let changes = $state<Record<string, VersionChanges>>(seenView?.changes ?? {});
  let facts = $state<{ lastVersionAt: number | null; changedFiles: number | null; stale: boolean } | null>(seenView?.facts ?? null);
  let incoming = $state<OnlineVersionEntry[] | null>(seenView?.incoming ?? null);
  let incomingReason = $state<string | undefined>(seenView?.incomingReason);
  let incomingAt = $state<number | null>(seenView?.incomingAt ?? null);
  let nothingNew = $state(false);
  let savingVersion = $state(false);

  /** Versions on this computer not online yet (newest first, from the first page). */
  const goingUp = $derived(page?.entries.filter((e) => e.backedUp === false) ?? []);
  /** The whole first page is waiting and there is more: the count is a floor. */
  const upAtLeast = $derived(!!page?.hasMore && goingUp.length > 0 && goingUp.length === page.entries.length);
  const upRows = $derived(waitingRows(goingUp, (e) => changes[e.id]));
  const downRows = $derived(incoming && waitingRows(incoming, (e) => ({ files: e.changes, more: e.moreChanges })));
  /** The open draft has never been sent online, so all of it goes up (its versions may carry no online mark). */
  const draftOnlyHere = $derived(revisions?.revisions.find((r) => r.current)?.where === "this-computer");
  const edits = $derived(facts?.changedFiles ?? 0);
  /** Who made the versions coming down, when it is one person. */
  const downFrom = $derived.by(() => {
    const authors = new Set((incoming ?? []).map((e) => e.author));
    const [only] = authors;
    return authors.size === 1 && only ? only : undefined;
  });
  const summary = $derived(page && savedSummary(page, now));

  const card = $derived(
    situation
      ? backupCard({
          situation,
          backup: decide > 0 ? { ...(backup ?? { state: "idle" as const, lastSyncAt: null }), decide } : backup,
          checking,
          where,
          github: onGitHub,
          autoBackup,
          now,
          bookName,
          drafts,
          ...(page ? { waiting: { up: goingUp.length, upAtLeast, edits: edits > 0, down: incoming?.length ?? 0, from: downFrom } } : {}),
        })
      : null,
  );

  /** A backup finished, or a version was restored: the newest versions may have changed. */
  export function refreshHistory() {
    onlineCopy.dropVersionsPage(projectDir ?? "");
    // A backup (automatic, from the status bar, or from here) may have sent drafts online or brought versions in.
    if (projectDir) {
      void onlineCopy.refresh(projectDir, { network: false });
      void loadVersions(projectDir);
      void loadIncoming(projectDir);
    }
  }

  function apply(snap: onlineCopy.OnlineCopySnapshot): void {
    diag = snap.diag;
    checking = snap.checking;
    checkedAt = snap.checkedAt;
    revisions = snap.revisions;
    // A snapshot can change the situation behind what is showing (a sign-in elsewhere made the book ready).
    if (projectDir && situation && situation !== readFor) loadAll(projectDir);
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
  }

  /** The situation the versions (and what is online) were last read for: `apply` reads them again when it changes. */
  let readFor: typeof situation = null;
  /** The first page of Version history (read once, also for "See all", so it opens at once) and, with an online copy that answers, what is online. */
  function loadAll(dir: string) {
    readFor = situation;
    if (situation && situation !== "no-versions") void loadVersions(dir);
    if (situation === "ready") void loadIncoming(dir);
  }

  /** After an action that changed where the book is kept: forget the snapshot and read it all again. */
  async function reload() {
    if (!projectDir) return;
    onlineCopy.invalidate(projectDir);
    loading = !diag;
    // Read everything again once the new snapshot lands (`apply`).
    readFor = null;
    try {
      apply(await onlineCopy.refresh(projectDir, { fresh: true }));
    } catch {
      diag = null;
    } finally {
      loading = false;
    }
  }

  /** Best-effort: what is showing stays, rather than a guess, when a read fails. */
  async function loadVersions(dir: string) {
    try {
      // The versions show as soon as they are read; counting edited files can take longer.
      const unsaved = api.vcs.unversionedChanges(dir);
      unsaved.catch(() => {});
      page = await onlineCopy.versionsPage(dir);
      view.update(dir, { page });
      void lookUpChanges(dir);
      const pending = await unsaved;
      facts = { lastVersionAt: page.entries[0]?.timestamp ?? null, changedFiles: pending.changedFiles, stale: pending.stale };
      view.update(dir, { facts });
      if ((pending.changedFiles ?? 0) > 0) nothingNew = false;
    } catch {
      // Keep what is showing.
    }
  }

  /** Waiting rows read at most this many; a version is looked up once, ever (what it changed never changes). */
  const ROWS_LOOKED_UP = 5;
  const PER_ROW = 2;
  /** What the versions in the first Going up rows changed: the newest one or two of each row. */
  async function lookUpChanges(dir: string) {
    const ids: string[] = [];
    let i = 0;
    for (const row of upRows.slice(0, ROWS_LOOKED_UP)) {
      ids.push(...goingUp.slice(i, i + Math.min(row.count, PER_ROW)).map((e) => e.id));
      i += row.count;
    }
    const todo = ids.filter((id) => !changes[id]);
    if (!todo.length) return;
    const found = await Promise.all(todo.map((id) => api.vcs.versionChanges(dir, id).then((c) => [id, c] as const, () => null)));
    changes = { ...changes, ...Object.fromEntries(found.filter((f) => f !== null)) };
    view.update(dir, { changes });
  }

  /** The versions online that are not on this computer yet. */
  async function loadIncoming(dir: string) {
    try {
      const r = await api.vcs.onlineVersions(dir);
      incomingReason = r.reason;
      if (r.reason) {
        view.update(dir, { incomingReason: r.reason });
        return;
      }
      incoming = r.entries;
      incomingAt = r.checkedAt ? Date.parse(r.checkedAt) || Date.now() : Date.now();
      view.update(dir, { incoming, incomingReason: undefined, incomingAt });
    } catch {
      // Keep what is showing.
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
      void loadVersions(dir);
      void loadIncoming(dir);
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
      await loadVersions(projectDir);
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
      void loadVersions(projectDir);
    }
  }

  // ── The primary button ─────────────────────────────────────────────────────
  // The full pass is Back up now, with sending automatically on or off; Get latest sends nothing
  // (docs/ux-design-contract.md, Vocabulary).
  const LABELS: Record<Exclude<CardAction, null>, string> = {
    "turn-on-versions": "Turn on version history",
    "set-up-backup": "Put this book online…",
    "back-up": "Back up now",
    "get-changes": "Get latest",
    update: "Back up now",
    "try-again": "Try again",
    "sign-in": "Sign in",
    "review-decisions": "Choose…",
    "check-address": "Check the online link",
  };
  const busyLabel = (a: CardAction): string | null =>
    a === "turn-on-versions" && busy ? "Turning on…"
    : a === "back-up" || a === "update" || a === "try-again" ? (running === "back-up" ? "Backing up…" : null)
    : a === "get-changes" && running === "get-latest" ? "Getting the latest…"
    : null;
  /** Get latest beside the full pass: only when there is something to get and it isn't already the one button. */
  const offerGetLatest = $derived(situation === "ready" && !!onGetLatest && (!!incoming?.length || running === "get-latest") && card?.action !== "get-changes");

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
      message = `Started over from the online copy, with your files put back on top. A safety folder with everything as it was is kept at ${r.backupDir}. Open the book and send to save the result.`;
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

  /** Waiting shows only when something is: versions either way, edits not in a version yet, or a draft not online. */
  const showWaiting = $derived(situation === "ready" && (goingUp.length > 0 || !!downRows?.length || edits > 0 || draftOnlyHere));
  const needsSignIn = $derived(
    card?.action === "sign-in" || (signInOpen && !!card),
  );
</script>

<div class="online-copy" bind:this={sectionEl} tabindex="-1">
  {#if loading}
    <p class="hint span">Checking this book's online copy…</p>
  {:else if !diag || !card || !situation}
    <p class="hint span">Couldn't read this book's online status. <button class="ghost small" onclick={load}>Try again</button></p>
  {:else}
    <!-- 1. Is my work safe? One statement, where it is kept, and its one next step. -->
    <section class="section-card status {card.tone} span" aria-labelledby="online-status-title">
      <div class="status-row">
        <span class="status-icon"><Icon name={card.icon} size={20} /></span>
        <div class="status-text">
          <h3 id="online-status-title">{card.title}</h3>
          {#if card.detail}<p>{card.detail}</p>{/if}
          {#if situation === "ready"}
            <div class="status-meta">
              {#if card.showChecked && where}
                <span>{where}{#if checking}{" · "}<span class="spin" aria-hidden="true"></span> checking now…{:else if checkedAt !== null}{" · "}checked {checkedAgo(checkedAt, now)}{/if}</span>
              {/if}
              <label class="auto">
                <input type="checkbox" role="switch" checked={autoBackup} onchange={(e) => setAutoBackup(e.currentTarget.checked)} />
                Send changes automatically
              </label>
            </div>
          {/if}
          {#if card.note}<p class="note">{card.note}</p>{/if}
        </div>
        <div class="status-action">
          {#if offerGetLatest}
            <button class="quiet" onclick={() => void getLatest()} disabled={busy}>{running === "get-latest" ? "Getting the latest…" : "Get latest"}</button>
          {/if}
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
            <p class="hint">Keep sending with your usual tool, or ask whoever set up the online copy for its web address (it starts with https://) and Gutterpress can send it for you.</p>
          {:else}
            <p class="hint">This book's online copy is at {diag.remoteUrl}. Gutterpress sends only to web addresses that start with https://.</p>
          {/if}
        </div>
      {/if}

      {#if done}<p class="status-note done" role="status" bind:this={doneEl} tabindex="-1">{done}{#if repairBackup} <button class="link" onclick={showBackupFolder}>Show in folder</button>{/if}</p>{/if}
      {#if actionError}<p class="status-note error" role="alert" bind:this={errorEl} tabindex="-1">{actionError}</p>{/if}
    </section>

    {#if showWaiting}
      <!-- 2. What is waiting on each side; each row opens Version history on its version. -->
      <div class="span">
        <WaitingChanges
          up={upRows}
          upCount={goingUp.length}
          {upAtLeast}
          edits={edits || null}
          {draftOnlyHere}
          down={downRows}
          downCount={incoming?.length ?? 0}
          reason={incomingReason}
          {incomingAt}
          {checking}
          {now}
          onOpen={onBrowseVersions}
        />
      </div>
    {/if}

    {#if situation !== "no-versions" && projectDir}
      <!-- 3. Saved versions: save one now, and the way back. -->
      <section class="section-card saved" aria-labelledby="version-history-title">
        <header class="section-head">
          <div>
            <h3 id="version-history-title">Saved versions</h3>
            {#if facts}<p class="section-sub">{versionsLine({ ...facts, now })}</p>{/if}
          </div>
          <button class="app-btn-primary" onclick={() => void saveVersion()} disabled={busy || savingVersion || !onSaveVersion}>
            {savingVersion ? "Saving…" : "Save a version…"}
          </button>
        </header>
        {#if versionsProblem}
          <p class="section-note warn">
            Automatic versions aren't working right now. Try Save a version. If that fails, close any other program that
            might be using your book folder.
          </p>
        {/if}
        {#if nothingNew}<p class="section-note" role="status">{NOTHING_NEW_NOTICE}</p>{/if}
        {#if summary}
          <ul class="saved-list" aria-label="Saved versions">
            {#if summary.today}
              <li>
                <button class="saved-row" onclick={() => onBrowseVersions?.()} disabled={!onBrowseVersions}>
                  <span class="saved-title">Today · {summary.today.count}{summary.today.atLeast ? "+" : ""} automatic {summary.today.count === 1 && !summary.today.atLeast ? "version" : "versions"}</span>
                  <span class="saved-when">{whenRange(summary.today.from, summary.today.to, now)}</span>
                </button>
              </li>
            {/if}
            {#each summary.named as v (v.id)}
              <li>
                <button class="saved-row" onclick={() => onBrowseVersions?.(v.id)} disabled={!onBrowseVersions}>
                  <span class="saved-title"><span class="star"><Icon name="star" size={12} /></span>{versionTitle(v.message)}</span>
                  <span class="saved-when">{whenShort(v.timestamp, now)}</span>
                </button>
              </li>
            {/each}
            {#if !summary.today && !summary.named.length && page?.entries[0]}
              {@const v = page.entries[0]}
              <li>
                <button class="saved-row" onclick={() => onBrowseVersions?.(v.id)} disabled={!onBrowseVersions}>
                  <span class="saved-title">{versionTitle(v.message)}</span>
                  <span class="saved-when">{whenShort(v.timestamp, now)}</span>
                </button>
              </li>
            {/if}
            {#if !page?.entries.length}<li class="section-note">No versions yet.</li>{/if}
          </ul>
        {/if}
        <div class="section-foot">
          <button
            class="ghost"
            onclick={() => onBrowseVersions?.()}
            onpointerenter={() => projectDir && void onlineCopy.versionsPage(projectDir)}
            onfocus={() => projectDir && void onlineCopy.versionsPage(projectDir)}
            disabled={!onBrowseVersions}
          >
            See all versions <Icon name="chevron-right" size={14} />
          </button>
        </div>
      </section>

      <!-- 4. Drafts: other lines of work (its repair banner places itself first). -->
      <RevisionsList {projectDir} hasOnlineCopy={!!diag.remoteUrl} disabled={busy} onChanged={draftsChanged} />

      <!-- 5. The tools, out of the way. -->
      {#if situation === "ready"}
        <details class="trouble section-card span" bind:open={troubleOpen}>
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
              <div><strong>Repair</strong><p class="hint">Fixes sending that keeps failing. Gutterpress sets this book's version history aside, downloads a fresh copy from the online copy, then puts your current files back on top. Your current files don't change.</p></div>
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
    <header class="dlg-header"><h2 id="repair-title">Repair the online copy?</h2></header>
    <div class="dlg-body">
      <p>Repair sets this book's version history aside, downloads a fresh copy from the online copy, then puts your current files back on top. Your current files don't change, and you stay on the same draft. Then a version is saved and sent online. A draft that was only on this computer keeps its files and is sent online under its own name.</p>
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

  /* One column; from ~1100 px Saved versions and Drafts sit side by side, everything else spans. */
  .online-copy { display: grid; grid-template-columns: minmax(0, 1fr); align-items: start; gap: 14px; }
  .span, .online-copy > :global(.drafts-banner) { grid-column: 1 / -1; }
  /* Side by side, each card keeps its own height. */
  .online-copy > :global(.section-card) { align-self: start; }
  /* Drafts' repair banner is the first thing on the tab. */
  .online-copy > :global(.drafts-banner) { order: -1; }
  @media (min-width: 1100px) { .online-copy { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } }
  /* Focus lands on these after an action; they are not controls. */
  .online-copy, .done, .error { outline: none; }

  .section-card.status { border-left: 4px solid var(--app-border); }
  .section-card.status.ok { border-left-color: var(--app-success-strong); }
  .section-card.status.warn { border-left-color: var(--app-warning-border); }
  .section-card.status.pending { border-left-color: var(--app-info-text); }
  .status-row { display: flex; align-items: center; gap: 16px; padding: 18px 20px; }
  .status-icon {
    display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
    width: 44px; height: 44px; border-radius: 50%;
    background: var(--app-surface-sunken); color: var(--app-text-muted);
  }
  .status.ok .status-icon { background: var(--app-success-bg); color: var(--app-success-strong); }
  .status.warn .status-icon { background: var(--app-warning-bg); color: var(--app-warning-text); }
  .status.pending .status-icon { background: var(--app-info-bg); color: var(--app-info-text); }
  .status-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  .status-text h3 { margin: 0; font-size: 16px; font-weight: 600; color: var(--app-text); overflow-wrap: anywhere; }
  .status-text p { margin: 0; font-size: 13px; line-height: 1.45; color: var(--app-text-secondary); overflow-wrap: anywhere; }
  .status-text .note { font-size: 12px; color: var(--app-text-muted); }
  .status-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 16px; font-size: 13px; color: var(--app-text-secondary); }
  .status-meta > span { display: inline-flex; align-items: center; gap: 5px; overflow-wrap: anywhere; }
  .status-action { flex-shrink: 0; display: flex; align-items: center; gap: 6px; }
  /* Get latest: a quiet text button beside the one primary. */
  .status-action .quiet { border-color: transparent; background: none; color: var(--app-link); }
  .status-action .quiet:hover:not(:disabled) { color: var(--app-link-hover); background: var(--app-surface-hover); }
  .status-body {
    display: flex; flex-direction: column; align-items: flex-start; gap: 10px;
    padding: 0 20px 18px 80px;
  }
  .status-note { margin: 0; padding: 0 20px 16px 80px; font-size: 13px; }
  .done { color: var(--app-success-text); }
  @media (max-width: 720px) {
    .status-row { flex-wrap: wrap; }
    .status-action { width: 100%; justify-content: flex-end; }
    .status-body, .status-note { padding-left: 20px; }
  }

  /* The switch is Settings' (SettingsView.svelte), at the size of a line of text here. */
  .auto { display: inline-flex; align-items: center; gap: 6px; }
  .auto input[role="switch"] {
    appearance: none; flex-shrink: 0; position: relative; width: 30px; height: 18px; margin: 0;
    border: 1px solid var(--app-text-muted); border-radius: 9px; background: transparent; cursor: pointer;
  }
  .auto input[role="switch"]::before {
    content: ""; position: absolute; top: 3px; left: 3px; width: 10px; height: 10px;
    border-radius: 50%; background: var(--app-text-muted); transition: transform 0.15s;
  }
  .auto input[role="switch"]:checked { background: var(--app-focus-ring); border-color: var(--app-focus-ring); }
  .auto input[role="switch"]:checked::before { top: 1px; left: 1px; width: 14px; height: 14px; background: var(--app-text-on-accent); transform: translateX(12px); }
  .auto input[role="switch"]:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 2px; }
  @media (prefers-reduced-motion: reduce) { .auto input[role="switch"]::before { transition: none; } }

  .spin {
    width: 11px; height: 11px; border-radius: 50%; flex-shrink: 0;
    border: 2px solid var(--app-border); border-top-color: var(--app-accent);
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spin { animation-duration: 3s; } }

  /* Saved versions: today's automatic versions, then the named ones, each a soft row. */
  .section-card.saved .section-head { border-bottom: 0; }
  .saved-list { list-style: none; margin: 0; padding: 0 16px 14px; display: flex; flex-direction: column; gap: 6px; }
  .saved-row {
    display: flex; align-items: baseline; justify-content: space-between; gap: 10px; width: 100%;
    padding: 8px 12px; border: 1px solid var(--app-border-subtle); border-radius: 8px;
    background: var(--app-bg); color: var(--app-text); text-align: left;
  }
  .saved-row:hover:not(:disabled) { background: var(--app-surface-hover); }
  .saved-title { display: inline-flex; align-items: center; gap: 6px; min-width: 0; font-size: 13px; overflow-wrap: anywhere; }
  .saved-when { flex-shrink: 0; font-size: 12px; color: var(--app-text-muted); font-variant-numeric: tabular-nums; }
  .star { display: inline-flex; color: var(--app-warning-text); }
  .star :global(svg) { fill: currentColor; }
  .saved-list .section-note { padding: 0; }
  .warn { color: var(--app-warning-text); }

  .trouble { overflow: hidden; }
  .trouble summary {
    display: flex; align-items: center; gap: 6px;
    padding: 12px 20px; cursor: pointer; font-size: 13px; color: var(--app-text-secondary);
  }
  .trouble summary:hover { color: var(--app-text); }
  .trouble[open] summary :global(svg) { transform: rotate(90deg); }
  .tools { display: flex; flex-direction: column; }
  .tool {
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    padding: 10px 20px; border-top: 1px solid var(--app-border-subtle);
  }
  .tool.more { justify-content: flex-start; }
  .tool strong { font-size: 13px; font-weight: 600; color: var(--app-text); }
  .tool .hint { margin-top: 2px; }
  .tool button { flex-shrink: 0; }
  .tool .danger { color: var(--app-error-text); border-color: var(--app-error-text); }
  .result { display: flex; align-items: center; gap: 6px; margin: 0; padding: 4px 0 0; font-size: 12px; color: var(--app-text-secondary); overflow-wrap: anywhere; }
  .result.failed { color: var(--app-error-text); }
  .result :global(svg) { color: var(--app-success-strong); flex-shrink: 0; }
  .result.failed :global(svg) { color: var(--app-error-text); }

  .repair-dialog { width: min(480px, 92vw); }
  .repair-dialog .dlg-actions { padding-top: 12px; }
  .repair-dialog :global(.dlg-ghost:focus-visible) { outline: 2px solid var(--app-focus-ring); outline-offset: 2px; }
  .repair-dialog .dlg-body { display: flex; flex-direction: column; gap: 10px; padding: 16px 18px 6px; font-size: 13px; line-height: 1.5; color: var(--app-text-secondary); }
  .repair-dialog .dlg-body p { margin: 0; }
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
