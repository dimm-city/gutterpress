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
import { watch, type FSWatcher } from "node:fs";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { scanForProjects, type ScanDeps } from "./discover-projects";
import { registerWriteHooks } from "./server-bridge/write-hooks";
import { registerWatchHooks } from "./server-bridge/watch-hooks";
import { registerAppHooks } from "./server-bridge/app-hooks";
import { registerPrefsHooks } from "./server-bridge/prefs-hooks";
import {
  writeRecovery as writeRecoveryStore,
  clearRecovery as clearRecoveryStore,
  listRecovery as listRecoveryStore,
} from "./recovery";
import {
  ensureLayout,
  resolveWebRoot,
  readPointer,
  readState,
  writeState,
} from "./updater/web-runtime";
import {
  checkForUpdate,
  downloadAndStage,
  promoteStaged,
  rollback,
  pruneVersions,
  getStatus,
} from "./updater/index";
import {
  upsertRecentFolder,
  removeRecentFolder,
  toggleFavoriteFolder,
  type RecentFolder,
  type FavoriteFolder,
} from "./recent-folders";
import {
  readProjectState,
  writeProjectState,
  migrateLegacyProjectState,
  type ProjectState,
  type ProjectStateMap,
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
  ProjectSource,
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

function appIconPath(): string {
  const packaged = path.resolve(process.resourcesPath ?? "", "build-resources/icon.png");
  const dev = path.resolve(__dirname, "../../build-resources/icon.png");
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

// __dirname/__filename are injected by electron-vite for the ESM main bundle
// (resolves to out/main/ at runtime).

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
interface ExportProgressEvent {
  exportId: string;
  state: "started" | "rendering" | "finalizing" | "success" | "canceled" | "error";
  pages?: number;
  message?: string;
}
interface ExportSession {
  id: string;
  canceled: boolean;
  outPath: string;
  tempOutPath: string;
  win: BrowserWindow | null;
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
let activeExportSession: ExportSession | null = null;

class ExportCanceledError extends Error {
  code = "EXPORT_CANCELED";

  constructor(message = "PDF export canceled") {
    super(message);
    this.name = "ExportCanceledError";
  }
}

function loadLib(): Promise<LibModule> {
  if (!libPromise) {
    libPromise = import("@dimm-city/print-md");
  }
  return libPromise;
}

// ──────────────────────────────────────────────────────────────────────────
// PDF renderer — uses Electron's OWN bundled Chromium (a hidden BrowserWindow +
// webContents.printToPDF) instead of spawning an external Chromium via
// puppeteer. The viewer already ships Chromium (it IS Electron), so this drops
// the external-browser dependency for PDF export with zero added bytes and full
// Paged.js fidelity (ADR 0002, Phase 4). Injected into lib.runBuild as the
// `pdfRenderer` override; the lib still serves the staged HTML + assets on a
// local HTTP server, so asset resolution is identical to the puppeteer path.
//
// Escape hatch: set PRINTMD_VIEWER_PUPPETEER=1 to fall back to the lib's default
// puppeteer renderer (requires a system/bundled Chromium on PATH).
// ──────────────────────────────────────────────────────────────────────────

function sendExportProgress(event: ExportProgressEvent) {
  mainWindow?.webContents.send("build:progress", event);
}

function requireActiveExportSession(): ExportSession {
  if (!activeExportSession) {
    throw new Error("No active export session");
  }
  return activeExportSession;
}

function throwIfExportCanceled(session: ExportSession) {
  if (session.canceled) {
    throw new ExportCanceledError();
  }
}

async function electronPdfRenderer(input: {
  url: string;
  outPdf: string;
  timeoutMs: number;
}): Promise<void> {
  const session = requireActiveExportSession();
  throwIfExportCanceled(session);
  const win = new BrowserWindow({
    show: false,
    // A hidden window is "occluded", so Chromium throttles its timers,
    // requestAnimationFrame, and rendering to ~1 Hz — which makes Paged.js
    // pagination (timer/rAF-driven) crawl, the #1 cause of slow PDF export.
    // Disable background throttling and keep painting while hidden, and give the
    // window a real size so layout/pagination run at full speed.
    paintWhenInitiallyHidden: true,
    width: 1280,
    height: 1024,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      javascript: true,
      backgroundThrottling: false,
    },
  });
  session.win = win;
  try {
    await win.loadURL(input.url);
    throwIfExportCanceled(session);
    const wc = win.webContents;

    // Wait for web fonts to finish loading.
    await wc.executeJavaScript("document.fonts.ready.then(() => true)");
    throwIfExportCanceled(session);

    // Poll until Paged.js signals completion (or the timeout elapses), emitting
    // a per-page progress event so the UI can show "Rendering page N…" instead
    // of an opaque spinner during the (inherently slow) Paged.js pagination of
    // large books.
    const deadline = Date.now() + input.timeoutMs;
    let lastPages = -1;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const status = (await wc.executeJavaScript(`(() => ({
        done: window.__PAGED_RENDERED__ === true,
        pages: document.querySelectorAll('.pagedjs_page').length
      }))()`)) as { done: boolean; pages: number };
      if (status.pages !== lastPages) {
        lastPages = status.pages;
        sendExportProgress({
          exportId: session.id,
          state: "rendering",
          pages: status.pages,
        });
      }
      throwIfExportCanceled(session);
      if (status.done) break;
      if (Date.now() > deadline) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    // Pagination done — serializing a large PDF still takes time, so flag it.
    throwIfExportCanceled(session);
    sendExportProgress({
      exportId: session.id,
      state: "finalizing",
      pages: lastPages,
    });

    // Measure the first rendered page (CSS px) to set the paper size.
    const info = (await wc.executeJavaScript(`(() => {
      const pages = document.querySelectorAll('.pagedjs_page');
      const el = pages[0] || null;
      const s = el ? getComputedStyle(el) : null;
      const px = (v) => (v ? parseFloat(v) : 0);
      return { count: pages.length, w: px(s && s.width), h: px(s && s.height) };
    })()`)) as { count: number; w: number; h: number };

    // printToPDF pageSize is in INCHES; CSS px → in is px / 96. Fall back to a
    // US-Letter-ish book trim if measurement failed.
    const widthIn = info.w > 0 ? info.w / 96 : 8.625;
    const heightIn = info.h > 0 ? info.h / 96 : 11.25;

    throwIfExportCanceled(session);
    const data = await wc.printToPDF({
      printBackground: true,
      pageSize: { width: widthIn, height: heightIn },
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    });
    throwIfExportCanceled(session);
    await writeFile(input.outPdf, data);
  } catch (error) {
    if (session.canceled) {
      throw new ExportCanceledError();
    }
    throw error;
  } finally {
    if (!win.isDestroyed()) {
      win.destroy();
    }
    if (session.win === win) {
      session.win = null;
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Preview server state
// ──────────────────────────────────────────────────────────────────────────

let activePreview: PreviewHandle | null = null;

interface ViewerPrefs {
  lastProjectDir?: string;
  /** Chapter-list sidebar open/closed, persisted across sessions (#42). */
  sidebarOpen?: boolean;
  /**
   * @deprecated (#43) Pre-per-project global page. Kept ONE version as a
   * migration fallback (see migrateLegacyProjectState); new writes go to
   * projectStates[dir].currentPage. Remove in a later release.
   */
  currentPage?: number;
  /**
   * @deprecated (#43) Pre-per-project global view mode. Kept ONE version as a
   * migration fallback; new writes go to projectStates[dir].viewMode.
   */
  viewMode?: "single" | "two-column";
  recentFolders?: RecentFolder[];
  favorites?: FavoriteFolder[];
  /**
   * Per-project editor/preview state keyed by folder path (#43). Opening
   * project B never overwrites project A's page/view/chapter state.
   */
  projectStates?: ProjectStateMap;
  /** Root dirs scanned by app:discoverProjects (#27). Defaults applied below. */
  projectSearchRoots?: string[];
  /**
   * Last classified source of the open project (#12). Cached so the UI can
   * render without re-detecting on launch, but the renderer always re-classifies
   * on folder open (a user may add/remove `.git` between sessions), so this is a
   * hint, not the source of truth.
   */
  projectSource?: ProjectSource;
  /** Global left panel open state + active tab, persisted across sessions. */
  leftPanel?: {
    open?: boolean;
    activeTab?: "toc" | "files" | "media" | "projects" | "history";
    width?: number;
  };
}

function prefsPath(): string {
  return path.join(app.getPath("userData"), "viewer-prefs.json");
}

async function readPrefs(): Promise<ViewerPrefs> {
  try {
    const prefs = JSON.parse(await readFile(prefsPath(), "utf8")) as ViewerPrefs;
    // #43 one-time migration: seed projectStates from the legacy top-level
    // currentPage/viewMode so existing users don't lose their saved state.
    const migrated = migrateLegacyProjectState(prefs);
    if (migrated && !prefs.projectStates) {
      prefs.projectStates = migrated;
    }
    return prefs;
  } catch {
    return {};
  }
}

async function writePrefs(prefs: ViewerPrefs): Promise<void> {
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(prefsPath(), JSON.stringify(prefs, null, 2), "utf8");
}

// ──────────────────────────────────────────────────────────────────────────
// User settings (#45) — persisted, section-organised user preferences in a
// SEPARATE file from viewer-prefs.json so session/per-project state and durable
// user settings don't collide. Shape mirrors AppSettings in
// src/lib/platform/contract.ts (kept in sync manually).
// ──────────────────────────────────────────────────────────────────────────

interface AppSettings {
  editor: {
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
    spellCheckLanguage: string;
    autoSaveDelay: number;
    crashRecovery: boolean;
  };
  appearance: {
    theme: "light" | "dark" | "system";
    previewBg: string;
  };
  preview: {
    defaultZoom: string;
    viewMode: "single" | "two-column";
    paneMode: "edit" | "view";
  };
  versionHistory: {
    /** Save automatic snapshots after edits settle (RC1-3). Default ON. */
    autoSnapshot: boolean;
    /** Minutes of quiet after the last edit before a snapshot fires. */
    autoSnapshotMinutes: number;
    /**
     * Automatically sync to the remote when a remote is configured (transparent-
     * sync plan §6). Defaults ON for projects with canSync; local-only projects
     * are never auto-synced regardless of this setting.
     */
    autoSync: boolean;
    /** Periodic safety-sync cadence in minutes (clamped to [1, 1440]). */
    autoSyncMinutes: number;
  };
  gitIdentity: {
    authorName: string;
    authorEmail: string;
  };
  advanced: {
    fileWatcherInterval: number;
    logLevel: "error" | "warn" | "info" | "debug";
  };
}

const DEFAULT_SETTINGS: AppSettings = {
  editor: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 14,
    lineHeight: 1.6,
    spellCheckLanguage: "en-US",
    autoSaveDelay: 2500,
    crashRecovery: true,
  },
  appearance: {
    theme: "system",
    previewBg: "#5a5a5a",
  },
  preview: {
    defaultZoom: "fit-width",
    viewMode: "two-column",
    // Keep in sync with the renderer's canonical DEFAULT_SETTINGS (contract.ts).
    paneMode: "view",
  },
  versionHistory: {
    autoSnapshot: true,
    autoSnapshotMinutes: 10,
    autoSync: true,      // transparent-sync plan §6: ON by default when canSync
    autoSyncMinutes: 2,  // ~2 min periodic safety cadence
  },
  gitIdentity: {
    authorName: "",
    authorEmail: "",
  },
  advanced: {
    fileWatcherInterval: 300,
    logLevel: "warn",
  },
};

type DeepPartialSettings = {
  [K in keyof AppSettings]?: Partial<AppSettings[K]>;
};

function settingsPath(): string {
  return path.join(app.getPath("userData"), "app-settings.json");
}

function mergeSettings(base: AppSettings, patch: DeepPartialSettings): AppSettings {
  const out = { ...base } as Record<string, unknown>;
  for (const key of Object.keys(patch) as Array<keyof AppSettings>) {
    const value = patch[key];
    if (value && typeof value === "object") {
      out[key] = { ...base[key], ...value };
    }
  }
  return out as unknown as AppSettings;
}

async function readSettings(): Promise<AppSettings> {
  try {
    const stored = JSON.parse(
      await readFile(settingsPath(), "utf8"),
    ) as DeepPartialSettings;
    return mergeSettings(DEFAULT_SETTINGS, stored);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

async function writeSettings(settings: AppSettings): Promise<void> {
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(settingsPath(), JSON.stringify(settings, null, 2), "utf8");
}

async function existingDirectory(dir: string | undefined): Promise<string | null> {
  if (!dir) return null;
  try {
    return (await stat(dir)).isDirectory() ? dir : null;
  } catch {
    return null;
  }
}

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
// The recovery sidecar store lives under userData/recovery/.
function recoveryDir(): string {
  return path.join(app.getPath("userData"), "recovery");
}

// ── Operation log path ──────────────────────────────────────────────────────
// The sync/recovery operation log lives under userData/logs/. One file per
// project slug so logs from different projects don't interleave. The file is
// appended to (not truncated) so a user can see history across sessions.
function operationLogPath(repoSlug: string): string {
  const slug = repoSlug.replace(/[^a-zA-Z0-9_-]/g, "_") || "repo";
  return path.join(app.getPath("userData"), "logs", `${slug}.log`);
}

// A single shallow folder watcher for the open project. fs.watch is coarse and
// fires multiple times per save, so changes are debounced before notifying the
// renderer. Only one project is open at a time, so a single watcher suffices.
let folderWatcher: FSWatcher | null = null;
let watchedDir: string | null = null;
let folderChangeDebounce: ReturnType<typeof setTimeout> | null = null;

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
let autoSnapshotPending: { dir: string; timer: NodeJS.Timeout } | null = null;

function cancelAutoSnapshotTimer(): void {
  if (autoSnapshotPending) {
    clearTimeout(autoSnapshotPending.timer);
    autoSnapshotPending = null;
  }
}

async function runAutoSnapshot(dir: string): Promise<void> {
  try {
    const lib = await loadLib();
    // Re-check the live policy: the user may have toggled auto-snapshots off
    // while this timer was already armed.
    const settings = await readSettings();
    if (lib.autoSnapshotDelayMs(settings.versionHistory) === null) return;
    const source = await lib.detectProjectSource(dir);
    if (source.type !== "local-git-folder") return;
    // Never AUTO-snapshot a folder that lives inside a LARGER repo (subPath
    // set): a silent automatic commit would land in — and sweep unrelated files
    // from — the ENCLOSING repository (e.g. opening a folder that happens to sit
    // inside another git repo). Explicit user snapshots and multi-book remote
    // sync still work via the version-history UI; only the AUTOMATIC commit is
    // suppressed here.
    if (source.subPath !== "") {
      console.info(`[auto-snapshot] skipped: ${dir} is a subfolder of an enclosing repo (${source.repoRoot})`);
      return;
    }
    await lib.providerFor(source).snapshot({
      projectDir: dir,
      message: lib.AUTO_SNAPSHOT_MESSAGE,
      // Record the snapshot in the project's operation log so the bottom-bar
      // "Version history" affordance shows it (local-git projects have no
      // remote/sync, but they DO snapshot — those snapshots must be logged).
      logFile: operationLogPath(path.basename(dir)),
    });
  } catch (e) {
    const lib = await loadLib().catch(() => null);
    if (lib?.isNoChangesError(e)) return; // clean tree — expected, not an error
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[auto-snapshot] failed for ${dir}: ${msg}`);
    if (e instanceof Error && e.stack) console.error(e.stack);
  }
}

/** Arm/reset the debounce timer after an edit signal in `dir`. */
function scheduleAutoSnapshot(dir: string): void {
  void (async () => {
    try {
      // Read settings + lib policy on every arm so changes apply live.
      const [lib, settings] = await Promise.all([loadLib(), readSettings()]);
      // Project may have switched while the awaits above yielded — arming a
      // timer for the OLD directory would fire a stray snapshot there.
      if (watchedDir !== dir) return;
      const delayMs = lib.autoSnapshotDelayMs(settings.versionHistory);
      cancelAutoSnapshotTimer();
      if (delayMs === null) return; // automatic snapshots disabled
      const timer = setTimeout(() => {
        autoSnapshotPending = null;
        void runAutoSnapshot(dir);
      }, delayMs);
      // Never keep the app alive for a pending snapshot alone.
      if (typeof timer.unref === "function") timer.unref();
      autoSnapshotPending = { dir, timer };
    } catch (e) {
      console.warn("[auto-snapshot] scheduling failed (non-fatal):", e);
    }
  })();
}

/**
 * Fire any pending auto-snapshot NOW (project close / app quit flush points).
 * Returns the in-flight snapshot promise, or `undefined` when nothing pends.
 */
function flushAutoSnapshot(): Promise<void> | undefined {
  if (!autoSnapshotPending) return undefined;
  const dir = autoSnapshotPending.dir;
  cancelAutoSnapshotTimer();
  return runAutoSnapshot(dir);
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

/** Per-project state for the auto-sync orchestrator. Keyed by projectDir. */
interface AutoSyncState {
  /** Debounce timer armed on file-change; fires runAutoSync when it expires. */
  debounceTimer: NodeJS.Timeout | null;
  /** Periodic safety-sync interval handle. */
  intervalHandle: NodeJS.Timeout | null;
  /** True while syncProject is awaiting a network round-trip. */
  inFlight: boolean;
  /** Coalesce burst: run exactly one sync when the current one lands. */
  runAgain: boolean;
  /** Conflict-latch: auto-sync is paused until re-enabled for this dir. */
  conflictLatched: boolean;
}

// One orchestrator slot per directory. We only ever have one open project, so in
// practice this is a map of 0 or 1 entries — but the keyed shape makes future
// multi-project support trivial and keeps the close/switch logic explicit.
const autoSyncStates = new Map<string, AutoSyncState>();

function getOrCreateAutoSyncState(dir: string): AutoSyncState {
  let s = autoSyncStates.get(dir);
  if (!s) {
    s = {
      debounceTimer: null,
      intervalHandle: null,
      inFlight: false,
      runAgain: false,
      conflictLatched: false,
    };
    autoSyncStates.set(dir, s);
  }
  return s;
}

/**
 * Payload emitted on the `sync:status` channel. Must match the `SyncStatus`
 * shape in contract.ts EXACTLY — ElectronAdapter.onSyncStatus forwards the raw
 * push payload to the renderer typed as SyncStatus with no transform.
 *
 * Differences from the old internal SyncStatusPayload:
 *  - `state` (not `status`) — matches SyncStatus.state
 *  - `projectDir` is required (not optional) — always scopes the event
 *  - `lastSyncAt` is required (string | null) — lets the pill show relative time
 *  - `message` is dropped — not part of the contract; log it, don't emit it
 *  - `localId`/`remoteId` are dropped — not in SyncStatus; the conflict dialog
 *    fetches them separately via previewSync when the user opens it
 *  - "error" is added to the state union so unexpected throws surface without
 *    misusing "offline" (the renderer can treat "error" as a transient failure)
 */
interface SyncStatusPayload {
  state:
    | "idle"
    | "syncing"
    | "synced"
    | "up-to-date"
    | "offline"
    | "auth"
    | "conflict"
    | "error"
    | "recovering"
    | "recovered"
    // "local" — a local-git project with no syncable remote. There is no sync,
    // but version history (auto-snapshots) is active; the pill surfaces a
    // clickable "Version history on" label that opens the operation log.
    | "local";
  /** Absolute path of the project this status applies to. */
  projectDir: string;
  /** Present (non-empty) only when state === "conflict". */
  files?: ConflictFileInfo[];
  /**
   * ISO-8601 timestamp of the last completed sync attempt (success or failure),
   * or null when none has run in this session.
   */
  lastSyncAt: string | null;
  /**
   * Recovery progress — present when state === "recovering".
   * Both `phase` and `risk` are required to match RecoveryProgressInfo in contract.ts.
   */
  recovery?: {
    phase: "checking" | "backup" | "repairing" | "done";
    risk: "none" | "low" | "medium" | "high";
    message?: string;
  };
  /** Manual guidance — present when state === "error" and failure was classified. */
  guidance?: object;
  /** Backup zip path — present on "recovered" and classified "error". */
  backupZipPath?: string;
  /** Operation log path — present on "recovered", "error", and "conflict". */
  logFile?: string;
  /** True when the completed sync/recovery changed files in the local worktree. */
  filesChanged?: boolean;
}

/** Per-project last-sync timestamp, updated on every completed runAutoSync. */
const autoSyncLastAt = new Map<string, string | null>();

/** Emit a sync status event to the renderer, safe to call when no window exists. */
function emitSyncStatus(payload: SyncStatusPayload): void {
  mainWindow?.webContents.send("sync:status", payload);
}

/**
 * Execute one auto-sync for `dir`. This is the ONLY place auto-sync calls the
 * network — always via `lib.syncProject`, never via statusMatrix or any walk.
 * Maps the SyncOutcome to an ambient status and emits it to the renderer.
 */
async function runAutoSync(dir: string): Promise<void> {
  const state = getOrCreateAutoSyncState(dir);

  // Single-flight guard: if already in flight, arm the runAgain flag so we run
  // exactly once more after it completes. Never queue more than one follow-up.
  if (state.inFlight) {
    state.runAgain = true;
    return;
  }

  // Conflict-latch: if a conflict is pending, do NOT sync again until the user
  // resolves it. Auto-snapshot keeps running; we just skip network work.
  if (state.conflictLatched) return;

  // Re-check live policy every run so a settings change applies immediately.
  const [lib, settings] = await Promise.all([loadLib(), readSettings()]);

  // Guard: watched dir may have changed while we awaited the above.
  if (watchedDir !== dir) return;

  // Guard: auto-sync policy (master switch).
  if (lib.autoSyncDelayMs(settings.versionHistory) === null) return;

  // Guard: only local-git-folder projects sync.
  const source = await lib.detectProjectSource(dir);
  if (source.type !== "local-git-folder") return;

  // Guard: canSync = HTTPS remote + stored credential. Local-only projects never
  // auto-sync (transparent-sync plan §6; ADR 0006 D4). Use the credential-aware
  // diagnosis — NOT capabilitiesFor().canSync, which is hasRemote-only and would
  // run syncProject on every trigger for SSH or uncredentialed-HTTPS projects
  // (each returning auth/error, churning the network unattended). Same gate the
  // renderer pill is shown on, so host and UI agree.
  const diag = await lib.diagnoseProjectRemote(dir, { tokenStore: electronTokenStore });
  if (!diag.canSync) return;

  state.inFlight = true;
  emitSyncStatus({ state: "syncing", projectDir: dir, lastSyncAt: autoSyncLastAt.get(dir) ?? null });

  // Compute the operation log path for this project so sync + recovery share
  // one log file the user can view when something goes wrong.
  const dirBasename = path.basename(dir);
  const logFile = operationLogPath(dirBasename);

  let outcome: SyncOutcome;
  try {
    outcome = await lib.syncProject({
      projectDir: dir,
      tokenStore: electronTokenStore,
      logFile,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[auto-sync] syncProject threw for ${dir}: ${msg}`);
    const now = new Date().toISOString();
    autoSyncLastAt.set(dir, now);

    // ── Out-of-memory guard ──────────────────────────────────────────────────
    // A RangeError / "Array buffer allocation failed" is a TRANSIENT resource
    // failure (e.g. isomorphic-git reading a large packfile), NOT structural
    // repo damage. It must NEVER trigger the recovery subsystem (backup +
    // reclone) — doing so would zip the whole repo and OOM again. Treat it as a
    // plain transient error; the snapshot already saved the author's work.
    if (e instanceof RangeError || /allocation failed|out of memory|heap/i.test(msg)) {
      emitSyncStatus({ state: "error", projectDir: dir, lastSyncAt: now });
      state.inFlight = false;
      if (state.runAgain) {
        state.runAgain = false;
        void runAutoSync(dir);
      }
      return;
    }

    // ── Recovery routing (Foundation delta) ──────────────────────────────────
    // Classify the error. If classifiable, route through recover(). Otherwise
    // keep the old behavior (emit 'error', allow future attempts).
    let kind: SyncErrorKind;
    let health: RepoHealth | undefined;
    try {
      health = await lib.inspectRepo({ repoDir: dir });
      kind = lib.classifyGitError(e, health);
    } catch {
      kind = "unknown";
    }

    if (kind === "unknown") {
      // Old behavior — no recovery attempt for unclassifiable errors.
      emitSyncStatus({ state: "error", projectDir: dir, lastSyncAt: now });
      state.inFlight = false;
      if (state.runAgain) {
        state.runAgain = false;
        void runAutoSync(dir);
      }
      return;
    }

    // Emit 'recovering' so the UI can show the non-intrusive overlay.
    // Include `risk: "none"` to satisfy RecoveryProgressInfo (both fields required).
    emitSyncStatus({
      state: "recovering",
      projectDir: dir,
      lastSyncAt: now,
      recovery: { phase: "checking", risk: "none" },
    });

    // Build the RecoveryContext (resolves repoDir, credential, etc.).
    // Uses the same lib/electronTokenStore already in scope.
    let ctx: RecoveryContext;
    try {
      ctx = await buildRecoveryContext(dir, lib, electronTokenStore, undefined, logFile);
    } catch (ctxErr) {
      console.error(`[auto-sync] buildRecoveryContext failed for ${dir}:`, ctxErr);
      emitSyncStatus({ state: "error", projectDir: dir, lastSyncAt: now });
      state.inFlight = false;
      return;
    }

    let result: Awaited<ReturnType<typeof lib.recover>>;
    try {
      result = await lib.recover(kind, ctx, e);
    } catch (recoverErr) {
      console.error(`[auto-sync] recover() threw for ${dir}:`, recoverErr);
      emitSyncStatus({ state: "error", projectDir: dir, lastSyncAt: now });
      state.inFlight = false;
      return;
    } finally {
      // Single-flight invariant: always reset, even on throw.
      state.inFlight = false;
    }

    // Map RecoveryResult → emit.
    switch (result.status) {
      case "recovered": {
        autoSyncLastAt.set(dir, new Date().toISOString());
        emitSyncStatus({
          state: "recovered",
          projectDir: dir,
          lastSyncAt: autoSyncLastAt.get(dir) ?? now,
          backupZipPath: result.backupZipPath,
          logFile,
        });
        // Resume the single-flight follow-up path.
        if (state.runAgain) {
          state.runAgain = false;
          void runAutoSync(dir);
        }
        break;
      }

      case "retry_later": {
        emitSyncStatus({ state: "offline", projectDir: dir, lastSyncAt: now });
        // Re-arm after the requested delay.
        const delay = result.retryAfterMs ?? 60_000;
        const retryTimer = setTimeout(() => {
          if (autoSyncStates.has(dir)) void runAutoSync(dir);
        }, delay);
        if (typeof retryTimer.unref === "function") retryTimer.unref();
        break;
      }

      case "needs_user": {
        if (result.files && result.files.length > 0) {
          // Surface as a conflict so the existing dialog handles it.
          // Cancel the periodic timer consistent with the normal conflict path.
          state.conflictLatched = true;
          state.runAgain = false;
          cancelAutoSyncTimer(dir);
          emitSyncStatus({
            state: "conflict",
            files: result.files as ConflictFileInfo[],
            projectDir: dir,
            lastSyncAt: now,
            logFile,
          });
        } else {
          // Auth / credential issue.
          emitSyncStatus({ state: "auth", projectDir: dir, lastSyncAt: now });
        }
        break;
      }

      case "blocked":
      case "failed_no_changes_made":
      case "failed_backup_available": {
        // Latch: do not churn on a structural failure the recovery subsystem
        // says is blocked. Show guidance so the author knows what to do.
        // Cancel the periodic timer consistent with the normal conflict path.
        state.conflictLatched = true;
        state.runAgain = false;
        cancelAutoSyncTimer(dir);
        emitSyncStatus({
          state: "error",
          projectDir: dir,
          lastSyncAt: now,
          guidance: result.guidance,
          backupZipPath: "backupZipPath" in result ? result.backupZipPath : undefined,
          logFile,
        });
        break;
      }
    }
    return;
  }

  state.inFlight = false;

  // Record the completion timestamp for this dir; included in every subsequent emit.
  const completedAt = new Date().toISOString();
  autoSyncLastAt.set(dir, completedAt);

  // Map outcome → ambient status emit.
  switch (outcome.status) {
    case "synced":
    case "up-to-date":
      emitSyncStatus({
        state: outcome.status,
        projectDir: dir,
        lastSyncAt: completedAt,
        ...(outcome.filesChanged ? { filesChanged: true } : {}),
      });
      break;

    case "conflict":
      // Latch: disable auto-sync for this project until the user resolves.
      state.conflictLatched = true;
      cancelAutoSyncTimer(dir);
      emitSyncStatus({
        state: "conflict",
        files: outcome.files,
        projectDir: dir,
        lastSyncAt: completedAt,
      });
      console.warn(`[auto-sync] conflict latched for ${dir} — auto-sync paused until resolved`);
      // Conflict-latch prevents the runAgain path from firing.
      state.runAgain = false;
      return;

    case "auth":
      emitSyncStatus({
        state: "auth",
        projectDir: dir,
        lastSyncAt: completedAt,
        ...(outcome.filesChanged ? { filesChanged: true } : {}),
      });
      break;

    case "offline":
      emitSyncStatus({
        state: "offline",
        projectDir: dir,
        lastSyncAt: completedAt,
        ...(outcome.filesChanged ? { filesChanged: true } : {}),
      });
      break;

    case "error":
    default:
      emitSyncStatus({
        state: "error",
        projectDir: dir,
        lastSyncAt: completedAt,
        ...(outcome.filesChanged ? { filesChanged: true } : {}),
      });
      break;
  }

  // Single-flight follow-up: if a trigger fired while we were in-flight, run once.
  if (state.runAgain) {
    state.runAgain = false;
    void runAutoSync(dir);
  }
}

/**
 * Cancel the file-change debounce timer and periodic interval for `dir`.
 * Does NOT reset the conflict-latch; that requires an explicit user action.
 */
function cancelAutoSyncTimer(dir: string): void {
  const state = autoSyncStates.get(dir);
  if (!state) return;
  if (state.debounceTimer) {
    clearTimeout(state.debounceTimer);
    state.debounceTimer = null;
  }
  if (state.intervalHandle) {
    clearInterval(state.intervalHandle);
    state.intervalHandle = null;
  }
}

/**
 * Cancel ALL auto-sync activity for ALL tracked dirs. Called on project
 * switch/close so stale timers don't fire after the watcher has moved on.
 */
function cancelAllAutoSyncTimers(): void {
  for (const dir of autoSyncStates.keys()) {
    cancelAutoSyncTimer(dir);
  }
  autoSyncStates.clear();
}

/**
 * Arm/reset the file-change debounce for `dir`. The debounce is STRICTLY LONGER
 * than the snapshot debounce (which defaults to 10 min) so auto-snapshot always
 * commits the burst BEFORE auto-sync pushes it. In addition, syncProject itself
 * snapshots-first, so even a race is safe — it just double-snapshots.
 *
 * The additional sync debounce (30 s on top of the snapshot delay) is short
 * enough to feel transparent to the author but long enough that the snapshot
 * timer almost always fires first.
 */
const AUTO_SYNC_EXTRA_DEBOUNCE_MS = 30_000; // 30 s on top of snapshot settle

/** Prompt initial pull after a project opens — seconds, NOT coupled to the
 *  10-min snapshot debounce (that coupling delayed the open pull ~10.5 min and
 *  hid incoming teammate changes until the user happened to edit something). */
const AUTO_SYNC_OPEN_DELAY_MS = 4_000;

/**
 * Start the periodic safety-sync interval for `dir` (idempotent — no-op if it's
 * already running). Pulls/pushes every `autoSyncMinutes` (default 2 min) so
 * incoming changes arrive even when the author never edits anything. Must be
 * armed on project OPEN, not only on the first file change — otherwise a
 * view-only session never pulls. Respects the master switch + conflict latch.
 */
function armAutoSyncInterval(dir: string): void {
  void (async () => {
    try {
      const [lib, settings] = await Promise.all([loadLib(), readSettings()]);
      if (watchedDir !== dir) return; // project switched while awaiting
      const periodicMs = lib.autoSyncDelayMs(settings.versionHistory);
      if (periodicMs === null) return; // auto-sync disabled
      const state = getOrCreateAutoSyncState(dir);
      if (state.conflictLatched) return; // paused until user resolves
      if (!state.intervalHandle) {
        state.intervalHandle = setInterval(() => {
          void runAutoSync(dir);
        }, periodicMs);
        if (typeof state.intervalHandle.unref === "function") state.intervalHandle.unref();
      }
    } catch (e) {
      console.warn("[auto-sync] armAutoSyncInterval failed (non-fatal):", e);
    }
  })();
}

function scheduleAutoSync(dir: string): void {
  void (async () => {
    try {
      const [lib, settings] = await Promise.all([loadLib(), readSettings()]);
      // Project may have switched while the awaits above yielded.
      if (watchedDir !== dir) return;
      const periodicMs = lib.autoSyncDelayMs(settings.versionHistory);
      if (periodicMs === null) return; // auto-sync disabled

      const state = getOrCreateAutoSyncState(dir);
      if (state.conflictLatched) return; // paused until user resolves

      // Arm the file-change debounce: snapshot debounce + extra gap (so the
      // local snapshot commits the burst before this push). The periodic
      // interval below is what guarantees PULLS happen promptly regardless.
      const snapshotMs = lib.autoSnapshotDelayMs(settings.versionHistory) ?? 0;
      const syncDebounceMs = snapshotMs + AUTO_SYNC_EXTRA_DEBOUNCE_MS;

      if (state.debounceTimer) clearTimeout(state.debounceTimer);
      state.debounceTimer = setTimeout(() => {
        state.debounceTimer = null;
        void runAutoSync(dir);
      }, syncDebounceMs);
      if (typeof state.debounceTimer.unref === "function") state.debounceTimer.unref();
    } catch (e) {
      console.warn("[auto-sync] scheduleAutoSync failed (non-fatal):", e);
    }
  })();
  // Ensure the periodic safety interval is running (idempotent).
  armAutoSyncInterval(dir);
}

function stopFolderWatch(): void {
  // Project switch/close flush point (RC1-3): edits were pending a snapshot —
  // take it now (fire-and-forget) instead of dropping the timer.
  void flushAutoSnapshot();
  // Cancel all sync timers when the watched folder changes (project switch/close).
  cancelAllAutoSyncTimers();
  if (folderChangeDebounce) {
    clearTimeout(folderChangeDebounce);
    folderChangeDebounce = null;
  }
  if (folderWatcher) {
    folderWatcher.close();
    folderWatcher = null;
  }
  watchedDir = null;
}

function startFolderWatch(dirPath: string): void {
  // Normalise so autoSyncStates map keys are consistent (the export gate and all
  // other callers must use the same key — see issue #3 fix note below).
  const normalizedDir = path.resolve(dirPath);
  if (watchedDir === normalizedDir && folderWatcher) return;
  stopFolderWatch();
  watchedDir = normalizedDir;
  try {
    folderWatcher = watch(dirPath, { recursive: false }, (_event, filename) => {
      // fs.watch is noisy (fires on rename + change). Debounce so a single
      // external save produces one renderer notification.
      const name =
        typeof filename === "string"
          ? filename
          : filename
            ? Buffer.from(filename).toString()
            : "";
      // Git-internal writes are NOT content changes (RC1-3): the automatic
      // snapshot itself mutates `.git`, and treating that as an edit would
      // re-trigger preview reloads and re-arm the snapshot timer forever.
      // (The watch is non-recursive, so `.git` is the only segment we see.)
      if (name === ".git" || name.startsWith(".git/") || name.startsWith(".git\\")) {
        return;
      }
      if (folderChangeDebounce) clearTimeout(folderChangeDebounce);
      folderChangeDebounce = setTimeout(() => {
        mainWindow?.webContents.send("fs:folderChanged", { filename: name });
      }, 150);
      // Edit signal: external editors and in-app saves both land here.
      // Use normalizedDir (the resolved form) so the map key matches watchedDir.
      scheduleAutoSnapshot(normalizedDir);
      // Arm the sync debounce (strictly longer than snapshot — see scheduleAutoSync).
      scheduleAutoSync(normalizedDir);
    });
  } catch (e) {
    console.error(`[watch] failed to watch ${dirPath}:`, e);
    folderWatcher = null;
    watchedDir = null;
  }
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
      preload: path.resolve(__dirname, "../preload/preload.js"),
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
// ──────────────────────────────────────────────────────────────────────────

// The SPA root is resolved at startup (and refreshable later): a downloaded
// bundle in userData if present and valid, otherwise the bundled-in-asar
// build/. Set by refreshWebRoot() before registerAppProtocol()/createWindow().
let activeWebRoot = path.resolve(__dirname, "../../build");

async function refreshWebRoot(): Promise<void> {
  activeWebRoot = await resolveWebRoot();
}

// ── SvelteKit HTTP bridge (adapter-node) ─────────────────────────────────────
// adapter-node emits a Node.js HTTP handler to build/handler.js. We start a
// local HTTP server bound to 127.0.0.1 on an OS-assigned port, then forward
// all app:// requests to it via fetch. This lets +server.ts routes run in the
// Electron main process where they can import { dialog, shell } from 'electron'
// directly, while the renderer stays PWA-clean (fetch('/api/...') only).
let skServerPort: number | null = null;

function getSvelteKitHandlerPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "app.asar", "build", "handler.js")
    : path.join(__dirname, "..", "..", "build", "handler.js");
}

async function startSvelteKitServer(): Promise<number> {
  if (skServerPort) return skServerPort;
  const handlerPath = getSvelteKitHandlerPath();
  slog(`loading SvelteKit handler from ${handlerPath}`);
  const { handler } = (await import(pathToFileURL(handlerPath).href)) as {
    handler: Parameters<typeof createServer>[0];
  };
  const server = createServer(handler);
  return new Promise<number>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Failed to get SvelteKit server address"));
        return;
      }
      skServerPort = addr.port;
      slog(`SvelteKit server listening on 127.0.0.1:${skServerPort}`);
      resolve(skServerPort);
    });
    server.on("error", reject);
  });
}


