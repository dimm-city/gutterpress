<script lang="ts">
  /**
   * StatusBar — slim bottom bar hosting the book switcher (C2), sync status
   * pill, save indicator, and the Problems panel toggle/body (VS Code-style).
   *
   * Layout (left → right):
   *   [book switcher] [sync pill] [saving indicator] ············ [Problems toggle]
   *
   * The bar is always visible when a project is open (the saving indicator shows
   * "All changes saved" at rest, never blank), so both pieces of status are
   * readable at a glance — not sporadic or hard to see.
   *
   * PWA-clean: all host work via api.* routes (CLAUDE.md §8 / ADR 0004).
   * No node: builtins or @dimm-city/print-md value imports.
   */
  import SyncStatusPill from "$lib/components/SyncStatusPill.svelte";
  import ProblemsPanel from "$lib/components/ProblemsPanel.svelte";
  import BookSwitcher from "$lib/components/BookSwitcher.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { api } from "$lib/api";
  import { onMount } from "svelte";
  import type { ConflictFileInfo, SyncState } from "$lib/platform/contract";
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
     *  even when print-md can't auto-sync it (SSH, or HTTPS with no stored
     *  credential). Lets the "Online copy" row say syncing simply isn't set up —
     *  rather than "Kept on this computer", which wrongly implies no remote when
     *  one is in fact configured (user feedback). */
    hasRemote = false,
    /** Whether the project keeps local version history (canSnapshot) — true for
     *  any local-git project even without a syncable remote. Drives the pill so
     *  local-only projects still get a clickable "Version history" affordance. */
    canSnapshot = false,
    /** Current save phase from the editor buffer. */
    savePhase = "clean" as "clean" | "dirty" | "saving" | "error",
    /** Whether a file is currently open in the editor. */
    fileOpen = false,
    /** Whether a manual force-save is in progress. */
    forceSaving = false,
    /** Whether a manual force-sync is in progress. */
    forceSyncing = false,
    /** Problem entries from the lint runner. */
    problems = [] as ProblemEntry[],
    /** Whether problems are loading. */
    problemsLoading = false,
    /** Set when the lint API call itself failed — distinct from a clean run
     *  that found zero problems. Forwarded to ProblemsPanel's neutral (not
     *  green) error row (#28, M5). */
    problemsError = null as string | null,
    /** Books (C2) in the open project's repo; switcher shows only when > 1. */
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
     *  (the `connect` state: an HTTPS remote print-md isn't connected to).
     *  Routes to the same connect/reconnect flow as the pill. */
    onConnectOnline = undefined as (() => void) | undefined,
    /** Called when the sync pill reports a conflict. Receives the pill's
     *  localId/remoteId when it already has them (the conflict SyncStatus
     *  payload carries them — M13), so the dialog can skip its own
     *  ids-fetch fallback. */
    onConflict = undefined as
      | ((files: ConflictFileInfo[], localId?: string, remoteId?: string) => void)
      | undefined,
    /** Called when the sync/git status pill is clicked in a quiet state —
     *  receives the project's operation-log path (or null) to view the log. */
    onShowLog = undefined as ((logFilePath: string | null) => void) | undefined,
    /** Called when the author clicks "Save now". */
    onForceSave = undefined as (() => void) | undefined,
    /** Called when the author clicks "Sync now". */
    onForceSync = undefined as (() => void) | undefined,
    /** Called when the author clicks "Save a version now" in the summary.
     *  Resolves when the version is saved (or rejects on failure) so the
     *  summary can refresh its "latest version" line and the parent can show
     *  the single confirmation toast. */
    onSaveVersion = undefined as (() => Promise<void>) | undefined,
    onOpenSettings = undefined as (() => void) | undefined,
    onOpenHelp = undefined as (() => void) | undefined,
  }: {
    projectDir?: string | null;
    sourceMode?: "folder" | "url";
    canSync?: boolean;
    hasRemote?: boolean;
    canSnapshot?: boolean;
    savePhase?: "clean" | "dirty" | "saving" | "error";
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
    onConflict?: (files: ConflictFileInfo[], localId?: string, remoteId?: string) => void;
    onShowLog?: (logFilePath: string | null) => void;
    onForceSave?: () => void;
    onForceSync?: () => void;
    onSaveVersion?: () => Promise<void>;
    onOpenSettings?: () => void;
    onOpenHelp?: () => void;
  } = $props();

  /** Human-readable save label — always has a value so the bar never goes blank. */
  let saveLabel = $derived.by((): string => {
    if (!fileOpen) return "";
    if (forceSaving) return "Saving…";
    switch (savePhase) {
      case "dirty":
      case "saving":
        return "Saving…";
      case "error":
        return "Save error";
      case "clean":
      default:
        return "All work saved";
    }
  });

  // ── Protection summary (UX follow-up: one calm status → a compact summary) ──
  // Clicking the save indicator opens a small popover that shows the three
  // protections a writer reasons about, each separately: saved on this
  // computer, previous versions, and the online copy. Rows 1 and 3 use data the
  // bar already has; the "previous versions" time is fetched lazily on open via
  // the PWA-clean api.vcs route (no $effect — event-driven, per CLAUDE.md §8).
  let summaryOpen = $state(false);
  let summaryEl = $state<HTMLDivElement | null>(null);
  let latestVersionAt = $state<number | null>(null);
  let versionsLoaded = $state(false);
  let versionsLoading = $state(false);

  function relativeTime(ms: number, now: number): string {
    const secs = Math.max(0, Math.round((now - ms) / 1000));
    if (secs < 60) return "just now";
    const mins = Math.round(secs / 60);
    if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
    const dayCount = Math.round(hours / 24);
    return `${dayCount} day${dayCount === 1 ? "" : "s"} ago`;
  }

  let onThisComputerText = $derived.by((): string => {
    if (forceSaving || savePhase === "saving" || savePhase === "dirty") return "Saving…";
    if (savePhase === "error") return "Couldn't save — check the file";
    return "Saved";
  });
  let previousVersionsText = $derived.by((): string => {
    if (!canSnapshot) return "Off for this project";
    if (versionsLoading) return "Checking…";
    if (!versionsLoaded) return "";
    if (latestVersionAt == null) return "No versions yet";
    return `Latest version ${relativeTime(latestVersionAt, Date.now())}`;
  });
  // Live sync state from the pill (below), so the "online copy" row reflects
  // reality (up to date / offline / syncing) instead of only the static
  // capability flag — which wrongly read "not set up" for projects that DO
  // sync (user feedback). Falls back to the capability flag only when idle.
  let liveSyncState = $state<SyncState>("idle");
  let onlineCopyText = $derived.by((): string => {
    switch (liveSyncState) {
      case "syncing":
      case "recovering":
        return "Saving changes…";
      case "offline":
        return "Offline — your work is safe here";
      case "error":
        return "Paused — your work is safe here";
      case "auth":
        return "Needs reconnecting";
      case "conflict":
        return "Needs your review";
      case "synced":
      case "up-to-date":
      case "recovered":
        return "Up to date";
      case "connect":
        // An HTTPS remote exists but print-md isn't connected to it — one
        // connect step from syncing. The summary popover pairs this with a
        // Connect action (below) so the row directs instead of dead-ending.
        return "Not connected yet";
      case "local":
        // A remote IS configured but print-md isn't auto-syncing it (SSH) →
        // don't imply it's local-only. No remote at all → the honest "only on
        // this computer" copy.
        return hasRemote ? "Not syncing automatically" : "Kept on this computer";
      case "idle":
      default:
        if (canSync) return "Up to date";
        return hasRemote ? "Not syncing automatically" : "Not set up yet";
    }
  });

  async function fetchLatestVersion() {
    if (!projectDir || !canSnapshot) return;
    versionsLoading = true;
    try {
      const page = await api.vcs.listSnapshotsPage(projectDir, { limit: 1 });
      latestVersionAt = page.entries[0]?.timestamp ?? null;
      versionsLoaded = true;
    } catch {
      // Non-fatal: the summary just shows a blank "previous versions" line
      // rather than an alarming error in the always-visible chrome.
      versionsLoaded = true;
    } finally {
      versionsLoading = false;
    }
  }

  function toggleSummary() {
    summaryOpen = !summaryOpen;
    if (summaryOpen && canSnapshot && !versionsLoaded) void fetchLatestVersion();
  }

  let savingVersion = $state(false);
  async function saveVersionNow() {
    if (!onSaveVersion || savingVersion) return;
    savingVersion = true;
    try {
      await onSaveVersion();
      // Reflect the new version in the summary immediately.
      versionsLoaded = false;
      await fetchLatestVersion();
    } catch {
      // The parent surfaces the failure toast; keep the summary calm.
    } finally {
      savingVersion = false;
    }
  }

  function onWindowPointerDown(e: PointerEvent) {
    if (summaryOpen && summaryEl && !summaryEl.contains(e.target as Node)) summaryOpen = false;
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
  let saveStateIcon = $derived.by<"refresh-cw" | "triangle-alert" | "circle-check">(() => {
    if (forceSaving || savePhase === "saving" || savePhase === "dirty") return "refresh-cw";
    if (savePhase === "error") return "triangle-alert";
    return "circle-check";
  });

  /** Show "Save now" when there are unsaved edits and no force-save in progress. */
  let showForceSave = $derived(
    fileOpen && (savePhase === "dirty" || savePhase === "saving") && !forceSaving,
  );

  /** Show "Sync now" when the project can sync and no force-sync is in progress. */
  let showForceSync = $derived(
    !!projectDir && sourceMode === "folder" && canSync,
  );

  // Show the status pill for any folder project that can sync OR keep local
  // version history. canSync projects get sync status; local-only projects get
  // the "Version history on" label (both open the operation log on click).
  let showSync = $derived(
    !!projectDir && sourceMode === "folder" && (canSync || canSnapshot),
  );

  // L9: Problems access used to disappear entirely below 820px (isCompact
  // gated the whole cluster off). It now always renders — ProblemsPanel's own
  // `compact` prop shrinks the toggle strip to an icon + count badge, and the
  // `.compact` class below repositions the expanded body as a full-viewport
  // overlay instead of the normal "grows upward from the bar" panel, which
  // has no room to be useful at narrow widths.
  let showProblems = $derived(!!projectDir && sourceMode === "folder");

  // Book switcher (C2): only when the open repo actually has more than one book.
  let showBookSwitcher = $derived(!!projectDir && sourceMode === "folder" && books.length > 1);

  onMount(updateCompact);
</script>

<svelte:window onresize={updateCompact} onpointerdown={onWindowPointerDown} />

<div class="status-bar" role="status" aria-label="Application status">
  <!-- Left cluster: [book switcher] | [sync refresh icon] [sync pill] | [save indicator] [Save now] -->
  <div class="status-left">
    {#if showBookSwitcher}
      <BookSwitcher {books} {activeBookDir} onSelect={(path) => onSwitchBook?.(path)} />
      {#if showSync || showForceSync || fileOpen}
        <span class="status-sep" aria-hidden="true"></span>
      {/if}
    {/if}
    {#if showForceSync}
      <!-- Sync now — a bare refresh icon at the far left; spins while syncing. -->
      <button
        class="status-icon-btn"
        class:spinning={forceSyncing}
        onclick={onForceSync}
        disabled={forceSyncing}
        aria-label={forceSyncing ? "Syncing…" : "Sync changes now"}
        title={forceSyncing ? "Syncing…" : "Sync changes now"}
      >
        <Icon name="refresh-cw" size={14} />
      </button>
    {/if}
    {#if showSync}
      {#key projectDir}
        <SyncStatusPill
          {projectDir}
          onReconnect={onReconnect}
          onConflict={onConflict}
          onDetails={onShowLog}
          onSyncState={(s) => (liveSyncState = s)}
        />
      {/key}
    {/if}
    {#if (showSync || showForceSync) && fileOpen}
      <span class="status-sep" aria-hidden="true"></span>
    {/if}
    {#if fileOpen}
      <div class="save-summary-wrap" bind:this={summaryEl}>
        <button
          type="button"
          class="save-indicator {saveClass}"
          aria-haspopup="dialog"
          aria-expanded={summaryOpen}
          onclick={toggleSummary}
          title={savePhase === "dirty" || savePhase === "saving" ? "Pending changes are being saved" : "What's protecting your work"}
        ><Icon name={saveStateIcon} size={13} /><span class="save-text" aria-live="polite" aria-atomic="true">{saveLabel}</span></button>
        {#if summaryOpen}
          <div class="save-summary" role="dialog" aria-label="What's protecting your work">
            <ul class="summary-rows">
              <li><span class="summary-key">On this computer</span><span class="summary-val">{onThisComputerText}</span></li>
              <li><span class="summary-key">Previous versions</span><span class="summary-val">{previousVersionsText}</span></li>
              <li><span class="summary-key">Online copy</span><span class="summary-val">{onlineCopyText}</span></li>
            </ul>
            {#if liveSyncState === "connect" && onConnectOnline}
              <!-- The row directs instead of dead-ending: one click starts the
                   connect flow for the repo's existing online copy. -->
              <button class="summary-action" onclick={() => { summaryOpen = false; onConnectOnline?.(); }}>
                Connect to sync online
              </button>
            {/if}
            {#if canSnapshot && onSaveVersion}
              <button class="summary-action" onclick={saveVersionNow} disabled={savingVersion}>
                {savingVersion ? "Saving a version…" : "Save a version now"}
              </button>
            {/if}
          </div>
        {/if}
      </div>
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

  <!-- Right cluster: problems panel toggle embedded in the bar -->
  {#if showProblems}
    <div class="status-right" class:compact={isCompact}>
      <ProblemsPanel
        {problems}
        loading={problemsLoading}
        error={problemsError}
        bind:open={problemsOpen}
        onSelect={onProblemSelect}
        compact={isCompact}
      />
    </div>
  {/if}
  <div class="shell-actions" aria-label="Application actions">
    <button class="status-icon-btn" onclick={() => onOpenSettings?.()} title="Settings (Ctrl+,)" aria-label="Settings">
      <Icon name="settings" size={14} />
    </button>
    <button class="status-icon-btn" onclick={onOpenHelp} title="Help and about" aria-label="Help and about">
      <Icon name="circle-help" size={14} />
    </button>
  </div>
</div>

<style>
  .status-bar {
    display: flex;
    align-items: stretch;
    flex-shrink: 0;
    background: var(--app-surface-raised);
    border-top: 1px solid var(--app-border);
    /* The bar is a flex row; ProblemsPanel sits in the right cluster and
       grows upward when expanded (flex-direction: column-reverse inside). */
    position: relative;
    z-index: var(--app-z-popover);
    /* Never cover the preview iframe — normal document flow, no overlap. */
    overflow: visible;
  }

  /* ── Left cluster ─────────────────────────────────────────────────────── */
  .status-left {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px;
    min-height: 28px;
    flex: 0 0 auto;
    /* Reserve space even when the sync pill / save indicator are absent
       so the bar height stays constant and the layout never jumps. */
    min-width: 0;
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

  /* ── Sync-now icon button (bare refresh icon, far left) ──────────────────── */
  .status-icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 2px;
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
  /* Spin the refresh glyph while a sync is in flight. */
  .status-icon-btn.spinning :global(svg) {
    animation: status-sync-spin 0.8s linear infinite;
  }
  @keyframes status-sync-spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* ── Save indicator (now a button that opens the protection summary) ────── */
  .save-summary-wrap { position: relative; display: inline-flex; }
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

  /* Protection summary popover — grows upward from the bar, like ProblemsPanel. */
  .save-summary {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0;
    min-width: 240px;
    padding: 8px;
    background: var(--app-surface-raised);
    border: 1px solid var(--app-border);
    border-radius: 8px;
    box-shadow: 0 -4px 16px var(--app-shadow-md);
    z-index: var(--app-z-menu);
  }
  .summary-rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .summary-rows li { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .summary-key { font-size: 11px; color: var(--app-text); font-weight: 600; }
  .summary-val { font-size: 11px; color: var(--app-text-secondary); text-align: right; }
  .summary-action {
    margin-top: 8px;
    width: 100%;
    font-size: 11px;
    padding: 5px 8px;
    border: 1px solid var(--app-border-strong);
    border-radius: 5px;
    background: transparent;
    color: var(--app-text-secondary);
    cursor: pointer;
  }
  .summary-action:hover:not(:disabled) { color: var(--app-text); background: var(--app-surface-hover); }
  .summary-action:disabled { opacity: 0.6; cursor: default; }
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

  @media screen and (max-width: 820px) {
    .status-left :global(.sync-pill),
    .save-text,
    .status-sep,
    .status-action {
      display: none;
    }
  }

  /* ── Right cluster ────────────────────────────────────────────────────── */
  /* The right cluster takes all remaining width so the Problems toggle always
     sits at the right edge of the bar. ProblemsPanel is full-width within it.
     The panel body expands upward out of the bar via position:absolute on the
     panel, so the bar height stays fixed at 28px whether or not the panel is open. */
  .status-right {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    min-width: 0;
    /* ProblemsPanel uses position relative internally; its expanded body must
       grow UPWARD. We achieve this by making the panel itself use flex-direction
       column-reverse (toggle strip at bottom, body above). The ProblemsPanel
       component handles its own layout. */
    position: relative;
  }

  /* Override ProblemsPanel's top border (it already has one) since the
     status bar provides the bar's top border — avoid double borders on the
     right side of the bar. ProblemsPanel styles are scoped in its own
     component; we target the wrapper here via :global. */
  .status-right :global(.problems-panel) {
    border-top: none;
    /* panel body expands upward */
    flex-direction: column-reverse;
  }

  /* The toggle strip inside ProblemsPanel must show a separator on the LEFT
     so it reads as a distinct group from the save indicator. */
  .status-right :global(.toggle-strip) {
    border-left: 1px solid var(--app-border);
  }

  /* Expanded panel body: absolute, grows upward from the top of the status bar. */
  .status-right :global(.panel-body) {
    position: absolute;
    bottom: 100%;
    left: 0;
    right: 0;
    max-height: 32vh;
    overflow-y: auto;
    background: var(--app-surface-raised);
    border: 1px solid var(--app-border);
    border-bottom: none;
    box-shadow: 0 -4px 16px var(--app-shadow-md);
    z-index: var(--app-z-popover);
  }

  /* L9: below 820px the "grows upward from the bar" panel has no room to be
     useful — reposition the expanded body as a full-viewport overlay instead
     (below the toolbar, above everything else short of app dialogs). The
     compact toggle strip itself (icon + count badge) stays inline in the bar. */
  .status-right.compact :global(.panel-body) {
    position: fixed;
    top: 56px;
    right: 0;
    bottom: 0;
    left: 0;
    max-height: none;
    z-index: var(--app-z-sheet);
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
