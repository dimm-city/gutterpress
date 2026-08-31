<script lang="ts">
  import PreviewFrame from "$lib/components/PreviewFrame.svelte";
  import FindBar from "$lib/components/FindBar.svelte";
  import ExternalEditBanner from "$lib/components/ExternalEditBanner.svelte";
  import CrashRecoveryDialog from "$lib/components/CrashRecoveryDialog.svelte";
  import { EditorBuffer } from "$lib/editor/buffer-state.svelte";
  import { EditorFileSession } from "$lib/editor/editor-file-session.svelte";
  import { chapterPath, isSafeChapterId } from "$lib/editor/chapter-path";
  import { ExportController } from "$lib/export/export-controller.svelte";
  import Toast from "$lib/components/Toast.svelte";
  import type { ToastController } from "$lib/components/Toast.svelte";
  import type { MarkdownFileLaunchEvent } from "$lib/platform/contract";
  import type { ProblemEntry } from "$lib/platform/dtos";
  import { buildProblems, problemCounts } from "$lib/problems";
  import StatusBar from "$lib/components/StatusBar.svelte";
  import LoadingOverlay from "$lib/components/LoadingOverlay.svelte";
  import ProjectActivityView from "$lib/components/ProjectActivityView.svelte";
  import SettingsView from "$lib/components/SettingsView.svelte";
  import NewProjectWizard from "$lib/components/NewProjectWizard.svelte";
  import GitHubDialog from "$lib/components/GitHubDialog.svelte";
  import PublishWizard from "$lib/components/PublishWizard.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import AppToolbar from "$lib/components/AppToolbar.svelte";
  import ExportDialog from "$lib/components/ExportDialog.svelte";
  import ProjectSettingsView from "$lib/components/ProjectSettingsView.svelte";
  import EditorToolbar from "$lib/components/EditorToolbar.svelte";
  import type { ToolbarAction, ToolbarPayload } from "$lib/components/EditorToolbar.svelte";
  // SFE-P3ab, Lane A — the shared rich editor, off by default this run. See
  // rich-mode.svelte.ts's own header for the mode-selection contract.
  import { createRichModeController, trackSurfaceMount } from "$lib/editor/rich-mode.svelte";
  import { DesktopDocumentHost } from "$lib/editor-host/desktop-document-host";
  // SFE-P3ab, Lane B — the adapter that lets the shared P2a command
  // vocabulary drive the rich surface (rich-commands.ts's own header has
  // the full design, including the confirmed-missing selection accessor).
  import {
    routeToolbarAction,
    applyRichCommand,
    applyRichLayoutBlock,
    applyRichImageInsert,
    applyRichAppend,
    applyBlockMove,
    blockIndexAtOffset,
    validateImageProperties,
    // SFE-P3d-parity, Lane D — rich-mode replacements for the
    // image-properties/image-unwrap/link-edit parity-matrix waiver rows.
    locateRichImagePropertiesAtCaret,
    applyRichImagePropertiesEdit,
    applyRichImageUnwrapAtCaret,
    locateRichLinkEditAtCaret,
    applyRichLinkEditEdit,
    type RichCommandOutcome,
  } from "$lib/editor/rich-commands";
  import { diagnosticForEditRejection, type Diagnostic } from "@dimm-city/gutterpress-editor/core";
  // SFE-P3d-parity, Lane D — the SOURCE-mode counterparts of the same three
  // commands, and `findMountedSourceView`, needed to hand them a live
  // `EditorView` from outside `MarkdownEditor.svelte` — see
  // `source-editor-access.ts`'s header for why (that component is outside
  // this lane's write ownership).
  import { findMountedSourceView } from "$lib/editor/source-editor-access";
  import {
    locateImagePropertiesAtCaret,
    applyImagePropertiesEdit,
    applyImageUnwrapAtCaret,
    locateLinkEditAtCaret,
    applyLinkEditEdit,
  } from "$lib/editor/toolbar-actions";
  // SFE-P3ab review round 1 (CONFIRMED finding) — the browser-safe render
  // subpath (CLAUDE.md monorepo layout: "browser-safe public subpath:
  // gutterpress/render"), already value-imported client-side by
  // web-adapter.ts for the same reason: this is the ONE place D4 lets the
  // renderer build a D6 projection without any Node-side work.
  import { createEditorProjection } from "gutterpress/render";
  import type { GutterpressProjection } from "gutterpress/render";
  import SnippetPicker from "$lib/components/SnippetPicker.svelte";
  import { PreviewClient, type OutlineEntry, type PreviewTarget } from "$lib/preview-client";
  import { activeOutlineIndexForLine } from "$lib/routes/outline";
  import { PageNavController } from "$lib/routes/page-nav-controller.svelte";
  import { ZoomViewController } from "$lib/routes/zoom-view-controller.svelte";
  import { PreviewEventController } from "$lib/routes/preview-event-controller";
  import { EditorPreviewSyncController } from "$lib/routes/editor-preview-sync-controller";
  import { ContextMenuController } from "$lib/routes/context-menu-controller.svelte";
  import ContextMenu from "$lib/components/ContextMenu.svelte";
  import { InlineEditController } from "$lib/routes/inline-edit-controller.svelte";
  import TextPromptDialog from "$lib/components/TextPromptDialog.svelte";
  import ImagePropertiesDialog from "$lib/components/ImagePropertiesDialog.svelte";
  import type { ImagePropertiesValue } from "$lib/editor/image-classes";
  import { CommitEngine } from "$lib/editor/commit-engine";
  import { SyncController } from "$lib/routes/sync-controller.svelte";
  import { ProjectSessionController } from "$lib/routes/project-session-controller.svelte";
  import { ProjectLifecycleController } from "$lib/routes/project-lifecycle-controller.svelte";
  import { StartupController } from "$lib/routes/startup-controller.svelte";
  import { CrashRecoveryController } from "$lib/routes/crash-recovery-controller.svelte";
  import { PublishSectionController } from "$lib/routes/publish-section-controller.svelte";
  import { buildCanvasBackgroundStyles } from "$lib/iframe-styles";
  import { getPlatform, isDesktop } from "$lib/platform";
  import type { WorkspaceMode } from "$lib/platform";
  // SFE-P3e — the desktop rich editor's host-built projection call and its
  // degrade-and-report plugin-error payload shape.
  import type { EditorProjectionPluginError } from "$lib/platform";
  import { api } from "$lib/api";
  import { isEditableTarget } from "$lib/a11y";
  import { invalidateDiscoveredProjects } from "$lib/projects-discover-cache";
  import { basenameOf, joinPath, isPathAtOrUnder } from "$lib/platform/paths";
  import { shouldReconcileAfterSync } from "$lib/sync-status";
  import { onMount, tick } from "svelte";
  import {
    NARROW_BREAKPOINT,
    type MobileTab,
    paneModeForTab,
    keyboardOffset,
  } from "$lib/editor/mobile-layout";
  import { commandForSaveShortcut } from "$lib/editor/save-shortcuts";
  import { resolveGlobalShortcut, resolvePreviewNavCommand } from "$lib/routes/shortcuts";
  import { splitTemplateColumns, shouldRefitPreview } from "$lib/editor/preview-layout";
  import { useSettings, _loadSettings, settingsChangeGuard, onSettingsChange } from "$lib/settings.svelte";
  import { sanitizeSettingsTab, type SettingsTab } from "$lib/settings-tabs";
  import { clampPanelWidth, viewportWidth } from "$lib/left-panel-width";
  import LeftPanel from "$lib/components/LeftPanel.svelte";
  import type { PanelTab } from "$lib/components/LeftPanel.svelte";
  import WelcomeLanding from "$lib/components/WelcomeLanding.svelte";
  import { continueStatus, shouldReshowLanding } from "$lib/routes/startup-landing";
  import {
    friendlyFolderError,
    friendlyPdfError,
    friendlyHostError,
    friendlyPreviewError,
  } from "$lib/errors";
  import {
    PersistenceFailureNotifier,
    formatLastFlushFailureNotice,
  } from "$lib/persistence-failures";
  import { UpdateController } from "$lib/update/update-controller.svelte";
  import type {
    DiagnosticsTool,
    UrlPreviewBlockedEvent,
    PersistedProjectState,
  } from "$lib/routes/page-types";

  // L1: one writer-facing constant for the "no Electron bridge" gate — this
  // developer-jargon toast ("Electron bridge unavailable — run via the desktop
  // app") was copy-pasted verbatim 4x. Phrasing follows NewProjectWizard's
  // existing writer-appropriate copy for the same gate ("Creating a project
  // needs the desktop app.").
  const DESKTOP_APP_REQUIRED = "This needs the desktop app to continue.";
  const persistenceFailures = new PersistenceFailureNotifier();

  function reportIgnoredPersistenceFailure(): void {
    persistenceFailures.recordFailure(() => {
      if (!toast) return false;
      toast.warning("Some changes aren't being saved reliably. Use Save before closing your book.", 6000);
      return true;
    });
  }

  function trackPersistence(promise: Promise<unknown>): void {
    void promise.catch(() => reportIgnoredPersistenceFailure());
  }

  // Per-screen state
  // Session-identity / open-lifecycle state (previewUrl/currentDir/
  // currentFolderDisplayName/currentUrl/sourceMode/docTitle/busy/busyLabel/
  // rendering/renderProgressPage/renderCompleteOverlay/openError/
  // urlPreviewError/saveWarning/currentFolderHasManifest/
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
    buildPdf: (input, outPath, opts) =>
      getPlatform()
        .build({
        input,
        format: "pdf",
        out: outPath,
        // #163: opt-in per export, offered by the failure itself (see
        // ExportController.savePdf) — never a stored setting.
        allowShrink: opts?.allowShrink,
        // Validation is skipped by default (the quick Ctrl+Shift+E export and
        // the dialog's default) — it's a fast RGB export, not the full
        // preflight. The export dialog's "Run print-safety validation" toggle
        // opts back in. Lint stays ON either way — the in-process PostCSS
        // print-safety checks catch real CSS problems before PDF gen.
        skipPreValidate: !opts?.validate,
        skipPostValidate: !opts?.validate,
        })
        // Print-quality findings are only knowable once the book paginates,
        // so they arrive from the export rather than the source lint that
        // fills the panel. Held separately (see `buildProblems`) so the next
        // lint refresh — any file save — does not wipe them.
        .then((result) => {
          buildProblemEntries = buildProblems(result.diagnostics ?? []);
          return result;
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
    // `show` rather than `error`: the over-wide "Build anyway" offer (#163)
    // needs a duration and an action button, which `error()` does not take.
    toastError: (message, durationMs, action) =>
      toast?.show(message, "error", durationMs, action),
    friendlyPdfError: (e) => friendlyPdfError(e),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
  let diagnosticsTools = $state<DiagnosticsTool[] | null>(null);

  // Publishing (#35 → toolbar wizard): the same PublishSectionController that
  // used to live in ProjectConfigPanel's "crammed at the bottom" Publish
  // section now drives the front-and-centre PublishWizard opened from the
  // toolbar. Constructed here so the wizard and the toolbar button share one
  // instance. Host coupling injected (§8) — api.publish.* / api.dialog.* /
  // api.shell.*; toast/lifecycle are safe forward-referenced closures.
  const publishController = new PublishSectionController({
    projectDir: () => lifecycle.currentDir,
    listProviders: (dir) => api.publish.listProviders(dir),
    preflight: (dir, providerIds) => api.publish.preflight(dir, providerIds),
    setConfig: (dir, providerId, values) => api.publish.setConfig(dir, providerId, values),
    connect: (dir, providerId, token, account) => api.publish.connect(dir, providerId, token, account),
    disconnect: (providerId, account) => api.publish.disconnect(providerId, account),
    run: (dir, providerId, options) => api.publish.run(dir, providerId, options),
    pickPdfFile: () => api.dialog.pickPdfFile(),
    openDirectory: () => api.dialog.openDirectory(),
    openExternal: (url) => api.shell.openExternal(url),
    onSaved: () => toast?.success?.("Publish settings saved."),
    onConnected: () => toast?.success?.("Connected — the key is stored securely on this computer."),
    onPublished: (guided) =>
      toast?.success?.(guided ? "Upload package ready — follow the checklist to finish." : "Published!"),
  });
  let publishOpen = $state(false);

  // #33 Phase 4: PDF/build gating via the capabilities() seam (NOT a
  // `platform === "web"` branch). `nativeSavePath` is true on the desktop host
  // (Electron writes the PDF to a chosen path) and false on the web (no
  // puppeteer / printToPDF in the browser). When false the "Save PDF" control is
  // replaced with a short "requires the desktop app" note (acceptance criterion).
  // Desktop is UNCHANGED: nativeSavePath:true → canSavePdf:true → identical UI.
  const canSavePdf = $derived(getPlatform().capabilities().nativeSavePath);

  // ── Left panel (#workspace-restructure) ───────────────────────────────────
  // State persisted via DesktopPrefs. Keyed separately from per-project state.
  let leftPanelOpen = $state(false);
  let leftPanelTab = $state<PanelTab>("projects");
  let leftPanelWidth = $state(300);
  let leftPanelToggleBtn = $state<HTMLButtonElement | undefined>(undefined);
  // Set true once we have loaded panel state from prefs (avoids flicker).
  let leftPanelPrefsLoaded = $state(false);


  // Frame state
  let client = $state<PreviewClient | undefined>(undefined);
  let previewUpdating = $state(false);
  // Ref to the mounted PreviewFrame component so callers can reach its own
  // <iframe> element (getBoundingClientRect for context-menu positioning,
  // clientWidth for fit-width zoom) instead of `document.querySelector("iframe")`.
  let previewFrameRef = $state<{ getIframe: () => HTMLIFrameElement | undefined } | null>(null);
  // Page-navigation FSM (Phase 5): owns currentPage/totalPages/
  // restoringSavedState + the host-driven navigation intents (including the
  // toolbar page-select's selectPage).
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
    savePrefs: (patch) => saveDesktopPrefs(patch),
    savePageDirect: (page) => {
      if (lifecycle.currentDir) {
        trackPersistence(api.app.setDesktopProjectState(lifecycle.currentDir, { currentPage: page }));
      }
    },
  });
  // Preview layout FSM: owns zoom / view-mode / fit-width / split-pane-drag
  // state + the intents that drive the host preview. Host coupling (client,
  // persist sinks, DOM measurements) is injected so the component stays a thin
  // composition root.
  const zoomView = new ZoomViewController({
    client: () => client,
    zoom: () => zoom,
    isNarrow: () => isNarrow,
    persistZoom: (value) => settings.set({ preview: { defaultZoom: value } }),
    persistSplitRatio: (value) => settings.set({ preview: { splitRatio: value } }),
    saveDesktopPrefs: (patch) => saveDesktopPrefs(patch),
    measureContainerWidth: () => {
      const iframe = previewFrameRef?.getIframe();
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
  // One-way editor→preview anchor sync. Ordinary preview scrolling never moves
  // the editor; the explicit Go to source action owns that reverse direction.
  const editorSync = new EditorPreviewSyncController({
    client: () => client,
    rendering: () => lifecycle.rendering,
    syncPageAfterScroll: (page) =>
      pageNav.syncPageState({ currentPage: page, totalPages: pageNav.totalPages }),
  });
  // ── User settings (#45) ────────────────────────────────────────────────
  // bgColor and zoom are sourced from the persisted settings store (their old
  // inline defaults #5a5a5a / fit-width now live in DEFAULT_SETTINGS). Local
  // mutations write back through useSettings().set().
  // bgColor has no toolbar control (that was removed in the toolbar redesign);
  // it is set via the Settings panel only.
  const settings = useSettings();
  _loadSettings();
  let zoom = $derived(settings.current.preview.defaultZoom);
  let bgColor = $derived(settings.current.appearance.previewBg);
  // Edit/View single-pane mode for narrow viewports (persisted in settings #45).
  // Only consulted below the responsive breakpoint; above it the layout is the
  // side-by-side split regardless of this value.
  let paneMode = $derived(settings.current.preview.paneMode);
  let debug = $state(false);
  // autoOpeningLastProject/lastProjectChecked (Phase 5 slice 2, UX H5 / ARCH
  // #10) now live on `startup` (StartupController) — see its instantiation
  // below.
  let pendingRestorePage = $state<number | null>(null);

  // Toast controller (populated by Toast.svelte via bind:api)
  let toast = $state<ToastController | null>(null);
  // Operation-log desktop: opened from the StatusBar git/sync pill. Holds the
  // current project's log path (carried on the sync status stream).
  let logFilePath = $state<string | null>(null);
  // Ref to the mounted ProjectActivityView (H2) so a sync completion can ask
  // it to reload its snapshot list without a round-trip through LeftPanel's
  // retired no-op history seam (L8 / ARCH #41). Undefined whenever the
  // activity view isn't the current editor-pane view.
  let activityViewRef = $state<{ refreshHistory: () => void } | undefined>(undefined);
  // The activity view borrows the editor pane and restores the workspace it
  // displaces, avoiding an editor left open without a loaded file on close.
  let paneViewRestore: { mode: WorkspaceMode } | null = null;
  function showActivityView(): void {
    if (editorView === "editor") {
      paneViewRestore = { mode };
    }
    editorView = "activity";
    setMode("editor");
  }
  function closePaneView(): void {
    editorView = "editor";
    const restore = paneViewRestore;
    paneViewRestore = null;
    if (restore) setMode(restore.mode);
    if (editorVisible) {
      void ensureEditorFile();
      focusEditorWhenReady();
    }
  }
  function showProjectLog(filePath: string | null): void {
    logFilePath = filePath;
    showActivityView();
  }
  function closeActivityView(): void {
    closePaneView();
  }
  /**
   * Open Settings — the start screen's Settings tab, which embeds the WHOLE
   * settings surface. There is no separate settings window: one surface, one
   * way in, and closing it returns the author exactly where they were (the
   * workspace stays mounted, inert, underneath) — the same shape the help
   * button uses.
   *
   * `tab` is `unknown` on purpose: entry points are click handlers, and an
   * `onclick={onOpenSettings}` call site hands the MouseEvent in as `tab` —
   * unsanitized, that left NO tab active and an empty settings body.
   */
  function openSettings(tab: unknown = "app"): void {
    landingSettingsTab = sanitizeSettingsTab(tab);
    landingRef?.showTab("settings");
    landingForcedOpen = true;
  }
  function toggleSettings(): void {
    if (landingForcedOpen) dismissLanding();
    else openSettings();
  }
  /**
   * No author name/email yet: every version this project saves would be
   * attributed to a placeholder, so the workspace carries a persistent notice
   * with a one-click route to Settings → Accounts. It clears itself the moment
   * both fields are filled.
   *
   * Gated on `settings.loaded`: the in-memory defaults ARE empty strings, so an
   * ungated check would flash the banner on every launch in the window before
   * the persisted values arrive.
   */
  /**
   * "Not now" — session-scoped, like the adopt-a-folder banner's own dismiss.
   *
   * The check below reads the APP setting only, while the lib's
   * `resolveGitAuthor` falls back per field to the project's own
   * `.git/config` before using the placeholder. So an author whose repo
   * already carries a `user.name` / `user.email` is attributed correctly and
   * does not need this notice (Codex review, PR #134). Rather than teach the
   * renderer to resolve the effective identity — a host round-trip per
   * project, for a notice — the notice is simply dismissible: anyone it is
   * wrong for silences it, and it returns next launch in case the setting
   * still matters to them.
   */
  let identityNoticeDismissed = $state(false);
  const needsGitIdentity = $derived(
    settings.loaded &&
      !identityNoticeDismissed &&
      (!settings.current.gitIdentity.authorName.trim() ||
        !settings.current.gitIdentity.authorEmail.trim()),
  );
  /** After a successful snapshot restore (H2): reconcile the open editor
   * buffer against disk — same reconciliation the folder watcher runs for any
   * external change (see `startFolderWatch`/`onSyncFilesChanged`) — and
   * re-check for print problems, since a restore can rewrite many files. */
  function onSnapshotRestored(): void {
    void buffer?.reconcileExternalChange();
    refreshProblems();
  }
  // A loose markdown folder opens fine (no manifest = defaults), but has no
  // editable styles or version history. When the OPENED folder has no manifest,
  // offer a non-blocking "set it up as a book" affordance. Default true (on the
  // controller) so the banner stays hidden until a check proves the manifest is
  // absent.
  // NOTE: showAdoptBanner reads lifecycle.* directly (not through a closure),
  // so — like `folderName` above — it is declared AFTER
  // `lifecycle` further down, right after its instantiation.

  /** Turn an existing folder into a Gutterpress book (manifest + book.css + git),
   *  then (re)open it. Used by the successful-open no-manifest banner.
   *  Epoch/busy management moved to ProjectLifecycleController (Phase 5d). */
  function setUpAsBook(dir: string): Promise<boolean> {
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
  // New-project wizard (#25). L4: opening is exclusively via show() below —
  // there is no bindable `open` prop any more (the wizard owns that state).
  let newProjectWizardRef = $state<{ show: (t?: HTMLButtonElement) => void } | null>(null);
  // Manual force-save state for the status bar action button.
  let forceSaving = $state(false);
  // Sync-outcome routing + diagnosis state (Phase 5b). Owns the syncDiag /
  // forceSyncing runes (sync always converges — 2026-08-14). Host coupling
  // injected so the routing is
  // unit-testable and PWA-clean (§8). onSyncCompleted / onSyncFilesChanged
  // stay component methods (they touch toast + activityViewRef.refreshHistory
  // + buffer).
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
  // prefs hint) lives in the ProjectSessionController (Phase 5c). The
  // component reset()s it and fires classify(dir) on folder open, and reads
  // its rune getters. Host coupling injected (§8): the classify round-trip
  // and the DesktopPrefs writer. The remote-diagnosis refresh moved to the
  // lifecycle controller (after currentDir is assigned) — see its
  // refreshSyncDiag dep below.
  const projectSession = new ProjectSessionController({
    classifyProject: (dir) => api.app.classifyProject(dir),
    setDesktopPrefs: (prefs) => api.app.setDesktopPrefs(prefs),
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
    invalidateDiscoveredProjects: () => invalidateDiscoveredProjects(),
    projectSession,
    clearSyncDiag: () => {
      syncController.syncDiag = null;
    },
    refreshSyncDiag: (dir) => void syncController.refreshSyncDiag(dir),
    pageNav,
    zoomView,
    setSplitRatioSetting: (value) => settings.set({ preview: { splitRatio: value } }),
    setPendingRestore: (page) => {
      pendingRestorePage = page;
    },
    // Read by the controller for the RESOLVED book dir — the same key every
    // write below uses (`saveDesktopPrefs`/`setDesktopProjectState` are keyed to
    // `lifecycle.currentDir`). Callers used to fetch this themselves for the dir
    // the user PICKED, which silently missed on any retargeted open.
    getDesktopProjectState: (dir) => api.app.getDesktopProjectState(dir).catch(() => null),
    resetFirstRenderGate: () => previewEvents.resetFirstRenderGate(),
    flushBuffer: () => flushEditorBuffer(),
    resetBuffer: () => resetEditorBuffer(),
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
      buildProblemEntries = [];
      problemsLoading = false;
      problemsError = null;
      logFilePath = null;
    },
    resetExtras: () => {
      stopFolderWatch();
      pageNav.totalPages = 0;
      pageNav.currentPage = 1;
      // A project closed while its settings view was up must not show that
      // view over the next project (or the empty workspace).
      projectSettingsOpen = false;
      setMode("viewer");
      // A project closed while activity borrowed the editor must not reopen the
      // next project on that stale view.
      editorView = "editor";
      paneViewRestore = null;
      resetEditorBuffer();
      crashRecovery.reset();
      pendingRecoveryScanDir = null;
      problems = [];
      buildProblemEntries = [];
      problemsLoading = false;
      problemsError = null;
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
  // C2 (book switcher): the toolbar label shows the active book's own title by
  // default (unchanged from before repo-root sessions). In a multi-book repo the
  // book title leads and is suffixed with the repo's folder name so the author
  // sees, at a glance, that switching books (`<BookSwitcher>` below) stays within
  // the same project — book-title-first per author feedback.
  let displayTitle = $derived(
    projectSession.repoRoot && projectSession.books.length > 1
      ? `${lifecycle.docTitle || folderName} — ${basenameOf(projectSession.repoRoot)}`
      : lifecycle.docTitle || folderName,
  );

  // ── Toolbar-facing deriveds ─────────────────────────────────────────────────
  // AppToolbar is purely presentational: it receives finished booleans/strings,
  // never lifecycle objects, so its contract stays small and testable.
  let toolbarProjectOpen = $derived(!!lifecycle.currentDir && lifecycle.sourceMode === "folder");
  let exportDisabled = $derived(
    lifecycle.busy || exportController.exporting || !lifecycle.currentDir || lifecycle.sourceMode === "url",
  );
  // Why-is-Export-disabled notes (UX-023) + the web-target "desktop app" note.
  // URL mode wins over the no-folder message (currentDir is null there too,
  // and "Open a folder first" would be misleading while previewing a URL);
  // the toolbar hides hints entirely in URL mode anyway.
  let exportHints = $derived.by(() => {
    const hints: string[] = [];
    if (lifecycle.sourceMode === "url") hints.push("Not available for web previews");
    else if (!lifecycle.currentDir && !lifecycle.busy) hints.push("Open a folder first");
    if (!canSavePdf) hints.push("PDF export requires the desktop app");
    return hints;
  });

  // ── Start screen (welcome landing) ──────────────────────────────────────────
  // The in-window layer that replaced both the old splash window's "wait for the full
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
  let landingRef = $state<{
    focusLayer: () => void;
    showTab: (tab: "projects" | "settings" | "help") => void;
  } | null>(null);
  /** Sub-tab the start screen's embedded Settings opens on. */
  let landingSettingsTab = $state<SettingsTab>("app");
  // The global help and settings buttons re-open the landing (on their tab)
  // OVER an open workspace; closing it returns the author exactly where they
  // left off (the workspace stays mounted, just inert, underneath). One
  // flag for both: they are the same affordance pointed at different tabs.
  let landingForcedOpen = $state(false);

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
        landingForcedOpen ||
        shouldReshowLanding({
          busy: lifecycle.busy,
          hasPreviewUrl: !!lifecycle.previewUrl,
          hasCurrentDir: !!lifecycle.currentDir,
          hasCurrentUrl: !!lifecycle.currentUrl,
          hasUrlPreviewError: !!lifecycle.urlPreviewError,
        })),
  );

  // A workspace exists behind the layer → the landing can be closed to
  // return to it (X button + Esc). Mirrors shouldReshowLanding's "something
  // is open" arm, so a dismiss always lands somewhere real.
  const landingDismissible: boolean = $derived(
    !!lifecycle.previewUrl ||
      !!lifecycle.currentDir ||
      (!!lifecycle.currentUrl && !lifecycle.urlPreviewError),
  );

  /** Open the start screen on its Help tab (the global help affordance). */
  function openHelp() {
    landingRef?.showTab("help");
    landingForcedOpen = true;
  }

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
    landingForcedOpen = false;
    if (runPendingRecoveryScan && pending && pending === lifecycle.currentDir) {
      void crashRecovery.scan(pending);
    }
    // Focus lands back in the workspace once the inert flag has lifted.
    void tick().then(() => leftPanelToggleBtn?.focus());
  }

  // There is deliberately NO launch-time tab hijack here. A missing git
  // identity used to send the start screen to Settings → Accounts on mount,
  // which meant EVERY first run opened on account settings instead of the
  // author's books — the screen's whole job is to pick or continue a book.
  // The missing-identity nudge is the workspace banner (`needsGitIdentity`
  // above), which is where the owner put it on 2026-07-30; the landing opens
  // on Projects and stays there until the author asks for another tab.

  /**
   * The ONE open-a-project-folder pipeline behind the folder picker, the
   * Projects panel, the start screen, the GitHub dialog, and the new-project
   * wizard: leave the start screen, restore the folder's saved per-project
   * state (#43), and hand off to startFolderPreview. There is NO await before
   * startFolderPreview, so the open epoch is claimed at user-intent time (last
   * click wins, never last-fetch-resolves wins) and `lifecycle.busy` covers the
   * whole span with no dead gap. The per-project restore-state read lives in
   * the lifecycle controller, which is the only place that knows the RESOLVED
   * book dir it must be keyed to (2026-07-29 audit).
   */
  function openProjectPath(path: string, label = "Opening your book…"): Promise<boolean> {
    dismissLanding(false); // no-op when the start screen is hidden
    lifecycle.busy = true;
    lifecycle.busyLabel = label;
    return lifecycle.startFolderPreview(path, label, basenameOf(path));
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
  ): Promise<boolean> {
    if (!isDesktop()) {
      toast?.error(DESKTOP_APP_REQUIRED);
      return false;
    }
    if (folderPickerOpen) return false;
    folderPickerOpen = true;
    const { showBusyOverlay = false, label = "Opening your book…" } = options;
    if (showBusyOverlay) {
      lifecycle.busy = true;
      lifecycle.busyLabel = "Opening folder…";
    }
    let handedOff = false;
    try {
      const pathStr = await api.dialog.openDirectory().catch(() => null);
      if (!pathStr) return false; // cancelled — stay where we were
      handedOff = true;
      return await openProjectPath(pathStr, label);
    } finally {
      folderPickerOpen = false;
      if (showBusyOverlay && !handedOff) {
        lifecycle.busy = false;
        lifecycle.busyLabel = "";
      }
    }
  }

  async function browseFromLanding(): Promise<void> {
    await pickAndOpenFolder();
  }

  const RELEASE_NOTES_URL = "https://github.com/dimm-city/Gutterpress/releases";
  function openReleaseNotes() {
    api.shell.openExternal(RELEASE_NOTES_URL).catch(() => {});
  }

  function setLandingStartupPref(show: boolean) {
    landingShowPref = show;
    trackPersistence(api.app.setDesktopPrefs({ showLandingAtStartup: show }));
  }

  // ── Crash recovery (#44) ──────────────────────────────────────────────────
  // scanForRecovery/restoreRecovery/discardRecovery (Phase 5 slice 2, UX H5 /
  // ARCH #10 — moved from +page.svelte) live on CrashRecoveryController; the
  // template reads `crashRecovery.items` and calls the intent methods
  // (scan/restore/discard/dismiss). Host coupling injected (§8):
  // forward-references to page-local functions/state declared further down
  // (ensureBuffer, editorRef, mode, …) are safe closures, the same
  // pattern `lifecycle`'s deps use.
  const crashRecovery = new CrashRecoveryController({
    isDesktop: () => isDesktop(),
    crashRecoveryEnabled: () => settings.current.editor.crashRecovery,
    listRecovery: (dir) => api.recovery.list(dir),
    clearRecovery: (filePath) => api.recovery.clear(filePath),
    readRecoveryFile: (path) => api.fs.readFile(path),
    restoreIntoBuffer: (filePath, content) => restoreRecoveredFile(filePath, content),
    showEditor: () => {
      editorView = "editor";
      paneViewRestore = null;
      openEditorPane({ ensureFile: false });
      if (isNarrow && paneMode !== "edit") setPaneMode("edit");
    },
    toast: () => toast,
    friendlyHostError: (message) => friendlyHostError(message),
  });

  function onSyncFilesChanged() {
    void buffer?.reconcileExternalChange();
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
    else openSettings("connections");
  }

  // Completes the D7 Reconnect journey: a connect dialog closing may mean a
  // new credential was just stored — re-check syncability so the Sync
  // button and the dialog's auth state reflect it without a project reload.
  // Called by onClosed on GitHubDialog.
  function onConnectDialogClosed() {
    if (lifecycle.currentDir && lifecycle.sourceMode === "folder") {
      void syncController.refreshSyncDiag(lifecycle.currentDir);
    }
    // Opened from the start screen and closed without opening anything: the
    // dialog's own triggerEl focus restore targets the inert workspace, so
    // reclaim focus for the landing (keeps its Esc handling alive).
    if (landingVisible) landingRef?.focusLayer();
  }

  // ── Converge-report subscription ────────────────────────────────────────────
  // Subscribe to the host's sync:status channel for the converge report —
  // combined-with-markers files and side-by-side pairs each get a review
  // toast. Per §8 / ADR 0004: runs in the SPA, no lib value imports, all host
  // work through getPlatform().
  onMount(() => {
    if (!isDesktop()) return;
    const off = getPlatform().onSyncStatus((status) => {
      // Scope to the currently open project.
      if (status.projectDir !== lifecycle.currentDir) return;
      if (shouldReconcileAfterSync(status)) {
        onSyncFilesChanged();
      }
      syncController.applyConvergeReport(status.combinedFiles, status.keptBothFiles);
    });
    return () => off?.();
  });

  // Official setup guide for first-time writers (MVP "Download starter template").
  const SETUP_GUIDE_URL =
    "https://github.com/dimm-city/gutterpress/blob/main/examples/gutterpress-user-guide/01-getting-started.md";

  function openSetupGuide() {
    api.shell.openExternal(SETUP_GUIDE_URL).catch(() => {});
  }

  // ── In-app markdown editor (#38) + unsaved-changes (#44) ──────────────────
  // The workspace mode decides whether the file-tree + editor split shows.
  // EditorBuffer (#44) is the single owner of ONE FILE's edit lifecycle: path,
  // in-memory content, the dirty/save state machine, the debounced disk write
  // (which the preview file-watcher picks up to re-render), debounced
  // crash-recovery snapshots, the close/navigate flush, and external-edit
  // reconciliation. The editor owns exactly one file buffer at a time.
  // The ONE workspace-layout switch (see `WorkspaceMode`). Declared here
  // (before the deriveds that read it) so it is initialised ahead of them.
  // A local $state rather than a settings derived, because `focus` is
  // deliberately absent from the persisted shape — `setMode` writes the
  // durable half through and `modeSink` below reads it back on load.
  let mode = $state<WorkspaceMode>(settings.current.preview.mode);
  // The one genuinely ambiguous transition: leaving `focus` could mean either
  // `editor` or `viewer`. Written ONLY on entering focus.
  let modeBeforeFocus: "editor" | "viewer" | null = null;
  /** The viewer is hidden in `focus` and nowhere else. */
  let previewVisible = $derived(mode !== "focus");
  /** `focus` is the editor without the viewer, so the editor shows in both. */
  let editorVisible = $derived(mode !== "viewer");
  let workspaceEl = $state<HTMLElement | undefined>(undefined);
  let editorRef = $state<{
    focus: () => void;
    revealLine: (line: number, focusEditor?: boolean) => void;
    runToolbarAction: (action: ToolbarAction, payload?: ToolbarPayload) => void;
    getSelectionText: () => string;
    insertSnippet: (text: string) => void;
    updateContent: (content: string) => void;
    /** Switch which file is open (UX review M8) — called explicitly whenever
     * the buffer's open file changes; MarkdownEditor has no reactive effect
     * of its own (this repo bans `$effect`). */
    switchFile: (path: string | null, content: string) => void;
    /** Whether the live document is this file
     * (inline-editing plan §4.7 Step 4 — commit-engine.ts). */
    hasFile: (path: string) => boolean;
    /** Apply a `[from, to)` character-range edit to one file as a single
     * undoable transaction (inline-editing plan §4.7 Step 4 — commit-engine.ts).
     * Offsets are into THAT FILE, not into the document. */
    applyRangeEditIn: (path: string, from: number, to: number, insert: string) => void;
  } | null>(null);
  /** The DOM node wrapping the mounted `MarkdownEditor` (SFE-P3d-parity,
   *  Lane D) — see that binding's own template comment and
   *  `source-editor-access.ts`'s header for why this reads the live caret
   *  via CodeMirror's `EditorView.findFromDOM` instead of a new
   *  `MarkdownEditor.svelte` export. */
  let sourceEditorHostEl = $state<HTMLDivElement | undefined>(undefined);

  // Snippet picker (#29) — opened via the toolbar button or Ctrl/Cmd+Shift+S.
  let snippetPickerRef = $state<{ show: (t?: HTMLButtonElement) => void } | null>(null);
  let snippetPickerOpen = $state(false);

  // SFE-P3ab, Lane A — the rich-mode document identity + caret at the
  // moment the snippet picker opened, captured BEFORE the picker's own UI
  // steals focus (same rationale as `openRichImageProperties`'s `capture`
  // below: reading it from inside `onInsert`, after the picker has had
  // focus, would see whatever — if anything — the mount still reports once
  // focus has moved away, not the position the author actually meant when
  // they invoked the picker). SFE-P3ab review round 1 (CONFIRMED finding):
  // a plain selection offset with no document identity attached was
  // silently re-applied even after an external reload replaced the
  // document underneath the open dialog — `RichSelectionCapture` (defined
  // with `captureRichSelection` below) pairs the offsets with the exact
  // host + version they were read against, so `onInsert` (near the bottom
  // of this file) can detect that and refuse instead of splicing into the
  // wrong document. `undefined` in source mode or with no rich document
  // open at all.
  let richSnippetCapture: RichSelectionCapture | undefined;

  function openSnippetPicker() {
    if (!isDesktop() || !lifecycle.currentDir) return;
    contextMenu.close();
    void inlineEdit.endActive(true); // opening a dialog commits the in-flow edit
    richSnippetCapture = captureRichSelection();
    snippetPickerRef?.show();
  }

  // ── Project settings view (#PCV → full window) ─────────────────────────────
  // Project settings live in a full-window view patterned after the app
  // SettingsView (they used to be a left-sidebar Config tab); activity is the
  // only alternate editor-pane view.
  let editorView = $state<"editor" | "activity">("editor");
  let projectSettingsOpen = $state(false);

  /**
   * One button → the whole project settings view (manifest details, look &
   * style, plugins). Full-window like the app settings; the workspace behind
   * it goes inert and returns untouched on close.
   */
  function openProjectConfig(): void {
    if (!lifecycle.currentDir || lifecycle.sourceMode !== "folder") return;
    if (!isDesktop()) {
      toast?.info?.("Project configuration is available in the desktop app for now.");
      return;
    }
    contextMenu.close();
    void inlineEdit.endActive(true); // opening a dialog commits the in-flow edit
    projectSettingsOpen = true;
  }

  function closeProjectSettings(): void {
    projectSettingsOpen = false;
  }

  /**
   * Open one stylesheet (absolute path) in the shared editor and reveal it.
   * Used as the "Edit raw CSS" escape hatch from the Config view's Design
   * section AND from its Styles section's per-row "Edit" button — both routes
   * flip `editorView` back to "editor" so the author lands on the file.
   */
  async function openStyleFile(absPath: string): Promise<void> {
    if (!(await selectEditorFile(absPath))) return;
    editorView = "editor";
    paneViewRestore = null;
    if (mode === "viewer") setMode("editor");
    // Narrow single-pane layout keys editor visibility off paneMode, not
    // the workspace mode — switch panes too, or the loaded stylesheet stays hidden
    // behind the preview with no way to reveal it (the Markdown tab would
    // swap the file away first).
    if (isNarrow && paneMode !== "edit") setPaneMode("edit");
    loadEditorModule();
    focusEditorWhenReady();
  }

  // "Save as template" (#29) now lives in the ExportDialog (Template format).
  let exportOpen = $state(false);
  let exportBtnEl = $state<HTMLButtonElement | undefined>(undefined);

  // True below the single-pane breakpoint. Assigned by the matchMedia
  // subscription further down; declared here so the derived below can read it.
  let isNarrow = $state(false);

  // Reading gets two pages side by side; editing gets one page beside the
  // editor. `isNarrow` is a CLAMP on that, not a competing decider — there is
  // no room for a second page below the breakpoint.
  let viewMode = $derived<"single" | "two-column">(
    mode === "viewer" && !isNarrow ? "two-column" : "single",
  );

  // Whether the editor pane is shown. A persisted narrow Edit preference
  // alone never opens it.
  let editorPaneOpen = $derived(
    editorView === "activity" ||
      (!!lifecycle.currentDir &&
        lifecycle.sourceMode === "folder" &&
        editorVisible &&
        (!isNarrow || paneMode === "edit")),
  );
  // ── Global find (Ctrl+F) — VIEWER only (owner ruling 2026-08-15) ──────────
  // The FindBar drives the native window find over the preview (the only way
  // to search the cross-origin frame). Editing a found word goes through the
  // preview's "Go to source"; the editor has no search surface of its own.
  let findBarOpen = $state(false);
  let findBarRef = $state<{ focusInput: () => void } | null>(null);
  const viewerVisibleForFind = $derived(
    !!lifecycle.previewUrl &&
      previewVisible &&
      !(isNarrow && (editorPaneOpen || editorView !== "editor")),
  );

  let splitGridColumns = $derived(
    editorPaneOpen && !isNarrow && previewVisible
      ? splitTemplateColumns(zoomView.splitPaneRatio)
      : "",
  );
  let previewCollapseGridColumns = $derived(
    editorPaneOpen && !isNarrow && !previewVisible
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
    if (!editorVisible || !lifecycle.currentDir || MarkdownEditor || editorModuleLoading || editorModuleFailed) return;
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

  // ── Rich mode (SFE-P3ab, Lane A) ────────────────────────────────────────
  // An ADDITIONAL editing surface layered over the SAME EditorBuffer session
  // MarkdownEditor above already drives — see rich-mode.svelte.ts's header
  // for the mode-selection / exactly-one-mounted-surface contract this
  // wiring proves, and desktop-document-host.ts's header for why rich mode
  // mounts against a `DesktopDocumentHost`, not the buffer directly.
  const richMode = createRichModeController();

  /**
   * Whether `path` is a Markdown source the rich surface can mount against
   * — the ONLY file type it supports (D2: "source mode remains available
   * for every document"; the plan's own out-of-scope note keeps CSS/YAML/
   * JS/plugin/manifest editing CodeMirror-only). SFE-P3ab review round 1
   * (CONFIRMED finding): `showEditorContent`/`setRichMode` used to rebuild
   * `richDocHost` — and the template used to mount the rich surface — for
   * ANY open file while `richMode.mode === "rich"`, so a CSS file clicked
   * from the tree opened silently inside the Markdown rich surface with no
   * visible way back (the toolbar's mode toggle only renders for markdown
   * files). Hoisted so every gate below (`showEditorContent`, `setRichMode`,
   * `insertImageIntoChapter`, `richSurfaceActive`) shares one definition.
   */
  function isMarkdownPath(path: string | null): boolean {
    return !!path && /\.(md|markdown)$/i.test(path);
  }

  // Hidden/experimental gate (run spec: "off by default this run"). No new
  // settings subsystem — a `localStorage` flag flipped by hand, read once on
  // mount (client-only). With the flag unset (the overwhelming common case)
  // `richModeAvailable` stays false and nothing below this comment ever
  // runs: the CodeMirror path loads exactly what it does today.
  let richModeAvailable = $state(false);
  onMount(() => {
    try {
      richModeAvailable = localStorage.getItem("gp:experimental-rich-editor") === "1";
    } catch {
      // Storage unavailable (privacy mode, disabled site data, …) — stay off.
    }
  });

  // Mirrors the MarkdownEditor lazy-import pattern immediately above: the
  // rich editor's chunk (the `@vscode/markdown-editor` fork + its adapter)
  // is real weight, so it is imported dynamically the first time rich mode
  // is actually entered, never at page load.
  let RichEditorComponent = $state<
    typeof import("$lib/components/RichEditor.svelte")["default"] | null
  >(null);
  let richEditorModuleLoading = $state(false);
  let richEditorModuleFailed = $state(false);

  function loadRichEditorModule() {
    if (RichEditorComponent || richEditorModuleLoading || richEditorModuleFailed) return;
    richEditorModuleLoading = true;
    import("$lib/components/RichEditor.svelte")
      .then((m) => {
        RichEditorComponent = m.default;
      })
      .catch((e) => {
        richEditorModuleFailed = true;
        toast?.error(
          `Could not open the rich editor: ${e instanceof Error ? e.message : String(e)}`,
        );
      })
      .finally(() => {
        richEditorModuleLoading = false;
      });
  }

  function retryRichEditorLoad() {
    richEditorModuleFailed = false;
    loadRichEditorModule();
  }

  // The `EditorDocumentHost` (D3/D7) rich mode mounts against. NOT
  // live-patched across a file switch or an external replacement — rebuilt
  // fresh from the buffer's CURRENT content instead (D7: "File switches and
  // external full replacements are not undoable into the prior file", so a
  // fresh host/undo-stack is the spec-sanctioned response). `{#key
  // richDocHost}` below turns each rebuild into a fresh RichEditor
  // mount/dispose cycle — a real new undo epoch, not a simulated one.
  //
  // This also sidesteps a forwarding-loop hazard entirely: because a
  // snapshot is never pushed back into an already-mounted host from
  // outside, `subscribe` below can safely assume every snapshot it
  // observes originated from THIS host's own mounted adapter (a real user
  // edit), and forwards it straight into the SAME `onEditorChange` call
  // MarkdownEditor's `onChange` already makes — one implementation of
  // "a rich-mode edit reached the shared session", not a second copy.
  let richDocHost = $state<DesktopDocumentHost | null>(null);
  let richDocHostUnsub: (() => void) | null = null;

  /**
   * The D6 sparse projection for `richDocHost`'s document — built once per
   * `{#key richDocHost}` mount cycle, in lockstep with `richDocHost` itself
   * (`rebuildRichDocHost`/`disposeRichDocHost` below), never live-refreshed
   * on every keystroke: `mountGutterpressEditor`'s own contract
   * (`needsRefresh()`'s doc comment, `@dimm-city/gutterpress-editor/
   * gutterpress`) is explicit that a stale projection is "the caller's cue
   * to build a fresh projection and remount, not a live-updating property"
   * — chips fall through to the plain view once the host's version moves
   * past `sourceVersion`, which is graceful, not broken. `null` exactly
   * when `richDocHost` is `null`.
   *
   * SFE-P3ab review round 1 (CONFIRMED finding): this page never built a
   * projection at all, so `RichEditor.svelte` always mounted the plain
   * standard-Markdown surface (`mountEditor`) and `mountGutterpressEditor`
   * — the whole point of P2b/P2c's projection work — was dead code. With a
   * desktop project open, SFE-P3e replaced that local build with the
   * host-side, plugin-aware one (`buildRichProjection` below) — a
   * project's OWN plugin regions render as real chips there, loaded by the
   * real manifest/plugin pipeline. With no project open (a plain file),
   * this stays the local, plugin-less `gutterpress/render` build (D4):
   * every CORE marker/raw-html/generated-view block is still projected, but
   * there are no plugin regions to render either way.
   */
  let richProjection = $state<GutterpressProjection | null>(null);

  /**
   * SFE-P3e — plugin CSS from the host-built projection (electron/editor-
   * projection.ts's `pluginCss`), wired into `RichEditorComponent`'s
   * `extraCss` prop below. `undefined` on the local (no-project) path,
   * matching `richProjection`'s own null-when-absent style. Built in
   * lockstep with `richProjection` — see `rebuildRichDocHost` below.
   */
  let richPluginCss = $state<string | undefined>(undefined);

  /**
   * SFE-P3e — the root-cause fix the run's product-owner ruling names
   * directly: with a desktop project open, the projection is built HOST-SIDE
   * (real manifest, real loaded plugins, `trusted: true`) via
   * `getPlatform().buildEditorProjection` — the `api:editorProjection` IPC
   * call (`electron/editor-projection.ts`). With no project open (a plain
   * file), the existing local, plugin-less
   * `createEditorProjection(content, { sourceVersion })` path is UNCHANGED —
   * D10's "one renderer path": no third path, no cache layer, no speculative
   * invalidation.
   *
   * The host call is async, so `rebuildRichDocHost` below does NOT publish
   * `richDocHost` (or `richProjection`/`richPluginCss`) until this resolves
   * — SFE-P3e review round 1 (CONFIRMED finding): the first cut published
   * `richDocHost` synchronously and patched in the projection later, but
   * Svelte flushes that synchronous assignment (and the template's `{#key
   * richDocHost}` mount it drives) in a microtask, well before this IPC
   * round trip can return — so the mount always ran on a null projection
   * and took the plain `mountEditor` branch, and `RichEditor.svelte`
   * deliberately has no watcher to correct that later ($effect is banned;
   * it reads `projection` once in `onMount`), so nothing ever remounted it.
   * Publishing all three together, only once resolved, is what actually
   * reaches `mountGutterpressEditor`; the existing "Loading rich editor…"
   * branch (already there for the module-load race) covers the brief gap
   * for free. Guarded by a rebuild epoch (G-11), not host identity — see
   * `rebuildRichDocHost`'s own comment.
   *
   * Each `pluginErrors` entry (a plugin that failed to load, degrade-and-
   * report — never fatal to the projection as a whole) is surfaced through
   * the SAME `onDiagnostic` path every other rich-mode diagnostic in this
   * file uses (`showRichDiagnostic`), as `EDITOR_PLUGIN_LOAD_FAILED`.
   */

  /** D14 `EDITOR_FILE_TOO_LARGE` for the HOST projection call specifically —
   *  paired with the `.code` `electron/main.ts`'s `validateEditorProjectionArgs`
   *  sets on the error it throws once `content` exceeds D13's 2 MiB
   *  rich-mode ceiling. SFE-P3e review round 1 (CONFIRMED finding): this
   *  rejection used to fall into `buildRichProjection`'s catch below and
   *  vanish into a `console.warn` only — the ceiling existed but had no
   *  user-visible effect. Unlike {@link RICH_MODE_PROJECTION_FAILED_DIAGNOSTIC}
   *  below, switching to source mode IS a real fix here (the document keeps
   *  editing, just without the rich surface), so this gets the `safeAction`
   *  `showRichDiagnostic`'s existing toast-with-action pattern turns into a
   *  working "switch to source mode" button. */
  const RICH_MODE_FILE_TOO_LARGE_DIAGNOSTIC: Diagnostic = {
    category: "EDITOR_FILE_TOO_LARGE",
    message: "This file is too large for the rich editor. Switch to source mode to keep editing it.",
    safeAction: "Switch to source mode",
  };

  /** D14 `EDITOR_PLUGIN_LOAD_FAILED` for the HOST projection call failing
   *  OUTRIGHT — the manifest itself could not be read/resolved. Distinct
   *  from the PER-PLUGIN `pluginLoadFailedDiagnostic` below, which never
   *  reaches this catch (a per-plugin degrade never throws). SFE-P3e review
   *  round 1 (CONFIRMED finding): this used to vanish into a `console.warn`
   *  only, same as the file-too-large case above. No `safeAction`: the rest
   *  of the document already fell back to the local, plugin-less
   *  projection below (still fully editable), and switching to source mode
   *  would not fix a broken manifest — a heads-up notice, not an action
   *  prompt, matching `pluginLoadFailedDiagnostic`'s own reasoning. */
  const RICH_MODE_PROJECTION_FAILED_DIAGNOSTIC: Diagnostic = {
    category: "EDITOR_PLUGIN_LOAD_FAILED",
    message:
      "This project's plugins could not be loaded for the rich editor (its manifest.yaml may be invalid), so plugin regions show as plain text here. Fix the manifest, then reopen this file.",
  };

  async function buildRichProjection(
    content: string,
    sourceVersion: number,
  ): Promise<{ projection: GutterpressProjection; pluginCss: string | undefined }> {
    if (isDesktop() && lifecycle.currentDir) {
      try {
        const result = await getPlatform().buildEditorProjection({
          projectDir: lifecycle.currentDir,
          content,
          sourceVersion,
        });
        for (const pluginError of result.pluginErrors) {
          showRichDiagnostic(pluginLoadFailedDiagnostic(pluginError));
        }
        return { projection: result.projection, pluginCss: result.pluginCss || undefined };
      } catch (e) {
        // The host call itself failed outright (e.g. a malformed
        // manifest.yaml, or content over D13's rich-mode ceiling) — never a
        // per-plugin degrade, which never throws (see result.pluginErrors
        // above). SFE-P3e review round 1 (CONFIRMED finding): this used to
        // vanish into a console.warn only, so neither failure had any
        // user-visible effect and D13's ceiling had nothing to reuse.
        // Classified by the boundary error's stable `code` (set in
        // electron/main.ts's validateEditorProjectionArgs and its
        // api:editorProjection handler) so this branches on data, not on
        // English prose (D14: "generic 'failed' errors at a boundary are a
        // confirmed review finding unless no more specific classification
        // is possible"). Either classification still falls through to the
        // same local, plugin-less build the no-project path already uses
        // below, so the document stays fully editable rather than getting
        // stuck with no projection at all (D14: unsupported rich behavior
        // falls back, it never blanks the document) — the diagnostic is
        // purely the "state the safe next action" half D14 also requires.
        const code = (e as { code?: string } | null | undefined)?.code;
        if (code === "EDITOR_FILE_TOO_LARGE") {
          showRichDiagnostic(RICH_MODE_FILE_TOO_LARGE_DIAGNOSTIC);
        } else if (code === "EDITOR_PLUGIN_LOAD_FAILED") {
          showRichDiagnostic(RICH_MODE_PROJECTION_FAILED_DIAGNOSTIC);
        } else {
          console.warn("buildEditorProjection failed; falling back to the local projection:", e);
        }
      }
    }
    return { projection: createEditorProjection(content, { sourceVersion }), pluginCss: undefined };
  }

  // SFE-P3ab, Lane A — the mounted RichEditor component instance, bound the
  // same way `editorRef` binds MarkdownEditor above: `{#key richDocHost}`
  // means a host rebuild destroys and recreates RichEditorComponent, so
  // Svelte resets this to `null` on unmount and repopulates it on the next
  // mount — no manual bookkeeping needed here. Read ONLY for its
  // `getSelection()` export (rich-commands.ts's header has the full design);
  // this page never calls any other method on it.
  let richEditorRef = $state<{
    getSelection: () => { readonly from: number; readonly to: number } | undefined;
  } | null>(null);

  /** The rich mount's LIVE caret, or `undefined` when there is none. SFE-P3ab
   *  review round 1 (CONFIRMED finding): `undefined` does NOT mean "never
   *  focused" — the fork's own selection observable goes empty again after
   *  real interaction too (e.g. clicking the mount's own left gutter), so
   *  this must be treated as "no caret AT THIS INSTANT", never as proof the
   *  surface was never touched (see `rich-commands.ts`'s header for the full
   *  verified reproduction). Every rich-mode command below reads this fresh
   *  at the moment it fires rather than caching it. */
  function richLiveSelection(): { readonly from: number; readonly to: number } | undefined {
    return richEditorRef?.getSelection();
  }

  /** A rich-mode selection paired with the document IDENTITY it was read
   *  against — SFE-P3ab review round 1 (CONFIRMED finding): a caller that
   *  captures `richLiveSelection()` and then `await`s something (a dialog)
   *  before applying an edit must be able to tell whether the document
   *  changed underneath it (an external reload landed, rebuilding
   *  `richDocHost` at a fresh version 0 with different text) — a captured
   *  offset with no identity attached was silently re-applied to whatever
   *  document happened to be live when the dialog resolved. */
  interface RichSelectionCapture {
    readonly host: DesktopDocumentHost;
    readonly version: number;
    readonly selection: { readonly from: number; readonly to: number } | undefined;
  }

  /** Captures {@link richLiveSelection} together with `richDocHost` and its
   *  CURRENT version. `undefined` when there is no rich document open at
   *  all (no host to capture identity from). */
  function captureRichSelection(): RichSelectionCapture | undefined {
    if (!richDocHost) return undefined;
    return { host: richDocHost, version: richDocHost.getSnapshot().version, selection: richLiveSelection() };
  }

  /** Whether `capture` (from {@link captureRichSelection}) is still valid
   *  against the CURRENT `richDocHost` — false once the document identity
   *  was replaced (a rebuild) or any edit landed since capture, either of
   *  which makes the captured offsets meaningless (see that function's own
   *  header). */
  function isRichSelectionCaptureFresh(capture: RichSelectionCapture): boolean {
    return richDocHost === capture.host && richDocHost.getSnapshot().version === capture.version;
  }

  /** D14 diagnostic for a caret-relative rich command invoked with NO live
   *  caret at all — the "stop failing open" half of the same review finding
   *  above: a toolbar click or keyboard shortcut is an explicit, caret-
   *  relative user gesture, so silently reusing `documentEndSelection` when
   *  there happens to be no caret right now (one stray gutter click since
   *  the last keystroke) would format or insert text somewhere the author
   *  never asked for. `documentEndSelection` remains the correct, DOCUMENTED
   *  fallback only for a genuinely anchorless gesture (image insertion via
   *  drag-and-drop, or before the surface has ever been focused) — see
   *  `openRichImageProperties`/`insertImageIntoChapter` below, which do NOT
   *  use this diagnostic. */
  const NO_LIVE_CARET_DIAGNOSTIC: Diagnostic = {
    category: "EDITOR_INVALID_RANGE",
    message: "Place the cursor in the document, then try that again.",
  };

  /**
   * Bumped on every rebuild/dispose so an in-flight `buildRichProjection`
   * result can tell whether it is still wanted — SFE-P3e review round 1
   * (CONFIRMED finding): the prior guard compared `richDocHost !== nextHost`,
   * which only worked because `richDocHost` was assigned `nextHost`
   * SYNCHRONOUSLY; now that publishing is deferred until the projection is
   * in hand (below), there is no published value yet to compare against, so
   * an explicit epoch takes its place (G-11: "every async ... result must
   * carry enough identity to reject stale responses"). Not `$state` — never
   * read by the template, only by the guard checks below. */
  let richDocHostEpoch = 0;

  function rebuildRichDocHost(path: string | null, content: string): void {
    richDocHostUnsub?.();
    richDocHostUnsub = null;
    richDocHostEpoch += 1;
    const epoch = richDocHostEpoch;
    if (!path) {
      richDocHost = null;
      richProjection = null;
      richPluginCss = undefined;
      return;
    }
    const nextHost = new DesktopDocumentHost(content, { documentId: path });
    richDocHostUnsub = nextHost.subscribe((snapshot) => onEditorChange(snapshot.text));
    // SFE-P3e review round 1 (CONFIRMED finding): do NOT publish
    // `richDocHost` until its projection is in hand. The prior code assigned
    // `richDocHost = nextHost` here, synchronously, then patched in
    // `richProjection`/`richPluginCss` once the host round trip resolved —
    // but Svelte flushes that synchronous assignment (and the template's
    // `{#key richDocHost}` mount it drives) in a microtask, well before the
    // IPC round trip can return, so the mount always ran on a null
    // projection and took the plain `mountEditor` branch. `RichEditor.svelte`
    // deliberately has no watcher to correct that later ($effect is banned;
    // it reads `projection` once in `onMount`), so nothing ever remounted
    // it — every later assignment of richProjection/richPluginCss was dead
    // state. Publishing all three together, only once the projection
    // resolves, is what actually reaches `mountGutterpressEditor`. The
    // template's existing "Loading rich editor…" branch (already there for
    // the module-load race) covers the brief gap for free — no new UI state
    // needed. Guarded by the epoch above, not host identity, since there is
    // no published `richDocHost` yet to compare against; `disposeRichDocHost`
    // also bumps it, so a rebuild superseded by leaving rich mode entirely
    // is discarded too, not just one superseded by a later rebuild.
    void buildRichProjection(content, nextHost.getSnapshot().version).then((result) => {
      if (epoch !== richDocHostEpoch) return;
      richProjection = result.projection;
      richPluginCss = result.pluginCss;
      richDocHost = nextHost;
    });
  }

  function disposeRichDocHost(): void {
    richDocHostUnsub?.();
    richDocHostUnsub = null;
    richDocHostEpoch += 1;
    richDocHost = null;
    richProjection = null;
    richPluginCss = undefined;
  }

  /** The one place rich mode is entered/exited (today: the hidden keyboard
   * shortcut below; a visible toggle is chrome for another lane to add).
   * Keeps `richDocHost` in lockstep with `richMode.mode` so it is never
   * stale while `"rich"` is selected, and never lingers once it is not.
   * SFE-P3ab review round 1 (CONFIRMED finding): only builds the host for a
   * MARKDOWN file (`isMarkdownPath`) — rich mode has no surface for
   * anything else (D2). `richMode.mode` itself is still recorded as the
   * user's PREFERENCE even when the current file can't use it, so returning
   * to a markdown file resumes rich mode automatically. */
  function setRichMode(next: "source" | "rich"): void {
    if (next === richMode.mode) return;
    if (next === "rich") {
      loadRichEditorModule();
      if (isMarkdownPath(editorFilePath)) {
        rebuildRichDocHost(editorFilePath, editorContent);
      } else if (editorFilePath) {
        showRichDiagnostic(RICH_MODE_MARKDOWN_ONLY_DIAGNOSTIC);
      }
    }
    richMode.switchTo(next);
    if (next === "source") {
      disposeRichDocHost();
    }
  }

  // ── Rich-mode command wiring (SFE-P3ab, Lane B) ──────────────────────────
  //
  // Diagnostics reaching this app from rich mode come from two places: an
  // edit THIS page pushes through `richDocHost.applyEdit` directly (a
  // rejected/refused `RichCommandOutcome` from `rich-commands.ts`), and one
  // the mounted adapter reports on its own via `RichEditor`'s `onDiagnostic`
  // prop below (a typed rejection from the live view, or a P2c projection
  // diagnostic surfaced at mount time). Both funnel through this one
  // function so they render identically (deliverable 5: "surface them ...
  // with their safeAction text") — reusing the existing toast/action-button
  // pattern (`ExportController`'s "Build anyway" offer above is the other
  // toast-with-action precedent in this file) rather than inventing a new
  // banner. The action button's label is the diagnostic's OWN `safeAction`
  // text verbatim; its handler always switches to source mode — the one
  // concrete, always-available recovery this app can offer today regardless
  // of which D14 category produced the diagnostic (deliverable "Source
  // reveal": "An explicit 'edit in source' path from rich mode for any
  // unsupported/refused region").
  function showRichDiagnostic(diagnostic: Diagnostic): void {
    toast?.show(
      diagnostic.message,
      "error",
      undefined,
      diagnostic.safeAction
        ? { label: diagnostic.safeAction, onClick: () => setRichMode("source") }
        : undefined,
    );
  }

  /**
   * SFE-P3e — D14 `EDITOR_PLUGIN_LOAD_FAILED` for one project plugin
   * `buildEditorProjection` reported as failed to load. Wording mirrors the
   * desktop Plugins panel's own "Needs install" vs generic-error distinction
   * (`$lib/components/config/config-helpers.ts`'s `pluginStatus`), adapted
   * for the rich editor: there is no "Install npm plugin below"/"Re-check"
   * affordance HERE, so the message points the author at the Plugins panel
   * by name instead. No `safeAction` — unlike the projection/edit-rejection
   * diagnostics above, switching to source mode fixes nothing here (the rest
   * of the document already rendered fine; only this one plugin's regions
   * show as plain text), so the toast is a heads-up notice, not an action
   * prompt.
   */
  function pluginLoadFailedDiagnostic(error: EditorProjectionPluginError): Diagnostic {
    const needsInstall =
      /\bnot found\b/i.test(error.message) || /vendored plugin .*\bis missing\b/i.test(error.message);
    return {
      category: "EDITOR_PLUGIN_LOAD_FAILED",
      message: needsInstall
        ? `The plugin "${error.pluginRef}" isn't installed, so its content shows as plain text here instead of a formatted region. Install it from the Plugins panel, then reopen this file.`
        : `The plugin "${error.pluginRef}" couldn't load, so its content shows as plain text here instead of a formatted region. Check it in the Plugins panel, then reopen this file.`,
    };
  }

  function reportRichOutcome(outcome: RichCommandOutcome): void {
    if (!outcome.ok) showRichDiagnostic(outcome.diagnostic);
  }

  /** SFE-P3ab review round 1 (CONFIRMED finding) — shown whenever rich mode
   *  is explicitly entered (or a file switch lands) while the open file
   *  isn't markdown; see `isMarkdownPath`'s header. No `safeAction`: the
   *  source surface is already what's showing, there is nothing further for
   *  the author to do. */
  const RICH_MODE_MARKDOWN_ONLY_DIAGNOSTIC: Diagnostic = {
    category: "EDITOR_UNSUPPORTED_PROJECTION",
    message: "Rich mode supports Markdown files only. This file opened in the source editor.",
  };

  /**
   * Routes one `EditorToolbar` action through the RICH path — the mirror of
   * `editorRef?.runToolbarAction(action, payload)` for source mode. Called
   * only while `richMode.mode === "rich"`; "image" is excluded (handled by
   * `openRichImageProperties` below via the `ImagePropertiesDialog` flow,
   * not a plain `EditorCommand`).
   *
   * SFE-P3ab review round 1 (CONFIRMED finding): refuses when there is no
   * LIVE caret rather than letting `applyRichCommand`/`applyRichLayoutBlock`
   * silently fall back to the document end — a toolbar click is an
   * explicit, caret-relative gesture (`NO_LIVE_CARET_DIAGNOSTIC`'s header
   * has the full rationale, including why image insertion is exempt).
   */
  function handleRichToolbarAction(action: ToolbarAction, payload?: ToolbarPayload): void {
    if (!richDocHost || action === "image") return;
    const route = routeToolbarAction(action, payload);
    const live = richLiveSelection();
    if (!live) {
      showRichDiagnostic(NO_LIVE_CARET_DIAGNOSTIC);
      return;
    }
    if (route.kind === "command") {
      reportRichOutcome(applyRichCommand(richDocHost, route.command, live));
    } else if (route.kind === "layout") {
      reportRichOutcome(applyRichLayoutBlock(richDocHost, route.layout, live));
    }
    // "unsupported" ("snippet"/"focus-mode") never reaches here — the
    // toolbar's onAction below special-cases both before routing.
  }

  /**
   * "Insert image" while rich mode is active (G-10/AP-17): opens the SAME
   * `ImagePropertiesDialog` the preview context menu's "Set properties…"
   * uses, seeded blank (a brand-new image has no existing token set to
   * seed from), and applies the confirmed value at the document end.
   *
   * SFE-P3ab review round 1 (CONFIRMED finding): the selection is captured
   * TOGETHER with the document identity it was read against
   * (`captureRichSelection`) — the dialog's `await` gives an external
   * reload (or a file switch) time to rebuild `richDocHost` entirely, and a
   * captured offset with no identity attached used to be silently applied
   * to whatever document happened to be live once the dialog resolved. A
   * missing LIVE CARET at capture time is left to `applyRichImageInsert`'s
   * own `documentEndSelection` fallback — image insertion is reachable via
   * drag-and-drop, a genuinely anchorless gesture (`insertImageIntoChapter`
   * below), so this toolbar path stays consistent with that one behavior
   * rather than refusing only when invoked from the toolbar.
   */
  async function openRichImageProperties(): Promise<void> {
    // Captured BEFORE the dialog opens and steals focus — the dialog is a
    // separate surface, so the caret the author actually meant is whatever
    // it was the moment they invoked "Insert image", not whatever (if
    // anything) the mount still reports once focus has moved away.
    const capture = captureRichSelection();
    if (!capture) return;
    const blank: ImagePropertiesValue = {
      src: "",
      alt: "",
      width: "",
      position: "",
      pinAlignment: "center",
      size: "",
      spacing: "",
      shape: false,
      flush: false,
      layer: "",
    };
    const value = await promptImageProperties(blank);
    if (value == null) return;
    const error = validateImageProperties(value);
    if (error) {
      toast?.error(error);
      return;
    }
    if (!isRichSelectionCaptureFresh(capture)) {
      showRichDiagnostic(diagnosticForEditRejection("stale"));
      return;
    }
    reportRichOutcome(applyRichImageInsert(capture.host, value, capture.selection));
  }

  // ── Caret-driven image/link commands (SFE-P3d-parity, Lane D) ────────────
  //
  // Closes the three former parity-matrix waiver rows condition 2 names —
  // `image-properties`/`image-unwrap`/`link-edit` — by making the shared
  // computation (`caret-token-commands.ts`, built on the pre-existing,
  // tested `context-menu-actions.ts`/`image-classes.ts` primitives)
  // reachable from BOTH editing surfaces via the CURRENT CARET, instead of
  // only from the preview context menu P4 deletes. The actual per-surface
  // commands live in `toolbar-actions.ts` (source — takes the live
  // `EditorView`) and `rich-commands.ts` (rich — takes `richDocHost` +
  // `live: LiveSelection`); this page's only job is routing to whichever
  // surface is active, reading what each command needs from it, and
  // reporting a refusal — the SAME shape `handleRichToolbarAction`/
  // `editorRef?.runToolbarAction` already have for every other action.

  /**
   * "Image properties…" — edits an EXISTING image's attrs/src/alt at the
   * caret, via the SAME `ImagePropertiesDialog` the (soon-deleted) preview
   * context menu's "Set properties…" uses. Rich mode reuses
   * `captureRichSelection`/`isRichSelectionCaptureFresh` — the SAME
   * document-identity staleness guard `openRichImageProperties` above
   * already relies on for its own `promptImageProperties` await, not a
   * second mechanism — because `locateRichImagePropertiesAtCaret`'s result
   * is only safe to apply against the EXACT `richDocHost` it was read from;
   * source mode's `applyImagePropertiesEdit` re-verifies its own span
   * directly against the live `view` instead (see its own doc comment for
   * why the two surfaces' staleness guards differ).
   */
  function handleImagePropertiesAtCaret(): void {
    if (richSurfaceActive) {
      const capture = captureRichSelection();
      if (!capture || !capture.selection) {
        showRichDiagnostic(NO_LIVE_CARET_DIAGNOSTIC);
        return;
      }
      const located = locateRichImagePropertiesAtCaret(capture.host, capture.selection);
      if (!located.ok) {
        showRichDiagnostic(located.diagnostic);
        return;
      }
      void (async () => {
        const next = await promptImageProperties(located.value.initial);
        if (next == null) return; // cancelled
        const error = validateImageProperties(next);
        if (error) {
          toast?.error(error);
          return;
        }
        if (!isRichSelectionCaptureFresh(capture)) {
          showRichDiagnostic(diagnosticForEditRejection("stale"));
          return;
        }
        reportRichOutcome(
          applyRichImagePropertiesEdit(capture.host, located.value, next, capture.version),
        );
      })();
      return;
    }
    void (async () => {
      const view = await findMountedSourceView(sourceEditorHostEl);
      if (!view) {
        showRichDiagnostic(NO_LIVE_CARET_DIAGNOSTIC);
        return;
      }
      const located = locateImagePropertiesAtCaret(view);
      if (!located.ok) {
        showRichDiagnostic(located.diagnostic);
        return;
      }
      const next = await promptImageProperties(located.value.initial);
      if (next == null) return; // cancelled
      const error = validateImageProperties(next);
      if (error) {
        toast?.error(error);
        return;
      }
      const outcome = applyImagePropertiesEdit(view, located.value, next);
      if (!outcome.ok) showRichDiagnostic(outcome.diagnostic);
    })();
  }

  /** "Unwrap image" — removes an existing image's enclosing link wrapper at
   *  the caret, leaving the image itself untouched. No dialog, so no
   *  intervening staleness window on either surface. */
  function handleImageUnwrapAtCaret(): void {
    if (richSurfaceActive) {
      if (!richDocHost) return;
      const live = richLiveSelection();
      if (!live) {
        showRichDiagnostic(NO_LIVE_CARET_DIAGNOSTIC);
        return;
      }
      reportRichOutcome(applyRichImageUnwrapAtCaret(richDocHost, live));
      return;
    }
    void (async () => {
      const view = await findMountedSourceView(sourceEditorHostEl);
      if (!view) {
        showRichDiagnostic(NO_LIVE_CARET_DIAGNOSTIC);
        return;
      }
      const outcome = applyImageUnwrapAtCaret(view);
      if (!outcome.ok) showRichDiagnostic(outcome.diagnostic);
    })();
  }

  /** "Edit link…" — edits an EXISTING link's target at the caret, via the
   *  same `promptText` flow the preview context menu's "Edit link…" uses.
   *  Same staleness-guard split as `handleImagePropertiesAtCaret` above. */
  function handleLinkEditAtCaret(): void {
    if (richSurfaceActive) {
      const capture = captureRichSelection();
      if (!capture || !capture.selection) {
        showRichDiagnostic(NO_LIVE_CARET_DIAGNOSTIC);
        return;
      }
      const located = locateRichLinkEditAtCaret(capture.host, capture.selection);
      if (!located.ok) {
        showRichDiagnostic(located.diagnostic);
        return;
      }
      void (async () => {
        const next = await promptText({
          title: "Edit link",
          label: "Web address",
          initialValue: located.value.initialHref,
        });
        if (next == null) return; // cancelled
        if (!isRichSelectionCaptureFresh(capture)) {
          showRichDiagnostic(diagnosticForEditRejection("stale"));
          return;
        }
        reportRichOutcome(applyRichLinkEditEdit(capture.host, located.value, next, capture.version));
      })();
      return;
    }
    void (async () => {
      const view = await findMountedSourceView(sourceEditorHostEl);
      if (!view) {
        showRichDiagnostic(NO_LIVE_CARET_DIAGNOSTIC);
        return;
      }
      const located = locateLinkEditAtCaret(view);
      if (!located.ok) {
        showRichDiagnostic(located.diagnostic);
        return;
      }
      const next = await promptText({
        title: "Edit link",
        label: "Web address",
        initialValue: located.value.initialHref,
      });
      if (next == null) return; // cancelled
      const outcome = applyLinkEditEdit(view, located.value, next);
      if (!outcome.ok) showRichDiagnostic(outcome.diagnostic);
    })();
  }

  /**
   * Insert an image even when no chapter is open yet (UX audit P3#8: the Media
   * "Insert" button used to dead-end behind a disabled state, telling the author
   * to go open a file first). If no markdown chapter is open, open one and the
   * editor pane, then insert once EITHER surface has mounted AND loaded that
   * chapter — a bounded rAF retry, so there's no race (we never insert into an
   * unloaded doc) and no infinite loop (gives up with a clear toast). Routes
   * to whichever surface is active (SFE-P3ab: this used to be CodeMirror-only
   * — a G-10 gap the media panel's drag/drop path shared with the toolbar's
   * own "Insert image" button before this run).
   */
  function insertImageIntoChapter(payload: { src: string; alt?: string }) {
    if (!isMarkdownPath(editorFilePath)) {
      if (mode === "viewer") setMode("editor");
      void ensureEditorFile();
    }
    let tries = 0;
    const tryInsert = () => {
      if (richSurfaceActive) {
        if (richDocHost) {
          reportRichOutcome(
            applyRichCommand(
              richDocHost,
              { kind: "insert-image", src: payload.src, alt: payload.alt },
              richLiveSelection(),
            ),
          );
          return;
        }
      } else if (editorRef && isMarkdownPath(editorFilePath)) {
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

  // One session owns one active file and performs atomic buffer handoffs.
  const editorFiles = new EditorFileSession({
    createBuffer: () => createEditorBuffer(),
    flush: (target) => flushEditorBuffer(target),
    onActivate: (target) => {
      if (target.filePath) showEditorContent(target.filePath, target.content);
      if (isDesktop()) trackPersistence(api.app.setDirtyState(target.hasPendingSave));
    },
    onClear: () => editorRef?.switchFile(null, ""),
    onSelectionError: () => toast?.error("Could not open that file."),
  });
  let buffer = $derived(editorFiles.active);

  let editorFilePath = $derived(buffer?.filePath ?? null);
  let editorContent = $derived(buffer?.content ?? "");
  let editorChapter = $derived.by(() => {
    if (!editorFilePath) return null;
    const file = editorFilePath.replace(/\\/g, "/");
    const dir = lifecycle.currentDir?.replace(/\\/g, "/").replace(/\/+$/, "");
    if (dir && file.startsWith(dir + "/")) return file.slice(dir.length + 1);
    return basenameOf(file);
  });
  let editorSavePhase = $derived(buffer?.phase ?? "clean");
  let externalChange = $derived(buffer?.externalChange ?? null);
  let externalFileName = $derived(editorFilePath ? basenameOf(editorFilePath) : "");

  /**
   * Whether the RICH surface is the one that should actually be mounted
   * right now — the user's mode PREFERENCE (`richMode.mode === "rich"`)
   * narrowed to files rich mode actually supports (`isMarkdownPath`).
   * `richMode.mode` itself is never forced back to `"source"` for a
   * non-markdown file (so the preference survives switching back to a
   * markdown one — see `setRichMode`), but every decision about which
   * surface is ACTUALLY live, and which write-path an action should take,
   * keys off THIS, not the raw preference (SFE-P3ab review round 1,
   * CONFIRMED finding). `editorFilePath === null` (no file open yet) still
   * counts as active so the rich pane's own "select a file" placeholder
   * keeps showing while the preference is "rich", matching prior behavior.
   */
  let richSurfaceActive = $derived(
    richMode.mode === "rich" && (editorFilePath === null || isMarkdownPath(editorFilePath)),
  );

  function showEditorContent(path: string, content: string): void {
    if (editorRef?.hasFile(path)) editorRef.updateContent(content);
    else editorRef?.switchFile(path, content);
    // Same choke point covers BOTH a real file switch and a same-file
    // external replacement landing (acceptExternal's onContentReplaced) —
    // D7 groups both under "not undoable into the prior file", so rich
    // mode responds to either the same way: a fresh epoch, fresh host.
    if (richMode.mode === "rich") {
      richMode.onFileSwitch();
      // SFE-P3ab review round 1 (CONFIRMED finding): rich mode has no
      // surface for a non-markdown file — see `isMarkdownPath`'s header.
      // `richMode.mode` stays "rich" (the preference), but this file opens
      // on the source surface, and any stale host from a PRIOR markdown
      // file is dropped rather than left mounted over the wrong content.
      if (isMarkdownPath(path)) {
        rebuildRichDocHost(path, content);
      } else {
        disposeRichDocHost();
        showRichDiagnostic(RICH_MODE_MARKDOWN_ONLY_DIAGNOSTIC);
      }
    }
  }

  function createEditorBuffer(): EditorBuffer {
    let instance: EditorBuffer;
    instance = new EditorBuffer({
      platform: getPlatform(),
      saveDelayMs: settings.current.editor.autoSaveDelay,
      recoveryEnabled: settings.current.editor.crashRecovery,
      onError: (msg) => {
        if (editorFiles.isActive(instance)) toast?.error(msg);
      },
      onContentReplaced: (path, content) => {
        if (editorFiles.isActive(instance) && instance.filePath === path) showEditorContent(path, content);
      },
      onAutoReloaded: () => {
        if (editorFiles.isActive(instance)) toast?.info?.("Reloaded from disk");
      },
      onDirty: (pending) => {
        if (editorFiles.isActive(instance) && isDesktop()) {
          trackPersistence(api.app.setDirtyState(pending));
        }
      },
    });
    return instance;
  }

  function ensureBuffer(): EditorBuffer {
    return editorFiles.ensure();
  }

  function resetEditorBuffer(): void {
    editorFiles.reset();
  }

  async function flushEditorBuffer(
    target: EditorBuffer | null = buffer,
    recordMarker = true,
  ): Promise<boolean> {
    if (!target) return true;
    const projectDir = lifecycle.currentDir;
    try {
      await target.flush();
      return true;
    } catch {
      reportIgnoredPersistenceFailure();
      if (recordMarker) {
        void api.app.recordFlushFailure(projectDir).catch(() => {});
      }
      return false;
    }
  }

  // ARCH #61: imperative settings side-effects go through the store's single
  // onSettingsChange channel ($effect is banned in the SPA — see CLAUDE.md and
  // the store header; the store's replaceState choke point owns the notify, so
  // the old forgot-to-notify hazard is structurally gone). Each sink is
  // wrapped in settingsChangeGuard so it fires only when ITS field changed:
  // - autoSaveDelay/crashRecovery → the live buffer's save/recovery settings;
  //   the buffer's own constructor seeds both, so a fresh buffer needs no push.
  // - previewBg → re-inject desktop canvas styles; initial injection happens in
  //   the renderingComplete handler, this catches live changes. The ready()
  //   check keeps a pre-mount change from being dropped (it re-fires once the
  //   preview client exists).
  const autoSaveDelaySink = settingsChangeGuard<number>((delay) => buffer?.setSaveDelayMs(delay));
  const recoverySink = settingsChangeGuard<boolean>((enabled) => buffer?.setRecoveryEnabled(enabled));
  const previewBgSink = settingsChangeGuard<string>(
    (bg) => {
      // The viewer honours this background rule directly. See
      // buildCanvasBackgroundStyles' doc comment.
      client?.injectStyles("desktop-canvas", buildCanvasBackgroundStyles(bg));
    },
    () => !!client,
  );
  // Split ratio (#103): the durable settings value seeds the controller (which
  // holds the live $state), so the last-dragged ratio survives restart. The
  // guard fires only when splitRatio itself changes — an unrelated settings
  // change won't clobber a per-project ratio applied at project-open, and the
  // controller's own persist writes this same value back (idempotent).
  const splitRatioSink = settingsChangeGuard<number>((r) => zoomView.restoreSplitRatio(r));
  // Context menu (inline-editing plan §4.5): imperative teardown on toggle —
  // if the author flips the setting off while the menu happens to be open,
  // close it immediately rather than leaving a now-disabled affordance on
  // screen until the next dismissal event.
  const contextMenuSettingSink = settingsChangeGuard<boolean>((enabled) => {
    if (!enabled) contextMenu.close();
  });
  // Workspace mode: the live value is local $state (it can hold `focus`, which
  // the persisted shape cannot), so the async settings load has to be pushed
  // into it. The guard dedupes against the last value seen, so setMode's own
  // write-back cannot bounce back and clobber a live `focus`.
  // Restoring a persisted `editor` mode assigns `mode` directly rather than
  // going through setMode, so it has to kick the lazy import the way setMode
  // does. The settings fetch and the auto-open of the last project are
  // independent async starts: when settings land LAST, the project-open path
  // already ran `ensureEditorFile()` while the workspace still looked like
  // viewer mode, and nothing else would ever load the editor component.
  const modeSink = settingsChangeGuard<Exclude<WorkspaceMode, "focus">>((m) => {
    mode = m;
    if (m !== "viewer") loadEditorModule();
  });
  onMount(() =>
    onSettingsChange((s) => {
      autoSaveDelaySink(s.editor.autoSaveDelay);
      recoverySink(s.editor.crashRecovery);
      previewBgSink(s.appearance.previewBg);
      splitRatioSink(s.preview.splitRatio);
      contextMenuSettingSink(s.preview.contextMenu);
      modeSink(s.preview.mode);
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
    const off = getPlatform().onFlushBeforeClose(() => flushEditorBuffer(buffer, false));
    return () => off?.();
  });

  /**
   * Run `fn` once the (lazily imported) editor component has mounted, or give
   * up after ~2s. Same bounded-rAF pattern as `focusEditorWhenReady` /
   * `insertImageIntoChapter` below.
   *
   * This replaced the sync controller's cross-chapter poll loop. That loop had
   * to wait for an async FILE LOAD and then re-issue its reveal five times
   * because the load reset the editor's scroll underneath it; this waits only
   * for a component to mount, and once it has, the chapter and the line are
   * both already in the document.
   */
  function whenEditorReady(fn: () => void): void {
    let tries = 0;
    const attempt = () => {
      if (editorRef) fn();
      else if (tries++ < 120) requestAnimationFrame(attempt);
    };
    requestAnimationFrame(attempt);
  }

  /**
   * Explicit navigation: switch to the source file and reveal the line.
   *
   * `focus` also places the caret (see MarkdownEditor.revealLine) — right for a
   * deliberate "take me there" action, wrong for a click in the book, which
   * should scroll the editor without stealing the caret or the selection.
   *
   * The cross-chapter file switch below is DELIBERATE for both callers
   * (owner-ratified 2026-08-26): clicking a block from another chapter in the
   * preview follows the author's attention there — the editor loads that
   * chapter, flushing the outgoing buffer first via selectEditorFile's atomic
   * handoff, so no edit is lost. `focus` governs only caret placement, never
   * whether the follow happens.
   */
  async function revealInEditor(
    chapter: string | null,
    line: number,
    focus = true,
  ): Promise<void> {
    if (!chapter) {
      const path = editorFilePath;
      if (path) {
        whenEditorReady(() => {
          if (editorRef?.hasFile(path)) editorRef.revealLine(line, focus);
        });
      }
      return;
    }
    if (!isSafeChapterId(chapter)) return;
    const dir = lifecycle.currentDir;
    if (!dir) return;
    const path = chapterPath(dir, chapter);
    if (path !== editorFilePath) {
      if (!(await selectEditorFile(path))) return;
    }
    whenEditorReady(() => {
      if (editorRef?.hasFile(path)) editorRef.revealLine(line, focus);
    });
  }

  /**
   * Make `path` the file the author is working in.
   *
   * The session keeps the outgoing file active while the target reads and
   * performs one atomic handoff after any required flush succeeds.
   */
  async function selectEditorFile(
    path: string,
  ): Promise<boolean> {
    if (!isDesktop()) return false;
    return editorFiles.select(path);
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
   * Called BEFORE the rename API call fires, when `path` (the item being
   * renamed) IS the open file OR is an ancestor DIRECTORY of it — `path` can
   * name a folder, and renaming a folder moves everything nested under it,
   * including a dirty open file several levels down. Symmetric with
   * `onTreeFileRenamed`/`onTreeFileDeleted` below, which already use
   * `isPathAtOrUnder` for exactly this reason; an exact-match-only check here
   * would skip the flush for a folder rename and let the edit be carried
   * away, unsaved, under its still-old path.
   *
   * Must run BEFORE the rename, not after: the rename call only moves
   * whatever is on disk right now, so a flush AFTER renaming would stat the
   * buffer's still-old `filePath`, find it missing, and (per
   * EditorBuffer.externalChangeBeforeSave's own safety check) refuse to
   * write at all — raising a spurious "this file was deleted" conflict
   * banner off the author's OWN rename, with the edit stranded in the dirty
   * buffer under neither name. Flushing is a no-op when nothing is dirty,
   * so it's safe to await unconditionally.
   */
  async function onTreeBeforeRename(path: string): Promise<boolean> {
    if (buffer?.filePath && isPathAtOrUnder(buffer.filePath, path)) {
      return flushEditorBuffer(buffer);
    }
    return true;
  }

  async function onTreeBeforeDelete(path: string): Promise<boolean> {
    if (buffer?.filePath && isPathAtOrUnder(buffer.filePath, path)) {
      return flushEditorBuffer(buffer);
    }
    return true;
  }

  /**
   * Repoint the open buffer when its file (or an ancestor directory) moved.
   */
  function onTreeFileRenamed(oldPath: string, newPath: string): void {
    if (editorFilePath && isPathAtOrUnder(editorFilePath, oldPath)) {
      void selectEditorFile(newPath + editorFilePath.slice(oldPath.length));
    }
  }

  /**
   * Called after a successful delete. Drop the deleted file rather than leaving
   * a buffer pointing at a path that no longer exists — the exact "must not
   * silently point at a missing path" failure mode M9 calls out (a stray edit
   * afterward would otherwise silently recreate the deleted file). FileTree can
   * delete directories recursively, so this must catch every open file at or
   * under the deleted path, not just an exact match.
   */
  function onTreeFileDeleted(path: string): void {
    if (editorFilePath && isPathAtOrUnder(editorFilePath, path)) {
      resetEditorBuffer();
    }
  }

  function onEditorChange(value: string) {
    if (!isDesktop()) return;
    ensureBuffer().edit(value);
  }

  async function defaultEditorFile(dir: string, markdownOnly = false): Promise<string | null> {
    const files = (await api.fs.listDir(dir)).filter((entry) => !entry.isDir);
    const markdown = files
      .filter((entry) => /\.md$/i.test(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name))[0];
    return markdown?.path ??
      (markdownOnly ? null : files.find((entry) => /\.(md|css)$/i.test(entry.name))?.path ?? null);
  }

  // When the editor opens with nothing loaded, choose one real file.
  //
  // Loading the lazy editor chunk belongs here, not at each call site: every
  // caller wants a USABLE editor, and the buffer alone is not one. The
  // project-open path (ProjectLifecycleController -> deps.ensureEditorFile)
  // called only this function, so a book opened while the workspace was
  // already in Edit mode filled the buffer behind a pane still showing
  // "Loading editor…" — nothing on that path ever imported the component.
  // `loadEditorModule()` self-guards on `editorVisible`, so this stays a no-op
  // while the book is being previewed in viewer mode.
  async function ensureEditorFile() {
    if (!lifecycle.currentDir || !isDesktop()) return;
    loadEditorModule();
    // Fire-and-forget continuation: capture the dir and bail if a different
    // project took over during the listing, or this would load the OLD
    // project's chapters (and auto-save edits into the wrong book on disk).
    const dir = lifecycle.currentDir;
    try {
      await editorFiles.ensureDefault(async () => {
        const path = await defaultEditorFile(dir);
        return dir === lifecycle.currentDir ? path : null;
      });
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

  /**
   * Load crash-recovered bytes into the one-file buffer.
   */
  async function restoreRecoveredFile(filePath: string, content: string): Promise<boolean> {
    return editorFiles.restore(filePath, content);
  }

  // scanForRecovery/restoreRecovery/discardRecovery/dismissRecovery (#44,
  // Phase 5 slice 2 — UX H5 / ARCH #10) now live on `crashRecovery`
  // (CrashRecoveryController) — see its instantiation above. The template
  // reads `crashRecovery.items` and calls the intent methods directly.

  // ── Persist left panel state on change ────────────────────────────────────
  function persistLeftPanelPrefs() {
    if (!leftPanelPrefsLoaded) return;
    trackPersistence(
      api.app.setDesktopPrefs({ leftPanel: { open: leftPanelOpen, activeTab: leftPanelTab, width: leftPanelWidth } } as Record<string, unknown>),
    );
  }

  function toggleLeftPanel() {
    leftPanelOpen = !leftPanelOpen;
    persistLeftPanelPrefs();
  }

  /**
   * Open the editor pane: mark it open, lazy-load the editor module, ensure a
   * file is loaded, and move focus into it. Centralizes the sequence that was
   * hand-repeated across five call sites (audit E3). `focus` and `ensureFile`
   * cover the two sites that intentionally differ (togglePreview never steals
   * focus; the file-tree selection path already has a file).
   */
  function openEditorPane(opts: { focus?: boolean; ensureFile?: boolean } = {}) {
    const { focus = true, ensureFile = true } = opts;
    if (mode === "viewer") setMode("editor");
    loadEditorModule();
    if (ensureFile) void ensureEditorFile();
    if (focus) focusEditorWhenReady();
  }

  /**
   * The preview context menu's one editor-opening action. It opens the Markdown
   * editor, loads the owning file, then places the caret on the source line.
   */
  function goToSource(chapter: string, line: number): void {
    editorView = "editor";
    paneViewRestore = null;
    openEditorPane({ focus: false, ensureFile: false });
    if (isNarrow && paneMode !== "edit") setPaneMode("edit");
    void revealInEditor(chapter, line);
  }

  function toggleEditor() {
    if (!lifecycle.currentDir || lifecycle.sourceMode !== "folder") return;
    // Manually toggling while activity borrows the editor exits that view.
    if (editorView !== "editor") {
      editorView = "editor";
      paneViewRestore = null;
    }
    // Closing the editor always lands on the viewer — there is no stored
    // "what was showing before" to consult, and nothing else it could mean.
    if (editorVisible) {
      setMode("viewer");
      return;
    }
    // On open, move keyboard focus into the editor so Ctrl+E acts as a
    // focus-switch into the editing surface (#38). Closing returns focus to
    // the document (preview iframe / window) implicitly.
    openEditorPane();
  }

  // ── Problems panel (#28) ───────────────────────────────────────────────────
  // Lint findings for the open project, refreshed after every live-preview
  // rebuild (the renderingComplete event — which fires for the initial render
  // AND every watcher-triggered re-render). The toggle button lives in the
  // toolbar with an errors+warnings count badge.
  let problemsOpen = $state(false);
  let problems = $state<ProblemEntry[]>([]);
  /** Findings from the last export (see the `buildPdf` wrapper above). */
  let buildProblemEntries = $state<ProblemEntry[]>([]);
  let problemsLoading = $state(false);
  // M5: distinct from "problems === [] because the project is clean" — set
  // when the lint API call itself failed, so the panel can render a neutral
  // "we couldn't check" row instead of a false green all-clear.
  let problemsError = $state<string | null>(null);
  let previewErrorDisplay = $derived(
    lifecycle.previewError ? friendlyPreviewError(lifecycle.previewError) : null,
  );
  let displayedProblems = $derived<ProblemEntry[]>(
    previewErrorDisplay
      ? [
          {
            severity: "error",
            message: `${previewErrorDisplay.title} ${previewErrorDisplay.message}`,
            source: "desktop.preview",
          },
          ...problems,
          ...buildProblemEntries,
        ]
      : [...problems, ...buildProblemEntries],
  );
  let problemBadge = $derived(problemCounts(displayedProblems).badge);

  function showPreviewFiles(): void {
    leftPanelOpen = true;
    leftPanelTab = "files";
  }

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
   * existing file-selection + reveal path — no new navigation machinery.
   */
  function openProblem(p: ProblemEntry) {
    if (!p.filePath || !lifecycle.currentDir) return;
    // Make sure the editor pane is visible first (narrow = Edit mode pane;
    // wide = the editor split).
    if (isNarrow) {
      setPaneMode("edit");
    } else if (!editorVisible) {
      setMode("editor");
    }
    void selectEditorFile(p.filePath).then((selected) => {
      if (selected && p.line) {
        const path = p.filePath!;
        whenEditorReady(() => {
          if (editorRef?.hasFile(path)) editorRef.revealLine(p.line!, true);
        });
      }
    });
    focusEditorWhenReady();
  }

  // Canvas styles are injected by the renderingComplete handler (which already
  // calls client.injectStyles).

  onMount(() => {
    api.doctor()
      .then((data) => {
        diagnosticsTools = data.tools ?? [];
        appVersion = data.desktopVersion ?? null;
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
    isSomethingOpen: () =>
      !!(lifecycle.previewUrl || lifecycle.currentDir || lifecycle.currentUrl || lifecycle.busy),
    getDesktopPrefs: () => api.app.getDesktopPrefs(),
    showLastFlushFailure: (marker) => {
      if (!toast) return false;
      toast.warning(formatLastFlushFailureNotice(marker), 0);
      return true;
    },
    acknowledgeFlushFailure: (failedAt) => api.app.acknowledgeFlushFailure(failedAt),
    isLeftPanelPrefsLoaded: () => leftPanelPrefsLoaded,
    applyLeftPanelPrefs: (panelPrefs) => {
      leftPanelPrefsLoaded = true;
      // Validate against the live tab set: this comes from a JSON file on
      // disk, so an unknown id must not become the active tab.
      const validTabs: PanelTab[] = ["projects", "toc", "files", "media"];
      if (panelPrefs?.activeTab && (validTabs as string[]).includes(panelPrefs.activeTab)) {
        leftPanelTab = panelPrefs.activeTab as PanelTab;
      }
      // Same clamp the panel itself applies ($lib/left-panel-width): a width
      // persisted under the older 200px floor is raised to the readable 300,
      // and a window too narrow for that gets the relaxed bounds instead. One
      // shared function, or the two clamps fight each other on restore.
      if (typeof panelPrefs?.width === "number") {
        leftPanelWidth = clampPanelWidth(panelPrefs.width, viewportWidth());
      }
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
    setBusy: (busy, label) => {
      lifecycle.busy = busy;
      lifecycle.busyLabel = label;
    },
    startFolderPreview: (dir, label) => startFolderPreview(dir, label),
  });

  let markdownFileLaunchGeneration = 0;

  /** Route an OS-opened chapter through the same project and editor flows as UI clicks. */
  function handleMarkdownFileLaunch(
    event: MarkdownFileLaunchEvent,
    generation: number,
  ): void {
    if (event.type === "ready") return;
    if (generation !== markdownFileLaunchGeneration) return;
    // File launches replace the normal startup decision, so make the landing
    // available as a fallback if resolution/opening fails.
    landingReady = true;

    if (event.type === "error") {
      toast?.error(event.message);
      return;
    }

    void (async () => {
      const opened = await openProjectPath(
        event.projectDir,
        `Opening ${basenameOf(event.filePath)}…`,
      );
      if (
        !opened ||
        generation !== markdownFileLaunchGeneration ||
        lifecycle.currentDir !== event.projectDir ||
        lifecycle.openError
      ) {
        return;
      }

      if (!(await selectEditorFile(event.filePath))) return;
      if (generation !== markdownFileLaunchGeneration) return;
      editorView = "editor";
      paneViewRestore = null;
      if (isNarrow && paneMode !== "edit") setPaneMode("edit");
      else openEditorPane({ ensureFile: false });
    })();
  }

  onMount(() => {
    if (!isDesktop()) {
      void startup.run();
      return;
    }

    // Main replays every path queued before hydration, then emits `ready`.
    // Only fall back to last-project startup when that replay was empty, so a
    // double-clicked chapter always wins over the previous-session project.
    let initialFileLaunchSeen = false;
    let initialFileLaunchSetup: Promise<void> | null = null;
    let initialReplayComplete = false;
    const off = getPlatform().onOpenMarkdownFile((event) => {
      if (event.type === "ready") {
        initialReplayComplete = true;
        if (!initialFileLaunchSeen) void startup.run();
        return;
      }
      initialFileLaunchSeen = true;
      const generation = ++markdownFileLaunchGeneration;
      if (initialReplayComplete) {
        handleMarkdownFileLaunch(event, generation);
        return;
      }
      initialFileLaunchSetup ??= startup.run(false);
      void initialFileLaunchSetup.then(() => handleMarkdownFileLaunch(event, generation));
    });
    return () => off?.();
  });

  // ----------------------------------------------------------------
  // Commit engine — the single write path for context-menu AND in-flow
  // block-edit mutations (docs/inline-editing-plan.md §3). Pure logic + injected
  // seams; never writes a file itself (buffer.edit/flush + applyRangeEdit do
  // that, exactly like every other write path in the app).
  //
  // SFE-P3ab review round 1 (CONFIRMED finding): `editorHasFile`/
  // `applyRangeEdit` are SURFACE-AWARE — when the rich surface is the one
  // actually live for the target file, the edit routes through
  // `richDocHost.applyEdit` (the SAME seam every other rich-mode command in
  // this file uses, `rich-commands.ts`'s header), not `editorRef` (which is
  // always `null` in rich mode, since `MarkdownEditor` is unmounted). Before
  // this fix `editorHasFile` was permanently `false` whenever rich mode was
  // active, so the engine fell through to `buf.edit(...)` directly — a
  // write `EditorBuffer.edit()` does NOT report through
  // `onContentReplaced` (that callback is for EXTERNAL replacements only),
  // so the mounted rich host never learned about it and kept showing the
  // pre-commit text. The very next rich-mode command then read that STALE
  // snapshot, applied its own edit on top of it, and pushed the whole
  // stale-plus-new text back through `richDocHost`'s `subscribe` ->
  // `onEditorChange` -> `buffer.edit(...)`, silently REVERTING the
  // preview's committed change. Routing through `richDocHost.applyEdit`
  // here closes that gap: its `subscribe` callback (`rebuildRichDocHost`
  // above) already forwards every accepted edit into `onEditorChange` ->
  // `buffer.edit(...)`, so the buffer, the rich host, and disk all agree
  // immediately — there is no second, silently-diverging writer.
  // ----------------------------------------------------------------
  const commitEngine = new CommitEngine({
    currentDir: () => lifecycle.currentDir,
    rendering: () => lifecycle.rendering,
    buffer: () => buffer,
    // reveal:false — a committed menu action must not also scroll the author's
    // editor to the top of the chapter it happened to touch.
    selectEditorFile: (path) => selectEditorFile(path),
    editorHasFile: (path) =>
      richSurfaceActive ? richDocHost !== null && editorFilePath === path : (editorRef?.hasFile(path) ?? false),
    applyRangeEdit: (path, from, to, insert) => {
      if (richSurfaceActive && richDocHost) {
        richDocHost.applyEdit({ from, to, insert, expectedVersion: richDocHost.getSnapshot().version });
        return;
      }
      editorRef?.applyRangeEditIn(path, from, to, insert);
    },
  });

  let textPrompt = $state<{
    title: string;
    label: string;
    initialValue: string;
    options?: readonly { value: string; label: string }[];
    resolve: (value: string | null) => void;
  } | null>(null);

  async function promptText(opts: {
    title: string;
    label: string;
    initialValue: string;
    options?: readonly { value: string; label: string }[];
  }): Promise<string | null> {
    return new Promise((resolve) => {
      textPrompt = { ...opts, resolve };
    });
  }

  function finishTextPrompt(value: string | null): void {
    const pending = textPrompt;
    textPrompt = null;
    pending?.resolve(value);
  }

  let imagePropertiesPrompt = $state<{
    initialValue: ImagePropertiesValue;
    resolve: (value: ImagePropertiesValue | null) => void;
  } | null>(null);

  async function promptImageProperties(
    initialValue: ImagePropertiesValue,
  ): Promise<ImagePropertiesValue | null> {
    return new Promise((resolve) => {
      imagePropertiesPrompt = { initialValue, resolve };
    });
  }

  function finishImageProperties(value: ImagePropertiesValue | null): void {
    const pending = imagePropertiesPrompt;
    imagePropertiesPrompt = null;
    pending?.resolve(value);
  }

  async function copyToClipboard(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      toast?.error?.("Couldn't copy to the clipboard.");
    }
  }

  function openMediaPanel(): void {
    leftPanelOpen = true;
    leftPanelTab = "media";
  }

  // ----------------------------------------------------------------
  // In-flow block editing (docs/inline-editing-plan.md §3.3, protocol v8).
  // Two entry points, both landing here: the "Edit this block" context-menu
  // item (below) and double-click in the preview (which arrives as the
  // blockEditRequested event on the controller's own subscription).
  //
  // No geometry deps: the editing surface is the block's own element inside
  // the book iframe, so there is no panel to position over it.
  // ----------------------------------------------------------------
  const inlineEdit = new InlineEditController({
    client: () => client,
    currentDir: () => lifecycle.currentDir,
    openContent: (path) => (buffer?.filePath === path ? buffer.content : null),
    readFile: (path) => getPlatform().readFile(path),
    commitEngine,
    focusPreview: () => previewFrameRef?.getIframe()?.focus(),
    toastError: (message) => toast?.error(message),
    toastInfo: (message) => toast?.info?.(message),
  });

  // ----------------------------------------------------------------
  // Preview right-click / Shift+F10 context menu (inline-editing plan
  // §4.1-4.5). Subscribes to the preview client via its OWN client.on()
  // listener — separate from previewEvents' switch below (PR 0 already owns
  // the elementActivated case there).
  // ----------------------------------------------------------------
  const contextMenu = new ContextMenuController({
    client: () => client,
    enabled: () => settings.current.preview.contextMenu,
    rendering: () => lifecycle.rendering,
    currentDir: () => lifecycle.currentDir,
    openContent: (path) => (buffer?.filePath === path ? buffer.content : null),
    readFile: (path) => getPlatform().readFile(path),
    commitEngine,
    getIframeOrigin: () => {
      const rect = previewFrameRef?.getIframe()?.getBoundingClientRect();
      return rect ? { left: rect.left, top: rect.top } : null;
    },
    getWorkspaceRect: () => {
      if (!workspaceEl) return null;
      const rect = workspaceEl.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    },
    promptText,
    promptImageProperties,
    goToSource,
    openMediaPanel,
    copyToClipboard,
    toastSuccess: (message) => toast?.success(message),
    toastError: (message) => toast?.error(message),
    openInlineEdit: (chapter, range, caret) => void inlineEdit.show({ chapter, range, caret }),
  });

  // ----------------------------------------------------------------
  // Preview-frame event router. Owns the post-render settle sequence (view-mode
  // auto-selection, the fit-width-vs-numeric-zoom reveal race, page restore,
  // outline rebuild, re-lint) + sourceLineChanged outline tracking. Host
  // coupling is injected so the ordering that
  // prevents the visible page JUMP is unit-tested in isolation. Composes
  // pageNav + zoomView rather than duplicating their logic.
  const previewEvents = new PreviewEventController({
    client: () => client,
    pageNav,
    zoomView,
    editorSync: {
      invalidatePending: () => editorSync.invalidatePending(),
      updateActiveOutline: (line) => updateActiveOutline(line),
      revealEditorLine: (chapter, line) => syncOpenEditorTo(chapter, line, false),
    },
    zoom: () => zoom,
    viewMode: () => viewMode,
    bgColor: () => bgColor,
    setRendering: (v) => (lifecycle.rendering = v),
    getRendering: () => lifecycle.rendering,
    setRenderProgressPage: (v) => (lifecycle.renderProgressPage = v),
    getRenderProgressPage: () => lifecycle.renderProgressPage,
    setRenderCompleteOverlay: (v) => (lifecycle.renderCompleteOverlay = v),
    setPreviewUpdating: (v) => (previewUpdating = v),
    resetOutline: () => {
      outline = [];
      activeOutlineIndex = 0;
    },
    consumePendingRestore: () => {
      const restore = { page: pendingRestorePage };
      pendingRestorePage = null;
      return restore;
    },
    refreshOutline: () => refreshOutline(),
    refreshProblems: () => refreshProblems(),
    revealSettledPages: () => revealSettledPages(),
    toastSuccess: (message) => toast?.success(message),
    scheduleMicrotask: (fn) => queueMicrotask(fn),
  });

  // Subscribe to PreviewClient events when a client is created by PreviewFrame.
  // Hooked via onClientReady callback on the PreviewFrame component (imperative,
  // not $effect). Cleanup is handled when the client is replaced (PreviewFrame
  // remounts on lifecycle.previewUrl change via {#key lifecycle.previewUrl}).
  //
  // M31: this is also where the client's postMessage security is wired up.
  // PreviewFrame calls attach() itself on the very next line of its own mount,
  // so `setExpectedOrigin`/`lockDown` must
  // happen HERE, synchronously, ahead of that — PreviewFrame cannot read the
  // pinned origin from the cross-origin iframe's own window.location (that
  // throws), and in URL-preview mode the SAME component loads an arbitrary
  // third-party page, which must never get the command/event bridge wired up
  // at all (a locked client's later attach() call is a permanent no-op).
  function onClientReady(c: PreviewClient) {
    previewUpdating = false;
    if (lifecycle.sourceMode === "url") {
      c.lockDown();
      return;
    }
    c.setExpectedOrigin(lifecycle.previewUrl);
    previewEvents.subscribe(c);
    contextMenu.subscribe(c);
    inlineEdit.subscribe(c);
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
      // The full-window Project settings view owns the keyboard while it's up:
      // the workspace behind it is inert, so acting on it (opening Settings
      // invisibly BENEATH the view, toggling focus mode, exporting, snippet
      // picker) would mutate UI the user can't see. Escape closes the view.
      if (projectSettingsOpen) {
        if (e.key === "Escape") {
          e.preventDefault();
          closeProjectSettings();
        }
        return;
      }
      const command = resolveGlobalShortcut({
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        shift: e.shiftKey,
        key: e.key,
      });
      // Cmd/Ctrl+, opens the Settings panel (toggles closed if already open).
      if (command === "settings") {
        e.preventDefault();
        toggleSettings();
        return;
      }
      // The start screen owns the rest of the keyboard while it's up (its own
      // Esc handling); workspace shortcuts must not act on the inert UI
      // behind it.
      if (landingVisible) return;
      // Cmd/Ctrl+Shift+F hides the viewer so the editor has the window
      // (#104). Esc is deliberately NOT an exit: focus keeps the toolbar, so
      // the control that entered it is still on screen — and a global Esc
      // that reshuffles panes mid-sentence is a surprise. Esc stays the
      // dismiss-the-transient-thing key (find bar, dialogs, menus).
      if (command === "focus-mode") {
        e.preventDefault();
        togglePreview();
        return;
      }
      // Cmd/Ctrl+F finds in the VIEWER only (owner ruling 2026-08-15): the
      // FindBar drives the native window find over the preview. To edit a
      // found word, the writer uses the preview's "Go to source" — the
      // editor keeps no search surface of its own.
      if (command === "find") {
        if (viewerVisibleForFind) {
          e.preventDefault();
          if (findBarOpen) findBarRef?.focusInput();
          else findBarOpen = true;
        }
        return;
      }
      // Cmd/Ctrl+E toggles the in-app editor (#38) when a folder is open.
      if (command === "toggle-editor") {
        e.preventDefault();
        toggleEditor();
      }
      // Rich mode toggle (SFE-P3ab) — hidden/experimental, inert unless
      // richModeAvailable was flipped on via the gp:experimental-rich-editor
      // localStorage flag. Not part of resolveGlobalShortcut's vocabulary
      // (another lane's file) — checked directly.
      if (
        richModeAvailable &&
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        e.altKey &&
        e.key.toLowerCase() === "r"
      ) {
        e.preventDefault();
        setRichMode(richMode.mode === "rich" ? "source" : "rich");
        return;
      }
      // Block movement (SFE-P3ab, Lane A) — Alt+Shift+ArrowUp/Down moves
      // the block the live rich-mode caret is currently in
      // (`blockIndexAtOffset` + `applyBlockMove`, rich-commands.ts). Rich
      // mode only: source mode keeps its own untouched CodeMirror keymap
      // (`toolbar-actions.ts`, another lane's file). This was Lane B's one
      // unwired deliverable from the prior run, blocked on exactly the
      // selection accessor this run added — a keyboard shortcut, not a
      // toolbar button, because `EditorToolbar.svelte`/`toolbar-actions.ts`
      // are also another lane's files. Not part of resolveGlobalShortcut's
      // vocabulary — checked directly, the same pattern the rich-mode
      // toggle above uses.
      if (
        richSurfaceActive &&
        e.altKey &&
        e.shiftKey &&
        (e.key === "ArrowUp" || e.key === "ArrowDown")
      ) {
        e.preventDefault();
        if (richDocHost) {
          const live = richLiveSelection();
          const blockIndex = live
            ? blockIndexAtOffset(richDocHost.getSnapshot().text, live.from)
            : undefined;
          if (blockIndex !== undefined) {
            reportRichOutcome(
              applyBlockMove(richDocHost, blockIndex, e.key === "ArrowUp" ? "up" : "down"),
            );
          }
        }
        return;
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
      // Never page/zoom the hidden preview behind full-window project
      // settings (PageUp/PageDown must scroll its body, not the preview).
      if (projectSettingsOpen) return;
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
          contextMenu.close();
          zoomView.stepZoom(0.25);
          break;
        case "zoom-out":
          e.preventDefault();
          contextMenu.close();
          zoomView.stepZoom(-0.25);
          break;
        case "fit-width":
          e.preventDefault();
          contextMenu.close();
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
    displayName: string | null = null,
  ): Promise<boolean> {
    return lifecycle.startFolderPreview(dir, label, displayName);
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

  async function openFolder(): Promise<void> {
    await pickAndOpenFolder({ showBusyOverlay: true, label: "Starting preview…" });
  }

  /** Load a URL preview. Reset/epoch-supersede logic now lives on ProjectLifecycleController. */
  function openUrl(url: string) {
    void lifecycle.openUrl(url);
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
  function saveDesktopPrefs(patch: Partial<PersistedProjectState>) {
    if (!lifecycle.currentDir || lifecycle.sourceMode !== "folder" || lifecycle.rendering || pageNav.restoringSavedState) return;
    // Per-project state (#43): write to the folder-keyed bucket so this never
    // overwrites another project's saved page/view. The main process also
    // updates lastProjectDir, so reopening lands on this project.
    trackPersistence(api.app.setDesktopProjectState(lifecycle.currentDir, patch as Record<string, unknown>));
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

  /**
   * Keep an ALREADY-OPEN editor in step with a preview navigation. Never opens
   * the pane and never switches away from the activity view — the explicit
   * "Go to source" action owns opening the editor.
   *
   * Shared by the two preview→editor navigations: a TOC jump (`focus`, because
   * the author asked to go there) and a click on a block in the book (no
   * focus — the click may be the start of a text selection in the viewer, and
   * stealing focus mid-gesture would break selecting/copying from the book).
   */
  function syncOpenEditorTo(chapter: string | null, line: number | null, focus: boolean) {
    if (line == null || !editorPaneOpen || editorView !== "editor") return;
    void revealInEditor(chapter, line, focus);
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
    syncOpenEditorTo(entry.chapter, entry.sourceLine, true);
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
      // isNarrow clamps the derived view mode, so crossing the breakpoint can
      // change it. Push it, the same way setMode does.
      zoomView.applyViewMode(viewMode);
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

  function setPaneMode(mode: "edit" | "view") {
    settings.set({ preview: { paneMode: mode } });
    // Switching to the edit pane should open the editor + focus it (folder only).
    if (mode === "edit" && lifecycle.currentDir && lifecycle.sourceMode === "folder") {
      // Only steal focus if the editor was previously closed.
      // Callers that need a default file request it explicitly; navigation
      // callers already have a target and must not race a background default.
      openEditorPane({ focus: !editorVisible, ensureFile: false });
    }
  }

  /**
   * The ONE writer of `mode`. Persists the durable half (`focus` stores as
   * `editor` — waking into a viewer-less window would be hostile), pushes the
   * derived page layout into the viewer, and guarantees the editor module is
   * loading whenever the editor pane is about to be on screen (the pane
   * renders "Loading editor…" until it is).
   *
   * Persist BEFORE assigning. `settings.set` notifies synchronously, so the
   * write-back reaches `modeSink` inside this call — and entering `focus`
   * from `viewer` writes "editor", a value the sink has NOT seen, so its
   * dedupe does not catch it and it assigns `mode = "editor"`. Doing that
   * echo first and the assignment last keeps the one writer of `mode` the
   * last word; Read → Focus used to land in Edit with the viewer still up.
   */
  function setMode(next: WorkspaceMode): void {
    if (next === mode) return;
    if (next === "focus") modeBeforeFocus = mode === "viewer" ? "viewer" : "editor";
    settings.set({ preview: { mode: next === "focus" ? "editor" : next } });
    mode = next;
    zoomView.applyViewMode(viewMode);
    if (next !== "viewer") loadEditorModule();
  }

  /** Hide/show the viewer — the focus toggle. */
  function togglePreview() {
    if (!lifecycle.previewUrl || isNarrow) return;
    if (mode === "focus") {
      setMode(modeBeforeFocus ?? "editor");
      modeBeforeFocus = null;
      return;
    }
    setMode("focus");
    // Don't yank focus into the editor — the author asked to hide the preview,
    // not to start typing.
    if (lifecycle.currentDir && lifecycle.sourceMode === "folder") {
      openEditorPane({ focus: false });
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

  // Double-click the splitter → reset to the breakpoint default (#103).
  function resetSplit() {
    zoomView.resetSplitRatio();
  }

  // Keyboard resize (#103, WCAG 2.2 SC 2.5.7): Arrow keys nudge the focused
  // splitter by ~2% — the non-drag alternative to dragging.
  function onSplitKeydown(e: KeyboardEvent) {
    let direction = 0;
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") direction = -1;
    else if (e.key === "ArrowRight" || e.key === "ArrowDown") direction = 1;
    else return;
    e.preventDefault();
    zoomView.nudgeSplit(direction);
  }

  // ── Mobile tab bar (#34): Markdown / Preview ───────────────────────────────
  // The single-column (narrow) layout switches the one visible pane between the
  // editor and the preview. `editorPaneOpen` is the visible source of truth;
  // the persisted paneMode is only consulted after the editor was explicitly
  // opened. (The defunct CSS/style tab was retired with the toolbar
  // refactor — project styling lives in the Project settings view.)
  //
  // M1 (single source of truth): whether the shared editor is on a CSS file is
  // derived SOLELY from the open file's extension (`openFileIsCss`) — no
  // parallel state that could get stuck on "css" when no CSS file is open.
  let openFileIsCss = $derived(
    !!editorFilePath && /\.css$/i.test(editorFilePath),
  );
  // Active mobile tab follows the pane that is actually visible.
  let mobileTab = $derived<MobileTab>(editorPaneOpen ? "markdown" : "preview");

  /**
   * Switch the visible mobile pane. Preview → view mode; Markdown → edit mode
   * with the first markdown file loaded.
   */
  async function selectMobileTab(tab: MobileTab): Promise<void> {
    if (tab === "markdown") {
      if (openFileIsCss && lifecycle.currentDir) {
        const path = await defaultEditorFile(lifecycle.currentDir, true);
        if (path) await selectEditorFile(path);
      } else {
        void ensureEditorFile();
      }
      setPaneMode(paneModeForTab(tab));
      focusEditorWhenReady();
      return;
    }
    setPaneMode(paneModeForTab(tab));
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
   * M2: Hide the render-progress overlay, and ONLY hide it. This backs the
   * pane overlay used for an initial/retry render; save-triggered hot reloads
   * are double-buffered and remain ambient. Routing this through stopPreview()
   * (as it used to) would silently close the whole project. The render itself
   * is NOT aborted: the iframe stays mounted and visible to avoid Chromium's
   * cross-origin throttle. lifecycle.currentDir/editor/buffer stay untouched.
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
   * folder workspace exists (`!lifecycle.currentDir`) — there is no live workspace to interrupt
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
     (no preview pane exists yet). Scoped below the toolbar (--app-z-overlay) and
     all dialogs (1000+). This does NOT cover the preview pane or editor during
     layout — that's handled by the pane-scoped overlay inside .preview-pane.
     M2: this is the ONE place a real cancel-and-close is offered — safe here
     because no project session/preview exists yet (see handleCancelOpen). -->
{#if lifecycle.busy && !!lifecycle.busyLabel && !lifecycle.currentDir && !landingVisible}
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
      <span class="export-success" aria-hidden="true"><Icon name="check" size={14} /></span>
    {:else}
      <span class="export-spinner" aria-hidden="true"></span>
    {/if}
    <span class="export-label">{exportController.pdfProgress}</span>
    {#if exportController.state !== "success" && exportController.state !== "canceling"}
      <button class="export-cancel" onclick={() => exportController.cancelExport()} disabled={!exportController.activeExportId}>Cancel</button>
    {/if}
  </div>
{/if}

<svelte:head>
  <title>{lifecycle.docTitle ? `${lifecycle.docTitle} — Gutterpress` : "Gutterpress"}</title>
</svelte:head>

<!-- inert while the start screen or full-window Settings view is up: the
      workspace keeps rendering, but never accepts interaction underneath. -->
<div class="app-root" inert={landingVisible || projectSettingsOpen}>
{#if (updateController.readyVersion || updateController.availableVersion) && !updateController.bannerDismissed}
  <div class="update-banner" role="status" aria-live="polite">
    {#if updateController.readyVersion}
      <span class="update-banner-msg">Update ready (v{updateController.readyVersion})</span>
      <button class="update-apply" onclick={() => updateController.applyNow()}>Restart &amp; update</button>
    {:else}
      <span class="update-banner-msg">Update available (v{updateController.availableVersion})</span>
      <button class="update-apply" onclick={() => updateController.download()} disabled={updateController.downloading}>
        {updateController.downloading
          ? updateController.availableAction === "open-release" ? "Opening…" : "Downloading…"
          : updateController.availableAction === "open-release" ? "Download from GitHub" : "Download"}
      </button>
    {/if}
    <button class="update-later" onclick={() => updateController.dismissBanner()}>Later</button>
  </div>
{/if}

<!-- Missing author identity — a standing notice, not a toast: it stays until
     the two fields exist, because every version saved without them records the
     wrong author. role="status" (not "alert"): a standing condition the author
     can act on whenever, never an interruption to announce over their typing.
     Dismissible, because the check reads the app setting only and a project's
     own .git/config may already supply the identity — see the
     identityNoticeDismissed note above. -->
{#if needsGitIdentity}
  <div class="identity-banner" role="status">
    <span class="identity-banner-msg">
      Add your name and email so the versions you save show who made each change.
    </span>
    <button class="identity-action" onclick={() => openSettings("connections")}>
      Add your name &amp; email
    </button>
    <button class="identity-dismiss" onclick={() => (identityNoticeDismissed = true)}>
      Not now
    </button>
  </div>
{/if}

<div class="shell">
  <AppToolbar
    bind:panelToggleEl={leftPanelToggleBtn}
    {leftPanelOpen}
    onToggleLeftPanel={toggleLeftPanel}
    sourceMode={lifecycle.sourceMode}
    currentUrl={lifecycle.currentUrl}
    docTitle={lifecycle.docTitle}
    folderTitle={lifecycle.currentDir ? displayTitle : null}
    folderTooltip={lifecycle.currentDir}
    onOpenInBrowser={openInBrowser}
    {pageNav}
    rendering={lifecycle.rendering}
    showPageNav={!!lifecycle.previewUrl && !isNarrow}
    {isNarrow}
    {mobileTab}
    onSelectMobileTab={selectMobileTab}
    editorTabDisabled={!toolbarProjectOpen}
    previewTabDisabled={!lifecycle.previewUrl && !lifecycle.previewError}
    hidePreviewControls={isNarrow && editorPaneOpen}
    {mode}
    onSetMode={(next) => { contextMenu.close(); setMode(next); }}
    {zoom}
    previewControlsDisabled={!lifecycle.previewUrl}
    onApplyZoom={(val) => { contextMenu.close(); zoomView.applyZoom(val); }}
    editorToggleDisabled={!toolbarProjectOpen}
    publishVisible={isDesktop()}
    publishDisabled={lifecycle.busy || !lifecycle.currentDir || lifecycle.sourceMode === "url"}
    onPublish={() => (publishOpen = true)}
    {canSavePdf}
    exporting={exportController.exporting}
    {exportDisabled}
    onOpenExport={() => (exportOpen = true)}
    bind:exportBtnEl
    {exportHints}
    exportWarning={canSavePdf ? lifecycle.saveWarning : null}
    saving={forceSaving}
    saveDisabled={!editorFilePath || forceSaving || editorSavePhase === "clean"}
    savePending={!!editorFilePath && editorSavePhase !== "clean"}
    onSave={handleForceSave}
    showProjectSettings={toolbarProjectOpen && isDesktop()}
    onOpenProjectSettings={openProjectConfig}
  />

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
        if (!editorVisible && lifecycle.currentDir && lifecycle.sourceMode === "folder") {
          // A file was just selected in the tree, so no ensureEditorFile needed.
          openEditorPane({ ensureFile: false });
        }
      }}
      onBeforeRenameOpenFile={onTreeBeforeRename}
      onBeforeDeleteOpenFile={onTreeBeforeDelete}
      onFileRenamed={onTreeFileRenamed}
      onFileDeleted={onTreeFileDeleted}
      onInsertImage={(payload) => insertImageIntoChapter(payload)}
      onProjectChosen={(path) => void openProjectPath(path)}
      onOpenUrl={openUrl}
      onOpenGitHub={isDesktop() ? () => { contextMenu.close(); void inlineEdit.endActive(true); githubOpen = true; } : undefined}
      onNewProject={() => { contextMenu.close(); void inlineEdit.endActive(true); newProjectWizardRef?.show(); }}
      onShowWelcome={() => {
        contextMenu.close();
        landingRef?.showTab("projects");
        landingForcedOpen = true;
      }}
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

  {#if lifecycle.previewUrl || (lifecycle.sourceMode === "folder" && lifecycle.currentDir)}
    <div
      class="workspace"
      class:editor-open={editorPaneOpen}
      class:narrow={isNarrow}
      class:show-edit={isNarrow && editorPaneOpen}
      class:show-view={isNarrow && !editorPaneOpen}
      class:preview-hidden={!previewVisible}
      class:preview-collapsed={!previewVisible}
      bind:this={workspaceEl}
      style="--kbd-offset: {keyboardInset}px; {previewCollapseGridColumns ? `grid-template-columns: ${previewCollapseGridColumns};` : splitGridColumns ? `grid-template-columns: ${splitGridColumns};` : ''}"
    >
      {#if editorPaneOpen}
        <section
          class="pane editor-pane"
          id="mobile-panel-editor"
          role={isNarrow ? "tabpanel" : undefined}
          aria-label={openFileIsCss ? "CSS editor" : "Markdown editor"}
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
              richMode={richSurfaceActive}
              richModeAvailable={richModeAvailable}
              onToggleRichMode={() => setRichMode(richMode.mode === "rich" ? "source" : "rich")}
              onOpenImageProperties={() => void openRichImageProperties()}
              onAction={(action, payload) => {
                if (action === "snippet") {
                  openSnippetPicker();
                  return;
                }
                if (action === "focus-mode") {
                  togglePreview();
                  return;
                }
                // SFE-P3d-parity, Lane D — each handler below branches on
                // richSurfaceActive itself, so intercepted here BEFORE the
                // richSurfaceActive/runToolbarAction split below, same as
                // "snippet"/"focus-mode" above.
                if (action === "image-properties") {
                  void handleImagePropertiesAtCaret();
                  return;
                }
                if (action === "image-unwrap") {
                  void handleImageUnwrapAtCaret();
                  return;
                }
                if (action === "link-edit") {
                  void handleLinkEditAtCaret();
                  return;
                }
                if (richSurfaceActive) {
                  handleRichToolbarAction(action, payload);
                  return;
                }
                editorRef?.runToolbarAction(action, payload);
              }}
              onSave={handleForceSave}
            />
            {#if richSurfaceActive}
              <!-- SFE-P3ab, Lane A — rich mode's own DOM subtree. The
                   wrapper's `use:trackSurfaceMount` and this branch's
                   exclusivity with the MarkdownEditor branch below TOGETHER
                   give D7's "exactly one editing surface mounted" invariant
                   both its structural guarantee (this {#if}/{:else}) and its
                   asserted one (the controller throws on a violation). -->
              <div
                style="display:contents"
                use:trackSurfaceMount={{ controller: richMode, surface: "rich" }}
              >
                {#if !editorFilePath}
                  <div class="editor-loading" role="status" aria-live="polite">
                    Select a file from the list to start editing.
                  </div>
                {:else if RichEditorComponent && richDocHost}
                  <!-- Keyed on the host itself: a fresh host means a fresh
                       mount/dispose cycle — a real new undo epoch, not a
                       simulated one (see richDocHost's own comment above). -->
                  {#key richDocHost}
                    <RichEditorComponent
                      bind:this={richEditorRef}
                      host={richDocHost}
                      projection={richProjection ?? undefined}
                      extraCss={richPluginCss}
                      onDiagnostic={showRichDiagnostic}
                    />
                  {/key}
                {:else if richEditorModuleFailed}
                  <div class="editor-loading" role="alert">
                    <p>The rich editor failed to load.</p>
                    <button class="primary app-btn-primary" onclick={retryRichEditorLoad}>Retry</button>
                  </div>
                {:else}
                  <div class="editor-loading" role="status" aria-live="polite">
                    Loading rich editor…
                  </div>
                {/if}
              </div>
            {:else if MarkdownEditor}
              <!-- No per-file `{#key}` remount: MarkdownEditor keeps ONE
                   EditorView, while EditorFileSession gives it exactly ONE
                   source file via a synchronous switchFile() handoff.
                   `bind:this={sourceEditorHostEl}` (SFE-P3d-parity, Lane D)
                   is this wrapper's own DOM node, used ONLY to locate the
                   mounted CodeMirror view from outside the component via
                   `source-editor-access.ts`'s `EditorView.findFromDOM` —
                   see that module's header for why (MarkdownEditor.svelte
                   is outside this lane's write ownership). -->
              <div
                bind:this={sourceEditorHostEl}
                style="display:contents"
                use:trackSurfaceMount={{ controller: richMode, surface: "source" }}
              >
                <MarkdownEditor
                  bind:this={editorRef}
                  filePath={editorFilePath}
                  content={editorContent}
                  onChange={onEditorChange}
                  onSave={() => void handleForceSave()}
                  onAnchorLine={(line, origin) =>
                    editorSync.onEditorAnchorLine(line, origin, editorChapter)}
                />
              </div>
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
        {#if !isNarrow && previewVisible}
          <!-- Focusable separator (ARIA window-splitter pattern): drag, or
               Arrow-key resize / double-click reset for the non-drag path
               (#103, WCAG 2.2 SC 2.5.7). A <div>, not a <button> — a button
               may not take role="separator". A focusable role="separator" IS
               interactive per the ARIA spec; the svelte a11y linter doesn't
               model that pattern (mirrors LeftPanel's resize-handle). -->
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <div
            class="splitter"
            class:dragging={zoomView.draggingSplit}
            role="separator"
            aria-orientation="vertical"
            aria-controls="mobile-panel-editor mobile-panel-preview"
            tabindex="0"
            aria-label="Resize editor and preview panes"
            aria-valuenow={Math.round(zoomView.splitPaneRatio * 100)}
            aria-valuemin={25}
            aria-valuemax={75}
            title="Resize editor and preview panes. Drag or use arrow keys; double-click to reset."
            onpointerdown={startSplitDrag}
            onpointermove={moveSplitDrag}
            onpointerup={stopSplitDrag}
            onpointercancel={stopSplitDrag}
            ondblclick={resetSplit}
            onkeydown={onSplitKeydown}
          ></div>
        {/if}
      {/if}
      <section
        class="pane preview-pane"
        use:previewPaneResize
        id="mobile-panel-preview"
        role={isNarrow ? "tabpanel" : undefined}
        aria-labelledby={isNarrow ? "mobile-tab-preview" : undefined}
        aria-hidden={!previewVisible}
        inert={!previewVisible || (isNarrow && (editorPaneOpen || editorView !== "editor")) ? true : undefined}
      >
        <FindBar bind:this={findBarRef} bind:open={findBarOpen} {client} />
        {#if lifecycle.previewUrl}
          {#key lifecycle.previewUrl}
            <PreviewFrame
              bind:this={previewFrameRef}
              url={lifecycle.previewUrl}
              bind:client
              onClientReady={onClientReady}
              onError={(msg) => {
                if (lifecycle.sourceMode === "url") {
                  lifecycle.urlPreviewError = "This website could not be previewed inside Gutterpress.";
                } else {
                  toast?.error(msg);
                }
              }}
            />
          {/key}
        {:else if previewErrorDisplay}
          <div class="preview-error-view" role="alert">
            <div class="preview-error-card">
              <p class="preview-error-eyebrow">Preview needs attention</p>
              <h2>{previewErrorDisplay.title}</h2>
              <p>{previewErrorDisplay.message}</p>
              <div class="preview-error-actions">
                <button
                  class="primary app-btn-primary"
                  onclick={() => void lifecycle.retryPreview()}
                  disabled={lifecycle.busy}
                >
                  {lifecycle.busy ? "Trying preview…" : "Try preview again"}
                </button>
                <button class="ghost" onclick={showPreviewFiles}>Show files</button>
              </div>
              <details>
                <summary>Technical details</summary>
                <pre>{previewErrorDisplay.details}</pre>
              </details>
            </div>
          </div>
        {/if}
        {#if previewUpdating}
          <div class="preview-updating-pill" role="status" aria-live="polite">
            <span aria-hidden="true"></span>
            Updating preview…
          </div>
        {/if}
        <!-- RC3-1: Pane-scoped overlay — position:absolute within .preview-pane
             (which has position:relative). Covers ONLY the preview area; the
             editor pane, toolbar, and all dialogs remain fully interactive.
             z-index:10 (above the iframe, below any stacking context above).
             M2: onCancel (handleCancelRender) only HIDES the overlay; it does
             NOT tear down the project. Save-triggered reloads use the ambient
             double-buffered shell and do not mount this overlay. -->
        <LoadingOverlay
          visible={lifecycle.rendering || lifecycle.renderCompleteOverlay}
          label={lifecycle.renderCompleteOverlay ? "Rendering complete…" : lifecycle.renderProgressPage > 0 ? `Laying out page ${lifecycle.renderProgressPage}…` : "Rendering…"}
          onCancel={lifecycle.rendering ? handleCancelRender : undefined}
          variant="pane"
        />
        {#if isDesktop()}
          <ContextMenu controller={contextMenu} />
        {/if}
      </section>
    </div>
  {/if}

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
    hasRemote={projectSession.projectHasRemote}
    canSnapshot={!!(projectSession.projectCapabilities?.canSnapshot)}
    savePhase={editorSavePhase}
    fileOpen={!!editorFilePath}
    {forceSaving}
    forceSyncing={syncController.forceSyncing}
    problems={displayedProblems}
    problemsLoading={problemsLoading}
    {problemsError}
    bind:problemsOpen={problemsOpen}
    books={projectSession.books}
    activeBookDir={projectSession.activeBookDir}
    onSwitchBook={(path) => void switchBook(path)}
    onProblemSelect={openProblem}
    onReconnect={onSyncReconnect}
    onConnectOnline={onSyncReconnect}
    onShowLog={showProjectLog}
    onForceSave={handleForceSave}
    onForceSync={() => syncController.handleForceSync()}
    onSaveVersion={async () => {
      const dir = lifecycle.currentDir;
      if (!dir) return;
      try {
        await api.vcs.saveSnapshot(dir);
        toast?.success("Saved a version.");
        activityViewRef?.refreshHistory();
      } catch (e) {
        toast?.error(friendlyHostError(e instanceof Error ? e.message : String(e)));
        throw e;
      }
    }}
    onOpenSettings={openSettings}
    onOpenHelp={openHelp}
  />
</div>
</div>

<!-- Start screen: interactive cover over the (pre-rendering) workspace. Sits
     outside .app-root so it is never inert. -->
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
  version={appVersion}
  showAtStartup={landingShowPref}
  projectDir={lifecycle.currentDir}
  dismissible={landingDismissible}
  updateReadyVersion={updateController.readyVersion}
  updateAvailableVersion={updateController.availableVersion}
  updateAvailableAction={updateController.availableAction}
  updateDownloading={updateController.downloading}
  checkingUpdates={updateController.checking}
  onContinue={() => dismissLanding()}
  onOpenPath={(path) => void openProjectPath(path)}
  onSwitchBook={(path) => void switchBook(path)}
  onOpenUrl={openUrl}
  onBrowse={() => void browseFromLanding()}
  onNewProject={() => newProjectWizardRef?.show()}
  onOpenGitHub={isDesktop() ? () => (githubOpen = true) : undefined}
  onOpenGuide={openSetupGuide}
  onWhatsNew={openReleaseNotes}
  onToggleShowAtStartup={setLandingStartupPref}
  onUpdateApply={() => updateController.applyNow()}
  onUpdateDownload={() => updateController.download()}
  onCheckForUpdates={() => updateController.check()}
  onDismiss={() => dismissLanding()}
  settingsTab={landingSettingsTab}
  onCrashRecoveryChange={(enabled) => { buffer?.setRecoveryEnabled(enabled); }}
/>
{#if projectSettingsOpen}
  <!-- Project settings (manifest): full-window like the app settings. Keyed by
       projectDir so a project switch can never leave stale section state
       (drafts, theme lists) resident under the new project. -->
  <section class="settings-global-view" aria-label="Project settings">
    {#key lifecycle.currentDir}
      <ProjectSettingsView
        projectDir={lifecycle.currentDir}
        repoRoot={projectSession.repoRoot}
        {toast}
        onClose={closeProjectSettings}
        onEditRawCss={(path) => { closeProjectSettings(); openStyleFile(path); }}
        onOpenAccounts={() => { closeProjectSettings(); openSettings("connections"); }}
      />
    {/key}
  </section>
{/if}

<GitHubDialog
  bind:open={githubOpen}
  onOpened={(projectDir) => {
    invalidateDiscoveredProjects(); // a fresh clone is a new discoverable book
    return openProjectPath(projectDir, "Opening your project…");
  }}
  onAdvancedSetup={() => openSettings("connections")}
  onClosed={onConnectDialogClosed}
  triggerEl={leftPanelToggleBtn}
/>
{#if publishOpen}
  <!-- Mounted fresh on open so the wizard loads providers in onMount and resets
       to step 1 (no $effect, per CLAUDE.md §8). -->
  <PublishWizard
    controller={publishController}
    onClose={() => (publishOpen = false)}
    onNavigate={(entry) => {
      // A preflight "Go to" — close the modal wizard, then reveal the finding
      // in the editor via the shared Problems-panel navigation affordance.
      publishOpen = false;
      openProblem(entry);
    }}
  />
{/if}
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
  onInsert={(text) => {
    if (richSurfaceActive) {
      // SFE-P3ab review round 1 (CONFIRMED finding): refuse rather than
      // silently insert against a stale/absent capture — see
      // `richSnippetCapture`'s and `NO_LIVE_CARET_DIAGNOSTIC`'s own headers.
      if (!richSnippetCapture || !isRichSelectionCaptureFresh(richSnippetCapture)) {
        showRichDiagnostic(diagnosticForEditRejection("stale"));
      } else if (!richSnippetCapture.selection) {
        showRichDiagnostic(NO_LIVE_CARET_DIAGNOSTIC);
      } else {
        reportRichOutcome(applyRichAppend(richSnippetCapture.host, text, richSnippetCapture.selection));
      }
      return;
    }
    editorRef?.insertSnippet(text);
  }}
/>
<!-- Export dialog: format (PDF / HTML / template) + settings for the toolbar
     Export button. Mounted fresh per open so its state resets. -->
{#if exportOpen}
  <ExportDialog
    projectDir={lifecycle.currentDir}
    {canSavePdf}
    {toast}
    triggerEl={exportBtnEl}
    onExportPdf={(opts) => void exportController.savePdf(opts)}
    onExportHtml={() => void exportController.exportHtml()}
    onClose={() => (exportOpen = false)}
  />
{/if}
{#if textPrompt}
  <TextPromptDialog
    title={textPrompt.title}
    label={textPrompt.label}
    initialValue={textPrompt.initialValue}
    options={textPrompt.options}
    onDone={finishTextPrompt}
  />
{/if}

{#if imagePropertiesPrompt}
  <ImagePropertiesDialog
    initialValue={imagePropertiesPrompt.initialValue}
    onDone={finishImageProperties}
  />
{/if}

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
  /* When panel is closed, the LeftPanel keeps its width (300px by default)
     but translateX(-100%)
     so it's off-screen. Margin-left on .main-content compensates: 0 when open,
     that width when closed so main-content fills the full width. */
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
     The LeftPanel is always in DOM but translateX(-100%) so its flex width
     even when off-screen. We compensate with a negative margin-left. */
  .left-panel-region:not(.panel-open) .main-content {
    margin-left: calc(-1 * var(--left-panel-width, 300px));
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
  .settings-global-view {
    position: fixed;
    inset: 0;
    z-index: calc(var(--app-z-sheet) + 1);
    display: flex;
    background: var(--app-bg);
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
  .splitter.dragging {
    background: var(--app-focus-ring);
    outline: none;
  }
  /* WCAG 2.2 SC 2.4.7: the keyboard-resizable splitter needs a visible focus
     ring (it's a focusable separator / window splitter). */
  .splitter:focus-visible {
    background: var(--app-focus-ring);
    outline: 2px solid var(--app-focus-ring);
    outline-offset: 1px;
  }

  @media (prefers-reduced-motion: reduce) {
    /* Honour reduced motion for the layout shift a panel toggle triggers. */
    .left-panel-region .main-content {
      transition: none;
    }
  }
  .editor-loading {
    flex: 1;
    display: grid;
    place-items: center;
    padding: 24px;
    color: var(--app-text-muted);
    font-size: 13px;
  }
  .preview-pane {
    position: relative;
  }
  .preview-updating-pill {
    position: absolute;
    top: 10px;
    right: 12px;
    z-index: 9;
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 6px 10px;
    border: 1px solid var(--app-border);
    border-radius: 999px;
    background: color-mix(in srgb, var(--app-surface-raised) 92%, transparent);
    box-shadow: 0 2px 8px var(--app-shadow-md);
    color: var(--app-text-secondary);
    font-size: 12px;
    pointer-events: none;
  }
  .preview-updating-pill span {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--app-focus-ring);
    animation: preview-update-pulse 0.9s ease-in-out infinite alternate;
  }
  @keyframes preview-update-pulse {
    to { opacity: 0.35; }
  }
  .preview-error-view {
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: grid;
    place-items: center;
    padding: clamp(20px, 5vw, 64px);
    background:
      radial-gradient(circle at 50% 20%, color-mix(in srgb, var(--app-error-strong) 10%, transparent), transparent 45%),
      var(--app-bg);
  }
  .preview-error-card {
    width: min(680px, 100%);
    padding: clamp(22px, 4vw, 38px);
    border: 1px solid color-mix(in srgb, var(--app-error-strong) 45%, var(--app-border));
    border-radius: 12px;
    background: var(--app-surface-raised);
    box-shadow: 0 18px 50px var(--app-shadow-md);
  }
  .preview-error-card h2 {
    margin: 4px 0 10px;
    color: var(--app-text);
    font-size: clamp(20px, 3vw, 28px);
  }
  .preview-error-card > p:not(.preview-error-eyebrow) {
    margin: 0;
    color: var(--app-text-muted);
    line-height: 1.55;
  }
  .preview-error-eyebrow {
    margin: 0;
    color: var(--app-error-text);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .preview-error-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 22px;
  }
  .preview-error-card details {
    margin-top: 22px;
    border-top: 1px solid var(--app-border-subtle);
    padding-top: 14px;
    color: var(--app-text-muted);
  }
  .preview-error-card summary {
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
  }
  .preview-error-card pre {
    max-height: 220px;
    margin: 12px 0 0;
    overflow: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font: 12px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace;
    color: var(--app-text);
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
    z-index: calc(var(--app-z-sheet) + 50);
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
    display: inline-flex;
    align-items: center;
    flex: 0 0 auto;
    color: var(--app-success-text);
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

  /* ---- Toolbar ----
     The toolbar markup, layout, and responsive collapse rules live in
     AppToolbar.svelte now (a 3-column grid + container queries). Only the
     generic button primitives shared by the remaining +page surfaces
     (banners, dialogs) stay here. */
  section { display: flex; align-items: center; gap: 6px; min-width: 0; }

  /* ---- Buttons & inputs ---- */
  /* Geometry shared by ALL +page buttons (banner actions, export pill,
     save-as-template dialog), including the primary variants (they inherit
     padding/radius/border box from here; only their COLOUR differs). border
     is split into width/style so a variant's own border-COLOUR isn't
     clobbered. */
  button {
    border-width: 1px;
    border-style: solid;
    padding: 5px 10px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
  }
  /* Neutral fill — NON-primary, NON-active buttons only. The exclusion is
     load-bearing: a bare `button { background }` rule is (0,1,1) once Svelte
     scopes it, which would beat both the global `.app-btn-primary` recipe
     (0,1,0) and leave primary buttons rendering as neutral controls (the L5
     convergence's whole point). `.primary` buttons always carry
     `.app-btn-primary`, so excluding that class is the precise gate. */
  button:not(.app-btn-primary):not(.active) {
    background: var(--app-control-bg);
    border-color: var(--app-control-border);
    color: var(--app-control-text);
  }
  button:not(.app-btn-primary):not(.active):hover:not(:disabled) {
    background: var(--app-control-hover-bg);
    border-color: var(--app-control-hover-border);
  }
  /* The primary-button color recipe (gradient/hover/border-color/font-weight)
     used to be duplicated here as `button.primary { ... }`. It now lives in
     theme.css's `.app-btn-primary` (UX review L5 — the ONE primary variant);
     every `class="primary"` button in this file's template also carries
     `app-btn-primary`, which supplies the color. `.primary` itself is kept as
     a plain semantic marker class with no CSS of its own. */
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

  /* (Toolbar control styles — icon buttons, menus, segmented groups, page
     select, titles, separators, hints — moved to AppToolbar.svelte.) */

  /* (Empty-state hero styles removed — the WelcomeLanding component is the
     app's single "nothing open" surface and carries its own styles.) */

  .adopt-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    padding: 8px 14px;
    background: var(--app-info-bg);
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
    /* Width/style only — .app-btn-primary / .ghost own border-color. */
    border-width: 1px;
    border-style: solid;
  }
  /* Primary colors come from the shared .app-btn-primary recipe (theme.css). */
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
  .update-later:hover { background: var(--app-scrim-strong); }

  /* Missing-identity notice — same banner geometry as the updater's, in the
     warning palette so the two never read as the same kind of message. */
  .identity-banner {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 16px;
    background: var(--app-warning-bg);
    border-bottom: 1px solid var(--app-warning-border);
    color: var(--app-warning-text);
    font-size: 13px;
    flex-shrink: 0;
  }
  .identity-banner-msg { flex: 1; }
  /* Geometry only. `button:not(.app-btn-primary):not(.active)` above owns the
     fill, border-COLOR and text of every non-primary button in this file and
     wins on specificity (0,3,1 vs a scoped class's 0,2,0) — so this action
     takes the same neutral control look the update banner's buttons do, and
     restating those three properties here would be dead CSS. Border width and
     style still have to be declared: the shared rule sets only the color. */
  .identity-action {
    border: 1px solid;
    border-radius: 6px;
    padding: 4px 12px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }
  .identity-action:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 2px; }
  /* "Not now" reads as the quieter of the two: no border of its own. Fill and
     text still come from the shared non-primary rule (see above), so only the
     border is declared here. */
  .identity-dismiss {
    border: none;
    border-radius: 6px;
    padding: 4px 10px;
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
  }
  .identity-dismiss:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 2px; }

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

  /* #34 Touch targets on coarse pointers: the editor's own formatting toolbar
     buttons are finger-driven on a phone (the main toolbar's touch sizing
     lives in AppToolbar.svelte). */
  @media (pointer: coarse) {
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

</style>