function registerAppProtocol() {
  protocol.handle("app", async (req) => {
    if (skServerPort === null) {
      return new Response("SvelteKit server not started", { status: 503 });
    }
    const url = new URL(req.url);
    const targetUrl =
      "http://127.0.0.1:" + skServerPort + url.pathname + url.search;
    try {
      const proxyReq = new Request(targetUrl, {
        method: req.method,
        headers: req.headers,
        body:
          req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
        // @ts-expect-error — duplex is required for streaming POST bodies in Node 18+
        duplex: "half",
      });
      return await fetch(proxyReq);
    } catch (e) {
      console.error(`[app://] proxy error for ${url.pathname}:`, e);
      return new Response("Proxy error: " + String(e), { status: 502 });
    }
  });
}

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
  scheduleAutoSync,
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
(globalThis as unknown as Record<string, unknown>).__printMdRecoveryHooks__ = {
  write: (filePath: string, content: string, baseMtimeMs: number) =>
    writeRecoveryStore(recoveryDir(), filePath, content, baseMtimeMs),
  clear: (filePath: string) => clearRecoveryStore(recoveryDir(), filePath),
  list: (projectDir: string) => listRecoveryStore(recoveryDir(), projectDir),
};

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

(globalThis as unknown as Record<string, unknown>).__printMdDesktopHooks__ = {
  showOpenDialog: async (options: Record<string, unknown>) => {
    const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    return win
      ? await dialog.showOpenDialog(win, options as Electron.OpenDialogOptions)
      : await dialog.showOpenDialog(options as Electron.OpenDialogOptions);
  },
  showSaveDialog: async (options: Record<string, unknown>) => {
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
};

// Media thumbnail generation is exposed through a hook instead of importing
// `electron` from the SvelteKit handler bundle. Packaged adapter-node routes run
// in a different ESM context, and importing Electron there can fail.
(globalThis as unknown as Record<string, unknown>).__printMdMediaHooks__ = {
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
  readPrefs: readPrefs as () => Promise<Record<string, unknown>>,
  writePrefs: writePrefs as (p: Record<string, unknown>) => Promise<void>,
  readSettings: readSettings as unknown as () => Promise<Record<string, unknown>>,
  writeSettings: writeSettings as unknown as (s: Record<string, unknown>) => Promise<void>,
  existingDirectory,
  readProjectState: readProjectState as (states: Record<string, unknown> | undefined, dir: string) => unknown,
  writeProjectState: writeProjectState as (states: Record<string, unknown> | undefined, dir: string, patch: Record<string, unknown>) => Record<string, unknown>,
  mergeSettings: mergeSettings as unknown as (base: Record<string, unknown>, patch: Record<string, unknown>) => Record<string, unknown>,
  defaultProjectSearchRoots,
  scanForProjects: (roots: string[], exclude: Set<string>) => scanForProjects(roots, exclude, discoverScanDeps),
  toggleFavoriteFolder: toggleFavoriteFolder as (
    favorites: Array<{ path: string; title: string }> | undefined,
    entry: { path: string; title: string }
  ) => { favorites: Array<{ path: string; title: string }>; favorited: boolean },
  removeRecentFolder: removeRecentFolder as unknown as (
    recents: Array<{ path: string; [k: string]: unknown }> | undefined,
    targetPath: string
  ) => Array<{ path: string; [k: string]: unknown }>,
  loadLib: loadLib as () => Promise<{
    detectProjectSource: (path: string) => Promise<unknown>;
    capabilitiesFor: (source: unknown) => unknown;
    scaffoldProject: (opts: unknown) => Promise<unknown>;
    adoptFolder: (opts: unknown) => Promise<unknown>;
  }>,
});

