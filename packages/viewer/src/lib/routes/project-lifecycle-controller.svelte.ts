/**
 * ProjectLifecycleController (Phase 5d) — the single owner of the open/close
 * project lifecycle that used to live inline in `+page.svelte`, extracted per
 * UX review H5 / ARCH review #10 (both confirmed; appendix item 4's
 * controller-thunk claim was REFUTED — this continues the established
 * rune-class-controller pattern, e.g. `ProjectSessionController` /
 * `SyncController` / `PageNavController`, rather than redesigning it).
 *
 * Owns the folder-open pipeline (`startFolderPreview` and its
 * `folderOpenEpoch`/`superseded()` concurrency guard), `setUpAsBook`'s
 * epoch/busy management, `stopPreview`, `openUrl`'s reset path, and
 * `cancelOpen` (the initial-open "Cancel" affordance, M2) — every call site
 * that used to increment `folderOpenEpoch` directly.
 *
 * THE FIX (H5's "worst structural defect"): `stopPreview`, `openUrl`, and
 * `startFolderPreview`'s catch used to each hand-list a *different* subset of
 * the same 30+ `$state` fields — `openUrl` missed `recoveryScanDir` /
 * `recoveryItems` / `previewHidden` / `pageNav.pageEditing`; the catch missed
 * `problems` / pageNav / the editor pane / the buffer / the folder watcher
 * entirely. That divergence is exactly how the Cancel-closes-project defect
 * (M2) slipped in. All three teardown paths now funnel through ONE
 * `resetWorkspace()`: it directly resets the session-identity fields this
 * controller owns, then calls the single injected `deps.resetExtras()` for
 * state that must stay page-local (the Problems panel, the editor pane/
 * buffer, the folder watcher, pageNav's counters, and the crash-recovery scan
 * state) — a single registered callback, not a hand-list. Fields that are
 * genuinely NOT part of "workspace reset" (`openError` / `failedOpenDir` /
 * `urlPreviewError` / `saveWarning` / `busy` / `busyLabel`) are deliberately
 * left OUT of `resetWorkspace()` — they are set explicitly by whichever flow
 * needs them, exactly as before; unifying them here would blur error-display
 * state with workspace-empty state, which was never the divergence bug.
 *
 * Host coupling is injected (mirroring every other Phase 5 controller) so
 * this stays testable with fakes and PWA-clean (§8 / ADR 0004): the preview
 * start/stop round-trips, `ProjectSessionController` (composed by reference,
 * not duplicated), the shared `pageNav` / `zoomView` controller instances,
 * the editor buffer's flush/reset, the folder watcher, the crash-recovery
 * scan trigger, and the toast surface. `PersistedProjectState` /
 * `ProjectBookEntry` are type-only imports — ZERO `node:*` / lib value
 * imports. `basenameOf` is a pure string helper (see `platform/paths.ts`'s
 * own PWA-clean header) and is safe to import directly, matching how
 * `+page.svelte` used it inline.
 *
 * NOTE (slice 1 of 2, per the H5 fix roadmap): `savePdf` / `exportHtml` /
 * `cancelExport` (→ `ExportController`) and the crash-recovery scan block
 * (→ a future `CrashRecoveryController`) are NOT moved here — this slice is
 * scoped to the open/reset lifecycle only. `resetExtras` still reaches into
 * the crash-recovery scan fields (`recoveryScanDir` / `recoveryItems` /
 * `pendingRecoveryScanDir`) because they are part of the reset-divergence bug
 * this slice fixes, even though the scan *trigger* functions stay page-local
 * for now.
 */

import { basenameOf } from "../platform/paths";
import type { ProjectBookEntry } from "./project-session-controller.svelte";
import type { PersistedProjectState } from "./page-types";

/** Minimal toast surface the controller drives (mirrors `SyncController`'s `SyncToast`). */
export interface ProjectLifecycleToast {
  info?(message: string): void;
  error(message: string): void;
}

