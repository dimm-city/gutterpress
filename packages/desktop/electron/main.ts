import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  nativeImage,
  nativeTheme,
  net,
  powerMonitor,
  protocol,
  session,
  shell,
} from "electron";
import path from "node:path";
import os from "node:os";
import { appendFile, copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import * as fs from "node:fs";
import { watch } from "node:fs";
import { fileURLToPath } from "node:url";
import { scanForProjects, type ScanDeps } from "./discover-projects";
import {
  createSettingsStore,
  type AppSettings,
} from "./settings-store";
import { createPrefsStore, type DesktopPrefs } from "./prefs-store";
// ARCH review #31: the 11 independent `registerXHooks()` service locators
// have been collapsed into ONE `registerHostServices()` call (below) that
// writes a single typed `HostServices` object. Each domain module below is
// now imported for its TYPE only — main.ts builds one plain object per
// domain at the same place it always did, and hands all of them to
// `registerHostServices` together, once, after every dependency exists.
import { registerHostServices } from "./server-bridge/host-services";
import type { WriteHooks } from "./server-bridge/write-hooks";
import type { WatchHooks } from "./server-bridge/watch-hooks";
import type { AppHooks } from "./server-bridge/app-hooks";
import type { PrefsHooks } from "./server-bridge/prefs-hooks";
import type { RecoveryHooks } from "./server-bridge/recovery-hooks";
import type { AppImageHooks, DesktopHooks, DoctorHooks } from "./server-bridge/host-hooks";
import { AppImageIntegration } from "./appimage-integration";
import type { MediaHooks } from "./server-bridge/media-hooks";
import type { VcsHooks } from "./server-bridge/vcs-hooks";
import type { RemoteHooks } from "./server-bridge/remote-hooks";
import type { SyncSettingsHooks } from "./server-bridge/sync-settings-hooks";
import type { UpdaterHooks } from "./server-bridge/updater-hooks";
import { isWithinRoot, type FsGuardHooks } from "./server-bridge/fs-guard";
import { createPickedFilesService, createSavePathsService } from "./server-bridge/picked-files";
import { createSecureHandle } from "./server-bridge/secure-handle";
import { registerGitHubDeviceFlowHandlers } from "./github-device-flow-registrar";
import { registerGoogleConnectFlowHandlers } from "./google-connect-flow-registrar";
// The one process-wide `gutterpress` lib cache — shared with every
// `electron/api/*.ts` handler (SFE-P5c2/P5c4; this file used to keep a
// private copy for the deleted SvelteKit routes' sake).
import { loadLib, type LibModule } from "./api/lib-loader";
// SFE-P5c1: fs/dialog/shell/log/app moved from SvelteKit HTTP routes to typed
// IPC. Each module below is the main-process logic the deleted +server.ts
// handlers used to run — see electron/api/*.ts's own header comments.
// SFE-P6b: main.ts no longer calls these functions directly — it imports
// each module's own `register*Handlers(secureHandle)` and calls that once,
// in the "IPC handler registration" section below, replacing the inline
// per-channel secureHandle registration blocks this file used to carry for
// every one of the ~120 channels.
import { registerFsHandlers } from "./api/fs";
import { registerFsWatchHandlers } from "./api/fs-watch";
import { registerDialogHandlers } from "./api/dialog";
import { registerShellHandlers } from "./api/shell";
import { registerLogHandlers } from "./api/log";
import { registerAppHandlers } from "./api/app";
// SFE-P5c2: project/manifest/tpl/snip/media/plugin/theme/vcs/style moved
// from SvelteKit HTTP routes to typed IPC — same rationale as P5c1 above.
import { registerProjectHandlers } from "./api/project";
import { registerManifestHandlers } from "./api/manifest";
import { registerTplHandlers } from "./api/tpl";
import { registerSnipHandlers } from "./api/snip";
import { registerMediaHandlers } from "./api/media";
import { registerPluginHandlers } from "./api/plugin";
import { registerThemeHandlers } from "./api/theme";
import { registerVcsHandlers } from "./api/vcs";
import { registerStyleHandlers } from "./api/style";
// SFE-P5c3: remote/sync/publish moved from SvelteKit HTTP routes back to
// typed IPC (the credentials-sensitive group) — same rationale as P5c1/P5c2
// above. GitHub device-flow + clone-progress push stay exactly as they were
// (registered via ./github-device-flow-registrar — see that module's header).
import { registerRemoteHandlers } from "./api/remote";
import { registerPublishHandlers } from "./api/publish";
// SFE-P5c4: updater/recovery/doctor/lint — the LAST four route groups —
// moved from SvelteKit HTTP routes to typed IPC, taking the desktop HTTP
// route count to zero. Same rationale as P5c1/P5c2/P5c3 above. The hooks
// bags these four handler modules read from (`getUpdaterHooks`/
// `getRecoveryHooks`/`getDoctorHooks`) are unchanged — the underlying
// implementation functions still populate them exactly as they did for the
// deleted routes.
import { registerUpdaterHandlers } from "./api/updater";
import { registerRecoveryHandlers } from "./api/recovery";
import { registerDoctorHandlers } from "./api/doctor";
import { registerLintHandlers } from "./api/lint";
import {
  writeRecovery as writeRecoveryStore,
  clearRecovery as clearRecoveryStore,
  listRecovery as listRecoveryStore,
} from "./recovery";
import {
  initUpdater,
  updaterSupported,
  checkForUpdates,
  download as downloadUpdate,
  shouldBackgroundCheck,
  getStatus as getUpdaterStatus,
  installNow,
} from "./updater";
import type { MarkdownFileLaunchEvent, UpdaterEventPayload } from "./bridge-types";
import {
  removeRecentFolder,
  toggleFavoriteFolder,
  type RecentFolder,
} from "./recent-folders";
import {
  readProjectState,
  writeProjectState,
  type ProjectStateMap,
} from "./project-state";
import {
  electronTokenStore,
  markLinuxBasicTextStorageNoticeShown,
  onCredentialChange,
  shouldShowLinuxBasicTextStorageNotice,
} from "./credential-store";
import {
  AutoSyncOrchestrator,
  type SyncStatusPayload,
} from "./auto-sync/orchestrator";
import { unsyncedStateFor } from "./auto-sync/unsynced-status";
import { ExportController, registerExportHandlers } from "./export/controller";
import { PreviewOpenController, registerPreviewHandlers, type PreviewHandle } from "./preview/controller";
import { registerEditorProjectionHandlers } from "./editor-projection";
import { GitHubDeviceFlow } from "./github-device-flow";
import { GoogleConnectFlow } from "./google-connect-flow";
import {
  MarkdownFileLaunchQueue,
  isMarkdownFilePath,
  markdownFilePathsFromArgv,
  resolveMarkdownFileLaunch,
} from "./markdown-file-launch";
import { AutoSnapshotScheduler } from "./auto-snapshot/scheduler";
import { gitIdentityFrom } from "./git-identity";
import { RendererFlushSession, runCloseGate } from "./close-gate";
import { createLastFlushFailure } from "../src/lib/persistence-failures";
import { FolderWatcher } from "./folder-watch/watcher";
import type {
  AdoptFolderOptions,
  ApplyThemeTarget,
  CheckResult,
  CloneProgressEvent,
  CreateProjectOptions,
  CreateProjectResult,
  PluginValidationResult,
  PrintSafeWarning,
  ProjectCapabilities,
  ProjectPluginEntry,
  ProjectRemoteDiagnosis,
  ProjectStyle,
  RecommendedPlugin,
  RemoteAccessResult,
  RemoteBranch,
  RemoteRepository,
  RepoBook,
  RestoreVersionResult,
  SourceProvider,
  SystemDiagnostics,
  ThemeInfo,
  TokenStore as RecoveryTokenStore,
} from "gutterpress";
import {
  appLogPath as appLogPathImpl,
  recoveryDir as recoveryDirImpl,
  operationLogPath as operationLogPathImpl,
  operationLogSlug,
  logsDir as logsDirImpl,
} from "./recovery-paths";
import { appendAppLog, initAppLog, logAppEvent } from "./app-log";
import {
  ExportCanceledError,
  getActiveExportSession,
  initPdfExport,
  registerPdfExportHandlers,
  sendExportProgress,
  setActiveExportSession,
  throwIfExportCanceled,
  type ExportSession,
} from "./pdf-export";
import { createElectronEngineBrowser } from "./engine-browser";
import {
  registerAppProtocol,
  resolveBuildDir,
  staticBuildLooksValid,
} from "./app-protocol";
import {
  APP_ORIGIN,
  decideNavigation,
  decideWindowOpen,
  isHttpUrl,
  resolveDevServerUrl,
  type OriginPolicyConfig,
} from "./navigation-policy";
import { version as APP_VERSION } from "../package.json";

// Module directory, ESM-safe. We do NOT rely on electron-vite's injected
// `__dirname` shim (`const __dirname = import.meta.dirname`): after main.ts was
// split into sibling modules the shim stopped covering main.ts's own scope,
// throwing `__dirname is not defined` inside appIconPath and
// aborting startup before any window opened. `fileURLToPath(import.meta.url)` is
// the canonical, bundler-independent replacement (import.meta.url is always
// defined in the ESM main bundle; import.meta.dirname is not). Resolves to
// out/main/ at runtime.
const HERE = path.dirname(fileURLToPath(import.meta.url));

function appIconPath(): string {
  const packaged = path.resolve(process.resourcesPath ?? "", "build-resources/icon.png");
  const dev = path.resolve(HERE, "../../build-resources/icon.png");
  return fs.existsSync(packaged) ? packaged : dev;
}

// ── Startup timing instrumentation (diagnose the ~10s launch stall) ──────────
// Prints "[startup +Nms] <milestone>" so a slow launch log pinpoints exactly
// which phase stalls (Electron init → web-root → window create → renderer load
// → first paint → preview). Cheap; safe to leave in for a beta.
const __startupT0 = Date.now();
const APP_USER_MODEL_ID = "city.dimm.gutterpress";
function slog(msg: string): void {
  console.log(`[startup +${Date.now() - __startupT0}ms] ${msg}`);
}
slog("main.js evaluated");

// `electron out/main/main.js` (electron:dev / electron:hmr) hands Electron a
// FILE, so default_app never finds a package.json and app.getVersion()
// falls back to the Electron version (42.x). Packaged runs read the real
// version from app.asar/package.json, so correct dev only — never override
// the packaged value, which electron-updater compares releases against.
// app.setVersion() is real at runtime (default_app itself calls it when it
// loads a folder's package.json) but absent from the public electron.d.ts,
// hence the narrow cast.
if (!app.isPackaged) {
  (app as unknown as { setVersion(version: string): void }).setVersion(APP_VERSION);
}

// ──────────────────────────────────────────────────────────────────────────
// Lib loader
//
// Both this main process and gutterpress are ESM, so it's a plain
// dynamic import. The lib ships as a normal node_modules package (its package
// "files" field limits what electron-builder packages to dist/ + profiles/) —
// no afterPack hook, no symlink dance, no require()/Function() interop trick.
// ──────────────────────────────────────────────────────────────────────────

interface SplitOutPath {
  outDir: string;
  pdfFileOverride?: string;
}
interface BuildResult {
  outDir: string;
  htmlPath?: string;
  pdfPath?: string;
  fingerprintPath?: string;
  diagnostics?: Array<{ code: string; severity: "warning" | "info"; message: string }>;
}

// ──────────────────────────────────────────────────────────────────────────
// PDF export subsystem lives in electron/pdf-export.ts — it owns the single
// active export session + the Electron-native PDF renderer. Wire its progress
// sender to the live main window here (initPdfExport is called after mainWindow
// is declared, in the hook-registration section below).
// ──────────────────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────────────
// Workspace/preview state. The workspace root is the host-owned filesystem
// capability; the preview server is optional and may fail while files stay open.
// ──────────────────────────────────────────────────────────────────────────

let activePreview: PreviewHandle | null = null;
let activeWorkspaceRoot: string | null = null;
let activeRepositoryRoot: string | null = null;

function setActiveWorkspaceRoot(root: string | null): void {
  const normalized = root ? path.resolve(root) : null;
  if (normalized !== activeWorkspaceRoot) stopFolderWatch();
  activeWorkspaceRoot = normalized;
}

function setActiveRepositoryRoot(root: string | null): void {
  activeRepositoryRoot = root ? path.resolve(root) : null;
}

// ──────────────────────────────────────────────────────────────────────────
// Desktop prefs (#42/#43) — session/per-project state in gutterpress-prefs.json,
// separate from durable user settings (below). The DesktopPrefs shape and the
// prefsPath/readPrefs/writePrefs/existingDirectory read/write path live in
// ./prefs-store (Phase 5b extraction; unit-tested in
// tests/platform/prefs-store.test.ts) behind an injected-fs store factory.
// main.ts instantiates the store with the live Electron userData dir +
// node:fs/promises and uses its closures unchanged. Writes are atomic
// (`rename` over a `.tmp` file) and a corrupt read is preserved rather than
// discarded (#34).
// ──────────────────────────────────────────────────────────────────────────

const { readPrefs, writePrefs, updatePrefs, existingDirectory } = createPrefsStore({
  getUserDataDir: () => app.getPath("userData"),
  fs: { readFile, writeFile, mkdir, stat, rename },
});

// ──────────────────────────────────────────────────────────────────────────
// User settings (#45) — persisted, section-organised user preferences in a
// SEPARATE file from gutterpress-prefs.json so session/per-project state and durable
// user settings don't collide. The AppSettings shape, DEFAULT_SETTINGS, the
// pure mergeSettings helpers, and the injected-fs store factory live in
// ./settings-store (Phase 5b extraction; unit-tested in
// tests/platform/settings-store.test.ts). main.ts instantiates the store with
// the live Electron userData dir + node:fs/promises and uses its read/write
// closures unchanged. Writes are atomic and a corrupt read is preserved
// rather than discarded (#34).
// ──────────────────────────────────────────────────────────────────────────

const { readSettings, updateSettings } = createSettingsStore({
  getUserDataDir: () => app.getPath("userData"),
  fs: { readFile, writeFile, mkdir, rename },
});

// ──────────────────────────────────────────────────────────────────────────
// Window management
// ──────────────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;
let appShellReady = false;

// ── Unsaved-changes infrastructure (#44) ────────────────────────────────────
// The recovery sidecar store lives under userData/recovery/; the sync/recovery
// operation log lives under userData/logs/. The pure path/slug builders live in
// ./recovery-paths; these thin wrappers bind them to the live userData dir.
const recoveryDir = (): string => recoveryDirImpl(app.getPath("userData"));
const logsDir = (): string => logsDirImpl(app.getPath("userData"));
const operationLogPath = (repoSlug: string): string =>
  operationLogPathImpl(app.getPath("userData"), repoSlug);

// The app's OWN fault log goes in that same logs dir, so the start screen's
// Logs tab lists it alongside the project logs (electron/app-log.ts).
initAppLog(() => appLogPathImpl(app.getPath("userData")));

/**
 * The operation-log path for a project directory, keyed to its REPOSITORY.
 *
 * Every operation the log records acts on the whole repo (R9), so the log is
 * the repo's log — see recovery-paths.ts's `operationLogSlug`. Call sites here
 * only ever hold the ACTIVE project's dir, so the repo root comes from the
 * host's own `activeRepositoryRoot` (set by the preview-open controller from
 * `detectProjectSource`); a dir outside it, or a project with no repo at all,
 * falls back to its own slug.
 */
const operationLogPathForDir = (dir: string): string =>
  operationLogPath(
    operationLogSlug(
      activeRepositoryRoot && isWithinRoot(dir, activeRepositoryRoot) ? activeRepositoryRoot : dir,
    ),
  );

// A single RECURSIVE folder watcher for the open project. fs.watch is coarse and
// fires multiple times per save, so changes are debounced before notifying the
// renderer. Only one project is open at a time, so a single watcher suffices.
// The watcher/debounce/normalized-dir state + control logic lives in the
// FolderWatcher class (electron/folder-watch/watcher.ts; unit-tested in
// tests/platform/folder-watcher.test.ts) behind injected deps. main.ts keeps
// thin startFolderWatch/stopFolderWatch delegators (below) and reads the
// currently-watched dir straight off the watcher via `folderWatch.getWatchedDir()`
// — no separate module-level copy of that state.

// ── Automatic snapshots (RC1-3) ──────────────────────────────────────────────
// Host-side debounced auto-snapshot: every edit signal (fs:writeFile inside the
// open project + folder-watch events) ARMS/RESETS one timer; it fires after N
// minutes of quiet (settings.versionHistory, default ON / 10 min, floor 5) so
// each snapshot marks the end of a work burst — never a commit per keystroke.
// On fire: detect the source; only a `local-git-folder` snapshots. A plain
// folder is NEVER auto-`git init`ed (enabling history stays an explicit
// opt-in). A book nested INSIDE a larger repo DOES snapshot, against that
// enclosing repo — that is the repo-root session model ("a project is its git
// repo", R9), and the lib's provider scopes the commit to `repoRoot` itself.
// (This comment used to say nested folders were never auto-snapshotted; that
// stopped being true when sessions became repo-rooted, and the scheduler has no
// subPath check — corrected 2026-07-29.) The lib's per-repo FIFO lock
// serializes the commit against
// sync/restore, and its no-empty-snapshot guard turns a clean-tree fire into
// the expected `isNoChangesError` rejection, swallowed below. Silent on success
// (the history dialog reloads its list on open).
// The single scheduler instance (electron/auto-snapshot/scheduler.ts) owns the
// pending timer + policy + the run/flush/cancel control logic — unit-tested in
// tests/platform/auto-snapshot-scheduler.test.ts. main.ts wires the injected
// deps below and keeps thin delegators (scheduleAutoSnapshot/flushAutoSnapshot/
// cancelAutoSnapshotTimer) for its call sites; createWindow's close-gate reads
// pending state via `autoSnapshot.hasPending()` directly — no separate mirror.

const autoSnapshot = new AutoSnapshotScheduler({
  loadLib,
  readSettings,
  getWatchedDir: () => folderWatch.getWatchedDir(),
  operationLogPath,
  // M39 (UX critical review): the safety net used to fail silently forever
  // (console.error + return) while the pill kept asserting "Version history
  // on". Once AUTO_SNAPSHOT_FAILURE_THRESHOLD consecutive failures hit for the
  // SAME dir, surface it through the SAME "sync:status" push channel + guidance
  // dialog the transparent-sync recovery flow already uses (RecoveryUiController
  // / RecoveryGuidanceDialog react to state:"error" + guidance today — this is
  // also the one channel local-git-folder projects with no remote already
  // receive events on, via the one-shot "local" status below) rather than
  // inventing a second signal path. Scoped to the still-open project so a
  // failure from a since-closed/switched project never surfaces stale.
  onSnapshotFailed: (dir, consecutiveFailures, error) => {
    if (folderWatch.getWatchedDir() !== dir) return;
    const detail = error instanceof Error ? error.message : String(error);
    emitSyncStatus({
      state: "error",
      projectDir: dir,
      lastSyncAt: null,
      logFile: operationLogPathForDir(dir),
      message:
        "Version history needs attention — the last few automatic backups of this project didn't complete. " +
        "Try saving a version now; if it keeps failing, make sure no other program has the project folder open or locked.",
    });
  },
});

function cancelAutoSnapshotTimer(): void {
  autoSnapshot.cancel();
}

/** Arm/reset the debounce timer after an edit signal in `dir`. */
function scheduleAutoSnapshot(dir: string): void {
  autoSnapshot.schedule(dir);
}

/**
 * Fire any pending auto-snapshot NOW (project close / app quit flush points).
 * Returns the in-flight snapshot promise, or `undefined` when nothing pends.
 */
function flushAutoSnapshot(): Promise<void> | undefined {
  return autoSnapshot.flush();
}

// ── Automatic sync orchestrator (transparent-sync plan §4.1/§4.2/§5.3) ────────
//
// The orchestrator calls syncProject ONLY (never statusMatrix/walks), and
// syncProject snapshots-first, which is what makes a race with the editor's
// autosave safe. There is deliberately NO file-change debounce — see the
// orchestrator's own note: the periodic tick already covers every case the
// debounce could, at every non-absurd cadence.
//
// Triggers handled here: the periodic safety interval.
// Project-open and network-restored triggers are wired at their respective sites.
//
// Single-flight + runAgain (§4.1): if a sync is already in flight when another
// trigger fires, we set runAgain and execute exactly one follow-up on completion.
// This coalesces a burst of triggers into at most one queued sync — we never pile
// up N pending syncs behind one long-running network call.
//
// Conflict-latch (§4.1 / §6.1): on 'conflict' outcome, auto-sync is DISABLED for
// the affected project until re-enabled (by setAutoSync or by conflict resolution).
// Auto-snapshot keeps running so ongoing edits are never lost.

// The single orchestrator instance (electron/auto-sync/orchestrator.ts) owns ALL
// auto-sync state + timers + the single-flight / runAgain / conflict-latch control
// logic — unit-tested in tests/platform/auto-sync-orchestrator.test.ts. main.ts
// wires the injected deps below and forwards its triggers to it; it keeps NO
// auto-sync module state of its own. The header comment above documents the
// invariants the orchestrator enforces.

/**
 * Last emitted status per project dir (resolved-path keyed) — the queryable
 * counterpart to the push channel. "sync:status" is fire-and-forget with no
 * replay, so a renderer that subscribes AFTER an emit (project open races the
 * pill's mount; one-shot "connect"/"local" states) used to strand on stale or
 * blank status forever. The pill now seeds itself from `sync:getStatus`
 * (below) right after subscribing.
 */
const lastSyncStatusByDir = new Map<string, SyncStatusPayload>();

/** Emit a sync status event to the renderer, safe to call when no window exists. */
function emitSyncStatus(payload: SyncStatusPayload): void {
  lastSyncStatusByDir.set(path.resolve(payload.projectDir), payload);
  safeSend("sync:status", payload);
}

const autoSync = new AutoSyncOrchestrator({
  loadLib,
  tokenStore: electronTokenStore,
  readSettings,
  emit: emitSyncStatus,
  now: Date.now,
  getWatchedDir: () => folderWatch.getWatchedDir(),
  operationLogPath,
});

/**
 * The in-flight final exit push for the project that just closed, or null.
 * Started at the folder watcher's onStop flush point (project switch/close and
 * window close both land there); `window-all-closed` awaits it before quitting
 * so the send is not killed mid-flight. It is BOUNDED inside `runExitPush`, so
 * awaiting it can never hang quit; nulled on settle so a later quit never
 * waits on a stale, already-settled promise.
 */
let pendingExitSync: Promise<void> | null = null;

const folderWatch = new FolderWatcher({
  watch: (dir, options, cb) => watch(dir, options, cb),
  resolve: (p) => path.resolve(p),
  onFolderChanged: (name) =>
    safeSend("fs:folderChanged", { filename: name }),
  onEditSignal: (dir) => {
    // Edit signal: external editors and in-app saves both land here. `dir` is
    // already the normalized (resolved) form, matching folderWatch.getWatchedDir().
    scheduleAutoSnapshot(dir);
    // Make sure the periodic safety sync is running for this project.
    autoSync.schedule(dir);
  },
  onStop: () => {
    // Project switch/close flush point (RC1-3): edits were pending a snapshot —
    // take it now (fire-and-forget) instead of dropping the timer.
    void flushAutoSnapshot();
    // Final exit push (owner decision 2026-08-23): between push windows the
    // 2-minute ticks hold local work back, so send it now. `runExitPush` is
    // bounded internally, skips when a tick is in flight, and syncProject
    // itself makes no network push when there is nothing to send. Started
    // BEFORE cancelAll() below, while the single-flight state it consults is
    // still intact. (getWatchedDir() is still the closing project here —
    // FolderWatcher.stop() nulls it only after onStop returns.) It does not
    // race the snapshot flush above: both serialize on the lib's per-repo
    // FIFO lock, and the sync pass snapshots-first on its own anyway.
    const closingDir = folderWatch.getWatchedDir();
    if (closingDir) {
      const exitSync: Promise<void> = autoSync
        .runExitPush(closingDir)
        .catch(() => {})
        .finally(() => {
          if (pendingExitSync === exitSync) pendingExitSync = null;
        });
      pendingExitSync = exitSync;
    }
    // Cancel all sync timers when the watched folder changes (project switch/close).
    autoSync.cancelAll();
  },
});

function stopFolderWatch(): void {
  folderWatch.stop();
}

function startFolderWatch(dirPath: string): void {
  folderWatch.start(dirPath);
}

// ── Credential changes drive the sync state machine ──────────────────────────
// The orchestrator's inputs (is a credential stored for the project's remote?)
// must not change behind its back: when the user connects or disconnects a
// host, re-diagnose the OPEN project and either start syncing right away
// (connect → the pill flips to "Saving changes…" within seconds — the reward
// for connecting used to be an unchanged status until some later tick) or
// re-emit the honest not-syncing state (disconnect → "connect"/"local").
onCredentialChange((host) => {
  void (async () => {
    try {
      const dir = folderWatch.getWatchedDir();
      if (!dir) return;
      const lib = await loadLib();
      const source = await lib.detectProjectSource(dir);
      if (source.type !== "local-git-folder") return;
      const diag = await lib.diagnoseProjectRemote(dir, { tokenStore: electronTokenStore });
      // Only react when the changed credential is the one this project's
      // remote resolves to — a publish-platform key (itch.io, `host#account`
      // compound keys) must not trigger a git sync.
      if (!diag.remoteHost || host.trim().toLowerCase() !== diag.remoteHost) return;
      if (diag.canSync) {
        void autoSync.armInterval(dir);
        void autoSync.run(dir);
      } else {
        emitSyncStatus({
          state: unsyncedStateFor(diag),
          projectDir: dir,
          lastSyncAt: autoSync.getLastSyncAt(dir),
          logFile: operationLogPathForDir(dir),
        });
      }
    } catch (e) {
      console.warn("[credential-change] sync re-diagnosis failed (non-fatal):", e);
    }
  })();
});

// Each BrowserWindow owns its own renderer-flush state. The active pointer is
// used only by the route/IPC seams; close handlers capture their own session so
// a macOS close -> activate -> new-window cycle cannot inherit stale gate state.
let activeRendererFlush:
  | { window: BrowserWindow; session: RendererFlushSession }
  | null = null;

/**
 * Send an IPC push to the renderer only when the window is alive (audit A3).
 * Background senders used `mainWindow?.` alone, which still throws "Object has
 * been destroyed" in the narrow window between `webContents.destroy()` and the
 * `closed` listener nulling `mainWindow`. One guarded choke point replaces the
 * eight hand-rolled null-only checks.
 */
function safeSend(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

function recordLastFlushFailure(): Promise<void> {
  const projectDir = activeWorkspaceRoot ?? undefined;
  const marker = createLastFlushFailure(projectDir);
  return updatePrefs((prefs) => ({ ...prefs, lastFlushFailed: marker })).then(() => undefined);
}

function extractHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
  if (Array.isArray(value)) return value.join(", ");
  return value;
}

function cspFrameAncestorsBlocksEmbedding(csp: string | undefined): boolean {
  if (!csp) return false;
  const directive = csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => /^frame-ancestors\b/i.test(part));
  if (!directive) return false;
  const sources = directive
    .split(/\s+/)
    .slice(1)
    .map((part) => part.trim().replace(/^'+|'+$/g, ""))
    .filter(Boolean);
  if (sources.includes("*")) return false;
  return true;
}

