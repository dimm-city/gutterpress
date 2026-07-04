import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  net,
  powerMonitor,
  protocol,
  session,
  shell,
} from "electron";
import { randomUUID } from "node:crypto";
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
  mergeSettings,
  type AppSettings,
} from "./settings-store";
import { createPrefsStore } from "./prefs-store";
import { registerWriteHooks } from "./server-bridge/write-hooks";
import { registerWatchHooks } from "./server-bridge/watch-hooks";
import { registerAppHooks } from "./server-bridge/app-hooks";
import { registerPrefsHooks } from "./server-bridge/prefs-hooks";
import { registerRecoveryHooks } from "./server-bridge/recovery-hooks";
import { registerDesktopHooks, registerDoctorHooks } from "./server-bridge/host-hooks";
import { registerMediaHooks } from "./server-bridge/media-hooks";
import { registerVcsHooks } from "./server-bridge/vcs-hooks";
import { registerRemoteHooks } from "./server-bridge/remote-hooks";
import { handleRemoteErrors } from "./server-bridge/friendly-errors";
import { registerConflictPreviewHooks } from "./server-bridge/conflict-preview-hooks";
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
  installNow,
  shouldBackgroundCheck,
  getStatus as getUpdaterStatus,
} from "./updater";
import type { UpdaterEventPayload } from "./bridge-types";
import {
  upsertRecentFolder,
  removeRecentFolder,
  toggleFavoriteFolder,
} from "./recent-folders";
import {
  readProjectState,
  writeProjectState,
  migrateLegacyProjectState,
} from "./project-state";
import {
  electronTokenStore,
  type HostCredential,
} from "./credential-store";
import {
  setRecoveryBridgeWindow,
  handleConfirmResponse,
  rejectAllPendingConfirms,
  buildRecoveryContext,
  decideRunAgainAfterPreflight,
  getConflictPreviewImpl,
  preExportSyncGateBlockError,
} from "./recovery-bridge";
import {
  AutoSyncOrchestrator,
  type SyncStatusPayload,
} from "./auto-sync/orchestrator";
import { AutoSnapshotScheduler } from "./auto-snapshot/scheduler";
import { FolderWatcher } from "./folder-watch/watcher";
import type {
  AdoptFolderOptions,
  ApplyThemeTarget,
  CheckResult,
  CloneProgressEvent,
  ConfirmationGate,
  CreateProjectOptions,
  CreateProjectResult,
  DeviceCodeInfo,
  PluginValidationResult,
  PrintSafeWarning,
  ProjectCapabilities,
  ProjectPluginEntry,
  ProjectRemoteDiagnosis,
  ProjectStyle,
  RecommendedPlugin,
  RecoveryContext,
  RepoHealth,
  RemoteAccessResult,
  RemoteBranch,
  RemoteRepository,
  RepoBook,
  RestoreVersionResult,
  SourceProvider,
  SyncErrorKind,
  SyncOutcome,
  SystemDiagnostics,
  ThemeInfo,
  TokenStore as RecoveryTokenStore,
  ConflictFile as ConflictFileInfo,
  ConflictResolution as ConflictResolutionChoice,
} from "@dimm-city/print-md";
// The splash markup ships as a string baked into the main bundle (electron-vite
// inlines `?raw`), so there is no separate file to resolve at runtime.
// tsc (moduleResolution: bundler) resolves `./splash.html?raw` to the real
// `splash.html` file, which it can't type — the `declare module "*.html?raw"`
// ambient is shadowed by that on-disk file. electron-vite handles the import at
// build time; the suppression documents the tsc-only gap.
// @ts-expect-error vite `?raw` string import — resolved by electron-vite, not tsc
import splashHtml from "./splash.html?raw";
import { recoveryDir as recoveryDirImpl, operationLogPath as operationLogPathImpl } from "./recovery-paths";
import {
  ExportCanceledError,
  electronPdfRenderer,
  getActiveExportSession,
  initPdfExport,
  sendExportProgress,
  setActiveExportSession,
  throwIfExportCanceled,
  type ExportSession,
} from "./pdf-export";
import {
  registerAppProtocol,
  startSvelteKitServer,
} from "./sveltekit-host";

// Module directory, ESM-safe. We do NOT rely on electron-vite's injected
// `__dirname` shim (`const __dirname = import.meta.dirname`): after main.ts was
// split into sibling modules the shim stopped covering main.ts's own scope,
// throwing `__dirname is not defined` inside createSplashWindow → appIconPath and
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
const APP_USER_MODEL_ID = "city.dimm.print-md-viewer";
function slog(msg: string): void {
  console.log(`[startup +${Date.now() - __startupT0}ms] ${msg}`);
}
slog("main.js evaluated");

// ──────────────────────────────────────────────────────────────────────────
// Lib loader
//
// Both this main process and @dimm-city/print-md are ESM, so it's a plain
// dynamic import. The lib ships as a normal node_modules package (its package
// "files" field limits what electron-builder packages to dist/ + profiles/) —
// no afterPack hook, no symlink dance, no require()/Function() interop trick.
// ──────────────────────────────────────────────────────────────────────────

interface PreviewHandle {
  url: string;
  port: number;
  inputPath: string;
  missingSharedAssets?: string[];
  stop: () => Promise<void>;
}
interface SplitOutPath {
  outDir: string;
  pdfFileOverride?: string;
}
interface BuildResult {
  outDir: string;
  htmlPath?: string;
  pdfPath?: string;
  fingerprintPath?: string;
}
interface ManifestWithPath {
  manifest: { title?: string };
  manifestDir: string;
}
interface GitHubAuthProviderInstance {
  connect(callbacks: {
    onUserCode: (info: DeviceCodeInfo) => void;
    signal?: AbortSignal;
  }): Promise<HostCredential>;
  validate(credential: HostCredential): Promise<boolean>;
}

type LibModule = typeof import("@dimm-city/print-md");

let libPromise: Promise<LibModule> | null = null;

function loadLib(): Promise<LibModule> {
  if (!libPromise) {
    libPromise = import("@dimm-city/print-md");
  }
  return libPromise;
}

// ──────────────────────────────────────────────────────────────────────────
// PDF export subsystem lives in electron/pdf-export.ts — it owns the single
// active export session + the Electron-native PDF renderer. Wire its progress
// sender to the live main window here (initPdfExport is called after mainWindow
// is declared, in the hook-registration section below).
// ──────────────────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────────────
// Preview server state
// ──────────────────────────────────────────────────────────────────────────

let activePreview: PreviewHandle | null = null;

// ──────────────────────────────────────────────────────────────────────────
// Viewer prefs (#42/#43) — session/per-project state in viewer-prefs.json,
// separate from durable user settings (below). The ViewerPrefs shape and the
// prefsPath/readPrefs/writePrefs/existingDirectory read/write path live in
// ./prefs-store (Phase 5b extraction; unit-tested in
// tests/platform/prefs-store.test.ts) behind an injected-fs store factory.
// main.ts instantiates the store with the live Electron userData dir +
// node:fs/promises + the imported migrateLegacyProjectState and uses its
// closures unchanged.
// ──────────────────────────────────────────────────────────────────────────

const { readPrefs, writePrefs, existingDirectory } = createPrefsStore({
  getUserDataDir: () => app.getPath("userData"),
  fs: { readFile, writeFile, mkdir, stat },
  migrateLegacyProjectState,
});

// ──────────────────────────────────────────────────────────────────────────
// User settings (#45) — persisted, section-organised user preferences in a
// SEPARATE file from viewer-prefs.json so session/per-project state and durable
// user settings don't collide. The AppSettings shape, DEFAULT_SETTINGS, the
// pure mergeSettings helpers, and the injected-fs store factory live in
// ./settings-store (Phase 5b extraction; unit-tested in
// tests/platform/settings-store.test.ts). main.ts instantiates the store with
// the live Electron userData dir + node:fs/promises and uses its read/write
// closures unchanged.
// ──────────────────────────────────────────────────────────────────────────

const { readSettings, writeSettings } = createSettingsStore({
  getUserDataDir: () => app.getPath("userData"),
  fs: { readFile, writeFile, mkdir },
});

// ──────────────────────────────────────────────────────────────────────────
// Window management
// ──────────────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;

// ── Splash window ──────────────────────────────────────────────────────────
// A small frameless window shown the instant the app starts, so the user sees
// branded, animated feedback (with live status) while the main window's SPA
// boots and the first project renders. The main window stays hidden until the
// renderer reports its first screen is ready (rendered project OR welcome
// screen), at which point we show it and close the splash. A fallback timeout
// guarantees the splash never strands the user if that signal never arrives.
let splashWindow: BrowserWindow | null = null;
let mainShown = false;
let splashFallbackTimer: NodeJS.Timeout | null = null;

