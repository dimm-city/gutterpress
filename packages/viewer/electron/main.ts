import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  protocol,
  session,
  shell,
} from "electron";
import { randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { watch, type FSWatcher } from "node:fs";
import { scanForProjects, type ScanDeps } from "./discover-projects";
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

// ── Startup timing instrumentation (diagnose the ~10s launch stall) ──────────
// Prints "[startup +Nms] <milestone>" so a slow launch log pinpoints exactly
// which phase stalls (Electron init → web-root → window create → renderer load
// → first paint → preview). Cheap; safe to leave in for a beta.
const __startupT0 = Date.now();
function slog(msg: string): void {
  console.log(`[startup +${Date.now() - __startupT0}ms] ${msg}`);
}
slog("main.js evaluated");

// __dirname/__filename are injected by electron-vite for the ESM main bundle
// (resolves to out/main/ at runtime).

// ──────────────────────────────────────────────────────────────────────────
// Lib loader
//
// Both this main process and @dimm-city/print-md-lib are ESM, so it's a plain
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
interface SystemDiagnostics {
  libVersion: string;
  platform: { os: string; arch: string; release: string; node: string };
  tools: Array<{
    name: string;
    bin: string;
    found: boolean;
    path?: string;
    version?: string;
    usedBy: Array<{ feature: string; severity: "required" | "optional" }>;
    installHint: string;
  }>;
  docsUrl: string;
}

type ProjectSource =
  | { type: "local-folder"; path: string }
  | {
      type: "local-git-folder";
      path: string;
      hasRemote: boolean;
      remoteUrl?: string;
      branch?: string;
    }
  | {
      type: "managed-github";
      installationId: string;
      owner: string;
      repo: string;
      branch: string;
      rootPath?: string;
    };

interface ProjectCapabilities {
  canRead: boolean;
  canWriteLocal: boolean;
  canEnableVersionHistory: boolean;
  canSnapshot: boolean;
  canViewHistory: boolean;
  canRestoreSnapshot: boolean;
  canPublish: boolean;
  canSync: boolean;
  authManagedByApp: boolean;
}

// New-project scaffold (#25). Mirrors the lib's CreateProjectOptions/Result.
interface CreateProjectOptions {
  name: string;
  author?: string;
  parentDir: string;
  folderName?: string;
  template?: "book";
  versionHistory?: "local-git" | "none";
}
interface CreateProjectResult {
  projectDir: string;
  manifestPath: string;
  openFile: string;
  versionHistory: "local-git" | "none";
  versionHistoryError?: string;
}

interface PrintSafeWarning {
  rule: string;
  severity: "error" | "warning";
  message: string;
  line: number;
  column: number;
}

interface LibModule {
  startPreviewServer: (opts: Record<string, unknown>) => Promise<PreviewHandle>;
  loadManifestWithPath: (input: string) => Promise<ManifestWithPath>;
  splitOutPath: (out: string | undefined, format: string) => SplitOutPath;
  runBuild: (opts: Record<string, unknown>) => Promise<BuildResult>;
  getSystemDiagnostics: () => Promise<SystemDiagnostics>;
  detectProjectSource: (folderPath: string) => Promise<ProjectSource>;
  capabilitiesFor: (source: ProjectSource) => ProjectCapabilities;
  scaffoldProject: (options: CreateProjectOptions) => Promise<CreateProjectResult>;
  checkCss: (css: string, from?: string) => PrintSafeWarning[];
  BuildError: new (message: string) => Error;
}

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
    libPromise = import("@dimm-city/print-md-lib") as Promise<LibModule>;
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
    autoSaveDelay: 1000,
    crashRecovery: true,
  },
  appearance: {
    theme: "system",
    previewBg: "#5a5a5a",
  },
  preview: {
    defaultZoom: "fit-width",
    viewMode: "two-column",
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

// ── Unsaved-changes infrastructure (#44) ────────────────────────────────────
// The recovery sidecar store lives under userData/recovery/.
function recoveryDir(): string {
  return path.join(app.getPath("userData"), "recovery");
}

// A single shallow folder watcher for the open project. fs.watch is coarse and
// fires multiple times per save, so changes are debounced before notifying the
// renderer. Only one project is open at a time, so a single watcher suffices.
let folderWatcher: FSWatcher | null = null;
let watchedDir: string | null = null;
let folderChangeDebounce: ReturnType<typeof setTimeout> | null = null;

function stopFolderWatch(): void {
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
  if (watchedDir === dirPath && folderWatcher) return;
  stopFolderWatch();
  watchedDir = dirPath;
  try {
    folderWatcher = watch(dirPath, { recursive: false }, (_event, filename) => {
      // fs.watch is noisy (fires on rename + change). Debounce so a single
      // external save produces one renderer notification.
      if (folderChangeDebounce) clearTimeout(folderChangeDebounce);
      const name =
        typeof filename === "string"
          ? filename
          : filename
            ? Buffer.from(filename).toString()
            : "";
      folderChangeDebounce = setTimeout(() => {
        mainWindow?.webContents.send("fs:folderChanged", { filename: name });
      }, 150);
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
    // Show the window IMMEDIATELY (default). Waiting for `ready-to-show` (first
    // paint) means the user stares at nothing while the SPA + preview render —
    // which can be several seconds. Showing now (with the dark backgroundColor)
    // gives instant feedback; the shell + content paint into the visible window.
    webPreferences: {
      preload: path.resolve(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
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

  // Push OS theme changes (light↔dark) to the renderer so a "system" theme
  // mode tracks the OS live. Registered after window creation so mainWindow is
  // non-null when the event fires; removed on close to avoid a dangling ref.
  const onNativeThemeUpdated = () => {
    mainWindow?.webContents.send("app:nativeThemeUpdated", {
      shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
    });
  };
  nativeTheme.on("updated", onNativeThemeUpdated);

  // ── Unsaved-changes close gate (#44) ──────────────────────────────────────
  // If the renderer has a pending auto-save, intercept the first close, ask the
  // renderer to flush, and only destroy the window once it replies (or a 3s
  // watchdog fires — never block quit indefinitely). The renderer pushes its
  // dirty state via `app:setDirtyState`; main never reads renderer memory.
  mainWindow.on("close", (e) => {
    if (isQuitting || !rendererDirty || !mainWindow) return;
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
    flushResolve = finish;
    win.webContents.send("app:flushBeforeClose");
    // Watchdog: force the close after 3s if the renderer doesn't answer.
    setTimeout(finish, 3000);
  });

  mainWindow.on("closed", () => {
    nativeTheme.removeListener("updated", onNativeThemeUpdated);
    stopFolderWatch();
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

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

function mimeFor(p: string): string {
  return MIME[path.extname(p).toLowerCase()] ?? "application/octet-stream";
}

function registerAppProtocol() {
  protocol.handle("app", async (req) => {
    const url = new URL(req.url);
    let pathname = decodeURIComponent(url.pathname);
    if (!pathname || pathname === "/") pathname = "/index.html";

    // strip leading "/" before joining so path.join treats it as relative
    const rel = pathname.replace(/^\/+/, "");
    const candidate = path.resolve(activeWebRoot, rel);

    // Boundary check.
    if (
      candidate !== activeWebRoot &&
      !candidate.startsWith(activeWebRoot + path.sep)
    ) {
      console.error(`[app://] boundary violation: ${candidate}`);
      return new Response("Forbidden", { status: 403 });
    }

    // Try the exact file first.
    try {
      const rt = Date.now();
      const data = await readFile(candidate);
      const dt = Date.now() - rt;
      if (dt > 40) slog(`app:// SLOW read ${dt}ms ${rel}`);
      return new Response(data, {
        headers: { "content-type": mimeFor(candidate) },
      });
    } catch {
      // fall through to SPA fallback
    }

    // adapter-static SPA fallback: serve index.html for unknown paths so
    // client-side routing works.
    try {
      const data = await readFile(path.join(activeWebRoot, "index.html"));
      return new Response(data, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    } catch (e) {
      console.error(
        `[app://] FATAL: index.html not found at ${activeWebRoot}/index.html (${(e as Error).message})`
      );
      return new Response(
        `static root missing at ${activeWebRoot}`,
        { status: 500 }
      );
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
// IPC handlers (replace the deleted /api/* SvelteKit routes)
// ──────────────────────────────────────────────────────────────────────────

ipcMain.handle("dialog:openDirectory", async () => {
  if (!mainWindow) return null;
  const res = await dialog.showOpenDialog(mainWindow, {
    title: "Open print-md project",
    properties: ["openDirectory"],
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  return res.filePaths[0];
});

ipcMain.handle("dialog:savePdf", async (_e, defaultName?: string) => {
  if (!mainWindow) return null;
  const res = await dialog.showSaveDialog(mainWindow, {
    title: "Save PDF",
    defaultPath: defaultName ?? "book.pdf",
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (res.canceled || !res.filePath) return null;
  return res.filePath;
});

ipcMain.handle("shell:openExternal", async (_e, url: string) => {
  await shell.openExternal(url);
});

ipcMain.handle("shell:showInFolder", async (_e, filePath: string) => {
  shell.showItemInFolder(filePath);
});

// ── Filesystem primitives (PlatformAdapter, #41) ──────────────────────────
// Backs ElectronAdapter.readFile/writeFile. No current consumer in 0.4.0 — the
// in-app editor (#38/#39) is the first. The renderer is our own trusted SPA;
// paths must be absolute so a relative path can't resolve against the main
// process CWD by accident.
// Callers MUST constrain filePath to a user-opened project directory; there is
// no global path allowlist by design — the renderer is our own trusted SPA.
ipcMain.handle("fs:readFile", async (_e, filePath: string): Promise<string> => {
  if (!path.isAbsolute(filePath)) {
    throw new Error(`fs:readFile requires an absolute path, got: ${filePath}`);
  }
  return await readFile(filePath, "utf-8");
});

ipcMain.handle(
  "fs:writeFile",
  async (_e, filePath: string, content: string): Promise<{ mtimeMs: number }> => {
    if (!path.isAbsolute(filePath)) {
      throw new Error(`fs:writeFile requires an absolute path, got: ${filePath}`);
    }
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf-8");
    // Return the post-write mtime so the editor can record its on-disk baseline
    // (#44) and suppress the self-echo from its own folder watcher.
    const s = await stat(filePath);
    return { mtimeMs: s.mtimeMs };
  },
);

// ── File metadata (PlatformAdapter.statFile, #44 — external-edit detection) ──
// Resolves with `exists: false` (zeroed metadata) rather than rejecting when the
// path is absent, so the editor can tell "deleted out from under us" from an IO
// error. The path MUST be absolute (renderer is our trusted SPA).
ipcMain.handle(
  "fs:statFile",
  async (
    _e,
    filePath: string,
  ): Promise<{ mtimeMs: number; size: number; exists: boolean }> => {
    if (!path.isAbsolute(filePath)) {
      throw new Error(`fs:statFile requires an absolute path, got: ${filePath}`);
    }
    try {
      const s = await stat(filePath);
      return { mtimeMs: s.mtimeMs, size: s.size, exists: true };
    } catch {
      return { mtimeMs: 0, size: 0, exists: false };
    }
  },
);

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
  if (watchedDir === dirPath) stopFolderWatch();
});

// ── Crash recovery (#44) ────────────────────────────────────────────────────
// Sidecar snapshots under userData/recovery/. Never touches the user's file.
ipcMain.handle(
  "recovery:write",
  async (
    _e,
    filePath: string,
    content: string,
    baseMtimeMs: number,
  ): Promise<{ ok: boolean }> => {
    if (!path.isAbsolute(filePath)) {
      throw new Error(`recovery:write requires an absolute path, got: ${filePath}`);
    }
    return writeRecoveryStore(recoveryDir(), filePath, content, baseMtimeMs);
  },
);

ipcMain.handle(
  "recovery:clear",
  async (_e, filePath: string): Promise<{ ok: boolean }> => {
    if (!path.isAbsolute(filePath)) {
      throw new Error(`recovery:clear requires an absolute path, got: ${filePath}`);
    }
    return clearRecoveryStore(recoveryDir(), filePath);
  },
);

ipcMain.handle(
  "recovery:list",
  async (_e, projectDir: string) => {
    if (!path.isAbsolute(projectDir)) {
      throw new Error(`recovery:list requires an absolute path, got: ${projectDir}`);
    }
    return listRecoveryStore(recoveryDir(), projectDir);
  },
);

// ── Unsaved-changes close gate (#44) ────────────────────────────────────────
// The renderer pushes its pending-save state; main reads it in the `close`
// handler. `app:flushDone` is the renderer's reply that its buffer is flushed.
ipcMain.handle("app:setDirtyState", async (_e, isDirty: boolean): Promise<void> => {
  rendererDirty = !!isDirty;
});

ipcMain.handle("app:flushDone", async (): Promise<void> => {
  rendererDirty = false;
  flushResolve?.();
});

// ── Directory listing (PlatformAdapter.listDir, #38) ──────────────────────
// Backs the in-app editor's file-tree sidebar. Returns the immediate entries
// of `dirPath` (single level, no recursion) as {name, path, isDir}. The path
// MUST be absolute (a relative path could resolve against the main-process CWD
// by accident); the renderer is our own trusted SPA and always passes a
// user-opened project directory.
ipcMain.handle(
  "fs:listDir",
  async (
    _e,
    dirPath: string,
  ): Promise<Array<{ name: string; path: string; isDir: boolean }>> => {
    if (!path.isAbsolute(dirPath)) {
      throw new Error(`fs:listDir requires an absolute path, got: ${dirPath}`);
    }
    const entries = await readdir(dirPath, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      path: path.join(dirPath, entry.name),
      isDir: entry.isDirectory(),
    }));
  },
);

// ── Project file listing (fs:listProjectFiles, #42) ───────────────────────
// Backs the chapter-list sidebar. Returns the top-level `.md` and `.css`
// files of the opened project directory, each sorted by filename. Shallow by
// design (a v1 constraint — subdirectory layouts are not surfaced). The path
// MUST be absolute and is constrained to the project directory; only files
// (not directories) at the top level are returned.
ipcMain.handle(
  "fs:listProjectFiles",
  async (
    _e,
    projectDir: string,
  ): Promise<{ md: string[]; css: string[] }> => {
    if (!path.isAbsolute(projectDir)) {
      throw new Error(
        `fs:listProjectFiles requires an absolute path, got: ${projectDir}`,
      );
    }
    const entries = await readdir(projectDir, { withFileTypes: true });
    const md: string[] = [];
    const css: string[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const lower = entry.name.toLowerCase();
      if (lower.endsWith(".md")) md.push(entry.name);
      else if (lower.endsWith(".css")) css.push(entry.name);
    }
    md.sort((a, b) => a.localeCompare(b));
    css.sort((a, b) => a.localeCompare(b));
    return { md, css };
  },
);

ipcMain.handle("api:status", async () => {
  return { name: "@dimm-city/print-md-viewer", runtime: "node", ok: true };
});

// CSS print-safety lint for the in-app CSS editor (#39). Runs in the main
// process: checkCss is postcss-based, and postcss's node:url usage crashes the
// renderer if bundled into the SPA. Routing through IPC keeps a single source of
// truth (the same checkCss `print-md validate` uses) without bundling postcss.
ipcMain.handle(
  "lint:checkCss",
  async (_e, css: string, from?: string): Promise<PrintSafeWarning[]> => {
    const lib = await loadLib();
    return lib.checkCss(css, from);
  },
);

ipcMain.handle("app:getLastProject", async () => {
  const prefs = await readPrefs();
  return existingDirectory(prefs.lastProjectDir);
});

ipcMain.handle("app:getViewerPrefs", async () => {
  const prefs = await readPrefs();
  return {
    ...prefs,
    lastProjectDir: await existingDirectory(prefs.lastProjectDir),
  };
});

ipcMain.handle("app:setViewerPrefs", async (_e, patch: Partial<ViewerPrefs>) => {
  const current = await readPrefs();
  await writePrefs({ ...current, ...patch });
  return { ok: true };
});

// ── Per-project editor/preview state (#43) ──────────────────────────────────
// Read/merge the per-project bucket in viewer-prefs.json projectStates. Keying
// by folder path means opening project B never overwrites project A's page,
// view mode, open chapter, etc. Corrupt/missing state fails silently to null so
// the renderer falls back to first-page defaults.
ipcMain.handle(
  "app:getViewerProjectState",
  async (_e, projectDir: string): Promise<ProjectState | null> => {
    if (!projectDir || typeof projectDir !== "string") return null;
    try {
      const prefs = await readPrefs();
      return readProjectState(prefs.projectStates, projectDir);
    } catch {
      return null;
    }
  },
);

ipcMain.handle(
  "app:setViewerProjectState",
  async (
    _e,
    projectDir: string,
    patch: Partial<ProjectState>,
  ): Promise<{ ok: boolean }> => {
    if (!projectDir || typeof projectDir !== "string") return { ok: false };
    const current = await readPrefs();
    await writePrefs({
      ...current,
      lastProjectDir: projectDir,
      projectStates: writeProjectState(current.projectStates, projectDir, patch),
    });
    return { ok: true };
  },
);

ipcMain.handle("app:getSettings", async () => {
  return readSettings();
});

ipcMain.handle("app:setSettings", async (_e, patch: DeepPartialSettings) => {
  const current = await readSettings();
  await writeSettings(mergeSettings(current, patch));
  return { ok: true };
});

// ── Native (OS) theme surface (#48) ─────────────────────────────────────────
// One-shot query of the OS dark/light preference. The renderer's theme
// controller resolves "system" against this. Pushed updates come via the
// nativeTheme "updated" listener registered in createWindow().
ipcMain.handle("app:getNativeTheme", async () => {
  return { shouldUseDarkColors: nativeTheme.shouldUseDarkColors };
});

ipcMain.handle("app:getRecentFolders", async () => {
  const prefs = await readPrefs();
  const recents = prefs.recentFolders ?? [];
  return Promise.all(
    recents.map(async (r) => ({
      ...r,
      exists: (await existingDirectory(r.path)) !== null,
    }))
  );
});

ipcMain.handle("app:getFavorites", async () => {
  const prefs = await readPrefs();
  const favorites = prefs.favorites ?? [];
  return Promise.all(
    favorites.map(async (f) => ({
      ...f,
      exists: (await existingDirectory(f.path)) !== null,
    }))
  );
});

ipcMain.handle(
  "app:toggleFavorite",
  async (_e, folderPath: string, title: string) => {
    const current = await readPrefs();
    const { favorites, favorited } = toggleFavoriteFolder(current.favorites, {
      path: folderPath,
      title,
    });
    await writePrefs({ ...current, favorites });
    return { favorited };
  }
);

ipcMain.handle("app:removeRecent", async (_e, folderPath: string) => {
  const current = await readPrefs();
  await writePrefs({
    ...current,
    recentFolders: removeRecentFolder(current.recentFolders, folderPath),
  });
  return { ok: true };
});

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

ipcMain.handle("app:discoverProjects", async () => {
  const prefs = await readPrefs();
  const roots =
    prefs.projectSearchRoots && prefs.projectSearchRoots.length > 0
      ? prefs.projectSearchRoots
      : defaultProjectSearchRoots();
  const exclude = new Set<string>([
    ...(prefs.recentFolders ?? []).map((r) => r.path),
    ...(prefs.favorites ?? []).map((f) => f.path),
  ]);
  try {
    return await scanForProjects(roots, exclude, discoverScanDeps);
  } catch {
    return [];
  }
});

// ── Project source classification (#12) ──────────────────────────────────────
// Classify an opened folder as local-folder / local-git-folder (hasRemote
// true/false) via the lib's pure Node-fs detector. Always re-classified on
// folder open by the renderer — never relies solely on the cached
// ViewerPrefs.projectSource (a user may add/remove `.git` between sessions).
ipcMain.handle(
  "app:classifyProject",
  async (_e, args: { path?: string }) => {
    const folderPath = args?.path;
    if (!folderPath || typeof folderPath !== "string") {
      throw new Error("app:classifyProject requires a 'path' string");
    }
    const lib = await loadLib();
    const source = await lib.detectProjectSource(folderPath);
    const capabilities = lib.capabilitiesFor(source);
    return { source, capabilities };
  },
);

// ── New-project scaffold (#25) ───────────────────────────────────────────────
// Thin pass-through to the shared lib's scaffoldProject — the scaffolding logic
// (template copy, placeholder fill, optional Git init via isomorphic-git) lives
// in @dimm-city/print-md-lib, NOT here (issue #25 requirement). The renderer
// wizard collects inputs and the lib does the work.
ipcMain.handle(
  "app:createProject",
  async (_e, options: CreateProjectOptions): Promise<CreateProjectResult> => {
    if (!options || typeof options.name !== "string" || typeof options.parentDir !== "string") {
      throw new Error("app:createProject requires { name, parentDir }");
    }
    const lib = await loadLib();
    return lib.scaffoldProject(options);
  },
);

ipcMain.handle("api:doctor", async () => {
  const lib = await loadLib();
  const diag = await lib.getSystemDiagnostics();
  // Web-UI bundle version: the current updater pointer (or the baked baseline).
  // This is distinct from viewerVersion (the Electron shell) — after a web-UI
  // auto-update they diverge, so surface both.
  const webUiVersion = (await getStatus().catch(() => null))?.currentVersion ?? null;
  const externalTools = diag.tools.filter(
    (tool) => tool.bin !== "chrome / chromium / msedge"
  );
  return {
    ...diag,
    tools: [
      {
        name: "Chromium (built-in via Electron)",
        bin: "electron",
        found: true,
        path: "Bundled with the viewer app",
        version: process.versions.chrome,
        usedBy: [
          { feature: "Preview rendering and Save PDF", severity: "required" },
        ],
        installHint: "No setup required in the viewer app.",
      },
      ...externalTools,
    ],
    viewerVersion: app.getVersion(),
    webUiVersion,
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
  };
});

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
// prune old bundles. If the deadline elapses with no markReady, we rollback,
// refresh the web root, and reload the window to recover from a bad bundle.
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
      await refreshWebRoot();
      sendUpdaterEvent({ type: "rolledback", version });
      mainWindow?.webContents.reload();
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
  await refreshWebRoot();
  armHealthWatchdog(version);
  mainWindow?.webContents.reload();
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
  // Apply any staged update from a previous session BEFORE resolving the web
  // root, so refreshWebRoot() picks up the newly promoted bundle. Wrapped so a
  // userData IO failure (EACCES, disk full) can never prevent createWindow() —
  // a broken updater must degrade to the bundled fallback, not a blank window.
  if (updaterEnabled()) {
    try {
      await ensureLayout();
      await promoteStaged();
    } catch (err) {
      console.warn("[updater] startup promote failed (non-fatal):", err);
    }
  }
  slog("updater promote done");

  await refreshWebRoot();
  slog("web root resolved");
  registerAppProtocol();
  registerUrlPreviewHeaderWatch();
  createWindow();
  slog("createWindow returned (loadURL dispatched)");

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