function registerUrlPreviewHeaderWatch() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const url = details.url;
    const isSubframe = details.resourceType === "subFrame";
    const isLocalPreview = /^https?:\/\/127\.0\.0\.1(?::\d+)?\//.test(url);
    const parentFrameId = (details as { parentFrameId?: number }).parentFrameId;
    const isTopLevelEmbeddedFrame = parentFrameId === 0;
    if (isSubframe && isTopLevelEmbeddedFrame && !isLocalPreview) {
      const xfo = extractHeader(details.responseHeaders ?? {}, "x-frame-options");
      const csp = extractHeader(details.responseHeaders ?? {}, "content-security-policy");
      const blocksEmbedding = !!xfo || cspFrameAncestorsBlocksEmbedding(csp);
      if (blocksEmbedding) {
        safeSend("url-preview:blocked", {
          url,
          reason:
            "This website does not allow embedded preview inside Gutterpress. Sign-in may have worked, but the site blocks in-app framing for security reasons.",
        });
      }
    }
    callback({ responseHeaders: details.responseHeaders });
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: "#1e1e1e",
    icon: appIconPath(),
    // Created hidden, then shown right after loadURL is dispatched (below) —
    // the in-window start screen (WelcomeLanding) is the launch surface; the
    // old external splash window is gone. The window must be VISIBLE during
    // the first render so the viewer's requestAnimationFrame-driven layout
    // produces frames (a hidden window stalls it on real hardware).
    show: false,
    webPreferences: {
      // NOTE: .cjs — a sandboxed preload cannot be ESM (see
      // electron.vite.config.ts's preload output comment).
      preload: path.resolve(HERE, "../preload/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // ARCH review finding #33: sandboxed (Electron default since v20). The
      // preload (electron/preload.ts) uses only contextBridge + ipcRenderer,
      // both sandbox-safe, so this costs nothing while shrinking the blast
      // radius of a renderer compromise in a window that intentionally hosts
      // third-party content in the cross-origin preview iframe.
      sandbox: true,
      // CRITICAL: Electron background-throttles hidden/occluded windows —
      // timers and rAF drop to ~1/sec — which collapses the first viewer
      // render to ~1 page/sec (the "12 pages in 30s" regression) whenever the
      // window is covered or minimized. Keep throttling off so layout always
      // runs at full speed.
      backgroundThrottling: false,
    },
  });
  mainWindow = win;
  const flushSession = new RendererFlushSession({
    isAlive: () => !win.isDestroyed(),
    sendFlushRequest: () => win.webContents.send("app:flushBeforeClose"),
  });
  activeRendererFlush = { window: win, session: flushSession };
  mainWindow.once("ready-to-show", () => slog("renderer ready-to-show (first paint)"));
  mainWindow.webContents.on("did-start-loading", () => slog("renderer did-start-loading"));
  mainWindow.webContents.on("did-start-navigation", (_event, _url, _isInPlace, isMainFrame) => {
    if (isMainFrame) {
      flushSession.reset();
      markdownFileLaunchQueue.suspend();
    }
  });
  mainWindow.webContents.on("dom-ready", () => {
    flushSession.markRendererLoaded();
    slog("renderer dom-ready");
  });
  mainWindow.webContents.on("did-finish-load", () => {
    flushSession.markRendererLoaded();
    slog("renderer did-finish-load");
  });
  mainWindow.setMenuBarVisibility(false);

  // H1: re-check for updates when the window regains focus, throttled (no
  // more than once per shouldBackgroundCheck()'s window — default 4h; no
  // timers, just a last-checked timestamp read at the call site) so this
  // can't hammer the release feed on every alt-tab. Silent: a network
  // failure here must not latch a user-visible error either.
  mainWindow.on("focus", () => {
    if (!updaterSupported() || !shouldBackgroundCheck()) return;
    checkForUpdates({ silent: true }).catch((err) => {
      console.warn("[updater] focus update check failed (non-fatal):", err);
    });
  });

  // Editable-field context menu. Electron ships no default menu, so inputs
  // (e.g. the Open Location URL/path field) otherwise have no right-click
  // cut/copy/paste affordance.
  mainWindow.webContents.on("context-menu", (_e, params) => {
    if (!params.isEditable && !params.selectionText) return;
    const template: Electron.MenuItemConstructorOptions[] = params.isEditable
      ? [
          { role: "cut", enabled: params.editFlags.canCut },
          { role: "copy", enabled: params.editFlags.canCopy },
          { role: "paste", enabled: params.editFlags.canPaste },
          { type: "separator" },
          { role: "selectAll" },
        ]
      : [{ role: "copy", enabled: params.editFlags.canCopy }];
    Menu.buildFromTemplate(template).popup({ window: mainWindow ?? undefined });
  });

  // ARCH review finding #1: no flow in this app actually needs an in-app
  // popup window — GitHub device-flow connect and every external link
  // already go through `shell.openExternal` (see ConnectionsSettings,
  // GitHubDialog, HelpContent, +page.svelte; a grep for
  // `window.open`/`target="_blank"` across src/ and electron/ has zero
  // hits). The previous handler granted `window.open`/`target="_blank"`
  // requests a full BrowserWindow for ANY https URL — and because
  // `overrideBrowserWindowOptions` never cleared `preload`, that popup
  // inherited the parent's full preload bridge. `decideWindowOpen` never
  // grants a popup a window at all: http(s) requests open in the system
  // browser instead, so there is nothing that could inherit the bridge.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const decision = decideWindowOpen(url);
    if (decision.action === "open-external") {
      void shell.openExternal(decision.url);
    }
    return { action: "deny" };
  });

  // ARCH review finding #1: deny top-frame navigation to anything but the
  // app's own origin (prod) / the Vite dev server (dev). Without this, the
  // cross-origin preview iframe (PreviewFrame.svelte, rendering author
  // markdown with html:true) could navigate the TOP frame via a plain
  // `<a target="_top" href="https://evil.example">` — and because the
  // preload persists across a same-window navigation, the destination
  // origin would receive the full `window.electron` bridge
  // (arbitrary-path PDF write, arbitrary-directory repo clone, preview/watch
  // control, …). http(s) destinations are opened in the system browser
  // instead of loading in place; everything else (file:, javascript:,
  // data:, arbitrary custom schemes) is denied outright.
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const decision = decideNavigation(url, originPolicyConfig());
    if (decision.action === "allow") return;
    event.preventDefault();
    if (decision.action === "open-external") {
      void shell.openExternal(decision.url);
    }
  });

  // Surface renderer errors to stdout so terminal-launched runs reveal
  // their own failures without needing DevTools.
  mainWindow.webContents.on(
    "did-fail-load",
    (_e, errorCode, errorDescription, validatedURL) => {
      console.error(
        `[renderer] did-fail-load url=${validatedURL} code=${errorCode} desc=${errorDescription}`
      );
    }
  );
  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    console.error(`[renderer] render-process-gone reason=${details.reason}`);
  });
  mainWindow.webContents.on(
    "console-message",
    (_e, level, message, line, sourceId) => {
      if (level >= 2) {
        console.error(
          `[renderer:${level === 3 ? "error" : "warn"}] ${sourceId}:${line} ${message}`
        );
      }
    }
  );

  // Dev mode: if VITE_DEV_SERVER_URL is set, load the vite dev server
  // directly. That keeps HMR, Svelte error overlays, and the rest of the
  // SvelteKit DX while still exercising the real Electron preload bridge
  // (window.electron.* IPC) against the same main process used in prod.
  //
  // Prod mode: adapter-static emits a plain static file tree to build/ (no
  // server, no build/handler.js). registerAppProtocol() (electron/
  // app-protocol.ts) reads that tree directly from disk under the app://
  // scheme, so the page has a stable app:// origin with no local server or
  // proxy involved. Load the root "/" — NOT "/index.html" — so SvelteKit's
  // client router sees the root route. (Loading /index.html makes the
  // router try to resolve a page named "index.html" and throw "Not found:
  // /index.html".)
  //
  // ARCH #1 (CRITICAL): gated by resolveDevServerUrl() — null when packaged.
  const devUrl = resolveDevServerUrl(app.isPackaged, process.env.VITE_DEV_SERVER_URL);
  mainWindow.loadURL(devUrl || "app://local/");
  if (devUrl) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  // Show the window immediately — the in-window start screen (WelcomeLanding)
  // is the launch surface, and a visible window is THE first-render-speed fix:
  // The live viewer drives pagination with requestAnimationFrame, and on
  // real hardware a hidden window (show:false) produces no compositor frames,
  // so rAF stalls and layout collapses to ~1 page/sec — the "12 pages in 30s"
  // regression.
  mainWindow.show();

  // Push OS theme changes (light↔dark) to the renderer so a "system" theme
  // mode tracks the OS live. Registered after window creation so mainWindow is
  // non-null when the event fires; removed on close to avoid a dangling ref.
  const onNativeThemeUpdated = () => {
    safeSend("app:nativeThemeUpdated", {
      shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
    });
  };
  nativeTheme.on("updated", onNativeThemeUpdated);

  // ── Unsaved-changes close gate (#44) + final auto-snapshot (RC1-3) ────────
  // Once the renderer has loaded, always intercept the first close and ask it
  // to flush. The dirty-state POST is best-effort UI telemetry, not a safety
  // decision: it may fail while a live editor still holds unsaved text. After the
  // flush (the last keystrokes are on disk), any pending auto-snapshot fires
  // before the window is destroyed, so closing the app never drops the final
  // work burst from version history. The orchestration (single owner, per-phase
  // watchdogs — flush's own 5s budget, then a snapshot backstop armed only once
  // a commit starts, so a started commit is never destroyed mid-write, R25)
  // lives in close-gate.ts; quit is never blocked indefinitely. The per-window
  // RendererFlushSession coalesces close/update requests and prevents a late
  // reply from one window settling another. DELIBERATE POLICY: a hung
  // renderer, or a sync/restore holding the per-repo FIFO lock past the
  // backstop, drops the final snapshot — never blocking quit wins over
  // guaranteeing the last snapshot. A failed editor flush is recorded in the
  // atomic prefs store for the next-launch warning; that marker write has its
  // own short backstop, so signaling the failure still cannot strand quit.
  let closeGateStarted = false;
  win.on("close", (e) => {
    if (closeGateStarted) {
      e.preventDefault();
      return;
    }
    const needsFlush = flushSession.mayHaveEditorSession;
    const needsSnapshot = autoSnapshot.hasPending();
    if (!needsFlush && !needsSnapshot) return;
    e.preventDefault();
    closeGateStarted = true;
    void runCloseGate({
      flush: () => flushSession.request(),
      recordFlushFailure: () => recordLastFlushFailure(),
      snapshot: () => flushAutoSnapshot(),
      finish: () => win.destroy(),
    });
  });

  win.on("closed", () => {
    nativeTheme.removeListener("updated", onNativeThemeUpdated);
    markdownFileLaunchQueue.suspend();
    flushSession.reset();
    if (activeRendererFlush?.session === flushSession) activeRendererFlush = null;
    stopFolderWatch();
    if (mainWindow === win) mainWindow = null;
  });
  return win;
}

