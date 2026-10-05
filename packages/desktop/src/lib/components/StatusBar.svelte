<script lang="ts">
  /**
   * StatusBar — slim bottom bar hosting the book switcher, sync status
   * pill, save indicator, and the Problems badge (VS Code-style).
   *
   * Layout (left → right):
   *   [book switcher] [Problems badge] ··· [sync pill] [saving indicator] [settings] [help]
   *
   * The project you picked comes first, then what's wrong with it; everything
   * about saving and syncing is grouped at the far right beside the app
   * actions. Problems takes the slack in between.
   *
   * The Problems LIST is not in the bar: ProblemsPanel renders it as a row of
   * its own directly above the bar, in normal flow, so opening it pushes the
   * workspace up instead of covering the left panel and the editor (#307). The
   * bar itself carries only a compact badge (status icon + count); with nothing
   * to list it is inert — an empty list has nothing to open.
   *
   * The bar is always visible when a project is open (the saving indicator shows
   * "All changes saved" at rest, never blank), so both pieces of status are
   * readable at a glance — not sporadic or hard to see.
   *
   * PWA-clean: all host work via api.* routes (CLAUDE.md §8).
   * No node: builtins or gutterpress value imports.
   */
  import SyncStatusPill from "$lib/components/SyncStatusPill.svelte";
  import ProblemsPanel from "$lib/components/ProblemsPanel.svelte";
  import BookSwitcher from "$lib/components/BookSwitcher.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { api } from "$lib/api";
  import SaveStatusDialog from "$lib/components/SaveStatusDialog.svelte";
  import { saveStatusCopy, type SaveStatusActionId } from "$lib/save-status";
  import { canExpandProblems, problemCounts, problemsSummary } from "$lib/problems";
  import { onDestroy, onMount, tick } from "svelte";
  import type { SyncState } from "$lib/platform/contract";
  import type { ManualBackup } from "$lib/routes/sync-controller.svelte";
  import type { ProblemEntry } from "$lib/platform/dtos";
  import type { ProjectBookEntry } from "$lib/routes/project-session-controller.svelte";

  let isCompact = $state(false);

  function updateCompact() {
    isCompact = typeof window !== "undefined" && window.matchMedia("(max-width: 820px)").matches;
  }

  let {
    /** Currently-open project directory. Bar is shown when non-null. */
    projectDir = null as string | null,
    /** Source mode — sync pill and problems only shown for folder sources. */
    sourceMode = "folder" as "folder" | "url",
    /** Whether the project has sync capability (canSync). */
    canSync = false,
    /** Whether the project's repo has a configured remote at all (any protocol),
     *  even when Gutterpress can't auto-sync it (SSH, or HTTPS with no stored
     *  credential). Lets the "Online copy" row say syncing simply isn't set up —
     *  rather than "Kept on this computer", which wrongly implies no remote when
     *  one is in fact configured (user feedback). */
    hasRemote = false,
    /** Whether the project keeps local version history (canSnapshot) — true for
     *  any local-git project even without a syncable remote. Drives the pill so
     *  local-only projects still get a clickable "Version history" affordance. */
    canSnapshot = false as boolean | null,
    /** Current save phase from the editor buffer. */
    savePhase = "clean" as "clean" | "dirty" | "saving" | "error",
    /** Settings → Saving "Save edits automatically". Off, a dirty buffer is
     *  waiting for the author's Save, not about to save itself — so it reads
     *  "Unsaved changes", never "Saving…". */
    autoSave = true,
    /** Settings → Saving "Keep previous versions": Gutterpress makes versions itself. */
    autoVersions = true,
    /** Settings → Saving "Keep this book backed up online". */
    autoBackup = true,
    /** Whether a file is currently open in the editor. */
    fileOpen = false,
    /** Whether a manual force-save is in progress. */
    forceSaving = false,
    /** Whether a manual force-sync is in progress. */
    forceSyncing = false,
    /** Problem entries from the lint runner. */
    problems = [] as ProblemEntry[],
    /** Whether the project has not been checked yet: the lint is running, or
     *  the render that triggers it has not finished (the page passes
     *  `problemsLoading || rendering`). Until then the bar says "Checking…" —
     *  never "No problems", which would be a claim about a check that has not
     *  happened. */
    problemsLoading = false,
    /** Set when the lint API call itself failed — distinct from a clean run
     *  that found zero problems. Forwarded to ProblemsPanel's neutral (not
     *  green) error row (#28). */
    problemsError = null as string | null,
    /** Books in the open project's repo; switcher shows only when > 1. */
    books = [] as ProjectBookEntry[],
    /** The book the session currently targets. */
    activeBookDir = null as string | null,
    /** Called with a book's folder path when the author switches books. */
    onSwitchBook = undefined as ((path: string) => void) | undefined,
    /** Whether the problems panel body is expanded. Bindable. */
    problemsOpen = $bindable(false),
    /** Called when a problem entry is clicked. */
    onProblemSelect = undefined as ((p: ProblemEntry) => void) | undefined,
    /** Called when the sync pill needs the reconnect flow. */
    onReconnect = undefined as (() => void) | undefined,
    /** Called when the author clicks "Connect to sync online" in the summary
     *  (the `connect` state: an HTTPS remote Gutterpress isn't connected to).
     *  Routes to the same connect/reconnect flow as the pill. */
    onConnectOnline = undefined as (() => void) | undefined,
    /** Called when the sync/git status pill is clicked in a quiet state —
     *  receives the project's operation-log path (or null) to view the log. */
    onShowLog = undefined as ((logFilePath: string | null) => void) | undefined,
    /** Called when the author clicks "Save now". */
    onForceSave = undefined as (() => void) | undefined,
    /** Called when the author confirms "Repair online backup" in the dialog. */
    onRepair = undefined as (() => void | Promise<void>) | undefined,
    /** Called when the author clicks "Back up now" in the dialog. */
    onForceSync = undefined as (() => void | Promise<void>) | undefined,
    /** Outcome of the last manual "Back up now" (manual backups bypass the
     *  host orchestrator, the only emitter of the status stream). */
    manualBackup = null as ManualBackup | null,
    /** Called when the author clicks "Save a version now" in the summary.
     *  Resolves when the version is saved (or rejects on failure) so the
     *  summary can refresh its "latest version" line and the parent can show
     *  the single confirmation toast. */
    onSaveVersion = undefined as (() => Promise<"saved" | "unchanged">) | undefined,
    /** Called when the author clicks "Turn on version history" for a plain
     *  folder. Resolves once the folder has history (and the page re-classified
     *  it), rejects on failure after showing its own toast. */
    onEnableVersionHistory = undefined as (() => Promise<void>) | undefined,
    /** Called for "See previous versions" — opens the activity view. */
    onShowVersions = undefined as (() => void) | undefined,
    /** Called for the online-backup rows that only explain: opens Book settings → Connections. */
    onOpenBookConnections = undefined as (() => void) | undefined,
    onOpenSettings = undefined as (() => void) | undefined,
    onOpenHelp = undefined as (() => void) | undefined,
  }: {
    projectDir?: string | null;
    sourceMode?: "folder" | "url";
    canSync?: boolean;
    hasRemote?: boolean;
    canSnapshot?: boolean | null;
    autoVersions?: boolean;
    autoBackup?: boolean;
    savePhase?: "clean" | "dirty" | "saving" | "error";
    autoSave?: boolean;
    fileOpen?: boolean;
    forceSaving?: boolean;
    forceSyncing?: boolean;
    problems?: ProblemEntry[];
    problemsLoading?: boolean;
    problemsError?: string | null;
    problemsOpen?: boolean;
    books?: ProjectBookEntry[];
    activeBookDir?: string | null;
    onSwitchBook?: (path: string) => void;
    onProblemSelect?: (p: ProblemEntry) => void;
    onReconnect?: () => void;
    onConnectOnline?: () => void;
    onShowLog?: (logFilePath: string | null) => void;
    onForceSave?: () => void;
    onForceSync?: () => void | Promise<void>;
    onRepair?: () => void | Promise<void>;
    manualBackup?: ManualBackup | null;
    onSaveVersion?: () => Promise<"saved" | "unchanged">;
    onEnableVersionHistory?: () => Promise<void>;
    onShowVersions?: () => void;
    onOpenBookConnections?: () => void;
    onOpenSettings?: () => void;
    onOpenHelp?: () => void;
  } = $props();

  /** Human-readable save label — always has a value so the bar never goes blank. */
  let saveLabel = $derived.by((): string => {
    if (!fileOpen) return "";
    if (forceSaving) return "Saving…";
    switch (savePhase) {
      case "dirty":
        return autoSave ? "Saving…" : "Unsaved changes";
      case "saving":
        return "Saving…";
      case "error":
        return "Couldn't save";
      case "clean":
      default:
        return "Edits saved";
    }
  });

  // ── "Where your work is kept" dialog ────────────────────────────────────────
  // Clicking the save indicator opens a modal that explains Saving / Versions /
  // Online backup separately and reconciles them ("saved, but not in a version
  // yet"). The words come from the pure `saveStatusCopy` ($lib/save-status);
  // this block only gathers the facts: the bar's own props, the live sync state
  // from the pill, and two lazily fetched version facts (newest version time
  // and how many files changed since — the PWA-clean api.vcs routes). No
  // $effect: fetches are event-driven (open / after an action / a save landing
  // while open), per CLAUDE.md §8.
  let summaryOpen = $state(false);
  let saveBtnEl = $state<HTMLButtonElement | null>(null);
  let latestVersionAt = $state<number | null>(null);
  let changedFiles = $state<number | null>(null);
  let stale = $state(false);
  // The host said automatic versions keep failing (a `source: "versions"` status).
  // Which book the flag belongs to; shown only for the open book and only while
  // automatic versions are on (a failing safety net you turned off isn't news).
  let versionsProblemDir = $state<string | null>(null);
  let versionsProblem = $derived(versionsProblemDir === projectDir && autoVersions);
  // Newest-wins sequencing for the version-facts requests, and the project the
  // dialog was opened for (closing it if the project changes underneath).
  let factsSeq = 0;
  let factsAt = 0;
  let dialogDir: string | null = null;
  let versionsLoad = $state<"loading" | "ready" | "error">("loading");
  // Backup state: the newest of the status stream's last event (the pill) and
  // the last manual "Back up now", each only for the book it was about, so
  // book A's "backed up" never shows on book B.
  let pillStatus = $state<{ dir: string | null; state: SyncState; at: string | null; seenAt: number }>({
    dir: null,
    state: "idle",
    at: null,
    seenAt: 0,
  });
  let live = $derived.by((): { state: SyncState; at: string | null } => {
    const p = pillStatus.dir === projectDir ? pillStatus : null;
    const m = manualBackup && manualBackup.dir === projectDir ? manualBackup : null;
    if (m && (!p || Date.parse(m.at) >= p.seenAt)) return { state: m.state, at: m.at };
    return p ? { state: p.state, at: p.at } : { state: "idle", at: null };
  });
  let liveSyncState = $derived(live.state);
  let lastSyncAt = $derived(live.at);
  let savingVersion = $state(false);
  // "Save a version now" found nothing new (a calm result, not a failure).
  let nothingNew = $state(false);
  let nowMs = $state(Date.now());
  // "Repair online backup" asks once ("armed") before it runs; the dialog's
  // Online backup section shows what it does and the Repair now / Cancel pair.
  let repairPhase = $state<"idle" | "armed" | "running">("idle");

  /** Autosave off and edits waiting for the author's Save. */
  let unsaved = $derived(savePhase === "dirty" && !autoSave && !forceSaving);

  let copy = $derived(
    saveStatusCopy({
      savePhase,
      autoSave,
      forceSaving,
      versions: {
        enabled: canSnapshot,
        automatic: autoVersions,
        load: versionsLoad,
        lastVersionAt: latestVersionAt,
        changedFiles,
        stale,
        savingVersion,
        problem: versionsProblem,
        nothingNew,
      },
      online: {
        state: liveSyncState,
        canSync,
        hasRemote,
        automatic: autoBackup,
        lastSyncAt,
        syncing: forceSyncing,
        repair: repairPhase,
      },
      now: nowMs,
    }),
  );

  // The save phase the version facts were read at: while the dialog is open a
  // landed save changes "N files not in a version yet", so a cheap timer
  // re-reads once the phase has moved (and never otherwise).
  let factsPhase: typeof savePhase = "clean";
  let refreshTimer: ReturnType<typeof setInterval> | null = null;

  async function fetchVersionFacts() {
    const dir = projectDir;
    if (!dir || !canSnapshot) return;
    const seq = ++factsSeq;
    factsPhase = savePhase;
    factsAt = Date.now();
    nowMs = factsAt;
    try {
      const [page, pending] = await Promise.all([
        api.vcs.listSnapshotsPage(dir, { limit: 1 }),
        api.vcs.unversionedChanges(dir),
      ]);
      // A newer request (or another project) superseded this one: drop it.
      if (seq !== factsSeq || projectDir !== dir) return;
      latestVersionAt = page.entries[0]?.timestamp ?? null;
      changedFiles = pending.changedFiles;
      stale = pending.stale;
      if ((changedFiles ?? 0) > 0 || stale) nothingNew = false;
      versionsLoad = "ready";
    } catch {
      // Non-fatal: the dialog says it couldn't check, rather than guessing.
      if (seq === factsSeq && projectDir === dir) versionsLoad = "error";
    }
  }

  function stopRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;
  }
  function openSummary() {
    summaryOpen = true;
    nothingNew = false;
    dialogDir = projectDir;
    versionsLoad = "loading";
    latestVersionAt = null;
    changedFiles = null;
    stale = false;
    void fetchVersionFacts();
    stopRefresh();
    refreshTimer = setInterval(() => {
      nowMs = Date.now();
      // The book changed underneath the dialog: close rather than show its facts.
      if (projectDir !== dialogDir) {
        closeSummary();
        return;
      }
      const phaseSettled = savePhase !== factsPhase && (savePhase === "clean" || savePhase === "error");
      if (phaseSettled || Date.now() - factsAt > 15_000) void fetchVersionFacts();
    }, 2000);
  }
  function closeSummary() {
    summaryOpen = false;
    if (repairPhase === "armed") repairPhase = "idle";
    stopRefresh();
    factsSeq++; // any in-flight lookup is now stale
  }
  function toggleSummary() {
    if (summaryOpen) closeSummary();
    else openSummary();
  }
  onDestroy(stopRefresh);

  /** A backup pass finished or changed state while the dialog is open: a sync
   *  can make a version, so re-read the version facts too. */
  function onPillState(state: SyncState, at: string | null | undefined) {
    const changed = state !== pillStatus.state || (at ?? null) !== pillStatus.at;
    pillStatus = { dir: projectDir, state, at: at ?? null, seenAt: Date.now() };
    // A completed backup pass makes a version first, so it also proves the
    // automatic-version safety net works again.
    if (state === "synced") versionsProblemDir = null;
    if (changed && summaryOpen) void fetchVersionFacts();
  }

  async function repairNow() {
    if (repairPhase === "running") return;
    repairPhase = "running";
    try {
      await onRepair?.();
    } finally {
      repairPhase = "idle";
    }
    if (manualBackup?.state === "synced") versionsProblemDir = null;
    if (summaryOpen) void fetchVersionFacts();
  }

  /** "Back up now": wait for the outcome, then re-read the version facts (a
   *  backup pass can make a version) and clear a stale version warning. */
  async function backUpNow() {
    await onForceSync?.();
    if (manualBackup?.state === "synced") versionsProblemDir = null;
    if (summaryOpen) void fetchVersionFacts();
  }

  async function saveVersionNow() {
    if (!onSaveVersion || savingVersion) return;
    savingVersion = true;
    try {
      const outcome = await onSaveVersion();
      nothingNew = outcome === "unchanged";
      versionsProblemDir = null;
      await fetchVersionFacts();
    } catch {
      // The parent surfaces the failure toast; keep the dialog calm.
    } finally {
      savingVersion = false;
    }
  }

  async function enableHistory() {
    if (!onEnableVersionHistory) return;
    try {
      await onEnableVersionHistory();
      versionsLoad = "loading";
      // canSnapshot flips through props after the page re-classifies.
      await tick();
      await fetchVersionFacts();
    } catch {
      // The parent surfaces the failure toast.
    }
  }

  function onSummaryAction(id: SaveStatusActionId) {
    switch (id) {
      case "save":
        onForceSave?.();
        break;
      case "saveVersion":
        void saveVersionNow();
        break;
      case "viewVersions":
        closeSummary();
        onShowVersions?.();
        break;
      case "enableVersionHistory":
        void enableHistory();
        break;
      case "connect":
        closeSummary();
        onConnectOnline?.();
        break;
      case "syncNow":
        void backUpNow();
        break;
      case "repair":
        repairPhase = "armed";
        break;
      case "repairCancel":
        repairPhase = "idle";
        break;
      case "repairNow":
        void repairNow();
        break;
      case "openBookConnections":
        closeSummary();
        onOpenBookConnections?.();
        break;
    }
  }

  /** CSS modifier class for the save indicator. */
  let saveClass = $derived.by((): string => {
    if (forceSaving) return "saving";
    switch (savePhase) {
      case "dirty":
      case "saving":
        return "saving";
      case "error":
        return "save-error";
      case "clean":
      default:
        return "saved";
    }
  });
  let saveStateIcon = $derived.by<"pen-line" | "refresh-cw" | "triangle-alert" | "circle-check">(() => {
    if (unsaved) return "pen-line";
    if (forceSaving || savePhase === "saving" || savePhase === "dirty") return "refresh-cw";
    if (savePhase === "error") return "triangle-alert";
    return "circle-check";
  });

  /** Show "Save now" when there are unsaved edits and no force-save in progress. */
  let showForceSave = $derived(
    fileOpen && (savePhase === "dirty" || savePhase === "saving") && !forceSaving,
  );

  // Show the status pill for any folder project that can sync OR keep local
  // version history. canSync projects get sync status; local-only projects get
  // the "Version history on" label (both open the operation log on click).
  let showSync = $derived(
    !!projectDir && sourceMode === "folder" && (canSync || canSnapshot),
  );

  // Problems access always renders — below 820px ProblemsPanel's `compact` prop
  // presents the expanded list as a full-viewport sheet instead of the row
  // above the bar, which has no room to be useful at narrow widths.
  let showProblems = $derived(!!projectDir && sourceMode === "folder");

  // The list is ProblemsPanel's and sits BEFORE the bar in the DOM, so Tab from
  // the toggle would skip past it. Like the editor toolbar's popups, opening
  // moves focus into the list, and Escape / Close there hand it back to the
  // toggle (passed down as `toggleEl`). No focus trap — it is a panel.
  let toggleEl = $state<HTMLButtonElement | null>(null);
  let panelRef = $state<{ focusList: () => void } | null>(null);

  function toggleProblems() {
    problemsOpen = !problemsOpen;
    if (problemsOpen) void tick().then(() => panelRef?.focusList());
  }

  // #307: the bar shows the problems state itself; the toggle exists only when
  // there is something to expand (see canExpandProblems).
  let counts = $derived(problemCounts(problems));
  let canExpand = $derived(canExpandProblems(problems, problemsError, problemsOpen));
  // Icon for the no-errors-no-warnings states (counts supply their own icons).
  let stripIcon = $derived.by<"info" | "refresh-cw" | "circle-check">(() =>
    problemsError ? "info" : problemsLoading ? "refresh-cw" : "circle-check",
  );
  /** The badge's accessible name. Always set: the badge is icons + bare
   *  counts, which say nothing to a screen reader. */
  let stripLabel = $derived(
    problemsLoading
      ? "Problems: checking"
      : problemsError
        ? "Problems: couldn't check"
        : counts.badge > 0
          ? `Problems: ${problemsSummary(counts)}`
          : "No problems",
  );

  // Book switcher: only when the open repo actually has more than one book.
  let showBookSwitcher = $derived(!!projectDir && sourceMode === "folder" && books.length > 1);

  onMount(updateCompact);