/** The bits of `startPreview`'s result this controller reads. */
export interface ProjectLifecyclePreviewResult {
  url: string;
  title: string | null;
  missingSharedAssets?: string[];
}

/** Composed `ProjectSessionController` surface (the bits this controller drives/reads). */
export interface ProjectLifecycleProjectSession {
  repoRoot: string | null;
  books: ProjectBookEntry[];
  activeBookDir: string | null;
  reset(): void;
  classify(dir: string): Promise<void>;
}

/** Composed `PageNavController` surface touched during an open (teardown counters live in `resetExtras`). */
export interface ProjectLifecyclePageNav {
  totalPages: number;
  currentPage: number;
}

/** Composed `ZoomViewController` surface touched by per-project restore. */
export interface ProjectLifecycleZoomView {
  userSetViewMode: boolean;
  restoreSplitRatio(ratio: number): void;
}

export interface ProjectLifecycleDeps {
  isDesktop: () => boolean;
  /** Copy shown when an open/adopt action needs the desktop app (page-local constant). */
  desktopRequiredMessage: string;
  /** Host round-trip: start the preview server for a folder. */
  startPreviewHost: (input: {
    key: string;
    displayName: string;
  }) => Promise<ProjectLifecyclePreviewResult>;
  /** Host round-trip: stop the preview server. */
  stopPreviewHost: () => Promise<unknown>;
  /** Host round-trip: scaffold manifest/book.css/git for a loose folder. */
  adoptFolder: (dir: string) => Promise<unknown>;
  /** List a folder's entries (used to detect a missing manifest). */
  listDir: (dir: string) => Promise<{ name: string }[]>;
  /** Invalidate the cached discovered-projects list after adopting a folder. */
  invalidateDiscoveredProjects: () => void;
  /** The composed classification controller (reset + fired on every open). */
  projectSession: ProjectLifecycleProjectSession;
  /** Clear the composed SyncController's diagnosis before classifying a new dir. */
  clearSyncDiag: () => void;
  /** The composed PageNavController instance (shared reference). */
  pageNav: ProjectLifecyclePageNav;
  /** The composed ZoomViewController instance (shared reference). */
  zoomView: ProjectLifecycleZoomView;
  /** Seed the settings store's per-project view-mode override on restore. */
  setViewModeSetting: (mode: "single" | "two-column") => void;
  /** Seed the pending page/view-mode restore consumed by PreviewEventController. */
  setPendingRestore: (viewMode: "single" | "two-column" | null, page: number | null) => void;
  /** Re-arm PreviewEventController's first-render-only success toast gate. */
  resetFirstRenderGate: () => void;
  /** Flush the editor buffer's pending save (no-op if there is no buffer). */
  flushBuffer: () => Promise<void>;
  /** Reset the editor buffer's in-memory state (no-op if there is no buffer). */
  resetBuffer: () => void;
  /** Fire-and-forget: preload the first file into the editor buffer. */
  ensureEditorFile: () => void;
  /** Start watching the opened folder for external edits. */
  startFolderWatch: (dir: string) => void;
  /** Whether the start-screen landing layer is currently visible. */
  isLandingVisible: () => boolean;
  /** Defer the crash-recovery scan until the landing dismisses. */
  setPendingRecoveryScanDir: (dir: string | null) => void;
  /** Run the crash-recovery scan immediately (landing already dismissed). */
  scanForRecovery: (dir: string) => void;
  /** Leave the start screen (see +page.svelte's dismissLanding doc). */
  dismissLanding: (runPendingRecoveryScan?: boolean) => void;
  /** The live toast surface, or null when unavailable. */
  toast: () => ProjectLifecycleToast | null;
  /** Clear stale problems/log-path state for the project a new open targets. */
  clearStaleProjectState: () => void;
  /** Set the missing-shared-assets Problems rows + toast (M30). */
  onMissingSharedAssets: (paths: string[]) => void;
  /**
   * The single page-local reset hook for state this controller does not own:
   * the Problems panel (`problems`/`problemsError`/`missingAssetProblems`/
   * `problemsOpen`), the editor pane (`editorOpen`/`previewHidden`), the
   * editor buffer, the folder watcher, `pageNav`'s counters + edit mode, and
   * the crash-recovery scan state (`recoveryScanDir`/`recoveryItems`/
   * `pendingRecoveryScanDir`). Called once from `resetWorkspace()` so every
   * teardown path clears the SAME set — the fix for the divergent hand-rolled
   * resets (H5 / M2).
   */
  resetExtras: () => void;
}