// ──────────────────────────────────────────────────────────────────────────
// app:// protocol — serves the static SvelteKit SPA directly from build/
//
// SFE-P5d: the protocol handler (electron/app-protocol.ts) reads the
// adapter-static build output straight from disk — no local HTTP server, no
// bearer token, no proxy request. The privileged-scheme registration stays
// here so it runs at its original point (before app.whenReady). main.ts
// calls registerAppProtocol(buildDir) from whenReady below, after a startup
// sanity check (staticBuildLooksValid) that surfaces a friendly dialog for a
// corrupt install or an unbuilt dev tree — the same UX ARCH review #28 asked
// for, now triggered by a missing build directory instead of a failed async
// server start (there is no longer a server-start step to fail).
//
// Security equivalence (Checkpoint C): the deleted bearer token protected
// the loopback HTTP server from other local processes discovering its
// OS-assigned port. With no server, there is nothing left to authenticate a
// caller to — the surviving boundary is path-scoping (app-protocol.ts's
// resolveAssetPath refuses to resolve outside buildDir), proven by the
// traversal-refusal tests in tests/platform/app-protocol.test.ts.
// ──────────────────────────────────────────────────────────────────────────

// The `VAAPI version is too old` / `MESA-LOADER` lines in the launch log are
// harmless Chromium GPU-probe noise, NOT the cause of slow launches — the
// multi-second blank window was profile-lock contention between two instances
// (see the single-instance lock below). So we keep hardware acceleration at its
// Electron default; forcing software rendering only slows the live preview.