function createSplashWindow(): void {
  splashWindow = new BrowserWindow({
    width: 460,
    height: 280,
    frame: false,
    resizable: false,
    movable: true,
    center: true,
    alwaysOnTop: true,
    show: true,
    backgroundColor: "#1e1e1e",
    title: "print-md",
    icon: appIconPath(),
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  void splashWindow.loadURL(
    "data:text/html;charset=utf-8," + encodeURIComponent(splashHtml),
  );
  splashWindow.once("ready-to-show", () => {
    // Stamp the version into the badge once the DOM exists.
    splashWindow?.webContents
      .executeJavaScript(
        `(function(){var el=document.getElementById('splash-version');` +
          `if(el)el.textContent=${JSON.stringify("v" + app.getVersion())};})()`,
      )
      .catch(() => {});
  });
  splashWindow.on("closed", () => {
    splashWindow = null;
  });
}

let lastSubOnlySplashAt = 0;
/** Drive the splash's status line / progress bar / sub-status from the host. */
function updateSplash(status?: string, progress?: number, sub?: string): void {
  // Once the main window is shown the splash is gone (or closing) — don't waste
  // a cross-process executeJavaScript on it.
  if (mainShown) return;
  if (!splashWindow || splashWindow.isDestroyed()) return;
  // The renderer emits a sub-status per laid-out page (can be 100+). Coalesce
  // those pure sub-status pings to ~10/sec so render isn't taxed by IPC +
  // executeJavaScript chatter; meaningful status/progress changes always pass.
  if (status === undefined && progress === undefined && sub !== undefined) {
    const now = Date.now();
    if (now - lastSubOnlySplashAt < 100) return;
    lastSubOnlySplashAt = now;
  }
  const a = status === undefined ? "undefined" : JSON.stringify(status);
  const b = progress === undefined ? "undefined" : String(Number(progress));
  const c = sub === undefined ? "undefined" : JSON.stringify(sub);
  splashWindow.webContents
    .executeJavaScript(`window.__splashUpdate(${a},${b},${c})`)
    .catch(() => {});
}

/** Reveal the main window and dismiss the splash — idempotent. */
function showMainWindowAndCloseSplash(): void {
  if (mainShown) return;
  mainShown = true;
  if (splashFallbackTimer) {
    clearTimeout(splashFallbackTimer);
    splashFallbackTimer = null;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    // The window is already visible (showInactive at create time, so it renders
    // at full speed under the splash). Now bring it forward and give it focus.
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  }
  // Let the main window paint a frame before the splash vanishes, so there's no
  // dark flash between them.
  setTimeout(() => {
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
  }, 140);
}

// ── Unsaved-changes infrastructure (#44) ────────────────────────────────────
// The recovery sidecar store lives under userData/recovery/; the sync/recovery
// operation log lives under userData/logs/. The pure path/slug builders live in
// ./recovery-paths; these thin wrappers bind them to the live userData dir.
const recoveryDir = (): string => recoveryDirImpl(app.getPath("userData"));
const operationLogPath = (repoSlug: string): string =>
  operationLogPathImpl(app.getPath("userData"), repoSlug);

// A single shallow folder watcher for the open project. fs.watch is coarse and
// fires multiple times per save, so changes are debounced before notifying the
// renderer. Only one project is open at a time, so a single watcher suffices.
// The watcher/debounce/normalized-dir state + control logic lives in the
// FolderWatcher class (electron/folder-watch/watcher.ts; unit-tested in
// tests/platform/folder-watcher.test.ts) behind injected deps. main.ts keeps
// thin startFolderWatch/stopFolderWatch delegators (below) and a module-level
// MIRROR of `watchedDir` (updated ONLY via the watcher's onWatchedDirChanged)
// SOLELY so the many off-limits reads stay byte-identical.
let watchedDir: string | null = null;

// ── Automatic snapshots (RC1-3) ──────────────────────────────────────────────
// Host-side debounced auto-snapshot: every edit signal (fs:writeFile inside the
// open project + folder-watch events) ARMS/RESETS one timer; it fires after N
// minutes of quiet (settings.versionHistory, default ON / 10 min, floor 5) so
// each snapshot marks the end of a work burst — never a commit per keystroke.
// On fire: detect the source; only a `local-git-folder` that IS its own repo
// root snapshots. A plain folder is NEVER auto-`git init`ed (enabling history
// stays an explicit opt-in), and a folder nested INSIDE a larger repo (subPath
// set) is NEVER auto-snapshotted — that would silently commit to the enclosing
// repo. The lib's per-repo FIFO lock serializes the commit against
// sync/restore, and its no-empty-snapshot guard turns a clean-tree fire into
// the expected `isNoChangesError` rejection, swallowed below. Silent on success
// (the history dialog reloads its list on open).
// The single scheduler instance (electron/auto-snapshot/scheduler.ts) owns the
// pending timer + policy + the run/flush/cancel control logic — unit-tested in
// tests/platform/auto-snapshot-scheduler.test.ts. main.ts wires the injected
// deps below, keeps thin delegators (scheduleAutoSnapshot/flushAutoSnapshot/
// cancelAutoSnapshotTimer) for its call sites, and keeps a module-level MIRROR
// of the pending state (updated ONLY via onPendingChanged) SOLELY so createWindow's
// `autoSnapshotPending !== null` read stays byte-identical without reaching into
// the scheduler.
let autoSnapshotPending: { dir: string } | null = null;

const autoSnapshot = new AutoSnapshotScheduler({
  loadLib,
  readSettings,
  getWatchedDir: () => watchedDir,
  operationLogPath,
  onPendingChanged: (dir) => {
    autoSnapshotPending = dir === null ? null : { dir };
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
// Modelled on the auto-snapshot scheduler above: scheduleAutoSync arms/resets a
// debounce timer; runAutoSync calls syncProject ONLY (never statusMatrix/walks).
// The sync debounce is STRICTLY LONGER than the snapshot debounce so a burst of
// edits is always committed locally before the push attempt (§4.2 ordering
// invariant). syncProject itself also snapshots-first, making a race safe.
//
// Triggers handled here: file-change debounce and periodic safety interval.
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

/** Emit a sync status event to the renderer, safe to call when no window exists. */
function emitSyncStatus(payload: SyncStatusPayload): void {
  mainWindow?.webContents.send("sync:status", payload);
}

const autoSync = new AutoSyncOrchestrator({
  loadLib,
  tokenStore: electronTokenStore,
  readSettings,
  emit: emitSyncStatus,
  now: Date.now,
  getWatchedDir: () => watchedDir,
  operationLogPath,
  buildRecoveryContext,
});

/** Prompt initial pull after a project opens — seconds, NOT coupled to the
 *  10-min snapshot debounce (that coupling delayed the open pull ~10.5 min and
 *  hid incoming teammate changes until the user happened to edit something). */
const AUTO_SYNC_OPEN_DELAY_MS = 4_000;

const folderWatch = new FolderWatcher({
  watch: (dir, options, cb) => watch(dir, options, cb),
  resolve: (p) => path.resolve(p),
  onFolderChanged: (name) =>
    mainWindow?.webContents.send("fs:folderChanged", { filename: name }),
  onEditSignal: (dir) => {
    // Edit signal: external editors and in-app saves both land here. Use the
    // normalized dir (the resolved form) so the map key matches watchedDir.
    scheduleAutoSnapshot(dir);
    // Arm the sync debounce (strictly longer than snapshot — see scheduleAutoSync).
    autoSync.schedule(dir);
  },
  onStop: () => {
    // Project switch/close flush point (RC1-3): edits were pending a snapshot —
    // take it now (fire-and-forget) instead of dropping the timer.
    void flushAutoSnapshot();
    // Cancel all sync timers when the watched folder changes (project switch/close).
    autoSync.cancelAll();
  },
  // Keep the module-level MIRROR in lock-step with the watcher's normalized dir
  // so the many off-limits `watchedDir` reads stay byte-identical.
  onWatchedDirChanged: (dir) => {
    watchedDir = dir;
  },
});

function stopFolderWatch(): void {
  folderWatch.stop();
}

function startFolderWatch(dirPath: string): void {
  folderWatch.start(dirPath);
}

// Renderer pushes its pending-save state here so the window `close` gate can
// flush before quitting. `flushResolve` is set while main awaits the renderer's
// flush; the watchdog forces the close if the renderer never answers.
let rendererDirty = false;
let isQuitting = false;
let flushResolve: (() => void) | null = null;

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
        mainWindow?.webContents.send("url-preview:blocked", {
          url,
          reason:
            "This website does not allow embedded preview inside print-md. Sign-in may have worked, but the site blocks in-app framing for security reasons.",
        });
      }
    }
    callback({ responseHeaders: details.responseHeaders });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: "#1e1e1e",
    icon: appIconPath(),
    // Created hidden, then immediately shown INACTIVE (see mainWindow.showInactive()
    // after loadURL). It must be VISIBLE during the first render so paged.js's
    // requestAnimationFrame loop produces frames (a hidden window stalls it on real
    // hardware). The splash (alwaysOnTop) covers it until the renderer reports the
    // first screen is ready; showMainWindowAndCloseSplash() then focuses it + closes
    // the splash (with a fallback timeout so the splash can never strand the user).
    show: false,
    webPreferences: {
      preload: path.resolve(HERE, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // CRITICAL: the window now starts hidden behind the splash, and the FIRST
      // project render (paged.js) happens while it's still hidden. Electron
      // background-throttles hidden/occluded windows — timers and rAF drop to
      // ~1/sec — which made first-render "super slow" vs. the pre-splash beta
      // (which showed the window immediately). Disable throttling so layout runs
      // at full speed even before the window is revealed.
      backgroundThrottling: false,
    },
  });
  // Register the window with recovery-bridge so it can send IPC push events.
  setRecoveryBridgeWindow(mainWindow);
  mainWindow.once("ready-to-show", () => slog("renderer ready-to-show (first paint)"));
  mainWindow.webContents.on("did-start-loading", () => slog("renderer did-start-loading"));
  mainWindow.webContents.on("dom-ready", () => slog("renderer dom-ready"));
  mainWindow.webContents.on("did-finish-load", () => slog("renderer did-finish-load"));
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

  // Auth flows for URL previews sometimes rely on window.open popups, so allow
  // http(s) popups inside Electron. Renderer code should still call
  // `electron.openExternal()` when the user explicitly wants the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 1100,
          height: 760,
          parent: mainWindow ?? undefined,
          autoHideMenuBar: true,
          webPreferences: {
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
          },
        },
      };
    }
    return { action: "deny" };
  });

  // Surface renderer errors to stdout so terminal-launched runs reveal
  // their own failures without needing DevTools.
  mainWindow.webContents.on(
    "did-fail-load",
    (_e, errorCode, errorDescription, validatedURL) => {
      console.error(
        `[renderer] did-fail-load url=${validatedURL} code=${errorCode} desc=${errorDescription}`
      );
      // Don't strand the user on the splash if the SPA fails to load.
      showMainWindowAndCloseSplash();
    }
  );
  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    console.error(`[renderer] render-process-gone reason=${details.reason}`);
    showMainWindowAndCloseSplash();
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
  // Prod mode: adapter-static emits an SPA in build/. We serve it via the
  // app:// protocol so the page has a stable origin. Load the root "/" —
  // NOT "/index.html" — so SvelteKit's client router sees the root route.
  // (Loading /index.html makes the router try to resolve a page named
  // "index.html" and throw "Not found: /index.html".)
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  mainWindow.loadURL(devUrl || "app://local/");
  if (devUrl) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  // Make the window VISIBLE immediately — but INACTIVE so the splash (alwaysOnTop)
  // stays on top. This is THE first-render-speed fix: paged.js drives its
  // pagination loop with requestAnimationFrame, and on real hardware a hidden
  // window (show:false) produces no compositor frames, so rAF stalls and layout
  // collapses to ~1 page/sec — the "12 pages in 30s" regression. The pre-splash
  // build showed the window immediately for exactly this reason; keeping it
  // visible (just covered/centered under the splash) restores full render speed.
  mainWindow.showInactive();

  // Push OS theme changes (light↔dark) to the renderer so a "system" theme
  // mode tracks the OS live. Registered after window creation so mainWindow is
  // non-null when the event fires; removed on close to avoid a dangling ref.
  const onNativeThemeUpdated = () => {
    mainWindow?.webContents.send("app:nativeThemeUpdated", {
      shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
    });
  };
  nativeTheme.on("updated", onNativeThemeUpdated);

  // ── Unsaved-changes close gate (#44) + final auto-snapshot (RC1-3) ────────
  // If the renderer has a pending auto-save, intercept the first close, ask the
  // renderer to flush, and only destroy the window once it replies. After the
  // flush (the last keystrokes are on disk), any pending auto-snapshot fires
  // before the window is destroyed, so closing the app never drops the final
  // work burst from version history. A watchdog (5s — flush + commit) ensures
  // quit is never blocked indefinitely. DELIBERATE POLICY: the snapshot shares
  // the per-repo FIFO lock, so a sync/restore still in flight at quit time
  // can consume the whole 5s budget and the final snapshot is then silently
  // dropped — never blocking quit wins over guaranteeing the last snapshot.
  // (The edits themselves are flushed to disk regardless; only the history
  // entry is skipped.) The renderer pushes its dirty state via
  // `app:setDirtyState`; main never reads renderer memory.
  mainWindow.on("close", (e) => {
    if (isQuitting || !mainWindow) return;
    const needsFlush = rendererDirty;
    const needsSnapshot = autoSnapshotPending !== null;
    if (!needsFlush && !needsSnapshot) return;
    e.preventDefault();
    isQuitting = true;
    const win = mainWindow;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      flushResolve = null;
      win.destroy();
    };
    const snapshotThenFinish = () => {
      const pending = flushAutoSnapshot();
      if (pending) void pending.finally(finish);
      else finish();
    };
    if (needsFlush) {
      flushResolve = snapshotThenFinish;
      win.webContents.send("app:flushBeforeClose");
    } else {
      snapshotThenFinish();
    }
    // Watchdog: force the close if the flush/snapshot doesn't complete in time.
    setTimeout(finish, 5000);
  });

  mainWindow.on("closed", () => {
    nativeTheme.removeListener("updated", onNativeThemeUpdated);
    stopFolderWatch();
    // Reject any pending recovery confirm requests so they don't hang.
    rejectAllPendingConfirms();
    setRecoveryBridgeWindow(null);
    mainWindow = null;
  });
  return mainWindow;
}

