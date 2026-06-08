<script lang="ts">
  import PreviewFrame from "$lib/components/PreviewFrame.svelte";
  import ChapterList from "$lib/components/ChapterList.svelte";
  import FileTree from "$lib/components/FileTree.svelte";
  import ExternalEditBanner from "$lib/components/ExternalEditBanner.svelte";
  import CrashRecoveryDialog from "$lib/components/CrashRecoveryDialog.svelte";
  import type { RecoveryItem } from "$lib/components/CrashRecoveryDialog.svelte";
  import { EditorBuffer } from "$lib/editor/buffer-state.svelte";
  import Toast from "$lib/components/Toast.svelte";
  import type { ToastController } from "$lib/components/Toast.svelte";
  import type { ProjectCapabilities } from "$lib/platform/contract";
  import LoadingOverlay from "$lib/components/LoadingOverlay.svelte";
  import HelpDialog from "$lib/components/HelpDialog.svelte";
  import SettingsDialog from "$lib/components/SettingsDialog.svelte";
  import OpenLocationDialog from "$lib/components/OpenLocationDialog.svelte";
  import NewProjectWizard from "$lib/components/NewProjectWizard.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { PreviewClient } from "$lib/preview-client";
  import { buildViewerStyles, DEBUG_STYLES } from "$lib/iframe-styles";
  import { getPlatform, isDesktop } from "$lib/platform";
  import { useSettings, _loadSettings } from "$lib/settings.svelte";

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
  let currentUrl = $state<string | null>(null);
  let sourceMode = $state<"folder" | "url">("folder");
  let docTitle = $state<string | null>(null);
  // Capabilities of the open project's source (#12): local-folder vs
  // local-git-folder (with/without remote). Stored so forthcoming action
  // buttons (#13/#25 — Save Snapshot, View History, Publish) can render against
  // it. No new buttons yet; the data is simply available.
  let projectCapabilities = $state<ProjectCapabilities | null>(null);
  // Folder name (basename) for the toolbar label; the full path is the tooltip.
  let folderName = $derived(
    currentDir ? (currentDir.split(/[\\/]/).filter(Boolean).pop() ?? currentDir) : ""
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

  // Frame state
  let client = $state<PreviewClient | undefined>(undefined);
  let currentPage = $state(1);
  let totalPages = $state(0);
  let pageEditing = $state(false);
  let pageEditValue = $state("1");
  let pageEditInput = $state<HTMLInputElement | undefined>(undefined);
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
  let openBtn = $state<HTMLButtonElement | undefined>(undefined);
  // New-project wizard (#25)
  let newProjectOpen = $state(false);
  let newProjectBtn = $state<HTMLButtonElement | undefined>(undefined);
  // Official setup guide for first-time writers (MVP "Download starter template").
  const SETUP_GUIDE_URL =
    "https://github.com/dimm-city/print-md/blob/main/examples/print-md-user-guide/01-getting-started.md";

  function openSetupGuide() {
    getPlatform().openExternal(SETUP_GUIDE_URL).catch(() => {});
  }

  // ── Chapter-list sidebar (#42) ──────────────────────────────────────────
  // A collapsible left sidebar listing the project's .md chapters (and .css
  // stylesheets separately). Open/closed state persists across sessions via
  // ViewerPrefs.sidebarOpen. On narrow viewports it renders as a bottom-sheet
  // drawer with a backdrop (CSS-driven). Clicking a chapter fires
  // selectEditorFile so it opens in the editor pane (#38) when one is present;
  // in a preview-only build it simply records the active path.
  let sidebarOpen = $state(false);
  let sidebarPrefsLoaded = $state(false);

  // Load the persisted sidebar state once on mount (desktop only).
  $effect(() => {
    if (!isDesktop() || sidebarPrefsLoaded) return;
    sidebarPrefsLoaded = true;
    getPlatform()
      .getViewerPrefs()
      .then((prefs) => {
        if (typeof prefs.sidebarOpen === "boolean") sidebarOpen = prefs.sidebarOpen;
      })
      .catch(() => {});
  });

  function toggleSidebar() {
    sidebarOpen = !sidebarOpen;
    if (isDesktop()) {
      getPlatform().setViewerPrefs({ sidebarOpen }).catch(() => {});
    }
  }

  function onSelectChapter(path: string) {
    // Hand off to the editor seam (#38).
    selectEditorFile(path);
    // Clicking a chapter must reliably SHOW the file (issue #42 acceptance:
    // "clicking switches the editor content"). The chapter-list sidebar and
    // the editor pane are independent toggles, so on desktop folder projects
    // we open the editor pane (if closed) and move focus into it — mirroring
    // toggleEditor. In preview-only/url mode this just marks the active
    // chapter so the sidebar highlight tracks the selection.
    if (currentDir && sourceMode === "folder") {
      const wasClosed = !editorOpen;
      editorOpen = true;
      if (wasClosed) focusEditorWhenReady();
    }
    // On the mobile bottom-sheet drawer, picking a chapter dismisses it.
    if (window.matchMedia("(max-width: 640px)").matches) {
      sidebarOpen = false;
      if (isDesktop()) getPlatform().setViewerPrefs({ sidebarOpen: false }).catch(() => {});
    }
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
  let editorRef = $state<{ focus: () => void } | null>(null);

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
    if (!editorOpen || !currentDir || MarkdownEditor || editorModuleLoading) return;
    editorModuleLoading = true;
    import("$lib/components/MarkdownEditor.svelte")
      .then((m) => {
        MarkdownEditor = m.default;
      })
      .catch((e) => {
        editorModuleLoading = false;
        toast?.error(
          `Could not open the editor: ${e instanceof Error ? e.message : String(e)}`,
        );
      });
  });

  // Construct lazily on first desktop use so the WebAdapter path never touches
  // it (the editor is desktop-only). One buffer for the lifetime of the app.
  let buffer = $state<EditorBuffer | null>(null);

  // Mirrors used by the markup/props (chapter highlight, dirty dot, editor pane).
  let editorFilePath = $derived(buffer?.filePath ?? null);
  let editorContent = $derived(buffer?.content ?? "");
  let dirtyPath = $derived(buffer && buffer.isDirty ? buffer.filePath : null);

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

  function basenameOf(p: string): string {
    return p.split(/[\\/]/).pop() ?? p;
  }

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
        const dir = prefs.lastProjectDir;
        if (!dir || previewUrl || currentDir || currentUrl) return;
        // Per-project state (#43) is keyed by folder path so opening a
        // different project never pollutes this one's restore point.
        const restoreState = await platform
          .getViewerProjectState(dir)
          .catch(() => null);
        return startFolderPreview(dir, "Reopening previous folder…", restoreState);
      })
      .catch(() => {})
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
        renderCompleteOverlay = true;
        setTimeout(() => {
          renderCompleteOverlay = false;
        }, 700);
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
        applyViewMode(mode, false);
        // Apply fit-width zoom on narrow screens
        if (window.innerWidth < 1280) {
          applyFitWidthZoom();
        } else {
          client?.call("setZoom", [zoom === "fit-width" ? 1 : Number(zoom)]).catch(() => {});
        }
        if (restorePage && restorePage > 1) {
          queueMicrotask(() => restoreProjectPage(restorePage));
        }
        // UX-011: improved success toast copy
        toast?.success(`Your book is ready — ${n} ${n === 1 ? 'page' : 'pages'}`);
      } else if (e.name === "pageChanged") {
        if (rendering) {
          renderProgressPage = e.detail.totalPages ?? renderProgressPage;
          totalPages = e.detail.totalPages ?? totalPages;
        } else {
          syncPageState(e.detail);
        }
      } else if (e.name === "ready") {
        rendering = true;
        renderProgressPage = 0;
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
      // Cmd/Ctrl+B toggles the chapter-list sidebar (#42).
      if ((e.ctrlKey || e.metaKey) && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        toggleSidebar();
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

      // UX-006: Ctrl/Cmd+S saves PDF
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        savePdf();
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
    restoreState: PersistedProjectState | null = null
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
      const data = await platform.startPreview({ input: dir });
      sourceMode = "folder";
      // New folder: flush + clear any file selected from a previous project so
      // the editor pane doesn't point at a stale path (#44 — flush first so a
      // pending save in the prior project isn't dropped on project switch).
      if (currentDir !== dir && buffer) {
        await buffer.flush().catch(() => {});
        buffer.reset();
      }
      currentDir = dir;
      currentUrl = null;
      // Classify the opened folder (#12) so capability-gated actions (#13/#25)
      // can render. Always re-detected on open (a user may add/remove `.git`
      // between sessions) and persisted as a hint. Fire-and-forget: a failure
      // must never block the preview.
      projectCapabilities = null;
      platform
        .classifyProject(dir)
        .then((result) => {
          projectCapabilities = result.capabilities;
          platform
            .setViewerPrefs({ projectSource: result.source })
            .catch(() => {});
        })
        .catch(() => {
          projectCapabilities = null;
        });
      docTitle = data.title ?? null;
      // Force iframe remount by nulling first
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
      const dir = await platform.openFolder();
      if (!dir) return;
      // Per-project state (#43): restore whatever was saved for THIS folder
      // (page, view mode, …) regardless of which project was last open.
      const restoreState = await platform
        .getViewerProjectState(dir)
        .catch(() => null);
      handedOff = true;
      await startFolderPreview(dir, "Starting preview…", restoreState);
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
    docTitle = null;
    // The editor is folder-only; close it for web previews.
    editorOpen = false;
    buffer?.reset();
    // Force iframe remount by nulling first
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
    const sep = inputDir.includes("\\") ? "\\" : "/";
    const defaultName = (inputDir.split(sep).pop() ?? "book") + ".pdf";
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
        input: inputDir,
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
  const NARROW_QUERY = "(max-width: 820px)";
  let isNarrow = $state(false);
  $effect(() => {
    const mq = window.matchMedia(NARROW_QUERY);
    isNarrow = mq.matches;
    const onChange = (e: MediaQueryListEvent) => (isNarrow = e.matches);
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
</script>

<Toast bind:api={toast} />

<CrashRecoveryDialog
  items={recoveryItems}
  onRestore={restoreRecovery}
  onDiscard={discardRecovery}
  onDismiss={dismissRecovery}
/>
<LoadingOverlay
  visible={rendering || renderCompleteOverlay || (busy && !!busyLabel)}
  label={busyLabel || (renderCompleteOverlay ? "Rendering complete" : renderProgressPage > 0 ? `Laying out page ${renderProgressPage}…` : "Rendering…")}
  onCancel={rendering ? stopPreview : undefined}
/>

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
      <!-- Chapter-list sidebar toggle (#42): button + Ctrl/Cmd+B. Disabled
           until a project folder is open (the sidebar lists that folder's
           chapters). -->
      <button
        class="icon-btn"
        class:active={sidebarOpen}
        onclick={toggleSidebar}
        disabled={!currentDir || sourceMode === "url"}
        title="Toggle chapter list (Ctrl+B)"
        aria-label="Toggle chapter list"
        aria-pressed={sidebarOpen}
      >
        <Icon name="panel-left" />
      </button>
      <button bind:this={openBtn} class="primary icon-text" onclick={() => (openLocationOpen = true)} disabled={busy} title="Open folder or web address (Ctrl+O)">
        <Icon name="folder-open" />
        <span>Open</span>
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
        <span class="path">No source selected</span>
      {/if}
    </section>

    <!-- UX-012: center nav only shows when a document is loaded -->
    {#if previewUrl}
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
            <span class="pill-word">Page </span>{currentPage} / {totalPages || "—"}
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

    <section class="right">
      <!-- Separator so the page-navigation group reads as a distinct unit and
           doesn't visually merge into the mode toggle beside it. -->
      <span class="toolbar-sep" aria-hidden="true"></span>
      <!-- Edit / View pane toggle. On wide viewports this toggles the editor
           split open/closed alongside the preview (#38). On narrow viewports
           the layout is single-pane, and this switches which pane is shown
           (#responsive). Disabled until a project folder is open. -->
      {#if isNarrow}
        <div class="pane-toggle" role="radiogroup" aria-label="Edit or view mode">
          <button
            role="radio"
            class="icon-text seg"
            class:active={paneMode === "edit"}
            onclick={() => setPaneMode("edit")}
            disabled={!currentDir || sourceMode === "url"}
            title="Edit your markdown"
            aria-label="Edit mode"
            aria-checked={paneMode === "edit"}
          >
            <Icon name="pen-line" /><span class="view-label">Edit</span>
          </button>
          <button
            role="radio"
            class="icon-text seg"
            class:active={paneMode === "view"}
            onclick={() => setPaneMode("view")}
            disabled={!previewUrl}
            title="Preview your book"
            aria-label="View mode"
            aria-checked={paneMode === "view"}
          >
            <Icon name="eye" /><span class="view-label">View</span>
          </button>
        </div>
      {:else}
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
          title="Single page view (Page)"
          aria-label="Single page view"
          aria-pressed={viewMode === "single"}
        >
          <Icon name="rectangle-vertical" /><span class="view-label">Page</span>
        </button>
        <button
          class="icon-text"
          class:active={viewMode === "two-column"}
          onclick={() => applyViewMode("two-column", true)}
          disabled={!previewUrl}
          title="Two-page spread view (Spread)"
          aria-label="Two-page spread view"
          aria-pressed={viewMode === "two-column"}
        >
          <Icon name="columns-2" /><span class="view-label">Spread</span>
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
            <Icon name="columns-2" /> Two-page spread
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
        title="Zoom level — F for fit width, + / - to zoom in and out"
      >
        <!-- UX-015: fit-width first, renamed to "Fit width" -->
        <option value="fit-width">Fit width</option>
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
          {#each [["fit-width", "Fit width"], ["0.25", "25%"], ["0.5", "50%"], ["0.75", "75%"], ["1", "100%"], ["1.25", "125%"], ["1.5", "150%"], ["2", "200%"]] as [val, label] (val)}
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
          <button class="menu-item" onclick={(e) => { helpOpen = true; closeMenu(e); }}>
            <Icon name="circle-help" /> Help &amp; about
          </button>
        </div>
      </details>
    </section>
  </header>

  {#if previewUrl}
    <div
      class="workspace"
      class:editor-open={editorOpen && !!currentDir}
      class:sidebar-open={sidebarOpen && !!currentDir && sourceMode === "folder"}
      class:narrow={isNarrow}
      class:show-edit={isNarrow && paneMode === "edit"}
      class:show-view={isNarrow && paneMode === "view"}
    >
      {#if currentDir && sourceMode === "folder" && sidebarOpen}
        <!-- Backdrop only matters on the mobile bottom-sheet variant (hidden via
             CSS on wide viewports). Click dismisses the drawer. -->
        <button
          type="button"
          class="sidebar-backdrop"
          aria-label="Close chapter list"
          onclick={toggleSidebar}
        ></button>
        <aside class="pane chapter-list-pane" aria-label="Chapters">
          <ChapterList
            projectDir={currentDir}
            selectedPath={editorFilePath}
            {dirtyPath}
            onSelectFile={onSelectChapter}
          />
        </aside>
      {/if}
      {#if editorOpen && currentDir}
        <aside class="pane file-tree-pane">
          <FileTree
            projectDir={currentDir}
            selectedPath={editorFilePath}
            onSelectFile={selectEditorFile}
          />
        </aside>
        <section class="pane editor-pane" aria-label="Markdown editor">
          {#if externalChange}
            <ExternalEditBanner
              fileName={externalFileName}
              onReload={reloadExternal}
              onKeepMine={keepMineExternal}
            />
          {/if}
          {#if MarkdownEditor}
            <MarkdownEditor
              bind:this={editorRef}
              filePath={editorFilePath}
              content={editorContent}
              onChange={onEditorChange}
            />
          {:else}
            <div class="editor-loading" role="status" aria-live="polite">
              Loading editor…
            </div>
          {/if}
        </section>
      {/if}
      <section
        class="pane preview-pane"
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
      </section>
    </div>
  {:else}
    <div class="empty">
      <div class="empty-hero">
        <div class="empty-icon" aria-hidden="true">📖</div>
        <h1 class="empty-title">print-md</h1>
        <p class="empty-tagline">Turn your markdown writing into a print-ready book</p>
        <div class="empty-cta-row">
          <button bind:this={newProjectBtn} class="primary empty-cta" onclick={() => (newProjectOpen = true)} disabled={busy}>Create a New Book</button>
          <button class="ghost empty-cta" onclick={() => (openLocationOpen = true)} disabled={busy}>Open an Existing Book</button>
        </div>
        <p class="empty-hint">New to print-md? <button type="button" class="link-btn" onclick={openSetupGuide}>Read the getting-started guide →</button></p>
        <p class="empty-hint">Already have a book folder? Open it under <strong>Open an Existing Book</strong>, or preview a published document from a web address. Your chapters are loaded in order automatically.</p>
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
</div>
</div>

<HelpDialog
  bind:open={helpOpen}
  triggerEl={helpBtn}
  onCheckForUpdates={checkForUpdates}
  {checkingUpdates}
  {updateReadyVersion}
/>
<SettingsDialog bind:open={settingsOpen} triggerEl={settingsBtn} />
<OpenLocationDialog
  bind:open={openLocationOpen}
  onOpenFolder={(path) => startFolderPreview(path)}
  onOpenUrl={openUrl}
  triggerEl={openBtn}
/>
<NewProjectWizard
  bind:open={newProjectOpen}
  onCreated={(projectDir) => startFolderPreview(projectDir, "Opening your new book…")}
  triggerEl={newProjectBtn}
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
  .workspace.editor-open {
    grid-template-columns: minmax(160px, 220px) minmax(280px, 1fr) minmax(320px, 1.2fr);
  }
  /* Chapter-list sidebar (#42): a leading column before the preview (or before
     the editor split). On wide viewports it's a persistent side panel. */
  .workspace.sidebar-open {
    grid-template-columns: minmax(180px, 240px) 1fr;
  }
  .workspace.sidebar-open.editor-open {
    grid-template-columns:
      minmax(180px, 240px) minmax(160px, 220px) minmax(280px, 1fr) minmax(320px, 1.2fr);
  }
  .chapter-list-pane {
    border-right: 1px solid var(--app-border);
  }
  /* Backdrop is only visible in the mobile bottom-sheet variant (below). */
  .sidebar-backdrop {
    display: none;
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
  .preview-pane {
    position: relative;
  }
  /* Narrow widths: drop the file-tree column, stack editor over preview is
     avoided (keeps the live preview visible) — instead shrink the tree away
     and give editor + preview equal space. */
  @media screen and (max-width: 1100px) {
    .workspace.editor-open {
      grid-template-columns: minmax(240px, 1fr) minmax(280px, 1.1fr);
    }
    .workspace.editor-open .file-tree-pane {
      display: none;
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
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 8px;
    padding: 0 12px;
    height: 56px;
    flex-shrink: 0;
    background: linear-gradient(to bottom, var(--app-toolbar-from), var(--app-toolbar-to));
    border-bottom: 1px solid var(--app-border);
    /* Stacking context ABOVE the workspace panes (z-index 50) so dropdown menus
       that hang below the toolbar paint over the preview, not behind it. overflow
       must stay visible for the same reason — `overflow: hidden` clips dropdowns.
       Horizontal overflow is controlled per-section (.left/.center/.right). */
    position: relative;
    z-index: 100;
    overflow: visible;
  }

  section { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .left { justify-self: start; overflow: hidden; }
  .center { justify-self: center; flex-shrink: 0; }
  .right { justify-self: end; flex-shrink: 0; }

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

  .icon-btn {
    padding: 5px 8px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
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
  .pane-toggle { display: inline-flex; gap: 0; }
  .pane-toggle .seg { border-radius: 0; }
  .pane-toggle .seg:first-child { border-top-left-radius: 6px; border-bottom-left-radius: 6px; }
  .pane-toggle .seg:last-child { border-top-right-radius: 6px; border-bottom-right-radius: 6px; margin-left: -1px; }

  /* ---- Collapsible dropdown menus (view-mode + zoom) ---- */
  /* On wide screens the inline controls (.view-mode-group / .zoom-select) show
     and the menu buttons hide. Below a breakpoint they swap. */
  /* Narrow + Edit mode: the preview is hidden, so its controls (page navigation,
     single/spread, zoom) are noise — hide them so the edit toolbar is just
     sidebar / Open / Edit·View / Save / More. Highest specificity wins over the
     generic responsive rules below. */
  .toolbar.edit-narrow .center,
  .toolbar.edit-narrow .view-mode-group,
  .toolbar.edit-narrow .view-mode-menu,
  .toolbar.edit-narrow .zoom-select,
  .toolbar.edit-narrow .zoom-menu {
    display: none;
  }
  /* Edit mode has no center column (page nav hidden) — collapse the toolbar to
     two tracks so the controls don't leave a dead gap. (per user) */
  .toolbar.edit-narrow {
    grid-template-columns: 1fr auto;
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
  .view-mode-group { display: inline-flex; gap: 6px; }

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

  /* ---- Responsive breakpoints ----
     The toolbar degrades in stages as the viewport narrows:
       1200px — trim the doc-title/path widths
       1024px — drop button text labels (icon-only with tooltips/aria-labels)
        980px — collapse view-mode + zoom into dropdown menu buttons
        900px — hide the doc title, drop the Save PDF text label
        820px — single-pane layout (Edit/View toggle); see .workspace.narrow */
  @media screen and (max-width: 1200px) {
    .doc-title { max-width: 140px; }
    .path { max-width: 180px; }
  }
  @media screen and (max-width: 1024px) {
    /* Icon-only buttons: labels drop, aria-label/title keep them accessible. */
    .view-label { display: none; }
  }
  @media screen and (max-width: 980px) {
    /* Swap the inline view-mode buttons + zoom select for compact menu buttons. */
    .view-mode-group { display: none; }
    .zoom-select { display: none; }
    .menu { display: inline-block; }
  }
  @media screen and (max-width: 900px) {
    .doc-title { display: none; }
    .path { max-width: 140px; }
    /* UX-006: hide Save PDF text label at 900px, keep button as icon-only */
    .save-btn-label { display: none; }
  }
  @media screen and (max-width: 700px) {
    .path { display: none; }
  }
  @media screen and (max-width: 620px) {
    /* Fold Settings + Help into the "More" overflow menu, and drop the "Page"
       word from the pill — so the page navigation keeps room and the toolbar
       never crowds/clips at narrow widths. */
    .opt-inline { display: none; }
    details.more-menu { display: inline-block; }
    .pill-word { display: none; }
  }
  @media screen and (max-width: 560px) {
    /* Compact page navigation: drop the first/last jump buttons, keep prev /
       page-pill / next so navigation still works without overflow. */
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
    /* Small screens: drop the zoom + single/spread controls and the group
       separators entirely — they crowd the bar and merge the controls into an
       unreadable blob. Toolbar becomes sidebar / Open / Edit·View / page-nav /
       Save / More. (per user) */
    .zoom-select,
    .zoom-menu,
    .view-mode-group,
    .view-mode-menu,
    .toolbar-sep {
      display: none;
    }
    .workspace.narrow,
    .workspace.narrow.editor-open,
    .workspace.narrow.sidebar-open,
    .workspace.narrow.sidebar-open.editor-open {
      grid-template-columns: 1fr;
    }
    /* The file tree is part of the editing surface; fold it away on small
       screens so the editor pane gets the full width. */
    .workspace.narrow .file-tree-pane { display: none; }
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
      position: absolute;
      width: 0;
      height: 0;
      overflow: hidden;
      pointer-events: none;
      opacity: 0;
    }
  }

  /* ---- Chapter-list mobile bottom-sheet drawer (#42) ----
     Under 640px the persistent side panel becomes a bottom-sheet drawer with a
     backdrop. The grid columns collapse back to a single preview column so the
     drawer floats above the preview rather than squeezing it. */
  @media screen and (max-width: 640px) {
    .workspace.sidebar-open,
    .workspace.sidebar-open.editor-open {
      grid-template-columns: 1fr;
    }
    .sidebar-backdrop {
      display: block;
      position: fixed;
      inset: 0;
      z-index: 60;
      background: var(--app-scrim-modal, rgba(0, 0, 0, 0.45));
      border: none;
      border-radius: 0;
      padding: 0;
      margin: 0;
      cursor: pointer;
    }
    .chapter-list-pane {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 61;
      max-height: 70vh;
      border-right: none;
      border-top: 1px solid var(--app-border);
      border-top-left-radius: 12px;
      border-top-right-radius: 12px;
      background: var(--app-surface, var(--app-bg));
      box-shadow: 0 -4px 20px var(--app-shadow-md, rgba(0, 0, 0, 0.35));
    }
  }
</style>