// Register the scheme as standard (must happen before app.whenReady) so fetch
// and origin-scoped browser APIs such as IndexedDB work from the app:// page.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

// ──────────────────────────────────────────────────────────────────────────
// Host-service hook groups (Phase 2A) (ARCH review #31). Through SFE-P5c3,
// these were consumed by both the IPC handlers registered in this file and
// the SvelteKit `+server.ts` routes running in a separate Vite bundle scope
// (hence the shared `registerHostServices()` seam rather than plain module
// state). SFE-P5c4 deleted the last `+server.ts` route, so every group below
// is now consumed only by `electron/api/*.ts`, in this same process and
// bundle — the seam stays because `electron/api/*.ts` still can't reach
// main.ts's module-private state any other way. Each group below is a plain
// object built where its dependencies live; none of them writes to
// globalThis on its own — they are all handed to ONE `registerHostServices()`
// call once every group exists (see the end of this section, next to the
// former conflict-preview site).
// ──────────────────────────────────────────────────────────────────────────
const writeHooksImpl: WriteHooks = {
  scheduleAutoSnapshot,
  scheduleAutoSync: (dir: string) => autoSync.schedule(dir),
  notifyPreviewSettledWrite: (filePath, writtenContent) => {
    activePreview?.notifySettledWrite(filePath, writtenContent);
  },
  getWatchedDir: () => folderWatch.getWatchedDir(),
  // Same host-detected root the fs guard authorizes writes against, so "this
  // write was allowed" and "this write counts as an edit" can never disagree.
  getRepositoryRoot: () => activeRepositoryRoot,
};
const watchHooksImpl: WatchHooks = {
  startFolderWatch,
  stopFolderWatch,
  getWatchedDir: () => folderWatch.getWatchedDir(),
};
const appHooksImpl: AppHooks = {
  setRendererDirty: (isDirty: boolean) => {
    activeRendererFlush?.session.setReportedDirtyState(!!isDirty);
  },
  sendToRenderer: (channel: string, ...args: unknown[]) => {
    safeSend(channel, ...args);
  },
  // The shared error filters already printed the line to the console; this
  // puts it in the app log the Logs tab shows (file only, no double print).
  logFailure: (line: string) => {
    void appendAppLog(line);
  },
};
// Wire the PDF-export progress sender to the live main window (the export
// subsystem itself lives in electron/pdf-export.ts).
initPdfExport({
  sendProgress: (event) => safeSend("build:progress", event),
});
// prefsHooksImpl is built after discoverScanDeps is initialized (below); the
// single registerHostServices() call that consumes it lives further down
// still (ARCH #31 — see that call site's comment).

// ──────────────────────────────────────────────────────────────────────────
// IPC handlers (replace the deleted /api/* SvelteKit routes)
//
// Every handler below is registered through `secureHandle`, not raw
// `ipcMain.handle`, so that ALL of them — not some hand-picked subset —
// reject invocations whose sender frame isn't the app's own origin (ARCH
// review finding #1). This is what stands between the preload's full IPC
// bridge (PDF-write, repo clone, preview/watch control, …) and any remote
// origin that a navigation/popup bug might otherwise let load into a frame.
// ──────────────────────────────────────────────────────────────────────────

/**
 * `will-navigate`/sender-validation config: prod app:// origin + (dev-only)
 * Vite dev server. ARCH review finding #1 (CRITICAL): devServerOrigin goes
 * through resolveDevServerUrl(), which is null whenever app.isPackaged — a
 * packaged build must never add an attacker-supplied VITE_DEV_SERVER_URL to
 * the trusted-origin policy that guards the IPC bridge and top-frame
 * navigation.
 */
function originPolicyConfig(): OriginPolicyConfig {
  return {
    appOrigin: APP_ORIGIN,
    devServerOrigin: resolveDevServerUrl(app.isPackaged, process.env.VITE_DEV_SERVER_URL),
  };
}