// Expose doctor-route hooks through globalThis so the SvelteKit handler never
// imports `electron` directly in the packaged app.
(globalThis as unknown as Record<string, unknown>).__printMdDoctorHooks__ = {
  getUpdaterStatus: getStatus,
  getViewerVersion: () => app.getVersion(),
};

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
(globalThis as unknown as Record<string, unknown>).__printMdVcsHooks__ = { loadLib, operationLogPath };

function requireAbsoluteDir(channel: string, projectDir: unknown): string {
  if (typeof projectDir !== "string" || !path.isAbsolute(projectDir)) {
    throw new Error(`${channel} requires an absolute project path`);
  }
  return projectDir;
}

// The lib's own author-facing messages (and our argument-validation messages)
// pass through to the renderer verbatim. Anything else is an unexpected
// internal failure: it gets logged in full here and replaced with a terse,
// author-safe message (no raw isomorphic-git internals, no full fs paths).
const VCS_FRIENDLY_ERROR =
  /no changes since the last snapshot|no version history yet|your work is safe|project files were not changed|requires an absolute project path|valid snapshot id|already inside a versioned project/i;

async function handleVcsErrors<T>(
  channel: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[${channel}] failed: ${msg}`);
    if (e instanceof Error && e.stack) console.error(e.stack);
    if (e instanceof Error && e.cause) console.error(`  cause: ${String(e.cause)}`);
    if (VCS_FRIENDLY_ERROR.test(msg)) {
      // Re-wrap so only the friendly message crosses the IPC boundary.
      throw new Error(msg);
    }
    throw new Error(
      `Version history could not complete the ${channel.replace("vcs:", "")} operation. See the app log for details.`,
    );
  }
}

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
(globalThis as unknown as Record<string, unknown>).__printMdRemoteHooks__ = {
  loadLib,
  tokenStore: electronTokenStore,
  GITHUB_HOST,
};

// Error sanitization — same pattern as handleVcsErrors: the lib's own
// author-friendly messages pass through verbatim; anything else is logged in
// full here and replaced with a terse author-safe message. Token values never
// appear in lib messages by construction (remote-auth redaction invariant).
const REMOTE_FRIENDLY_ERROR =
  /couldn't reach github|reconnect github|connect github|sign-?in|declined|expired|canceled|already has files|valid web url|https|repository couldn't be found|couldn't be downloaded|try again|in progress|access token|web address|couldn't reach|didn't accept|wasn't found|certificate|git server/i;

// Strip credential-bearing URL userinfo ("https://user:token@host/…") from
// any string headed for the log. Transport errors — and especially their raw
// `.cause` — can echo the request URL verbatim, which may embed a token.
function redactUrlCredentials(text: string): string {
  return text.replace(/\/\/[^/\s:]+:[^@\s]+@/g, "//(redacted)@");
}

async function handleRemoteErrors<T>(
  channel: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[${channel}] failed: ${redactUrlCredentials(msg)}`);
    if (e instanceof Error && e.stack) console.error(redactUrlCredentials(e.stack));
    if (e instanceof Error && e.cause) {
      console.error(`  cause: ${redactUrlCredentials(String(e.cause))}`);
    }
    if (REMOTE_FRIENDLY_ERROR.test(msg)) {
      throw new Error(msg);
    }
    throw new Error(
      "The online repository operation could not be completed. See the app log for details.",
    );
  }
}

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
      const resolvedState = autoSyncStates.get(resolvedKey);
      if (resolvedState) {
        resolvedState.conflictLatched = false;
        // Re-arm the periodic timer (scheduleAutoSync is idempotent — safe to
        // call even if a timer is already running).
        scheduleAutoSync(resolvedKey);
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
(globalThis as unknown as Record<string, unknown>).__printMdConflictPreviewHooks__ = {
  getConflictPreview: async (
    projectDir: string,
    relativePath: string,
    kind: "both-edited" | "you-deleted" | "online-deleted",
  ) => {
    const lib = await loadLib();
    return getConflictPreviewImpl(projectDir, relativePath, kind, lib.onlineCopyPath);
  },
};

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
    const state = getOrCreateAutoSyncState(watchedDir);
    state.conflictLatched = false;
    // Re-arm: scheduleAutoSync will start the interval.
    scheduleAutoSync(watchedDir);
  }
  // When disabling, cancel all timers for the open project.
  if (!enabled && watchedDir) {
    cancelAutoSyncTimer(watchedDir);
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
  armAutoSyncInterval(openedDir);

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
    const syncState = getOrCreateAutoSyncState(openedDir);
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
          if (watchedDir === openedDir) void runAutoSync(openedDir);
        }, AUTO_SYNC_OPEN_DELAY_MS);
        return;
      }

      const health = await lib.inspectRepo({ repoDir: openedDir });
      const kind = lib.classifyFromHealth(health) as SyncErrorKind | null;
      if (kind === null) {
        // Healthy repo — release lock and schedule the normal initial sync.
        syncState.inFlight = false;
        const t = setTimeout(() => {
          if (watchedDir === openedDir) void runAutoSync(openedDir);
        }, AUTO_SYNC_OPEN_DELAY_MS);
        if (typeof (t as NodeJS.Timeout).unref === "function") (t as NodeJS.Timeout).unref();
        return;
      }

      console.log(`[preflight] structural condition '${kind}' detected for ${openedDir}; recovering before first sync`);
      emitSyncStatus({
        state: "recovering",
        projectDir: openedDir,
        lastSyncAt: autoSyncLastAt.get(openedDir) ?? null,
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
      autoSyncLastAt.set(openedDir, now);

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
            if (watchedDir === openedDir) void runAutoSync(openedDir);
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
          if (watchedDir === openedDir) void runAutoSync(openedDir);
        }, delay);
        if (typeof retryTimer.unref === "function") retryTimer.unref();
      } else if (result.status === "needs_user" && result.files && result.files.length > 0) {
        // Conflict-latch: stop the periodic timer to avoid churning.
        syncState.conflictLatched = true;
        syncState.runAgain = false;
        cancelAutoSyncTimer(openedDir);
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
        cancelAutoSyncTimer(openedDir);
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
        void runAutoSync(openedDir);
      }
    } catch (err) {
      // Preflight is non-blocking: always release the lock so the project is not
      // permanently wedged. Then let the normal initial sync proceed.
      syncState.inFlight = false;
      console.warn("[preflight] recovery failed (non-fatal):", err);
      plog?.error("preflight", "recovery failed (non-fatal)", { error: String(err) });
      const t = setTimeout(() => {
        if (watchedDir === openedDir) void runAutoSync(openedDir);
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
  if (!activeExportSession || activeExportSession.id !== exportId) {
    return { canceled: false };
  }
  activeExportSession.canceled = true;
  const exportWin = activeExportSession.win;
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
    if (activeExportSession) {
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
    // (getOrCreateAutoSyncState(exportDir) below) use the same key — regardless
    // of whether exportDir happens to equal watchedDir.
    const exportSyncState = autoSyncStates.get(exportDir);
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
            const state = getOrCreateAutoSyncState(exportDir);
            state.conflictLatched = true;
            cancelAutoSyncTimer(exportDir);
            const gateConflictAt = new Date().toISOString();
            autoSyncLastAt.set(exportDir, gateConflictAt);
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
    activeExportSession = exportSession;
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
      activeExportSession = null;
      await rm(exportSession.tempOutPath, { force: true }).catch(() => {});
    }
  }
);

// ──────────────────────────────────────────────────────────────────────────
// Web-UI auto-updater wiring
//
// The updater is ENABLED only in a packaged build with no vite dev server. In
// dev/HMR it is fully inert: every entry point below short-circuits on
// updaterEnabled() so the IPC handlers are harmless no-ops and no networking
// or filesystem mutation happens. Networking lives ONLY in updater/index.ts.
//
// Health gate + watchdog (Phase 6): after a promote (either "apply now" or
// "apply on next launch"), we arm a 10s watchdog. The renderer calls
// updater:markReady once it boots; on time we record the version healthy and
// prune old bundles. If the deadline elapses with no markReady, we rollback
// and relaunch the app so the new process picks up the restored bundle.
// ──────────────────────────────────────────────────────────────────────────

// Generous enough that a healthy static SPA (sub-second boot) never trips it,
// while still catching a genuinely broken bundle that never executes JS.
const HEALTH_WATCHDOG_MS = 30_000;

let pendingHealthCheck: { version: string; timer: NodeJS.Timeout } | null = null;

function updaterEnabled(): boolean {
  return app.isPackaged && !process.env.VITE_DEV_SERVER_URL;
}

function sendUpdaterEvent(event: Record<string, unknown>) {
  mainWindow?.webContents.send("updater:event", event);
}

async function markHealthy(version: string) {
  try {
    const state = await readState();
    state.lastHealthyVersion = version;
    state.minimumSeenVersion = version;
    await writeState(state);
    await pruneVersions();
  } catch (err) {
    console.warn("[updater] markHealthy failed (non-fatal):", err);
  }
}

// Arm the watchdog after a promote. The renderer's updater:markReady IPC clears
// it; otherwise the timer fires and rolls the bundle back.
function armHealthWatchdog(version: string) {
  clearHealthWatchdog();
  const timer = setTimeout(() => {
    pendingHealthCheck = null;
    void (async () => {
      // If the window is gone, the user simply quit/closed before the SPA could
      // mark ready — that is NOT evidence the bundle is broken. Skip the
      // rollback (which would otherwise count a failure and could blocklist a
      // good version); the bundle stays current and is re-gated on next launch.
      if (!mainWindow || mainWindow.isDestroyed()) {
        console.warn(
          `[updater] health watchdog expired for ${version} but window is gone; deferring`
        );
        return;
      }
      console.warn(
        `[updater] health watchdog expired for ${version}; rolling back`
      );
      await rollback("renderer did not mark ready");
      sendUpdaterEvent({ type: "rolledback", version });
      // With adapter-node the SvelteKit handler is a Node module loaded at
      // startup — a window reload cannot pick up the restored bundle. Relaunch
      // the entire process so the new instance mounts the rolled-back bundle.
      app.relaunch();
      app.exit(0);
    })();
  }, HEALTH_WATCHDOG_MS);
  // Don't keep the event loop alive on the watchdog alone.
  if (typeof timer.unref === "function") timer.unref();
  pendingHealthCheck = { version, timer };
}

function clearHealthWatchdog() {
  if (pendingHealthCheck) {
    clearTimeout(pendingHealthCheck.timer);
    pendingHealthCheck = null;
  }
}

// Shared check→stage→emit-events flow used by both the background launch check
// and the manual "Check for updates" IPC. checkForUpdate/downloadAndStage are
// themselves non-throwing; callers still wrap this defensively.
async function checkAndStage(): Promise<void> {
  const { available, reason } = await checkForUpdate();
  if (!available) {
    sendUpdaterEvent(
      reason && reason !== "already up to date"
        ? { type: "uptodate", reason }
        : { type: "uptodate" }
    );
    return;
  }
  sendUpdaterEvent({ type: "available", version: available.version });
  const { staged, reason: stageReason } = await downloadAndStage(available);
  sendUpdaterEvent(
    staged
      ? { type: "staged", version: available.version }
      : { type: "error", message: stageReason ?? "stage failed" }
  );
}

// Fire-and-forget background check → stage on launch. Never blocks startup.
async function runBackgroundUpdate() {
  try {
    await checkAndStage();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[updater] background update failed (non-fatal):", message);
    sendUpdaterEvent({ type: "error", message });
  }
}

ipcMain.handle("updater:getStatus", async () => {
  return getStatus();
});

ipcMain.handle("updater:check", async () => {
  if (!updaterEnabled()) return getStatus();
  try {
    await checkAndStage();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[updater] manual check failed (non-fatal):", message);
    sendUpdaterEvent({ type: "error", message });
  }
  return getStatus();
});

ipcMain.handle("updater:applyNow", async () => {
  if (!updaterEnabled()) return { applied: false };
  const { promoted, version } = await promoteStaged();
  if (!promoted || !version) return { applied: false };
  // With adapter-node the SvelteKit handler is a Node module loaded at
  // startup — a window reload cannot pick up new server routes. Relaunch
  // the entire process so the new instance mounts the promoted bundle.
  // The new process will arm its own health watchdog on startup.
  app.relaunch();
  app.exit(0);
  // app.exit() is synchronous; this return is never reached but satisfies TS.
  return { applied: true, version };
});

ipcMain.handle("updater:markReady", async () => {
  // No-op when nothing is pending (e.g. a normal startup with no update).
  if (!pendingHealthCheck) return { ok: true, pending: false };
  const version = pendingHealthCheck.version;
  clearHealthWatchdog();
  await markHealthy(version);
  sendUpdaterEvent({ type: "healthy", version });
  return { ok: true, pending: true, version };
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
  // Apply any staged update from a previous session BEFORE resolving the web
  // root, so refreshWebRoot() picks up the newly promoted bundle. Wrapped so a
  // userData IO failure (EACCES, disk full) can never prevent createWindow() —
  // a broken updater must degrade to the bundled fallback, not a blank window.
  if (updaterEnabled()) {
    try {
      updateSplash("Checking for updates…", 8);
      await ensureLayout();
      await promoteStaged();
    } catch (err) {
      console.warn("[updater] startup promote failed (non-fatal):", err);
    }
  }
  slog("updater promote done");

  updateSplash("Preparing the interface…", 18);
  await refreshWebRoot();
  slog("web root resolved");
  // In dev mode (VITE_DEV_SERVER_URL set) the SvelteKit dev server is already
  // running externally — skip the local handler.js launch. In prod, start the
  // adapter-node HTTP server and wire it to the app:// protocol.
  if (!process.env.VITE_DEV_SERVER_URL) {
    try {
      await startSvelteKitServer();
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

  // Health-gate any current bundle that hasn't been confirmed healthy yet —
  // whether just promoted this launch or left unconfirmed by a prior session
  // that closed before markReady. The renderer must mark ready within the
  // watchdog window or we roll it back + reload. A bundle already recorded as
  // healthy (or the bundled fallback, which has no pointer) is not gated, so
  // markReady is a harmless no-op on a normal launch.
  if (updaterEnabled()) {
    try {
      const current = await readPointer("current");
      const state = await readState();
      if (current && state.lastHealthyVersion !== current.version) {
        armHealthWatchdog(current.version);
      }
    } catch (err) {
      console.warn("[updater] health-gate arming failed (non-fatal):", err);
    }
  }

  // Background check → stage on every launch (non-blocking, fire-and-forget).
  if (updaterEnabled()) {
    runBackgroundUpdate().catch((err) => {
      console.warn("[updater] runBackgroundUpdate rejected (non-fatal):", err);
    });
  }

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
      void runAutoSync(watchedDir);
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
          void runAutoSync(resumedDir);
        }
      }, 3_000);
      if (typeof t.unref === "function") t.unref();
    }
  });
});

app.on("window-all-closed", async () => {
  if (activeExportSession) {
    activeExportSession.canceled = true;
    if (activeExportSession.win && !activeExportSession.win.isDestroyed()) {
      activeExportSession.win.destroy();
    }
    await rm(activeExportSession.tempOutPath, { force: true }).catch(() => {});
    activeExportSession = null;
  }
  if (activePreview) {
    await activePreview.stop().catch(() => {});
    activePreview = null;
  }
  if (process.platform !== "darwin") app.quit();
});