</script>

<svelte:window onresize={updateCompact} />

<!-- The Problems list: a row of its own directly above the bar, in normal flow
     (the page's .shell is a flex column), so opening it shrinks the workspace
     instead of covering the left panel's buttons or the editor's last lines. -->
{#if showProblems}
  <ProblemsPanel
    bind:this={panelRef}
    {problems}
    loading={problemsLoading}
    error={problemsError}
    bind:open={problemsOpen}
    onSelect={onProblemSelect}
    compact={isCompact}
    {toggleEl}
  />
{/if}

<div class="status-bar" role="status" aria-label="Application status">
  <!-- Left cluster: [book switcher]. The problems toggle sits directly to its
       right (the project you picked, then what's wrong with it); everything
       about SAVING and SYNCING is grouped at the far right, next to the
       settings and help buttons. -->
  <div class="status-left">
    {#if showBookSwitcher}
      <BookSwitcher {books} {activeBookDir} onSelect={(path) => onSwitchBook?.(path)} />
    {/if}
  </div>

  <!-- Problems: a compact badge — status icon + count — immediately right of
       the book switcher. A button (opens ProblemsPanel) only while there is
       something to list (#307); otherwise the same badge, inert. The accessible
       name carries what the badge only shows as icons. -->
  {#if showProblems}
    <div class="status-problems">
      {#if canExpand}
        <button
          bind:this={toggleEl}
          class="toggle-strip"
          onclick={toggleProblems}
          aria-expanded={problemsOpen}
          aria-controls="problems-body"
          aria-label={stripLabel}
          title={`${stripLabel} — ${problemsOpen ? "click to collapse" : "click to expand"}`}
        >
          {#if counts.badge > 0}
            {#if counts.errors > 0}
              <span class="strip-count error-count">
                <Icon name="circle-x" size={13} />
                {counts.errors}
              </span>
            {/if}
            {#if counts.warnings > 0}
              <span class="strip-count warning-count">
                <Icon name="triangle-alert" size={13} />
                {counts.warnings}
              </span>
            {/if}
          {:else}
            <span class="strip-count" class:ok={!problemsError && !problemsLoading}>
              <Icon name={stripIcon} size={13} />
              {#if !problemsError && !problemsLoading}0{/if}
            </span>
          {/if}
        </button>
      {:else}
        <span class="strip-idle" role="img" aria-label={stripLabel} title={stripLabel}>
          <span class="strip-count" class:ok={!problemsLoading}>
            <Icon name={problemsLoading ? "refresh-cw" : "circle-check"} size={13} />
            {#if !problemsLoading}0{/if}
          </span>
        </span>
      {/if}
    </div>
  {/if}

  <!-- Right cluster: [sync pill] | [save indicator] [Save now] -->
  <div class="status-right">
    {#if showSync}
      {#key projectDir}
        <SyncStatusPill
          {projectDir}
          onReconnect={onReconnect}
          onDetails={onShowLog}
          onSyncState={onPillState}
          versionsAlert={versionsProblem}
          onVersionsProblem={() => (versionsProblemDir = projectDir)}
        />
      {/key}
    {/if}
    {#if showSync && fileOpen}
      <span class="status-sep" aria-hidden="true"></span>
    {/if}
    {#if fileOpen}
      <button
        bind:this={saveBtnEl}
        type="button"
        class="save-indicator {saveClass}"
        aria-haspopup="dialog"
        aria-expanded={summaryOpen}
        onclick={toggleSummary}
        title={unsaved ? "You have unsaved changes — click for details" : savePhase === "dirty" || savePhase === "saving" ? "Pending changes are being saved — click for details" : "Where your work is kept — click for details"}
      ><Icon name={saveStateIcon} size={13} /><span class="save-text" aria-live="polite" aria-atomic="true">{saveLabel}</span></button>
    {/if}
    {#if showForceSave}
      <button
        class="status-action"
        onclick={onForceSave}
        disabled={forceSaving}
        aria-label="Save changes now"
        title="Save changes now"
      >Save now</button>
    {/if}
  </div>

  <div class="shell-actions" aria-label="Application actions">
    <button class="status-icon-btn" onclick={() => onOpenSettings?.()} title="App preferences (Ctrl+,)" aria-label="App preferences">
      <Icon name="settings" size={14} />
    </button>
    <button class="status-icon-btn" onclick={onOpenHelp} title="Help and about" aria-label="Help and about">
      <Icon name="circle-help" size={14} />
    </button>
  </div>
</div>

{#if summaryOpen}
  <SaveStatusDialog {copy} triggerEl={saveBtnEl ?? undefined} onAction={onSummaryAction} onClose={closeSummary} />
{/if}

<style>
  .status-bar {
    display: flex;
    align-items: stretch;
    flex-shrink: 0;
    background: var(--app-surface-raised);
    border-top: 1px solid var(--app-border);
    /* The bar is one flex row in normal document flow. The Problems list is not
       part of it — ProblemsPanel renders that as its own row directly above. */
    position: relative;
    z-index: var(--app-z-popover);
    /* The save summary and book switcher open upward out of the bar. */
    overflow: visible;
  }

  /* ── Left cluster (book switcher) ─────────────────────────────────────── */
  .status-left {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px;
    min-height: 28px;
    flex: 0 0 auto;
    min-width: 0;
  }
  /* Empty when no book switcher shows — drop its padding so the problems
     panel starts flush at the left edge instead of behind a phantom gap. */
  .status-left:empty {
    padding: 0;
  }

  /* ── Right cluster (sync + save) ──────────────────────────────────────── */
  .status-right {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px;
    min-height: 28px;
    flex: 0 0 auto;
    min-width: 0;
    /* Hugs the right even when the problems toggle (the flex-grower) is
       absent, so the save/sync group always sits beside the app actions. */
    margin-left: auto;
  }

  /* Vertical separator between sync pill and save indicator. */
  .status-sep {
    width: 1px;
    height: 14px;
    background: var(--app-border-strong);
    flex-shrink: 0;
  }

  /* ── Status action buttons (Save now / Sync now) ─────────────────────── */
  .status-action {
    font-size: 11px;
    white-space: nowrap;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    padding: 1px 6px;
    border: 1px solid var(--app-border-strong);
    border-radius: 3px;
    background: transparent;
    color: var(--app-text-secondary);
    cursor: pointer;
    line-height: 1.4;
    transition: color 0.12s, background 0.12s, border-color 0.12s;
    flex-shrink: 0;
  }
  .status-action:hover:not(:disabled) {
    color: var(--app-text);
    background: var(--app-surface-hover);
    border-color: var(--app-border-strong);
  }
  .status-action:focus-visible {
    outline: 2px solid var(--app-focus-ring);
    outline-offset: 1px;
  }
  .status-action:disabled {
    opacity: 0.5;
    cursor: default;
  }

  /* ── Bare icon button (settings, help) ───────────────────────────────────── */
  .status-icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    /* 14px glyph + 5px padding = 24x24 hit area (WCAG 2.5.8); the -3px margin
       keeps the layout footprint at 18x18 so the bar height is unchanged. */
    padding: 5px;
    margin: -3px;
    border: none;
    background: transparent;
    color: var(--app-text-secondary);
    cursor: pointer;
    border-radius: 3px;
    flex-shrink: 0;
    transition: color 0.12s, background 0.12s;
  }
  .status-icon-btn:hover:not(:disabled) {
    color: var(--app-text);
    background: var(--app-surface-hover);
  }
  .status-icon-btn:focus-visible {
    outline: 2px solid var(--app-focus-ring);
    outline-offset: 1px;
  }
  .status-icon-btn:disabled {
    cursor: default;
  }

  /* ── Save indicator (a button that opens the "Where your work is kept" dialog) ── */
  .save-indicator {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    white-space: nowrap;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    transition: color 0.15s;
    background: transparent;
    border: none;
    padding: 2px 4px;
    border-radius: 3px;
    cursor: pointer;
  }
  .save-indicator:hover { background: var(--app-surface-hover); }
  .save-indicator:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 1px; }

  /* Resting (saved): visible but calm — not faint enough to miss. */
  .save-indicator.saved {
    color: var(--app-text-secondary);
  }
  /* In-flight (saving / dirty): slightly more prominent. */
  .save-indicator.saving {
    color: var(--app-text-secondary);
    font-style: italic;
  }
  /* Error: uses the app error token so it stands out. */
  .save-indicator.save-error {
    color: var(--app-error-text);
    font-weight: 600;
  }

  /* Narrow (the app's single-pane layout): the lower-priority items drop out.
     The save state stays — it is the one thing the bar is always for. */
  @media screen and (max-width: 820px) {
    .status-right :global(.sync-pill),
    .status-sep,
    .status-action {
      display: none;
    }
  }

  /* ── Problems badge ───────────────────────────────────────────────────── */
  /* Icon + count only — deliberately quiet. The list it opens is
     ProblemsPanel's own row above the bar. */
  .status-problems {
    flex: 0 0 auto;
    display: flex;
    min-width: 0;
  }
  .toggle-strip,
  .strip-idle {
    display: flex;
    box-sizing: border-box; /* the idle badge is a span: same 30px as the button */
    align-items: center;
    min-height: 30px;
    padding: 5px 10px;
    gap: 8px;
    border: none;
    /* A separator on the LEFT so it reads as a distinct group from the book
       switcher beside it. */
    border-left: 1px solid var(--app-border);
    font-size: 11px;
    color: var(--app-text-secondary);
  }
  .toggle-strip {
    background: transparent;
    cursor: pointer;
  }
  .toggle-strip:hover {
    background: var(--app-control-hover-bg);
  }
  .toggle-strip:focus-visible {
    outline: 2px solid var(--app-focus-ring);
    outline-offset: -2px;
  }
  .strip-count {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-variant-numeric: tabular-nums;
  }
  .error-count { color: var(--app-error-text); }
  .warning-count { color: var(--app-warning-text); }
  .strip-count.ok { color: var(--app-success-text); }

  .shell-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 8px;
    border-left: 1px solid var(--app-border);
    flex: 0 0 auto;
  }
</style>