/**
 * The shared, sender-validating replacement for `ipcMain.handle` (SFE-P6b:
 * the machinery itself now lives in server-bridge/secure-handle.ts, shared
 * by every registrar below) — rejects any invocation whose
 * `event.senderFrame.url` isn't the trusted app origin (or the dev server
 * origin, in dev) before calling `listener`. One mechanism applied to every
 * channel, instead of a sender check duplicated into each handler.
 */
const secureHandle = createSecureHandle(originPolicyConfig);

// ── Folder watching (PlatformAdapter.watchFolder, #44) ──────────────────────
// Backs external-edit detection: a shallow fs.watch on the open project whose
// debounced changes are pushed to the renderer as `fs:folderChanged`. Only one
// project is open at a time, so subscribing replaces any prior watch. The
// handlers (SFE-P6b: registered in electron/api/fs-watch.ts — see that
// module's header, which carries the P1 review / PR #98 fix this comment
// used to document inline) need the live workspace/watcher state below, so
// main.ts passes it in explicitly rather than the registrar reaching back
// into main.ts's private scope.
registerFsWatchHandlers(secureHandle, {
  getActiveWorkspaceRoot: () => activeWorkspaceRoot,
  startFolderWatch,
  stopFolderWatch,
  getWatchedDir: () => folderWatch.getWatchedDir(),
  armSyncInterval: (dir) => autoSync.armInterval(dir),
});

// ── Crash recovery (#44) ────────────────────────────────────────────────────
// Sidecar snapshots under userData/recovery/. Never touches the user's file.
// Exposed to `electron/api/recovery.ts`'s IPC handlers (SFE-P5c4) through
// the collapsed host object below.
const recoveryHooksImpl: RecoveryHooks = {
  write: (filePath: string, content: string, baseMtimeMs: number) =>
    writeRecoveryStore(recoveryDir(), filePath, content, baseMtimeMs),
  clear: (filePath: string) => clearRecoveryStore(recoveryDir(), filePath),
  list: (projectDir: string) => listRecoveryStore(recoveryDir(), projectDir),
};

// ── Unsaved-changes close gate (#44) ────────────────────────────────────────
// app:flushDone kept as IPC: the preload's onFlushBeforeClose fires it from
// within the renderer via ipcRenderer.invoke — cannot route through fetch.
secureHandle("app:flushDone", async (event, flushed: boolean): Promise<void> => {
  const active = activeRendererFlush;
  if (!active || active.window.webContents !== event.sender) return;
  active.session.resolve(flushed === true);
});

// ── fs / dialog / shell / log / app — typed IPC (SFE-P5c1) ──────────────────
// Replaces src/routes/api/{fs,dialog,shell,log,app}/**/+server.ts. Each
// registrar below (SFE-P6b: electron/api/*.ts's own `register*Handlers`,
// joining the handler logic those modules already held) runs a plain
// function from electron/api/*.ts — the same validation and hook calls the
// deleted routes used, ported verbatim (see each module's own header). A
// thrown Error's message is exactly the message the HTTP route used to send
// as its response body; ipcMain.handle surfaces it to ipcRenderer.invoke's
// rejection the same way for every channel here, so callers keep reading
// `e.message` (via `friendlyHostError`) as before.
registerFsHandlers(secureHandle);
registerDialogHandlers(secureHandle);
registerShellHandlers(secureHandle);
registerLogHandlers(secureHandle);
registerAppHandlers(secureHandle);

// ── project / manifest / tpl / snip / media / plugin / theme / vcs / style —
// typed IPC (SFE-P5c2) ───────────────────────────────────────────────────
// Replaces src/routes/api/{project,manifest,tpl,snip,media,plugin,theme,
// vcs,style}/**/+server.ts. Same porting discipline as the P5c1 block above.
registerProjectHandlers(secureHandle);
registerManifestHandlers(secureHandle);
registerTplHandlers(secureHandle);
registerSnipHandlers(secureHandle);
registerMediaHandlers(secureHandle);
registerPluginHandlers(secureHandle);
registerThemeHandlers(secureHandle);
registerVcsHandlers(secureHandle);
registerStyleHandlers(secureHandle);

// ── updater / recovery / doctor / lint — typed IPC (SFE-P5c4, the LAST
// route group) ─────────────────────────────────────────────────────────────
// Replaces src/routes/api/{updater,recovery,doctor,lint}/**/+server.ts —
// the desktop HTTP route count reaches zero after this block. applyNow
// (electron/updater.ts's `installNow`) is registered alongside getStatus/
// check/download by the SAME `registerUpdaterHandlers` call — collapsing
// updater-capability.ts's HTTP+IPC fan-out to a single transport, and (SFE-
// P6b) the four separately-timed `secureHandle` calls this file used to
// carry for the group into one registrar call, called here rather than
// later next to `initUpdater()` (registration order across independent
// channels does not affect behavior — see this run's ledger note).
registerUpdaterHandlers(secureHandle);
registerRecoveryHandlers(secureHandle);
registerDoctorHandlers(secureHandle);
registerLintHandlers(secureHandle);