export class ProjectLifecycleController {
  // ── Public rune state (read by the template; mutated only via methods) ──────
  previewUrl = $state<string | null>(null);
  currentDir = $state<string | null>(null);
  /** Adapter-precomputed display name (#49) for the open folder, or null when opened by raw key. */
  currentFolderDisplayName = $state<string | null>(null);
  currentUrl = $state<string | null>(null);
  sourceMode = $state<"folder" | "url">("folder");
  docTitle = $state<string | null>(null);
  busy = $state(false);
  busyLabel = $state("");
  rendering = $state(false);
  renderProgressPage = $state(0);
  renderCompleteOverlay = $state(false);
  openError = $state<string | null>(null);
  /** The folder a failed open was attempted on, so the caller can offer to adopt it. */
  failedOpenDir = $state<string | null>(null);
  urlPreviewError = $state<string | null>(null);
  saveWarning = $state<string | null>(null);
  /** Default true (banner hidden) until a listing proves the manifest is absent. */
  currentFolderHasManifest = $state(true);
  adoptBannerDismissed = $state(false);
  adopting = $state(false);

  private deps: ProjectLifecycleDeps;

  // Single-flight guard for the open pipeline (moved verbatim from
  // +page.svelte): every open intent (startFolderPreview's default param,
  // setUpAsBook, openUrl, cancelOpen) claims the epoch synchronously at its
  // entry point with no await before the claim, so "last user action wins" is
  // guaranteed at the intent boundary, never "last fetch to resolve wins". A
  // superseded call's continuations bail after every await instead of
  // overwriting the newer open's state.
  private folderOpenEpoch = 0;

  constructor(deps: ProjectLifecycleDeps) {
    this.deps = deps;
  }

  /**
   * ONE workspace-reset function every teardown path calls (H5 fix). Resets
   * the session-identity state this controller owns, then delegates to the
   * single injected `resetExtras()` for the page-local state that used to be
   * hand-listed differently at each call site. Deliberately does NOT touch
   * `openError`/`failedOpenDir`/`urlPreviewError`/`saveWarning`/`busy`/
   * `busyLabel` — those are error/busy signals each flow sets explicitly, not
   * "workspace" state, and were never part of the divergence bug.
   */
  private resetWorkspace(): void {
    this.previewUrl = null;
    this.currentDir = null;
    this.currentFolderDisplayName = null;
    this.currentUrl = null;
    this.docTitle = null;
    this.rendering = false;
    this.renderProgressPage = 0;
    this.renderCompleteOverlay = false;
    this.deps.resetExtras();
  }

