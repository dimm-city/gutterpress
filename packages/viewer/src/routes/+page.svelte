<script lang="ts">
  import PreviewFrame from "$lib/components/PreviewFrame.svelte";
  import ExternalEditBanner from "$lib/components/ExternalEditBanner.svelte";
  import CrashRecoveryDialog from "$lib/components/CrashRecoveryDialog.svelte";
  import type { RecoveryItem } from "$lib/components/CrashRecoveryDialog.svelte";
  import { EditorBuffer } from "$lib/editor/buffer-state.svelte";
  import { ExportController } from "$lib/export/export-controller.svelte";
  import type { ExportProgressEvent } from "$lib/export/export-controller.svelte";
  import Toast from "$lib/components/Toast.svelte";
  import type { ToastController } from "$lib/components/Toast.svelte";
  import type {
    ProblemEntry,
    ProjectClassification,
    RecoveryConfirmRequest,
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
  import ProjectActivityView from "$lib/components/ProjectActivityView.svelte";
  import SettingsDialog from "$lib/components/SettingsDialog.svelte";
  import NewProjectWizard from "$lib/components/NewProjectWizard.svelte";
  import GitHubDialog from "$lib/components/GitHubDialog.svelte";
  import AdvancedSetupDialog from "$lib/components/AdvancedSetupDialog.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import EditorToolbar from "$lib/components/EditorToolbar.svelte";
  import type { ToolbarAction, ToolbarPayload } from "$lib/components/EditorToolbar.svelte";
  import SnippetPicker from "$lib/components/SnippetPicker.svelte";
  import { PreviewClient, type OutlineEntry, type PreviewTarget } from "$lib/preview-client";
  import { activeOutlineIndexForLine } from "$lib/routes/outline";
  import { PageNavController } from "$lib/routes/page-nav-controller.svelte";
  import { ZoomViewController } from "$lib/routes/zoom-view-controller.svelte";
  import { PreviewEventController } from "$lib/routes/preview-event-controller";
  import { EditorPreviewSyncController } from "$lib/routes/editor-preview-sync-controller";
  import { SyncController } from "$lib/routes/sync-controller.svelte";
  import { ProjectSessionController } from "$lib/routes/project-session-controller.svelte";
  import { RecoveryUiController } from "$lib/routes/recovery-ui-controller.svelte";
  import { buildViewerStyles } from "$lib/iframe-styles";
  import { getPlatform, isDesktop } from "$lib/platform";
  import { api } from "$lib/api";
  import { basenameOf, joinPath } from "$lib/platform/paths";
  import { shouldReconcileAfterSync } from "$lib/sync-status";
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
  import { commandForSaveShortcut } from "$lib/editor/save-shortcuts";
  import { resolveGlobalShortcut, resolvePreviewNavCommand } from "$lib/routes/shortcuts";
  import { splitTemplateColumns, shouldRefitPreview } from "$lib/editor/preview-layout";
  import { useSettings, _loadSettings } from "$lib/settings.svelte";
  import LeftPanel from "$lib/components/LeftPanel.svelte";
  import type { PanelTab } from "$lib/components/LeftPanel.svelte";
  import { friendlyFolderError, friendlyPdfError } from "$lib/errors";
  import { UpdateController } from "$lib/update/update-controller.svelte";
  import type {
    DiagnosticsTool,
    UrlPreviewBlockedEvent,
    PersistedProjectState,
  } from "$lib/routes/page-types";

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
  // Capabilities of the open project's source (#12) live on the
  // ProjectSessionController (projectSession.projectCapabilities), alongside the
  // classification wiring that populates them.
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
  // The whole export FSM (state + 1s ticker + progress label) lives in the
  // ExportController (Phase 4b); the view drives it via intent methods.
  const exportController = new ExportController();
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


  // Frame state
  let client = $state<PreviewClient | undefined>(undefined);
  let pageEditInput = $state<HTMLInputElement | undefined>(undefined);
  // Page-navigation FSM (Phase 5): owns currentPage/totalPages/pageEditing/
  // pageEditValue/restoringSavedState + the host-driven navigation intents.
  // Host coupling is injected so the component stays a thin composition root.
  const pageNav = new PageNavController({
    client: () => client,
    isRendering: () => rendering,
    viewMode: () => viewMode,
    savePrefs: (patch) => saveViewerPrefs(patch),
    savePageDirect: (page) => {
      if (currentDir) {
        api.app.setViewerProjectState(currentDir, { currentPage: page }).catch(() => {});
      }
    },
    onBeginEdit: () => queueMicrotask(() => pageEditInput?.focus()),
  });
  // Preview layout FSM: owns zoom / view-mode / fit-width / split-pane-drag
  // state + the intents that drive the host preview. Host coupling (client,
  // persist sinks, DOM measurements) is injected so the component stays a thin
  // composition root.
  const zoomView = new ZoomViewController({
    client: () => client,
    zoom: () => zoom,
    viewMode: () => viewMode,
    isNarrow: () => isNarrow,
    persistZoom: (value) => settings.set({ preview: { defaultZoom: value } }),
    persistViewMode: (mode) => settings.set({ preview: { viewMode: mode } }),
    saveViewerPrefs: (patch) => saveViewerPrefs(patch),
    measureContainerWidth: () => {
      const iframe = document.querySelector<HTMLIFrameElement>("iframe");
      return iframe?.clientWidth ?? window.innerWidth;
    },
    measureWorkspaceRect: () => {
      if (!workspaceEl) return null;
      const rect = workspaceEl.getBoundingClientRect();
      return { left: rect.left, width: rect.width };
    },
  });

  // ── Document outline + editor↔preview sync (UX-013, ADR 0005) ─────────────
  // outline drives the chapter-jump dropdown; activeOutlineIndex tracks the
  // heading the reader is currently within (updated from sourceLineChanged).
  let outline = $state<OutlineEntry[]>([]);
  let activeOutlineIndex = $state(0);
  // Editor↔preview scroll/anchor timing machine: owns the echo-suppression
  // window (the timestamp guard that stops the preview's own sourceLineChanged
  // from bouncing back into the editor), the cross-chapter reveal poll loop, and
  // the editor→preview anchor follow. Clock + scheduler are injected so the
  // whole state machine is deterministic under fake timers in its unit test.
  const editorSync = new EditorPreviewSyncController({
    client: () => client,
    rendering: () => rendering,
    currentDir: () => currentDir,
    editorChapter: () => editorChapter,
    hasEditorRef: () => !!editorRef,
    selectEditorFile: (path) => selectEditorFile(path),
    revealEditorLine: (line) => editorRef?.revealLine(line),
    syncPageAfterScroll: (page) =>
      pageNav.syncPageState({ currentPage: page, totalPages: pageNav.totalPages }),
    now: () => Date.now(),
    schedule: (fn, ms) => setTimeout(fn, ms),
  });
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
  let rendering = $state(false);
  let renderProgressPage = $state(0);
  let renderCompleteOverlay = $state(false);
  let autoOpeningLastProject = $state(false);
  let lastProjectChecked = $state(false);
  let pendingRestorePage = $state<number | null>(null);
  let pendingRestoreViewMode = $state<"single" | "two-column" | null>(null);

  // Toast controller (populated by Toast.svelte via bind:api)
  let toast = $state<ToastController | null>(null);
  let helpOpen = $state(false);
  // Operation-log viewer: opened from the StatusBar git/sync pill. Holds the
  // current project's log path (carried on the sync status stream).
  let logFilePath = $state<string | null>(null);
  function showProjectLog(filePath: string | null): void {
    logFilePath = filePath;
    editorView = "activity";
    editorOpen = true;
    previewHidden = false;
  }
  function closeActivityView(): void {
    editorView = "editor";
    focusEditorWhenReady();
  }
  let openError = $state<string | null>(null);
  // The folder a failed open was attempted on, so we can offer to adopt it.
  let failedOpenDir = $state<string | null>(null);
  let adopting = $state(false);
  // A loose markdown folder opens fine (no manifest = defaults), but has no
  // editable styles or version history. When the OPENED folder has no manifest,
  // offer a non-blocking "set it up as a book" affordance. Default true so the
  // banner stays hidden until a check proves the manifest is absent.
  let currentFolderHasManifest = $state(true);
  let adoptBannerDismissed = $state(false);
  let showAdoptBanner = $derived(
    isDesktop() &&
      !!currentDir &&
      sourceMode === "folder" &&
      !currentFolderHasManifest &&
      !adoptBannerDismissed,
  );
  // The rarer case: an open that genuinely FAILED with "not a project".
  let canAdoptFailedFolder = $derived(
    !!failedOpenDir && !!openError && /manifest|print-md\.yaml|No such file/i.test(openError),
  );

  /** Turn an existing folder into a print-md book (manifest + book.css + git),
   *  then (re)open it. Used by both the error CTA and the no-manifest banner. */
  async function setUpAsBook(dir: string) {
    if (!dir || !isDesktop()) return;
    adopting = true;
    try {
      await api.app.adoptFolder({ dir });
      openError = null;
      failedOpenDir = null;
      adoptBannerDismissed = true;
      await startFolderPreview(dir, "Setting up your book…");
    } catch (e) {
      openError = e instanceof Error ? e.message : String(e);
    } finally {
      adopting = false;
    }
  }
  let urlPreviewError = $state<string | null>(null);

  // ── Auto-update state ──────────────────────────────────────────────────
  // The whole update FSM (banner version state, check/download/apply intents,
  // and the mount-time status peek + event subscription) lives in the
  // UpdateController (Phase 5); the view drives it via intent methods and reads
  // its rune getters. Toast feedback is injected through an accessor seam.
  const updateController = new UpdateController(() => toast);

  // "Open from GitHub" flow (#15)
  let githubOpen = $state(false);
  // Advanced setup (#14): diagnostics + generic "Connect a Git server"
  let advancedSetupOpen = $state(false);
  let advancedSetupBtn = $state<HTMLButtonElement | undefined>(undefined);
  // New-project wizard (#25)
  let newProjectOpen = $state(false);
  let newProjectWizardRef = $state<{ show: (t?: HTMLButtonElement) => void } | null>(null);
  let newProjectBtn = $state<HTMLButtonElement | undefined>(undefined);
  // Manual force-save state for the status bar action button.
  let forceSaving = $state(false);
  // Sync-outcome routing + conflict/diagnosis state (Phase 5b). Owns the
  // syncDiag / forceSyncing runes and the ConflictChoicesDialog state
  // (#transparent-sync §6.1: opened by the ambient SyncStatusPill when the
  // auto-sync orchestrator reports a conflict). Host coupling injected so the
  // routing is unit-testable and PWA-clean (§8). onSyncCompleted /
  // onSyncFilesChanged stay component methods (they touch toast +
  // leftPanelRef.notifyHistoryRefresh + buffer).
  const syncController = new SyncController({
    syncChanges: (dir) => api.remote.syncChanges(dir),
    diagnose: (dir) => api.remote.diagnoseProjectRemote(dir),
    currentDir: () => currentDir,
    toast: () => toast,
    onSyncCompleted: (mergedRemoteChanges, filesChanged) =>
      onSyncCompleted(mergedRemoteChanges, filesChanged),
    onFilesChanged: () => onSyncFilesChanged(),
  });

  // ── Project session capability state (#12) ───────────────────────────────────
  // The classification wiring (source detection → capabilities → subPath /
  // sharesParentHistory → prefs hint → history-refresh → sync gate) lives in the
  // ProjectSessionController (Phase 5c). The component reset()s it and fires
  // classify(dir) on folder open, applyReclassify()s after version history is
  // enabled, and reads its rune getters. Host coupling injected (§8): the
  // classify round-trip, the ViewerPrefs writer, and the two fan-out callbacks
  // (History tab + SyncController).
  const projectSession = new ProjectSessionController({
    classifyProject: (dir) => api.app.classifyProject(dir),
    setViewerPrefs: (prefs) => api.app.setViewerPrefs(prefs),
    notifyHistoryRefresh: () => leftPanelRef?.notifyHistoryRefresh(),
    refreshSyncDiag: (dir) => void syncController.refreshSyncDiag(dir),
  });

  // ── Recovery UI state (transparent sync recovery) ────────────────────────────
  // The whole recovery UI state machine (RecoveryOverlay scrim, the blocked-
  // repair RecoveryGuidanceDialog, and the risky-repair RecoveryConfirmDialog)
  // lives in the RecoveryUiController (Phase 5b). The two onMount subscriptions
  // below keep the DOM/host glue (project-scope filter + reconcile) and delegate
  // the transitions to recovery.applyStatus / recovery.applyConfirm; the template
  // reads its rune getters and binds its open flags.
  const recovery = new RecoveryUiController();

  function onSyncFilesChanged() {
    buffer?.reconcileExternalChange().catch(() => {});
    refreshProblems();
  }

  // Sync completed. Online changes may land on disk even when the final outcome
  // is "up-to-date" (pull fast-forwarded, then push had nothing to send), so the
  // file-change signal is separate from the user-facing merge/sync copy.
  function onSyncCompleted(mergedRemoteChanges: boolean, filesChanged = mergedRemoteChanges) {
    toast?.success(
      mergedRemoteChanges
        ? "Synced — changes from the online copy were combined in, so the preview will refresh."
        : "Synced — your changes are online.",
    );
    // A sync may add new commits to the project's git history (both push and
    // pull sides). Bump the key so the History tab reflects the new state.
    leftPanelRef?.notifyHistoryRefresh();
    // If remote changes landed on disk, re-lint immediately (the preview
    // file-watcher re-renders and fires refreshProblems via renderingComplete,
    // but a manual refresh here catches edge cases where no re-render fires).
    if (filesChanged) onSyncFilesChanged();
  }

  // The single Reconnect action (ADR 0006 D7): route to the matching connect
  // flow — GitHub's device flow, or Advanced Setup for every other server.
  function onSyncReconnect() {
    if (syncController.syncDiag?.provider === "github") githubOpen = true;
    else advancedSetupOpen = true;
  }

  // Route the RecoveryGuidanceDialog's primary button by the guidance's machine
  // action key — NOT always-reconnect (the exact bug this fixes). Each branch
  // targets the flow the error kind actually calls for.
  function onRecoveryGuidancePrimary() {
    switch (recovery.recoveryGuidance?.recommendedActionKey) {
      case "reconnect":
        onSyncReconnect();
        break;
      case "check_connection":
        advancedSetupOpen = true;
        break;
      case "sync":
        // Retry the sync; handleForceSync also routes conflicts to the chooser.
        void syncController.handleForceSync();
        break;
      case "resolve_conflict":
        // Re-run the sync so the conflict chooser opens with fresh file IDs
        // (handleForceSync sets conflictOpen on a "conflict" outcome).
        void syncController.handleForceSync();
        break;
      case "restore_repo":
        // Re-run the sync/recovery path: the orchestrator re-classifies the repo
        // state and dispatches the matching recovery handler (e.g. the
        // interrupted-rebase / interrupted-cherry-pick abort), which re-prompts
        // for confirmation before the backup + repair.
        void syncController.handleForceSync();
        break;
      default:
        // Forward-compat safety net for an unrecognized key: do nothing (the
        // dialog closes). Never fall back to reconnect — that was the original
        // defect. (The generic/unknown failure now maps to "sync" above, so its
        // "Try again" button actually retries the sync.)
        break;
    }
  }

  // Completes the D7 Reconnect journey: a connect dialog closing may mean a
  // new credential was just stored — re-check syncability so the Sync
  // button and the dialog's auth state reflect it without a project reload.
  // Called by onClosed on both GitHubDialog and AdvancedSetupDialog.
  function onConnectDialogClosed() {
    if (currentDir && sourceMode === "folder") {
      void syncController.refreshSyncDiag(currentDir);
    }
  }

  // ── Recovery overlay subscription ────────────────────────────────────────────
  // Subscribe to the host's sync:status channel for recovering/recovered/error
  // states so the RecoveryOverlay (and RecoveryGuidanceDialog on blocked failure)
  // appear/disappear transparently. The SyncStatusPill already handles the
  // conflict/auth/syncing/synced states — this effect handles ONLY the new
  // recovery-specific transitions (recovering, recovered, error-with-guidance).
  // Per §8 / ADR 0004: runs in the SPA, no lib value imports, all host work
  // through getPlatform().
  onMount(() => {
    if (!isDesktop()) return;
    const off = getPlatform().onSyncStatus((status) => {
      // Scope to the currently open project.
      if (status.projectDir !== currentDir) return;
      if (shouldReconcileAfterSync(status)) {
        onSyncFilesChanged();
      }
      recovery.applyStatus(status);
    });
    return () => off?.();
  });

  // ── Recovery confirm subscription ─────────────────────────────────────────────
  // The host fires onRecoveryConfirm when a medium/high-risk repair needs author
  // approval. Show RecoveryConfirmDialog; the dialog answers the gate via
  // respondRecoveryConfirm. Recovery must NOT proceed until the author responds.
  onMount(() => {
    if (!isDesktop()) return;
    const off = getPlatform().onRecoveryConfirm((req: RecoveryConfirmRequest) => {
      recovery.applyConfirm(req);
    });
    return () => off?.();
  });

  /** Show a backup zip in the system file manager. */
  function showBackupInFolder(path: string) {
    api.shell.showInFolder(path).catch(() => {});
  }

  /** Called when the RecoveryOverlay auto-dismiss or Done button fires. */
  function onRecoveryOverlayDone() {
    recovery.dismissOverlay();
  }

  // The open folder is a book subfolder of a larger versioned folder (full
  // history features are available, scoped to the book by the host) and the
  // book's path relative to that shared folder both live on the
  // ProjectSessionController (projectSession.projectSharesParentHistory /
  // projectSession.projectSubPath), derived by its classification wiring.

  // History was just enabled (#13): adopt the upgraded capabilities and persist
  // the re-classified source hint — same as what classifyProject does on open.
  function onVersionHistoryEnabled(result: ProjectClassification) {
    projectSession.applyReclassify(result);
  }

  // A restore rewrote project files on disk (#13). The preview server's file
  // watcher re-renders on its own; the editor buffer reconciles via the folder
  // watcher (#44). Confirm in the toast and refresh history so the new backup
  // entry is visible immediately.
  function onVersionRestored() {
    toast?.success("Project restored — the preview will refresh in a moment.");
    leftPanelRef?.notifyHistoryRefresh();
  }

  // A snapshot was saved (#13) — same toast pattern as onVersionRestored, so
  // version-history feedback is consistent (the dialog itself shows no notice).
  // Bump the key so the History tab list updates without requiring a tab switch.
  function onVersionSnapshotSaved() {
    toast?.success("Snapshot saved.");
    leftPanelRef?.notifyHistoryRefresh();
  }
  // Official setup guide for first-time writers (MVP "Download starter template").
  const SETUP_GUIDE_URL =
    "https://github.com/dimm-city/print-md/blob/main/examples/print-md-user-guide/01-getting-started.md";

  function openSetupGuide() {
    api.shell.openExternal(SETUP_GUIDE_URL).catch(() => {});
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
  let previewHidden = $state(false);
  let workspaceEl = $state<HTMLElement | undefined>(undefined);
  let editorRef = $state<{
    focus: () => void;
    revealLine: (line: number) => void;
    runToolbarAction: (action: ToolbarAction, payload?: ToolbarPayload) => void;
    getSelectionText: () => string;
    insertSnippet: (text: string) => void;
    updateContent: (content: string) => void;
  } | null>(null);

  // Snippet picker (#29) — opened via the toolbar button or Ctrl/Cmd+Shift+S.
  let snippetPickerRef = $state<{ show: (t?: HTMLButtonElement) => void } | null>(null);
  let snippetPickerOpen = $state(false);

  function openSnippetPicker() {
    if (!isDesktop() || !currentDir) return;
    snippetPickerRef?.show();
  }

  // Plugin manager (#30) — opened from the overflow menu (desktop + project).
  // ── Project Configuration view (#PCV) ───────────────────────────────────────
  // Project configuration is now a left-sidebar tab, not an editor-pane swap.
  let editorView = $state<"editor" | "config" | "activity">("editor");

  /**
   * One button → the whole project configuration view. Opens the editor pane
   * (so the panel has a frame to render into) and switches it to the config
   * view. Does NOT lazy-load the CodeMirror editor module — the config panel has
   // no need for it, keeping first-open cheap.
   */
  function openProjectConfig(): void {
    if (!currentDir || sourceMode !== "folder") return;
    if (!isDesktop()) {
      toast?.info?.("Project configuration is available in the desktop app for now.");
      return;
    }
    leftPanelOpen = true;
    leftPanelTab = "config";
    leftPanelRef?.notifyOpened();
    persistLeftPanelPrefs();
  }

  /** Close the config view → back to the raw CodeMirror editor. */
  function closeProjectConfig(): void {
    editorView = "editor";
    focusEditorWhenReady();
  }

  /**
   * Open one stylesheet (absolute path) in the shared editor and reveal it.
   * Used as the "Edit raw CSS" escape hatch from the Config view's Design
   * section AND from its Styles section's per-row "Edit" button — both routes
   * flip `editorView` back to "editor" so the author lands on the file.
   */
  function openStyleFile(absPath: string) {
    editorView = "editor";
    editorOpen = true;
    loadEditorModule();
    selectEditorFile(absPath);
    focusEditorWhenReady();
  }

  /**
   * After a theme is applied from the Config view: surface a confirmation toast.
   * The config panel stays open so the author can immediately fine-tune via the
   * Design section; the preview (mounted alongside) updates on its own.
   */
  function onThemeApplied(_themeId: string) {
    toast?.success?.("Theme applied — your preview is updating. Use Design to fine-tune.");
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
      const tpl = await api.tpl.saveAsTemplate({
        projectDir: currentDir,
        name: saveTemplateName.trim(),
      });
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
  let splitGridColumns = $derived(
    editorPaneOpen && !isNarrow && !previewHidden
      ? splitTemplateColumns(zoomView.splitPaneRatio)
      : "",
  );
  let previewCollapseGridColumns = $derived(
    editorPaneOpen && !isNarrow && previewHidden
      ? "minmax(0, 1fr) 0 minmax(0, 0)"
      : "",
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
  // Set when the lazy import of the editor chunk fails, so the load logic does
  // NOT immediately retry (which spammed an infinite error-toast loop). Cleared
  // by an explicit user "Retry".
  let editorModuleFailed = $state(false);

  /** Kick off the lazy MarkdownEditor import if needed. Guards against duplicate
   * loads: no-ops when it's already loading, loaded, or failed. */
  function loadEditorModule() {
    if (!editorOpen || !currentDir || MarkdownEditor || editorModuleLoading || editorModuleFailed) return;
    editorModuleLoading = true;
    import("$lib/components/MarkdownEditor.svelte")
      .then((m) => {
        MarkdownEditor = m.default;
      })
      .catch((e) => {
        // Mark as failed so repeated calls don't retry — that turned a single
        // failed chunk fetch into an infinite error-toast loop. Surface ONE
        // error; the editor pane shows a Retry affordance.
        editorModuleFailed = true;
        toast?.error(
          `Could not open the editor: ${e instanceof Error ? e.message : String(e)}`,
        );
      })
      .finally(() => {
        editorModuleLoading = false;
      });
  }

  function retryEditorLoad() {
    editorModuleFailed = false;
    loadEditorModule();
  }
  function focusEditorWhenReady() {
    // If the editor component isn't mounted yet, retry via rAF until it is
    // (bounded to 120 frames, ~2 s at 60 fps) — same pattern as tryInsert below.
    let tries = 0;
    const tryFocus = () => {
      if (editorRef) {
        requestAnimationFrame(() => editorRef?.focus());
      } else if (tries++ < 120) {
        requestAnimationFrame(tryFocus);
      }
    };
    requestAnimationFrame(tryFocus);
  }

  /**
   * Insert an image even when no chapter is open yet (UX audit P3#8: the Media
   * "Insert" button used to dead-end behind a disabled state, telling the author
   * to go open a file first). If no markdown chapter is open, open one and the
   * editor pane, then insert once the editor has mounted AND loaded that chapter
   * — a bounded rAF retry, so there's no race (we never insert into an unloaded
   * doc) and no infinite loop (gives up with a clear toast).
   */
  function insertImageIntoChapter(payload: { src: string; alt?: string }) {
    const isMd = (p: string | null) => !!p && /\.(md|markdown)$/i.test(p);
    if (!isMd(editorFilePath)) {
      void ensureEditorFile();
      editorOpen = true;
      loadEditorModule();
    }
    let tries = 0;
    const tryInsert = () => {
      if (editorRef && isMd(editorFilePath)) {
        editorRef.runToolbarAction("image", { src: payload.src, alt: payload.alt ?? "" });
        focusEditorWhenReady();
        return;
      }
      if (tries++ < 120) {
        requestAnimationFrame(tryInsert);
      } else {
        toast?.info?.("Open a markdown chapter, then insert the image.");
      }
    };
    requestAnimationFrame(tryInsert);
  }

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
        // Push pending-save state to main so the window close gate can flush
        // before quitting (#44). Called whenever hasPendingSave changes.
        onDirty: (pending) => {
          if (isDesktop()) {
            api.app.setDirtyState(pending).catch(() => {});
          }
        },
      });
    }
    return buffer;
  }

  // Keep the recovery-enabled toggle (#45) in sync with the live setting.
  // Subscribe via the settings observer so the buffer is updated whenever the
  // setting changes (e.g. SettingsDialog toggle), without using $effect.
  onMount(() => {
    return settings.subscribe((s) => {
      buffer?.setRecoveryEnabled(s.editor.crashRecovery);
    });
  });

  // Re-inject viewer canvas styles when the preview background colour changes
  // in Settings. The initial injection happens in the renderingComplete handler;
  // this subscriber catches live changes without requiring a re-render.
  onMount(() => {
    let lastBg: string | undefined;
    return settings.subscribe((s) => {
      const bg = s.appearance.previewBg;
      if (bg !== lastBg && client) {
        lastBg = bg;
        client.injectStyles("viewer-canvas", buildViewerStyles(bg));
      }
    });
  });

  // External-edit detection (#44): watch the open folder; on any debounced
  // change, ask the buffer to reconcile the open document against disk.
  // Managed imperatively: started in startFolderPreview, stopped in stopPreview / openUrl.
  let _watchFolderOff: (() => void) | undefined;
  function startFolderWatch(dir: string) {
    if (!isDesktop()) return;
    _watchFolderOff?.();
    _watchFolderOff = getPlatform().watchFolder(dir, () => {
      buffer?.reconcileExternalChange().catch(() => {});
    }) ?? undefined;
  }
  function stopFolderWatch() {
    _watchFolderOff?.();
    _watchFolderOff = undefined;
  }

  // Window close gate (#44): when main asks the renderer to flush before
  // closing, flush the buffer. The preload wrapper signals main when done.
  onMount(() => {
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
      const files = (await api.fs.listDir(currentDir)).filter((e) => !e.isDir);
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
    // Push the accepted external content into the editor immediately.
    if (buffer) editorRef?.updateContent(buffer.content);
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
      const entries = await api.recovery.list(dir);
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
      const recovered = await api.fs.readFile(item.recoveryPath);
      await buf.restoreContent(item.filePath, recovered);
      editorOpen = true;
      loadEditorModule();
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
      api.recovery.clear(item.filePath).catch(() => {});
    }
  }

  function dismissRecovery() {
    recoveryItems = [];
  }

  // ── Persist left panel state on change ────────────────────────────────────
  function persistLeftPanelPrefs() {
    if (!leftPanelPrefsLoaded) return;
    api.app
      .setViewerPrefs({ leftPanel: { open: leftPanelOpen, activeTab: leftPanelTab, width: leftPanelWidth } } as Record<string, unknown>)
      .catch(() => {});
  }

  let leftPanelRef = $state<LeftPanel | undefined>(undefined);

  function toggleLeftPanel() {
    leftPanelOpen = !leftPanelOpen;
    if (leftPanelOpen) leftPanelRef?.notifyOpened();
    persistLeftPanelPrefs();
  }

  function toggleEditor() {
    if (!currentDir || sourceMode !== "folder") return;
    editorOpen = !editorOpen;
    // On open, move keyboard focus into the editor so Ctrl+E acts as a
    // focus-switch into the editing surface (#38). Closing returns focus to
    // the document (preview iframe / window) implicitly.
    if (editorOpen) {
      loadEditorModule();
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
    api.lint.project(dir)
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

  // Problems are cleared in stopPreview() and openUrl() — no reactive effect needed.

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
      loadEditorModule();
    }
    const rel = p.file ?? p.filePath.split(/[\\/]/).pop() ?? p.filePath;
    if (p.line) {
      editorSync.followChapterInEditor(rel, p.line);
    } else {
      selectEditorFile(p.filePath);
    }
    focusEditorWhenReady();
  }

  // Canvas styles are injected by the renderingComplete handler (which already
  // calls client.injectStyles). View-mode changes from the Settings panel are
  // handled by the onViewModeChange callback passed to SettingsDialog.

  onMount(() => {
    api.doctor()
      .then((data) => {
        diagnosticsTools = (data as { tools?: DiagnosticsTool[] }).tools ?? [];
      })
      .catch(() => {});
  });

  // saveWarning is cleared in startFolderPreview (saveWarning = null at top) and
  // in the renderingComplete handler. No reactive effect needed.

  onMount(() => {
    const off = getPlatform().onUrlPreviewBlocked((event: UrlPreviewBlockedEvent) => {
      if (sourceMode !== "url") return;
      if (!previewUrl) return;
      previewUrl = null;
      urlPreviewError = event.reason;
    });
    return () => off?.();
  });

  // pageEditInput focus is triggered directly in beginPageEdit() — see below.

  onMount(() => {
    if (!isDesktop()) return;
    if (lastProjectChecked) return;
    if (previewUrl || currentDir || currentUrl || busy || openError || urlPreviewError) return;
    if (autoOpeningLastProject) return;

    autoOpeningLastProject = true;
    lastProjectChecked = true;
    api.app.getViewerPrefs()
      .then(async (prefsRaw) => {
        const prefs = prefsRaw as {
          lastProjectDir?: string;
          leftPanel?: { activeTab?: string; width?: number; open?: boolean };
        };
        // Load persisted left panel state
        const panelPrefs = prefs.leftPanel;
        if (!leftPanelPrefsLoaded) {
          leftPanelPrefsLoaded = true;
          if (panelPrefs?.activeTab) leftPanelTab = panelPrefs.activeTab as typeof leftPanelTab;
          if (typeof panelPrefs?.width === "number") leftPanelWidth = Math.min(480, Math.max(200, panelPrefs.width));
          // Panel open state loaded below after we know if a project exists
        }

        const dir = prefs.lastProjectDir;
        if (!dir || previewUrl || currentDir || currentUrl) {
          // No project to reopen — auto-open the panel on Projects tab so
          // the welcome screen has a useful first action.
          leftPanelOpen = true;
          leftPanelTab = "projects";
          leftPanelRef?.notifyOpened();
          // Dismiss splash and reveal window.
          api.app.rendererReady().catch(() => {});
          return;
        }
        // Restore panel open state from prefs (now we know there is a project)
        if (!leftPanelPrefsLoaded) leftPanelPrefsLoaded = true;
        leftPanelOpen = panelPrefs?.open ?? false;
        if (leftPanelOpen) leftPanelRef?.notifyOpened();
        // Per-project state (#43) is keyed by folder path so opening a
        // different project never pollutes this one's restore point.
        api.app.splashStatus("Opening your project…", 45).catch(() => {});
        const restoreState = await api.app
          .getViewerProjectState(dir)
          .catch(() => null);
        await startFolderPreview(dir, "Reopening previous folder…", restoreState);
        // If the saved project no longer opens (moved/renamed/deleted),
        // startFolderPreview sets openError but does NOT throw. Don't strand the
        // author on an error screen at launch — clear it and fall through to the
        // welcome/Projects panel so their first action is "open or create".
        if (openError) {
          openError = null;
          leftPanelOpen = true;
          leftPanelTab = "projects";
          leftPanelRef?.notifyOpened();
          toast?.info?.("Couldn't reopen your last project — it may have moved. Pick or create one to start.");
        }
        return;
      })
      .catch(() => {
        // If reopen failed, still reveal the window (don't strand on the splash).
        api.app.rendererReady().catch(() => {});
      })
      .finally(() => {
        autoOpeningLastProject = false;
      });
  });

  // ----------------------------------------------------------------
  // Preview-frame event router. Owns the post-render settle sequence (view-mode
  // auto-selection, the fit-width-vs-numeric-zoom reveal race, page restore,
  // outline rebuild, re-lint, splash dismissal) + the preview→editor
  // sourceLineChanged follow. Host coupling is injected so the ordering that
  // prevents the visible page JUMP is unit-tested in isolation. Composes
  // pageNav + zoomView rather than duplicating their logic.
  const previewEvents = new PreviewEventController({
    client: () => client,
    pageNav,
    zoomView,
    editorSync: {
      suppressPreviewSyncUntil: () => editorSync.suppressPreviewSyncUntil,
      editorPaneOpen: () => editorPaneOpen,
      editorChapter: () => editorChapter,
      currentDir: () => currentDir,
      bufferDirty: () => !!buffer?.isDirty,
      updateActiveOutline: (line) => updateActiveOutline(line),
      revealEditorLine: (line) => editorRef?.revealLine(line),
      followChapterInEditor: (chapter, line) => editorSync.followChapterInEditor(chapter, line),
    },
    zoom: () => zoom,
    viewMode: () => viewMode,
    bgColor: () => bgColor,
    setRendering: (v) => (rendering = v),
    getRendering: () => rendering,
    setRenderProgressPage: (v) => (renderProgressPage = v),
    getRenderProgressPage: () => renderProgressPage,
    setRenderCompleteOverlay: (v) => (renderCompleteOverlay = v),
    resetOutline: () => {
      outline = [];
      activeOutlineIndex = 0;
    },
    consumePendingRestore: () => {
      const restore = { page: pendingRestorePage, viewMode: pendingRestoreViewMode };
      pendingRestorePage = null;
      pendingRestoreViewMode = null;
      return restore;
    },
    refreshOutline: () => refreshOutline(),
    refreshProblems: () => refreshProblems(),
    revealSettledPages: () => revealSettledPages(),
    toastSuccess: (message) => toast?.success(message),
    splashStatus: (status, progress, sub) =>
      api.app.splashStatus(status, progress, sub).catch(() => {}),
    rendererReady: () => api.app.rendererReady().catch(() => {}),
    viewportWidth: () => window.innerWidth,
    now: () => Date.now(),
    scheduleMicrotask: (fn) => queueMicrotask(fn),
  });

  // Subscribe to PreviewClient events when a client is created by PreviewFrame.
  // Hooked via onClientReady callback on the PreviewFrame component (imperative,
  // not $effect). Cleanup is handled when the client is replaced (PreviewFrame
  // remounts on previewUrl change via {#key previewUrl}).
  function onClientReady(c: PreviewClient) {
    previewEvents.subscribe(c);
  }

  // ----------------------------------------------------------------
  // Auto-update: status peek on mount + event subscription
  // ----------------------------------------------------------------

  // Surface the restart banner if an update was already downloaded (this
  // session's background check, or a prior session that never restarted),
  // then subscribe to future events. Owned by the UpdateController.
  onMount(() => updateController.init());

  // ----------------------------------------------------------------
  // Global keyboard shortcuts (available without a loaded document)
  // ----------------------------------------------------------------
  onMount(() => {
    function onGlobalKey(e: KeyboardEvent) {
      const command = resolveGlobalShortcut({
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        shift: e.shiftKey,
        key: e.key,
      });
      // Cmd/Ctrl+, opens the Settings panel (toggles closed if already open).
      if (command === "settings") {
        e.preventDefault();
        settingsOpen = !settingsOpen;
      }
      // Cmd/Ctrl+E toggles the in-app editor (#38) when a folder is open.
      if (command === "toggle-editor") {
        e.preventDefault();
        toggleEditor();
      }
      // Cmd/Ctrl+\ toggles the left panel
      if (command === "toggle-left-panel") {
        e.preventDefault();
        toggleLeftPanel();
      }
      // Cmd/Ctrl+Shift+S opens the snippet picker (#29) when a project is open.
      if (command === "snippet") {
        e.preventDefault();
        openSnippetPicker();
        return;
      }
      const saveCommand = commandForSaveShortcut({
        key: e.key,
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        shift: e.shiftKey,
        editorFileOpen: !!editorFilePath,
        canSavePdf,
      });
      if (saveCommand !== "none") {
        e.preventDefault();
        if (saveCommand === "save-source") void handleForceSave();
        else void savePdf();
      }
    }
    window.addEventListener("keydown", onGlobalKey);
    return () => window.removeEventListener("keydown", onGlobalKey);
  });

  // ----------------------------------------------------------------
  // Keyboard shortcuts (preview navigation — active whenever a preview is open)
  // ----------------------------------------------------------------
  onMount(() => {
    function onKey(e: KeyboardEvent) {
      // Only active when a preview URL is loaded.
      if (!previewUrl) return;
      if (e.defaultPrevented) return;
      // Don't intercept when focus is in an input/textarea/select, or inside
      // the CodeMirror editor (#38) — its content node is a contenteditable
      // DIV, so a tagName check alone would let preview-nav keys (arrows,
      // Home/End, +/-/=, f) hijack core editing.
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (t?.isContentEditable || t?.closest?.(".cm-editor")) return;

      const command = resolvePreviewNavCommand({
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        shift: e.shiftKey,
        key: e.key,
      });

      switch (command) {
        // Cmd/Ctrl+Shift+E explicitly exports PDF. Plain Cmd/Ctrl+S is handled by
        // the global shortcut above as "save source edits" when an editor file is
        // open, so it never surprises writers by opening PDF export.
        case "export-pdf":
          e.preventDefault();
          if (canSavePdf) savePdf();
          return;
        case "next":
          e.preventDefault();
          pageNav.nextPage();
          break;
        case "prev":
          e.preventDefault();
          pageNav.prevPage();
          break;
        case "first":
          e.preventDefault();
          pageNav.firstPage();
          break;
        case "last":
          e.preventDefault();
          pageNav.lastPage();
          break;
        case "zoom-in":
          e.preventDefault();
          zoomView.stepZoom(0.25);
          break;
        case "zoom-out":
          e.preventDefault();
          zoomView.stepZoom(-0.25);
          break;
        case "fit-width":
          e.preventDefault();
          zoomView.applyZoom("fit-width");
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
  onMount(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    function onResize() {
      if (!previewUrl || zoomView.userSetViewMode) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const auto = window.innerWidth < 1280 ? "single" : "two-column";
        zoomView.applyViewMode(auto, false);
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

  async function startFolderPreview(
    dir: string,
    label = "Starting preview…",
    restoreState: PersistedProjectState | null = null,
    // #49: adapter-precomputed display name when the folder was opened via a
    // FolderRef (picker/recents/favorites). Null when opened by raw key.
    displayName: string | null = null,
  ) {
    openError = null;
    failedOpenDir = null;
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
      leftPanelRef?.resetHistoryState();
      currentFolderDisplayName = displayName;
      currentUrl = null;
      // Detect a "loose" folder (no manifest) so we can offer to set it up as a
      // book. Default true (banner hidden) until the listing proves it's absent.
      currentFolderHasManifest = true;
      adoptBannerDismissed = false;
      void api.fs.listDir(dir)
        .then((entries) => {
          currentFolderHasManifest = entries.some((e) => /^manifest\.ya?ml$/i.test(e.name));
        })
        .catch(() => { currentFolderHasManifest = true; });
      // Clear stale problems from the previous project immediately so the badge
      // and panel don't show the old project's findings while the new one renders.
      problems = [];
      // Drop the prior project's log path so the activity view can never surface
      // one project's log under another.
      logFilePath = null;
      // Bump historyRefreshKey so the History tab reloads its list for the new
      // project as soon as capabilities arrive (LeftPanel's effect guards on canHistory).
      leftPanelRef?.notifyHistoryRefresh();
      // Preload the first file into the editor buffer when a folder opens, so the
      // editor pane is never empty whenever it's shown (and switching to edit is
      // instant). Action-driven (folder open), not an effect, and independent of
      // async settings/narrow timing. Idempotent + self-gated (no-op in view-only
      // contexts where there's nothing to edit).
      void ensureEditorFile();
      // Classify the opened folder (#12) so capability-gated actions (#13/#25)
      // can render. Always re-detected on open (a user may add/remove `.git`
      // between sessions) and persisted as a hint. Fire-and-forget: a failure
      // must never block the preview. Owned by the ProjectSessionController.
      projectSession.reset();
      syncController.syncDiag = null;
      projectSession.classify(dir);
      docTitle = data.title ?? null;
      // Force iframe remount by nulling first; reset overlay for the new iframe.
      previewUrl = null;
      await Promise.resolve();
      previewUrl = data.url;
      rendering = true;
      renderProgressPage = 0;
      pageNav.totalPages = 0;
      pageNav.currentPage = 1;
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
      zoomView.userSetViewMode = !!restoredViewMode;
      if (typeof restoreState?.splitPaneRatio === "number") {
        zoomView.restoreSplitRatio(restoreState.splitPaneRatio);
      }
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
      // Start watching for external edits (replaces old $effect on currentDir).
      startFolderWatch(dir);
    } catch (e) {
      previewUrl = null;
      currentDir = null;
      leftPanelRef?.resetHistoryState();
      currentFolderDisplayName = null;
      docTitle = null;
      rendering = false;
      openError = e instanceof Error ? e.message : String(e);
      // Remember the folder so we can offer to set it up as a book when the
      // failure was "this isn't a print-md project".
      failedOpenDir = dir;
      // Re-open the Projects panel so the user can try again without being
      // stranded — mirrors the old autoOpenPanel $effect behaviour.
      if (lastProjectChecked) {
        leftPanelOpen = true;
        leftPanelTab = "projects";
        leftPanelRef?.notifyOpened();
      }
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
      // #49: the picker returns a path string; wrap into a host-neutral FolderRef.
      const pathStr = await api.dialog.openDirectory();
      if (!pathStr) return;
      const folder = { key: pathStr, displayName: basenameOf(pathStr) };
      // Per-project state (#43): restore whatever was saved for THIS folder
      // (page, view mode, …) regardless of which project was last open.
      const restoreState = await api.app
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
    leftPanelRef?.resetHistoryState();
    currentFolderDisplayName = null;
    docTitle = null;
    // The editor is folder-only; close it for web previews.
    editorOpen = false;
    buffer?.reset();
    stopFolderWatch();
    problems = [];
    problemsOpen = false;
    // Force iframe remount by nulling first.
    previewUrl = null;
    queueMicrotask(() => {
      previewUrl = url;
      rendering = false;
      renderProgressPage = 0;
      pageNav.totalPages = 0;
      pageNav.currentPage = 1;
    });
  }

  function openInBrowser() {
    if (!currentUrl) return;
    api.shell.openExternal(currentUrl).catch(() => {});
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
    stopFolderWatch();
    previewUrl = null;
    currentDir = null;
    leftPanelRef?.resetHistoryState();
    currentFolderDisplayName = null;
    currentUrl = null;
    docTitle = null;
    rendering = false;
    renderProgressPage = 0;
    renderCompleteOverlay = false;
    pageNav.totalPages = 0;
    pageNav.currentPage = 1;
    pageNav.pageEditing = false;
    editorOpen = false;
    previewHidden = false;
    buffer?.reset();
    recoveryScanDir = null;
    recoveryItems = [];
    // Clear stale problems and auto-open panel on projects tab.
    problems = [];
    problemsOpen = false;
    if (lastProjectChecked) {
      leftPanelOpen = true;
      leftPanelTab = "projects";
      leftPanelRef?.notifyOpened();
    }
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
    const outPath = await api.dialog.savePdf(defaultName);
    if (!outPath) return;

    // Non-blocking: the build runs in a separate render window, so keep the
    // preview interactive and show progress in a corner pill (not the overlay).
    exportController.start();
    let offProgress: (() => void) | undefined;
    try {
      // Live progress: Paged.js pagination of large books takes minutes, so show
      // the growing page count instead of an opaque spinner.
      offProgress = platform.onBuildProgress(
        (p: ExportProgressEvent) => {
          if (p.state === "canceled") {
            exportController.markCanceling();
            return;
          }
          if (p.state === "error") {
            return;
          }
          exportController.syncProgress(p);
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
      exportController.markSuccess(data.exportId);
      const savedPdfPath = data.pdfPath ?? outPath;
      toast?.success(`PDF saved to ${savedPdfPath}`, 8000, {
        label: "Show in Folder",
        onClick: () => {
          void api.shell.showInFolder(savedPdfPath).catch(() => {});
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (e) {
      if ((e as { code?: string })?.code === "EXPORT_CANCELED") {
        exportController.reset();
        return;
      }
      toast?.error(friendlyPdfError(e));
    } finally {
      offProgress?.();
      exportController.reset();
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
    if (!inputDir || busy || exportController.exporting || sourceMode === "url") return;
    exportController.beginSimpleExport();
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
      exportController.endSimpleExport();
    }
  }

  async function cancelExport() {
    if (!exportController.activeExportId) return;
    exportController.markCanceling();
    await getPlatform().cancelExport(exportController.activeExportId).catch(() => {});
  }

  // Page-navigation intents (syncPageState / restoreProjectPage /
  // runPageCommand / gotoPage / begin|cancel|commitPageEdit /
  // first|prev|next|lastPage) now live on `pageNav` (PageNavController).
  function saveViewerPrefs(patch: Partial<PersistedProjectState>) {
    if (!currentDir || sourceMode !== "folder" || rendering || pageNav.restoringSavedState) return;
    // Per-project state (#43): write to the folder-keyed bucket so this never
    // overwrites another project's saved page/view. The main process also
    // updates lastProjectDir, so reopening lands on this project.
    api.app.setViewerProjectState(currentDir, patch as Record<string, unknown>).catch(() => {});
  }

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
    activeOutlineIndex = activeOutlineIndexForLine(outline, line);
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
    editorSync.suppressFor(400);
    if (entry.sourceLine != null && editorPaneOpen) {
      if (entry.chapter === editorChapter) {
        editorRef?.revealLine(entry.sourceLine);
      } else if (entry.chapter && currentDir && !buffer?.isDirty) {
        editorSync.followChapterInEditor(entry.chapter, entry.sourceLine);
      }
    }
    client
      .scrollTo(target, { block: "start" })
      .then((res) => {
        if (res?.page) pageNav.syncPageState({ currentPage: res.page, totalPages: pageNav.totalPages });
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

  // Zoom / view-mode intents (applyFitWidthZoom / applyZoom / stepZoom /
  // applyViewMode / toggleViewMode) now live on `zoomView` (ZoomViewController).

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
  onMount(() => {
    const mq = window.matchMedia(NARROW_QUERY);
    isNarrow = mq.matches;
    const onChange = (e: MediaQueryListEvent) => {
      isNarrow = e.matches;
      if (e.matches && paneMode === "edit") void ensureEditorFile();
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  });

  function previewPaneResize(node: HTMLElement) {
    if (typeof ResizeObserver === "undefined") return;
    let lastWidth = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const observer = new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect.width ?? 0;
      if (!shouldRefitPreview(zoom, lastWidth, nextWidth)) {
        lastWidth = nextWidth;
        return;
      }
      lastWidth = nextWidth;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void zoomView.applyFitWidthZoom();
      }, 80);
    });
    observer.observe(node);
    return {
      destroy() {
        observer.disconnect();
        if (timer) clearTimeout(timer);
      },
    };
  }

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
      loadEditorModule();
      void ensureEditorFile();
      if (wasClosed) focusEditorWhenReady();
    }
  }

  function togglePreview() {
    if (!previewUrl || isNarrow) return;
    previewHidden = !previewHidden;
    if (previewHidden && currentDir && sourceMode === "folder") {
      editorOpen = true;
      loadEditorModule();
      void ensureEditorFile();
    }
  }

  // Split-pane drag ratio/state lives on `zoomView` (ZoomViewController); these
  // thin handlers own only the DOM pointer-capture side effects.
  function startSplitDrag(e: PointerEvent) {
    if (!zoomView.beginSplitDrag(e.clientX)) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    e.preventDefault();
  }

  function moveSplitDrag(e: PointerEvent) {
    zoomView.moveSplitDrag(e.clientX);
  }

  function stopSplitDrag(e: PointerEvent) {
    if (!zoomView.endSplitDrag(e.clientX)) return;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  }

  // ── Mobile tab bar (#34): Markdown / CSS / Preview ─────────────────────────
  // The single-column (narrow) layout switches the one visible pane between the
  // markdown editor, the CSS editor, and the preview. Both editor tabs share the
  // existing editor pane (the CSS editing surface is the SAME CodeMirror editor
  // with a CSS language mode, #39); the tab just loads the relevant file. The
  // persisted two-state `paneMode` ("edit"/"view") is the source of truth so the
  // existing restore + wide-screen behaviour is untouched.
  //
  // M1 (single source of truth): the highlighted editor tab is derived SOLELY
  // from the open file's extension (`openFileIsCss`) — no parallel
  // `editorSurface` state that could get stuck on "css" when no CSS file is
  // actually open. This also covers preview→editor chapter follow + recovery +
  // ensureEditorFile picking a file on its own.
  let openFileIsCss = $derived(
    !!editorFilePath && /\.css$/i.test(editorFilePath),
  );
  // Active mobile tab, derived from the persisted paneMode + which file is open.
  // No new persistence: reload restores via paneMode, then the open file decides
  // markdown vs css.
  let mobileTab = $derived<MobileTab>(
    tabFromPaneMode(paneMode, openFileIsCss),
  );

  /**
   * Switch the visible mobile pane. Preview → view mode; Markdown → edit mode
   * with the first markdown file loaded; CSS → the unified Project
   * Configuration view (its Styles section picks a stylesheet; its Design
   * section fine-tunes tokens) — replacing the retired manifest-aware picker.
   */
  function selectMobileTab(tab: MobileTab) {
    const mode = paneModeForTab(tab);
    setPaneMode(mode);
    const surface = editorSurfaceForTab(tab);
    if (surface === "markdown") {
      // Only swap files if the editor is currently on a CSS file; otherwise keep
      // the author's open chapter (ensureEditorFile is a no-op when one is open).
      if (openFileIsCss) {
        void (async () => {
          const buf = ensureBuffer();
          // B1 (data-loss fix): flush any pending debounced CSS save BEFORE
          // resetting the buffer — reset() only cancels the timer + clears
          // content, so without this an edit made inside the autosave window
          // is silently dropped when switching to Markdown.
          if (buf.filePath && buf.hasPendingSave) {
            toast?.info?.("Saving…");
            await buf.flush().catch(() => {});
          }
          buf.reset();
          await ensureEditorFile();
        })();
      } else {
        void ensureEditorFile();
      }
      focusEditorWhenReady();
    } else if (surface === "css") {
      // The CSS tab now opens the unified Project Configuration view (its
      // Styles section lets the author pick which stylesheet to edit; the
      // Design section fine-tunes tokens). The old manifest-aware picker was
      // retired along with the four modal managers (#PCV).
      openProjectConfig();
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
{#if exportController.exporting && exportController.pdfProgress}
  <div class="export-pill" role="status" aria-live="polite" aria-atomic="true">
    {#if exportController.state === "success"}
      <span class="export-success" aria-hidden="true">✓</span>
    {:else}
      <span class="export-spinner" aria-hidden="true"></span>
    {/if}
    <span class="export-label">{exportController.pdfProgress}</span>
    {#if exportController.state !== "success" && exportController.state !== "canceling"}
      <button class="export-cancel" onclick={cancelExport} disabled={!exportController.activeExportId}>Cancel</button>
    {/if}
  </div>
{/if}

<div class="app-root">
{#if (updateController.readyVersion || updateController.availableVersion) && !updateController.bannerDismissed}
  <div class="update-banner" role="status" aria-live="polite">
    {#if updateController.readyVersion}
      <span class="update-banner-msg">Update ready (v{updateController.readyVersion})</span>
      <button class="update-apply" onclick={() => updateController.applyNow()}>Restart &amp; update</button>
    {:else}
      <span class="update-banner-msg">Update available (v{updateController.availableVersion})</span>
      <button class="update-apply" onclick={() => updateController.download()} disabled={updateController.downloading}>
        {updateController.downloading ? "Downloading…" : "Download"}
      </button>
    {/if}
    <button class="update-later" onclick={() => updateController.dismissBanner()}>Later</button>
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
         truly centered in the toolbar regardless of left/right section widths. -->
    <div class="toolbar-center-col">
      <!-- UX-012: center nav only shows when a document is loaded. #34: on narrow
           viewports it is hidden — the absolutely-centered page-nav group would
           collide with the right-aligned Markdown/CSS/Preview tab bar at 390px,
           and the tab bar is the priority control there (the preview still
           scrolls/swipes for page navigation). -->
      {#if previewUrl && !isNarrow}
        <section class="center">
          <button class="icon-btn" onclick={() => pageNav.firstPage()} disabled={rendering} title="First page (Home)" aria-label="First page">
            <Icon name="chevrons-left" />
          </button>
          <button class="icon-btn" onclick={() => pageNav.prevPage()} disabled={rendering} title="Previous page (Left/PageUp)" aria-label="Previous page">
            <Icon name="chevron-left" />
          </button>
          {#if pageNav.pageEditing}
            <input
              bind:this={pageEditInput}
              type="number"
              class="page-input"
              min="1"
              max={pageNav.totalPages || 1}
              bind:value={pageNav.pageEditValue}
              onblur={() => pageNav.commitPageEdit()}
              onkeydown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  pageNav.commitPageEdit();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  pageNav.cancelPageEdit();
                }
              }}
              aria-label="Go to page"
            />
          {:else}
            <button class="page-pill" onclick={() => pageNav.beginPageEdit()} disabled={rendering} aria-label="Edit current page">
              <span class="pill-word">Page&nbsp;</span>{pageNav.currentPage} / {pageNav.totalPages || "—"}
            </button>
          {/if}
          <button class="icon-btn" onclick={() => pageNav.nextPage()} disabled={rendering} title="Next page (Right/PageDown)" aria-label="Next page">
            <Icon name="chevron-right" />
          </button>
          <button class="icon-btn" onclick={() => pageNav.lastPage()} disabled={rendering} title="Last page (End)" aria-label="Last page">
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
          onclick={() => zoomView.applyViewMode("single", true)}
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
          onclick={() => zoomView.applyViewMode("two-column", true)}
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
            onclick={(e) => { zoomView.applyViewMode("single", true); closeMenu(e); }}
            disabled={!previewUrl}
          >
            <Icon name="rectangle-vertical" /> Single page
          </button>
          <button
            aria-pressed={viewMode === "two-column"}
            class="menu-item"
            class:active={viewMode === "two-column"}
            onclick={(e) => { zoomView.applyViewMode("two-column", true); closeMenu(e); }}
            disabled={!previewUrl}
          >
            <Icon name="columns-2" /> Two pages side by side
          </button>
        </div>
      </details>

      <!-- Zoom: always use the compact icon button so the toolbar stays tight. -->
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
              onclick={(e) => { zoomView.applyZoom(val); closeMenu(e); }}
              disabled={!previewUrl}
            >
              {label}
            </button>
          {/each}
        </div>
      </details>

      {#if !isNarrow}
        <button
          class="icon-btn"
          class:active={previewHidden}
          onclick={togglePreview}
          disabled={!previewUrl || !currentDir || sourceMode === "url"}
          title={previewHidden ? "Show preview" : "Hide preview"}
          aria-label={previewHidden ? "Show preview" : "Hide preview"}
          aria-pressed={previewHidden}
        >
          <Icon name="eye" />
        </button>
        <button
          class="icon-btn"
          class:active={editorOpen}
          onclick={toggleEditor}
          disabled={!currentDir || sourceMode === "url"}
          title="Toggle markdown editor (Ctrl+E)"
          aria-label="Toggle markdown editor"
          aria-pressed={editorOpen}
        >
          <Icon name="pen-line" />
        </button>
      {/if}

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
          disabled={busy || exportController.exporting || !currentDir || sourceMode === "url"}
          title="Save as PDF (Ctrl+Shift+E)"
        >
          <Icon name="file-down" />
          <span class="save-btn-label">{exportController.exporting ? "Saving…" : "Save PDF"}</span>
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
          disabled={busy || exportController.exporting || !currentDir || sourceMode === "url"}
          title="Export as HTML"
        >
          <Icon name="file-down" />
          <span class="save-btn-label">{exportController.exporting ? "Exporting…" : "Export HTML"}</span>
        </button>
        {#if !currentDir && !busy}
          <span class="save-hint">Open a folder first</span>
        {:else if sourceMode === "url"}
          <span class="save-hint">Not available for web previews</span>
        {/if}
        <span class="save-hint" role="note">PDF export requires the desktop app</span>
      {/if}
      <!-- Overflow menu: holds less-common project actions so the toolbar never
           crowds page navigation. Settings and Help live in the bottom status bar. -->
      <details class="menu more-menu">
        <summary class="icon-btn menu-summary" title="More" aria-label="More options">
          <Icon name="ellipsis-vertical" />
        </summary>
        <div class="menu-panel menu-panel-right">
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
        </div>
      </details>
    </section>
  </header>

  <!-- Global left panel — available in both preview and edit modes -->
  <div id="left-panel-region" class="left-panel-region" class:panel-open={leftPanelOpen} style="--left-panel-width: {leftPanelWidth}px">
    <LeftPanel
      bind:this={leftPanelRef}
      bind:open={leftPanelOpen}
      bind:width={leftPanelWidth}
      bind:activeTab={leftPanelTab}
      projectDir={currentDir}
      projectDisplayName={currentFolderDisplayName}
      projectCapabilities={projectSession.projectCapabilities}
      projectSharesParentHistory={projectSession.projectSharesParentHistory}
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
          loadEditorModule();
          focusEditorWhenReady();
        }
      }}
      onOpenProjectConfig={openProjectConfig}
      onInsertImage={(payload) => insertImageIntoChapter(payload)}
      onProjectChosen={(path) => startFolderPreview(path)}
      onOpenUrl={openUrl}
      onOpenGitHub={isDesktop() ? () => (githubOpen = true) : undefined}
      onNewProject={() => newProjectWizardRef?.show()}
      onVersionHistoryEnabled={onVersionHistoryEnabled}
      onSnapshotSaved={(entry) => onVersionSnapshotSaved()}
      onVersionRestored={onVersionRestored}
      onSyncReconnect={onSyncReconnect}
      onPanelStateChange={persistLeftPanelPrefs}
    />

    <!-- Main content area (preview + editor) -->
    <div class="main-content">

  <!-- Loose-folder nudge: a plain folder renders fine but has no manifest,
       editable styles, or version history. Offer a one-click setup (adopt). -->
  {#if showAdoptBanner}
    <div class="adopt-banner" role="status">
      <span class="adopt-banner-text">
        This folder isn't set up as a book yet — set it up to edit its design and keep a history of changes.
      </span>
      <div class="adopt-banner-actions">
        <button class="primary" onclick={() => currentDir && setUpAsBook(currentDir)} disabled={adopting}>
          {adopting ? "Setting up…" : "Set up as a book"}
        </button>
        <button class="ghost" onclick={() => (adoptBannerDismissed = true)} disabled={adopting} aria-label="Dismiss">
          Not now
        </button>
      </div>
    </div>
  {/if}

  {#if previewUrl}
    <div
      class="workspace"
      class:editor-open={editorPaneOpen}
      class:narrow={isNarrow}
      class:show-edit={isNarrow && paneMode === "edit"}
      class:show-view={isNarrow && paneMode === "view"}
      class:preview-hidden={previewHidden}
      class:preview-collapsed={previewHidden}
      bind:this={workspaceEl}
      style="--kbd-offset: {keyboardInset}px; {previewCollapseGridColumns ? `grid-template-columns: ${previewCollapseGridColumns};` : splitGridColumns ? `grid-template-columns: ${splitGridColumns};` : ''}"
    >
      {#if editorPaneOpen}
        <section
          class="pane editor-pane"
          id="mobile-panel-editor"
          role={isNarrow ? "tabpanel" : undefined}
          aria-label={editorView === "config" ? "Project configuration" : (mobileTab === "css" ? "CSS editor" : "Markdown editor")}
        >
          {#if editorView === "activity"}
            <ProjectActivityView projectDir={currentDir} {logFilePath} onClose={closeActivityView} />
          {:else}
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
              onSave={handleForceSave}
            />
            {#if MarkdownEditor}
              {#key editorFilePath}
              <MarkdownEditor
                bind:this={editorRef}
                filePath={editorFilePath}
                content={editorContent}
                onChange={onEditorChange}
                onAnchorLine={(line, origin) => editorSync.onEditorAnchorLine(line, origin)}
              />
              {/key}
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
          {/if}
        </section>
        {#if !isNarrow && !previewHidden}
          <button
            type="button"
            class="splitter"
            class:dragging={zoomView.draggingSplit}
            aria-label="Resize editor and preview panes"
            title="Resize editor and preview panes"
            onpointerdown={startSplitDrag}
            onpointermove={moveSplitDrag}
            onpointerup={stopSplitDrag}
            onpointercancel={stopSplitDrag}
          ></button>
        {/if}
      {/if}
      <section
        class="pane preview-pane"
        use:previewPaneResize
        id="mobile-panel-preview"
        role={isNarrow ? "tabpanel" : undefined}
        aria-labelledby={isNarrow ? "mobile-tab-preview" : undefined}
        aria-hidden={previewHidden}
        inert={previewHidden || (isNarrow && paneMode === "edit") ? true : undefined}
      >
        {#key previewUrl}
          <PreviewFrame
            url={previewUrl}
            bind:client
            onClientReady={onClientReady}
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
        {#key recovery.recoveryOverlayState}
        <RecoveryOverlay
          visible={recovery.recoveryOverlayVisible}
          phase={recovery.recoveryOverlayPhase}
          recoveryState={recovery.recoveryOverlayState}
          backupZipPath={recovery.recoveryBackupZipPath}
          logFilePath={recovery.recoveryLogFilePath}
          onShowBackup={recovery.recoveryBackupZipPath ? () => showBackupInFolder(recovery.recoveryBackupZipPath!) : undefined}
          onDone={onRecoveryOverlayDone}
        />
        {/key}
      </section>
    </div>
  {:else}
    <div class="empty">
      <div class="empty-hero">
        <div class="empty-icon" aria-hidden="true">📖</div>
        <h1 class="empty-title">print-md</h1>
        <p class="empty-tagline">Turn your markdown writing into a print-ready book</p>
        <div class="empty-cta-row">
          <button bind:this={newProjectBtn} class="primary empty-cta" onclick={() => newProjectWizardRef?.show(newProjectBtn)} disabled={busy}>Create a new book</button>
          <button class="ghost empty-cta" onclick={() => {
            leftPanelOpen = true;
            leftPanelTab = "projects";
            leftPanelRef?.notifyOpened();
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
            {#if canAdoptFailedFolder}
              <p class="adopt-hint">It's a regular folder — want to turn it into a print-md book? We'll use any Markdown already inside it.</p>
              <button class="primary adopt-btn" onclick={() => failedOpenDir && setUpAsBook(failedOpenDir)} disabled={adopting}>
                {adopting ? "Setting up…" : "Set up this folder as a book"}
              </button>
            {/if}
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
    canSync={!!(syncController.syncDiag?.canSync)}
    canSnapshot={!!(projectSession.projectCapabilities?.canSnapshot)}
    savePhase={editorSavePhase}
    fileOpen={!!editorFilePath}
    {forceSaving}
    forceSyncing={syncController.forceSyncing}
    {problems}
    problemsLoading={problemsLoading}
    bind:problemsOpen={problemsOpen}
    onProblemSelect={openProblem}
    onReconnect={onSyncReconnect}
    onConflict={(files) => syncController.onPillConflict(files)}
    onShowLog={showProjectLog}
    onForceSave={handleForceSave}
    onForceSync={() => syncController.handleForceSync()}
    onOpenSettings={() => (settingsOpen = true)}
    onOpenHelp={() => (helpOpen = true)}
  />
</div>
</div>

<HelpDialog
  bind:open={helpOpen}
  onCheckForUpdates={() => updateController.check()}
  checkingUpdates={updateController.checking}
  updateReadyVersion={updateController.readyVersion}
  updateAvailableVersion={updateController.availableVersion}
/>
<SettingsDialog
  bind:open={settingsOpen}
  onViewModeChange={(mode) => { if (client && !rendering) client.call("setViewMode", [mode]).catch(() => {}); }}
  onCrashRecoveryChange={(enabled) => { buffer?.setRecoveryEnabled(enabled); }}
/>
<GitHubDialog
  bind:open={githubOpen}
  onOpened={(projectDir) => startFolderPreview(projectDir, "Opening your project…")}
  onAdvancedSetup={() => (advancedSetupOpen = true)}
  onClosed={onConnectDialogClosed}
  triggerEl={leftPanelToggleBtn}
/>
<AdvancedSetupDialog
  bind:open={advancedSetupOpen}
  projectDir={sourceMode === "folder" ? currentDir : null}
  triggerEl={advancedSetupBtn}
  onClosed={onConnectDialogClosed}
/>
<NewProjectWizard
  bind:this={newProjectWizardRef}
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
<!-- The Project Configuration view (#PCV) replaces the retired PluginManager,
     ThemeManager, StylePicker, and DesignPanel modal dialogs. It renders inline
     in the editor pane (above); no modal mount point is needed here. -->
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
  bind:open={syncController.conflictOpen}
  projectDir={sourceMode === "folder" ? currentDir : null}
  bookSubPath={projectSession.projectSubPath}
  files={syncController.conflictFiles}
  localId={syncController.conflictLocalId}
  remoteId={syncController.conflictRemoteId}
  onResolved={(mergedRemoteChanges) => {
    onSyncCompleted(mergedRemoteChanges);
    syncController.clearConflict();
  }}
  onReconnect={onSyncReconnect}
/>

<!-- RecoveryConfirmDialog: risky-repair confirmation gate. Shown when the host
     recovery subsystem needs author approval before proceeding with a
     medium/high-risk repair. Always answers the gate (approved or rejected) via
     getPlatform().respondRecoveryConfirm so the host is never left hanging. -->
<RecoveryConfirmDialog
  bind:open={recovery.recoveryConfirmOpen}
  request={recovery.recoveryConfirmRequest}
  onShowBackup={(path) => showBackupInFolder(path)}
/>

<!-- RecoveryGuidanceDialog: shown when automated recovery is blocked or fails
     with a classified error. Plain-language guidance + recommended next step +
     optional safe-steps list. No Git jargon. -->
<RecoveryGuidanceDialog
  bind:open={recovery.recoveryGuidanceOpen}
  guidance={recovery.recoveryGuidance}
  backupZipPath={recovery.recoveryGuidanceBackupPath}
  logFilePath={recovery.recoveryGuidanceLogPath}
  onShowBackup={(path) => showBackupInFolder(path)}
  onPrimary={onRecoveryGuidancePrimary}
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
    grid-template-columns: minmax(280px, 1fr) 6px minmax(360px, 1.4fr);
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
  .splitter {
    width: 6px;
    min-width: 6px;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: var(--app-border-subtle);
    cursor: col-resize;
    touch-action: none;
  }
  .splitter:hover,
  .splitter.dragging,
  .splitter:focus-visible {
    background: var(--app-focus-ring);
    outline: none;
  }
  .editor-loading {
    flex: 1;
    display: grid;
    place-items: center;
    padding: 24px;
    color: var(--app-text-faint);
    font-size: 13px;
  }
  .preview-pane {
    position: relative;
  }
  /* Narrow widths: give editor + preview equal space. */
  @media screen and (max-width: 1100px) {
    .workspace.editor-open {
      grid-template-columns: minmax(240px, 1fr) 6px minmax(280px, 1.1fr);
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
  button {
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
  button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  /* Explicit focus ring for all toolbar interactive elements — replaces UA
     default (browser-specific yellow ring) with the app's consistent ring. */
  button:focus-visible {
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
  /* View mode swaps between inline segmented buttons and a menu button. Zoom is
     always compact and always uses its menu button. */
  /* Narrow + Edit mode: the preview is hidden, so its controls (page navigation,
     single/spread, zoom) are noise — hide them so the edit toolbar is just
     Open / Edit·View / Save / More. The spacers collapse the gap automatically
     when center is absent. */
  .toolbar.edit-narrow .toolbar-center-col,
  .toolbar.edit-narrow .view-mode-group,
  .toolbar.edit-narrow .view-mode-menu,
  .toolbar.edit-narrow .zoom-menu {
    display: none;
  }

  .menu { position: relative; display: none; }
  details.zoom-menu { display: inline-block; }
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
  .adopt-hint { margin-top: 8px !important; color: var(--app-text-secondary) !important; }
  .adopt-btn {
    margin-top: 10px;
    padding: 7px 14px;
    font-size: 13px;
    border-radius: 6px;
    border: 1px solid var(--app-accent-border);
    background: var(--app-accent);
    color: var(--app-accent-text);
    font-weight: 600;
    cursor: pointer;
  }
  .adopt-btn:hover:not(:disabled) { background: var(--app-accent-hover); }
  .adopt-btn:disabled { opacity: 0.6; cursor: default; }

  .adopt-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    padding: 8px 14px;
    background: var(--app-info-bg, var(--app-surface));
    border-bottom: 1px solid var(--app-border);
    font-size: 13px;
    color: var(--app-text);
    flex-shrink: 0;
  }
  .adopt-banner-text { flex: 1 1 240px; min-width: 0; }
  .adopt-banner-actions { display: flex; gap: 8px; flex-shrink: 0; }
  .adopt-banner-actions button {
    padding: 5px 12px;
    font-size: 12px;
    border-radius: 6px;
    cursor: pointer;
    border: 1px solid transparent;
  }
  .adopt-banner-actions .primary { background: var(--app-accent); color: var(--app-accent-text); border-color: var(--app-accent-border); font-weight: 600; }
  .adopt-banner-actions .primary:hover:not(:disabled) { background: var(--app-accent-hover); }
  .adopt-banner-actions .ghost { background: transparent; color: var(--app-text-secondary); border-color: var(--app-border); }
  .adopt-banner-actions .ghost:hover:not(:disabled) { background: var(--app-control-hover-bg); }
  .adopt-banner-actions button:disabled { opacity: 0.6; cursor: default; }

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
     title 200 + spacers 200 + page-nav 260 + sep 17 + edit 40 + view-mode-group
     120 + zoom 40 + sep 17 + save-pdf 90 + settings 40 + help 40 = ~1064).

     Collapse stages:
       1200cqi — collapse view-mode into a dropdown menu
       1000cqi — trim doc-title / path max-widths
        850cqi — drop button text labels (icon-only)
        760cqi — hide doc title, drop Save PDF text label
        720cqi — fold Settings+Help into "More" menu
        640cqi — hide path, drop separators
        580cqi — drop "Page" word
        520cqi — compact page nav (drop first/last) */

  @container (max-width: 1200px) {
    /* Swap the inline view-mode buttons for a compact menu button. Zoom is
       already compact and always visible. */
    .view-mode-group { display: none; }
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
    details.more-menu { display: inline-block; }
  }
  @container (max-width: 640px) {
    .path { display: none; }
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