const desktopHooksImpl: DesktopHooks = {
  showOpenDialog: async (options) => {
    const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    return win
      ? await dialog.showOpenDialog(win, options as Electron.OpenDialogOptions)
      : await dialog.showOpenDialog(options as Electron.OpenDialogOptions);
  },
  showSaveDialog: async (options) => {
    const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    return win
      ? await dialog.showSaveDialog(win, options as Electron.SaveDialogOptions)
      : await dialog.showSaveDialog(options as Electron.SaveDialogOptions);
  },
  confirmNpmPluginInstall: async (packageName) => {
    const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    const options: Electron.MessageBoxOptions = {
      type: 'warning',
      title: 'Install npm plugin?',
      message: `Install ${packageName}?`,
      detail:
        'npm plugins are third-party code. This plugin and its dependencies will run with the app\'s full filesystem and network privileges. Only install packages you trust.',
      buttons: ['Cancel', 'Install plugin'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    };
    const result = win
      ? await dialog.showMessageBox(win, options)
      : await dialog.showMessageBox(options);
    return result.response === 1;
  },
  openExternal: async (url: string) => {
    // Defense in depth (review finding): every shell.openExternal path must
    // pass the app's single http(s)-only gate. The route validates too, but a
    // future host-side caller of this hook must not be able to launch file:/
    // mailto:/custom-scheme handlers by skipping the route.
    if (!isHttpUrl(url)) {
      throw new Error(`openExternal: refusing non-http(s) URL (${url.split(":")[0]}: scheme)`);
    }
    await shell.openExternal(url);
  },
  showItemInFolder: (filePath: string) => {
    shell.showItemInFolder(filePath);
  },
  getNativeTheme: () => ({ shouldUseDarkColors: nativeTheme.shouldUseDarkColors }),
  getUserDataPath: () => app.getPath('userData'),
};

// Media thumbnail generation is exposed through a hook rather than having
// electron/api/media.ts import `electron` directly, keeping raw Electron API
// access concentrated in main.ts (and testable via a plain injected object —
// see server-bridge/media-hooks.ts).
const mediaHooksImpl: MediaHooks = {
  async createThumbnail(filePath: string, maxPx: number): Promise<string | null> {
    const ext = filePath.slice(filePath.lastIndexOf('.') + 1).toLowerCase();
    if (ext === 'svg') {
      const s = await stat(filePath);
      if (s.size > 512 * 1024) return null;
      const buf = await readFile(filePath);
      return `data:image/svg+xml;base64,${buf.toString('base64')}`;
    }

    let img = nativeImage.createFromPath(filePath);
    if (img.isEmpty()) {
      try {
        const buf = await readFile(filePath);
        img = nativeImage.createFromBuffer(buf);
      } catch {
        return null;
      }
    }
    if (img.isEmpty()) return null;

    const { width, height } = img.getSize();
    const scaled =
      width > maxPx || height > maxPx
        ? width >= height
          ? img.resize({ width: maxPx })
          : img.resize({ height: maxPx })
        : img;
    return scaled.toDataURL();
  },
};

// ── Project discovery (#27) ─────────────────────────────────────────────────
// Shallow (depth ≤ 3) BFS scan of projectSearchRoots for Gutterpress projects
// (folders with manifest.yaml/.yml) not already in recents/favorites. The scan
// uses node:fs/promises but the traversal logic lives in discover-projects.ts
// so it stays unit-testable. Title defaults to the directory basename —
// parsing each manifest's title would make the scan far too heavy.
function defaultProjectSearchRoots(): string[] {
  const home = os.homedir();
  return [path.join(home, "Documents"), path.join(home, "Desktop")];
}

const discoverScanDeps: ScanDeps = {
  async listDirs(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  },
  async fileExists(filePath: string): Promise<boolean> {
    try {
      return (await stat(filePath)).isFile();
    } catch {
      return false;
    }
  },
  join: (...segments: string[]) => path.join(...segments),
  basename: (p: string) => basename(p),
};

// Prefs/settings hooks for the `app:*` typed IPC channels (originally built
// for server routes in Phase 2B, restored to IPC by SFE-P5c1). Built here because
// scanForProjects's closure needs discoverScanDeps, which is only assembled
// right above — a real dependency, not the ordering LANDMINE it used to be:
// this object is no longer registered on its own the moment it's built, so
// there is nothing to get wrong by reading it before `registerHostServices`
// runs at the end of this section (ARCH #31).
//
// `loadLib` is assigned directly — no cast. `host-services.ts` stores
// `HostServices.prefs` against the REAL `LibModule` type (this file's own,
// same type `loadLib` already returns), not a fabricated narrow subset, so
// `Promise<LibModule>` here needs no narrowing to satisfy the field.
const prefsHooksImpl: PrefsHooks<LibModule, DesktopPrefs, AppSettings, ProjectStateMap | undefined, RecentFolder> = {
  readPrefs,
  writePrefs,
  updatePrefs,
  readSettings,
  updateSettings,
  existingDirectory,
  readProjectState,
  writeProjectState,
  defaultProjectSearchRoots,
  scanForProjects: (roots: string[], exclude: Set<string>) => scanForProjects(roots, exclude, discoverScanDeps),
  toggleFavoriteFolder,
  removeRecentFolder,
  loadLib,
};

// Doctor hooks, exposed through the collapsed host object to
// `electron/api/doctor.ts`'s IPC handler (SFE-P5c4).
const doctorHooksImpl: DoctorHooks = {
  getDesktopVersion: () => app.getVersion(),
};

// ── Linux AppImage application-menu integration (#119) ───────────────────────
// Constructed on every platform (the service reports `supported: false` with a
// reason off-Linux / in dev / outside an AppImage, which is exactly what the
// Settings UI needs to decide whether to render the action at all). The env
// snapshot is read ONCE here: the renderer never supplies any of it, so a
// compromised or buggy client cannot redirect the install anywhere.
const appImageIntegration = new AppImageIntegration({
  platform: process.platform,
  isPackaged: app.isPackaged,
  appImagePath: process.env.APPIMAGE,
  home: app.getPath("home"),
  xdgDataHome: process.env.XDG_DATA_HOME,
  iconSourcePath: appIconPath(),
  appVersion: app.getVersion(),
});
const appImageHooksImpl: AppImageHooks = {
  getStatus: () => appImageIntegration.status(),
  install: () => appImageIntegration.install(),
  remove: () => appImageIntegration.remove(),
};

// ── Local version history (#13) ──────────────────────────────────────────────
// Thin pass-throughs to the lib's source-provider operations (isomorphic-git —
// CLAUDE.md §7: never the system git binary). The renderer drives these through
// the platform adapter; capability gating (which actions to even show) comes
// from app:classifyProject. Paths MUST be absolute (trusted SPA, but a relative
// path could resolve against the main-process CWD by accident).

// loadLib + operationLogPath for the vcs:* typed IPC handlers in
// electron/api/vcs.ts (see the comment a few lines below for the SvelteKit
// server-route history this hooks object predates).
const vcsHooksImpl: VcsHooks<LibModule> = { loadLib, operationLogPath };

function requireAbsoluteDir(channel: string, projectDir: unknown): string {
  if (typeof projectDir !== "string" || !path.isAbsolute(projectDir)) {
    throw new Error(`${channel} requires an absolute project path`);
  }
  return projectDir;
}

// Error sanitization for vcs:* lives in the shared server-bridge/friendly-errors
// module (friendlyVcsError), consumed by the vcs:* IPC handlers in
// electron/api/vcs.ts (SFE-P5c2 — the last SvelteKit vcs/*​/+server.ts route
// that used to call it directly is gone).

// ── Managed GitHub integration (#15, ADR 0006) ───────────────────────────────
// Auth (device flow), connection status, repo/branch discovery, clone-and-open.
// All real work lives in the lib (CLAUDE.md §7: isomorphic-git + plain fetch —
// never system git/gh); credentials live in the safeStorage-backed store and
// NEVER cross the IPC boundary (remote:getConnection is redacted status only).

const GITHUB_HOST = "github.com";

// lib + tokenStore + GITHUB_HOST for the remote:* IPC handlers
// (electron/api/remote.ts, SFE-P5c3). Through SFE-P5c3, these fed the
// SvelteKit remote/*​/+server.ts routes too, running in a separate Vite
// bundle that could not import from main.ts directly — hence the collapsed
// host object rather than a plain import. SFE-P5c4 deleted the last
// +server.ts route; the object stays because electron/api/remote.ts still
// can't reach main.ts's module-private state (mainWindow, safeSend) any
// other way.
//
// cloneRepository is a bound closure — not a raw piece — for the same
// reason: electron/api/remote.ts's IPC handler cannot see `mainWindow`
// directly, so the closure below does the FULL operation (validation, lib
// call, clone-progress push) the handler used to do inline. Friendly-error
// sanitization (handleRemoteErrors) stays at the IPC HANDLER, matching every
// other remote:* handler (e.g. remoteSync in electron/api/remote.ts) — these
// hooks are the raw operation.
const remoteHooksImpl: RemoteHooks<LibModule> = {
  loadLib,
  tokenStore: electronTokenStore,
  GITHUB_HOST,
  cloneRepository: async (args) => {
    if (!args || typeof args.url !== "string" || typeof args.parentDir !== "string") {
      throw new Error("remote:cloneRepository requires { url, parentDir, folderName }");
    }
    if (!path.isAbsolute(args.parentDir)) {
      throw new Error("remote:cloneRepository requires an absolute destination path");
    }
    const lib = await loadLib();
    // Folder name is renderer-supplied (defaults to the repo name) — the
    // lib's sanitizer reduces it to a single safe path segment so it can
    // never escape the chosen parent directory (path-traversal guard).
    const folderName = lib.sanitizeCloneFolderName(String(args.folderName ?? ""));
    if (!folderName) {
      throw new Error("remote:cloneRepository requires a project folder name");
    }
    const projectDir = path.join(args.parentDir, folderName);
    const credential = await electronTokenStore.get(GITHUB_HOST);
    const result = await lib.cloneRepository({
      url: args.url,
      dir: projectDir,
      ...(credential ? { credential } : {}),
      ...(args.branch ? { branch: args.branch } : {}),
      onProgress: (event: CloneProgressEvent) => {
        safeSend("remote:cloneProgress", event);
      },
    });
    // Multi-book repository: the WHOLE repo is cloned once (ADR 0006 D2);
    // the chosen book subfolder opens as the project, which classifies as
    // a subfolder of the enclosing repo and inherits its history/sync.
    const subPath = sanitizeBookSubPath(args.subPath);
    const openDir = subPath
      ? path.join(result.projectDir, ...subPath.split("/"))
      : result.projectDir;
    return { projectDir: openDir };
  },
};

// Error sanitization (handleRemoteErrors: friendly lib messages pass through;
// anything else is logged with credentials redacted and replaced with a terse
// safe message) now lives in the shared server-bridge/friendly-errors module,
// imported at the top of this file.

// The device-flow "one connect at a time" state trio lives in
// electron/github-device-flow.ts as an injected-deps class (unit-tested in
// tests/platform/github-device-flow.test.ts). main.ts wires the live
// touch-points and keeps thin delegating handlers.
//
// Pass the client id explicitly: the lib is externalized, so its own
// `process.env` read is NOT rewritten by the build — only THIS expression is
// replaced by the electron-vite `define` that bakes the release client id in.
const githubDeviceFlow = new GitHubDeviceFlow({
  loadLib,
  tokenStore: electronTokenStore,
  githubHost: GITHUB_HOST,
  clientId: () => process.env.GUTTERPRESS_GITHUB_CLIENT_ID ?? "",
});

async function showLinuxCredentialStorageNoticeOnce(): Promise<void> {
  if (!(await shouldShowLinuxBasicTextStorageNotice())) return;
  const options: Electron.MessageBoxOptions = {
    type: "warning",
    title: "GitHub sign-in protection",
    message: "Your Linux desktop keyring isn't available",
    detail:
      "Gutterpress can still connect to GitHub, but this computer can only lightly protect the saved sign-in. " +
      "The credentials file is private to your user account, but anyone with access to that account could recover it. " +
      "Set up or unlock your desktop keyring for stronger protection.",
    buttons: ["Continue"],
    defaultId: 0,
  };
  try {
    if (mainWindow) await dialog.showMessageBox(mainWindow, options);
    else await dialog.showMessageBox(options);
  } catch (e) {
    // A notification failure must never block or cancel the device flow.
    console.warn("[credential-store] could not show the Linux protection notice:", e);
    return;
  }
  try {
    await markLinuxBasicTextStorageNoticeShown();
  } catch (e) {
    console.warn(
      "[credential-store] could not remember the Linux credential-protection notice; it may be shown again:",
      e,
    );
  }
}

// remote:connectGitHubStart/Wait/Cancel — the one part of the GitHub/remote
// surface that isn't a plain `getRemoteHooks()` delegate (it closes over the
// live `githubDeviceFlow` instance and the Linux-keyring notice above, both
// main.ts-composed) — registered by its own thin registrar (SFE-P6b:
// electron/github-device-flow-registrar.ts).
registerGitHubDeviceFlowHandlers(secureHandle, {
  githubDeviceFlow,
  showLinuxCredentialStorageNoticeOnce,
});

// The Google Drive OAuth "one connect at a time" state trio (#221,
// docs/gdrive-publish-plan.md D10) — same shape as githubDeviceFlow above,
// electron/google-connect-flow.ts. Opens the auth URL via the app's single
// http(s)-only shell.openExternal gate (desktopHooksImpl.openExternal,
// defined above — the same one `shell:openExternal` calls); the credential
// is stored under the "gdrive" host in the same electronTokenStore every
// publish credential uses. Registered by its own thin registrar, like the
// GitHub trio above (electron/google-connect-flow-registrar.ts).
const googleConnectFlow = new GoogleConnectFlow({
  loadLib,
  tokenStore: electronTokenStore,
  openExternal: desktopHooksImpl.openExternal,
});

registerGoogleConnectFlowHandlers(secureHandle, googleConnectFlow);

/**
 * Validate a renderer-supplied book subfolder path (repo-relative, "/"
 * separated). Rejects traversal/absolute forms; returns "" for the repo root.
 */
function sanitizeBookSubPath(subPath: unknown): string {
  if (typeof subPath !== "string") return "";
  const cleaned = subPath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!cleaned) return "";
  const segments = cleaned.split("/");
  if (segments.some((s) => !s || s === "." || s === ".." || s === ".git")) {
    throw new Error("The selected book folder path is not valid.");
  }
  return segments.join("/");
}

// remote:disconnectGitHub, remote:getConnection, remote:listRepositories,
// remote:listBranches, remote:listRepoBooks, remote:diagnoseProject,
// remote:testRemoteAccess, remote:connectGenericHost, remote:disconnectHost,
// remote:listConnections, remote:forgeTokenUrl, remote:sync,
// remote:cloneRepository, sync:setAutoSync, sync:getStatus — SFE-P5c3,
// restored from SvelteKit server routes to typed IPC (the
// credentials-sensitive group). Every handler lives in electron/api/remote.ts
// and reuses remoteHooksImpl (below `registerHostServices` call further down
// still supplies it) through getRemoteHooks() — cloneRepository stays the
// bound closure on remoteHooksImpl it always was (it needs mainWindow for
// the clone-progress push, which a plain function module cannot reach).
// SFE-P6b moved the `secureHandle` registrations themselves into that same
// module's `registerRemoteHandlers` — see its header for what stays out
// (connectGitHubStart/Wait/Cancel, just above).
registerRemoteHandlers(secureHandle);

// publish:list, publish:providers, publish:connect, publish:disconnect,
// publish:setConfig, publish:preflight, publish:run — SFE-P5c3, restored to
// typed IPC. Publishing shares the remote hooks bag (electron/api/publish.ts's
// own header explains why) rather than a parallel registration.
registerPublishHandlers(secureHandle);

// ── fs-route project-scoping guard (ARCH review #37) ────────────────────────
// See electron/server-bridge/fs-guard.ts for the full policy this
// implements. `projectRoots` is derived SOLELY from the host-validated active
// workspace root (set before preview generation begins) plus the enclosing
// repository root detected by the host for a nested book, never from the folder
// watcher's tracked dir or from whether a preview server exists. This lets a
// multi-book project edit shared styles and assets without trusting a path
// supplied by the renderer. It
// used to also union in `folderWatch.getWatchedDir()`, but that let a
// renderer-supplied `fs:watchFolder` call (any absolute path, e.g. the user's
// SSH directory) authorize itself as a project root — the watcher's tracked
// dir is host-authorized input, not an independent authorization source (P1
// review, PR #98; `fs:watchFolder` above now rejects any dirPath that isn't
// this same `activeWorkspaceRoot`). The SPA's own open-project sequence
// (`routes/+page.svelte` / `project-lifecycle-controller.svelte.ts`) already
// awaits `startPreviewHost` (which sets `activeWorkspaceRoot`) BEFORE it
// lists/reads the new project's files (`ensureEditorFile`, the
// manifest-detection `listDir`) and BEFORE it calls `fs:watchFolder`, so
// dropping the watcher union does not 403 that legitimate
// "open a different project" window.
const fsGuardImpl: FsGuardHooks = {
  projectRoots(): string[] {
    return [activeWorkspaceRoot, activeRepositoryRoot].filter(
      (root): root is string => root !== null,
    );
  },
  readOnlyRoots(): string[] {
    // Directories legitimately READ from outside the open project:
    //  - Crash-recovery sidecar snapshots (userData/recovery/): +page.svelte's
    //    restoreRecovery reads a snapshot's absolute recoveryPath (returned by
    //    recovery:list) through the generic fs/read-file route.
    //  - Operation logs (userData/logs/): ProjectActivityView / the operation-
    //    log dialog read the per-project log file through the log/read route.
    //    App-managed, non-sensitive, never a write target through these routes.
    return [recoveryDir(), logsDir()];
  },
};

