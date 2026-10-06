<script lang="ts">
  /**
   * StatusBar — slim bottom bar hosting the book switcher, the sync status
   * pill and the app actions (settings, help).
   *
   * Layout (left → right):
   *   [book switcher] ··· [sync pill] [settings] [help]
   *
   * The save state and the Problems badge are about the text being edited, so
   * they sit on the editor toolbar instead. This bar still owns the "Where
   * your work is kept" view the save indicator opens (it needs the sync
   * pill's live state): the page calls `toggleSummary(trigger)`.
   *
   * PWA-clean: all host work via api.* routes (CLAUDE.md §8).
   * No node: builtins or gutterpress value imports.
   */
  import SyncStatusPill from "$lib/components/SyncStatusPill.svelte";
  import BookSwitcher from "$lib/components/BookSwitcher.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { api } from "$lib/api";
  import SaveStatusView from "$lib/components/SaveStatusView.svelte";
  import { saveStatusCopy, type SaveStatusActionId } from "$lib/save-status";
  import { onDestroy, tick } from "svelte";
  import type { SyncState } from "$lib/platform/contract";
  import type { ManualBackup } from "$lib/routes/sync-controller.svelte";
  import type { ProjectBookEntry } from "$lib/routes/project-session-controller.svelte";

  let {
    /** Currently-open project directory. Bar is shown when non-null. */
    projectDir = null as string | null,
    /** Source mode — the sync pill only shows for folder sources. */
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
    /** Whether a manual force-save is in progress. */
    forceSaving = false,
    /** Whether a manual force-sync is in progress. */
    forceSyncing = false,
    /** Books in the open project's repo; switcher shows only when > 1. */
    books = [] as ProjectBookEntry[],
    /** The book the session currently targets. */
    activeBookDir = null as string | null,
    /** Called with a book's folder path when the author switches books. */
    onSwitchBook = undefined as ((path: string) => void) | undefined,
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
    forceSaving?: boolean;
    forceSyncing?: boolean;
    books?: ProjectBookEntry[];
    activeBookDir?: string | null;
    onSwitchBook?: (path: string) => void;
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

  // ── "Where your work is kept" view ──────────────────────────────────────────
  // The editor toolbar's save indicator opens a view that explains Saving / Versions /
  // Online backup separately and reconciles them ("saved, but not in a version
  // yet"). The words come from the pure `saveStatusCopy` ($lib/save-status);
  // this block only gathers the facts: the bar's own props, the live sync state
  // from the pill, and two lazily fetched version facts (newest version time
  // and how many files changed since — the PWA-clean api.vcs routes). No
  // $effect: fetches are event-driven (open / after an action / a save landing
  // while open), per CLAUDE.md §8.
  let summaryOpen = $state(false);
  let saveBtnEl = $state<HTMLElement | null>(null);
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
  /** Open or close the view from its trigger (the editor toolbar's save
   *  indicator), which gets focus back when it closes. */
  export function toggleSummary(trigger?: HTMLElement) {
    saveBtnEl = trigger ?? null;
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

  // Show the status pill for any folder project that can sync OR keep local
  // version history. canSync projects get sync status; local-only projects get
  // the "Version history on" label (both open the operation log on click).
  let showSync = $derived(
    !!projectDir && sourceMode === "folder" && (canSync || canSnapshot),
  );

  // Book switcher: only when the open repo actually has more than one book.
  let showBookSwitcher = $derived(!!projectDir && sourceMode === "folder" && books.length > 1);

</script>

<div class="status-bar" role="status" aria-label="Application status">
  <!-- Left cluster: [book switcher]; syncing is grouped at the far right,
       next to the settings and help buttons. -->
  <div class="status-left">
    {#if showBookSwitcher}
      <BookSwitcher {books} {activeBookDir} onSelect={(path) => onSwitchBook?.(path)} />
    {/if}
  </div>

  <!-- Right cluster: [sync pill] -->
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
  <SaveStatusView {copy} triggerEl={saveBtnEl ?? undefined} onAction={onSummaryAction} onClose={closeSummary} />
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
  /* Empty when no book switcher shows — drop its padding. */
  .status-left:empty {
    padding: 0;
  }

  /* ── Right cluster (sync) ──────────────────────────────────────── */
  .status-right {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px;
    min-height: 28px;
    flex: 0 0 auto;
    min-width: 0;
    margin-left: auto;
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

  /* Narrow (the app's single-pane layout): the sync pill drops out. */
  @media screen and (max-width: 820px) {
    .status-right :global(.sync-pill) {
      display: none;
    }
  }

  .shell-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 8px;
    border-left: 1px solid var(--app-border);
    flex: 0 0 auto;
  }
</style>