// ──────────────────────────────────────────────────────────────────────────
// app:// protocol — serves the static SvelteKit SPA from build/
//
// The adapter-node HTTP bridge (startSvelteKitServer) and the app:// protocol
// proxy (registerAppProtocol) live in electron/sveltekit-host.ts. The privileged-
// scheme registration stays here so it runs at its original point (before
// app.whenReady). main.ts calls startSvelteKitServer(slog) + registerAppProtocol()
// from whenReady below.
// ──────────────────────────────────────────────────────────────────────────

// The `VAAPI version is too old` / `MESA-LOADER` lines in the launch log are
// harmless Chromium GPU-probe noise, NOT the cause of slow launches — the
// multi-second blank window was profile-lock contention between two instances
// (see the single-instance lock below). So we keep hardware acceleration at its
// Electron default; forcing software rendering only slows the paged.js preview.

// Register the scheme as standard (must happen before app.whenReady) so
// fetch from the page works and ServiceWorker / IndexedDB / etc. behave.
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
// Register write hooks for server routes (Phase 2A)
// The SvelteKit handler runs in this same process but in a separate Vite
// bundle scope. We use globalThis to pass the live hook references so the
// fs:writeFile server route can trigger auto-snapshot/sync debounce.
// ──────────────────────────────────────────────────────────────────────────
registerWriteHooks({
  scheduleAutoSnapshot,
  scheduleAutoSync: (dir: string) => autoSync.schedule(dir),
  getWatchedDir: () => watchedDir,
});
registerWatchHooks({
  startFolderWatch,
  stopFolderWatch,
  getWatchedDir: () => watchedDir,
});
registerAppHooks({
  updateSplash,
  showMainWindowAndCloseSplash,
  setRendererDirty: (isDirty: boolean) => { rendererDirty = !!isDirty; },
  resolveFlush: () => { rendererDirty = false; flushResolve?.(); },
  sendToRenderer: (channel: string, ...args: unknown[]) => {
    mainWindow?.webContents.send(channel, ...args);
  },
});
// Wire the PDF-export progress sender to the live main window (the export
// subsystem itself lives in electron/pdf-export.ts).
initPdfExport({
  sendProgress: (event) => mainWindow?.webContents.send("build:progress", event),
});
// registerPrefsHooks is called after discoverScanDeps is initialized (below)

// ──────────────────────────────────────────────────────────────────────────
// IPC handlers (replace the deleted /api/* SvelteKit routes)
// ──────────────────────────────────────────────────────────────────────────

// dialog:openDirectory migrated to SvelteKit server route (src/routes/api/dialog/open-directory).
// dialog:savePdf, dialog:pickImageFile, dialog:pickImageFiles, fs:copyFile
// migrated to SvelteKit server routes (src/routes/api/dialog/* and
// src/routes/api/fs/copy-file) — see Phase 2A migration.

