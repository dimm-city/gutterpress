<script lang="ts">
  import PreviewFrame from "$lib/components/PreviewFrame.svelte";
  import ExternalEditBanner from "$lib/components/ExternalEditBanner.svelte";
  import CrashRecoveryDialog from "$lib/components/CrashRecoveryDialog.svelte";
  import type { RecoveryItem } from "$lib/components/CrashRecoveryDialog.svelte";
  import { EditorBuffer } from "$lib/editor/buffer-state.svelte";
  import Toast from "$lib/components/Toast.svelte";
  import type { ToastController } from "$lib/components/Toast.svelte";
  import type {
    ConflictFileInfo,
    ManualGuidanceInfo,
    ProblemEntry,
    ProjectCapabilities,
    ProjectClassification,
    ProjectRemoteDiagnosis,
    RecoveryConfirmRequest,
    RecoveryProgressInfo,
    SnapshotEntry,
  } from "$lib/platform/contract";
  import { problemCounts } from "$lib/problems";
  import StatusBar from "$lib/components/StatusBar.svelte";
  import ConflictChoicesDialog from "$lib/components/ConflictChoicesDialog.svelte";
  import RecoveryOverlay from "$lib/components/RecoveryOverlay.svelte";
  import RecoveryConfirmDialog from "$lib/components/RecoveryConfirmDialog.svelte";
  import RecoveryGuidanceDialog from "$lib/components/RecoveryGuidanceDialog.svelte";
  import LoadingOverlay from "$lib/components/LoadingOverlay.svelte";
  import HelpDialog from "$lib/components/HelpDialog.svelte";
  import OperationLogDialog from "$lib/components/OperationLogDialog.svelte";
  import SettingsDialog from "$lib/components/SettingsDialog.svelte";
  import NewProjectWizard from "$lib/components/NewProjectWizard.svelte";
  import GitHubDialog from "$lib/components/GitHubDialog.svelte";
  import AdvancedSetupDialog from "$lib/components/AdvancedSetupDialog.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import EditorToolbar from "$lib/components/EditorToolbar.svelte";
  import type { ToolbarAction, ToolbarPayload } from "$lib/components/EditorToolbar.svelte";
  import SnippetPicker from "$lib/components/SnippetPicker.svelte";
  import { PreviewClient, type OutlineEntry, type PreviewTarget } from "$lib/preview-client";
  import { buildViewerStyles, DEBUG_STYLES } from "$lib/iframe-styles";
  import { getPlatform, isDesktop } from "$lib/platform";
  import { basenameOf } from "$lib/platform/paths";
  import { onMount } from "svelte";
  import {
    NARROW_BREAKPOINT,
    type MobileTab,
    paneModeForTab,
    editorSurfaceForTab,
    tabFromPaneMode,
    adjacentTab,
    keyboardOffset,
  } from "$lib/editor/mobile-layout";
  import { useSettings, _loadSettings } from "$lib/settings.svelte";
  import LeftPanel from "$lib/components/LeftPanel.svelte";
  import type { PanelTab } from "$lib/components/LeftPanel.svelte";

  type DiagnosticsTool = {
    name: string;
    found: boolean;
    usedBy: Array<{ feature: string; severity: "required" | "optional" }>;
  };
  type ExportProgressEvent = {
    exportId: string;
    state: "started" | "rendering" | "finalizing" | "success" | "canceled" | "error";
    pages?: number;
    message?: string;
  };
  type UrlPreviewBlockedEvent = {
    url: string;
    reason: string;
  };
  type PageState = {
    currentPage?: number;
    totalPages?: number;
  };
  // Per-project editor/preview state (#43), keyed by folder path in the main
  // process. currentPage/viewMode are live; the rest are dead schema for the
  // forthcoming in-app editor (#38) / chapter list (#42).
  type PersistedProjectState = {
    currentPage?: number;
    viewMode?: "single" | "two-column";
    lastChapter?: string;
    sidebarOpen?: boolean;
    cursorLine?: number;
    editorScroll?: number;
    splitPaneRatio?: number;
  };

  // Per-screen state
  let previewUrl = $state<string | null>(null);
  let currentDir = $state<string | null>(null);
  // Adapter-precomputed display name for the open folder (#49), when the folder
  // was opened via a FolderRef-returning path (picker / recents / favorites).
  // Null when opened by raw key (e.g. reopened-last-project) — folderName then
  // falls back to deriving the basename from currentDir.
  let currentFolderDisplayName = $state<string | null>(null);
  let currentUrl = $state<string | null>(null);
  let sourceMode = $state<"folder" | "url">("folder");
  let docTitle = $state<string | null>(null);
  // Capabilities of the open project's source (#12): local-folder vs
  // local-git-folder (with/without remote). Stored so forthcoming action
  // buttons (#13/#25 — Save Snapshot, View History, Sync) can render against
  // it. No new buttons yet; the data is simply available.
  let projectCapabilities = $state<ProjectCapabilities | null>(null);
  // Folder name (basename) for the toolbar label; the full path is the tooltip.
  // Folder name for the toolbar label (#49): prefer the adapter-precomputed
  // FolderRef.displayName; fall back to the basename of the key when the folder
  // was opened by raw key (reopened last project / typed path).
  let folderName = $derived(
    currentFolderDisplayName ??
      (currentDir ? (currentDir.split(/[\\/]/).filter(Boolean).pop() ?? currentDir) : "")
  );
  let busy = $state(false);
  let busyLabel = $state("");
  // PDF export runs in a separate render window, so the UI stays usable — track
  // it separately with a NON-blocking status pill instead of the modal overlay.
  let exporting = $state(false);
  let pdfProgress = $state<string | null>(null);
  let activeExportId = $state<string | null>(null);
  let exportState = $state<"idle" | "started" | "rendering" | "finalizing" | "canceling" | "success">("idle");
  let exportPages = $state(0);
  let exportElapsedSeconds = $state(0);
  let exportTimer = $state<ReturnType<typeof setInterval> | null>(null);
  let saveWarning = $state<string | null>(null);
  let diagnosticsTools = $state<DiagnosticsTool[] | null>(null);

  // #33 Phase 4: PDF/build gating via the capabilities() seam (NOT a
  // `platform === "web"` branch). `nativeSavePath` is true on the desktop host
  // (Electron writes the PDF to a chosen path) and false on the web (no
  // puppeteer / printToPDF in the browser). When false the "Save PDF" control is
  // replaced with a short "requires the desktop app" note (acceptance criterion).
  // Desktop is UNCHANGED: nativeSavePath:true → canSavePdf:true → identical UI.
  const canSavePdf = $derived(getPlatform().capabilities().nativeSavePath);

  // ── Left panel (#workspace-restructure) ───────────────────────────────────
  // State persisted via ViewerPrefs. Keyed separately from per-project state.
  let leftPanelOpen = $state(false);
  let leftPanelTab = $state<PanelTab>("projects");
  let leftPanelWidth = $state(260);
  let leftPanelToggleBtn = $state<HTMLButtonElement | undefined>(undefined);
  // Set true once we have loaded panel state from prefs (avoids flicker).
  let leftPanelPrefsLoaded = $state(false);

  // Bumped after a pull so LeftPanel refreshes its History tab.
  let historyRefreshKey = $state(0);

  // Frame state
  let client = $state<PreviewClient | undefined>(undefined);
  let currentPage = $state(1);
  let totalPages = $state(0);
  let pageEditing = $state(false);
  let pageEditValue = $state("1");
  let pageEditInput = $state<HTMLInputElement | undefined>(undefined);

  // ── Document outline + editor↔preview sync (UX-013, ADR 0005) ─────────────
  // outline drives the chapter-jump dropdown; activeOutlineIndex tracks the
  // heading the reader is currently within (updated from sourceLineChanged).
  let outline = $state<OutlineEntry[]>([]);
  let activeOutlineIndex = $state(0);
  // Timestamp guard: while the preview is being driven from the editor side,
  // ignore the sourceLineChanged it emits so the two panes don't feed back.
  let suppressPreviewSyncUntil = 0;
  // ── User settings (#45) ────────────────────────────────────────────────
  // bgColor, viewMode and zoom are sourced from the persisted settings store
  // (their old inline defaults #5a5a5a / two-column / fit-width now live in
  // DEFAULT_SETTINGS). Local mutations write back through useSettings().set().
  // bgColor has no toolbar control (that was removed in the toolbar redesign);
  // it is set via the Settings dialog only.
  const settings = useSettings();
  _loadSettings();
  let zoom = $derived(settings.current.preview.defaultZoom);
  let viewMode = $derived(settings.current.preview.viewMode);
  let bgColor = $derived(settings.current.appearance.previewBg);
  // Edit/View single-pane mode for narrow viewports (persisted in settings #45).
  // Only consulted below the responsive breakpoint; above it the layout is the
  // side-by-side split regardless of this value.
  let paneMode = $derived(settings.current.preview.paneMode);
  let debug = $state(false);
  let settingsOpen = $state(false);
  let settingsBtn = $state<HTMLButtonElement | undefined>(undefined);
  let rendering = $state(false);
  let renderProgressPage = $state(0);
  let renderCompleteOverlay = $state(false);
  let autoOpeningLastProject = $state(false);
  let lastProjectChecked = $state(false);
  let pendingRestorePage = $state<number | null>(null);
  let pendingRestoreViewMode = $state<"single" | "two-column" | null>(null);
  let restoringSavedState = $state(false);

  // Toast controller (populated by Toast.svelte via bind:api)
  let toast = $state<ToastController | null>(null);
  let helpOpen = $state(false);
  // Operation-log viewer: opened from the StatusBar git/sync pill. Holds the
  // current project's log path (carried on the sync status stream).
  let logDialogOpen = $state(false);
  let logFilePath = $state<string | null>(null);
  function showProjectLog(filePath: string | null): void {
    logFilePath = filePath;
    logDialogOpen = true;
  }
  let userSetViewMode = $state(false);
  let openError = $state<string | null>(null);
  let urlPreviewError = $state<string | null>(null);

  // ── Auto-update state ──────────────────────────────────────────────────
  /** Non-null when a staged bundle is ready to apply. */
  let updateReadyVersion = $state<string | null>(null);
  let checkingUpdates = $state(false);

  // UX-026: focus-restoration reference for the Help dialog
  let helpBtn = $state<HTMLButtonElement | undefined>(undefined);
  // Open Location modal
  let openLocationOpen = $state(false);
  // "Open from GitHub" flow (#15)
  let githubOpen = $state(false);
  let openBtn = $state<HTMLButtonElement | undefined>(undefined);
  // Advanced setup (#14): diagnostics + generic "Connect a Git server"
  let advancedSetupOpen = $state(false);
  let advancedSetupBtn = $state<HTMLButtonElement | undefined>(undefined);
  // New-project wizard (#25)
  let newProjectOpen = $state(false);
  let newProjectBtn = $state<HTMLButtonElement | undefined>(undefined);
  let syncDiag = $state<ProjectRemoteDiagnosis | null>(null);
  // Manual force-save / force-sync state for the status bar action buttons.
  let forceSaving = $state(false);
  let forceSyncing = $state(false);
  // ConflictChoicesDialog (#transparent-sync §6.1): opened by the ambient
  // SyncStatusPill when the auto-sync orchestrator reports a conflict.
  let conflictOpen = $state(false);
  let conflictFiles = $state<ConflictFileInfo[]>([]);
  let conflictLocalId = $state<string | null>(null);
  let conflictRemoteId = $state<string | null>(null);

  // ── Recovery UI state (transparent sync recovery) ────────────────────────────
  // RecoveryOverlay: shown during automated repair (non-blocking scrim over preview pane).
  let recoveryOverlayVisible = $state(false);
  let recoveryOverlayPhase = $state<RecoveryProgressInfo["phase"]>("checking");
  let recoveryOverlayState = $state<"recovering" | "recovered">("recovering");
  let recoveryBackupZipPath = $state<string | undefined>(undefined);
  let recoveryLogFilePath = $state<string | null>(null);
  // RecoveryGuidanceDialog: shown when repair is blocked / classifiable error.
  let recoveryGuidanceOpen = $state(false);
  let recoveryGuidance = $state<ManualGuidanceInfo | undefined>(undefined);
  let recoveryGuidanceBackupPath = $state<string | null>(null);
  let recoveryGuidanceLogPath = $state<string | null>(null);
  // RecoveryConfirmDialog: shown when host needs author approval for a risky repair.
  let recoveryConfirmOpen = $state(false);
  let recoveryConfirmRequest = $state<RecoveryConfirmRequest | undefined>(undefined);

  async function refreshSyncDiag(dir: string) {
    try {
      const diag = await getPlatform().diagnoseProjectRemote(dir);
      // Project may have changed while the diagnosis was in flight.
      if (currentDir === dir) syncDiag = diag;
    } catch {
      syncDiag = null;
    }
  }

  // Sync completed. Merged online changes land on disk and the preview's
  // file watcher re-renders on its own (same contract as restore, #13).
  function onSyncCompleted(mergedRemoteChanges: boolean) {
    toast?.success(
      mergedRemoteChanges
        ? "Synced — changes from the online copy were combined in, so the preview will refresh."
        : "Synced — your changes are online.",
    );
    // A sync may add new commits to the project's git history (both push and
    // pull sides). Bump the key so the History tab reflects the new state.
    historyRefreshKey += 1;
    // If remote changes landed on disk, re-lint immediately (the preview
    // file-watcher re-renders and fires refreshProblems via renderingComplete,
    // but a manual refresh here catches edge cases where no re-render fires).
    if (mergedRemoteChanges) refreshProblems();
  }

  // The single Reconnect action (ADR 0006 D7): route to the matching connect
  // flow — GitHub's device flow, or Advanced Setup for every other server.
  function onSyncReconnect() {
    if (syncDiag?.provider === "github") githubOpen = true;
    else advancedSetupOpen = true;
  }

  /**
   * Called by the ambient SyncStatusPill when the auto-sync orchestrator emits
   * a conflict state (§6.1). Opens the ConflictChoicesDialog immediately with
   * the file list from the status event, then fetches the conflict IDs
   * (localId/remoteId) via syncChanges — the only path that returns a
   * SyncOutcome carrying those IDs. The confirm button stays disabled until the
   * IDs arrive (ConflictChoicesDialog guards on !localId || !remoteId).
   */
  function onPillConflict(files: ConflictFileInfo[]) {
    if (!currentDir) return;
    conflictFiles = files;
    conflictLocalId = null;
    conflictRemoteId = null;
    conflictOpen = true;
    // The SyncStatus payload does not carry localId/remoteId — those are only
    // in the SyncOutcome returned by syncChanges (contract.ts lines 527-528).
    // Fetch them now so ConflictChoicesDialog.confirm() can call resolveSyncConflicts.
    const dir = currentDir;
    getPlatform()
      .syncChanges(dir)
      .then((outcome) => {
        // Discard if the user switched projects or already closed the dialog.
        if (currentDir !== dir || !conflictOpen) return;
        if (outcome.status === "conflict") {
          conflictFiles = outcome.files;
          conflictLocalId = outcome.localId;
          conflictRemoteId = outcome.remoteId;
        } else if (outcome.status === "synced") {
          // Conflict resolved on its own (race between pill event + sync call).
          conflictOpen = false;
          onSyncCompleted(outcome.mergedRemoteChanges);
        } else if (outcome.status === "up-to-date") {
          conflictOpen = false;
          onSyncCompleted(false);
        }
        // auth/offline/error: leave the dialog open so the user can still
        // "Decide later"; the confirm button remains disabled.
      })
      .catch(() => {
        // Network/host error: leave the dialog open at the file list view.
        // The confirm button stays disabled; the History panel's advanced Sync
        // surface remains available as a fallback.
      });
  }

  // Completes the D7 Reconnect journey: a connect dialog closing may mean a
  // new credential was just stored — re-check syncability so the Sync
  // button and the dialog's auth state reflect it without a project reload.
  let connectDialogWasOpen = false;
  $effect(() => {
    const anyConnectOpen = githubOpen || advancedSetupOpen;
    if (
      connectDialogWasOpen &&
      !anyConnectOpen &&
      currentDir &&
      sourceMode === "folder"
    ) {
      void refreshSyncDiag(currentDir);
    }
    connectDialogWasOpen = anyConnectOpen;
  });

  // ── Recovery overlay subscription ────────────────────────────────────────────
  // Subscribe to the host's sync:status channel for recovering/recovered/error
  // states so the RecoveryOverlay (and RecoveryGuidanceDialog on blocked failure)
  // appear/disappear transparently. The SyncStatusPill already handles the
  // conflict/auth/syncing/synced states — this effect handles ONLY the new
  // recovery-specific transitions (recovering, recovered, error-with-guidance).
  // Per §8 / ADR 0004: runs in the SPA, no lib value imports, all host work
  // through getPlatform().
  $effect(() => {
    if (!isDesktop()) return;
    const off = getPlatform().onSyncStatus((status) => {
      // Scope to the currently open project.
      if (status.projectDir !== currentDir) return;

      if (status.state === "recovering") {
        // Automated repair in progress — show the non-dismissable overlay.
        recoveryOverlayVisible = true;
        recoveryOverlayState = "recovering";
        recoveryOverlayPhase = status.recovery?.phase ?? "checking";
        recoveryBackupZipPath = status.backupZipPath;
        recoveryLogFilePath = status.logFile ?? null;
        // Close guidance dialog if a new recovery attempt starts.
        recoveryGuidanceOpen = false;
      } else if (status.state === "recovered") {
        // Repair completed — transition overlay to success state; it auto-dismisses.
        recoveryOverlayVisible = true;
        recoveryOverlayState = "recovered";
        recoveryBackupZipPath = status.backupZipPath ?? recoveryBackupZipPath;
        recoveryLogFilePath = status.logFile ?? recoveryLogFilePath;
      } else if (status.state === "error" && status.guidance) {
        // Classified failure that needs manual guidance — hide overlay, open dialog.
        recoveryOverlayVisible = false;
        recoveryGuidance = status.guidance;
        recoveryGuidanceBackupPath = status.backupZipPath ?? null;
        recoveryGuidanceLogPath = status.logFile ?? null;
        recoveryGuidanceOpen = true;
      } else {
        // Any other state (synced/up-to-date/offline/auth/conflict/idle) — if the
        // overlay was showing (e.g. from a previous recovery cycle), hide it.
        if (status.state !== "syncing") {
          recoveryOverlayVisible = false;
        }
      }
    });
    return () => off?.();
  });

  // ── Recovery confirm subscription ─────────────────────────────────────────────
  // The host fires onRecoveryConfirm when a medium/high-risk repair needs author
  // approval. Show RecoveryConfirmDialog; the dialog answers the gate via
  // respondRecoveryConfirm. Recovery must NOT proceed until the author responds.
  $effect(() => {
    if (!isDesktop()) return;
    const off = getPlatform().onRecoveryConfirm((req: RecoveryConfirmRequest) => {
      recoveryConfirmRequest = req;
      recoveryConfirmOpen = true;
    });
    return () => off?.();
  });

  /** Show a backup zip in the system file manager. */
  function showBackupInFolder(path: string) {
    getPlatform().showInFolder(path).catch(() => {});
  }

  /** Called when the RecoveryOverlay auto-dismiss or Done button fires. */
  function onRecoveryOverlayDone() {
    recoveryOverlayVisible = false;
  }

  let versionHistoryOpen = $state(false);
  let versionHistoryBtn = $state<HTMLButtonElement | undefined>(undefined);
  // The open folder is a book subfolder of a larger versioned folder: full
  // history features are available (scoped to the book by the host); the
  // dialog shows a quiet "shares history with its parent folder" hint.
  let projectSharesParentHistory = $state(false);
  // The book's path relative to that shared folder ("" for standalone projects).
  let projectSubPath = $state("");
  let versionHistoryAvailable = $derived(
    !!currentDir &&
      sourceMode === "folder" &&
      !!projectCapabilities &&
      (projectCapabilities.canEnableVersionHistory ||
        projectCapabilities.canViewHistory),
  );

  // History was just enabled (#13): adopt the upgraded capabilities and persist
  // the re-classified source hint — same as what classifyProject does on open.
  function onVersionHistoryEnabled(result: ProjectClassification) {
    projectCapabilities = result.capabilities;
    getPlatform()
      .setViewerPrefs({ projectSource: result.source })
      .catch(() => {});
  }

  // A restore rewrote project files on disk (#13). The preview server's file
  // watcher re-renders on its own; the editor buffer reconciles via the folder
  // watcher (#44). Confirm in the toast and refresh history so the new backup
  // entry is visible immediately.
  function onVersionRestored() {
    toast?.success("Project restored — the preview will refresh in a moment.");
    historyRefreshKey += 1;
  }

  // A snapshot was saved (#13) — same toast pattern as onVersionRestored, so
  // version-history feedback is consistent (the dialog itself shows no notice).
  // Bump the key so the History tab list updates without requiring a tab switch.
  function onVersionSnapshotSaved() {
    toast?.success("Snapshot saved.");
    historyRefreshKey += 1;
  }
  // Official setup guide for first-time writers (MVP "Download starter template").
  const SETUP_GUIDE_URL =
    "https://github.com/dimm-city/print-md/blob/main/examples/print-md-user-guide/01-getting-started.md";

  function openSetupGuide() {
    getPlatform().openExternal(SETUP_GUIDE_URL).catch(() => {});
  }

  // ── In-app markdown editor (#38) + unsaved-changes (#44) ──────────────────
  // editorOpen toggles the file-tree + editor split alongside the preview.
  // The EditorBuffer (#44) is the single owner of the edit lifecycle: open file
  // path, in-memory content, the dirty/save state machine, the debounced disk
  // write (which the preview file-watcher picks up to re-render), debounced
  // crash-recovery snapshots, the close/navigate flush, and external-edit
  // reconciliation. The old loose editorFilePath/editorContent/saveDebounce
  // state now lives inside the buffer.
  let editorOpen = $state(false);
  let editorRef = $state<{
    focus: () => void;
    revealLine: (line: number) => void;
    runToolbarAction: (action: ToolbarAction, payload?: ToolbarPayload) => void;
    getSelectionText: () => string;
    insertSnippet: (text: string) => void;
  } | null>(null);

  // Snippet picker (#29) — opened via the toolbar button or Ctrl/Cmd+Shift+S.
  let snippetPickerRef = $state<{ show: (t?: HTMLButtonElement) => void } | null>(null);
  let snippetPickerOpen = $state(false);

  function openSnippetPicker() {
    if (!isDesktop() || !currentDir) return;
    snippetPickerRef?.show();
  }

  // "Save as template" (#29) — capture the open project as a reusable template.
  let saveTemplateOpen = $state(false);
  let saveTemplateName = $state("");
  let saveTemplateBusy = $state(false);
  let saveTemplateError = $state<string | null>(null);

  function openSaveAsTemplate() {
    if (!isDesktop() || !currentDir) return;
    saveTemplateName = "";
    saveTemplateError = null;
    saveTemplateOpen = true;
  }

  async function confirmSaveAsTemplate() {
    if (!currentDir) return;
    if (!saveTemplateName.trim()) {
      saveTemplateError = "Give your template a name.";
      return;
    }
    saveTemplateBusy = true;
    saveTemplateError = null;
    try {
      const tpl = await getPlatform().saveProjectAsTemplate(
        currentDir,
        saveTemplateName.trim(),
      );
      saveTemplateOpen = false;
      toast?.success(`Saved “${tpl.label}” as a template.`);
    } catch (e) {
      saveTemplateError = e instanceof Error ? e.message : String(e);
    } finally {
      saveTemplateBusy = false;
    }
  }
  // True below the single-pane breakpoint. Assigned by the matchMedia
  // subscription further down; declared here so the derived below can read it.
  let isNarrow = $state(false);

  // Whether the editor pane is shown — DERIVED, not synced via $effect. In narrow
  // single-pane mode the Edit/View mode decides it; in the wide split it's the
  // editorOpen toggle. This fixes the "blank pane on launch in edit mode" bug:
  // previously the editor only rendered `{#if editorOpen}`, so a persisted
  // paneMode="edit" hid the preview without rendering the editor.
  let editorPaneOpen = $derived(
    !!currentDir &&
      sourceMode === "folder" &&
      (isNarrow ? paneMode === "edit" : editorOpen),
  );


  // MarkdownEditor wraps the full CodeMirror 6 stack (+ lang-markdown's
  // code-language loaders), a ~300 KB chunk. The editor pane is closed by
  // default and is desktop-folder-only, so importing it statically would parse
  // + evaluate all of CodeMirror on every launch — the dominant cold-start
  // cost. Load it lazily the first time the editor pane is actually opened so
  // app startup never pays for it. One-time import; the resolved component is
  // cached in MarkdownEditor for the lifetime of the app.
  let MarkdownEditor = $state<
    typeof import("$lib/components/MarkdownEditor.svelte")["default"] | null
  >(null);
  let editorModuleLoading = $state(false);
  // Set when the lazy import of the editor chunk fails, so the load effect does
  // NOT immediately retry (which spammed an infinite error-toast loop). Cleared
  // by an explicit user "Retry".
  let editorModuleFailed = $state(false);
  function retryEditorLoad() {
    editorModuleFailed = false;
  }
  // Set when the editor is opened before its (lazy) component has mounted, so
  // the focus request is honored once editorRef becomes available.
  let pendingEditorFocus = $state(false);
  function focusEditorWhenReady() {
    if (editorRef) {
      requestAnimationFrame(() => editorRef?.focus());
    } else {
      pendingEditorFocus = true;
    }
  }
  $effect(() => {
    if (editorRef && pendingEditorFocus) {
      pendingEditorFocus = false;
      requestAnimationFrame(() => editorRef?.focus());
    }
  });
  $effect(() => {
    if (
      !editorOpen ||
      !currentDir ||
      MarkdownEditor ||
      editorModuleLoading ||
      editorModuleFailed
    )
      return;
    editorModuleLoading = true;
    import("$lib/components/MarkdownEditor.svelte")
      .then((m) => {
        MarkdownEditor = m.default;
      })
      .catch((e) => {
        // Mark as failed so the effect doesn't immediately re-run and retry —
        // that turned a single failed chunk fetch into an infinite error-toast
        // loop. Surface ONE error; the editor pane shows a Retry affordance.
        editorModuleFailed = true;
        toast?.error(
          `Could not open the editor: ${e instanceof Error ? e.message : String(e)}`,
        );
      })
      .finally(() => {
        editorModuleLoading = false;
      });
  });

  // Construct lazily on first desktop use so the WebAdapter path never touches
  // it (the editor is desktop-only). One buffer for the lifetime of the app.
  let buffer = $state<EditorBuffer | null>(null);

  // Mirrors used by the markup/props (chapter highlight, dirty dot, editor pane).
  let editorFilePath = $derived(buffer?.filePath ?? null);
  let editorContent = $derived(buffer?.content ?? "");
  // The open file's chapter id for editor↔preview sync scoping. data-chapter-src
  // is the project-relative source path (with forward slashes), so derive the
  // path relative to the open project dir — a bare basename only matched flat
  // layouts and silently broke sync for chapters in subdirectories (RC1-5c).
  // Falls back to the basename when the file isn't under the project dir.
  // Used to keep per-file source lines from mapping into the wrong chapter of
  // the whole-book preview (ADR 0005).
  let editorChapter = $derived.by(() => {
    if (!editorFilePath) return null;
    const file = editorFilePath.replace(/\\/g, "/");
    const dir = currentDir?.replace(/\\/g, "/").replace(/\/+$/, "");
    if (dir && file.startsWith(dir + "/")) return file.slice(dir.length + 1);
    return file.split("/").pop() ?? null;
  });
  /** Save-state derived from the buffer phase for the editor status bar. */
  let editorSavePhase = $derived(buffer?.phase ?? "clean");

  // External-edit conflict banner state (#44). Derived from the buffer's
  // pending external change so Reload / Keep mine route back through it.
  let externalChange = $derived(buffer?.externalChange ?? null);
  let externalFileName = $derived(
    editorFilePath ? (editorFilePath.split(/[\\/]/).pop() ?? editorFilePath) : "",
  );

  function ensureBuffer(): EditorBuffer {
    if (!buffer) {
      buffer = new EditorBuffer({
        platform: getPlatform(),
        recoveryEnabled: settings.current.editor.crashRecovery,
        onError: (msg) => toast?.error(msg),
        onAutoReloaded: () => toast?.info?.("Reloaded from disk"),
      });
    }
    return buffer;
  }

  // Push the buffer's pending-save state to main so the window close gate can
  // flush before quitting (#44). Fire-and-forget; main never reads our memory.
  $effect(() => {
    if (!isDesktop() || !buffer) return;
    const pending = buffer.hasPendingSave;
    getPlatform().setDirtyState(pending).catch(() => {});
  });

  // Keep the recovery-enabled toggle (#45) in sync with the live setting.
  $effect(() => {
    const enabled = settings.current.editor.crashRecovery;
    if (buffer) buffer.setRecoveryEnabled(enabled);
  });

  // External-edit detection (#44): watch the open folder; on any debounced
  // change, ask the buffer to reconcile the open document against disk. The
  // watcher is torn down when the folder closes / switches to URL mode.
  $effect(() => {
    if (!isDesktop()) return;
    const dir = currentDir;
    if (!dir || sourceMode !== "folder") return;
    const off = getPlatform().watchFolder(dir, () => {
      buffer?.reconcileExternalChange().catch(() => {});
    });
    return () => off?.();
  });

  // Window close gate (#44): when main asks the renderer to flush before
  // closing, flush the buffer. The preload wrapper signals main when done.
  $effect(() => {
    if (!isDesktop()) return;
    const off = getPlatform().onFlushBeforeClose(() => buffer?.flush() ?? Promise.resolve());
    return () => off?.();
  });

  /**
   * Open a file in the editor (#44). Flushes any pending save on the currently
   * open document FIRST so switching chapters never drops an in-flight write.
   */
  function selectEditorFile(path: string) {
    if (!isDesktop()) return;
    const buf = ensureBuffer();
    if (buf.filePath === path) return;
    const wasPending = buf.hasPendingSave;
    void (async () => {
      if (buf.filePath && wasPending) {
        toast?.info?.("Saving…");
        await buf.flush().catch(() => {});
      }
      await buf.load(path);
    })();
  }

  function onEditorChange(value: string) {
    if (!isDesktop()) return;
    ensureBuffer().edit(value);
  }

  // When the editor opens with nothing loaded, auto-select a sensible file so the
  // user isn't dropped on an empty "Select a file" pane: the first markdown file,
  // else the first editable file.
  async function ensureEditorFile() {
    if (!currentDir || !isDesktop()) return;
    const buf = ensureBuffer();
    if (buf.filePath) return;
    try {
      const files = (await getPlatform().listDir(currentDir)).filter((e) => !e.isDir);
      const pick =
        files.filter((e) => /\.md$/i.test(e.name)).sort((a, b) => a.name.localeCompare(b.name))[0] ||
        files.find((e) => /\.(md|css)$/i.test(e.name));
      if (pick) selectEditorFile(pick.path);
    } catch {
      /* non-fatal: the user can still pick a file from the tree */
    }
  }

  function reloadExternal() {
    buffer?.acceptExternal();
  }

  function keepMineExternal() {
    buffer?.keepMine();
  }

  // ── Crash recovery (#44) ──────────────────────────────────────────────────
  // After a project opens, scan userData/recovery for snapshots belonging to it
  // (an unclean exit). Offer Restore / Discard per entry. `recoveryScanDir`
  // guards against re-scanning the same folder twice.
  let recoveryItems = $state<RecoveryItem[]>([]);
  let recoveryScanDir = $state<string | null>(null);


  async function scanForRecovery(dir: string) {
    if (!isDesktop()) return;
    if (recoveryScanDir === dir) return;
    recoveryScanDir = dir;
    if (!settings.current.editor.crashRecovery) return;
    try {
      const entries = await getPlatform().listRecovery(dir);
      recoveryItems = entries.map((e) => ({
        filePath: e.filePath,
        recoveryPath: e.recoveryPath,
        fileName: basenameOf(e.filePath),
        savedAt: e.savedAt,
      }));
    } catch {
      recoveryItems = [];
    }
  }

  async function restoreRecovery(item: RecoveryItem) {
    recoveryItems = recoveryItems.filter((i) => i.filePath !== item.filePath);
    if (!isDesktop()) return;
    const buf = ensureBuffer();
    try {
      // The recovered bytes live in the sidecar snapshot (an absolute path under
      // userData). Read them, then load into the buffer against the current disk
      // baseline — restoreContent marks the buffer dirty so it re-saves on the
      // next debounce, preserving the recovered edits.
      const recovered = await getPlatform().readFile(item.recoveryPath);
      await buf.restoreContent(item.filePath, recovered);
      editorOpen = true;
      focusEditorWhenReady();
    } catch (e) {
      toast?.error(
        `Could not restore: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  function discardRecovery(item: RecoveryItem) {
    recoveryItems = recoveryItems.filter((i) => i.filePath !== item.filePath);
    if (isDesktop()) {
      getPlatform().clearRecovery(item.filePath).catch(() => {});
    }
  }

  function dismissRecovery() {
    recoveryItems = [];
  }

  // ── Persist left panel state on change ────────────────────────────────────
  $effect(() => {
    if (!leftPanelPrefsLoaded) return;
    getPlatform()
      .setViewerPrefs({ leftPanel: { open: leftPanelOpen, activeTab: leftPanelTab, width: leftPanelWidth } })
      .catch(() => {});
  });

  // ── Auto-open panel on Projects tab when no project ────────────────────────
  $effect(() => {
    if (!currentDir && !currentUrl && !busy && lastProjectChecked) {
      leftPanelOpen = true;
      leftPanelTab = "projects";
    }
  });

  function toggleLeftPanel() {
    leftPanelOpen = !leftPanelOpen;
  }

  function toggleEditor() {
    if (!currentDir || sourceMode !== "folder") return;
    editorOpen = !editorOpen;
    // On open, move keyboard focus into the editor so Ctrl+E acts as a
    // focus-switch into the editing surface (#38). Closing returns focus to
    // the document (preview iframe / window) implicitly.
    if (editorOpen) {
      void ensureEditorFile();
      // Defer until the pane (and CodeMirror view) is mounted. The editor
      // component is lazy-loaded, so focus may need to wait for it to arrive.
      focusEditorWhenReady();
    }
  }

  // ── Problems panel (#28) ───────────────────────────────────────────────────
  // Lint findings for the open project, refreshed after every live-preview
  // rebuild (the renderingComplete event — which fires for the initial render
  // AND every watcher-triggered re-render). The toggle button lives in the
  // toolbar with an errors+warnings count badge.
  let problemsOpen = $state(false);
  let problems = $state<ProblemEntry[]>([]);
  let problemsLoading = $state(false);
  let problemBadge = $derived(problemCounts(problems).badge); // used for ProblemsPanel (informational)

  function refreshProblems() {
    if (!isDesktop() || !currentDir || sourceMode !== "folder") return;
    const dir = currentDir;
    problemsLoading = true;
    getPlatform()
      .lintProject(dir)
      .then((entries) => {
        // The project may have changed while the lint was in flight.
        if (currentDir === dir) problems = entries;
      })
      .catch(() => {
        // Lint failing must never break the preview — show a clean panel.
        if (currentDir === dir) problems = [];
      })
      .finally(() => {
        problemsLoading = false;
      });
  }

  // Closing the project (or switching to a URL preview) clears the findings so
  // the panel/badge never show a stale project's problems.
  $effect(() => {
    if (!currentDir || sourceMode !== "folder") {
      problems = [];
      problemsOpen = false;
    }
  });

  /**
   * Open the problem's file in the editor at the offending line. Reuses the
   * existing cross-chapter reveal (the same path the preview→editor sync and
   * outline jumps use) — no new navigation machinery.
   */
  function openProblem(p: ProblemEntry) {
    if (!p.filePath || !currentDir) return;
    // Make sure the editor pane is visible first (narrow = Edit mode pane;
    // wide = the editor split).
    if (isNarrow) {
      setPaneMode("edit");
    } else if (!editorOpen) {
      editorOpen = true;
    }
    const rel = p.file ?? p.filePath.split(/[\\/]/).pop() ?? p.filePath;
    if (p.line) {
      followChapterInEditor(rel, p.line);
    } else {
      selectEditorFile(p.filePath);
    }
    focusEditorWhenReady();
  }

  // ----------------------------------------------------------------
  // Inject viewer canvas styles into iframe when client + bgColor change
  // ----------------------------------------------------------------
  $effect(() => {
    if (!client) return;
    // Inject once on client attach; renderingComplete will re-inject with final bg
    client.injectStyles("viewer-canvas", buildViewerStyles(bgColor));
  });

  // Apply view-mode changes that originate from the Settings panel (which writes
  // the settings store directly rather than calling applyViewMode). Keeps the
  // rendered spread in sync with the derived viewMode without a reload.
  $effect(() => {
    const mode = viewMode;
    if (!client || rendering) return;
    client.call("setViewMode", [mode]).catch(() => {});
  });

  $effect(() => {
    if (diagnosticsTools) return;
    getPlatform().doctor()
      .then((data) => {
        diagnosticsTools = (data as { tools?: DiagnosticsTool[] }).tools ?? [];
      })
      .catch(() => {});
  });

  $effect(() => {
    if (!saveWarning) return;
    if (currentDir && !rendering && sourceMode === "folder") {
      saveWarning = null;
    }
  });

  $effect(() => {
    const off = getPlatform().onUrlPreviewBlocked((event: UrlPreviewBlockedEvent) => {
      if (sourceMode !== "url") return;
      if (!previewUrl) return;
      previewUrl = null;
      urlPreviewError = event.reason;
    });
    return () => off?.();
  });

  $effect(() => {
    if (pageEditing) {
      queueMicrotask(() => pageEditInput?.focus());
    }
  });

  $effect(() => {
    if (!isDesktop()) return;
    if (lastProjectChecked) return;
    if (previewUrl || currentDir || currentUrl || busy || openError || urlPreviewError) return;
    if (autoOpeningLastProject) return;

    autoOpeningLastProject = true;
    lastProjectChecked = true;
    const platform = getPlatform();
    platform.getViewerPrefs()
      .then(async (prefs) => {
        // Load persisted left panel state
        const panelPrefs = prefs.leftPanel;
        if (!leftPanelPrefsLoaded) {
          leftPanelPrefsLoaded = true;
          if (panelPrefs?.activeTab) leftPanelTab = panelPrefs.activeTab;
          if (typeof panelPrefs?.width === "number") leftPanelWidth = Math.min(480, Math.max(200, panelPrefs.width));
          // Panel open state loaded below after we know if a project exists
        }

        const dir = prefs.lastProjectDir;
        if (!dir || previewUrl || currentDir || currentUrl) {
          // No project to reopen — auto-open the panel on Projects tab so
          // the welcome screen has a useful first action.
          leftPanelOpen = true;
          leftPanelTab = "projects";
          // Dismiss splash and reveal window.
          platform.rendererReady().catch(() => {});
          return;
        }
        // Restore panel open state from prefs (now we know there is a project)
        if (!leftPanelPrefsLoaded) leftPanelPrefsLoaded = true;
        leftPanelOpen = panelPrefs?.open ?? false;
        // Per-project state (#43) is keyed by folder path so opening a
        // different project never pollutes this one's restore point.
        platform.splashStatus("Opening your project…", 45).catch(() => {});
        const restoreState = await platform
          .getViewerProjectState(dir)
          .catch(() => null);
        return startFolderPreview(dir, "Reopening previous folder…", restoreState);
      })
      .catch(() => {
        // If reopen failed, still reveal the window (don't strand on the splash).
        platform.rendererReady().catch(() => {});
      })
      .finally(() => {
        autoOpeningLastProject = false;
      });
  });

  // ----------------------------------------------------------------
  // Hook PreviewClient events when it appears
  // ----------------------------------------------------------------
  $effect(() => {
    if (!client) return;
    const off = client.on((e) => {
      if (e.name === "renderingComplete") {
        const n = e.detail.totalPages ?? 0;
        totalPages = n;
        renderProgressPage = n;
        rendering = false;
        // Keep the overlay up while the post-render layout settles. The pages
        // stay invisible (iframe opacity 0) through the view-mode switch AND the
        // async zoom round-trips; only once the zoom is actually applied do we
        // cross-fade — see the revealSettledPages() call at the end of the
        // settle sequence below. This is what prevents the visible page JUMP:
        // we never reveal before the layout has stopped moving.
        renderCompleteOverlay = true;
        // Inject canvas styles now that Paged.js is done
        client?.injectStyles("viewer-canvas", buildViewerStyles(bgColor));
        client?.injectStyles("debug", DEBUG_STYLES);
        // Set initial view mode (auto if user hasn't chosen)
        const auto = window.innerWidth < 1280 ? "single" : "two-column";
        const restorePage = pendingRestorePage;
        const restoreMode = pendingRestoreViewMode;
        pendingRestorePage = null;
        pendingRestoreViewMode = null;
        const mode = restoreMode ?? (userSetViewMode ? viewMode : auto);
        // Drive the whole settle sequence to completion, THEN reveal. The reveal
        // is gated on the zoom promise resolving — not a magic timer — so the
        // fade always uncovers a completely still layout. Reveal is in a finally
        // so the pages are never stranded invisible if a zoom call rejects.
        (async () => {
          applyViewMode(mode, false);
          try {
            // "Fit to width" must ALWAYS measure-and-fit, never assume 100% fits.
            // A two-page spread (~1656px) overflows a 1400px pane at 100%,
            // clipping the right page — so fit even on wide screens. Awaiting
            // applyFitWidthZoom() waits for both postMessage round-trips
            // (getPageDimensions + setZoom), i.e. until the JUMP has happened.
            if (zoom === "fit-width") {
              await applyFitWidthZoom();
            } else {
              await client?.call("setZoom", [Number(zoom)]);
            }
          } catch {
            // Zoom failed — still reveal below so pages aren't stranded hidden.
          } finally {
            revealSettledPages();
          }
        })();
        if (restorePage && restorePage > 1) {
          queueMicrotask(() => restoreProjectPage(restorePage));
        }
        // UX-011: improved success toast copy
        toast?.success(`Your book is ready — ${n} ${n === 1 ? 'page' : 'pages'}`);
        // Build the chapter-jump outline from the freshly rendered DOM.
        refreshOutline();
        // Re-lint the project on every rebuild so the Problems panel tracks
        // the author's edits (#28).
        refreshProblems();
        // First project render done → dismiss the splash and reveal the window.
        getPlatform().splashStatus("Ready", 100).catch(() => {});
        getPlatform().rendererReady().catch(() => {});
      } else if (e.name === "sourceLineChanged") {
        // Preview→editor sync: the reader scrolled. Follow in the editor and
        // update the active outline entry — but not while the editor itself is
        // driving the preview (echo guard).
        const line = e.detail.sourceLine;
        const chap = e.detail.chapter;
        if (typeof line === "number") {
          updateActiveOutline(line);
          if (Date.now() >= suppressPreviewSyncUntil && editorPaneOpen) {
            if (chap === editorChapter) {
              editorRef?.revealLine(line);
            } else if (chap && currentDir && !buffer?.isDirty) {
              // Scrolled into a DIFFERENT chapter: follow it by opening that
              // chapter's file, then reveal the line once it has loaded. Skipped
              // when there are unsaved edits so it never yanks the file away mid-
              // edit. This is what makes the editor track the whole book, not
              // just the one open chapter (the "sporadic" complaint).
              followChapterInEditor(chap, line);
            }
          }
        }
      } else if (e.name === "pageChanged") {
        if (rendering) {
          renderProgressPage = e.detail.totalPages ?? renderProgressPage;
          totalPages = e.detail.totalPages ?? totalPages;
          // Live splash sub-status during the (potentially multi-second) render.
          const pg = e.detail.totalPages ?? renderProgressPage;
          if (pg) getPlatform().splashStatus(undefined, undefined, `Laying out page ${pg}`).catch(() => {});
        } else {
          syncPageState(e.detail);
        }
      } else if (e.name === "ready") {
        rendering = true;
        // New render starting — overlay covers the layout shuffle; fades out on renderingComplete.
        renderProgressPage = 0;
        outline = [];
        activeOutlineIndex = 0;
        getPlatform().splashStatus("Rendering pages…", 70).catch(() => {});
        client?.call<number>("getTotalPages").then((n) => {
          if (n > 0) {
            totalPages = n;
          }
        }).catch(() => {});
      }
    });
    return off;
  });

  // ----------------------------------------------------------------
  // Auto-update: markReady on mount (health gate) + event subscription
  // ----------------------------------------------------------------

  // markReady tells main the new bundle booted successfully, clearing the
  // health watchdog armed after an apply/launch-promote. If it does not arrive
  // before the watchdog elapses (and the window is still open), main rolls the
  // bundle back this session. Harmless no-op when nothing is pending.
  $effect(() => {
    if (!isDesktop()) return;
    getPlatform().updater.markReady().catch(() => {});
  });

  // Check for an already-staged update on load, then subscribe to future events.
  $effect(() => {
    if (!isDesktop()) return;
    const platform = getPlatform();

    // Peek at current status so we can surface a banner immediately if a
    // bundle was staged during a previous run.
    platform.updater.getStatus()
      .then((status: { stagedVersion: string | null }) => {
        if (status.stagedVersion) {
          updateReadyVersion = status.stagedVersion;
        }
      })
      .catch(() => {});

    // Subscribe to future events from main.
    // Events fire for BOTH the silent background launch check and the manual
    // "Check for updates" button. Only react to "staged" here (show the banner
    // live, e.g. when the background check stages an update). "uptodate"/"error"
    // are intentionally silent — surfacing them here would toast on every
    // launch and would double-toast during a manual check (which drives its own
    // feedback from the IPC return value in checkForUpdates()).
    const off = platform.updater.onEvent((event: { type: string; version?: string }) => {
      if (event.type === "staged") {
        updateReadyVersion = event.version ?? null;
      }
    });

    return () => off?.();
  });

  // ----------------------------------------------------------------
  // Global keyboard shortcuts (available without a loaded document)
  // ----------------------------------------------------------------
  $effect(() => {
    function onGlobalKey(e: KeyboardEvent) {
      // Cmd/Ctrl+, opens the Settings panel (toggles closed if already open).
      if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault();
        settingsOpen = !settingsOpen;
      }
      // Cmd/Ctrl+E toggles the in-app editor (#38) when a folder is open.
      if ((e.ctrlKey || e.metaKey) && (e.key === "e" || e.key === "E")) {
        e.preventDefault();
        toggleEditor();
      }
      // Cmd/Ctrl+\ toggles the left panel
      if ((e.ctrlKey || e.metaKey) && e.key === "\\") {
        e.preventDefault();
        toggleLeftPanel();
      }
      // Cmd/Ctrl+Shift+S opens the snippet picker (#29) when a project is open.
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        openSnippetPicker();
      }
    }
    window.addEventListener("keydown", onGlobalKey);
    return () => window.removeEventListener("keydown", onGlobalKey);
  });

  // ----------------------------------------------------------------
  // Keyboard shortcuts
  // ----------------------------------------------------------------
  $effect(() => {
    if (!previewUrl) return;

    function onKey(e: KeyboardEvent) {
      // Don't intercept when focus is in an input/textarea/select, or inside
      // the CodeMirror editor (#38) — its content node is a contenteditable
      // DIV, so a tagName check alone would let preview-nav keys (arrows,
      // Home/End, +/-/=, f) hijack core editing.
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (t?.isContentEditable || t?.closest?.(".cm-editor")) return;

      // UX-006: Ctrl/Cmd+S saves PDF (desktop only — #33 Phase 4: the web host
      // can't write a PDF, so the shortcut is inert there, matching the hidden
      // toolbar button).
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (canSavePdf) savePdf();
        return;
      }

      switch (e.key) {
        case "ArrowRight":
        case "PageDown":
          e.preventDefault();
          nextPage();
          break;
        case "ArrowLeft":
        case "PageUp":
          e.preventDefault();
          prevPage();
          break;
        case "Home":
          e.preventDefault();
          firstPage();
          break;
        case "End":
          e.preventDefault();
          lastPage();
          break;
        case "+":
        case "=":
          e.preventDefault();
          stepZoom(0.25);
          break;
        case "-":
          e.preventDefault();
          stepZoom(-0.25);
          break;
        case "f":
        case "F":
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            applyZoom("fit-width");
          }
          break;
        // UX-004: 'D' shortcut for debug removed — non-technical writers should
        // not accidentally trigger debug mode.
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ----------------------------------------------------------------
  // Responsive auto view-mode on resize (unless user locked it)
  // ----------------------------------------------------------------
  $effect(() => {
    if (!previewUrl) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    function onResize() {
      if (userSetViewMode) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const auto = window.innerWidth < 1280 ? "single" : "two-column";
        applyViewMode(auto, false);
      }, 150);
    }
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (timer) clearTimeout(timer);
    };
  });

  // ----------------------------------------------------------------
  // Actions
  // ----------------------------------------------------------------

  function friendlyFolderError(msg: string): string {
    if (/manifest|print-md\.yaml|No such file/i.test(msg)) {
      return "This doesn't look like a print-md project — we couldn't find a print-md.yaml file. Make sure you're opening the right folder.";
    }
    if (/ENOENT|not found/i.test(msg)) {
      return "The folder couldn't be read. Check that it exists and you have permission to open it.";
    }
    if (/permission|EACCES/i.test(msg)) {
      return "Permission denied. Check that you have access to this folder.";
    }
    return "Something went wrong opening this folder. Try again, or choose a different folder.";
  }

  function friendlyPdfError(e: unknown): string {
    const msg = e instanceof Error ? e.message : String(e);
    const code = (e as any)?.code ?? "";
    if (code === "EXPORT_CANCELED") {
      return "";
    }
    if (code === "BUILD_ERROR") {
      const firstLine = msg.split("\n")[0]?.trim() ?? msg;
      return `PDF generation failed: ${firstLine}. Open Help (?) for setup details.`;
    }
    if (code === "TOOL_MISSING") {
      const match = msg.match(/Required system tool not found: ([^\n]+)/);
      const tool = match?.[1]?.trim() ?? "a required tool";
      return `PDF export needs "${tool}" installed. Open Help (?) → System tools to see how to install it.`;
    }
    if (/chrome|chromium|browser/i.test(msg)) {
      return "PDF export needs a browser (Chrome or Edge) installed. Open Help (?) for setup details.";
    }
    if (/ENOENT|not found/i.test(msg)) {
      return "Could not find a required program. Open Help (?) → System tools to check what needs to be installed.";
    }
    if (/permission|EACCES/i.test(msg)) {
      return "Permission denied saving the PDF. Try saving to a different folder (like your Desktop).";
    }
    return "PDF export failed. Open Help (?) → System tools to check for issues.";
  }

  function startExportTimer() {
    if (exportTimer) clearInterval(exportTimer);
    exportElapsedSeconds = 0;
    exportTimer = setInterval(() => {
      exportElapsedSeconds += 1;
      updateExportLabel();
    }, 1000);
  }

  function stopExportTimer() {
    if (exportTimer) {
      clearInterval(exportTimer);
      exportTimer = null;
    }
  }

  function resetExportState() {
    stopExportTimer();
    exporting = false;
    activeExportId = null;
    exportState = "idle";
    exportPages = 0;
    exportElapsedSeconds = 0;
    pdfProgress = null;
  }

  function updateExportLabel() {
    const elapsed = exportElapsedSeconds >= 3 ? ` ${exportElapsedSeconds}s` : "";
    if (exportState === "success") {
      pdfProgress = `PDF saved${elapsed}`;
      return;
    }
    if (exportState === "canceling") {
      pdfProgress = "Canceling export…";
      return;
    }
    if (exportState === "finalizing") {
      pdfProgress = exportPages > 0 ? `Finalizing PDF (${exportPages} pages)…${elapsed}` : `Finalizing PDF…${elapsed}`;
      return;
    }
    if (exportState === "rendering") {
      pdfProgress = exportPages > 0 ? `Exporting page ${exportPages}…${elapsed}` : `Exporting…${elapsed}`;
      return;
    }
    pdfProgress = `Preparing PDF…${elapsed}`;
  }

  function syncExportProgress(event: ExportProgressEvent) {
    if (activeExportId && event.exportId !== activeExportId) return;
    if (!activeExportId) activeExportId = event.exportId;
    if (event.pages) exportPages = event.pages;
    if (event.state === "started") exportState = "started";
    else if (event.state === "rendering") exportState = "rendering";
    else if (event.state === "finalizing") exportState = "finalizing";
    else if (event.state === "success") exportState = "success";
    updateExportLabel();
  }

  async function startFolderPreview(
    dir: string,
    label = "Starting preview…",
    restoreState: PersistedProjectState | null = null,
    // #49: adapter-precomputed display name when the folder was opened via a
    // FolderRef (picker/recents/favorites). Null when opened by raw key.
    displayName: string | null = null,
  ) {
    openError = null;
    urlPreviewError = null;
    saveWarning = null;
    renderCompleteOverlay = false;
    busy = true;
    busyLabel = label;
    try {
      if (!isDesktop()) {
        toast?.error("Electron bridge unavailable — run via the viewer app");
        return;
      }
      const platform = getPlatform();
      // #49: the app-facing contract takes a FolderRef. `dir` is the key; the
      // displayName is the adapter-precomputed one when available, else the
      // basename of the key.
      const data = await platform.startPreview({
        input: { key: dir, displayName: displayName ?? basenameOf(dir) },
      });
      sourceMode = "folder";
      // New folder: flush + clear any file selected from a previous project so
      // the editor pane doesn't point at a stale path (#44 — flush first so a
      // pending save in the prior project isn't dropped on project switch).
      if (currentDir !== dir && buffer) {
        await buffer.flush().catch(() => {});
        buffer.reset();
      }
      currentDir = dir;
      currentFolderDisplayName = displayName;
      currentUrl = null;
      // Clear stale problems from the previous project immediately so the badge
      // and panel don't show the old project's findings while the new one renders.
      problems = [];
      // Close the operation-log dialog and drop the prior project's log path so
      // a switch can never surface one project's log under another (paired with
      // the {#key currentDir} remount of OperationLogDialog below).
      logDialogOpen = false;
      logFilePath = null;
      // Bump historyRefreshKey so the History tab reloads its list for the new
      // project as soon as capabilities arrive (LeftPanel's effect guards on canHistory).
      historyRefreshKey += 1;
      // Preload the first file into the editor buffer when a folder opens, so the
      // editor pane is never empty whenever it's shown (and switching to edit is
      // instant). Action-driven (folder open), not an effect, and independent of
      // async settings/narrow timing. Idempotent + self-gated (no-op in view-only
      // contexts where there's nothing to edit).
      void ensureEditorFile();
      // Classify the opened folder (#12) so capability-gated actions (#13/#25)
      // can render. Always re-detected on open (a user may add/remove `.git`
      // between sessions) and persisted as a hint. Fire-and-forget: a failure
      // must never block the preview.
      projectCapabilities = null;
      projectSharesParentHistory = false;
      projectSubPath = "";
      syncDiag = null;
      platform
        .classifyProject(dir)
        .then((result) => {
          projectCapabilities = result.capabilities;
          projectSubPath =
            result.source.type === "local-git-folder" ? result.source.subPath : "";
          projectSharesParentHistory = projectSubPath !== "";
          platform
            .setViewerPrefs({ projectSource: result.source })
            .catch(() => {});
          // Sync gate (#15 / ADR 0006 D4): the toolbar action appears only
          // when the diagnosis says the project is actually syncable (HTTPS
          // remote + a stored connection). Local reads only; fire-and-forget.
          if (result.capabilities.canSync) {
            void refreshSyncDiag(dir);
          }
        })
        .catch(() => {
          projectCapabilities = null;
        });
      docTitle = data.title ?? null;
      // Force iframe remount by nulling first; reset overlay for the new iframe.
      previewUrl = null;
      await Promise.resolve();
      previewUrl = data.url;
      rendering = true;
      renderProgressPage = 0;
      totalPages = 0;
      currentPage = 1;
      const restoredViewMode = restoreState?.viewMode;
      pendingRestoreViewMode = restoredViewMode ?? null;
      pendingRestorePage = restoreState?.currentPage && restoreState.currentPage > 1
        ? restoreState.currentPage
        : null;
      if (restoredViewMode) {
        // Per-project ViewerPrefs override → seed the settings store so the
        // derived viewMode reflects this project's last-used mode.
        settings.set({ preview: { viewMode: restoredViewMode } });
      }
      userSetViewMode = !!restoredViewMode;
      // Loud signal for the #1 cause of wrong fonts/styles: shared asset dirs
      // (e.g. ../dc-design-guide/fonts) that don't resolve next to this project.
      const missing = data.missingSharedAssets ?? [];
      if (missing.length > 0) {
        toast?.error(
          `Shared asset folder(s) not found — fonts/styles may be wrong: ${missing.join(", ")}. ` +
            `Make sure the shared directory exists next to this project.`
        );
      }
      // Crash-recovery offer (#44): scan for snapshots left by an unclean exit.
      void scanForRecovery(dir);
    } catch (e) {
      previewUrl = null;
      currentDir = null;
      currentFolderDisplayName = null;
      docTitle = null;
      rendering = false;
      openError = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
      busyLabel = "";
    }
  }

  async function openFolder() {
    if (!isDesktop()) {
      toast?.error("Electron bridge unavailable — run via the viewer app");
      return;
    }
    busy = true;
    busyLabel = "Opening folder…";
    let handedOff = false;
    try {
      const platform = getPlatform();
      // #49: the picker returns a host-neutral FolderRef. Use `.key` wherever
      // the raw path string is needed (per-project state, preview) and carry
      // `.displayName` for the toolbar label.
      const folder = await platform.openFolder();
      if (!folder) return;
      // Per-project state (#43): restore whatever was saved for THIS folder
      // (page, view mode, …) regardless of which project was last open.
      const restoreState = await platform
        .getViewerProjectState(folder.key)
        .catch(() => null);
      handedOff = true;
      await startFolderPreview(folder.key, "Starting preview…", restoreState, folder.displayName);
    } finally {
      if (!handedOff) {
        busy = false;
        busyLabel = "";
      }
    }
  }

  function openUrl(url: string) {
    openError = null;
    urlPreviewError = null;
    saveWarning = null;
    renderCompleteOverlay = false;
    sourceMode = "url";
    currentUrl = url;
    currentDir = null;
    currentFolderDisplayName = null;
    docTitle = null;
    // The editor is folder-only; close it for web previews.
    editorOpen = false;
    buffer?.reset();
    // Force iframe remount by nulling first.
    previewUrl = null;
    queueMicrotask(() => {
      previewUrl = url;
      rendering = false;
      renderProgressPage = 0;
      totalPages = 0;
      currentPage = 1;
    });
  }

  function openInBrowser() {
    if (!currentUrl) return;
    getPlatform().openExternal(currentUrl).catch(() => {});
  }

  function getSaveReadinessWarning(): string | null {
    if (sourceMode !== "folder" || !currentDir) {
      return "Open a project folder before saving a PDF.";
    }
    if (rendering || !previewUrl) {
      return "Your document is still loading. Wait a moment and try again.";
    }
    const missingRequiredTool = diagnosticsTools?.find(
      (tool) =>
        !tool.found &&
        tool.usedBy.some(
          (use) => use.severity === "required" && /save pdf/i.test(use.feature)
        )
    );
    if (missingRequiredTool) {
      return `PDF export needs ${missingRequiredTool.name} on this computer before you can save.`;
    }
    return null;
  }

  async function stopPreview() {
    // Flush any pending edit before tearing down so closing the project never
    // drops an in-flight auto-save (#44).
    if (buffer) await buffer.flush().catch(() => {});
    await getPlatform().stopPreview().catch(() => {});
    previewUrl = null;
    currentDir = null;
    currentFolderDisplayName = null;
    currentUrl = null;
    docTitle = null;
    rendering = false;
    renderProgressPage = 0;
    renderCompleteOverlay = false;
    totalPages = 0;
    currentPage = 1;
    pageEditing = false;
    editorOpen = false;
    buffer?.reset();
    recoveryScanDir = null;
    recoveryItems = [];
  }

  async function savePdf() {
    saveWarning = getSaveReadinessWarning();
    if (saveWarning) {
      return;
    }
    const inputDir = currentDir;
    if (!inputDir) return;
    if (!isDesktop()) {
      toast?.error("Electron bridge unavailable — run via the viewer app");
      return;
    }
    const platform = getPlatform();
    // #49: use the adapter-precomputed displayName for the default filename,
    // falling back to the basename of the key.
    const defaultName = (currentFolderDisplayName ?? basenameOf(inputDir) ?? "book") + ".pdf";
    const outPath = await platform.savePdf(defaultName);
    if (!outPath) return;

    // Non-blocking: the build runs in a separate render window, so keep the
    // preview interactive and show progress in a corner pill (not the overlay).
    exporting = true;
    exportState = "started";
    exportPages = 0;
    pdfProgress = "Preparing PDF…";
    startExportTimer();
    let offProgress: (() => void) | undefined;
    try {
      // Live progress: Paged.js pagination of large books takes minutes, so show
      // the growing page count instead of an opaque spinner.
      offProgress = platform.onBuildProgress(
        (p: ExportProgressEvent) => {
          if (p.state === "canceled") {
            exportState = "canceling";
            pdfProgress = "Canceling export…";
            return;
          }
          if (p.state === "error") {
            return;
          }
          syncExportProgress(p);
        }
      );
      const data = await platform.build({
        // #49: the app-facing contract takes a FolderRef (key + displayName).
        input: { key: inputDir, displayName: currentFolderDisplayName ?? basenameOf(inputDir) },
        format: "pdf",
        out: outPath,
        // Validation is skipped for the quick "Save PDF" action by design —
        // it's a fast RGB export, not the full preflight. (Most checks now run
        // in-process and need no system tools; the full validated/PDF-X pipeline
        // is available via the CLI or the Docker image.) Lint stays ON — the
        // in-process PostCSS print-safety checks catch real CSS problems before
        // PDF gen.
        skipPreValidate: true,
        skipPostValidate: true,
      });
      if (data.exportId) activeExportId = data.exportId;
      exportState = "success";
      stopExportTimer();
      updateExportLabel();
      const savedPdfPath = data.pdfPath ?? outPath;
      toast?.success(`PDF saved to ${savedPdfPath}`, 8000, {
        label: "Show in Folder",
        onClick: () => {
          void getPlatform().showInFolder(savedPdfPath).catch(() => {});
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (e) {
      if ((e as { code?: string })?.code === "EXPORT_CANCELED") {
        resetExportState();
        return;
      }
      toast?.error(friendlyPdfError(e));
    } finally {
      offProgress?.();
      resetExportState();
    }
  }

  // #33 Phase 5: HTML export on web. PDF is desktop-only (puppeteer/printToPDF),
  // so on the web (capabilities().nativeSavePath === false) the export delivers a
  // standalone book.html instead — build() renders it in-browser and returns a
  // blob: downloadUrl, which this handler turns into a browser download. Desktop
  // is UNCHANGED: it never reaches here (canSavePdf gates the Save PDF button and
  // build() returns a path-based result there, handled by savePdf()).
  async function exportHtml() {
    const inputDir = currentDir;
    if (!inputDir || busy || exporting || sourceMode === "url") return;
    exporting = true;
    try {
      const displayName = currentFolderDisplayName ?? basenameOf(inputDir) ?? "book";
      const data = await getPlatform().build({
        input: { key: inputDir, displayName },
        format: "html",
      });
      // The web delivery is a downloadUrl (blob:); turn it into a download via a
      // transient <a download> click. Gate on its presence so a path-based
      // (desktop) result would never trigger this branch.
      if (data.downloadUrl) {
        const a = document.createElement("a");
        a.href = data.downloadUrl;
        a.download = `${displayName}.html`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        // Revoke after the click has handed the URL to the browser's download.
        // The adapter transfers object-URL ownership here (it does NOT revoke
        // build() download URLs), so the SPA owns the lifecycle.
        setTimeout(() => URL.revokeObjectURL(data.downloadUrl!), 0);
        toast?.success("HTML exported");
      }
    } catch (e) {
      toast?.error(e instanceof Error ? e.message : "HTML export failed");
    } finally {
      exporting = false;
    }
  }

  async function cancelExport() {
    if (!activeExportId) return;
    exportState = "canceling";
    updateExportLabel();
    await getPlatform().cancelExport(activeExportId).catch(() => {});
  }

  function syncPageState(state: PageState | undefined) {
    if (!state) return;
    currentPage = state.currentPage ?? currentPage;
    totalPages = state.totalPages ?? totalPages;
    if (!pageEditing) pageEditValue = String(currentPage);
    saveViewerPrefs({ currentPage });
  }

  function saveViewerPrefs(patch: Partial<PersistedProjectState>) {
    if (!currentDir || sourceMode !== "folder" || rendering || restoringSavedState) return;
    // Per-project state (#43): write to the folder-keyed bucket so this never
    // overwrites another project's saved page/view. The main process also
    // updates lastProjectDir, so reopening lands on this project.
    getPlatform().setViewerProjectState(currentDir, patch).catch(() => {});
  }

  function restoreProjectPage(page: number) {
    if (!client || rendering) return;
    restoringSavedState = true;
    client.call<PageState>("goToPage", [page])
      .then((state) => {
        currentPage = state.currentPage ?? currentPage;
        totalPages = state.totalPages ?? totalPages;
        if (!pageEditing) pageEditValue = String(currentPage);
        if (currentDir) {
          getPlatform().setViewerProjectState(currentDir, { currentPage }).catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => {
        restoringSavedState = false;
      });
  }

  function runPageCommand(cmd: string, args: unknown[] = []) {
    if (!client || rendering) return;
    client.call<PageState>(cmd, args).then(syncPageState).catch(() => {});
  }

  function gotoPage(n: number) {
    runPageCommand("goToPage", [n]);
  }
  function beginPageEdit() {
    if (rendering) return;
    pageEditing = true;
    pageEditValue = String(currentPage);
  }
  function cancelPageEdit() {
    pageEditing = false;
    pageEditValue = String(currentPage);
  }
  function commitPageEdit() {
    const next = Number(pageEditValue);
    if (Number.isFinite(next)) {
      const clamped = Math.max(1, Math.min(totalPages || 1, Math.round(next)));
      gotoPage(clamped);
    }
    pageEditing = false;
  }
  function firstPage() { runPageCommand("firstPage"); }
  function prevPage() { runPageCommand("prevPage", [viewMode]); }
  function nextPage() { runPageCommand("nextPage", [viewMode]); }
  function lastPage() { runPageCommand("lastPage"); }

  // ── Document outline + editor↔preview sync (UX-013, ADR 0005) ─────────────
  function refreshOutline() {
    if (!client) return;
    client
      .getOutline()
      .then((entries) => {
        outline = entries ?? [];
        activeOutlineIndex = 0;
      })
      .catch(() => {
        outline = [];
      });
  }

  // Mark the deepest heading at/above the given source line as active (drives
  // the dropdown's current-chapter label + highlight).
  function updateActiveOutline(line: number) {
    if (outline.length === 0) return;
    let idx = 0;
    for (let i = 0; i < outline.length; i++) {
      const sl = outline[i].sourceLine;
      if (sl != null && sl <= line) idx = i;
      else if (sl != null && sl > line) break;
    }
    activeOutlineIndex = idx;
  }

  // Jump the preview (and, if open, the editor) to a heading.
  function jumpToOutline(entry: OutlineEntry) {
    if (!client) return;
    // Set active index optimistically so the clicked entry highlights immediately
    // (the async scrollTo may take a frame; without this there's a visible lag).
    const idx = outline.findIndex((o) => o.index === entry.index);
    if (idx >= 0) activeOutlineIndex = idx;
    const target: PreviewTarget =
      entry.id != null
        ? { id: entry.id }
        : entry.sourceLine != null
          ? { line: entry.sourceLine, chapter: entry.chapter }
          : { page: entry.page };
    // Keep the editor in step with the jump. Editor-side first so its scroll
    // doesn't get mistaken for a reader scroll. The jump suppresses the
    // scroll-driven follow, so a cross-chapter jump must move the editor here
    // explicitly — otherwise the preview lands on the new chapter while the
    // editor is left on the old file (they desync).
    suppressPreviewSyncUntil = Date.now() + 400;
    if (entry.sourceLine != null && editorPaneOpen) {
      if (entry.chapter === editorChapter) {
        editorRef?.revealLine(entry.sourceLine);
      } else if (entry.chapter && currentDir && !buffer?.isDirty) {
        followChapterInEditor(entry.chapter, entry.sourceLine);
      }
    }
    client
      .scrollTo(target, { block: "start" })
      .then((res) => {
        if (res?.page) syncPageState({ currentPage: res.page, totalPages });
      })
      .catch(() => {});
  }

  // Cross-chapter follow (preview→editor): open the scrolled chapter's file and
  // reveal the line once the buffer has actually swapped to it. Polls editorChapter
  // (the file load is async) rather than guessing at timing, with a ~2s cap.
  let crossChapterReveal:
    | { chapter: string; line: number; tries: number; nudges: number }
    | null = null;
  function followChapterInEditor(chapter: string, line: number) {
    if (!currentDir) return;
    const dir = currentDir.replace(/[\\/]+$/, "");
    crossChapterReveal = { chapter, line, tries: 0, nudges: 0 };
    // Join with the directory's own separator: on Windows currentDir uses
    // backslashes, and a mixed-separator path still LOADS (Win32 accepts it)
    // but never string-equals the host-native paths from listDir — so the
    // FileTree active highlight silently desyncs after a cross-chapter jump.
    const sep = dir.includes("\\") ? "\\" : "/";
    selectEditorFile(`${dir}${sep}${chapter.replaceAll("/", sep)}`);
    pumpCrossChapterReveal();
  }
  function pumpCrossChapterReveal() {
    const r = crossChapterReveal;
    if (!r) return;
    if (editorChapter === r.chapter && editorRef) {
      // The file load swaps the editor doc and resets scroll to the TOP, and
      // that reset can land AFTER our first reveal — so re-issue the reveal a
      // few times (~250ms) so the last one wins. Without this the editor sat at
      // the top of the newly-opened chapter instead of the synced line.
      suppressPreviewSyncUntil = Date.now() + 300;
      editorRef.revealLine(r.line);
      if (++r.nudges >= 5) {
        crossChapterReveal = null;
        return;
      }
      setTimeout(pumpCrossChapterReveal, 50);
      return;
    }
    // Still waiting for the async file load to swap the buffer to this chapter.
    if (r.tries++ > 40) {
      crossChapterReveal = null;
      return;
    }
    setTimeout(pumpCrossChapterReveal, 50);
  }

  // Editor→preview: the caret moved or the editor scrolled. Drive the preview to
  // the matching source line WITHIN the open chapter; guard the echo so the
  // preview's resulting sourceLineChanged doesn't bounce back into the editor.
  function onEditorAnchorLine(line: number, origin: "scroll" | "caret") {
    if (!client || rendering) return;
    suppressPreviewSyncUntil = Date.now() + 400;
    // Scroll-driven anchors are the editor's TOP visible line → anchor the
    // preview block to the TOP so the panes agree. Caret-driven anchors carry
    // no viewport position (the caret sits anywhere), so CENTER the target —
    // top-anchoring it disagreed with the editor by the caret's distance from
    // the editor top (QA finding RC1-5).
    client
      .scrollTo(
        { line, chapter: editorChapter },
        { block: origin === "caret" ? "center" : "start" },
      )
      .then((res) => {
        // scrollTo suppresses the book's scroll-driven pageChanged, so reflect
        // the new page in the toolbar from the command's own return value.
        if (res?.page) syncPageState({ currentPage: res.page, totalPages });
      })
      .catch(() => {});
  }

  /**
   * Dismiss the loading overlay once the post-render zoom has settled.
   * Waits one animation frame so the zoom reflow has painted before the
   * overlay fades out (out:fade) — a single reveal path, no timers.
   */
  function revealSettledPages() {
    requestAnimationFrame(() => {
      renderCompleteOverlay = false;
    });
  }

  /** Apply fit-width by querying the page's rendered width from the iframe. */
  async function applyFitWidthZoom() {
    if (!client) return;
    try {
      const iframe = document.querySelector<HTMLIFrameElement>("iframe");
      const containerWidth = iframe?.clientWidth ?? window.innerWidth;
      const dims = await client.call<{ width: number; height: number } | null>("getPageDimensions");
      const pageWidth = dims?.width ?? 0;
      const scale = pageWidth > 0 && pageWidth > containerWidth
        ? (containerWidth - 32) / pageWidth
        : 1;
      await client.call("setZoom", [scale]);
    } catch {
      await client.call("setZoom", [1]).catch(() => {});
    }
  }

  function applyZoom(value: string) {
    settings.set({ preview: { defaultZoom: value } });
    if (!client) return;
    if (value === "fit-width") {
      applyFitWidthZoom();
    } else {
      client.call("setZoom", [Number(value)]).catch(() => {});
    }
  }

  function stepZoom(delta: number) {
    const current = zoom === "fit-width" ? 1 : parseFloat(zoom) || 1;
    const next = Math.max(0.25, Math.min(4, current + delta));
    applyZoom(String(Math.round(next * 100) / 100));
  }

  function applyViewMode(mode: "single" | "two-column", fromUser: boolean) {
    // Settings store owns the durable default; ViewerPrefs keeps a per-project
    // override so reopening a folder restores its last view mode.
    settings.set({ preview: { viewMode: mode } });
    if (fromUser) userSetViewMode = true;
    saveViewerPrefs({ viewMode: mode });
    client?.call("setViewMode", [mode]).catch(() => {});
  }

  function toggleViewMode() {
    applyViewMode(viewMode === "single" ? "two-column" : "single", true);
  }

  function toggleDebug() {
    debug = !debug;
    client?.call("toggleDebugMode").catch(() => {});
  }

  // ── Responsive single-pane (narrow viewport) ───────────────────────────────
  // Below this width the editor + preview can't sit side by side, so the
  // workspace collapses to one pane and the Edit / View toggle picks which one
  // shows. Above it, the side-by-side split is used and paneMode is ignored.
  const NARROW_QUERY = `(max-width: ${NARROW_BREAKPOINT}px)`;
  // matchMedia subscription (a genuine lifecycle subscription — the idiomatic
  // use of $effect). On a resize INTO narrow while in edit mode, make sure a
  // file is loaded so the editor isn't empty (the tree is hidden when narrow).
  $effect(() => {
    const mq = window.matchMedia(NARROW_QUERY);
    isNarrow = mq.matches;
    const onChange = (e: MediaQueryListEvent) => {
      isNarrow = e.matches;
      if (e.matches && paneMode === "edit") void ensureEditorFile();
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  });

  // Close the enclosing <details> menu after a menu item is chosen, and return
  // focus to its summary for keyboard users.
  function closeMenu(e: Event) {
    const details = (e.currentTarget as HTMLElement)?.closest("details");
    if (details) {
      details.open = false;
      details.querySelector<HTMLElement>("summary")?.focus();
    }
  }

  function setPaneMode(mode: "edit" | "view") {
    settings.set({ preview: { paneMode: mode } });
    // Switching to the edit pane should open the editor + focus it (folder only).
    if (mode === "edit" && currentDir && sourceMode === "folder") {
      const wasClosed = !editorOpen;
      editorOpen = true;
      void ensureEditorFile();
      if (wasClosed) focusEditorWhenReady();
    }
  }

  // ── Mobile tab bar (#34): Markdown / CSS / Preview ─────────────────────────
  // The single-column (narrow) layout switches the one visible pane between the
  // markdown editor, the CSS editor, and the preview. Both editor tabs share the
  // existing editor pane (the CSS editing surface is the SAME CodeMirror editor
  // with a CSS language mode, #39); the tab just loads the relevant file. The
  // persisted two-state `paneMode` ("edit"/"view") is the source of truth so the
  // existing restore + wide-screen behaviour is untouched.
  //
  // `editorSurface` tracks whether the editor currently holds the markdown or
  // CSS file so the tab bar highlights the right tab without a parallel store.
  let editorSurface = $state<"markdown" | "css">("markdown");
  // The open file's actual extension decides the surface (covers preview→editor
  // chapter follow + recovery + ensureEditorFile picking a file on its own).
  let openFileIsCss = $derived(
    !!editorFilePath && /\.css$/i.test(editorFilePath),
  );
  // Active mobile tab, derived from the persisted paneMode + which file is open.
  // No new persistence: reload restores via paneMode, then the open file decides
  // markdown vs css.
  let mobileTab = $derived<MobileTab>(
    tabFromPaneMode(paneMode, openFileIsCss || editorSurface === "css"),
  );

  /**
   * Find the project's primary CSS file so the CSS tab can open it. Prefers a
   * top-level `.css` (e.g. style.css / theme.css); falls back to the first
   * `.css` anywhere the lister returns. Returns null when the project has none.
   * Mirrors ensureEditorFile's listDir-based discovery (no new host capability).
   */
  async function findProjectCssFile(): Promise<string | null> {
    if (!currentDir || !isDesktop()) return null;
    try {
      const entries = (await getPlatform().listDir(currentDir)).filter((e) => !e.isDir);
      const css = entries
        .filter((e) => /\.css$/i.test(e.name))
        .sort((a, b) => a.name.localeCompare(b.name));
      return css[0]?.path ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Switch the visible mobile pane. Preview → view mode; Markdown/CSS → edit
   * mode with the matching file loaded into the shared editor. Markdown opens
   * the project's first markdown file (ensureEditorFile); CSS opens the project
   * CSS file, surfacing a toast when the project has none.
   */
  function selectMobileTab(tab: MobileTab) {
    const mode = paneModeForTab(tab);
    setPaneMode(mode);
    const surface = editorSurfaceForTab(tab);
    if (surface === "markdown") {
      editorSurface = "markdown";
      // Only swap files if the editor is currently on a CSS file; otherwise keep
      // the author's open chapter (ensureEditorFile is a no-op when one is open).
      if (openFileIsCss) {
        void (async () => {
          const buf = ensureBuffer();
          buf.reset();
          await ensureEditorFile();
        })();
      } else {
        void ensureEditorFile();
      }
      focusEditorWhenReady();
    } else if (surface === "css") {
      editorSurface = "css";
      void (async () => {
        const cssPath = await findProjectCssFile();
        if (cssPath) {
          selectEditorFile(cssPath);
          focusEditorWhenReady();
        } else {
          toast?.info?.("This project has no CSS file to edit.");
        }
      })();
    }
  }

  /**
   * Keyboard navigation for the mobile tablist (WAI-ARIA tabs pattern):
   * Left/Up = previous, Right/Down = next, Home/End = first/last. Activates the
   * focused tab (automatic activation) and moves focus to its button.
   */
  function onMobileTabKeydown(e: KeyboardEvent) {
    let next: MobileTab | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = adjacentTab(mobileTab, 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = adjacentTab(mobileTab, -1);
    else if (e.key === "Home") next = "markdown";
    else if (e.key === "End") next = "preview";
    if (!next) return;
    e.preventDefault();
    selectMobileTab(next);
    queueMicrotask(() => {
      document
        .querySelector<HTMLButtonElement>(`#mobile-tab-${next}`)
        ?.focus();
    });
  }

  // ── Virtual-keyboard handling (#34) ────────────────────────────────────────
  // When the on-screen keyboard opens on a touch device, the visual viewport
  // shrinks while the layout viewport stays put — pushing the editor toolbar
  // (anchored at the top of the editor pane) fine, but leaving the content area
  // partly hidden behind the keyboard. We expose the occluded height as a CSS
  // custom property (--kbd-offset) the narrow editor pane uses to shrink its
  // height so the toolbar + content stay above the keyboard. Pure computation
  // lives in keyboardOffset(); this is the DOM glue. onMount (NOT $effect) per
  // the runes rule: a real lifecycle subscription with an explicit teardown.
  let keyboardInset = $state(0);
  onMount(() => {
    const vv = window.visualViewport;
    if (!vv) return; // No visualViewport support: nothing to adjust.
    const update = () => {
      keyboardInset = keyboardOffset(window.innerHeight, vv.height, vv.offsetTop);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  });

  // ── Auto-update actions ────────────────────────────────────────────────

  async function checkForUpdates() {
    if (!isDesktop()) return;
    checkingUpdates = true;
    toast?.info("Checking for updates…");
    try {
      const status: { phase: string; stagedVersion: string | null; error: string | null } =
        await getPlatform().updater.check();
      if (status.stagedVersion) {
        // An update was downloaded + staged — the banner appears; no toast.
        updateReadyVersion = status.stagedVersion;
      } else if (status.phase === "error") {
        toast?.error(status.error ?? "Update check failed.");
      } else {
        toast?.info("You're up to date.");
      }
    } catch (e) {
      toast?.error(e instanceof Error ? e.message : "Update check failed.");
    } finally {
      checkingUpdates = false;
    }
  }

  async function applyUpdate() {
    if (!isDesktop()) return;
    try {
      await getPlatform().updater.applyNow();
      // Main reloads the window; no further action needed here.
    } catch (e) {
      toast?.error(e instanceof Error ? e.message : "Could not apply update.");
    }
  }

  /**
   * RC3-2: Cancel the in-progress render. Optimistically hides the overlay
   * immediately (<100ms) so the UI feels responsive, then tears down the
   * preview async. The iframe itself stays mounted and VISIBLE (do NOT set
   * opacity or hide it — that would re-trigger the Chromium 1fps throttle;
   * the render simply continues invisibly and finishes harmlessly).
   */
  function handleCancelRender() {
    // Optimistic hide: clear rendering/renderCompleteOverlay first so the
    // overlay disappears on the next microtask, before any async work.
    rendering = false;
    renderCompleteOverlay = false;
    // Async teardown: flush buffer + stop the preview server. Errors are
    // swallowed — the user already dismissed the overlay; no UX to update.
    stopPreview().catch(() => {});
  }

  // ── Force-save / Force-sync (status bar action buttons) ───────────────────
  /**
   * Immediately flush the editor buffer to disk, bypassing the debounce.
   * Mirrors the same flush path used on project-switch and window-close.
   */
  async function handleForceSave() {
    if (!buffer || forceSaving) return;
    forceSaving = true;
    try {
      await buffer.flush();
    } catch (e) {
      toast?.error(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      forceSaving = false;
    }
  }

  /**
   * Trigger an immediate sync for the open project.
   * Reuses the same getPlatform().syncChanges() path the auto-orchestrator uses.
   * Only callable when the project canSync (guarded in StatusBar via showForceSync).
   */
  async function handleForceSync() {
    const dir = currentDir;
    if (!dir || forceSyncing) return;
    forceSyncing = true;
    try {
      const outcome = await getPlatform().syncChanges(dir);
      if (currentDir !== dir) return; // Project switched mid-sync.
      if (outcome.status === "conflict") {
        // Route through the existing conflict dialog path.
        conflictFiles = outcome.files;
        conflictLocalId = outcome.localId;
        conflictRemoteId = outcome.remoteId;
        conflictOpen = true;
      } else if (outcome.status === "synced") {
        onSyncCompleted(outcome.mergedRemoteChanges);
      } else if (outcome.status === "up-to-date") {
        toast?.info("Already up to date — no changes to sync.");
      } else if (outcome.status === "auth") {
        toast?.error("Not connected. Use Connect in the sidebar to set up syncing.");
      } else if (outcome.status === "offline") {
        toast?.info("You appear to be offline. Try again when connected.");
      } else {
        // Generic error state — surface the message if available.
        toast?.error("Sync failed. Check your connection and try again.");
      }
    } catch (e) {
      toast?.error(`Sync failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (currentDir === dir) forceSyncing = false;
    }
  }
</script>

<Toast bind:api={toast} />

<CrashRecoveryDialog
  items={recoveryItems}
  onRestore={restoreRecovery}
  onDiscard={discardRecovery}
  onDismiss={dismissRecovery}
/>

<!-- RC3-1: App-level overlay for the initial "Opening folder…" busy state ONLY
     (no preview pane exists yet). Scoped below the toolbar (z-index:50) and
     all dialogs (1000+). This does NOT cover the preview pane or editor during
     layout — that's handled by the pane-scoped overlay inside .preview-pane. -->
{#if busy && !!busyLabel && !previewUrl}
  <LoadingOverlay
    visible={true}
    label={busyLabel}
    variant="app"
  />
{/if}

<!-- Non-blocking PDF export progress: a corner pill that leaves the preview
     fully interactive (the build runs in a separate render window). -->
{#if exporting && pdfProgress}
  <div class="export-pill" role="status" aria-live="polite" aria-atomic="true">
    {#if exportState === "success"}
      <span class="export-success" aria-hidden="true">✓</span>
    {:else}
      <span class="export-spinner" aria-hidden="true"></span>
    {/if}
    <span class="export-label">{pdfProgress}</span>
    {#if exportState !== "success" && exportState !== "canceling"}
      <button class="export-cancel" onclick={cancelExport} disabled={!activeExportId}>Cancel</button>
    {/if}
  </div>
{/if}

<div class="app-root">
{#if updateReadyVersion}
  <div class="update-banner" role="status" aria-live="polite">
    <span class="update-banner-msg">Update ready (v{updateReadyVersion})</span>
    <button class="update-apply" onclick={applyUpdate}>Apply now</button>
    <button class="update-later" onclick={() => (updateReadyVersion = null)}>Later</button>
  </div>
{/if}

<div class="shell">
  <header class="toolbar" class:edit-narrow={isNarrow && paneMode === "edit"}>
    <section class="left">
      <!-- Panel toggle — far left, first control in navbar -->
      <button
        bind:this={leftPanelToggleBtn}
        class="icon-btn panel-toggle-btn"
        class:active={leftPanelOpen}
        onclick={toggleLeftPanel}
        title="Toggle left panel (Ctrl+\)"
        aria-label="Toggle left panel"
        aria-pressed={leftPanelOpen}
        aria-controls="left-panel-region"
      >
        <Icon name="panel-left" />
      </button>
      {#if sourceMode === "url" && currentUrl}
        {#if docTitle}
          <span class="doc-title" title={docTitle}>{docTitle}</span>
        {/if}
        <span class="path" title={currentUrl}>{currentUrl}</span>
        <button class="icon-btn" onclick={openInBrowser} title="Open in browser" aria-label="Open in browser">
          <Icon name="external-link" />
        </button>
      {:else if currentDir}
        <!-- Folder source: show the title/name; full path is the hover tooltip. -->
        <span class="doc-title" title={currentDir}>{docTitle || folderName}</span>
      {:else}
        <span class="path no-project">print-md</span>
      {/if}
    </section>

    <!-- Center column: absolutely positioned so the page-nav group is always
         truly centered in the toolbar regardless of left/right section widths.
         The Edit toggle sits immediately left of the nav group within this column. -->
    <div class="toolbar-center-col">
      <!-- Edit / View pane toggle — left of the page-nav group on wide screens;
           on narrow screens the pane-toggle radiogroup is used instead (in .right). -->
      {#if !isNarrow}
        <button
          class="icon-text"
          class:active={editorOpen}
          onclick={toggleEditor}
          disabled={!currentDir || sourceMode === "url"}
          title="Toggle markdown editor (Ctrl+E)"
          aria-label="Toggle markdown editor"
          aria-pressed={editorOpen}
        >
          <Icon name="pen-line" /><span class="view-label">Edit</span>
        </button>
        <span class="toolbar-sep" aria-hidden="true"></span>
      {/if}

      <!-- UX-012: center nav only shows when a document is loaded. #34: on narrow
           viewports it is hidden — the absolutely-centered page-nav group would
           collide with the right-aligned Markdown/CSS/Preview tab bar at 390px,
           and the tab bar is the priority control there (the preview still
           scrolls/swipes for page navigation). -->
      {#if previewUrl && !isNarrow}
        <section class="center">
          <button class="icon-btn" onclick={firstPage} disabled={rendering} title="First page (Home)" aria-label="First page">
            <Icon name="chevrons-left" />
          </button>
          <button class="icon-btn" onclick={prevPage} disabled={rendering} title="Previous page (Left/PageUp)" aria-label="Previous page">
            <Icon name="chevron-left" />
          </button>
          {#if pageEditing}
            <input
              bind:this={pageEditInput}
              type="number"
              class="page-input"
              min="1"
              max={totalPages || 1}
              bind:value={pageEditValue}
              onblur={commitPageEdit}
              onkeydown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitPageEdit();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancelPageEdit();
                }
              }}
              aria-label="Go to page"
            />
          {:else}
            <button class="page-pill" onclick={beginPageEdit} disabled={rendering} aria-label="Edit current page">
              <span class="pill-word">Page&nbsp;</span>{currentPage} / {totalPages || "—"}
            </button>
          {/if}
          <button class="icon-btn" onclick={nextPage} disabled={rendering} title="Next page (Right/PageDown)" aria-label="Next page">
            <Icon name="chevron-right" />
          </button>
          <button class="icon-btn" onclick={lastPage} disabled={rendering} title="Last page (End)" aria-label="Last page">
            <Icon name="chevrons-right" />
          </button>
        </section>
      {/if}
    </div>

    <!-- Flex spacer: pushes .right to the far end. -->
    <div class="toolbar-spacer" aria-hidden="true"></div>

    <section class="right">
      <!-- On narrow viewports the layout is single-pane; this radiogroup
           switches which pane is shown (#responsive). Disabled until a project
           folder is open. On wide viewports the Edit button lives in the center
           column (left of the page-nav group) instead. -->
      {#if isNarrow}
        <!-- #34: three-tab single-pane switcher (Markdown / CSS / Preview).
             Real WAI-ARIA tabs: role=tablist + tab, aria-selected, roving
             tabindex, arrow/Home/End navigation. The tabpanels are the existing
             editor + preview panes in .workspace below (linked via aria-controls
             on the active tab). On wide viewports the Edit button in the center
             column is used instead. -->
        <div
          class="pane-toggle"
          role="tablist"
          aria-label="Markdown, CSS, or Preview"
          aria-orientation="horizontal"
        >
          <button
            id="mobile-tab-markdown"
            role="tab"
            class="icon-text seg"
            class:active={mobileTab === "markdown"}
            onclick={() => selectMobileTab("markdown")}
            onkeydown={onMobileTabKeydown}
            disabled={!currentDir || sourceMode === "url"}
            title="Edit your markdown"
            aria-label="Markdown"
            aria-selected={mobileTab === "markdown"}
            aria-controls="mobile-panel-editor"
            tabindex={mobileTab === "markdown" ? 0 : -1}
          >
            <Icon name="pen-line" /><span class="view-label">Markdown</span>
          </button>
          <button
            id="mobile-tab-css"
            role="tab"
            class="icon-text seg"
            class:active={mobileTab === "css"}
            onclick={() => selectMobileTab("css")}
            onkeydown={onMobileTabKeydown}
            disabled={!currentDir || sourceMode === "url"}
            title="Edit the project's CSS"
            aria-label="CSS"
            aria-selected={mobileTab === "css"}
            aria-controls="mobile-panel-editor"
            tabindex={mobileTab === "css" ? 0 : -1}
          >
            <Icon name="palette" /><span class="view-label">CSS</span>
          </button>
          <button
            id="mobile-tab-preview"
            role="tab"
            class="icon-text seg"
            class:active={mobileTab === "preview"}
            onclick={() => selectMobileTab("preview")}
            onkeydown={onMobileTabKeydown}
            disabled={!previewUrl}
            title="Preview your book"
            aria-label="Preview"
            aria-selected={mobileTab === "preview"}
            aria-controls="mobile-panel-preview"
            tabindex={mobileTab === "preview" ? 0 : -1}
          >
            <Icon name="eye" /><span class="view-label">Preview</span>
          </button>
        </div>
      {/if}
      <!-- UX-039: separator before view mode controls -->
      <span class="toolbar-sep" aria-hidden="true"></span>

      <!-- View-mode (single/spread): a pair of segmented buttons on wide
           screens; collapses into a single menu button when space is tight. -->
      <div class="view-mode-group">
        <button
          class="icon-text"
          class:active={viewMode === "single"}
          onclick={() => applyViewMode("single", true)}
          disabled={!previewUrl}
          title="Show one page at a time"
          aria-label="Single page view"
          aria-pressed={viewMode === "single"}
        >
          <Icon name="rectangle-vertical" /><span class="view-label">Single</span>
        </button>
        <button
          class="icon-text"
          class:active={viewMode === "two-column"}
          onclick={() => applyViewMode("two-column", true)}
          disabled={!previewUrl}
          title="Show two pages side by side, like an open book"
          aria-label="Two pages side by side"
          aria-pressed={viewMode === "two-column"}
        >
          <Icon name="columns-2" /><span class="view-label">Two-page</span>
        </button>
      </div>
      <details class="menu view-mode-menu">
        <summary
          class="icon-btn menu-summary"
          title="Page view mode"
          aria-label="Page view mode"
        >
          <Icon name={viewMode === "single" ? "rectangle-vertical" : "columns-2"} />
          <Icon name="chevron-down" size={12} />
        </summary>
        <div class="menu-panel">
          <button
            aria-pressed={viewMode === "single"}
            class="menu-item"
            class:active={viewMode === "single"}
            onclick={(e) => { applyViewMode("single", true); closeMenu(e); }}
            disabled={!previewUrl}
          >
            <Icon name="rectangle-vertical" /> Single page
          </button>
          <button
            aria-pressed={viewMode === "two-column"}
            class="menu-item"
            class:active={viewMode === "two-column"}
            onclick={(e) => { applyViewMode("two-column", true); closeMenu(e); }}
            disabled={!previewUrl}
          >
            <Icon name="columns-2" /> Two pages side by side
          </button>
        </div>
      </details>

      <!-- Zoom: a select on wide screens; collapses into a menu button when
           space is tight. -->
      <select
        class="zoom-select"
        value={zoom}
        onchange={(e) => applyZoom((e.currentTarget as HTMLSelectElement).value)}
        disabled={!previewUrl}
        aria-label="Zoom level"
        title="Zoom — F fits the page to the window, + / − zoom in and out"
      >
        <option value="fit-width">Fit to width</option>
        <option value="0.25">25%</option>
        <option value="0.5">50%</option>
        <option value="0.75">75%</option>
        <option value="1">100%</option>
        <option value="1.25">125%</option>
        <option value="1.5">150%</option>
        <option value="2">200%</option>
      </select>
      <details class="menu zoom-menu">
        <summary
          class="icon-btn menu-summary"
          title="Zoom level"
          aria-label="Zoom level"
        >
          <Icon name="zoom-in" />
          <Icon name="chevron-down" size={12} />
        </summary>
        <div class="menu-panel">
          {#each [["fit-width", "Fit to width"], ["0.25", "25%"], ["0.5", "50%"], ["0.75", "75%"], ["1", "100%"], ["1.25", "125%"], ["1.5", "150%"], ["2", "200%"]] as [val, label] (val)}
            <button
              aria-pressed={zoom === val}
              class="menu-item"
              class:active={zoom === val}
              onclick={(e) => { applyZoom(val); closeMenu(e); }}
              disabled={!previewUrl}
            >
              {label}
            </button>
          {/each}
        </div>
      </details>

      <!-- UX-039: separator before Save PDF -->
      <span class="toolbar-sep" aria-hidden="true"></span>
      <!-- #33 Phase 4: PDF export is desktop-only (puppeteer/printToPDF). On the
           web (capabilities().nativeSavePath === false) the control is replaced
           with a short "requires the desktop app" note. On desktop
           (nativeSavePath:true) this is UNCHANGED. -->
      {#if canSavePdf}
        <!-- UX-006: Save PDF always visible; icon-only at narrow widths -->
        <button
          class="primary save-btn icon-text"
          onclick={savePdf}
          disabled={busy || exporting || !currentDir || sourceMode === "url"}
          title="Save as PDF (Ctrl+S)"
        >
          <Icon name="file-down" />
          <span class="save-btn-label">{exporting ? "Saving…" : "Save PDF"}</span>
        </button>
        <!-- UX-023: explain why Save PDF is disabled -->
        {#if !currentDir && !busy}
          <span class="save-hint">Open a folder first</span>
        {:else if sourceMode === "url"}
          <span class="save-hint">Not available for web previews</span>
        {:else if saveWarning}
          <span class="save-hint save-warning" role="alert">{saveWarning}</span>
        {/if}
      {:else}
        <!-- #33 Phase 5: PDF is desktop-only; on the web export a standalone
             book.html instead (build({format:"html"}) → blob downloadUrl). -->
        <button
          class="primary save-btn icon-text"
          onclick={exportHtml}
          disabled={busy || exporting || !currentDir || sourceMode === "url"}
          title="Export as HTML"
        >
          <Icon name="file-down" />
          <span class="save-btn-label">{exporting ? "Exporting…" : "Export HTML"}</span>
        </button>
        {#if !currentDir && !busy}
          <span class="save-hint">Open a folder first</span>
        {:else if sourceMode === "url"}
          <span class="save-hint">Not available for web previews</span>
        {/if}
        <span class="save-hint" role="note">PDF export requires the desktop app</span>
      {/if}
      <!-- Settings panel (#45): gear icon + Cmd/Ctrl+, shortcut. Inline on wide
           screens; folds into the "More" menu when space is tight. -->
      <button
        bind:this={settingsBtn}
        class="icon-btn opt-inline"
        onclick={() => (settingsOpen = true)}
        title="Settings (Ctrl+,)"
        aria-label="Settings"
      >
        <Icon name="settings" />
      </button>
      <!-- UX-026: bind:this for focus restore -->
      <button
        bind:this={helpBtn}
        class="icon-btn opt-inline"
        onclick={() => (helpOpen = true)}
        title="Help / About"
        aria-label="Help and system info"
      >
        <Icon name="circle-help" />
      </button>
      <!-- Overflow menu: collapses Settings + Help into one button at narrow
           widths so the toolbar never crowds the page navigation. -->
      <details class="menu more-menu">
        <summary class="icon-btn menu-summary" title="More" aria-label="More options">
          <Icon name="ellipsis-vertical" />
        </summary>
        <div class="menu-panel menu-panel-right">
          <button class="menu-item" onclick={(e) => { settingsOpen = true; closeMenu(e); }}>
            <Icon name="settings" /> Settings
          </button>
          {#if isDesktop()}
            <!-- Advanced setup (#14): Git/remote diagnostics + private servers -->
            <button
              bind:this={advancedSetupBtn}
              class="menu-item"
              onclick={(e) => { advancedSetupOpen = true; closeMenu(e); }}
            >
              <Icon name="link" /> Advanced setup
            </button>
          {/if}
          {#if isDesktop() && currentDir}
            <!-- Save as template (#29): capture this project as a reusable starter -->
            <button
              class="menu-item"
              onclick={(e) => { openSaveAsTemplate(); closeMenu(e); }}
            >
              <Icon name="puzzle" /> Save as template…
            </button>
          {/if}
          <button class="menu-item" onclick={(e) => { helpOpen = true; closeMenu(e); }}>
            <Icon name="circle-help" /> Help &amp; about
          </button>
        </div>
      </details>
    </section>
  </header>

  <!-- Global left panel — available in both preview and edit modes -->
  <div id="left-panel-region" class="left-panel-region" class:panel-open={leftPanelOpen} style="--left-panel-width: {leftPanelWidth}px">
    <LeftPanel
      bind:open={leftPanelOpen}
      bind:width={leftPanelWidth}
      bind:activeTab={leftPanelTab}
      projectDir={currentDir}
      projectCapabilities={projectCapabilities}
      projectSharesParentHistory={projectSharesParentHistory}
      editorFilePath={editorFilePath}
      sourceMode={sourceMode}
      outline={outline}
      activeOutlineIndex={activeOutlineIndex}
      toggleBtn={leftPanelToggleBtn}
      onJumpToOutline={jumpToOutline}
      onSelectEditorFile={(path) => {
        selectEditorFile(path);
        if (!editorOpen && currentDir && sourceMode === "folder") {
          editorOpen = true;
          focusEditorWhenReady();
        }
      }}
      onInsertImage={(payload) => editorRef?.runToolbarAction("image", { src: payload.src, alt: payload.alt ?? "" })}
      onProjectChosen={(path) => startFolderPreview(path)}
      onOpenUrl={openUrl}
      onOpenGitHub={isDesktop() ? () => (githubOpen = true) : undefined}
      onNewProject={() => (newProjectOpen = true)}
      onVersionHistoryEnabled={onVersionHistoryEnabled}
      onSnapshotSaved={(entry) => onVersionSnapshotSaved()}
      onVersionRestored={onVersionRestored}
      onSyncReconnect={onSyncReconnect}
      refreshKey={historyRefreshKey}
    />

    <!-- Main content area (preview + editor) -->
    <div class="main-content">

  {#if previewUrl}
    <div
      class="workspace"
      class:editor-open={editorPaneOpen}
      class:narrow={isNarrow}
      class:show-edit={isNarrow && paneMode === "edit"}
      class:show-view={isNarrow && paneMode === "view"}
      style="--kbd-offset: {keyboardInset}px"
    >
      {#if editorPaneOpen}
        <section
          class="pane editor-pane"
          id="mobile-panel-editor"
          role={isNarrow ? "tabpanel" : undefined}
          aria-label={mobileTab === "css" ? "CSS editor" : "Markdown editor"}
        >
          {#if externalChange}
            <ExternalEditBanner
              fileName={externalFileName}
              onReload={reloadExternal}
              onKeepMine={keepMineExternal}
            />
          {/if}
          <!-- Editor toolbar (#31): compact formatting bar, visible only when a
               markdown file is open. Placed above the editor, within the pane. -->
          <EditorToolbar
            filePath={editorFilePath}
            projectDir={currentDir}
            onAction={(action, payload) => {
              if (action === "snippet") {
                openSnippetPicker();
                return;
              }
              editorRef?.runToolbarAction(action, payload);
            }}
          />
          <!-- Save-state indicator: unobtrusive status bar below the toolbar.
               Visible only when a file is open. aria-live="polite" announces
               phase transitions to screen readers without interrupting. -->
          {#if editorFilePath}
            <div class="editor-status-bar" aria-live="polite" aria-atomic="true">
              {#if editorSavePhase === "dirty" || editorSavePhase === "saving"}
                <span class="save-status saving">Saving…</span>
              {:else if editorSavePhase === "clean" && buffer?.filePath}
                <span class="save-status saved">Saved</span>
              {:else if editorSavePhase === "error"}
                <span class="save-status save-error">Save error</span>
              {/if}
            </div>
          {/if}
          {#if MarkdownEditor}
            <MarkdownEditor
              bind:this={editorRef}
              filePath={editorFilePath}
              content={editorContent}
              onChange={onEditorChange}
              onAnchorLine={onEditorAnchorLine}
            />
          {:else if editorModuleFailed}
            <div class="editor-loading" role="alert">
              <p>The editor failed to load.</p>
              <button class="primary" onclick={retryEditorLoad}>Retry</button>
            </div>
          {:else}
            <div class="editor-loading" role="status" aria-live="polite">
              Loading editor…
            </div>
          {/if}
        </section>
      {/if}
      <section
        class="pane preview-pane"
        id="mobile-panel-preview"
        role={isNarrow ? "tabpanel" : undefined}
        aria-labelledby={isNarrow ? "mobile-tab-preview" : undefined}
        inert={isNarrow && paneMode === "edit" ? true : undefined}
      >
        {#key previewUrl}
          <PreviewFrame
            url={previewUrl}
            bind:client
            onError={(msg) => {
              if (sourceMode === "url") {
                urlPreviewError = "This website could not be previewed inside print-md.";
              } else {
                toast?.error(msg);
              }
            }}
          />
        {/key}
        <!-- RC3-1: Pane-scoped overlay — position:absolute within .preview-pane
             (which has position:relative). Covers ONLY the preview area; the
             editor pane, toolbar, and all dialogs remain fully interactive.
             z-index:10 (above the iframe, below any stacking context above).
             RC3-2: onCancel calls handleCancelRender which immediately clears
             rendering/renderCompleteOverlay (optimistic hide <100ms), then
             tears down async. -->
        <LoadingOverlay
          visible={rendering || renderCompleteOverlay}
          label={renderCompleteOverlay ? "Rendering complete…" : renderProgressPage > 0 ? `Laying out page ${renderProgressPage}…` : "Rendering…"}
          onCancel={rendering ? handleCancelRender : undefined}
          variant="pane"
        />
        <!-- Recovery overlay: pane-scoped, position:absolute, TRANSLUCENT scrim.
             Non-dismissable during repair; auto-dismisses after ~1.8s on success.
             Hard rule (memory: never hide cross-origin preview iframe): scrim is
             translucent (var(--app-overlay) + backdrop-filter:blur), never opaque. -->
        <RecoveryOverlay
          visible={recoveryOverlayVisible}
          phase={recoveryOverlayPhase}
          recoveryState={recoveryOverlayState}
          backupZipPath={recoveryBackupZipPath}
          logFilePath={recoveryLogFilePath}
          onShowBackup={recoveryBackupZipPath ? () => showBackupInFolder(recoveryBackupZipPath!) : undefined}
          onDone={onRecoveryOverlayDone}
        />
      </section>
    </div>
  {:else}
    <div class="empty">
      <div class="empty-hero">
        <div class="empty-icon" aria-hidden="true">📖</div>
        <h1 class="empty-title">print-md</h1>
        <p class="empty-tagline">Turn your markdown writing into a print-ready book</p>
        <div class="empty-cta-row">
          <button bind:this={newProjectBtn} class="primary empty-cta" onclick={() => (newProjectOpen = true)} disabled={busy}>Create a new book</button>
          <button class="ghost empty-cta" onclick={() => {
            leftPanelOpen = true;
            leftPanelTab = "projects";
          }} disabled={busy}>Open an existing book</button>
        </div>
        <p class="empty-hint">New to print-md? <button type="button" class="link-btn" onclick={openSetupGuide}>Read the getting-started guide →</button></p>
        <p class="empty-hint">Already have a book folder? Open it from the left panel, or preview a published document from a web address.</p>
        {#if urlPreviewError && sourceMode === "url"}
          <div class="open-error" role="alert">
            <strong>Preview unavailable.</strong>
            <p>{urlPreviewError}</p>
          </div>
        {:else if openError}
          <div class="open-error" role="alert">
            <strong>Couldn't open that folder.</strong>
            <p>{friendlyFolderError(openError)}</p>
          </div>
        {/if}
      </div>
    </div>
  {/if}

    </div> <!-- /main-content -->
  </div> <!-- /left-panel-region -->

  <!-- StatusBar: always-visible bottom bar with sync pill, save indicator,
       and problems panel toggle. Sits below the left-panel-region in the
       .shell flex column so it spans the full window width. Never covers
       the preview iframe (normal layout flow). -->
  <StatusBar
    projectDir={currentDir}
    sourceMode={sourceMode}
    canSync={!!(syncDiag?.canSync)}
    canSnapshot={!!(projectCapabilities?.canSnapshot)}
    savePhase={editorSavePhase}
    fileOpen={!!editorFilePath}
    {forceSaving}
    {forceSyncing}
    {problems}
    problemsLoading={problemsLoading}
    bind:problemsOpen={problemsOpen}
    onProblemSelect={openProblem}
    onReconnect={onSyncReconnect}
    onConflict={onPillConflict}
    onShowLog={showProjectLog}
    onForceSave={handleForceSave}
    onForceSync={handleForceSync}
  />
</div>
</div>

<!-- Operation log viewer — opened from the StatusBar git/sync status pill.
     Keyed by currentDir so switching projects remounts the dialog and its
     internal logContent resets — prevents one project's log briefly showing
     for another when the pill is clicked before a new log path is observed. -->
{#key currentDir}
  <OperationLogDialog bind:open={logDialogOpen} logFilePath={logFilePath} />
{/key}

<HelpDialog
  bind:open={helpOpen}
  triggerEl={helpBtn}
  onCheckForUpdates={checkForUpdates}
  {checkingUpdates}
  {updateReadyVersion}
/>
<SettingsDialog bind:open={settingsOpen} triggerEl={settingsBtn} />
<GitHubDialog
  bind:open={githubOpen}
  onOpened={(projectDir) => startFolderPreview(projectDir, "Opening your project…")}
  onAdvancedSetup={() => (advancedSetupOpen = true)}
  triggerEl={leftPanelToggleBtn}
/>
<AdvancedSetupDialog
  bind:open={advancedSetupOpen}
  projectDir={sourceMode === "folder" ? currentDir : null}
  triggerEl={advancedSetupBtn}
/>
<NewProjectWizard
  bind:open={newProjectOpen}
  onCreated={(projectDir) => startFolderPreview(projectDir, "Opening your new book…")}
  triggerEl={newProjectBtn}
/>
<!-- Snippet picker (#29): insert a reusable markdown fragment at the cursor,
     prompting for {{variable}} placeholders. Desktop-only (file IO host gate). -->
<SnippetPicker
  bind:this={snippetPickerRef}
  bind:open={snippetPickerOpen}
  projectDir={currentDir}
  getSelectionText={() => editorRef?.getSelectionText() ?? ""}
  onInsert={(text) => editorRef?.insertSnippet(text)}
/>
<!-- Save-as-template name prompt (#29). Minimal modal: name + confirm. -->
{#if saveTemplateOpen}
  <div class="save-tpl-backdrop" role="presentation" onclick={() => (saveTemplateOpen = false)}></div>
  <div class="save-tpl-dialog" role="dialog" aria-modal="true" aria-labelledby="save-tpl-title">
    <h2 id="save-tpl-title">Save as template</h2>
    <p class="save-tpl-lead">
      Save this project as a reusable starter you can pick when creating a new book.
    </p>
    <label class="save-tpl-field">
      <span>Template name</span>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        type="text"
        bind:value={saveTemplateName}
        placeholder="My Template"
        autocomplete="off"
        autofocus
        onkeydown={(e) => { if (e.key === "Enter") { e.preventDefault(); confirmSaveAsTemplate(); } }}
      />
    </label>
    {#if saveTemplateError}
      <p class="save-tpl-error" role="alert">{saveTemplateError}</p>
    {/if}
    <div class="save-tpl-actions">
      <button class="ghost" onclick={() => (saveTemplateOpen = false)} disabled={saveTemplateBusy}>Cancel</button>
      <button class="primary" onclick={confirmSaveAsTemplate} disabled={saveTemplateBusy}>
        {saveTemplateBusy ? "Saving…" : "Save template"}
      </button>
    </div>
  </div>
{/if}
<!-- ConflictChoicesDialog (#transparent-sync §6.1): opened by the ambient
     SyncStatusPill when the auto-sync orchestrator surfaces a conflict.
     Plain-language "Keep my version / Use the online version / Keep both"
     with "Keep both" as the highlighted lossless default. -->
<ConflictChoicesDialog
  bind:open={conflictOpen}
  projectDir={sourceMode === "folder" ? currentDir : null}
  bookSubPath={projectSubPath}
  files={conflictFiles}
  localId={conflictLocalId}
  remoteId={conflictRemoteId}
  onResolved={(mergedRemoteChanges) => {
    onSyncCompleted(mergedRemoteChanges);
    conflictFiles = [];
    conflictLocalId = null;
    conflictRemoteId = null;
  }}
  onReconnect={onSyncReconnect}
/>

<!-- RecoveryConfirmDialog: risky-repair confirmation gate. Shown when the host
     recovery subsystem needs author approval before proceeding with a
     medium/high-risk repair. Always answers the gate (approved or rejected) via
     getPlatform().respondRecoveryConfirm so the host is never left hanging. -->
<RecoveryConfirmDialog
  bind:open={recoveryConfirmOpen}
  request={recoveryConfirmRequest}
  onShowBackup={(path) => showBackupInFolder(path)}
/>

<!-- RecoveryGuidanceDialog: shown when automated recovery is blocked or fails
     with a classified error. Plain-language guidance + recommended next step +
     optional safe-steps list. No Git jargon. -->
<RecoveryGuidanceDialog
  bind:open={recoveryGuidanceOpen}
  guidance={recoveryGuidance}
  backupZipPath={recoveryGuidanceBackupPath}
  logFilePath={recoveryGuidanceLogPath}
  onShowBackup={(path) => showBackupInFolder(path)}
  onPrimary={onSyncReconnect}
/>

<style>
  :global(html, body) {
    margin: 0;
    height: 100%;
    background: var(--app-bg);
    color: var(--app-text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
  }

  .app-root {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }
  .shell {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
  }

  /* ── Left panel layout region ───────────────────────────────────────────── */
  /* The left-panel-region is a horizontal flex row containing the LeftPanel
     component (which manages its own width + transform) and the .main-content.
     The panel's translateX(-100%) when closed collapses it to zero effective
     width, so .main-content always gets the full remaining space. */
  .left-panel-region {
    display: flex;
    flex-direction: row;
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
    position: relative;
  }
  /* When panel is closed, the LeftPanel has width:260px but translateX(-100%)
     so it's off-screen. Margin-left on .main-content compensates: 0 when open,
     -260px when closed so main-content fills the full width. */
  .left-panel-region .main-content {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
    /* Animate alongside the panel transition */
    transition: margin-left 0.18s ease-out;
    margin-left: 0;
  }
  /* Panel closed: pull .main-content leftward to fill the panel's "ghost" space.
     The LeftPanel is always in DOM but translateX(-100%) so its flex width = 260px
     even when off-screen. We compensate with a negative margin-left. */
  .left-panel-region:not(.panel-open) .main-content {
    margin-left: calc(-1 * var(--left-panel-width, 260px));
  }
  /* Narrow screens: panel overlays, so main-content never shifts */
  @media screen and (max-width: 820px) {
    .left-panel-region:not(.panel-open) .main-content {
      margin-left: 0;
    }
  }

  /* ---- Editor workspace: [file-tree | editor | preview] (#38) ---- */
  /* When the editor is closed the preview takes the full width, preserving
     the prior single-pane behaviour exactly. */
  .workspace {
    display: grid;
    grid-template-columns: 1fr;
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
  }
  /* Editor open: [editor | preview]. The preview is weighted heaviest
     since it's the primary output for a writer. */
  .workspace.editor-open {
    grid-template-columns: minmax(280px, 1fr) minmax(360px, 1.4fr);
  }
  .pane {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .editor-pane {
    border-right: 1px solid var(--app-border);
  }
  .editor-loading {
    flex: 1;
    display: grid;
    place-items: center;
    padding: 24px;
    color: var(--app-text-faint);
    font-size: 13px;
  }
  /* Save-state indicator — a thin status bar below the editor toolbar. */
  .editor-status-bar {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding: 2px 10px;
    min-height: 20px;
    border-bottom: 1px solid var(--app-border-subtle);
    background: var(--app-surface);
    flex-shrink: 0;
  }
  .save-status {
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    transition: opacity 0.2s;
  }
  .save-status.saving { color: var(--app-text-faint); }
  .save-status.saved  { color: var(--app-text-faint); }
  .save-status.save-error { color: var(--app-error-text); }
  .preview-pane {
    position: relative;
  }
  /* Narrow widths: give editor + preview equal space. */
  @media screen and (max-width: 1100px) {
    .workspace.editor-open {
      grid-template-columns: minmax(240px, 1fr) minmax(280px, 1.1fr);
    }
  }

  /* ---- Non-blocking PDF export progress pill ---- */
  .export-pill {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 50;
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: 420px;
    padding: 10px 14px;
    border-radius: 8px;
    background: var(--app-surface-raised);
    border: 1px solid var(--app-border);
    box-shadow: 0 4px 16px var(--app-shadow-md);
    color: var(--app-text);
    font-size: 13px;
    pointer-events: auto;
  }
  .export-spinner {
    width: 14px;
    height: 14px;
    flex: 0 0 auto;
    border: 2px solid var(--app-spinner-track);
    border-top-color: var(--app-spinner-head);
    border-radius: 50%;
    animation: export-spin 0.8s linear infinite;
  }
  .export-label {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .export-success {
    width: 14px;
    flex: 0 0 auto;
    color: var(--app-success-text);
    font-weight: 700;
    text-align: center;
  }
  .export-cancel {
    background: transparent;
    border: 1px solid var(--app-border-strong);
    color: var(--app-text-secondary);
    border-radius: 999px;
    padding: 4px 10px;
    font-size: 12px;
  }
  .export-cancel:hover:not(:disabled) {
    background: var(--app-scrim-strong);
    border-color: var(--app-control-hover-border);
  }
  @keyframes export-spin {
    to { transform: rotate(360deg); }
  }

  /* ---- Toolbar ---- */
  .toolbar {
    /* Flex layout: [left] [spacer] [right] with .toolbar-center-col absolutely
       centered via position:absolute + left:50% + translateX(-50%).
       This guarantees the page-nav group (+ Edit toggle) is always at the
       horizontal midpoint of the toolbar regardless of left/right section widths.
       The single .toolbar-spacer absorbs remaining slack between left and right.
       container-type: inline-size enables @container queries so toolbar
       breakpoints respond to toolbar width, not viewport width — the correct
       tool for a component that may be constrained by surrounding layout. */
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 12px;
    height: 56px;
    flex-shrink: 0;
    container-type: inline-size;
    background: linear-gradient(to bottom, var(--app-toolbar-from), var(--app-toolbar-to));
    border-bottom: 1px solid var(--app-border);
    /* Stacking context ABOVE the workspace panes so dropdown menus that hang
       below the toolbar paint over the preview, not behind it. overflow must
       stay visible for the same reason — `overflow: hidden` clips dropdowns. */
    position: relative;
    z-index: 100;
    overflow: visible;
  }

  /* Single flex spacer pushes .right to the far end; the center column is
     absolutely positioned so it is always mathematically centered. */
  .toolbar-spacer {
    flex: 1 1 0;
    min-width: 0;
  }

  /* Center column: absolutely centered in the toolbar so the page-nav group
     is always at 50% regardless of left/right section widths. Contains the
     Edit toggle (left of nav) and the page-nav section. pointer-events: none
     on the wrapper prevents the transparent sides from swallowing clicks;
     each interactive child restores pointer-events. */
  .toolbar-center-col {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 6px;
    pointer-events: none;
  }
  .toolbar-center-col > *,
  .toolbar-center-col button,
  .toolbar-center-col input,
  .toolbar-center-col .center {
    pointer-events: auto;
  }

  section { display: flex; align-items: center; gap: 6px; min-width: 0; }
  /* .left never shrinks — Open button must always be visible and clickable.
     doc-title / path inside .left truncate via text-overflow on their own.
     .right is also fixed-size; the single spacer absorbs slack between them. */
  .left  { flex: 0 0 auto; overflow: hidden; }
  .center { flex: 0 0 auto; }
  .right  { flex: 0 0 auto; }

  /* ---- Buttons & inputs ---- */
  button, select {
    background: var(--app-control-bg);
    border: 1px solid var(--app-control-border);
    color: var(--app-control-text);
    padding: 5px 10px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
  }
  button:hover:not(:disabled) {
    background: var(--app-control-hover-bg);
    border-color: var(--app-control-hover-border);
  }
  button.primary {
    background: linear-gradient(to bottom, var(--app-accent-hover), var(--app-accent));
    border-color: var(--app-accent-border);
    color: var(--app-accent-text);
    font-weight: 600;
  }
  button.primary:hover:not(:disabled) {
    background: linear-gradient(to bottom, var(--app-accent-bright), var(--app-accent-hover));
  }
  button.active {
    background: linear-gradient(to bottom, var(--app-accent-hover), var(--app-accent));
    border-color: var(--app-accent-border);
    color: var(--app-accent-text);
  }
  button:disabled, select:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  /* Explicit focus ring for all toolbar interactive elements — replaces UA
     default (browser-specific yellow ring) with the app's consistent ring. */
  button:focus-visible,
  select:focus-visible {
    outline: 2px solid var(--app-focus-ring);
    outline-offset: 2px;
  }

  .icon-btn {
    padding: 5px 8px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  /* Button vocabulary: in the toolbar, secondary controls (nav arrows, settings,
     help, menu summaries) read as ONE ghost family — transparent until hover —
     so the filled treatment is reserved for the primary actions (Open, Save PDF)
     and active toggles (Edit, the selected view-mode segment). This removes the
     "every control is a box" clutter the design review flagged. */
  .toolbar .icon-btn:not(.active),
  .toolbar .menu-summary {
    background: transparent;
    border-color: transparent;
  }
  .toolbar .icon-btn:not(.active):hover:not(:disabled),
  .toolbar .menu-summary:hover {
    background: var(--app-control-hover-bg);
    border-color: transparent;
  }
  /* Combo button: icon + label text side by side */
  .icon-text {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .icon-text :global(svg) { flex: 0 0 auto; }

  /* UX-014: small text label under/beside view mode icon */
  .view-label { font-size: 11px; }

  /* Edit/View segmented toggle (narrow single-pane mode) */
  .pane-toggle {
    display: inline-flex;
    gap: 0;
    background: var(--app-control-bg);
    border: 1px solid var(--app-control-border);
    border-radius: 7px;
    padding: 2px;
  }
  .pane-toggle .seg {
    border-radius: 5px;
    border: 1px solid transparent;
    background: transparent;
  }
  /* Active segment: filled accent, matching .view-mode-group button.active */
  .pane-toggle .seg.active {
    background: linear-gradient(to bottom, var(--app-accent-hover), var(--app-accent));
    border-color: var(--app-accent-border);
    color: var(--app-accent-text);
  }

  /* ---- Collapsible dropdown menus (view-mode + zoom) ---- */
  /* On wide screens the inline controls (.view-mode-group / .zoom-select) show
     and the menu buttons hide. Below a breakpoint they swap. */
  /* Narrow + Edit mode: the preview is hidden, so its controls (page navigation,
     single/spread, zoom) are noise — hide them so the edit toolbar is just
     Open / Edit·View / Save / More. The spacers collapse the gap automatically
     when center is absent. */
  .toolbar.edit-narrow .toolbar-center-col,
  .toolbar.edit-narrow .view-mode-group,
  .toolbar.edit-narrow .view-mode-menu,
  .toolbar.edit-narrow .zoom-select,
  .toolbar.edit-narrow .zoom-menu {
    display: none;
  }

  .menu { position: relative; display: none; }
  /* The "More" overflow menu uses higher specificity (details.more-menu) than
     the generic `.menu { display: inline-block }` shown at <=980px, so it stays
     hidden until its own <=620px breakpoint. */
  details.more-menu { display: none; }
  .menu-summary {
    list-style: none;
    display: inline-flex;
    align-items: center;
    gap: 2px;
    cursor: pointer;
  }
  .menu-summary::-webkit-details-marker { display: none; }
  .menu[open] .menu-summary {
    background: var(--app-control-hover-bg);
    border-color: var(--app-control-hover-border);
  }
  .menu-panel {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: 80;
    min-width: 168px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 4px;
    background: var(--app-surface-raised);
    border: 1px solid var(--app-border);
    border-radius: 8px;
    box-shadow: 0 6px 20px var(--app-shadow-md);
  }
  .menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    text-align: left;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 5px;
    padding: 6px 10px;
    font-size: 13px;
    white-space: nowrap;
  }
  .menu-item:hover:not(:disabled) {
    background: var(--app-control-hover-bg);
    border-color: var(--app-control-hover-border);
  }
  .menu-item.active {
    background: linear-gradient(to bottom, var(--app-accent-hover), var(--app-accent));
    border-color: var(--app-accent-border);
    color: var(--app-accent-text);
  }
  /* Page/Spread as a true segmented control: one bordered track, the selected
     segment filled, the other transparent — so "which mode am I in" is obvious. */
  .view-mode-group {
    display: inline-flex;
    gap: 0;
    background: var(--app-control-bg);
    border: 1px solid var(--app-control-border);
    border-radius: 7px;
    padding: 2px;
  }
  .view-mode-group button {
    border: 1px solid transparent;
    background: transparent;
    border-radius: 5px;
    padding: 4px 9px;
  }
  .view-mode-group button:hover:not(:disabled) {
    background: var(--app-control-hover-bg);
    border-color: transparent;
  }
  .view-mode-group button.active {
    background: linear-gradient(to bottom, var(--app-accent-hover), var(--app-accent));
    border-color: var(--app-accent-border);
    color: var(--app-accent-text);
  }

  .page-input {
    background: var(--app-control-bg);
    border: 1px solid var(--app-control-border);
    color: var(--app-control-text);
    padding: 5px 4px;
    border-radius: 6px;
    font-size: 13px;
    width: 52px;
    text-align: center;
  }
  .page-input:disabled { opacity: 0.4; }
  .page-pill {
    background: linear-gradient(to bottom, var(--app-pill-from), var(--app-pill-to));
    border-color: var(--app-pill-border);
    color: var(--app-pill-text);
    min-width: 104px;
    text-align: center;
  }
  .page-pill:hover:not(:disabled) {
    background: linear-gradient(to bottom, var(--app-pill-from), var(--app-pill-to));
    border-color: var(--app-control-hover-border);
  }

  .zoom-select { padding: 5px 6px; }

  /* Panel toggle button — keeps its ghost style as active when panel is open,
     with the accent fill matching other active toggles (Edit, view mode). */
  .panel-toggle-btn.active {
    background: linear-gradient(to bottom, var(--app-accent-hover), var(--app-accent));
    border-color: var(--app-accent-border);
    color: var(--app-accent-text);
  }
  .panel-toggle-btn.active:hover:not(:disabled) {
    background: linear-gradient(to bottom, var(--app-accent-bright), var(--app-accent-hover));
  }

  .doc-title {
    color: var(--app-text-secondary);
    font-size: 13px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 200px;
    flex-shrink: 1;
  }
  .no-project {
    font-weight: 700;
    color: var(--app-text-secondary);
  }

  /* UX-031: muted token for better contrast */
  .path {
    color: var(--app-text-muted);
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 260px;
    flex-shrink: 2;
  }

  /* UX-039: visual separator between toolbar groups */
  .toolbar-sep {
    width: 1px;
    height: 20px;
    background: var(--app-border-strong);
    margin: 0 4px;
    flex-shrink: 0;
  }

  /* UX-023: hint below Save PDF when disabled */
  .save-hint {
    font-size: 11px;
    color: var(--app-text-faint);
    white-space: nowrap;
  }
  .save-warning {
    color: var(--app-warning-text);
    max-width: 240px;
    white-space: normal;
    line-height: 1.35;
  }

  /* ---- Empty state / welcome hero ---- */
  .empty {
    flex: 1;
    display: grid;
    place-items: center;
    color: var(--app-text-faint);
    text-align: center;
  }
  .empty-hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    max-width: 400px;
    text-align: center;
    padding: 32px 24px;
  }
  .empty-icon { font-size: 48px; line-height: 1; margin-bottom: 4px; }
  .empty-title { margin: 0; font-size: 22px; font-weight: 700; color: var(--app-text-secondary); letter-spacing: -0.3px; }
  .empty-tagline { margin: 0; font-size: 14px; color: var(--app-text-muted); line-height: 1.5; }
  .empty-cta-row { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; margin-top: 4px; }
  .empty-cta { padding: 10px 24px; font-size: 14px; font-weight: 600; border-radius: 8px; }
  .empty-hint { margin: 0; font-size: 12px; color: var(--app-text-faint); line-height: 1.5; }
  .link-btn {
    background: none;
    border: 0;
    padding: 0;
    margin: 0;
    color: var(--app-link, var(--app-accent));
    font: inherit;
    cursor: pointer;
    text-decoration: underline;
  }
  .link-btn:hover { color: var(--app-accent-bright, var(--app-accent)); }
  .open-error {
    background: var(--app-error-bg);
    border: 1px solid var(--app-error-border);
    border-radius: 6px;
    padding: 10px 14px;
    font-size: 12px;
    color: var(--app-error-text);
    max-width: 340px;
    text-align: left;
    line-height: 1.5;
  }
  .open-error strong { display: block; margin-bottom: 4px; font-size: 13px; }
  .open-error p { margin: 0; color: var(--app-error-text); }

  /* ---- Auto-update banner ---- */
  .update-banner {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 16px;
    background: var(--app-success-bg);
    border-bottom: 1px solid var(--app-success-border);
    color: var(--app-success-text);
    font-size: 13px;
    flex-shrink: 0;
  }
  .update-banner-msg { flex: 1; }
  .update-apply {
    background: var(--app-success-strong);
    border: 1px solid var(--app-success-border);
    color: var(--app-text-on-accent);
    border-radius: 6px;
    padding: 4px 12px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .update-apply:hover { background: var(--app-success-strong); }
  .update-later {
    background: transparent;
    border: 1px solid var(--app-success-border);
    color: var(--app-success-text);
    border-radius: 6px;
    padding: 4px 10px;
    font-size: 12px;
    cursor: pointer;
  }
  .update-later:hover { background: var(--app-scrim); }

  /* ---- Toolbar container queries ----
     @container queries measure the toolbar's own inline size — the correct
     tool for a component-level layout. This replaces viewport @media queries
     which were wrong because toolbar width can differ from viewport width.

     New smaller control set (after workspace restructure): panel-toggle,
     project-title, page-nav, Edit/View toggle, view-mode, zoom, Save PDF,
     Settings, Help. No Open, chapter dropdown, Problems, History, or Sync.

     Measured full-set width at 1200px viewport ≈ 1050px (panel-toggle 40 +
     title 200 + spacers 200 + page-nav 260 + sep 17 + edit 70 + view-mode-group
     120 + zoom-select 100 + sep 17 + save-pdf 90 + settings 40 + help 40 = ~1194).

     Collapse stages:
       1200cqi — collapse view-mode + zoom into dropdown menus
       1000cqi — trim doc-title / path max-widths
        850cqi — drop button text labels (icon-only)
        760cqi — hide doc title, drop Save PDF text label
        720cqi — fold Settings+Help into "More" menu
        640cqi — hide path, drop separators
        580cqi — drop "Page" word
        520cqi — compact page nav (drop first/last) */

  @container (max-width: 1200px) {
    /* Swap the inline view-mode buttons + zoom select for compact menu buttons. */
    .view-mode-group { display: none; }
    .zoom-select { display: none; }
    .menu { display: inline-block; }
  }
  @container (max-width: 1000px) {
    .doc-title { max-width: 140px; }
    .path { max-width: 180px; }
  }
  @container (max-width: 850px) {
    /* Icon-only buttons: labels drop, aria-label/title keep them accessible. */
    .view-label { display: none; }
  }
  @container (max-width: 760px) {
    .doc-title { display: none; }
    .path { max-width: 140px; }
    /* Hide Save PDF text label, keep button as icon-only */
    .save-btn-label { display: none; }
  }
  @container (max-width: 720px) {
    /* Fold Settings + Help into the "More" overflow menu */
    .opt-inline { display: none; }
    details.more-menu { display: inline-block; }
  }
  @container (max-width: 640px) {
    .path { display: none; }
    .zoom-select,
    .zoom-menu,
    .view-mode-group,
    .view-mode-menu,
    .toolbar-sep {
      display: none;
    }
  }
  @container (max-width: 580px) {
    /* Drop the "Page" word from the pill */
    .pill-word { display: none; }
  }
  @container (max-width: 520px) {
    /* Compact page navigation: drop the first/last jump buttons */
    .center .icon-btn:first-child,
    .center .icon-btn:last-child { display: none; }
    .page-pill { min-width: 56px; }
  }

  /* ---- Small-screen single-pane layout (#responsive) ----
     Below NARROW_QUERY (820px) the editor + preview can't sit side by side.
     The workspace stays a single column and the Edit/View toggle decides which
     pane is visible. The preview iframe is NEVER unmounted (it owns the live
     PreviewClient); inactive panes are hidden with `display:none`. */
  @media screen and (max-width: 820px) {
    .workspace.narrow,
    .workspace.narrow.editor-open {
      grid-template-columns: 1fr;
    }
    /* DEFAULT narrow = preview only. Driving the single-pane choice from CSS
       defaults (not from the show-* classes alone) means an unset/undefined
       paneMode can never leave BOTH panes stacked in the single column. */
    .workspace.narrow .editor-pane { display: none; }
    /* Edit mode: show only the editor; keep the preview mounted but hidden. */
    .workspace.narrow.show-edit .editor-pane {
      display: flex;
      border-right: none;
    }
    .workspace.narrow.show-edit .preview-pane {
      /* Keep the cross-origin preview iframe MOUNTED and rendered (just collapsed
         to 0x0 + clipped) when the editor tab is active — never opacity:0 / a
         cover, per the "never hide the preview iframe" rule (that throttled
         Chromium to ~1fps in 0.4.1). overflow:hidden + 0x0 hides it without the
         opacity throttle trigger; it returns to full size on the Preview tab. */
      position: absolute;
      width: 0;
      height: 0;
      overflow: hidden;
      pointer-events: none;
    }

    /* #34 No horizontal scroll at 390px: the workspace + its panes never exceed
       the single column. The split-mode minmax() track floors (280px editor /
       360px preview) would force overflow on a 390px screen, so collapse them. */
    .workspace.narrow {
      width: 100%;
      max-width: 100%;
      overflow-x: hidden;
    }
    .workspace.narrow .pane {
      min-width: 0;
      max-width: 100%;
    }

    /* #34 Virtual-keyboard handling: when the on-screen keyboard is open,
       --kbd-offset (computed from visualViewport) is the occluded height. Shrink
       the visible editor pane by that amount so its toolbar + content stay above
       the keyboard instead of being covered. 0 when no keyboard (default). */
    .workspace.narrow.show-edit .editor-pane {
      max-height: calc(100% - var(--kbd-offset, 0px));
    }
  }

  /* #34 Touch-optimised toolbar — coarse pointer (phones/tablets) gets ≥44×44px
     tap targets per WCAG 2.5.5 / Apple HIG, WITHOUT affecting the desktop
     (mouse) layout. Scoped to (pointer: coarse) so a desktop user with a mouse
     sees the unchanged compact toolbar. The narrow media query alone is not
     enough (a desktop window narrowed below 820px must NOT get fat buttons),
     hence the pointer query. */
  @media (pointer: coarse) {
    .toolbar .icon-btn,
    .toolbar .icon-text,
    .toolbar .menu-summary,
    .pane-toggle .seg,
    .zoom-select,
    .toolbar .primary {
      min-width: 44px;
      min-height: 44px;
    }
    /* Generous padding so the larger hit area is comfortable, not cramped. */
    .toolbar .icon-btn,
    .toolbar .menu-summary {
      padding: 10px 12px;
    }
    .pane-toggle {
      padding: 3px;
    }
    .pane-toggle .seg {
      padding: 8px 12px;
    }
    /* The editor's own formatting toolbar buttons inherit the touch sizing too,
       since they're equally finger-driven on a phone. */
    .editor-pane :global(.tb-btn) {
      min-width: 40px;
      min-height: 40px;
    }
  }

  /* #34 Pinch-to-zoom on the preview. The preview is a cross-origin iframe with
     a JS `zoom` control (the toolbar). On touch devices we additionally allow
     the OS pinch gesture to scale the preview container natively: touch-action
     `pinch-zoom` opts the pane into browser-native pinch scaling without the
     pane intercepting it for scrolling. This is purely additive — the existing
     toolbar zoom (postMessage → iframe setZoom) is unchanged, and on a desktop
     (fine pointer) nothing here applies. We never hide/opacity the iframe (that
     would trigger the Chromium 1fps throttle), so the gesture scales the live,
     visible preview. */
  @media (pointer: coarse) {
    .preview-pane {
      touch-action: pinch-zoom;
    }
  }

  /* Save-as-template prompt (#29) */
  .save-tpl-backdrop { position: fixed; inset: 0; background: var(--app-backdrop); z-index: 1000; }
  .save-tpl-dialog {
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    width: min(420px, 94vw); background: var(--app-surface); color: var(--app-text-secondary);
    border-radius: 8px; box-shadow: 0 14px 40px var(--app-shadow-lg); z-index: 1001;
    padding: 18px; display: flex; flex-direction: column; gap: 12px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  }
  .save-tpl-dialog h2 { margin: 0; font-size: 16px; font-weight: 600; }
  .save-tpl-lead { margin: 0; font-size: 13px; color: var(--app-text-muted); }
  .save-tpl-field { display: flex; flex-direction: column; gap: 6px; }
  .save-tpl-field > span { font-size: 12px; color: var(--app-text-muted); font-weight: 500; }
  .save-tpl-field input {
    background: var(--app-surface-sunken); border: 1px solid var(--app-border);
    color: var(--app-text-secondary); padding: 8px 10px; border-radius: 6px; font-size: 14px;
  }
  .save-tpl-field input:focus { outline: none; border-color: var(--app-focus-ring); }
  .save-tpl-error { color: var(--app-error-text); font-size: 12px; margin: 0; }
  .save-tpl-actions { display: flex; gap: 8px; justify-content: flex-end; }
  .save-tpl-actions button { padding: 7px 16px; font-size: 13px; border-radius: 4px; cursor: pointer; border: 1px solid transparent; }
  .save-tpl-actions button:disabled { opacity: 0.45; cursor: default; }
  .save-tpl-actions .primary { background: var(--app-focus-ring); color: var(--app-text-on-accent); }
  .save-tpl-actions .primary:not(:disabled):hover { background: var(--app-accent-hover); }
  .save-tpl-actions .ghost { background: transparent; color: var(--app-text-muted); border-color: var(--app-border); }
  .save-tpl-actions .ghost:not(:disabled):hover { background: var(--app-surface-hover); color: var(--app-text); }
</style>