  /**
   * The ONE open-a-project-folder pipeline. `restoreState` may be a promise
   * (the caller's in-flight per-project-state fetch) so the read overlaps
   * classify/startPreview instead of preceding them. `epoch` defaults to
   * claiming a fresh epoch; callers with work between their intent and this
   * call (setUpAsBook's adopt) pass their pre-claimed epoch.
   */
  async startFolderPreview(
    dir: string,
    label = "Starting preview…",
    restoreState:
      | PersistedProjectState
      | null
      | Promise<PersistedProjectState | null> = null,
    displayName: string | null = null,
    epoch = ++this.folderOpenEpoch,
  ): Promise<void> {
    const d = this.deps;
    const superseded = () => epoch !== this.folderOpenEpoch;
    // Tracks whether the outgoing project's buffer has already been flushed
    // (below, before startPreviewHost) so the catch block's own defensive
    // flush doesn't redundantly re-flush an already-clean buffer.
    let outgoingBufferFlushed = false;
    this.openError = null;
    this.failedOpenDir = null;
    this.urlPreviewError = null;
    this.saveWarning = null;
    this.renderCompleteOverlay = false;
    this.busy = true;
    this.busyLabel = label;
    // M3: a new project/document session is starting — re-arm the first-render
    // success toast so this session's initial render still gets one.
    d.resetFirstRenderGate();
    try {
      if (!d.isDesktop()) {
        d.toast()?.error(d.desktopRequiredMessage);
        return;
      }
      // C2 (book switcher): classify the PICKED folder first, before any
      // content pipeline opens — see ProjectSessionController's C2 note.
      const previousRepoRoot = d.projectSession.repoRoot;
      d.projectSession.reset();
      d.clearSyncDiag();
      await d.projectSession.classify(dir);
      if (superseded()) return;
      const targetDir = d.projectSession.activeBookDir ?? dir;
      // One quiet notice when the tracked "project" turns out to be a whole
      // repo rather than just the folder the author picked. Once per repo per
      // session — not on every subsequent switch between known books.
      if (
        d.projectSession.repoRoot &&
        d.projectSession.repoRoot !== previousRepoRoot &&
        (targetDir !== dir || dir !== d.projectSession.repoRoot)
      ) {
        d.toast()?.info?.(
          `This book is part of ${basenameOf(d.projectSession.repoRoot)} — opened the whole project.`,
        );
      }
      // #49: the app-facing contract takes a FolderRef. Once retargeted,
      // prefer the resolved book's own title over the caller-supplied
      // displayName, which described the picked folder.
      const targetDisplayName =
        targetDir === dir
          ? (displayName ?? basenameOf(targetDir))
          : (d.projectSession.books.find((b) => b.path === targetDir)?.title ?? basenameOf(targetDir));
      // New folder: flush + clear any file selected from a previous project so
      // the editor pane doesn't point at a stale path (#44 — flush first so a
      // pending save in the prior project isn't dropped on project switch).
      // MUST happen BEFORE startPreviewHost below (#7 fix): the host derives
      // its fs-route authorization root SOLELY from the active preview
      // (electron/server-bridge/fs-guard.ts's `projectRoots()`), and
      // establishes the NEW project as that root the instant `startPreviewHost`
      // is dispatched (electron/preview/controller.ts's `runOpen`). Flushing
      // AFTER that call would race the pending write for the OLD project
      // against the root having already moved — the write would fall outside
      // the new root, get rejected 403, and the buffer would still be reset,
      // silently discarding the edit with no disk write.
      if (this.currentDir !== targetDir) {
        await d.flushBuffer();
        outgoingBufferFlushed = true;
        // Check BEFORE reset: a superseded call resuming from the flush must
        // not wipe the buffer the winning open has already populated.
        if (superseded()) return;
        d.resetBuffer();
      }
      const data = await d.startPreviewHost({ key: targetDir, displayName: targetDisplayName });
      if (superseded()) return;
      this.sourceMode = "folder";
      this.currentDir = targetDir;
      this.currentFolderDisplayName = targetDisplayName;
      this.currentUrl = null;
      // Detect a "loose" folder (no manifest) so the caller can offer to set
      // it up as a book. Default true (banner hidden) until the listing
      // proves it's absent.
      this.currentFolderHasManifest = true;
      this.adoptBannerDismissed = false;
      void d
        .listDir(targetDir)
        .then((entries) => {
          // Detached continuation — guard it, or a superseded open's result
          // could flip the adopt banner on/off for the WRONG project.
          if (superseded()) return;
          this.currentFolderHasManifest = entries.some((e) => /^manifest\.ya?ml$/i.test(e.name));
        })
        .catch(() => {
          if (superseded()) return;
          this.currentFolderHasManifest = true;
        });
      // Clear stale problems/log-path from the previous project immediately so
      // the badge/panel/activity view don't show the old project's data while
      // the new one renders.
      d.clearStaleProjectState();
      // Preload the first file into the editor buffer when a folder opens.
      void d.ensureEditorFile();
      this.docTitle = data.title ?? null;
      // Force iframe remount by nulling first; reset overlay for the new iframe.
      this.previewUrl = null;
      await Promise.resolve();
      if (superseded()) return;
      this.previewUrl = data.url;
      this.rendering = true;
      this.renderProgressPage = 0;
      d.pageNav.totalPages = 0;
      d.pageNav.currentPage = 1;
      // The restore-state fetch was started at intent time and has been
      // overlapping classify/startPreview — settle it here where it's needed.
      const restored = restoreState ? await restoreState : null;
      if (superseded()) return;
      const restoredViewMode = restored?.viewMode;
      d.setPendingRestore(
        restoredViewMode ?? null,
        restored?.currentPage && restored.currentPage > 1 ? restored.currentPage : null,
      );
      if (restoredViewMode) {
        // Per-project ViewerPrefs override → seed the settings store so the
        // derived viewMode reflects this project's last-used mode.
        d.setViewModeSetting(restoredViewMode);
      }
      d.zoomView.userSetViewMode = !!restoredViewMode;
      if (typeof restored?.splitPaneRatio === "number") {
        d.zoomView.restoreSplitRatio(restored.splitPaneRatio);
      }
      // M30: signal for the #1 cause of wrong fonts/styles.
      d.onMissingSharedAssets(data.missingSharedAssets ?? []);
      // Crash-recovery offer (#44): deferred while the start screen is up so
      // the recovery dialog never opens under/over the landing.
      if (d.isLandingVisible()) d.setPendingRecoveryScanDir(targetDir);
      else d.scanForRecovery(targetDir);
      // Start watching for external edits.
      d.startFolderWatch(targetDir);
    } catch (e) {
      // A superseded open must not clear the newer open's state or surface
      // its own stale error.
      if (superseded()) return;
      // Flush any pending edit from the PREVIOUSLY open project before
      // tearing its state down — mirrors stopPreview's flush-before-reset
      // (#44). Without this, a user who edits project A and then, within the
      // ~500ms debounce window, opens a folder B whose classify/startPreview
      // throws would have folder A's still-pending save silently dropped by
      // resetExtras()'s buffer.reset() (cancelTimers + clear in-memory
      // content), with no disk write and no recovery snapshot. Skipped when
      // the try block already flushed it above (#7 fix) — e.g. startPreviewHost
      // itself is what threw — so a clean buffer isn't redundantly re-flushed;
      // this is still reached when classify() (before the pre-flush point)
      // is what threw.
      if (!outgoingBufferFlushed) {
        await d.flushBuffer();
        // Re-check: a supersession landing DURING the flush (the user opened
        // yet another folder while this failed open was flushing) must not
        // let this stale catch clobber the winning open's state.
        if (superseded()) return;
      }
      // H5 fix: route through the SAME resetWorkspace() the other two
      // teardown paths use, instead of a narrower hand-list — this is what
      // now also clears Problems/pageNav/the editor pane/the buffer/the
      // folder watcher/the crash-recovery scan state on a failed open,
      // closing the exact divergence the review flagged.
      this.resetWorkspace();
      this.openError = e instanceof Error ? e.message : String(e);
      // Remember the folder so the caller can offer to set it up as a book.
      this.failedOpenDir = dir;
      // The start screen re-appears on its own (landingVisible derived: the
      // workspace is empty again) and shows the error alongside recents and
      // create/open actions.
    } finally {
      if (!superseded()) {
        this.busy = false;
        this.busyLabel = "";
      }
    }
  }