// ── Media panel (#47): project image listing / thumbnails / inspection ───────

// media:listImages, media:thumbnail, media:inspect migrated to SvelteKit server routes
// (src/routes/api/media/*) — see Phase 2C migration.

// (thumbnail/inspect handlers removed — migrated to server routes)

// shell:openExternal, shell:showInFolder, log:read migrated to SvelteKit
// server routes (src/routes/api/shell/* and src/routes/api/log/read) —
// see Phase 2A migration.

// ── Filesystem primitives (PlatformAdapter, #41) ──────────────────────────
// fs:readFile, fs:writeFile, fs:statFile migrated to SvelteKit server routes
// (src/routes/api/fs/*) — see Phase 2A migration.

// ── Folder watching (PlatformAdapter.watchFolder, #44) ──────────────────────
// Backs external-edit detection: a shallow fs.watch on the open project whose
// debounced changes are pushed to the renderer as `fs:folderChanged`. Only one
// project is open at a time, so subscribing replaces any prior watch.
ipcMain.handle("fs:watchFolder", async (_e, dirPath: string): Promise<void> => {
  if (!path.isAbsolute(dirPath)) {
    throw new Error(`fs:watchFolder requires an absolute path, got: ${dirPath}`);
  }
  startFolderWatch(dirPath);
});

ipcMain.handle("fs:unwatchFolder", async (_e, dirPath: string): Promise<void> => {
  const normalized = path.resolve(dirPath);
  if (watchedDir === normalized) stopFolderWatch();
});

// ── Crash recovery (#44) ────────────────────────────────────────────────────
// Sidecar snapshots under userData/recovery/. Never touches the user's file.
// Exposed via SvelteKit server routes (src/routes/api/recovery/*) through
// globalThis hooks — no IPC needed.
registerRecoveryHooks({
  write: (filePath: string, content: string, baseMtimeMs: number) =>
    writeRecoveryStore(recoveryDir(), filePath, content, baseMtimeMs),
  clear: (filePath: string) => clearRecoveryStore(recoveryDir(), filePath),
  list: (projectDir: string) => listRecoveryStore(recoveryDir(), projectDir),
});

// ── Unsaved-changes close gate (#44) ────────────────────────────────────────
// app:setDirtyState migrated to server route (src/routes/api/app/dirty-state).
// app:flushDone kept as IPC: the preload's onFlushBeforeClose fires it from
// within the renderer via ipcRenderer.invoke — cannot route through fetch.
ipcMain.handle("app:flushDone", async (): Promise<void> => {
  rendererDirty = false;
  flushResolve?.();
});

// ── Directory listing (PlatformAdapter.listDir, #38) ──────────────────────
// fs:listDir migrated to SvelteKit server route (src/routes/api/fs/list-dir).
// fs:listProjectFiles migrated to SvelteKit server route
// (src/routes/api/fs/list-project-files) — see Phase 2A migration.

// api:status, lint:checkCss, lint:project, api:doctor migrated to SvelteKit server routes
// (src/routes/api/status, src/routes/api/lint/*, src/routes/api/doctor) — see Phase 2C.

registerDesktopHooks({
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
  openExternal: async (url: string) => {
    await shell.openExternal(url);
  },
  showItemInFolder: (filePath: string) => {
    shell.showItemInFolder(filePath);
  },
  getNativeTheme: () => ({ shouldUseDarkColors: nativeTheme.shouldUseDarkColors }),
  getUserDataPath: () => app.getPath('userData'),
});

// Media thumbnail generation is exposed through a hook instead of importing
// `electron` from the SvelteKit handler bundle. Packaged adapter-node routes run
// in a different ESM context, and importing Electron there can fail.
registerMediaHooks({
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
});

// app:getLastProject, app:splashStatus, app:rendererReady, app:getViewerPrefs,
// app:setViewerPrefs, app:getViewerProjectState, app:setViewerProjectState,
// app:getSettings, app:setSettings, app:getNativeTheme, app:getRecentFolders,
// app:getFavorites, app:toggleFavorite, app:removeRecent
// — all migrated to SvelteKit server routes (src/routes/api/app/*) in Phase 2B.

// ── Project discovery (#27) ─────────────────────────────────────────────────
// Shallow (depth ≤ 3) BFS scan of projectSearchRoots for print-md projects
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

// Register prefs/settings hooks for server routes (Phase 2B).
// Must be AFTER discoverScanDeps is initialized.
registerPrefsHooks({
  readPrefs,
  writePrefs,
  readSettings,
  writeSettings,
  existingDirectory,
  readProjectState,
  writeProjectState,
  mergeSettings,
  defaultProjectSearchRoots,
  scanForProjects: (roots: string[], exclude: Set<string>) => scanForProjects(roots, exclude, discoverScanDeps),
  toggleFavoriteFolder,
  removeRecentFolder,
  loadLib: loadLib as () => Promise<{
    detectProjectSource: (path: string) => Promise<unknown>;
    capabilitiesFor: (source: unknown) => unknown;
    scaffoldProject: (opts: unknown) => Promise<unknown>;
    adoptFolder: (opts: unknown) => Promise<unknown>;
  }>,
});

// Expose doctor-route hooks through globalThis so the SvelteKit handler never
// imports `electron` directly in the packaged app.
registerDoctorHooks({
  getViewerVersion: () => app.getVersion(),
});

// app:discoverProjects, app:classifyProject, app:createProject, app:adoptFolder
// — migrated to SvelteKit server routes (src/routes/api/app/*) in Phase 2B.

// tpl:listBuiltIn, tpl:listCustom, tpl:saveAsTemplate, tpl:importFromFolder,
// snip:list, snip:read, snip:save, snip:delete
// — migrated to SvelteKit server routes (src/routes/api/tpl/*, src/routes/api/snip/*) in Phase 2D.

// plugin:list, plugin:setEnabled, plugin:addNpm, plugin:import, plugin:validate, plugin:recommended,
// theme:listBuiltIn, theme:listProject, theme:getActive, theme:apply, theme:importFromFolder,
// theme:importFromUrl, theme:readCss, theme:remove, project:listStyles
// — migrated to SvelteKit server routes (src/routes/api/plugin/*, src/routes/api/theme/*, src/routes/api/project/*) in Phase 2E.

// ── Local version history (#13) ──────────────────────────────────────────────
// Thin pass-throughs to the lib's source-provider operations (isomorphic-git —
// CLAUDE.md §7: never the system git binary). The renderer drives these through
// the platform adapter; capability gating (which actions to even show) comes
// from app:classifyProject. Paths MUST be absolute (trusted SPA, but a relative
// path could resolve against the main-process CWD by accident).

// Expose loadLib + operationLogPath for VCS SvelteKit server routes.
registerVcsHooks({ loadLib, operationLogPath });

function requireAbsoluteDir(channel: string, projectDir: unknown): string {
  if (typeof projectDir !== "string" || !path.isAbsolute(projectDir)) {
    throw new Error(`${channel} requires an absolute project path`);
  }
  return projectDir;
}

// Error sanitization for vcs:* now lives in the shared server-bridge/friendly-errors
// module (friendlyVcsError), consumed by the SvelteKit routes.
// vcs:saveSnapshot, vcs:listSnapshots, vcs:listSnapshotsPage, vcs:restoreSnapshot — migrated to SvelteKit server routes (src/routes/api/vcs/*).

// ── Managed GitHub integration (#15, ADR 0006) ───────────────────────────────
// Auth (device flow), connection status, repo/branch discovery, clone-and-open.
// All real work lives in the lib (CLAUDE.md §7: isomorphic-git + plain fetch —
// never system git/gh); credentials live in the safeStorage-backed store and
// NEVER cross the IPC boundary (remote:getConnection is redacted status only).

const GITHUB_HOST = "github.com";

// Expose lib + tokenStore for remote SvelteKit server routes (Phase 2F).
// The routes live in a separate Vite bundle and cannot directly import from
// main.ts; they access loadLib / electronTokenStore / GITHUB_HOST through
// this hook (same pattern as __printMdUpdaterGetStatus__ for /api/doctor).
registerRemoteHooks({
  loadLib,
  tokenStore: electronTokenStore,
  GITHUB_HOST,
});

// Error sanitization (handleRemoteErrors: friendly lib messages pass through;
// anything else is logged with credentials redacted and replaced with a terse
// safe message) now lives in the shared server-bridge/friendly-errors module,
// imported at the top of this file.

// One device-flow connect at a time. `codePromise` resolves with the user code
// (phase 1 of the two-phase invoke); `donePromise` resolves when the user
// approves in the browser and the credential is stored (phase 2).
interface ActiveGitHubConnect {
  controller: AbortController;
  codePromise: Promise<DeviceCodeInfo>;
  donePromise: Promise<{ connected: boolean; username?: string }>;
}
let activeGitHubConnect: ActiveGitHubConnect | null = null;