// ── picked-file one-time capability (P1 review) ─────────────────────────────
// See electron/server-bridge/picked-files.ts for the full policy. Native
// dialog picks (dialog:pickImageFile[s]) register the paths the OS dialog
// itself returned; media:importImage / fs:copyFile consume them before
// copying a src from outside the open project. One process-lifetime instance
// (not per-request), same as fsGuardImpl above.
const pickedFilesImpl = createPickedFilesService();

// ── save-path one-time capability (finding #4, 2026-07-13 maintainer review) ─
// See electron/server-bridge/picked-files.ts for the full policy. The native
// Save dialog (dialog:savePdf) registers the absolute path it itself just
// returned; the export controller (electron/export/controller.ts) consumes
// it before writing/renaming a PDF onto `out`. A separate instance from
// pickedFilesImpl above — the Save dialog's results must never authorize a
// media:importImage/fs:copyFile `src` read, and vice versa.
const savePathsImpl = createSavePathsService();

// ── Auto-sync settings (transparent-sync plan §4.3) — ARCH review #8 ────────
// The renderer calls setAutoSync(true|false) from the Settings panel via the
// `sync:setAutoSync` typed IPC channel (SFE-P5c3 restored this pure settings
// write to IPC after ARCH review #8 had briefly moved it off IPC onto the
// now-deleted `sync/set-auto-sync/+server.ts` route). We persist the flag
// into settings.versionHistory.autoSync and, if
// re-enabled, re-arm the periodic safety timer for the currently open project
// (unlatch conflict if any, since the user explicitly requested to resume).
const syncSettingsHooksImpl: SyncSettingsHooks = {
  setAutoSync: async (enabled) => {
    if (typeof enabled !== "boolean") {
      throw new Error("sync:setAutoSync requires a boolean");
    }
    // Atomic section patch (review finding): a bare readSettings()+
    // writeSettings() pair here raced the settings route's updateSettings and
    // silently reverted whichever change landed first — the exact lost-update
    // audit A2 fixed one function away.
    await updateSettings({ versionHistory: { autoSync: enabled } });

    // When re-enabling, arm the periodic timer — the author is explicitly
    // asking to resume sync.
    const watchedDir = folderWatch.getWatchedDir();
    if (enabled && watchedDir) {
      autoSync.schedule(watchedDir);
    }
    // When disabling, cancel all timers for the open project.
    if (!enabled && watchedDir) {
      autoSync.cancelTimer(watchedDir);
    }
    return { ok: true, autoSync: enabled };
  },
  getStatus: async (projectDir) => {
    if (typeof projectDir !== "string" || !projectDir) return null;
    return lastSyncStatusByDir.get(path.resolve(projectDir)) ?? null;
  },
};

// ── Updater status/check/download/applyNow hooks (ARCH review #8, SFE-P5c4,
// SFE-P6b) ───────────────────────────────────────────────────────────────
// getStatus/checkForUpdates/download/installNow (electron/updater.ts) are
// plain functions with no main.ts-only state of their OWN — but
// electron/updater.ts itself has main-bundle-only mutable state
// (phase/lastError/…) populated by the one initUpdater() call below.
// `electron/api/updater.ts`'s IPC handlers reach THIS process's initialized
// instance through the same collapsed host object as everything else —
// `applyNow` included, so that api/updater.ts (like every other
// electron/api/*.ts module) never needs a top-level `import "../updater"`,
// which would drag electron/updater.ts's own top-level `import "electron"`
// into a module that must stay loadable under plain `bun test`. `check()`
// is always the user-initiated (non-silent) form — the silent background
// recheck stays a direct call inside main.ts, sharing the same underlying
// module state.
const updaterHooksImpl: UpdaterHooks = {
  getStatus: () => getUpdaterStatus(),
  check: () => checkForUpdates(),
  download: () => downloadUpdate(),
  applyNow: () => installNow(),
};

// ── ONE registration for the entire host/route seam (ARCH review #31) ───────
// Every hook group assembled above is registered here, atomically, as a
// single `__gutterpressHost__` object — replacing the previous 11 independent
// globalThis keys written from 8 scattered call sites. This is the LAST of
// those construction points in the file, so every dependency any field's
// closures need (discoverScanDeps, GITHUB_HOST, electronTokenStore,
// activePreview, folderWatch, …) already exists.
registerHostServices({
  app: appHooksImpl,
  appImage: appImageHooksImpl,
  desktop: desktopHooksImpl,
  doctor: doctorHooksImpl,
  fsGuard: fsGuardImpl,
  media: mediaHooksImpl,
  pickedFiles: pickedFilesImpl,
  prefs: prefsHooksImpl,
  recovery: recoveryHooksImpl,
  remote: remoteHooksImpl,
  savePaths: savePathsImpl,
  sync: syncSettingsHooksImpl,
  updater: updaterHooksImpl,
  vcs: vcsHooksImpl,
  watch: watchHooksImpl,
  write: writeHooksImpl,
});

// The preview-open pipeline (start server, detect source, recents upsert,
// auto-sync arm/preflight, local-status emit) lives in
// electron/preview/controller.ts as an injected-deps class (unit-tested in
// tests/platform/preview-open-controller.test.ts) — including the api:preview
// invocation-serialization behavior (see its open() doc comment: unserialized,
// overlapping invocations interleave around activePreview stop/start
// bookkeeping and can let a superseded open stamp lastProjectDir/recents
// last). main.ts wires the live host touch-points and keeps a thin delegator.
const previewOpen = new PreviewOpenController({
  loadLib,
  clearPreviewAssetCache: () => session.defaultSession.clearCache(),
  getActivePreview: () => activePreview,
  setActivePreview: (preview) => {
    activePreview = preview;
  },
  getActiveWorkspaceRoot: () => activeWorkspaceRoot,
  setActiveWorkspaceRoot,
  setActiveRepositoryRoot,
  stat: (target) => stat(target),
  updatePrefs,
  tokenStore: electronTokenStore,
  operationLogPath,
  emitSyncStatus,
  getWatchedDir: () => folderWatch.getWatchedDir(),
  armSyncInterval: (dir) => autoSync.armInterval(dir),
  scheduleInitialSync: (dir) => autoSync.scheduleInitialSync(dir),
  mkdir: (dir, options) => mkdir(dir, options),
  appendFile: (filePath, data) => appendFile(filePath, data),
  setTimeout: (cb, ms) => setTimeout(cb, ms),
});

// api:preview / api:stopPreview registered by PreviewOpenController's own
// registrar (SFE-P6b: electron/preview/controller.ts's registerPreviewHandlers).
registerPreviewHandlers(secureHandle, previewOpen);

// api:cancelExport registered by pdf-export.ts's own registrar (SFE-P6b) —
// it only touches that module's active-export-session state, no
// main.ts-composed dependency.
registerPdfExportHandlers(secureHandle);

// The api:build export pipeline lives in electron/export/controller.ts as an
// injected-deps class (unit-tested in tests/platform/export-controller.test.ts).
// main.ts wires the live host touch-points; the `api:build` `secureHandle`
// registration itself is that same module's own `registerExportHandlers`
// (SFE-P6b).
const exportController = new ExportController({
  loadLib,
  tokenStore: electronTokenStore,
  gitIdentity: async () => gitIdentityFrom(await readSettings()),
  isOnline: () => net.isOnline(),
  usePuppeteer: () => !!process.env.GUTTERPRESS_PUPPETEER,
  engineBrowser: createElectronEngineBrowser,
  getActiveExportSession,
  setActiveExportSession,
  sendProgress: sendExportProgress,
  throwIfCanceled: throwIfExportCanceled,
  isExportCanceledError: (e) => e instanceof ExportCanceledError,
  rename: (from, to) => rename(from, to),
  rm: (p) => rm(p, { force: true }),
  consumeSavePath: (absPath) => savePathsImpl.consume(absPath),
  registerPickedPath: (absPath) => pickedFilesImpl.register([absPath]),
});

registerExportHandlers(secureHandle, exportController);

// ── Rich-editor plugin-aware projection (SFE-P3e) ───────────────────────────
//
// The host-built half of the desktop rich editor's projection: given the
// OPEN project's manifest + real loaded plugins, build a plugin-aware,
// trusted `GutterpressProjection` for whatever source the renderer is
// currently editing. See electron/editor-projection.ts for the pure,
// unit-tested implementation, its own `registerEditorProjectionHandlers`
// (SFE-P6b), and the argument validation/D14 classification
// (`resolveEditorProjection`) that handler calls.
registerEditorProjectionHandlers(secureHandle, () => activeWorkspaceRoot);

// ──────────────────────────────────────────────────────────────────────────
// Desktop updater wiring (electron-updater + macOS check-only notifier)
//
// Active only in a packaged build with no vite dev server. Windows/Linux
// AppImages use electron-updater; unsigned macOS builds use a check-only
// GitHub request and open the release page instead of staging an installer.
// Downloads require an explicit user click; installable platforms show a
// "restart to update" banner after staging.
//
// getStatus/check/download (ARCH review #8) are plain request/response —
// no push stream, no live-BrowserWindow need — but as of SFE-P5c4 they are
// typed IPC (`updater:getStatus`/`updater:check`/`updater:download`,
// registered by `registerUpdaterHandlers` above) like everything else,
// collapsing the HTTP+IPC fan-out this comment used to document. applyNow
// (registered by that same call) was always IPC: `prepareToInstall` below
// flushes the live renderer's unsaved buffer via
// `mainWindow.webContents.send` before quitting — a live-BrowserWindow call
// §8 sanctions.
// ──────────────────────────────────────────────────────────────────────────

function sendUpdaterEvent(event: UpdaterEventPayload) {
  safeSend("updater:event", event);
}
initUpdater(sendUpdaterEvent, {
  readUpdateChannel: async () => (await readSettings()).updates.channel,
  openExternal: (url) => shell.openExternal(url),
  prepareToInstall: async () => {
    const active = activeRendererFlush;
    if (!active) return false;
    const flushed = await active.session.request();
    if (!flushed) {
      await recordLastFlushFailure().catch((err) => {
        console.warn("[updater] could not record the failed pre-install flush:", err);
      });
      return false;
    }
    cancelAutoSnapshotTimer();
    return true;
  },
});