  /**
   * Turn an existing folder into a print-md book (manifest + book.css + git),
   * then (re)open it. Adopting is an open intent: claim the epoch NOW so an
   * already-running open is superseded, and so an open the user starts DURING
   * the adopt supersedes us (re-checked before touching shared state below).
   */
  async setUpAsBook(dir: string): Promise<void> {
    const d = this.deps;
    if (!dir || !d.isDesktop()) return;
    const epoch = ++this.folderOpenEpoch;
    d.dismissLanding(false);
    this.adopting = true;
    this.busy = true;
    this.busyLabel = "Setting up your book…";
    try {
      await d.adoptFolder(dir);
      d.invalidateDiscoveredProjects();
      if (epoch !== this.folderOpenEpoch) return; // user opened something else meanwhile
      this.openError = null;
      this.failedOpenDir = null;
      this.adoptBannerDismissed = true;
      await this.startFolderPreview(dir, "Setting up your book…", null, null, epoch);
    } catch (e) {
      // Never stomp a newer open's error state with a stale adopt failure.
      if (epoch !== this.folderOpenEpoch) return;
      this.openError = e instanceof Error ? e.message : String(e);
      // A failed adopt leaves the workspace empty — the start screen returns
      // on its own (landingVisible derived) and surfaces the error.
    } finally {
      this.adopting = false;
      if (epoch === this.folderOpenEpoch && !this.previewUrl) {
        // Adopt failed (or bailed) without handing off to an open: clear the
        // busy we raised. On the success path startFolderPreview owns busy.
        this.busy = false;
        this.busyLabel = "";
      }
    }
  }

