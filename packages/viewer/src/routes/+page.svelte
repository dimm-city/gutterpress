<script lang="ts">
  import PreviewFrame from "$lib/components/PreviewFrame.svelte";
  import ExternalEditBanner from "$lib/components/ExternalEditBanner.svelte";
  import CrashRecoveryDialog from "$lib/components/CrashRecoveryDialog.svelte";
  import { EditorBuffer } from "$lib/editor/buffer-state.svelte";
  import { ExportController } from "$lib/export/export-controller.svelte";
  import Toast from "$lib/components/Toast.svelte";
  import type { ToastController } from "$lib/components/Toast.svelte";
  import type { RecoveryConfirmRequest } from "$lib/platform/contract";
  import type { ProblemEntry } from "$lib/platform/dtos";
  import { MISSING_ASSETS_SOURCE, problemCounts } from "$lib/problems";
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
  import { ProjectLifecycleController } from "$lib/routes/project-lifecycle-controller.svelte";
  import { RecoveryUiController } from "$lib/routes/recovery-ui-controller.svelte";
  import { StartupController } from "$lib/routes/startup-controller.svelte";
  import { CrashRecoveryController } from "$lib/routes/crash-recovery-controller.svelte";
  import { buildViewerStyles } from "$lib/iframe-styles";
  import { getPlatform, isDesktop } from "$lib/platform";
  import { api } from "$lib/api";
  import { isEditableTarget } from "$lib/a11y";
  import { invalidateDiscoveredProjects } from "$lib/projects-discover-cache";
  import { basenameOf, joinPath } from "$lib/platform/paths";
  import { shouldReconcileAfterSync } from "$lib/sync-status";
  import { onMount, tick } from "svelte";
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
  import { useSettings, _loadSettings, settingsChangeGuard, onSettingsChange } from "$lib/settings.svelte";
  import LeftPanel from "$lib/components/LeftPanel.svelte";
  import type { PanelTab } from "$lib/components/LeftPanel.svelte";
  import WelcomeLanding from "$lib/components/WelcomeLanding.svelte";
  import { continueStatus, shouldReshowLanding } from "$lib/routes/startup-landing";
  import { friendlyFolderError, friendlyPdfError, friendlyHostError } from "$lib/errors";
  import { UpdateController } from "$lib/update/update-controller.svelte";
  import type {
    DiagnosticsTool,
    UrlPreviewBlockedEvent,
    PersistedProjectState,
  } from "$lib/routes/page-types";

  // L1: one writer-facing constant for the "no Electron bridge" gate — this
  // developer-jargon toast ("Electron bridge unavailable — run via the viewer
  // app") was copy-pasted verbatim 4x. Phrasing follows NewProjectWizard's
  // existing writer-appropriate copy for the same gate ("Creating a project
  // needs the desktop app.").
  const DESKTOP_APP_REQUIRED = "This needs the desktop app to continue.";

  // Per-screen state
  // Session-identity / open-lifecycle state (previewUrl/currentDir/
  // currentFolderDisplayName/currentUrl/sourceMode/docTitle/busy/busyLabel/
  // rendering/renderProgressPage/renderCompleteOverlay/openError/
  // failedOpenDir/urlPreviewError/saveWarning/currentFolderHasManifest/
  // adoptBannerDismissed/adopting) now lives on the ProjectLifecycleController
  // (Phase 5d, UX H5 / ARCH #10) — see its instantiation below. The template
  // reads the public rune getters (`lifecycle.previewUrl` etc.) and calls the
  // intent methods (`lifecycle.startFolderPreview` / `setUpAsBook` /
  // `stopPreview` / `openUrl` / `cancelOpen`).
  //
  // Adapter-precomputed display name for the open folder (#49), when the folder
  // was opened via a FolderRef-returning path (picker / recents / favorites).
  // Null when opened by raw key (e.g. reopened-last-project) — folderName then
  // falls back to deriving the basename from lifecycle.currentDir.
  // Capabilities of the open project's source (#12) live on the
  // ProjectSessionController (projectSession.projectCapabilities), alongside the
  // classification wiring that populates them.
  // Folder name (basename) for the toolbar label; the full path is the tooltip.
  // Folder name for the toolbar label (#49): prefer the adapter-precomputed
  // FolderRef.displayName; fall back to the basename of the key when the folder
  // was opened by raw key (reopened last project / typed path).
  // NOTE: this $derived reads lifecycle.* directly (not through a closure), so
  // it is declared AFTER `lifecycle` further down (right after its
  // instantiation) to satisfy TypeScript's block-scoping — svelte2tsx inlines
  // $derived expressions rather than deferring them like a real closure.
  // PDF export runs in a separate render window, so the UI stays usable — track
  // it separately with a NON-blocking status pill instead of the modal overlay.
  // The whole export FSM (state + 1s ticker + progress label) AND the
  // savePdf/exportHtml/cancelExport intents (Phase 5 slice 2, UX H5 / ARCH
  // #10 — moved from +page.svelte) live in the ExportController; the view
  // drives it via intent methods and reads its rune getters. Host coupling
  // injected (§8): forward-references to page-local functions/state declared
  // further down (lifecycle, toast, getSaveReadinessWarning, …) are safe
  // closures, the same pattern pageNav's deps use below.
  const exportController = new ExportController(undefined, {
    isDesktop: () => isDesktop(),
    desktopRequiredMessage: DESKTOP_APP_REQUIRED,
    checkSaveReadiness: () => getSaveReadinessWarning(),
    setSaveWarning: (message) => {
      lifecycle.saveWarning = message;
    },
    currentDir: () => lifecycle.currentDir,
    displayName: () => lifecycle.currentFolderDisplayName,
    isBusy: () => lifecycle.busy,
    sourceMode: () => lifecycle.sourceMode,
    chooseSavePath: (defaultName) => api.dialog.savePdf(defaultName),
    onBuildProgress: (cb) => getPlatform().onBuildProgress(cb),
    buildPdf: (input, outPath) =>
      getPlatform().build({
        input,
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
      }),
    buildHtml: (input) => getPlatform().build({ input, format: "html" }),
    cancelExportHost: (exportId) => getPlatform().cancelExport(exportId),
    downloadFile: (url, filename) => {
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke after the click has handed the URL to the browser's download.
      // The adapter transfers object-URL ownership here (it does NOT revoke
      // build() download URLs), so the SPA owns the lifecycle.
      setTimeout(() => URL.revokeObjectURL(url), 0);
    },
    showInFolder: (path) => api.shell.showInFolder(path),
    toastSuccess: (message, durationMs, action) => toast?.success(message, durationMs, action),
    toastError: (message) => toast?.error(message),
    friendlyPdfError: (e) => friendlyPdfError(e),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
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
  // Explicit type annotation breaks a circular-inference chain with `lifecycle`
  // below: pageNav's deps close over `lifecycle.rendering`/`lifecycle.currentDir`
  // (forward reference, safe at runtime), and `lifecycle`'s own deps embed
  // `pageNav` by direct reference — without an annotation TS tries to INFER
  // both from each other and gives up ("implicitly has type 'any' ... referenced
  // in its own initializer").
  const pageNav: PageNavController = new PageNavController({
    client: () => client,
    isRendering: () => lifecycle.rendering,
    viewMode: () => viewMode,
    savePrefs: (patch) => saveViewerPrefs(patch),
    savePageDirect: (page) => {
      if (lifecycle.currentDir) {
        api.app.setViewerProjectState(lifecycle.currentDir, { currentPage: page }).catch(() => {});
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
    rendering: () => lifecycle.rendering,
    currentDir: () => lifecycle.currentDir,
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
  // autoOpeningLastProject/lastProjectChecked (Phase 5 slice 2, UX H5 / ARCH
  // #10) now live on `startup` (StartupController) — see its instantiation
  // below.
  let pendingRestorePage = $state<number | null>(null);
  let pendingRestoreViewMode = $state<"single" | "two-column" | null>(null);

  // Toast controller (populated by Toast.svelte via bind:api)
  let toast = $state<ToastController | null>(null);
  let helpOpen = $state(false);
  // Operation-log viewer: opened from the StatusBar git/sync pill. Holds the
  // current project's log path (carried on the sync status stream).
  let logFilePath = $state<string | null>(null);
  // Ref to the mounted ProjectActivityView (H2) so a sync completion can ask
  // it to reload its snapshot list without a round-trip through LeftPanel's
  // retired no-op history seam (L8 / ARCH #41). Undefined whenever the
  // activity view isn't the current editor-pane view.
  let activityViewRef = $state<{ refreshHistory: () => void } | undefined>(undefined);
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
  /** After a successful snapshot restore (H2): reconcile the open editor
   * buffer against disk — same reconciliation the folder watcher runs for any
   * external change (see `startFolderWatch`/`onSyncFilesChanged`) — and
   * re-check for print problems, since a restore can rewrite many files. */
  function onSnapshotRestored(): void {
    buffer?.reconcileExternalChange().catch(() => {});
    refreshProblems();
  }
  // A loose markdown folder opens fine (no manifest = defaults), but has no
  // editable styles or version history. When the OPENED folder has no manifest,
  // offer a non-blocking "set it up as a book" affordance. Default true (on the
  // controller) so the banner stays hidden until a check proves the manifest is
  // absent.
  // NOTE: showAdoptBanner / canAdoptFailedFolder read lifecycle.* directly (not
  // through a closure), so — like `folderName` above — they are declared AFTER
  // `lifecycle` further down, right after its instantiation.

  /** Turn an existing folder into a print-md book (manifest + book.css + git),
   *  then (re)open it. Used by both the error CTA and the no-manifest banner.
   *  Epoch/busy management moved to ProjectLifecycleController (Phase 5d). */
  function setUpAsBook(dir: string): Promise<void> {
    return lifecycle.setUpAsBook(dir);
  }

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
  // New-project wizard (#25). L4: opening is exclusively via show() below —
  // there is no bindable `open` prop any more (the wizard owns that state).
  let newProjectWizardRef = $state<{ show: (t?: HTMLButtonElement) => void } | null>(null);
  // Manual force-save state for the status bar action button.
  let forceSaving = $state(false);
  // Sync-outcome routing + conflict/diagnosis state (Phase 5b). Owns the
  // syncDiag / forceSyncing runes and the ConflictChoicesDialog state
  // (#transparent-sync §6.1: opened by the ambient SyncStatusPill when the
  // auto-sync orchestrator reports a conflict). Host coupling injected so the
  // routing is unit-testable and PWA-clean (§8). onSyncCompleted /
  // onSyncFilesChanged stay component methods (they touch toast +
  // activityViewRef.refreshHistory + buffer).
  const syncController = new SyncController({
    syncChanges: (dir) => api.remote.syncChanges(dir),
    diagnose: (dir) => api.remote.diagnoseProjectRemote(dir),
    currentDir: () => lifecycle.currentDir,
    toast: () => toast,
    onSyncCompleted: (mergedRemoteChanges, filesChanged) =>
      onSyncCompleted(mergedRemoteChanges, filesChanged),
    onFilesChanged: () => onSyncFilesChanged(),
  });

  // ── Project session capability state (#12) ───────────────────────────────────
  // The classification wiring (source detection → capabilities → subPath →
  // prefs hint → sync gate) lives in the ProjectSessionController (Phase 5c).
  // The component reset()s it and fires classify(dir) on folder open, and
  // reads its rune getters. Host coupling injected (§8): the classify
  // round-trip, the ViewerPrefs writer, and the SyncController fan-out.
  const projectSession = new ProjectSessionController({
    classifyProject: (dir) => api.app.classifyProject(dir),
    setViewerPrefs: (prefs) => api.app.setViewerPrefs(prefs),
    refreshSyncDiag: (dir) => void syncController.refreshSyncDiag(dir),
  });

  // ── Project open/close lifecycle (Phase 5d, UX H5 / ARCH #10) ────────────────
  // The folder-open pipeline (startFolderPreview + its epoch/superseded()
  // concurrency guard), setUpAsBook's epoch/busy management, stopPreview,
  // openUrl's reset path, and cancelOpen (the initial-open Cancel affordance,
  // M2) all live on ProjectLifecycleController — including the ONE
  // resetWorkspace() every teardown path now calls (the fix for the divergent
  // hand-rolled resets that shipped the Cancel-closes-project defect). Fields
  // this controller doesn't own (Problems panel, editor pane/buffer, folder
  // watcher, pageNav counters, crash-recovery scan state) are reset through
  // the single injected `resetExtras` callback below — a registered callback,
  // not a hand-list. Host coupling injected (§8): forward-references to
  // page-local functions/controllers declared further down (ensureEditorFile,
  // startFolderWatch, crashRecovery, dismissLanding, …) are safe closures,
  // the same pattern `pageNav`'s `savePrefs` already uses above.
  const lifecycle: ProjectLifecycleController = new ProjectLifecycleController({
    isDesktop: () => isDesktop(),
    desktopRequiredMessage: DESKTOP_APP_REQUIRED,
    startPreviewHost: (input) => getPlatform().startPreview({ input }),
    stopPreviewHost: () => getPlatform().stopPreview(),
    adoptFolder: (dir) => api.app.adoptFolder({ dir }),
    listDir: (dir) => api.fs.listDir(dir),
    invalidateDiscoveredProjects: () => invalidateDiscoveredProjects(),
    projectSession,
    clearSyncDiag: () => {
      syncController.syncDiag = null;
    },
    pageNav,
    zoomView,
    setViewModeSetting: (mode) => settings.set({ preview: { viewMode: mode } }),
    setPendingRestore: (viewMode, page) => {
      pendingRestoreViewMode = viewMode;
      pendingRestorePage = page;
    },
    resetFirstRenderGate: () => previewEvents.resetFirstRenderGate(),
    flushBuffer: () => buffer?.flush().catch(() => {}) ?? Promise.resolve(),
    resetBuffer: () => buffer?.reset(),
    ensureEditorFile: () => void ensureEditorFile(),
    startFolderWatch: (dir) => startFolderWatch(dir),
    isLandingVisible: () => landingVisible,
    setPendingRecoveryScanDir: (dir) => {
      pendingRecoveryScanDir = dir;
    },
    scanForRecovery: (dir) => void crashRecovery.scan(dir),
    dismissLanding: (runPendingRecoveryScan) => dismissLanding(runPendingRecoveryScan),
    toast: () => toast,
    clearStaleProjectState: () => {
      problems = [];
      problemsError = null;
      missingAssetProblems = [];
      logFilePath = null;
    },
    onMissingSharedAssets: (missing) => {
      missingAssetProblems = missing.map((path) => ({
        severity: "warning",
        message: `Shared asset folder not found — fonts/styles may be wrong: ${path}. Make sure the shared directory exists next to this project.`,
        source: MISSING_ASSETS_SOURCE,
      }));
      if (missing.length > 0) {
        toast?.info("Missing shared asset folder(s) — see Problems for details.");
      }
    },
    resetExtras: () => {
      stopFolderWatch();
      pageNav.totalPages = 0;
      pageNav.currentPage = 1;
      pageNav.pageEditing = false;
      editorOpen = false;
      previewHidden = false;
      buffer?.reset();
      crashRecovery.reset();
      pendingRecoveryScanDir = null;
      problems = [];
      problemsError = null;
      missingAssetProblems = [];
      problemsOpen = false;
    },
  });

  // Folder name (basename) for the toolbar label; the full path is the
  // tooltip. Prefer the adapter-precomputed FolderRef.displayName; fall back
  // to the basename of the key when the folder was opened by raw key
  // (reopened last project / typed path).
  let folderName = $derived(
    lifecycle.currentFolderDisplayName ?? (lifecycle.currentDir ? basenameOf(lifecycle.currentDir) : "")
  );
  // A loose markdown folder opens fine (no manifest = defaults), but has no
  // editable styles or version history. When the OPENED folder has no
  // manifest, offer a non-blocking "set it up as a book" affordance.
  let showAdoptBanner = $derived(
    isDesktop() &&
      !!lifecycle.currentDir &&
      lifecycle.sourceMode === "folder" &&
      !lifecycle.currentFolderHasManifest &&
      !lifecycle.adoptBannerDismissed,
  );
  // The rarer case: an open that genuinely FAILED with "not a project".
  let canAdoptFailedFolder = $derived(
    !!lifecycle.failedOpenDir && !!lifecycle.openError && /manifest|print-md\.yaml|No such file/i.test(lifecycle.openError),
  );

  // C2 (book switcher): the toolbar label shows the active book's own title by
  // default (unchanged from before repo-root sessions). In a multi-book repo it
  // is prefixed with the repo's folder name so the author can see, at a glance,
  // that switching books (`<BookSwitcher>` below) stays within the same project.
  let displayTitle = $derived(
    projectSession.repoRoot && projectSession.books.length > 1
      ? `${basenameOf(projectSession.repoRoot)} — ${lifecycle.docTitle || folderName}`
      : lifecycle.docTitle || folderName,
  );

  // ── Start screen (welcome landing) ──────────────────────────────────────────
  // The in-window layer that replaced both the splash's long "wait for the full
  // render" phase and the old empty-state hero. At launch the previous book
  // starts PRE-RENDERING in the workspace underneath exactly as it always did
  // behind the OS splash — the landing is just an interactive cover (frosted,
  // translucent: the cross-origin preview iframe must keep visible pixels or
  // Chromium throttles its layout to ~1fps; see PreviewFrame.svelte). Pure
  // decision logic lives in startup-landing.ts.
  let landingReady = $state(!isDesktop());
  // Explicit "stay up over a live workspace" flag: set when the startup
  // decision shows the landing over the pre-rendering previous book, cleared
  // by dismissLanding. Everything else about visibility is DERIVED from
  // workspace state (landingVisible below), so any path that empties the
  // workspace brings the start screen back structurally — there is no
  // per-site "remember to reshow" call to forget.
  let landingHold = $state(false);
  let landingShowPref = $state(true);
  // The book being reopened at startup — drives the continue card.
  let landingContinueDir = $state<string | null>(null);
  // Crash-recovery scan deferred while the start screen is up so the recovery
  // dialog never fights it for focus; runs when the landing dismisses.
  let pendingRecoveryScanDir = $state<string | null>(null);
  let appVersion = $state<string | null>(null);
  // Handle for reclaiming focus after a dialog opened FROM the landing closes
  // without opening a project (the dialogs' triggerEl focus restore targets
  // the inert workspace, which is a spec no-op).
  let landingRef = $state<{ focusLayer: () => void } | null>(null);

  // The landing is the app's ONLY empty state: visible while explicitly held
  // open (startup pre-render behind it) and whenever nothing is open — a
  // failed open, a failed URL preview, a failed prefs read, or a canceled
  // render all bring it back on their own via this derived.
  // Explicit type annotation breaks a circular-inference chain with
  // `lifecycle` above: this derived reads lifecycle.busy/previewUrl/currentDir/
  // currentUrl/urlPreviewError directly, and lifecycle's own deps close over
  // `landingVisible` (isLandingVisible) — see the pageNav/lifecycle note above
  // for why an explicit annotation is required here.
  const landingVisible: boolean = $derived(
    landingReady &&
      (landingHold ||
        shouldReshowLanding({
          busy: lifecycle.busy,
          hasPreviewUrl: !!lifecycle.previewUrl,
          hasCurrentDir: !!lifecycle.currentDir,
          hasCurrentUrl: !!lifecycle.currentUrl,
          hasUrlPreviewError: !!lifecycle.urlPreviewError,
        })),
  );

  const landingStatus = $derived(
    continueStatus({
      hasPreviewUrl: !!lifecycle.previewUrl,
      rendering: lifecycle.rendering,
      renderProgressPage: lifecycle.renderProgressPage,
    }),
  );
  // The continue card only shows while its target is actually open or opening —
  // if the workspace empties without an error (e.g. a canceled render), the
  // landing falls back to the plain welcome hero instead of a stale card.
  const landingContinueTitle = $derived(
    landingContinueDir && (lifecycle.busy || !!lifecycle.previewUrl || !!lifecycle.currentDir)
      ? (lifecycle.docTitle ?? lifecycle.currentFolderDisplayName ?? basenameOf(lifecycle.currentDir ?? landingContinueDir))
      : null,
  );
  const landingContinueDetail = $derived.by(() => {
    if (!landingContinueTitle) return null;
    if (projectSession.repoRoot && projectSession.books.length > 1) {
      return `${basenameOf(projectSession.repoRoot)} · ${projectSession.books.length} books`;
    }
    return lifecycle.currentDir ?? landingContinueDir;
  });
  const landingOtherBooks = $derived(
    landingContinueTitle
      ? projectSession.books
          .filter((b) => b.path !== (projectSession.activeBookDir ?? lifecycle.currentDir))
          .map((b) => ({ path: b.path, title: b.title }))
      : [],
  );
  const landingErrorTitle = $derived(
    lifecycle.openError ? "We couldn't open that book" : lifecycle.urlPreviewError ? "Preview unavailable" : null,
  );
  const landingErrorBody = $derived(
    lifecycle.openError ? friendlyFolderError(lifecycle.openError) : lifecycle.urlPreviewError,
  );

  /**
   * Leave the start screen. `runPendingRecoveryScan` is false when the user is
   * opening something OTHER than the pre-rendered book — the new open runs its
   * own scan, and the deferred one would pop the old project's recovery dialog
   * over the new project. The layer may legitimately stay visible after this
   * (nothing open = it IS the empty state); it actually leaves once an open
   * raises `lifecycle.busy` or a preview mounts, via the landingVisible derived.
   */
  function dismissLanding(runPendingRecoveryScan = true) {
    const pending = pendingRecoveryScanDir;
    pendingRecoveryScanDir = null;
    if (!landingVisible) return;
    landingHold = false;
    if (runPendingRecoveryScan && pending && pending === lifecycle.currentDir) {
      void crashRecovery.scan(pending);
    }
    // Focus lands back in the workspace once the inert flag has lifted.
    void tick().then(() => leftPanelToggleBtn?.focus());
  }

  /**
   * The ONE open-a-project-folder pipeline behind the folder picker, the
   * Projects panel, the start screen, the GitHub dialog, and the new-project
   * wizard: leave the start screen, restore the folder's saved per-project
   * state (#43), and hand off to startFolderPreview. There is NO await before
   * startFolderPreview — the restore-state fetch is passed as a promise and
   * consumed after the preview starts — so the open epoch is claimed at
   * user-intent time (last click wins, never last-fetch-resolves wins) and
   * `lifecycle.busy` covers the whole span with no dead gap.
   */
  function openProjectPath(path: string, label = "Opening your book…"): Promise<void> {
    dismissLanding(false); // no-op when the start screen is hidden
    lifecycle.busy = true;
    lifecycle.busyLabel = label;
    const restoreState = api.app.getViewerProjectState(path).catch(() => null);
    return lifecycle.startFolderPreview(path, label, restoreState, basenameOf(path));
  }

  // One OS folder picker at a time: a double-click on "Open a folder" must not
  // stack two native dialogs (plain flag, not $state — nothing renders it).
  let folderPickerOpen = false;

  /**
   * ARCH #60: the ONE native-folder-picker flow behind both entry points —
   * the start screen's "Browse" (no workspace yet, the landing screen is
   * itself the "lifecycle.busy" surface while the OS dialog is up) and the in-workspace
   * "Open folder" action (a project is already open behind the native
   * dialog, so it needs its own lifecycle.busy overlay to stay legible while the
   * picker is up). `showBusyOverlay` is the only real behavioral difference
   * between the two former hand-rolled copies.
   */
  async function pickAndOpenFolder(
    options: { showBusyOverlay?: boolean; label?: string } = {},
  ): Promise<void> {
    if (!isDesktop()) {
      toast?.error(DESKTOP_APP_REQUIRED);
      return;
    }
    if (folderPickerOpen) return;
    folderPickerOpen = true;
    const { showBusyOverlay = false, label = "Opening your book…" } = options;
    if (showBusyOverlay) {
      lifecycle.busy = true;
      lifecycle.busyLabel = "Opening folder…";
    }
    let handedOff = false;
    try {
      const pathStr = await api.dialog.openDirectory().catch(() => null);
      if (!pathStr) return; // cancelled — stay where we were
      handedOff = true;
      await openProjectPath(pathStr, label);
    } finally {
      folderPickerOpen = false;
      if (showBusyOverlay && !handedOff) {
        lifecycle.busy = false;
        lifecycle.busyLabel = "";
      }
    }
  }

  function browseFromLanding(): Promise<void> {
    return pickAndOpenFolder();
  }

  const RELEASE_NOTES_URL = "https://github.com/dimm-city/print-md/releases";
  function openReleaseNotes() {
    api.shell.openExternal(RELEASE_NOTES_URL).catch(() => {});
  }

  function setLandingStartupPref(show: boolean) {
    landingShowPref = show;
    api.app.setViewerPrefs({ showLandingAtStartup: show }).catch(() => {});
  }

  // ── Recovery UI state (transparent sync recovery) ────────────────────────────
  // The whole recovery UI state machine (RecoveryOverlay scrim, the blocked-
  // repair RecoveryGuidanceDialog, and the risky-repair RecoveryConfirmDialog)
  // lives in the RecoveryUiController (Phase 5b). The two onMount subscriptions
  // below keep the DOM/host glue (project-scope filter + reconcile) and delegate
  // the transitions to recovery.applyStatus / recovery.applyConfirm; the template
  // reads its rune getters and binds its open flags.
  const recovery = new RecoveryUiController();

  // ── Crash recovery (#44) ──────────────────────────────────────────────────
  // scanForRecovery/restoreRecovery/discardRecovery (Phase 5 slice 2, UX H5 /
  // ARCH #10 — moved from +page.svelte) live on CrashRecoveryController; the
  // template reads `crashRecovery.items` and calls the intent methods
  // (scan/restore/discard/dismiss). Host coupling injected (§8):
  // forward-references to page-local functions/state declared further down
  // (ensureBuffer, editorRef, editorOpen, …) are safe closures, the same
  // pattern `lifecycle`'s deps use.
  const crashRecovery = new CrashRecoveryController({
    isDesktop: () => isDesktop(),
    crashRecoveryEnabled: () => settings.current.editor.crashRecovery,
    listRecovery: (dir) => api.recovery.list(dir),
    clearRecovery: (filePath) => api.recovery.clear(filePath),
    readRecoveryFile: (path) => api.fs.readFile(path),
    restoreIntoBuffer: (filePath, content) => ensureBuffer().restoreContent(filePath, content),
    bufferFilePath: () => buffer?.filePath ?? null,
    bufferContent: () => buffer?.content ?? "",
    switchEditorFile: (path, content) => editorRef?.switchFile(path, content),
    openEditorPane: () => {
      editorOpen = true;
    },
    loadEditorModule: () => loadEditorModule(),
    focusEditorWhenReady: () => focusEditorWhenReady(),
    toast: () => toast,
    friendlyHostError: (message) => friendlyHostError(message),
  });

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
    // A sync may add new commits to the project's version history (both push
    // and pull sides) — refresh the activity view's snapshot list so new
    // entries appear if it's open.
    activityViewRef?.refreshHistory();
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
    if (lifecycle.currentDir && lifecycle.sourceMode === "folder") {
      void syncController.refreshSyncDiag(lifecycle.currentDir);
    }
    // Opened from the start screen and closed without opening anything: the
    // dialog's own triggerEl focus restore targets the inert workspace, so
    // reclaim focus for the landing (keeps its Esc handling alive).
    if (landingVisible) landingRef?.focusLayer();
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
      if (status.projectDir !== lifecycle.currentDir) return;
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
    /** Switch which file is open (UX review M8) — called explicitly whenever
     * the buffer's open file changes; MarkdownEditor has no reactive effect
     * of its own (this repo bans `$effect`). */
    switchFile: (path: string | null, content: string) => void;
  } | null>(null);

  // Snippet picker (#29) — opened via the toolbar button or Ctrl/Cmd+Shift+S.
  let snippetPickerRef = $state<{ show: (t?: HTMLButtonElement) => void } | null>(null);
  let snippetPickerOpen = $state(false);

  function openSnippetPicker() {
    if (!isDesktop() || !lifecycle.currentDir) return;
    snippetPickerRef?.show();
  }

  // Plugin manager (#30) — opened from the overflow menu (desktop + project).
  // ── Project Configuration view (#PCV) ───────────────────────────────────────
  // Project configuration is now a left-sidebar tab, not an editor-pane swap.
  // ARCH #59: the union used to include "config" for the old editor-pane-swap
  // design, but nothing has assigned it since the move to the sidebar tab —
  // shrunk to the two values actually reachable.
  let editorView = $state<"editor" | "activity">("editor");

  /**
   * One button → the whole project configuration view. Opens the editor pane
   * (so the panel has a frame to render into) and switches it to the config
   * view. Does NOT lazy-load the CodeMirror editor module — the config panel has
   // no need for it, keeping first-open cheap.
   */
  function openProjectConfig(): void {
    if (!lifecycle.currentDir || lifecycle.sourceMode !== "folder") return;
    if (!isDesktop()) {
      toast?.info?.("Project configuration is available in the desktop app for now.");
      return;
    }
    leftPanelOpen = true;
    leftPanelTab = "config";
    persistLeftPanelPrefs();
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

  // "Save as template" (#29) — capture the open project as a reusable template.
  let saveTemplateOpen = $state(false);
  let saveTemplateName = $state("");
  let saveTemplateBusy = $state(false);
  let saveTemplateError = $state<string | null>(null);

  function openSaveAsTemplate() {
    if (!isDesktop() || !lifecycle.currentDir) return;
    saveTemplateName = "";
    saveTemplateError = null;
    saveTemplateOpen = true;
  }

  async function confirmSaveAsTemplate() {
    if (!lifecycle.currentDir) return;
    if (!saveTemplateName.trim()) {
      saveTemplateError = "Give your template a name.";
      return;
    }
    saveTemplateBusy = true;
    saveTemplateError = null;
    try {
      const tpl = await api.tpl.saveAsTemplate({
        projectDir: lifecycle.currentDir,
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
    !!lifecycle.currentDir &&
      lifecycle.sourceMode === "folder" &&
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
    if (!editorOpen || !lifecycle.currentDir || MarkdownEditor || editorModuleLoading || editorModuleFailed) return;
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
    const dir = lifecycle.currentDir?.replace(/\\/g, "/").replace(/\/+$/, "");
    if (dir && file.startsWith(dir + "/")) return file.slice(dir.length + 1);
    return basenameOf(file);
  });
  /** Save-state derived from the buffer phase for the editor status bar. */
  let editorSavePhase = $derived(buffer?.phase ?? "clean");

  // External-edit conflict banner state (#44). Derived from the buffer's
  // pending external change so Reload / Keep mine route back through it.
  let externalChange = $derived(buffer?.externalChange ?? null);
  let externalFileName = $derived(editorFilePath ? basenameOf(editorFilePath) : "");

  function ensureBuffer(): EditorBuffer {
    if (!buffer) {
      buffer = new EditorBuffer({
        platform: getPlatform(),
        recoveryEnabled: settings.current.editor.crashRecovery,
        onError: (msg) => toast?.error(msg),
        // Single content-replacement path (#H1): every place the buffer
        // swaps in disk content — the silent clean-buffer auto-reload AND
        // the conflict-banner "Reload" action (acceptExternal) — funnels
        // through here, so the on-screen CodeMirror doc can never lag
        // behind buffer.content. Runs before the auto-reload toast below.
        onContentReplaced: (_filePath, content) => editorRef?.updateContent(content),
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

  // ARCH #61: imperative settings side-effects go through the store's single
  // onSettingsChange channel ($effect is banned in the SPA — see CLAUDE.md and
  // the store header; the store's replaceState choke point owns the notify, so
  // the old forgot-to-notify hazard is structurally gone). Each sink is
  // wrapped in settingsChangeGuard so it fires only when ITS field changed:
  // - crashRecovery → the live buffer's recovery toggle (#45); the buffer's
  //   own constructor seeds recoveryEnabled, so a fresh buffer needs no push.
  // - previewBg → re-inject viewer canvas styles; initial injection happens in
  //   the renderingComplete handler, this catches live changes. The ready()
  //   check keeps a pre-mount change from being dropped (it re-fires once the
  //   preview client exists).
  const recoverySink = settingsChangeGuard<boolean>((enabled) => buffer?.setRecoveryEnabled(enabled));
  const previewBgSink = settingsChangeGuard<string>(
    (bg) => client?.injectStyles("viewer-canvas", buildViewerStyles(bg)),
    () => !!client,
  );
  onMount(() =>
    onSettingsChange((s) => {
      recoverySink(s.editor.crashRecovery);
      previewBgSink(s.appearance.previewBg);
    }),
  );

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
   *
   * After the buffer loads, pushes the switch to the live editor view via the
   * exported `switchFile()` (UX review M8 — no reactive effect drives this,
   * see MarkdownEditor's header comment). The `buf.filePath === path` check
   * guards a race: if a second `selectEditorFile` call started before this
   * one's `load()` resolved, the buffer's own generation counter may have
   * already superseded this call — in that case `buf.filePath` now names the
   * OTHER, more recent path, and this call must not push its stale result.
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
      if (buf.filePath === path) editorRef?.switchFile(buf.filePath, buf.content);
    })();
  }

  /**
   * FileTree row actions (UX review M9): the tree performs the actual
   * create/rename/delete host calls itself; these three hooks are the ONLY
   * point where the open-file buffer needs to react. The buffer's own
   * external-edit reconciliation is driven by the folder watcher, which is a
   * single NON-RECURSIVE `fs.watch` on the project ROOT — it can't observe a
   * rename/delete of a file in a nested folder, so this app's own tree
   * actions must tell the buffer directly rather than rely on that watcher.
   */

  /**
   * Called BEFORE the rename API call fires, only when `path` is the open
   * file. Must run BEFORE the rename, not after: the rename call only moves
   * whatever is on disk right now, so a flush AFTER renaming would stat the
   * buffer's still-old `filePath`, find it missing, and (per
   * EditorBuffer.externalChangeBeforeSave's own safety check) refuse to
   * write at all — raising a spurious "this file was deleted" conflict
   * banner off the author's OWN rename, with the edit stranded in the dirty
   * buffer under neither name. `flush()` is a no-op when the buffer isn't
   * dirty, so it's safe to await unconditionally.
   */
  async function onTreeBeforeRename(path: string): Promise<void> {
    if (buffer && buffer.filePath === path) {
      await buffer.flush().catch(() => {});
    }
  }

  /**
   * Called after a successful rename. `selectEditorFile` re-reads from disk
   * at `newPath` — since `onTreeBeforeRename` already flushed (or the buffer
   * was already clean), disk content at `newPath` matches the buffer, so
   * this is a clean no-op reload that just repoints `filePath`/`diskMtimeMs`.
   */
  function onTreeFileRenamed(oldPath: string, newPath: string): void {
    if (editorFilePath === oldPath) {
      selectEditorFile(newPath);
    }
  }

  /**
   * Called after a successful delete. Close the buffer rather than leaving
   * it pointing at a path that no longer exists — the exact "must not
   * silently point at a missing path" failure mode M9 calls out (a stray
   * edit afterward would otherwise silently recreate the deleted file).
   */
  function onTreeFileDeleted(path: string): void {
    if (editorFilePath === path) {
      buffer?.reset();
    }
  }

  function onEditorChange(value: string) {
    if (!isDesktop()) return;
    ensureBuffer().edit(value);
  }

  // When the editor opens with nothing loaded, auto-select a sensible file so the
  // user isn't dropped on an empty "Select a file" pane: the first markdown file,
  // else the first editable file.
  async function ensureEditorFile() {
    if (!lifecycle.currentDir || !isDesktop()) return;
    // Fire-and-forget continuation: capture the dir and bail if a different
    // project took over during the listing, or this would load the OLD
    // project's chapter into the NEW project's buffer (and auto-save edits
    // into the wrong book on disk).
    const dir = lifecycle.currentDir;
    const buf = ensureBuffer();
    if (buf.filePath) return;
    try {
      const files = (await api.fs.listDir(dir)).filter((e) => !e.isDir);
      if (dir !== lifecycle.currentDir || buf.filePath) return;
      const pick =
        files.filter((e) => /\.md$/i.test(e.name)).sort((a, b) => a.name.localeCompare(b.name))[0] ||
        files.find((e) => /\.(md|css)$/i.test(e.name));
      if (pick) selectEditorFile(pick.path);
    } catch {
      /* non-fatal: the user can still pick a file from the tree */
    }
  }

  function reloadExternal() {
    // acceptExternal() fires the buffer's onContentReplaced callback above,
    // which pushes the reloaded content into the editor — no separate
    // updateContent call needed here (#H1).
    buffer?.acceptExternal();
  }

  function keepMineExternal() {
    buffer?.keepMine();
  }

  // scanForRecovery/restoreRecovery/discardRecovery/dismissRecovery (#44,
  // Phase 5 slice 2 — UX H5 / ARCH #10) now live on `crashRecovery`
  // (CrashRecoveryController) — see its instantiation above. The template
  // reads `crashRecovery.items` and calls the intent methods directly.

  // ── Persist left panel state on change ────────────────────────────────────
  function persistLeftPanelPrefs() {
    if (!leftPanelPrefsLoaded) return;
    api.app
      .setViewerPrefs({ leftPanel: { open: leftPanelOpen, activeTab: leftPanelTab, width: leftPanelWidth } } as Record<string, unknown>)
      .catch(() => {});
  }

  function toggleLeftPanel() {
    leftPanelOpen = !leftPanelOpen;
    persistLeftPanelPrefs();
  }

  function toggleEditor() {
    if (!lifecycle.currentDir || lifecycle.sourceMode !== "folder") return;
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
  // M5: distinct from "problems === [] because the project is clean" — set
  // when the lint API call itself failed, so the panel can render a neutral
  // "we couldn't check" row instead of a false green all-clear.
  let problemsError = $state<string | null>(null);
  // M30: missing shared-asset folders ("the #1 cause of wrong fonts/styles")
  // used to be a single 5-second auto-dismissing toast that the Problems
  // panel never heard about. Held separately from `problems` (which
  // refreshProblems() wholesale-replaces on every rebuild) so these rows
  // persist across rebuilds; cleared alongside `problems` whenever a project
  // closes/switches.
  let missingAssetProblems = $state<ProblemEntry[]>([]);
  let allProblems = $derived([...missingAssetProblems, ...problems]);
  let problemBadge = $derived(problemCounts(allProblems).badge); // used for ProblemsPanel (informational)

  function refreshProblems() {
    if (!isDesktop() || !lifecycle.currentDir || lifecycle.sourceMode !== "folder") return;
    const dir = lifecycle.currentDir;
    problemsLoading = true;
    api.lint.project(dir)
      .then((entries) => {
        // The project may have changed while the lint was in flight.
        if (lifecycle.currentDir === dir) {
          problems = entries;
          problemsError = null;
        }
      })
      .catch(() => {
        // Lint failing must never break the preview, but it must also never
        // present as a false "no problems found" all-clear (M5) — surface a
        // distinct error state instead of silently clearing to [].
        if (lifecycle.currentDir === dir) {
          problems = [];
          problemsError = "We couldn't check your project this time.";
        }
      })
      .finally(() => {
        // M5: without this guard, a stale in-flight lint from a project the
        // author has since navigated away from can clear the NEW project's
        // loading indicator out from under it.
        if (lifecycle.currentDir === dir) problemsLoading = false;
      });
  }

  // Problems are cleared in stopPreview() and openUrl() — no reactive effect needed.

  /**
   * Open the problem's file in the editor at the offending line. Reuses the
   * existing cross-chapter reveal (the same path the preview→editor sync and
   * outline jumps use) — no new navigation machinery.
   */
  function openProblem(p: ProblemEntry) {
    if (!p.filePath || !lifecycle.currentDir) return;
    // Make sure the editor pane is visible first (narrow = Edit mode pane;
    // wide = the editor split).
    if (isNarrow) {
      setPaneMode("edit");
    } else if (!editorOpen) {
      editorOpen = true;
      loadEditorModule();
    }
    const rel = p.file ?? basenameOf(p.filePath);
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
        diagnosticsTools = data.tools ?? [];
        appVersion = data.viewerVersion ?? null;
      })
      .catch(() => {});
  });

  // lifecycle.saveWarning is cleared in startFolderPreview (lifecycle.saveWarning = null at top) and
  // in the renderingComplete handler. No reactive effect needed.

  onMount(() => {
    const off = getPlatform().onUrlPreviewBlocked((event: UrlPreviewBlockedEvent) => {
      if (lifecycle.sourceMode !== "url") return;
      if (!lifecycle.previewUrl) return;
      lifecycle.previewUrl = null;
      lifecycle.urlPreviewError = event.reason;
    });
    return () => off?.();
  });

  // pageEditInput focus is triggered directly in beginPageEdit() — see below.

  // ── Startup: reopen the last project behind the start screen ─────────────────
  // The ~90-line landing/prefs/last-project continuation (Phase 5 slice 2, UX
  // H5 / ARCH #10) now lives on `startup` (StartupController) — the pure
  // predicates it calls (decideStartupScreen) stay in startup-landing.ts.
  // `revealWindow()`'s one call site is the controller's private `reveal()`;
  // the four former exit-path duplicates are gone. Host coupling injected
  // (§8): forward-references to page-local state/functions declared
  // elsewhere (lifecycle, landing* state, leftPanel* state, startFolderPreview)
  // are safe closures, the same pattern every other Phase 5 controller uses.
  const startup = new StartupController({
    isDesktop: () => isDesktop(),
    isWorkspaceEngaged: () =>
      !!(lifecycle.previewUrl || lifecycle.currentDir || lifecycle.currentUrl || lifecycle.busy || lifecycle.openError || lifecycle.urlPreviewError),
    isSomethingOpen: () => !!(lifecycle.previewUrl || lifecycle.currentDir || lifecycle.currentUrl),
    // Reveal the main window / dismiss the splash — idempotent host-side.
    revealWindow: () => {
      api.app.rendererReady().catch(() => {});
    },
    getViewerPrefs: () => api.app.getViewerPrefs(),
    isLeftPanelPrefsLoaded: () => leftPanelPrefsLoaded,
    applyLeftPanelPrefs: (panelPrefs) => {
      leftPanelPrefsLoaded = true;
      if (panelPrefs?.activeTab) leftPanelTab = panelPrefs.activeTab as typeof leftPanelTab;
      if (typeof panelPrefs?.width === "number") leftPanelWidth = Math.min(480, Math.max(200, panelPrefs.width));
      leftPanelOpen = panelPrefs?.open ?? false;
    },
    setLandingShowPref: (show) => {
      landingShowPref = show;
    },
    setLandingReady: (ready) => {
      landingReady = ready;
    },
    setLandingHold: (hold) => {
      landingHold = hold;
    },
    setLandingContinueDir: (dir) => {
      landingContinueDir = dir;
    },
    splashStatus: (message, percent) => {
      api.app.splashStatus(message, percent).catch(() => {});
    },
    setBusy: (busy, label) => {
      lifecycle.busy = busy;
      lifecycle.busyLabel = label;
    },
    getViewerProjectState: (dir) => api.app.getViewerProjectState(dir).catch(() => null),
    startFolderPreview: (dir, label, restoreState) => startFolderPreview(dir, label, restoreState),
    hasOpenError: () => !!lifecycle.openError,
  });

  onMount(() => {
    void startup.run();
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
      currentDir: () => lifecycle.currentDir,
      bufferDirty: () => !!buffer?.isDirty,
      updateActiveOutline: (line) => updateActiveOutline(line),
      revealEditorLine: (line) => editorRef?.revealLine(line),
      followChapterInEditor: (chapter, line) => editorSync.followChapterInEditor(chapter, line),
    },
    zoom: () => zoom,
    viewMode: () => viewMode,
    bgColor: () => bgColor,
    setRendering: (v) => (lifecycle.rendering = v),
    getRendering: () => lifecycle.rendering,
    setRenderProgressPage: (v) => (lifecycle.renderProgressPage = v),
    getRenderProgressPage: () => lifecycle.renderProgressPage,
    setRenderCompleteOverlay: (v) => (lifecycle.renderCompleteOverlay = v),
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
  // remounts on lifecycle.previewUrl change via {#key lifecycle.previewUrl}).
  //
  // M31: this is also where the client's postMessage security is wired up.
  // PreviewFrame calls attach() itself (on the iframe's "load" event, after
  // this callback has already run), so `setExpectedOrigin`/`lockDown` must
  // happen HERE, synchronously, ahead of that — PreviewFrame cannot read the
  // pinned origin from the cross-origin iframe's own window.location (that
  // throws), and in URL-preview mode the SAME component loads an arbitrary
  // third-party page, which must never get the command/event bridge wired up
  // at all (a locked client's later attach() call is a permanent no-op).
  function onClientReady(c: PreviewClient) {
    if (lifecycle.sourceMode === "url") {
      c.lockDown();
      return;
    }
    c.setExpectedOrigin(lifecycle.previewUrl);
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
  // Keyboard shortcuts: global (available without a loaded document) +
  // preview navigation (active whenever a preview is open). ONE keydown
  // registration (H5 / ARCH #10 — the review's "two separate global keydown
  // handlers … both route to savePdf" finding): `onGlobalKey`/
  // `onPreviewNavKey` keep their original, independently-scoped bodies
  // (unchanged — each function's own internal `return`s still only skip that
  // function's remaining checks) so behavior is byte-identical to the two
  // formerly-separate listeners, which the browser also always ran in this
  // same registration order for the same event; `onKeydown` just calls both
  // from one `addEventListener` instead of two.
  // ----------------------------------------------------------------
  onMount(() => {
    function onGlobalKey(e: KeyboardEvent) {
      const command = resolveGlobalShortcut({
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        shift: e.shiftKey,
        key: e.key,
      });
      // Cmd/Ctrl+, opens the Settings panel (toggles closed if already open).
      // Allowed even over the start screen — the dialog renders outside the
      // inert workspace, and on first run the landing is the only screen.
      if (command === "settings") {
        e.preventDefault();
        settingsOpen = !settingsOpen;
        return;
      }
      // The start screen owns the rest of the keyboard while it's up (its own
      // Esc handling); workspace shortcuts must not act on the inert UI
      // behind it.
      if (landingVisible) return;
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
        else void exportController.savePdf();
      }
    }

    function onPreviewNavKey(e: KeyboardEvent) {
      // Only active when a preview URL is loaded.
      if (!lifecycle.previewUrl) return;
      if (e.defaultPrevented) return;
      // Never page/zoom the pre-rendering preview from behind the start screen.
      if (landingVisible) return;
      // Don't intercept when focus is in a form control or the CodeMirror
      // editor (#38) — preview-nav keys (arrows, Home/End, +/-/=, f) must
      // never hijack editing. Shared guard: $lib/a11y isEditableTarget.
      if (isEditableTarget(e.target)) return;

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
          if (canSavePdf) exportController.savePdf();
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

    function onKeydown(e: KeyboardEvent) {
      onGlobalKey(e);
      onPreviewNavKey(e);
    }

    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  });

  // ----------------------------------------------------------------
  // Responsive auto view-mode on resize (unless user locked it)
  // ----------------------------------------------------------------
  onMount(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    function onResize() {
      if (!lifecycle.previewUrl || zoomView.userSetViewMode) return;
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

  /**
   * The ONE open-a-project-folder pipeline (epoch/superseded() concurrency
   * guard included) now lives on ProjectLifecycleController (Phase 5d). Thin
   * delegate kept so every call site below reads the same as before.
   */
  function startFolderPreview(
    dir: string,
    label = "Starting preview…",
    restoreState:
      | PersistedProjectState
      | null
      | Promise<PersistedProjectState | null> = null,
    displayName: string | null = null,
  ): Promise<void> {
    return lifecycle.startFolderPreview(dir, label, restoreState, displayName);
  }

  /**
   * C2: switch the active book within the open repo (BookSwitcher). A full
   * re-open at the sibling book's folder — the simplest correct mechanism per
   * the C2 design note: classify() resolves the same repoRoot/books (it's the
   * same repo), so session identity is unchanged; only the content pipeline
   * (preview/editor/watch) retargets to the chosen book.
   */
  async function switchBook(path: string) {
    if (lifecycle.busy || path === lifecycle.currentDir) return;
    dismissLanding(false); // switching from a landing chip enters the workspace
    await lifecycle.startFolderPreview(path, "Switching book…");
  }

  function openFolder(): Promise<void> {
    return pickAndOpenFolder({ showBusyOverlay: true, label: "Starting preview…" });
  }

  /** Load a URL preview. Reset/epoch-supersede logic now lives on ProjectLifecycleController. */
  function openUrl(url: string) {
    lifecycle.openUrl(url);
  }

  function openInBrowser() {
    if (!lifecycle.currentUrl) return;
    api.shell.openExternal(lifecycle.currentUrl).catch(() => {});
  }

  function getSaveReadinessWarning(): string | null {
    if (lifecycle.sourceMode !== "folder" || !lifecycle.currentDir) {
      return "Open a project folder before saving a PDF.";
    }
    if (lifecycle.rendering || !lifecycle.previewUrl) {
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

  // stopPreview (flush + host teardown + the ONE resetWorkspace()) now lives
  // on ProjectLifecycleController; called directly as lifecycle.stopPreview()
  // — no page-local wrapper needed since it's never passed as a bare prop
  // reference (unlike openUrl/startFolderPreview/setUpAsBook above).

  // savePdf/exportHtml/cancelExport (Phase 5 slice 2, UX H5 / ARCH #10) now
  // live on `exportController` (ExportController.savePdf/exportHtml/
  // cancelExport) — called directly from the template/keydown handler as
  // `exportController.savePdf()` etc.; no page-local wrapper needed since
  // they're never passed as bare prop references.

  // Page-navigation intents (syncPageState / restoreProjectPage /
  // runPageCommand / gotoPage / begin|cancel|commitPageEdit /
  // first|prev|next|lastPage) now live on `pageNav` (PageNavController).
  function saveViewerPrefs(patch: Partial<PersistedProjectState>) {
    if (!lifecycle.currentDir || lifecycle.sourceMode !== "folder" || lifecycle.rendering || pageNav.restoringSavedState) return;
    // Per-project state (#43): write to the folder-keyed bucket so this never
    // overwrites another project's saved page/view. The main process also
    // updates lastProjectDir, so reopening lands on this project.
    api.app.setViewerProjectState(lifecycle.currentDir, patch as Record<string, unknown>).catch(() => {});
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
      } else if (entry.chapter && lifecycle.currentDir && !buffer?.isDirty) {
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
      lifecycle.renderCompleteOverlay = false;
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
    if (mode === "edit" && lifecycle.currentDir && lifecycle.sourceMode === "folder") {
      const wasClosed = !editorOpen;
      editorOpen = true;
      loadEditorModule();
      void ensureEditorFile();
      if (wasClosed) focusEditorWhenReady();
    }
  }

  function togglePreview() {
    if (!lifecycle.previewUrl || isNarrow) return;
    previewHidden = !previewHidden;
    if (previewHidden && lifecycle.currentDir && lifecycle.sourceMode === "folder") {
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
   * M2: Hide the render-progress overlay — and ONLY hide it. This backs the
   * variant="pane" overlay, which is shown during EVERY watcher-triggered
   * rebuild while the author is actively editing, not just a project's first
   * render — routing this through stopPreview() (as it used to) silently
   * closed the whole project on a routine auto-save rebuild, with no
   * confirmation. The render itself is NOT aborted: it continues invisibly
   * and finishes harmlessly (the iframe stays mounted and VISIBLE — do NOT
   * set opacity or hide it, that would re-trigger the Chromium 1fps
   * cross-origin throttle). lifecycle.currentDir/editor/buffer are left untouched.
   *
   * Real cancel-and-close is offered only on the INITIAL open, before a
   * project session/preview exists yet — see handleCancelOpen below, wired
   * to the variant="app" overlay.
   */
  function handleCancelRender() {
    lifecycle.rendering = false;
    lifecycle.renderCompleteOverlay = false;
  }

  /**
   * M2: Real cancel-and-close, for the initial open ONLY. Backs the
   * variant="app" overlay, which by construction only shows before any
   * preview exists (`!lifecycle.previewUrl`) — there is no live workspace to interrupt
   * yet, so a full teardown is safe here in a way it is not once the preview
   * pane is up (see handleCancelRender above). Bumping the epoch supersedes
   * whatever `startFolderPreview` call is in flight, the same mechanism
   * `openUrl` uses to abort an in-flight open — its own guarded state writes
   * become no-ops once superseded.
   */
  function handleCancelOpen() {
    lifecycle.cancelOpen();
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
      toast?.error(`Save failed: ${friendlyHostError(e instanceof Error ? e.message : String(e))}`);
    } finally {
      forceSaving = false;
    }
  }

</script>

<Toast bind:api={toast} />

<CrashRecoveryDialog
  items={crashRecovery.items}
  onRestore={(item) => crashRecovery.restore(item)}
  onDiscard={(item) => crashRecovery.discard(item)}
  onDismiss={() => crashRecovery.dismiss()}
/>

<!-- RC3-1: App-level overlay for the initial "Opening folder…" lifecycle.busy state ONLY
     (no preview pane exists yet). Scoped below the toolbar (z-index:50) and
     all dialogs (1000+). This does NOT cover the preview pane or editor during
     layout — that's handled by the pane-scoped overlay inside .preview-pane.
     M2: this is the ONE place a real cancel-and-close is offered — safe here
     because no project session/preview exists yet (see handleCancelOpen). -->
{#if lifecycle.busy && !!lifecycle.busyLabel && !lifecycle.previewUrl && !landingVisible}
  <LoadingOverlay
    visible={true}
    label={lifecycle.busyLabel}
    onCancel={handleCancelOpen}
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
      <button class="export-cancel" onclick={() => exportController.cancelExport()} disabled={!exportController.activeExportId}>Cancel</button>
    {/if}
  </div>
{/if}

<!-- inert while the start screen is up: the workspace keeps rendering (the
     landing scrim is translucent so the preview iframe stays un-throttled)
     but takes no focus/clicks. Dialogs and toasts live OUTSIDE this subtree
     so they stay interactive above the landing. -->
<div class="app-root" inert={landingVisible}>
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
      {#if lifecycle.sourceMode === "url" && lifecycle.currentUrl}
        {#if lifecycle.docTitle}
          <span class="doc-title" title={lifecycle.docTitle}>{lifecycle.docTitle}</span>
        {/if}
        <span class="path" title={lifecycle.currentUrl}>{lifecycle.currentUrl}</span>
        <button class="icon-btn" onclick={openInBrowser} title="Open in browser" aria-label="Open in browser">
          <Icon name="external-link" />
        </button>
      {:else if lifecycle.currentDir}
        <!-- Folder source: show the title/name; full path is the hover tooltip. -->
        <span class="doc-title" title={lifecycle.currentDir}>{displayTitle}</span>
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
      {#if lifecycle.previewUrl && !isNarrow}
        <section class="center">
          <button class="icon-btn" onclick={() => pageNav.firstPage()} disabled={lifecycle.rendering} title="First page (Home)" aria-label="First page">
            <Icon name="chevrons-left" />
          </button>
          <button class="icon-btn" onclick={() => pageNav.prevPage()} disabled={lifecycle.rendering} title="Previous page (Left/PageUp)" aria-label="Previous page">
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
            <button class="page-pill" onclick={() => pageNav.beginPageEdit()} disabled={lifecycle.rendering} aria-label="Edit current page">
              <span class="pill-word">Page&nbsp;</span>{pageNav.currentPage} / {pageNav.totalPages || "—"}
            </button>
          {/if}
          <button class="icon-btn" onclick={() => pageNav.nextPage()} disabled={lifecycle.rendering} title="Next page (Right/PageDown)" aria-label="Next page">
            <Icon name="chevron-right" />
          </button>
          <button class="icon-btn" onclick={() => pageNav.lastPage()} disabled={lifecycle.rendering} title="Last page (End)" aria-label="Last page">
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
            disabled={!lifecycle.currentDir || lifecycle.sourceMode === "url"}
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
            disabled={!lifecycle.currentDir || lifecycle.sourceMode === "url"}
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
            disabled={!lifecycle.previewUrl}
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
          disabled={!lifecycle.previewUrl}
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
          disabled={!lifecycle.previewUrl}
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
            disabled={!lifecycle.previewUrl}
          >
            <Icon name="rectangle-vertical" /> Single page
          </button>
          <button
            aria-pressed={viewMode === "two-column"}
            class="menu-item"
            class:active={viewMode === "two-column"}
            onclick={(e) => { zoomView.applyViewMode("two-column", true); closeMenu(e); }}
            disabled={!lifecycle.previewUrl}
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
              disabled={!lifecycle.previewUrl}
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
          disabled={!lifecycle.previewUrl || !lifecycle.currentDir || lifecycle.sourceMode === "url"}
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
          disabled={!lifecycle.currentDir || lifecycle.sourceMode === "url"}
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
          class="primary app-btn-primary save-btn icon-text"
          onclick={() => exportController.savePdf()}
          disabled={lifecycle.busy || exportController.exporting || !lifecycle.currentDir || lifecycle.sourceMode === "url"}
          title="Save as PDF (Ctrl+Shift+E)"
        >
          <Icon name="file-down" />
          <span class="save-btn-label">{exportController.exporting ? "Saving…" : "Save PDF"}</span>
        </button>
        <!-- UX-023: explain why Save PDF is disabled -->
        {#if !lifecycle.currentDir && !lifecycle.busy}
          <span class="save-hint">Open a folder first</span>
        {:else if lifecycle.sourceMode === "url"}
          <span class="save-hint">Not available for web previews</span>
        {:else if lifecycle.saveWarning}
          <span class="save-hint save-warning" role="alert">{lifecycle.saveWarning}</span>
        {/if}
      {:else}
        <!-- #33 Phase 5: PDF is desktop-only; on the web export a standalone
             book.html instead (build({format:"html"}) → blob downloadUrl). -->
        <button
          class="primary app-btn-primary save-btn icon-text"
          onclick={() => exportController.exportHtml()}
          disabled={lifecycle.busy || exportController.exporting || !lifecycle.currentDir || lifecycle.sourceMode === "url"}
          title="Export as HTML"
        >
          <Icon name="file-down" />
          <span class="save-btn-label">{exportController.exporting ? "Exporting…" : "Export HTML"}</span>
        </button>
        {#if !lifecycle.currentDir && !lifecycle.busy}
          <span class="save-hint">Open a folder first</span>
        {:else if lifecycle.sourceMode === "url"}
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
          {#if isDesktop() && lifecycle.currentDir}
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
      bind:open={leftPanelOpen}
      bind:width={leftPanelWidth}
      bind:activeTab={leftPanelTab}
      projectDir={lifecycle.currentDir}
      projectDisplayName={lifecycle.currentFolderDisplayName}
      projectCapabilities={projectSession.projectCapabilities}
      editorFilePath={editorFilePath}
      sourceMode={lifecycle.sourceMode}
      outline={outline}
      activeOutlineIndex={activeOutlineIndex}
      toggleBtn={leftPanelToggleBtn}
      onJumpToOutline={jumpToOutline}
      onSelectEditorFile={(path) => {
        selectEditorFile(path);
        if (!editorOpen && lifecycle.currentDir && lifecycle.sourceMode === "folder") {
          editorOpen = true;
          loadEditorModule();
          focusEditorWhenReady();
        }
      }}
      onBeforeRenameOpenFile={onTreeBeforeRename}
      onFileRenamed={onTreeFileRenamed}
      onFileDeleted={onTreeFileDeleted}
      onOpenProjectConfig={openProjectConfig}
      onInsertImage={(payload) => insertImageIntoChapter(payload)}
      onProjectChosen={(path) => void openProjectPath(path)}
      onOpenUrl={openUrl}
      onOpenGitHub={isDesktop() ? () => (githubOpen = true) : undefined}
      onNewProject={() => newProjectWizardRef?.show()}
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
        <button class="primary app-btn-primary" onclick={() => lifecycle.currentDir && setUpAsBook(lifecycle.currentDir)} disabled={lifecycle.adopting}>
          {lifecycle.adopting ? "Setting up…" : "Set up as a book"}
        </button>
        <button class="ghost" onclick={() => (lifecycle.adoptBannerDismissed = true)} disabled={lifecycle.adopting} aria-label="Dismiss">
          Not now
        </button>
      </div>
    </div>
  {/if}

  {#if lifecycle.previewUrl}
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
          aria-label={mobileTab === "css" ? "CSS editor" : "Markdown editor"}
        >
          {#if editorView === "activity"}
            <!-- Remount on project switch so a stale snapshot/log list from a
                 previously-open project can never linger under the new one
                 (mirrors LeftPanel's {#key projectDir} FileTree/MediaPanel
                 pattern) — replaces the retired resetHistoryState no-op (L8). -->
            {#key lifecycle.currentDir}
              <ProjectActivityView
                bind:this={activityViewRef}
                projectDir={lifecycle.currentDir}
                {logFilePath}
                onClose={closeActivityView}
                onRestored={onSnapshotRestored}
              />
            {/key}
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
              projectDir={lifecycle.currentDir}
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
              <!-- No per-file `{#key}` remount wrapper here (UX review M8):
                   MarkdownEditor keeps ONE EditorView for its whole lifetime.
                   `filePath`/`content` below only seed its INITIAL document —
                   selectEditorFile()/crashRecovery.restore() push every later switch
                   explicitly via editorRef.switchFile() (this repo bans
                   `$effect`, so the switch can't be a reactive prop watcher),
                   which reconfigures the SAME view from its own per-file
                   EditorState cache, preserving undo history, selection, and
                   scroll. Remounting here on every chapter change destroyed
                   all of that — exactly the bug this review found. -->
              <MarkdownEditor
                bind:this={editorRef}
                filePath={editorFilePath}
                content={editorContent}
                onChange={onEditorChange}
                onAnchorLine={(line, origin) => editorSync.onEditorAnchorLine(line, origin)}
              />
            {:else if editorModuleFailed}
              <div class="editor-loading" role="alert">
                <p>The editor failed to load.</p>
                <button class="primary app-btn-primary" onclick={retryEditorLoad}>Retry</button>
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
        {#key lifecycle.previewUrl}
          <PreviewFrame
            url={lifecycle.previewUrl}
            bind:client
            onClientReady={onClientReady}
            onError={(msg) => {
              if (lifecycle.sourceMode === "url") {
                lifecycle.urlPreviewError = "This website could not be previewed inside print-md.";
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
             M2: onCancel (handleCancelRender) only HIDES the overlay — it does
             NOT tear down the project. This overlay reappears on every
             watcher-triggered rebuild, not just a session's first render, so
             a full teardown here would silently close the project on a
             routine auto-save. -->
        <LoadingOverlay
          visible={lifecycle.rendering || lifecycle.renderCompleteOverlay}
          label={lifecycle.renderCompleteOverlay ? "Rendering complete…" : lifecycle.renderProgressPage > 0 ? `Laying out page ${lifecycle.renderProgressPage}…` : "Rendering…"}
          onCancel={lifecycle.rendering ? handleCancelRender : undefined}
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
  {/if}
  <!-- No {:else} empty state here — the start screen (WelcomeLanding, mounted
       after .app-root) is the app's single "nothing open" surface. -->

    </div> <!-- /main-content -->
  </div> <!-- /left-panel-region -->

  <!-- StatusBar: always-visible bottom bar with sync pill, save indicator,
       and problems panel toggle. Sits below the left-panel-region in the
       .shell flex column so it spans the full window width. Never covers
       the preview iframe (normal layout flow). -->
  <StatusBar
    projectDir={lifecycle.currentDir}
    sourceMode={lifecycle.sourceMode}
    canSync={!!(syncController.syncDiag?.canSync)}
    canSnapshot={!!(projectSession.projectCapabilities?.canSnapshot)}
    savePhase={editorSavePhase}
    fileOpen={!!editorFilePath}
    {forceSaving}
    forceSyncing={syncController.forceSyncing}
    problems={allProblems}
    problemsLoading={problemsLoading}
    {problemsError}
    bind:problemsOpen={problemsOpen}
    books={projectSession.books}
    activeBookDir={projectSession.activeBookDir}
    onSwitchBook={(path) => void switchBook(path)}
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

<!-- Start screen: interactive cover over the (pre-rendering) workspace. Sits
     outside .app-root so it is never inert; dialogs (top layer) open above it. -->
<WelcomeLanding
  bind:this={landingRef}
  visible={landingVisible}
  continueTitle={landingContinueTitle}
  continueDetail={landingContinueDetail}
  status={landingStatus}
  otherBooks={landingOtherBooks}
  booksDisabled={lifecycle.busy}
  errorTitle={landingErrorTitle}
  errorBody={landingErrorBody}
  canAdopt={canAdoptFailedFolder}
  adopting={lifecycle.adopting}
  version={appVersion}
  showAtStartup={landingShowPref}
  updateReadyVersion={updateController.readyVersion}
  updateAvailableVersion={updateController.availableVersion}
  updateDownloading={updateController.downloading}
  onContinue={() => dismissLanding()}
  onOpenPath={(path) => void openProjectPath(path)}
  onSwitchBook={(path) => void switchBook(path)}
  onOpenUrl={openUrl}
  onBrowse={() => void browseFromLanding()}
  onNewProject={() => newProjectWizardRef?.show()}
  onOpenGitHub={isDesktop() ? () => (githubOpen = true) : undefined}
  onOpenGuide={openSetupGuide}
  onOpenSettings={() => (settingsOpen = true)}
  onOpenHelp={() => (helpOpen = true)}
  onWhatsNew={openReleaseNotes}
  onAdopt={() => {
    if (lifecycle.failedOpenDir) void setUpAsBook(lifecycle.failedOpenDir);
  }}
  onToggleShowAtStartup={setLandingStartupPref}
  onUpdateApply={() => updateController.applyNow()}
  onUpdateDownload={() => updateController.download()}
/>

<HelpDialog
  bind:open={helpOpen}
  onClose={() => {
    if (landingVisible) landingRef?.focusLayer();
  }}
  onCheckForUpdates={() => updateController.check()}
  checkingUpdates={updateController.checking}
  updateReadyVersion={updateController.readyVersion}
  updateAvailableVersion={updateController.availableVersion}
/>
<SettingsDialog
  bind:open={settingsOpen}
  onClose={() => {
    if (landingVisible) landingRef?.focusLayer();
  }}
  onViewModeChange={(mode) => { if (client && !lifecycle.rendering) client.call("setViewMode", [mode]).catch(() => {}); }}
  onCrashRecoveryChange={(enabled) => { buffer?.setRecoveryEnabled(enabled); }}
/>
<GitHubDialog
  bind:open={githubOpen}
  onOpened={(projectDir) => {
    invalidateDiscoveredProjects(); // a fresh clone is a new discoverable book
    return openProjectPath(projectDir, "Opening your project…");
  }}
  onAdvancedSetup={() => (advancedSetupOpen = true)}
  onClosed={onConnectDialogClosed}
  triggerEl={leftPanelToggleBtn}
/>
<AdvancedSetupDialog
  bind:open={advancedSetupOpen}
  projectDir={lifecycle.sourceMode === "folder" ? lifecycle.currentDir : null}
  triggerEl={advancedSetupBtn}
  onClosed={onConnectDialogClosed}
/>
<NewProjectWizard
  bind:this={newProjectWizardRef}
  onCreated={(projectDir) => {
    invalidateDiscoveredProjects(); // the new book must show up in lists now
    return openProjectPath(projectDir, "Opening your new book…");
  }}
  onClosed={() => {
    if (landingVisible) landingRef?.focusLayer();
  }}
/>
<!-- Snippet picker (#29): insert a reusable markdown fragment at the cursor,
     prompting for {{variable}} placeholders. Desktop-only (file IO host gate). -->
<SnippetPicker
  bind:this={snippetPickerRef}
  bind:open={snippetPickerOpen}
  projectDir={lifecycle.currentDir}
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
      <button class="primary app-btn-primary" onclick={confirmSaveAsTemplate} disabled={saveTemplateBusy}>
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
  projectDir={lifecycle.sourceMode === "folder" ? lifecycle.currentDir : null}
  files={syncController.conflictFiles}
  localId={syncController.conflictLocalId}
  remoteId={syncController.conflictRemoteId}
  pending={syncController.conflictPending}
  idsFetchFailed={syncController.conflictFetchFailed}
  onRetryIds={() => syncController.retryConflictIds()}
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
    /* Above the start screen (900): a live export's progress + Cancel must
       stay reachable when the workspace empties and the landing returns.
       Still below dialogs (1000+). */
    z-index: 950;
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
  /* The primary-button color recipe (gradient/hover/border-color/font-weight)
     used to be duplicated here as `button.primary { ... }`. It now lives in
     theme.css's `.app-btn-primary` (UX review L5 — the ONE primary variant);
     every `class="primary"` button in this file's template also carries
     `app-btn-primary`, which supplies the color. `.primary` itself is kept as
     a plain semantic marker class with no CSS of its own. */
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

  /* (Empty-state hero styles removed — the WelcomeLanding component is the
     app's single "nothing open" surface and carries its own styles.) */

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