// ──────────────────────────────────────────────────────────────────────────
// App lifecycle
// ──────────────────────────────────────────────────────────────────────────

// ── Never throttle the renderer (THE first-render-speed fix) ────────────────
// Chromium throttles hidden/occluded windows: once a window has been
// visible→hidden, background timer throttling clamps the setTimeout()s
// the viewer yields on between pages, collapsing layout to ~1 page/sec
// (measured: a hidden window dropped from 490 setTimeout callbacks/2s to 35 —
// and worse on real hardware with the 1s clamp). That was the "12 pages in
// 30s" report, back when an external splash window covered the main window at
// launch. The splash is gone (the in-window start screen is the launch
// surface), but a covered/minimized window still hits the same clamp mid-
// render.
//
// `backgroundThrottling: false` on the window (set below) fixes it, but these
// app-level switches make it bulletproof: they globally disable renderer
// backgrounding, background-timer throttling, and occlusion-driven backgrounding,
// so NO window — even a fully covered one — can be throttled. Verified:
// with these switches a hidden window stays at 492 callbacks/2s even with
// backgroundThrottling left at its (throttling) default. Must be set before ready.
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

// ── OS `.md` launches ───────────────────────────────────────────────────────
// File associations can arrive before app.whenReady(), before a BrowserWindow
// exists, or before the SPA has installed its push listener. Keep raw paths in
// this host-side queue and replay them only after preload's explicit ready
// handshake. Resolution deliberately requires the nearest manifest-bearing
// ancestor; opening an unrelated Markdown file never turns its folder into a
// loose Gutterpress project.
const markdownFileLaunchQueue = new MarkdownFileLaunchQueue({
  resolve: resolveMarkdownFileLaunch,
  emit: (event: MarkdownFileLaunchEvent) => safeSend("app:openMarkdownFile", event),
});

secureHandle("app:openMarkdownFileReady", async () => {
  await markdownFileLaunchQueue.markConsumerReady();
  return { ok: true };
});

function focusMainWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// ── Single-instance lock (THE launch-speed fix) ─────────────────────────────
// A second instance pointed at the same userData dir contends with the first
// for the profile's leveldb/singleton locks — which stalls the new window's
// first paint for MANY seconds (measured: 9.2s with a second instance present
// vs 2.1s alone, same binary/profile). This happens to real users whenever a
// prior instance hasn't fully exited (crash, lingering window) or on a fast
// double-launch. Acquire the lock up front: if another instance already holds
// it, quit immediately and let the running instance focus its window instead.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  // Electron has already signalled the primary instance (see "second-instance"
  // below) by the time this returns false. Just bow out — never create a
  // second window that would fight the first for the profile.
  app.quit();
} else {
  // macOS delivers Finder launches through `open-file`, including during app
  // startup, so this listener must be installed before app.whenReady().
  app.on("open-file", (event, filePath) => {
    if (!isMarkdownFilePath(filePath)) return;
    event.preventDefault();
    markdownFileLaunchQueue.enqueue(filePath);
    if (!mainWindow && appShellReady) createWindow();
    focusMainWindow();
  });

  // Windows/Linux put an associated file in argv on the first process. macOS
  // uses open-file instead, so excluding it avoids handling one Finder launch
  // through two OS surfaces.
  if (process.platform !== "darwin") {
    markdownFileLaunchQueue.enqueueMany(
      markdownFilePathsFromArgv(process.argv, process.cwd()),
    );
  }

  app.on("second-instance", (_event, commandLine, workingDirectory) => {
    markdownFileLaunchQueue.enqueueMany(
      markdownFilePathsFromArgv(commandLine, workingDirectory || process.cwd()),
    );
    focusMainWindow();
  });

  // Record a closing line before the app actually exits — registered only in
  // this branch (the primary instance) so the loser's own app.quit() above
  // never writes a bogus "closing" entry into the log the PRIMARY instance is
  // using; that process never reaches here.
  //
  // before-quit fires before Electron proceeds with its default action, and
  // is NOT awaited by Electron — an async listener's promise is ignored, so
  // the only way to delay real quitting is the standard preventDefault-then-
  // requeue dance: cancel this attempt synchronously, write the line, then
  // call app.quit() again once the write settles (or after a short bound, so
  // a stalled disk can't leave the app unable to quit at all — logAppEvent
  // itself never rejects, but it can still hang on a wedged filesystem).
  let closingLogStarted = false;
  app.on("before-quit", (event) => {
    if (closingLogStarted) return;
    // Set BEFORE the async work starts, not in .finally() — before-quit
    // listeners aren't awaited, so a second quit trigger arriving while the
    // write is still in flight (double Cmd+Q, a second app.quit() call) would
    // otherwise still see this false and start a duplicate write + timer.
    closingLogStarted = true;
    event.preventDefault();
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 2_000));
    Promise.race([logAppEvent("[app] closing"), timeout]).finally(() => {
      app.quit();
    });
  });
}

app.whenReady().then(async () => {
  // Lost the single-instance race — app.quit() is already in flight; do not
  // proceed to create a contending window.
  if (!gotSingleInstanceLock) return;
  slog("app whenReady");
  void logAppEvent(`[app] started ${app.getVersion()}`);
  app.setAppUserModelId?.(APP_USER_MODEL_ID);
  // Resolve the static SvelteKit build directory (packaged app.asar/build vs
  // dev's build/). In dev mode (VITE_DEV_SERVER_URL set, app NOT packaged)
  // the window loads straight from the Vite dev server (below) and never
  // depends on buildDir existing — a fresh checkout that hasn't run
  // `npm run build` yet must still be able to `electron:hmr` without a false
  // "couldn't start" dialog. In prod (or a packaged build where
  // VITE_DEV_SERVER_URL is set by an attacker — ARCH review finding #1,
  // CRITICAL — resolveDevServerUrl() ignores it), buildDir is what the
  // window actually loads, so sanity-check it first: ARCH review #28, a
  // corrupt install or an unbuilt dev tree must show a plain-language native
  // dialog, not strand the author on a blank/erroring window.
  const buildDir = resolveBuildDir(app.isPackaged, HERE);
  if (!resolveDevServerUrl(app.isPackaged, process.env.VITE_DEV_SERVER_URL)) {
    if (!staticBuildLooksValid(buildDir)) {
      console.error(`[app-protocol] static build directory looks invalid: ${buildDir}`);
      dialog.showErrorBox(
        "Gutterpress couldn't start",
        "Gutterpress's interface files are missing, so the app can't load its interface.\n\n" +
        "Try quitting and reopening Gutterpress. If this keeps happening, reinstalling " +
        "Gutterpress usually fixes it.\n\n" +
        `Details: expected build output at ${buildDir}`
      );
    }
  }
  // Registered unconditionally (harmless in dev mode, where the window never
  // navigates to app://) — matches the pre-P5d registerAppProtocol call site.
  // The open project's own files are readable under app://local/__project/
  // so the editor can show a chapter's art. Same roots the fs IPC guard
  // authorizes against — never a second source of truth.
  registerAppProtocol(buildDir, () => fsGuardImpl.projectRoots());
  registerUrlPreviewHeaderWatch();
  createWindow();
  appShellReady = true;
  slog("createWindow returned (loadURL dispatched)");

  // Background check on every launch (non-blocking, silent — see H1: a
  // network failure here resets to idle instead of latching a user-visible
  // error). Findings still surface normally via the "available"/"staged"
  // events; nothing here can block or break startup.
  if (updaterSupported()) {
    checkForUpdates({ silent: true }).catch((err) => {
      console.warn("[updater] background update check failed (non-fatal):", err);
    });
  }
  // One-time cleanup of the deleted hot-swap updater's userData store
  // (web-runtime/ bundle versions + pointer files) left behind by pre-0.7
  // builds. App-generated cache only; best-effort. Not gated on
  // updaterSupported() — macOS installs (which never enable installation)
  // still carry this pre-0.7 leftover and deserve the same cleanup (L5).
  rm(path.join(app.getPath("userData"), "web-runtime"), {
    recursive: true,
    force: true,
  }).catch(() => {});

  // Pre-warm the lib graph in parallel with SPA boot. The first call to
  // window.electron.startPreview otherwise pays a 300–900ms cold-import
  // cost (node resolving + parsing the lib's dist + transitive deps).
  // Kicking it off now means the lib is already in memory by the time
  // the user finishes picking a folder in the OS dialog. Non-fatal:
  // genuine load failures will surface when the user actually invokes
  // startPreview via IPC.
  loadLib().catch((err) => {
    console.warn("[prewarm] loadLib failed (non-fatal):", err);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Network-restored trigger (transparent-sync plan §4.2): fire one sync for the
  // open project when the host comes back online.
  //
  // Electron's `net` module exposes `net.isOnline()` (and a `.online` property)
  // but is NOT a NodeJS.EventEmitter — `app.net` does not exist and `net.on()`
  // does not exist either (confirmed: Electron 42 d.ts, TS2339). Instead we poll
  // `net.isOnline()` at a low-frequency interval and fire on a false→true
  // transition. 15 s is cheap (one boolean IPC) and fast enough to feel ambient.
  let wasOnline = net.isOnline();
  const onlinePoller = setInterval(() => {
    const isNowOnline = net.isOnline();
    const watchedDir = folderWatch.getWatchedDir();
    if (!wasOnline && isNowOnline && watchedDir) {
      console.log("[auto-sync] network restored (online poll) — triggering sync");
      void autoSync.run(watchedDir);
    }
    wasOnline = isNowOnline;
  }, 15_000);
  if (typeof onlinePoller.unref === "function") onlinePoller.unref();

  powerMonitor.on("resume", () => {
    // After a sleep/wake cycle the network may have changed — give it a moment
    // to reconnect, then attempt a sync if a project is open.
    const resumedDir = folderWatch.getWatchedDir();
    if (resumedDir) {
      const t = setTimeout(() => {
        if (folderWatch.getWatchedDir() === resumedDir) {
          console.log("[auto-sync] system resumed — triggering sync");
          void autoSync.run(resumedDir);
        }
      }, 3_000);
      if (typeof t.unref === "function") t.unref();
    }
  });
});

app.on("window-all-closed", async () => {
  const exportSession = getActiveExportSession();
  if (exportSession) {
    exportSession.canceled = true;
    if (exportSession.win && !exportSession.win.isDestroyed()) {
      exportSession.win.destroy();
    }
    await rm(exportSession.tempOutPath, { force: true }).catch(() => {});
    setActiveExportSession(null);
  }
  await previewOpen.stop();
  // Wait for the final exit push (started at the watcher's onStop when the
  // window closed) so quitting does not kill the send mid-flight. It is
  // bounded inside runExitPush, so this can delay quit by a few seconds at
  // most; a pass that could not finish is picked up by the next launch's
  // first tick, which always pushes. On macOS the app outlives the window,
  // so the push simply completes in the background instead.
  if (pendingExitSync) await pendingExitSync;
  if (process.platform !== "darwin") app.quit();
});