  /**
   * Load a URL preview. A URL preview is an open intent: bump the epoch so an
   * in-flight folder open (e.g. the startup pre-render) is superseded and
   * can't resolve later and silently replace this preview with the old book.
   * The superseded open's `finally` no longer owns busy, so clear it here.
   */
  openUrl(url: string): void {
    const d = this.deps;
    this.folderOpenEpoch++;
    this.busy = false;
    this.busyLabel = "";
    d.dismissLanding(false);
    this.openError = null;
    this.urlPreviewError = null;
    this.saveWarning = null;
    // H5 fix: the SAME resetWorkspace() stopPreview/the catch use — this is
    // what now also clears recoveryScanDir/recoveryItems/previewHidden/
    // pageNav.pageEditing here, closing the exact divergence the review
    // flagged (openUrl used to miss them).
    this.resetWorkspace();
    this.sourceMode = "url";
    this.currentUrl = url;
    // Force iframe remount by nulling first.
    this.previewUrl = null;
    queueMicrotask(() => {
      this.previewUrl = url;
      this.rendering = false;
      this.renderProgressPage = 0;
      d.pageNav.totalPages = 0;
      d.pageNav.currentPage = 1;
    });
  }

  /** Flush any pending edit, tear down the host preview, then reset the workspace. */
  async stopPreview(): Promise<void> {
    const d = this.deps;
    // Flush any pending edit before tearing down so closing the project never
    // drops an in-flight auto-save (#44).
    await d.flushBuffer();
    await d.stopPreviewHost().catch(() => {});
    this.resetWorkspace();
    // The start screen is the app's empty state — it returns on its own now
    // that the workspace is empty (landingVisible derived).
  }

  /**
   * M2: real cancel-and-close, for the initial open ONLY (the caller only
   * offers this before any preview exists — there is no live workspace to
   * interrupt yet). Bumping the epoch supersedes whatever `startFolderPreview`
   * call is in flight, the same mechanism `openUrl` uses to abort an in-flight
   * open — its own guarded state writes become no-ops once superseded.
   */
  cancelOpen(): void {
    this.folderOpenEpoch++;
    this.busy = false;
    this.busyLabel = "";
    void this.stopPreview().catch(() => {});
  }
}