ipcMain.handle("remote:connectGitHubStart", () =>
  handleRemoteErrors("remote:connectGitHubStart", async () => {
    // Replace any in-flight attempt (e.g. the user reopened the dialog).
    activeGitHubConnect?.controller.abort();
    activeGitHubConnect = null;

    const lib = await loadLib();
    const controller = new AbortController();
    let resolveCode!: (info: DeviceCodeInfo) => void;
    const codePromise = new Promise<DeviceCodeInfo>((resolve) => {
      resolveCode = resolve;
    });
    // Pass the client id explicitly: the lib is externalized, so its own
    // `process.env` read is NOT rewritten by the build — only THIS expression
    // is replaced by the electron-vite `define` that bakes the release
    // client id in. resolveGitHubClientId treats ""/undefined as unset.
    const provider = new lib.GitHubAuthProvider({
      clientId: process.env.PRINT_MD_GITHUB_CLIENT_ID ?? "",
    });
    const donePromise = provider
      .connect({ onUserCode: resolveCode, signal: controller.signal })
      .then(async (credential) => {
        await electronTokenStore.set(GITHUB_HOST, credential);
        return {
          connected: true,
          ...(credential.username ? { username: credential.username } : {}),
        };
      });
    // Park the rejection until remote:connectGitHubWait consumes it — an
    // unconsumed failure must not surface as an unhandled rejection.
    donePromise.catch(() => {});
    activeGitHubConnect = { controller, codePromise, donePromise };
    // If connect fails BEFORE producing a user code (offline, bad client id),
    // codePromise never settles — race it against the failure so the start
    // call rejects with the friendly message instead of hanging.
    return await Promise.race([codePromise, donePromise.then(() => codePromise)]);
  }),
);

ipcMain.handle("remote:connectGitHubWait", () =>
  handleRemoteErrors("remote:connectGitHubWait", async () => {
    const active = activeGitHubConnect;
    if (!active) {
      throw new Error("No GitHub sign-in is in progress. Try again.");
    }
    try {
      return await active.donePromise;
    } finally {
      if (activeGitHubConnect === active) activeGitHubConnect = null;
    }
  }),
);

ipcMain.handle("remote:connectGitHubCancel", async () => {
  activeGitHubConnect?.controller.abort();
  activeGitHubConnect = null;
  return { ok: true };
});

// remote:disconnectGitHub, remote:getConnection, remote:listRepositories,
// remote:listBranches, remote:listRepoBooks — migrated to SvelteKit server
// routes (Phase 2F). Accessed via __printMdRemoteHooks__ globalThis hook.

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

ipcMain.handle(
  "remote:cloneRepository",
  (
    _e,
    args: {
      url: string;
      parentDir: string;
      folderName: string;
      branch?: string;
      owner?: string;
      repo?: string;
      /** Book subfolder to open after the clone ("" / absent = repo root). */
      subPath?: string;
    },
  ): Promise<{ projectDir: string }> =>
    handleRemoteErrors("remote:cloneRepository", async () => {
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
        ...(args.owner && args.repo
          ? {
              provenance: {
                provider: "github" as const,
                owner: args.owner,
                repo: args.repo,
              },
            }
          : {}),
        onProgress: (event: CloneProgressEvent) => {
          mainWindow?.webContents.send("remote:cloneProgress", event);
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
    }),
);

// remote:diagnoseProject, remote:testRemoteAccess, remote:connectGenericHost,
// remote:disconnectHost, remote:listConnections, remote:forgeTokenUrl,
// remote:sync — migrated to SvelteKit server routes (Phase 2F).
// Accessed via __printMdRemoteHooks__ globalThis hook.

ipcMain.handle(
  "remote:resolveSyncConflicts",
  (
    _e,
    args: {
      projectDir: string;
      resolutions: ConflictResolutionChoice[];
      localId: string;
      remoteId: string;
    },
  ): Promise<SyncOutcome> =>
    handleRemoteErrors("remote:resolveSyncConflicts", async () => {
      if (!args || typeof args.projectDir !== "string") {
        throw new Error("remote:resolveSyncConflicts requires { projectDir }");
      }
      const dir = requireAbsoluteDir("remote:resolveSyncConflicts", args.projectDir);
      if (
        !Array.isArray(args.resolutions) ||
        args.resolutions.length === 0 ||
        !args.resolutions.every(
          (r) =>
            r &&
            typeof r.path === "string" &&
            r.path.length > 0 &&
            (r.choice === "mine" || r.choice === "theirs" || r.choice === "both"),
        )
      ) {
        throw new Error(
          "remote:resolveSyncConflicts requires a non-empty resolutions list",
        );
      }
      if (
        typeof args.localId !== "string" ||
        typeof args.remoteId !== "string" ||
        !/^[0-9a-f]{40}$/i.test(args.localId) ||
        !/^[0-9a-f]{40}$/i.test(args.remoteId)
      ) {
        throw new Error("remote:resolveSyncConflicts requires valid version ids");
      }
      const lib = await loadLib();
      const outcome = await lib.resolveConflicts({
        projectDir: dir,
        resolutions: args.resolutions,
        localId: args.localId,
        remoteId: args.remoteId,
        tokenStore: electronTokenStore,
        logFile: operationLogPath(path.basename(dir)),
      });
      // §6.1: After successful resolution, clear the conflict latch so auto-sync
      // resumes the transparent flow. The latch was set (and the timer cancelled)
      // when the conflict was first detected; re-arm it now so the resolved content
      // is pushed without requiring the user to toggle Settings off/on.
      const resolvedKey = path.resolve(dir);
      const resolvedState = autoSync.getState(resolvedKey);
      if (resolvedState) {
        resolvedState.conflictLatched = false;
        // Re-arm the periodic timer (scheduleAutoSync is idempotent — safe to
        // call even if a timer is already running).
        autoSync.schedule(resolvedKey);
      }
      return outcome;
    }),
);

// ── Sync recovery IPC (Foundation — §8 / ADR 0004) ──────────────────────────

/**
 * The renderer answers a risky-repair confirmation request. Main's pending
 * resolver map (in recovery-bridge.ts) receives the answer and unblocks the
 * awaiting recover() call.
 */
ipcMain.handle(
  "recovery:confirm-response",
  (_e, { requestId, approved }: { requestId: string; approved: boolean }) => {
    if (typeof requestId !== "string" || typeof approved !== "boolean") {
      throw new Error("recovery:confirm-response requires { requestId: string, approved: boolean }");
    }
    const found = handleConfirmResponse(requestId, approved);
    if (!found) {
      console.warn(`[recovery] stale/unknown requestId ignored: ${requestId}`);
    }
  },
);

// sync:getConflictPreview — migrated to SvelteKit server route
// (src/routes/api/sync/get-conflict-preview). Exposed via globalThis hook.
registerConflictPreviewHooks({
  getConflictPreview: async (
    projectDir: string,
    relativePath: string,
    kind: "both-edited" | "you-deleted" | "online-deleted",
  ) => {
    const lib = await loadLib();
    return getConflictPreviewImpl(projectDir, relativePath, kind, lib.onlineCopyPath);
  },
});

// ── Auto-sync settings IPC (transparent-sync plan §4.3) ─────────────────────
// The renderer calls setAutoSync(true|false) from the Settings panel. We persist
// the flag into settings.versionHistory.autoSync and, if re-enabled, re-arm the
// periodic safety timer for the currently open project (unlatch conflict if any,
// since the user explicitly requested to resume).
ipcMain.handle("sync:setAutoSync", async (_e, enabled: boolean) => {
  if (typeof enabled !== "boolean") {
    throw new Error("sync:setAutoSync requires a boolean");
  }
  const current = await readSettings();
  const updated: AppSettings = {
    ...current,
    versionHistory: { ...current.versionHistory, autoSync: enabled },
  };
  await writeSettings(updated);

  // When re-enabling, clear the conflict latch for the open project and arm
  // the periodic timer — the author is explicitly asking to resume sync.
  if (enabled && watchedDir) {
    const state = autoSync.getOrCreateState(watchedDir);
    state.conflictLatched = false;
    // Re-arm: scheduleAutoSync will start the interval.
    autoSync.schedule(watchedDir);
  }
  // When disabling, cancel all timers for the open project.
  if (!enabled && watchedDir) {
    autoSync.cancelTimer(watchedDir);
  }
  return { ok: true, autoSync: enabled };
});

// (api:doctor handler removed — migrated to server route)

ipcMain.handle("api:preview", async (_e, args: { input?: string }) => {
  const input = args?.input;
  if (!input || typeof input !== "string") {
    throw new Error("Missing 'input' (absolute path to a project directory)");
  }

  const lib = await loadLib();

  // Replace any existing preview before starting a new one.
  if (activePreview) {
    await activePreview.stop().catch(() => {});
    activePreview = null;
  }

  try {
    activePreview = await lib.startPreviewServer({
      input,
      port: 0,
      host: "127.0.0.1",
      noWatch: false,
      openBrowser: false,
      verbose: false,
      debug: false,
      installSignalHandlers: false,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack ?? "" : "";
    console.error(`[api:preview] startPreviewServer failed: input=${input}`);
    console.error(`  ${msg}`);
    if (stack) console.error(stack);
    throw new Error(`Preview server failed to start: ${msg}`);
  }

  let title: string = basename(input);
  try {
    const { manifest } = await lib.loadManifestWithPath(input);
    if (manifest.title) title = manifest.title;
  } catch {
    /* not a manifest project — keep dir basename */
  }

  const existingPrefs = await readPrefs();
  await writePrefs({
    ...existingPrefs,
    lastProjectDir: activePreview.inputPath,
    // Single source of truth for recents: every successful preview start
    // (modal, toolbar, or auto-reopen) upserts the folder here.
    recentFolders: upsertRecentFolder(existingPrefs.recentFolders, {
      path: activePreview.inputPath,
      title,
      openedAt: new Date().toISOString(),
    }),
  });

  // Trigger auto-sync once after the first auto-snapshot has had time to settle
  // (§4.2 project-open trigger). The snapshot debounce fires after N minutes of
  // quiet, so we wait for the snapshot delay + the extra sync gap before the
  // initial sync. If no edits have happened the project may already be clean, and
  // syncProject will return "up-to-date" quickly — still worth running once on
  // open to pull any teammate changes that arrived since last session.
  // Normalize so the map key and watchedDir comparison use the same canonical form.
  const openedDir = path.resolve(activePreview.inputPath);
  // Start the periodic safety-sync interval now (idempotent) so incoming changes
  // pull even in a view-only session with no edits — it must NOT wait for the
  // first file change. Then do a PROMPT initial pull a few seconds after open
  // (not coupled to the 10-min snapshot debounce — that delayed it ~10.5 min and
  // hid teammate changes). syncProject snapshots-first, so a prompt run is safe.
  void autoSync.armInterval(openedDir);

  // Local-git projects with no syncable remote get no sync status, so the
  // bottom-bar pill would stay hidden — yet they DO keep version history via
  // auto-snapshots. Emit a one-shot "local" status (carrying the operation-log
  // path) so the pill shows a clickable "Version history on" label that opens
  // the log. Isolated from the sync/recovery flow below; canSync projects get
  // their status from runAutoSync and ignore this branch.
  void (async () => {
    try {
      const source = await lib.detectProjectSource(openedDir);
      if (source.type !== "local-git-folder") return;
      const diag = await lib.diagnoseProjectRemote(openedDir, {
        tokenStore: electronTokenStore,
      });
      if (diag.canSync) return; // sync flow owns the status for syncable repos
      const logFile = operationLogPath(path.basename(openedDir));
      // Ensure the log file exists (empty) so the viewer's log dialog shows the
      // intended "No log entries recorded." empty state rather than "The log
      // file could not be found." when no snapshot has been taken yet. appendFile
      // with "" creates the file if absent and never truncates an existing one.
      try {
        await mkdir(path.dirname(logFile), { recursive: true });
        await appendFile(logFile, "");
      } catch {
        // Non-fatal: the dialog falls back to its not-found message.
      }
      const localStatus = {
        state: "local" as const,
        projectDir: openedDir,
        lastSyncAt: null,
        logFile,
      };
      // "sync:status" is a fire-and-forget event with no replay, so an emit that
      // beats the renderer's pill subscription is lost. Emit now (fast-mounted
      // renderers) AND re-emit after the same open delay the canSync path relies
      // on, by which point the pill has subscribed. Guarded by watchedDir so a
      // project switch before the delay cancels the stale re-emit.
      emitSyncStatus(localStatus);
      const t = setTimeout(() => {
        if (watchedDir === openedDir) emitSyncStatus(localStatus);
      }, AUTO_SYNC_OPEN_DELAY_MS);
      if (typeof (t as NodeJS.Timeout).unref === "function") (t as NodeJS.Timeout).unref();
    } catch {
      // Non-fatal: the pill simply stays hidden if detection/diagnosis fails.
    }
  })();

  // Preflight recovery: before the initial sync, inspect the repo for structural
  // conditions (stale lock, interrupted merge, detached head, missing git dir).
  // If a recoverable condition is detected, route through recover() BEFORE the
  // first runAutoSync so the author sees a transparent repair on open rather than
  // a sync error. guard: only for local-git-folder projects.
  //
  // CONCURRENCY: preflight acquires the single-flight lock (state.inFlight=true)
  // for the duration of recover() so runAutoSync cannot call lib.syncProject
  // concurrently on the same repo. The initialSyncTimer is cancelled while
  // preflight holds the lock; if runAutoSync fires (e.g. interval) it arms
  // runAgain instead. After preflight releases the lock we either honour runAgain
  // or, for a healthy repo, schedule a fresh initialSyncTimer.
  void (async () => {
    // Acquire single-flight lock before any git I/O.
    const syncState = autoSync.getOrCreateState(openedDir);
    if (syncState.inFlight) {
      // Another sync is already in flight (unusual at open time) — skip preflight.
      return;
    }
    syncState.inFlight = true;

    // Declared outside the try so the catch block can log to the same file even
    // if a step before ctx-creation throws (guarded: may still be undefined).
    let plog: ReturnType<typeof lib.resolveLogger> | undefined;

    try {
      const source = await lib.detectProjectSource(openedDir);
      if (source.type !== "local-git-folder") {
        // Not a git project — release immediately and let the normal initial sync proceed.
        syncState.inFlight = false;
        setTimeout(() => {
          if (watchedDir === openedDir) void autoSync.run(openedDir);
        }, AUTO_SYNC_OPEN_DELAY_MS);
        return;
      }

      const health = await lib.inspectRepo({ repoDir: openedDir });
      const kind = lib.classifyFromHealth(health) as SyncErrorKind | null;
      if (kind === null) {
        // Healthy repo — release lock and schedule the normal initial sync.
        syncState.inFlight = false;
        const t = setTimeout(() => {
          if (watchedDir === openedDir) void autoSync.run(openedDir);
        }, AUTO_SYNC_OPEN_DELAY_MS);
        if (typeof (t as NodeJS.Timeout).unref === "function") (t as NodeJS.Timeout).unref();
        return;
      }

      console.log(`[preflight] structural condition '${kind}' detected for ${openedDir}; recovering before first sync`);
      emitSyncStatus({
        state: "recovering",
        projectDir: openedDir,
        lastSyncAt: autoSync.getLastSyncAt(openedDir) ?? null,
        recovery: { phase: "checking", risk: "none" },
      });

      const preflightLogFile = operationLogPath(path.basename(openedDir));
      const ctx = await buildRecoveryContext(openedDir, lib, electronTokenStore, undefined, preflightLogFile);

      // Write the FULL structural diagnosis to the operation log BEFORE dispatching
      // recover(), so support sees WHY a kind was chosen (which health signal, repo
      // root vs opened dir, whether local changes existed) — not just a one-word
      // kind. Same file + format the recovery subsystem itself writes to.
      plog = lib.resolveLogger(preflightLogFile, "preflight");
      plog.info(
        "detect",
        "structural condition detected on open",
        lib.buildPreflightDiagnostics(openedDir, ctx.repoDir, health, kind),
      );

      let result: Awaited<ReturnType<typeof lib.recover>>;
      try {
        result = await lib.recover(kind, ctx);
      } finally {
        // Always release the single-flight lock when recover() settles.
        syncState.inFlight = false;
      }

      const now = new Date().toISOString();
      autoSync.setLastSyncAt(openedDir, now);

      // Snapshot the pending auto-sync trigger BEFORE the per-status branches:
      // runAutoSync may have set runAgain while we held the single-flight lock.
      // A single authoritative decision below (decideRunAgainAfterPreflight)
      // decides its fate so it is never silently dropped (BUG 3). The latching
      // branches still clear runAgain themselves for their own emit logic; the
      // post-chain decision is the one place that may actually re-run it.
      const pendingRunAgain = syncState.runAgain;

      if (result.status === "recovered") {
        emitSyncStatus({
          state: "recovered",
          projectDir: openedDir,
          lastSyncAt: now,
          backupZipPath: result.backupZipPath,
          logFile: preflightLogFile,
        });
        // The repo is healthy again: clear any conflict-latch and RESUME sync so
        // the fix isn't left paused. If a trigger was already queued while we held
        // the lock, decideRunAgainAfterPreflight below will run it ("run") — so
        // only schedule the deferred sync here when nothing is queued, to avoid a
        // double-run on the same repo.
        syncState.conflictLatched = false;
        if (!pendingRunAgain) {
          plog.info("resume", "recovered — scheduling deferred sync", {
            reason: "no queued trigger",
          });
          const t = setTimeout(() => {
            if (watchedDir === openedDir) void autoSync.run(openedDir);
          }, AUTO_SYNC_OPEN_DELAY_MS);
          if (typeof (t as NodeJS.Timeout).unref === "function") (t as NodeJS.Timeout).unref();
        } else {
          plog.info("resume", "recovered — honoring queued trigger", {
            reason: "runAgain pending",
          });
        }
      } else if (result.status === "retry_later") {
        emitSyncStatus({ state: "offline", projectDir: openedDir, lastSyncAt: now });
        // Honor the handler's requested delay (same idiom as the mid-sync
        // retry_later arm) instead of waiting for the generic periodic timer —
        // e.g. a fresh-but-not-stale lock asks to be re-checked as soon as it
        // ages past the threshold, not minutes later.
        const delay = result.retryAfterMs ?? 60_000;
        const retryTimer = setTimeout(() => {
          if (watchedDir === openedDir) void autoSync.run(openedDir);
        }, delay);
        if (typeof retryTimer.unref === "function") retryTimer.unref();
      } else if (result.status === "needs_user" && result.files && result.files.length > 0) {
        // Conflict-latch: stop the periodic timer to avoid churning.
        syncState.conflictLatched = true;
        syncState.runAgain = false;
        autoSync.cancelTimer(openedDir);
        emitSyncStatus({
          state: "conflict",
          files: result.files as ConflictFileInfo[],
          projectDir: openedDir,
          lastSyncAt: now,
          logFile: preflightLogFile,
        });
      } else {
        // blocked / failed / needs_user (auth) — latch and show guidance.
        syncState.conflictLatched = true;
        syncState.runAgain = false;
        autoSync.cancelTimer(openedDir);
        emitSyncStatus({
          state: "error",
          projectDir: openedDir,
          lastSyncAt: now,
          guidance: "guidance" in result ? result.guidance : undefined,
          backupZipPath: "backupZipPath" in result ? result.backupZipPath : undefined,
          logFile: preflightLogFile,
        });
      }

      // Honour (or intentionally suppress) the pending auto-sync trigger now that
      // recover() has settled and the lock is released. For non-latching outcomes
      // (recovered / retry_later) a queued trigger PROCEEDS — fixing the silent
      // drop on the retry_later path. For latching outcomes (conflict/blocked/
      // failed) the latch suppresses it. Always clear the flag so it can't leak
      // into a later run. (BUG 3 — see decideRunAgainAfterPreflight.)
      const runAgainDecision = decideRunAgainAfterPreflight(result.status, pendingRunAgain);
      syncState.runAgain = false;
      if (runAgainDecision === "run") {
        void autoSync.run(openedDir);
      }
    } catch (err) {
      // Preflight is non-blocking: always release the lock so the project is not
      // permanently wedged. Then let the normal initial sync proceed.
      syncState.inFlight = false;
      console.warn("[preflight] recovery failed (non-fatal):", err);
      plog?.error("preflight", "recovery failed (non-fatal)", { error: String(err) });
      const t = setTimeout(() => {
        if (watchedDir === openedDir) void autoSync.run(openedDir);
      }, AUTO_SYNC_OPEN_DELAY_MS);
      if (typeof (t as NodeJS.Timeout).unref === "function") (t as NodeJS.Timeout).unref();
    }
  })();
  // NOTE: the initialSyncTimer that used to be here has been moved inside the
  // preflight IIFE above so the first runAutoSync is always deferred until after
  // preflight releases its single-flight lock.

  return {
    url: activePreview.url,
    port: activePreview.port,
    input: activePreview.inputPath,
    title,
    missingSharedAssets: activePreview.missingSharedAssets ?? [],
  };
});

ipcMain.handle("api:stopPreview", async () => {
  if (activePreview) {
    await activePreview.stop().catch(() => {});
    activePreview = null;
  }
  return { stopped: true };
});

ipcMain.handle("api:cancelExport", async (_e, exportId: string) => {
  const session = getActiveExportSession();
  if (!session || session.id !== exportId) {
    return { canceled: false };
  }
  session.canceled = true;
  const exportWin = session.win;
  if (exportWin && !exportWin.isDestroyed()) {
    exportWin.destroy();
  }
  return { canceled: true };
});

ipcMain.handle(
  "api:build",
  async (
    _e,
    args: {
      input: string;
      format?: "pdf" | "html" | "pdfx";
      out?: string;
      title?: string;
      pdfxFlavor?: string;
      icc?: string;
      manifest?: string;
      stripAnnotations?: boolean;
      skipLint?: boolean;
      skipPreValidate?: boolean;
      skipPostValidate?: boolean;
    }
  ) => {
    if (!args?.input) throw new Error("Missing 'input'");
    const format = args.format ?? "pdf";
    if (format === "pdfx" && !args.icc) {
      throw new Error("PDF/X format requires 'icc' (ICC profile path)");
    }

    const lib = await loadLib();
    if (getActiveExportSession()) {
      throw new Error("A PDF export is already in progress");
    }
    const requestedOutPath = args.out;
    if (!requestedOutPath) {
      throw new Error("Missing 'out' for PDF export");
    }

    // ── PDF-export safety gate (transparent-sync plan §5.3) ──────────────────
    // Before building, check the open project's sync state and act accordingly:
    //   synced / up-to-date  → proceed immediately.
    //   dirty + online       → sync first (so the PDF includes teammate changes).
    //   offline              → proceed but warn (renderer receives a message).
    //   conflict-latched     → block and return a typed error (author must resolve).
    // Only runs when the exported dir is the currently open project and auto-sync
    // is configured (canSync + credential). Local-only projects skip the gate.
    // path.resolve() normalises the export dir to match the autoSyncStates key,
    // which is always normalised at assignment time in startFolderWatch.
    const exportDir = path.resolve(args.input);
    // Use exportDir (already path.resolve'd) as the canonical key into
    // autoSyncStates so both the hard-block read and the mid-gate conflict write
    // (autoSync.getOrCreateState(exportDir) below) use the same key — regardless
    // of whether exportDir happens to equal watchedDir.
    const exportSyncState = autoSync.getState(exportDir);
    if (exportSyncState?.conflictLatched) {
      // Hard block: the author MUST resolve before a PDF can be trusted.
      const err = new Error(
        "Cannot save a PDF while there are unresolved changes from two places. " +
        "Resolve the conflict first, then try again.",
      );
      (err as Error & { code?: string }).code = "SYNC_CONFLICT";
      throw err;
    }
    // Attempt a pre-export sync when online + canSync. Its only hard effect is
    // the conflict BLOCK below (a PDF must not be built over an unresolved
    // conflict); every other outcome is soft — the PDF uses local content,
    // which is always valid and fully snapshotted. Gate errors are non-fatal.
    try {
      const exportSource = await lib.detectProjectSource(exportDir);
      if (exportSource.type === "local-git-folder") {
        // Credential-aware gate (ADR 0006 D4) — NOT capabilitiesFor().canSync,
        // which is hasRemote-only and would attempt a pre-export syncProject
        // (returning auth) for SSH or uncredentialed-HTTPS projects on every export.
        const exportDiag = await lib.diagnoseProjectRemote(exportDir, {
          tokenStore: electronTokenStore,
        });
        if (exportDiag.canSync && net.isOnline()) {
          const syncOutcome = await lib.syncProject({
            projectDir: exportDir,
            tokenStore: electronTokenStore,
          });
          if (syncOutcome.status === "conflict") {
            // A conflict surfaced mid-export-gate: latch and block.
            const state = autoSync.getOrCreateState(exportDir);
            state.conflictLatched = true;
            autoSync.cancelTimer(exportDir);
            const gateConflictAt = new Date().toISOString();
            autoSync.setLastSyncAt(exportDir, gateConflictAt);
            emitSyncStatus({
              state: "conflict",
              files: syncOutcome.files,
              projectDir: exportDir,
              lastSyncAt: gateConflictAt,
            });
            const conflictErr = new Error(
              "Changes happened in two places. Resolve the conflict first, then save the PDF.",
            );
            (conflictErr as Error & { code?: string }).code = "SYNC_CONFLICT";
            throw conflictErr;
          }
          // synced / up-to-date / offline / auth / error → export proceeds with
          // local content (the ambient pill already reflects the sync state).
        }
      }
    } catch (gateErr) {
      // Re-throw conflict blocks; swallow all other gate errors (non-fatal for export).
      const blockErr = preExportSyncGateBlockError(gateErr);
      if (blockErr) throw blockErr;
      const msg = gateErr instanceof Error ? gateErr.message : String(gateErr);
      console.warn(`[api:build] pre-export sync gate failed (non-fatal): ${msg}`);
    }
    // ── end PDF-export safety gate ────────────────────────────────────────────

    const tempOutPath = `${requestedOutPath}.print-md.tmp.pdf`;
    const { outDir, pdfFileOverride } = lib.splitOutPath(tempOutPath, format);
    const exportSession: ExportSession = {
      id: randomUUID(),
      canceled: false,
      outPath: requestedOutPath,
      tempOutPath,
      win: null,
    };
    setActiveExportSession(exportSession);
    sendExportProgress({ exportId: exportSession.id, state: "started" });

    try {
      const result = await lib.runBuild({
        inputDir: args.input,
        format,
        outDir,
        pdfFileOverride,
        title: args.title,
        pdfxFlavor: args.pdfxFlavor as any,
        iccPath: args.icc,
        manifestPath: args.manifest,
        stripAnnotations: args.stripAnnotations,
        skipLint: args.skipLint,
        skipPreValidate: args.skipPreValidate,
        skipPostValidate: args.skipPostValidate,
        // Render with Electron's own Chromium unless explicitly opted out.
        pdfRenderer: process.env.PRINTMD_VIEWER_PUPPETEER
          ? undefined
          : electronPdfRenderer,
        rawArgs: { input: args.input, format, out: args.out },
      });
      throwIfExportCanceled(exportSession);
      await rename(exportSession.tempOutPath, exportSession.outPath);
      sendExportProgress({
        exportId: exportSession.id,
        state: "success",
        message: exportSession.outPath,
      });
      return {
        exportId: exportSession.id,
        outDir: result.outDir,
        htmlPath: result.htmlPath,
        pdfPath: exportSession.outPath,
        fingerprintPath: result.fingerprintPath,
      };
    } catch (e: unknown) {
      if (exportSession.canceled || e instanceof ExportCanceledError) {
        sendExportProgress({ exportId: exportSession.id, state: "canceled" });
        const err = new Error("PDF export canceled");
        (err as Error & { code?: string }).code = "EXPORT_CANCELED";
        throw err;
      }
      // BuildError carries actionable multi-line text from the lib's
      // preflightBuildTools / requireChromiumExecutable — preserve it.
      if (e instanceof lib.BuildError) {
        const err = new Error(e.message);
        (err as Error & { code?: string }).code = "BUILD_ERROR";
        throw err;
      }
      // Generic spawn ENOENT: wrap with a friendlier message identifying
      // the missing tool. (Preflight should have caught this earlier, but
      // some downstream tools — e.g. when a tool exists but errors out —
      // can still surface raw ENOENT here.)
      if (e instanceof Error && (e as Error & { code?: string }).code === "ENOENT") {
        const syscall = (e as Error & { syscall?: string }).syscall ?? "";
        const path = (e as Error & { path?: string }).path ?? "";
        const tool = path || syscall.replace(/^spawn /, "");
        const err = new Error(
          `Required system tool not found: ${tool}\n\n` +
          `Install it and re-run. See User Guide Chapter 8 (examples/print-md-user-guide/08-system-setup.md) for per-platform instructions.\n\n` +
          `Underlying error: ${e.message}`
        );
        (err as Error & { code?: string }).code = "TOOL_MISSING";
        throw err;
      }
      sendExportProgress({
        exportId: exportSession.id,
        state: "error",
        message: e instanceof Error ? e.message : String(e),
      });
      throw e;
    } finally {
      setActiveExportSession(null);
      await rm(exportSession.tempOutPath, { force: true }).catch(() => {});
    }
  }
);

// ──────────────────────────────────────────────────────────────────────────
// Auto-updater wiring (electron-updater — full-app updates from GitHub)
//
// Active only in a packaged build with no vite dev server, on Windows/Linux
// (see updaterSupported() in updater.ts; macOS auto-update needs signed
// builds). In dev the IPC handlers are harmless no-ops. electron-updater
// downloads updates in the background; the renderer shows a "restart to
// update" banner on the "staged" event and calls updater:applyNow to quit
// and install.
// ──────────────────────────────────────────────────────────────────────────

function sendUpdaterEvent(event: UpdaterEventPayload) {
  mainWindow?.webContents.send("updater:event", event);
}
initUpdater(sendUpdaterEvent);

ipcMain.handle("updater:getStatus", async () => {
  return getUpdaterStatus();
});

ipcMain.handle("updater:check", async () => {
  // Platform gating (incl. the macOS/non-AppImage-Linux "download from
  // GitHub" hint) lives inside checkForUpdates() so every caller gets the
  // same honest status. User-initiated (non-silent): failures are reported.
  return checkForUpdates();
});

ipcMain.handle("updater:download", async () => {
  return downloadUpdate();
});

ipcMain.handle("updater:applyNow", async () => {
  // Flush unsaved editor state BEFORE the installer spawns: quitAndInstall
  // launches the NSIS installer (Windows) synchronously and only then quits,
  // so the installer would otherwise sit waiting on process exit while the
  // close-gate flush (up to 5s) still runs. Flushing here keeps that window
  // empty and the data safe; rendererDirty=false afterwards means the close
  // gate won't need a second flush during the quit sequence.
  if (rendererDirty && mainWindow && !mainWindow.isDestroyed()) {
    await new Promise<void>((resolve) => {
      flushResolve = resolve;
      mainWindow!.webContents.send("app:flushBeforeClose");
      // Same watchdog budget as the close gate — never block the install.
      setTimeout(resolve, 5000);
    });
    flushResolve = null;
  }
  if (updaterSupported() && getUpdaterStatus().stagedVersion) cancelAutoSnapshotTimer();
  return installNow();
});

// ──────────────────────────────────────────────────────────────────────────
// App lifecycle
// ──────────────────────────────────────────────────────────────────────────

// ── Never throttle the hidden renderer (THE first-render-speed fix) ─────────
// The main window starts hidden behind the splash, and the FIRST project render
// (paged.js) runs while it's hidden. Chromium throttles hidden/occluded windows:
// once a window has been visible→hidden, background timer throttling clamps the
// setTimeout()s paged.js yields on between pages, collapsing layout to ~1 page/sec
// (measured: a hidden window dropped from 490 setTimeout callbacks/2s to 35 — and
// worse on real hardware with the 1s clamp). That is the "12 pages in 30s" report.
//
// `backgroundThrottling: false` on the window (set below) fixes it, but these
// app-level switches make it bulletproof: they globally disable renderer
// backgrounding, background-timer throttling, and occlusion-driven backgrounding,
// so NO window — even one fully covered by the splash — can be throttled. Verified:
// with these switches a hidden window stays at 492 callbacks/2s even with
// backgroundThrottling left at its (throttling) default. Must be set before ready.
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

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
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

app.whenReady().then(async () => {
  // Lost the single-instance race — app.quit() is already in flight; do not
  // proceed to create a contending window.
  if (!gotSingleInstanceLock) return;
  slog("app whenReady");
  app.setAppUserModelId?.(APP_USER_MODEL_ID);
  // Show the splash immediately — branded feedback while everything below runs.
  createSplashWindow();

  updateSplash("Preparing the interface…", 18);
  // In dev mode (VITE_DEV_SERVER_URL set) the SvelteKit dev server is already
  // running externally — skip the local handler.js launch. In prod, start the
  // adapter-node HTTP server and wire it to the app:// protocol.
  if (!process.env.VITE_DEV_SERVER_URL) {
    try {
      await startSvelteKitServer(slog);
    } catch (err) {
      console.error("[sk-server] failed to start SvelteKit server:", err);
      // Non-fatal: registerAppProtocol will return 503 until skServerPort is set.
    }
  }
  registerAppProtocol();
  registerUrlPreviewHeaderWatch();
  updateSplash("Loading print-md…", 28);
  createWindow();
  slog("createWindow returned (loadURL dispatched)");

  // Fallback: if the renderer never reports ready (crash, hang), reveal the
  // window anyway so the splash can't strand the user. Generous (60s) so a large
  // book on a slow machine finishes rendering and dismisses the splash on its own
  // signal rather than being cut off mid-render by the timeout.
  splashFallbackTimer = setTimeout(showMainWindowAndCloseSplash, 15_000);

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
  // updaterSupported() — macOS installs (which never enable auto-update)
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
    const resumedDir = watchedDir;
    if (resumedDir) {
      const t = setTimeout(() => {
        if (watchedDir === resumedDir) {
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
  if (activePreview) {
    await activePreview.stop().catch(() => {});
    activePreview = null;
  }
  if (process.platform !== "darwin") app.quit();
});
