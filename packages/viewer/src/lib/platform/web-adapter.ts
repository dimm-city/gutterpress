/**
 * WebAdapter — stub for the future PWA host (#41 acceptance: "ready for 0.6.0,
 * throws 'not implemented' for file watch").
 *
 * The viewer ships Electron-only in 0.4.0; this adapter is selected only when
 * the app runs in a plain browser (e.g. `vite dev` with no preload). To match
 * today's behaviour in that context — where `window.electron` is undefined and
 * the app's capability guards short-circuit — host-service methods return
 * REJECTED promises (so existing `.catch()` fire-and-forget calls stay silent)
 * and subscription methods return a no-op unsubscribe. The genuinely
 * host-divergent primitives throw, to be implemented via the File System Access
 * API in 0.6.0.
 */
import { DEFAULT_SETTINGS } from "./contract";
import { basenameOf } from "./paths";
import {
  registerHandle,
  reRegisterHandle,
  resolveHandle,
  splitPath,
  readFileFromRoot,
  writeFileToRoot,
  listDirFromRoot,
  statFileFromRoot,
  listProjectFilesFromRoot,
  hasFsa,
} from "./web-fs";
// §8 / ADR 0004: VALUE import of the PURE, node-free render core ONLY
// (`@dimm-city/print-md/render`). This subpath transitively imports markdown-it
// + the inlined paged plugin and contains ZERO `node:*`/`fs`/`path`/`url`, so it
// stays PWA-clean in the renderer bundle. NEVER import build-runner / index
// (those drag puppeteer + node:fs). This is what lets the in-browser preview
// (#33 Phase 2) render entirely client-side with no localhost server.
import { assembleBookHtml } from "@dimm-city/print-md/render";
import { IndexedDbWebStore } from "./web-store";
import type { WebStore } from "./web-store";
import type {
  Platform,
  ViewerPrefs,
  ProjectState,
  AppSettings,
  DeepPartial,
  PreviewStartArgs,
  PreviewStartResult,
  BuildArgs,
  BuildResult,
  ExportProgressEvent,
  UrlPreviewBlockedEvent,
  RecentFolderEntry,
  FavoriteEntry,
  UpdaterApi,
  UpdaterStatus,
  NativeThemeState,
  DiscoveredProject,
  ProjectClassification,
  PrintSafeWarning,
  ProblemEntry,
  MediaImageEntry,
  MediaImageDetails,
  FileStat,
  FileWriteResult,
  RecoveryEntry,
  FolderChangedEvent,
  CreateProjectOptions,
  CreateProjectResult,
  TemplateInfo,
  SnippetEntry,
  ProjectPluginEntry,
  PluginValidationResult,
  RecommendedPlugin,
  ThemeInfo,
  ApplyThemeTarget,
  ProjectStyle,
  StyleToken,
  SnapshotEntry,
  SnapshotPage,
  ListSnapshotsOptions,
  RestoreVersionResult,
  DeviceCodeInfo,
  RemoteConnection,
  RemoteRepository,
  RemoteBranch,
  RepoBook,
  CloneProgressEvent,
  CloneRepositoryArgs,
  ProjectRemoteDiagnosis,
  RemoteAccessResult,
  ConnectGenericHostArgs,
  HostConnectionInfo,
  SyncOutcome,
  ResolveSyncConflictsArgs,
  SyncStatus,
  RecoveryConfirmRequest,
  ConflictPreview,
  FolderRef,
  FileRef,
  PlatformCapabilities,
} from "./contract";

const NOT_IMPL = "Web platform support lands in 0.6.0 (#41).";

// #33 Phase 4: same-origin path of the vendored paged.js polyfill the viewer
// ships in static/vendor/. The service worker precaches it; startPreview
// rewrites the render core's CDN URL to this so preview works offline.
const VENDOR_PAGED_POLYFILL_URL = "/vendor/paged.polyfill.js";

// ── Persistence (#33 Phase 3) ─────────────────────────────────────────────────
// IndexedDB object-store names + record shapes the adapter persists. Handles are
// stored verbatim (FileSystemDirectoryHandle is structured-cloneable); the rest
// are plain JSON-able rows keyed by FolderRef.key.
const STORE_HANDLES = "handles";
const STORE_RECENTS = "recents";
const STORE_FAVORITES = "favorites";
const STORE_PREFS = "prefs";
const STORE_PROJECT_STATES = "projectStates";
const STORE_META = "meta";
const PREFS_KEY = "singleton";
const LAST_PROJECT_KEY = "lastProjectKey";

/** A persisted FSA handle row. */
interface HandleRecord {
  key: string;
  handle: FileSystemDirectoryHandle;
  displayName: string;
}

/** A persisted recents row (RecentFolderEntry minus the runtime `exists`). */
interface RecentRecord {
  key: string;
  displayName: string;
  title: string;
  openedAt: string;
}

/** A persisted favorites row (FavoriteEntry minus the runtime `exists`). */
interface FavoriteRecord {
  key: string;
  displayName: string;
  title: string;
}

/**
 * The subset of the FSA permission API the adapter needs. These live on
 * `FileSystemHandle` at runtime (Chrome/Edge) but are not in the baseline TS DOM
 * lib, so we narrow to this minimal shape rather than widen the global types.
 */
type PermissionDescriptor = { mode?: "read" | "readwrite" };
interface PermissionedHandle {
  queryPermission?(desc?: PermissionDescriptor): Promise<PermissionState>;
  requestPermission?(desc?: PermissionDescriptor): Promise<PermissionState>;
}

function notImplemented(method: string): never {
  throw new Error(`${method}: ${NOT_IMPL}`);
}

function rejectNotImplemented(method: string): Promise<never> {
  return Promise.reject(new Error(`${method}: ${NOT_IMPL}`));
}

const SETTINGS_KEY = "print-md.app-settings";

/** Recursively merge a settings patch over a base, returning a new object. */
function deepMergeSettings(base: AppSettings, patch: DeepPartial<AppSettings>): AppSettings {
  const out = { ...base } as Record<string, unknown>;
  for (const key of Object.keys(patch) as Array<keyof AppSettings>) {
    const value = patch[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = { ...base[key], ...(value as object) };
    }
  }
  return out as unknown as AppSettings;
}

const webUpdater: UpdaterApi = {
  getStatus: () =>
    rejectNotImplemented("updater.getStatus") as Promise<UpdaterStatus>,
  check: () => rejectNotImplemented("updater.check") as Promise<UpdaterStatus>,
  applyNow: () => rejectNotImplemented("updater.applyNow"),
  markReady: () => rejectNotImplemented("updater.markReady"),
  onEvent: () => () => {},
};

export class WebAdapter implements Platform {
  readonly platform = "web" as const;
  readonly apiVersion = 0;
  readonly updater = webUpdater;

  // #33 Phase 3: the persistence seam. Defaults to the IndexedDB-backed store in
  // production; unit tests inject an InMemoryWebStore so the adapter logic is
  // tested without a real browser IndexedDB.
  private readonly store: WebStore;

  constructor(store?: WebStore) {
    this.store = store ?? new IndexedDbWebStore();
  }

  // #49/#33: capability set so the UI degrades gracefully on the web without
  // branching on `platform === "web"`.
  //
  // - nativeSavePath:false — the browser can't write to a chosen FS path; build
  //   output is delivered via BuildResult.downloadUrl (a browser download).
  // - showInFolder:false — no OS file manager to reveal in.
  // - persistentFolderAccess — TRUE on Chrome/Edge (File System Access API +
  //   IndexedDB-persistable handles), FALSE on Safari/no-FSA.
  //
  // TODO (Phase 6): the Safari/no-FSA branch keeps all three false and will gain
  // an OPFS + <input webkitdirectory> import/export fallback. Phase 1 targets
  // Chrome/Edge only.
  capabilities(): PlatformCapabilities {
    return {
      nativeSavePath: false,
      showInFolder: false,
      persistentFolderAccess: hasFsa(),
    };
  }

  /**
   * Resolve a Platform path string ("<rootKey>/<relpath>") to its open root
   * `FileSystemDirectoryHandle` plus the project-root-relative path. Throws a
   * clear error if the root key isn't a registered (open) directory handle.
   */
  private resolveRoot(path: string): { root: FileSystemDirectoryHandle; relPath: string } {
    const { rootKey, segments } = splitPath(path);
    const handle = resolveHandle(rootKey);
    if (handle.kind !== "directory") {
      throw new Error(`Path key "${rootKey}" does not refer to a folder handle.`);
    }
    return { root: handle as FileSystemDirectoryHandle, relPath: segments.join("/") };
  }

  // ── PlatformAdapter primitives — #33 Phase 1 (File System Access API) ──────
  // The opened folder's root handle is stashed in the web-fs registry; its
  // opaque id becomes FolderRef.key. Subsequent fs calls take a Platform path
  // string "<rootKey>/<relpath>" which resolveRoot() maps back to the handle.

  /**
   * Open the OS directory picker (Chrome/Edge), register the chosen root handle,
   * and return a host-neutral FolderRef. Resolves null when the user cancels
   * (the picker rejects with an AbortError). Rejects when no FSA picker exists
   * (e.g. Safari — Phase 6 will add the import/export fallback).
   */
  async openFolder(): Promise<FolderRef | null> {
    const picker = globalThis.window?.showDirectoryPicker;
    if (typeof picker !== "function") {
      throw new Error(
        "openFolder: the File System Access API is not supported in this browser " +
          "(Safari import/export fallback is not implemented yet).",
      );
    }
    let handle: FileSystemDirectoryHandle;
    try {
      // Bind the receiver — `showDirectoryPicker` is a native method and throws
      // "Illegal invocation" if invoked detached from `window`. Using the
      // typeof-narrowed `picker` ref keeps TS happy; `.call` restores `this`.
      handle = await picker.call(globalThis.window, { mode: "readwrite" });
    } catch (err) {
      // The user cancelled the picker → DOMException "AbortError" → return null
      // (matches the Electron adapter's null-on-cancel contract). Re-throw any
      // other error (e.g. SecurityError) so the caller can surface it.
      if (err instanceof DOMException && err.name === "AbortError") return null;
      throw err;
    }
    const key = registerHandle(handle);
    const displayName = basenameOf(handle.name);
    // #33 Phase 3: persist the handle + a recents entry so the project survives a
    // page reload (the handle is reloaded + re-permissioned via reopenFolder).
    // Best-effort: the folder is already open in the in-memory registry, so a
    // persistence failure (quota, private mode) must NOT fail the open itself.
    try {
      await this.persistOpenedFolder(key, handle, displayName);
    } catch (err) {
      console.warn(`[web] could not persist opened folder "${displayName}":`, err);
    }
    return { key, displayName };
  }

  // ── FSA handle persistence + reopen (#33 Phase 3, plan §4) ──────────────────

  /** Store the handle, upsert a recents row, and mark it the last project. */
  private async persistOpenedFolder(
    key: string,
    handle: FileSystemDirectoryHandle,
    displayName: string,
  ): Promise<void> {
    const record: HandleRecord = { key, handle, displayName };
    await this.store.put(STORE_HANDLES, key, record);
    // Preserve any title the user/SPA already set for this project on re-open;
    // only fall back to the basename for a brand-new recents row.
    const existing = (await this.store.get(STORE_RECENTS, key)) as RecentRecord | undefined;
    const recent: RecentRecord = {
      key,
      displayName,
      title: existing?.title ?? displayName,
      openedAt: new Date().toISOString(),
    };
    await this.store.put(STORE_RECENTS, key, recent);
    await this.store.put(STORE_META, LAST_PROJECT_KEY, key);
  }

  /**
   * Re-open a previously persisted folder by its `key` (the "reopen recent"
   * click in the SPA drives this — a USER GESTURE is required for FSA's
   * `requestPermission`, so this method MUST be called from an event handler).
   *
   * Flow (plan §4):
   *  1. Load the persisted `{handle}` from IndexedDB; clear-error if absent/stale.
   *  2. `queryPermission({mode:"readwrite"})`; if not already "granted", call
   *     `requestPermission(...)` (the gesture-driven prompt).
   *  3. On "granted", re-register the handle in the in-memory registry so the fs
   *     primitives resolve `key` → handle for the rest of the session, and return
   *     a FolderRef. On denial, throw a clear error the UI can surface.
   *
   * The SPA wires its recents list so each "Reopen <name>" button's onclick calls
   * `getPlatform().reopenFolder(entry.key)`; the click satisfies the gesture
   * requirement. After it resolves the app proceeds exactly as after openFolder
   * (same FolderRef shape).
   */
  async reopenFolder(key: string): Promise<FolderRef> {
    const record = (await this.store.get(STORE_HANDLES, key)) as HandleRecord | undefined;
    if (!record || !record.handle) {
      throw new Error(
        `Cannot reopen folder "${key}": no saved access to it was found. ` +
          "Open the folder again to grant access.",
      );
    }
    const handle = record.handle;
    const perm = handle as unknown as PermissionedHandle;
    const desc: PermissionDescriptor = { mode: "readwrite" };

    let state: PermissionState = "granted";
    if (typeof perm.queryPermission === "function") {
      state = await perm.queryPermission(desc);
    }
    if (state !== "granted" && typeof perm.requestPermission === "function") {
      // Must be inside a user gesture (the recents "Reopen" click) — see jsdoc.
      state = await perm.requestPermission(desc);
    }
    if (state !== "granted") {
      throw new Error(
        `Permission to access "${record.displayName}" was denied. ` +
          "Click “Reopen” and allow access to edit this project again.",
      );
    }

    reRegisterHandle(key, handle);
    // Refresh the recents timestamp + last-project pointer on reopen.
    const existing = (await this.store.get(STORE_RECENTS, key)) as RecentRecord | undefined;
    const recent: RecentRecord = {
      key,
      displayName: record.displayName,
      title: existing?.title ?? record.displayName,
      openedAt: new Date().toISOString(),
    };
    await this.store.put(STORE_RECENTS, key, recent);
    await this.store.put(STORE_META, LAST_PROJECT_KEY, key);
    return { key, displayName: record.displayName };
  }

  // `async` so a thrown resolveRoot (unknown/unopened key) becomes a rejected
  // promise, matching the Promise-returning contract (never a sync throw).
  async readFile(path: string): Promise<string> {
    const { root, relPath } = this.resolveRoot(path);
    return readFileFromRoot(root, relPath);
  }

  async writeFile(path: string, content: string): Promise<FileWriteResult> {
    const { root, relPath } = this.resolveRoot(path);
    return writeFileToRoot(root, relPath, content);
  }

  async listDir(
    path: string,
  ): Promise<Array<{ name: string; path: string; isDir: boolean }>> {
    const { rootKey } = splitPath(path);
    const { root, relPath } = this.resolveRoot(path);
    // Pass rootKey so each returned entry's `path` is "<rootKey>/<relpath>",
    // which round-trips straight back into readFile/writeFile/statFile.
    return listDirFromRoot(root, relPath, rootKey);
  }

  statFile(path: string): Promise<FileStat> {
    // statFile must never throw (callers probe with it) — a missing/unregistered
    // root resolves to { exists:false } just like a missing file.
    let resolved: { root: FileSystemDirectoryHandle; relPath: string };
    try {
      resolved = this.resolveRoot(path);
    } catch {
      return Promise.resolve({ size: 0, mtimeMs: 0, exists: false });
    }
    return statFileFromRoot(resolved.root, resolved.relPath);
  }

  // No FS-watch API on the web (single-writer); external-edit detection lands in
  // a later phase. Per the contract this returns an unsubscribe fn, so it must be
  // a safe no-op (NOT a throw) — callers do `const off = watchFolder(...)`.
  watchFolder(_path: string, _cb: () => void): () => void {
    return () => {};
  }

  getSecret(_key: string): Promise<string | null> {
    return notImplemented("getSecret");
  }

  setSecret(_key: string, _value: string): Promise<void> {
    return notImplemented("setSecret");
  }

  // ── HostServices — reject so existing `.catch()` guards stay silent ───────
  savePdf(_defaultName?: string): Promise<string | null> {
    return rejectNotImplemented("savePdf");
  }

  // Image pick / copy (#31) — desktop-only in 0.4.x; stubs reject silently.
  // #61: signature tracks the FileRef-returning contract (FSA picker in 0.6.0).
  pickImageFile(): Promise<FileRef | null> {
    return rejectNotImplemented("pickImageFile");
  }

  copyFile(_srcPath: string, _destDir: string): Promise<string> {
    return rejectNotImplemented("copyFile");
  }

  // Media panel (#47) — desktop-only until the PWA lands. The panel itself
  // guards with isDesktop(); thumbnails/inspection degrade to "unavailable".
  pickImageFiles(): Promise<string[]> {
    return rejectNotImplemented("pickImageFiles");
  }

  listProjectImages(_projectDir: string): Promise<MediaImageEntry[]> {
    return rejectNotImplemented("listProjectImages");
  }

  imageThumbnail(_filePath: string): Promise<string | null> {
    return Promise.resolve(null);
  }

  inspectImage(_filePath: string): Promise<MediaImageDetails | null> {
    return Promise.resolve(null);
  }

  openExternal(_url: string): Promise<void> {
    return rejectNotImplemented("openExternal");
  }

  showInFolder(_filePath: string): Promise<void> {
    return rejectNotImplemented("showInFolder");
  }

  readLogFile(_filePath: string): Promise<string | null> {
    // No file system in the browser — resolve null so callers can
    // gracefully hide the "View log" button.
    return Promise.resolve(null);
  }

  getStatus(): Promise<{ ok: boolean; runtime: string; name: string }> {
    return rejectNotImplemented("getStatus");
  }

  // #33 Phase 3: the last-opened folder key (its handle + recents row are
  // persisted; the SPA reopens it via reopenFolder on a user gesture).
  async getLastProject(): Promise<string | null> {
    const key = (await this.store.get(STORE_META, LAST_PROJECT_KEY)) as string | undefined;
    return key ?? null;
  }
  // No splash window on the web — these are safe no-ops (a PWA would use its own
  // loading UI, not a host splash).
  splashStatus(): Promise<void> {
    return Promise.resolve();
  }
  rendererReady(): Promise<void> {
    return Promise.resolve();
  }

  // #33 Phase 1: shallow listing of the project root's .md/.css files (#42), the
  // web equivalent of the Electron listProjectFiles IPC. `projectDir` is the
  // FolderRef.key (the registry id of the open root handle).
  async listProjectFiles(projectDir: string): Promise<{ md: string[]; css: string[] }> {
    const { root } = this.resolveRoot(projectDir);
    return listProjectFilesFromRoot(root);
  }

  // Lint is non-essential chrome — degrade to "no warnings" rather than reject,
  // so a future PWA editor still renders without a gutter until lint lands.
  checkCss(_css: string, _from?: string): Promise<PrintSafeWarning[]> {
    return Promise.resolve([]);
  }

  // Same degrade-to-clean policy as checkCss: the Problems panel simply shows
  // "No problems found" on the web until a PWA lint backend exists.
  lintProject(_projectDir: string): Promise<ProblemEntry[]> {
    return Promise.resolve([]);
  }

  // ── Viewer prefs (#33 Phase 3) — a single IndexedDB blob, merge-patched ──────
  async getViewerPrefs(): Promise<ViewerPrefs> {
    const stored = (await this.store.get(STORE_PREFS, PREFS_KEY)) as ViewerPrefs | undefined;
    return stored ?? {};
  }

  async setViewerPrefs(patch: Partial<ViewerPrefs>): Promise<{ ok: boolean }> {
    const current = (await this.store.get(STORE_PREFS, PREFS_KEY)) as ViewerPrefs | undefined;
    await this.store.put(STORE_PREFS, PREFS_KEY, { ...(current ?? {}), ...patch });
    return { ok: true };
  }

  // ── Per-project state (#33 Phase 3) — keyed by FolderRef.key, merge-patched ──
  async getViewerProjectState(projectDir: string): Promise<ProjectState | null> {
    const stored = (await this.store.get(STORE_PROJECT_STATES, projectDir)) as
      | ProjectState
      | undefined;
    return stored ?? null;
  }

  async setViewerProjectState(
    projectDir: string,
    patch: Partial<ProjectState>,
  ): Promise<{ ok: boolean }> {
    const current = (await this.store.get(STORE_PROJECT_STATES, projectDir)) as
      | ProjectState
      | undefined;
    await this.store.put(STORE_PROJECT_STATES, projectDir, { ...(current ?? {}), ...patch });
    return { ok: true };
  }

  // Settings (#45) — genuinely implemented on web via localStorage so the
  // settings store works even outside Electron.
  getSettings(): Promise<AppSettings> {
    try {
      const raw = globalThis.localStorage?.getItem(SETTINGS_KEY);
      const stored = raw ? (JSON.parse(raw) as DeepPartial<AppSettings>) : {};
      return Promise.resolve(deepMergeSettings(DEFAULT_SETTINGS, stored));
    } catch {
      return Promise.resolve(DEFAULT_SETTINGS);
    }
  }

  setSettings(patch: DeepPartial<AppSettings>): Promise<{ ok: boolean }> {
    try {
      const raw = globalThis.localStorage?.getItem(SETTINGS_KEY);
      const stored = raw ? (JSON.parse(raw) as DeepPartial<AppSettings>) : {};
      const merged = deepMergeSettings(deepMergeSettings(DEFAULT_SETTINGS, stored), patch);
      globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(merged));
      return Promise.resolve({ ok: true });
    } catch {
      return Promise.resolve({ ok: false });
    }
  }

  // Native (OS) theme (#48) — genuinely implemented via matchMedia so the
  // PWA / `vite dev` path themes correctly (not a 0.6.0 stub).
  getNativeTheme(): Promise<NativeThemeState> {
    const dark =
      typeof globalThis.matchMedia === "function" &&
      globalThis.matchMedia("(prefers-color-scheme: dark)").matches;
    return Promise.resolve({ shouldUseDarkColors: dark });
  }

  onNativeThemeUpdated(cb: (state: NativeThemeState) => void): () => void {
    if (typeof globalThis.matchMedia !== "function") return () => {};
    const mql = globalThis.matchMedia("(prefers-color-scheme: dark)");
    const listener = (e: MediaQueryListEvent) =>
      cb({ shouldUseDarkColors: e.matches });
    mql.addEventListener("change", listener);
    return () => mql.removeEventListener("change", listener);
  }

  // ── Recents / favorites (#33 Phase 3) — IndexedDB-backed, key+displayName ────
  // Each row references its persisted FSA handle by key; `exists` reflects
  // whether that handle is still saved (so a row whose handle was dropped shows
  // as stale rather than silently failing on reopen).

  private async handleExists(key: string): Promise<boolean> {
    const record = (await this.store.get(STORE_HANDLES, key)) as HandleRecord | undefined;
    return Boolean(record?.handle);
  }

  async getRecentFolders(): Promise<RecentFolderEntry[]> {
    const rows = (await this.store.list(STORE_RECENTS)).map((r) => r.value as RecentRecord);
    // Newest first (openedAt is an ISO string → lexicographic == chronological).
    rows.sort((a, b) => (b.openedAt ?? "").localeCompare(a.openedAt ?? ""));
    const out: RecentFolderEntry[] = [];
    for (const r of rows) {
      out.push({
        key: r.key,
        displayName: r.displayName,
        title: r.title,
        openedAt: r.openedAt,
        exists: await this.handleExists(r.key),
      });
    }
    return out;
  }

  async getFavorites(): Promise<FavoriteEntry[]> {
    const rows = (await this.store.list(STORE_FAVORITES)).map((r) => r.value as FavoriteRecord);
    const out: FavoriteEntry[] = [];
    for (const f of rows) {
      out.push({
        key: f.key,
        displayName: f.displayName,
        title: f.title,
        exists: await this.handleExists(f.key),
      });
    }
    return out;
  }

  async toggleFavorite(folderPath: string, title: string): Promise<{ favorited: boolean }> {
    const existing = (await this.store.get(STORE_FAVORITES, folderPath)) as
      | FavoriteRecord
      | undefined;
    if (existing) {
      await this.store.delete(STORE_FAVORITES, folderPath);
      return { favorited: false };
    }
    // Derive displayName from the persisted handle/recents row when available so
    // a favorite carries the same basename the recents entry shows.
    const handle = (await this.store.get(STORE_HANDLES, folderPath)) as
      | HandleRecord
      | undefined;
    const recent = (await this.store.get(STORE_RECENTS, folderPath)) as
      | RecentRecord
      | undefined;
    const displayName = handle?.displayName ?? recent?.displayName ?? basenameOf(folderPath);
    const record: FavoriteRecord = { key: folderPath, displayName, title };
    await this.store.put(STORE_FAVORITES, folderPath, record);
    return { favorited: true };
  }

  async removeRecent(folderPath: string): Promise<{ ok: boolean }> {
    await this.store.delete(STORE_RECENTS, folderPath);
    // If we just removed the last-opened project, clear the pointer too so
    // getLastProject() doesn't resurface a key the user explicitly dropped.
    const last = (await this.store.get(STORE_META, LAST_PROJECT_KEY)) as string | undefined;
    if (last === folderPath) await this.store.delete(STORE_META, LAST_PROJECT_KEY);
    return { ok: true };
  }

  // Project discovery (#27) — no background filesystem scan on the PWA (File
  // System Access API restrictions). Resolve to [] so the Discovered section is
  // simply absent rather than erroring.
  discoverProjects(): Promise<DiscoveredProject[]> {
    return Promise.resolve([]);
  }

  classifyProject(_path: string): Promise<ProjectClassification> {
    return rejectNotImplemented("classifyProject");
  }

  // New-project scaffold (#25) — desktop-only in 0.4.0.
  createProject(_options: CreateProjectOptions): Promise<CreateProjectResult> {
    return rejectNotImplemented("createProject");
  }

  // ── Project templates + snippets (#29) ──────────────────────────────────────
  // Built-in template metadata is static (safe to surface in a future PWA
  // wizard). Everything that touches the host filesystem — custom templates,
  // save-as-template, folder import, and per-project snippets — is desktop-only
  // in v1; the renderer guards these behind isDesktop(). Snippets over the FSA
  // project root are a documented follow-up (see CLAUDE.md §8 / issue #29).
  async listBuiltInTemplates(): Promise<TemplateInfo[]> {
    return [
      { id: "book", label: "Book", description: "A clean starting point for a novel, memoir, or any long-form book.", kind: "builtin" },
      { id: "ttrpg", label: "TTRPG supplement", description: "Rules, stat blocks, and tables for a tabletop roleplaying supplement.", kind: "builtin" },
      { id: "zine", label: "Zine", description: "A short, personal zine made to be printed, folded, and shared.", kind: "builtin" },
      { id: "technical", label: "Technical document", description: "A manual or guide with steps, reference tables, and code examples.", kind: "builtin" },
    ];
  }
  async listCustomTemplates(): Promise<TemplateInfo[]> {
    return [];
  }
  saveProjectAsTemplate(_projectDir: string, _name: string): Promise<TemplateInfo> {
    return rejectNotImplemented("saveProjectAsTemplate");
  }
  importTemplateFromFolder(): Promise<TemplateInfo | null> {
    return rejectNotImplemented("importTemplateFromFolder");
  }
  listSnippets(_projectDir: string): Promise<SnippetEntry[]> {
    return Promise.resolve([]);
  }
  readSnippet(_projectDir: string, _fileName: string): Promise<string> {
    return rejectNotImplemented("readSnippet");
  }
  saveSnippet(_projectDir: string, _name: string, _body: string): Promise<SnippetEntry> {
    return rejectNotImplemented("saveSnippet");
  }
  deleteSnippet(_projectDir: string, _fileName: string): Promise<void> {
    return rejectNotImplemented("deleteSnippet");
  }

  // ── Plugin manager (#30) — desktop-only in v1; reject/empty on web ─────────
  // The manifest read/write/toggle + load-test all run node-side in the host.
  // The UI guards with isDesktop() so these stubs are only hit defensively.
  listPlugins(_projectDir: string): Promise<ProjectPluginEntry[]> {
    return Promise.resolve([]);
  }
  setPluginEnabled(_projectDir: string, _ref: string, _enabled: boolean): Promise<void> {
    return rejectNotImplemented("setPluginEnabled");
  }
  addNpmPlugin(_projectDir: string, _packageName: string): Promise<ProjectPluginEntry> {
    return rejectNotImplemented("addNpmPlugin");
  }
  importLocalPlugin(_projectDir: string): Promise<ProjectPluginEntry | null> {
    return rejectNotImplemented("importLocalPlugin");
  }
  validatePlugins(_projectDir: string): Promise<PluginValidationResult[]> {
    return Promise.resolve([]);
  }
  listRecommendedPlugins(): Promise<RecommendedPlugin[]> {
    return Promise.resolve([]);
  }

  // ── Theme manager (#32) — desktop-only in v1; reject/empty on web ──────────
  // Theme apply/import all touch the host filesystem (copy folders, write the
  // manifest), so the UI guards with isDesktop(). Built-in metadata + reading a
  // built-in theme's CSS COULD work on web later (embedded css), but in v1 the
  // panel is desktop-only, so these stubs are only hit defensively.
  listBuiltInThemes(): Promise<ThemeInfo[]> {
    return Promise.resolve([]);
  }
  listProjectThemes(_projectDir: string): Promise<ThemeInfo[]> {
    return Promise.resolve([]);
  }
  getActiveTheme(_projectDir: string): Promise<ThemeInfo | null> {
    return Promise.resolve(null);
  }
  applyTheme(_projectDir: string, _target: ApplyThemeTarget): Promise<ThemeInfo> {
    return rejectNotImplemented("applyTheme");
  }
  importThemeFromFolder(_projectDir: string): Promise<ThemeInfo | null> {
    return rejectNotImplemented("importThemeFromFolder");
  }
  importThemeFromUrl(_projectDir: string, _url: string): Promise<ThemeInfo> {
    return rejectNotImplemented("importThemeFromUrl");
  }
  readThemeCss(
    _projectDir: string | null,
    _source: { kind: "builtin" | "project"; id: string },
  ): Promise<string> {
    return rejectNotImplemented("readThemeCss");
  }
  removeProjectTheme(_projectDir: string, _id: string): Promise<void> {
    return rejectNotImplemented("removeProjectTheme");
  }

  // ── Style resolver (audit B2/G1) — desktop-only editing (G3); empty on web ──
  listProjectStyles(_projectDir: string): Promise<ProjectStyle[]> {
    return Promise.resolve([]);
  }

  // ── Style tokens (guided Design panel) — desktop-only until FSA web lands ──
  readStyleTokens(_cssPath: string): Promise<StyleToken[]> {
    return Promise.resolve([]);
  }
  writeStyleToken(_cssPath: string, _name: string, _value: string): Promise<string> {
    return rejectNotImplemented("writeStyleToken");
  }

  // ── Local version history (#13) — desktop-only; reject/empty on web ────────
  enableVersionHistory(_projectDir: string): Promise<ProjectClassification> {
    return rejectNotImplemented("enableVersionHistory");
  }

  saveSnapshot(_projectDir: string, _message?: string): Promise<SnapshotEntry> {
    return rejectNotImplemented("saveSnapshot");
  }

  // Resolve to [] (like listRecovery) so a history view simply renders empty.
  listSnapshots(_projectDir: string): Promise<SnapshotEntry[]> {
    return Promise.resolve([]);
  }

  // Empty page (matches listSnapshots) so a history view renders empty.
  listSnapshotsPage(
    _projectDir: string,
    _options?: ListSnapshotsOptions,
  ): Promise<SnapshotPage> {
    return Promise.resolve({ entries: [], hasMore: false });
  }

  restoreSnapshot(_projectDir: string, _id: string): Promise<RestoreVersionResult> {
    return rejectNotImplemented("restoreSnapshot");
  }

  // ── Managed GitHub integration (#15) — desktop-only; safe stubs on web ─────
  connectGitHubStart(): Promise<DeviceCodeInfo> {
    return rejectNotImplemented("connectGitHubStart");
  }

  connectGitHubWait(): Promise<RemoteConnection> {
    return rejectNotImplemented("connectGitHubWait");
  }

  connectGitHubCancel(): Promise<{ ok: boolean }> {
    return Promise.resolve({ ok: true });
  }

  disconnectGitHub(): Promise<{ ok: boolean }> {
    return rejectNotImplemented("disconnectGitHub");
  }

  // Resolve "not connected" so connection badges simply stay absent on web.
  getRemoteConnection(_host?: string): Promise<RemoteConnection> {
    return Promise.resolve({ connected: false });
  }

  listRemoteRepositories(): Promise<RemoteRepository[]> {
    return rejectNotImplemented("listRemoteRepositories");
  }

  listRemoteBranches(_owner: string, _repo: string): Promise<RemoteBranch[]> {
    return rejectNotImplemented("listRemoteBranches");
  }

  listRepoBooks(_owner: string, _repo: string, _branch: string): Promise<RepoBook[]> {
    return rejectNotImplemented("listRepoBooks");
  }

  cloneRemoteRepository(_args: CloneRepositoryArgs): Promise<{ projectDir: string }> {
    return rejectNotImplemented("cloneRemoteRepository");
  }

  onCloneProgress(_cb: (data: CloneProgressEvent) => void): () => void {
    return () => {};
  }

  // ── Advanced Setup (#14) — desktop-only until the PWA lands ──────────────
  diagnoseProjectRemote(_projectDir: string): Promise<ProjectRemoteDiagnosis> {
    return rejectNotImplemented("diagnoseProjectRemote");
  }

  testRemoteAccess(_url: string): Promise<RemoteAccessResult> {
    return rejectNotImplemented("testRemoteAccess");
  }

  connectGenericHost(
    _args: ConnectGenericHostArgs,
  ): Promise<{ connected: boolean; host: string; username?: string }> {
    return rejectNotImplemented("connectGenericHost");
  }

  disconnectHost(_host: string): Promise<{ ok: boolean }> {
    return rejectNotImplemented("disconnectHost");
  }

  listHostConnections(): Promise<HostConnectionInfo[]> {
    return Promise.resolve([]);
  }

  forgeTokenUrl(_host: string): Promise<string | null> {
    return Promise.resolve(null);
  }

  // ── Auto-sync orchestrator seam — desktop-only; safe stubs on web ───────────
  // The ambient pill simply stays absent (no handler is ever called) when
  // running in a browser; setAutoSync is a silent no-op so callers need no guard.
  onSyncStatus(_handler: (status: SyncStatus) => void): () => void {
    // Never emits on the web — return a no-op unsubscribe.
    return () => {};
  }

  setAutoSync(_enabled: boolean): Promise<void> {
    // Auto-sync is desktop-only until the PWA sync backend lands in 0.6.0.
    return Promise.resolve();
  }

  // ── Sync recovery seam — desktop-only; safe stubs on web ─────────────────
  onRecoveryConfirm(_handler: (req: RecoveryConfirmRequest) => void): () => void {
    // Recovery is desktop-only — return a no-op unsubscribe.
    return () => {};
  }

  respondRecoveryConfirm(_requestId: string, _approved: boolean): Promise<void> {
    // No-op on web — recovery only runs in the Electron host.
    return Promise.resolve();
  }

  getConflictPreview(_projectDir: string, _path: string): Promise<ConflictPreview> {
    return rejectNotImplemented("getConflictPreview");
  }

  // ── Sync (#15 sync phase) — desktop-only until the PWA lands ───────────────
  syncChanges(_projectDir: string, _message?: string): Promise<SyncOutcome> {
    return rejectNotImplemented("syncChanges");
  }

  resolveSyncConflicts(_args: ResolveSyncConflictsArgs): Promise<SyncOutcome> {
    return rejectNotImplemented("resolveSyncConflicts");
  }

  // ── In-browser live preview (#33 Phase 2) — no server, no Chromium ──────────
  // The last object URL minted by startPreview, revoked by stopPreview (and
  // before minting the next one) so blob memory isn't leaked across renders.
  private lastPreviewUrl: string | null = null;

  /**
   * Render the opened project's markdown to a paginated `book.html` ENTIRELY in
   * the browser and hand back a `blob:` object URL for the existing preview
   * iframe — the web analogue of the Electron localhost preview server.
   *
   * Pipeline (plan §2):
   *  1. resolve the root FileSystemDirectoryHandle from `input.key`;
   *  2. list the project's `.md`/`.css` (FSA), read them via `web-fs`;
   *  3. run the PURE `assembleBookHtml` (markdown-it + paged plugin) with an
   *     FSA-backed `readText` — the SAME render core the CLI uses;
   *  4. INLINE the project CSS into the document (a blob-URL doc can't resolve
   *     relative `css/*` hrefs), wrap it in a Blob, and return its object URL.
   *
   * Paged.js then paginates in the iframe's own browser context exactly as on
   * desktop — `+page.svelte` needs no change (it just points the iframe at the
   * returned `url`).
   *
   * OFFLINE (#33 Phase 4): the pure render core emits the unpkg CDN `<script>`
   * for paged.js; this adapter REWRITES it to the same-origin, vendored
   * `/vendor/paged.polyfill.js` (shipped in the viewer `static/` dir + precached
   * by the service worker). A `blob:` document inherits the creating page's
   * origin, so an absolute-path URL resolves same-origin and is SW-cacheable —
   * which makes the in-browser preview work fully offline once the shell is
   * cached.
   *
   * KNOWN PHASE-2 GAPS (tracked for later phases — intentionally not silent):
   *  - MANIFEST: chapters are listed in alphabetical order (listProjectFiles),
   *    matching the CLI's no-manifest fallback. A project `manifest.yaml` with a
   *    custom `source.files` order or `plugins` is NOT yet parsed here, so such
   *    projects can preview in a different order than the CLI build. A later
   *    phase will parse the manifest (the `yaml` dep is browser-safe).
   */
  /**
   * Render the opened project's markdown to a complete, standalone `book.html`
   * STRING — the shared core behind both `startPreview` (Blob URL for the
   * iframe) and `build({format:"html"})` (Blob URL for a download). Keeping ONE
   * assembly path means the exported HTML is byte-identical to what the user
   * previews: same inlined project CSS, same same-origin paged.js rewrite.
   *
   * Pipeline (plan §2):
   *  1. resolve the root FileSystemDirectoryHandle from `input.key`;
   *  2. list the project's `.md`/`.css` (FSA), read them via `web-fs`;
   *  3. run the PURE `assembleBookHtml` (markdown-it + paged plugin) with an
   *     FSA-backed `readText` — the SAME render core the CLI uses;
   *  4. INLINE the project CSS (a blob-URL doc can't resolve relative `css/*`
   *     hrefs) and rewrite the CDN paged.js reference to the same-origin copy.
   *
   * Throws (rejects, via the `async` callers) when the folder has no `.md`.
   */
  private async renderBookHtml(input: FolderRef): Promise<string> {
    const { root } = this.resolveRoot(input.key);
    const { md, css } = await listProjectFilesFromRoot(root);

    if (md.length === 0) {
      throw new Error(
        `No markdown files found in "${input.displayName}". ` +
          "Add a .md file to preview this project.",
      );
    }

    // Inline the project CSS: a blob-URL document has no base path, so relative
    // <link href="css/print.css"> would 404. Read each .css and concatenate it
    // into a single <style> block instead. Pass styles:[] to the assembler so it
    // emits no unresolvable <link> tags.
    const projectCss = (
      await Promise.all(
        css.map(async (name) => {
          try {
            return await readFileFromRoot(root, name);
          } catch (err) {
            // Don't fail the whole render for one unreadable stylesheet, but
            // don't drop it silently either — surface which file + why.
            console.warn(`[web render] skipping unreadable CSS "${name}":`, err);
            return "";
          }
        }),
      )
    )
      .filter((s) => s.length > 0)
      .join("\n\n");

    let html = await assembleBookHtml({
      files: md,
      readText: (relPath) => readFileFromRoot(root, relPath),
      styles: [],
      title: input.displayName,
    });

    // #33 Phase 4 (offline): rewrite the render core's CDN paged.js reference to
    // the same-origin vendored copy so the preview/export works offline (the SW
    // precaches /vendor/paged.polyfill.js). A blob: document inherits this page's
    // origin, so the absolute path resolves same-origin. Match any unpkg pinned
    // version so a future paged.js bump in the lib still rewrites cleanly.
    html = html.replace(
      /https:\/\/unpkg\.com\/pagedjs@[^/]+\/dist\/paged\.polyfill\.js/g,
      VENDOR_PAGED_POLYFILL_URL,
    );

    // Inject the inlined project CSS just before </head> (after the assembler's
    // own paged-plugin <style> so project rules win on equal specificity, same
    // cascade order as the linked stylesheet would have had).
    if (projectCss) {
      const styleTag = `  <style data-project-css>\n${projectCss}\n</style>\n`;
      html = html.includes("</head>")
        ? html.replace("</head>", styleTag + "</head>")
        : styleTag + html;
    }

    return html;
  }

  async startPreview(args: PreviewStartArgs): Promise<PreviewStartResult> {
    const html = await this.renderBookHtml(args.input);

    // Revoke a prior preview URL before minting a new one (no blob leak across
    // re-previews); stopPreview() also revokes on teardown.
    if (this.lastPreviewUrl) {
      URL.revokeObjectURL(this.lastPreviewUrl);
      this.lastPreviewUrl = null;
    }
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    this.lastPreviewUrl = url;

    return {
      url,
      port: 0, // no server on web
      input: args.input.key,
      title: args.input.displayName ?? null,
    };
  }

  stopPreview(): Promise<{ stopped: boolean }> {
    if (this.lastPreviewUrl) {
      URL.revokeObjectURL(this.lastPreviewUrl);
      this.lastPreviewUrl = null;
    }
    return Promise.resolve({ stopped: true });
  }

  cancelExport(_exportId: string): Promise<{ canceled: boolean }> {
    return rejectNotImplemented("cancelExport");
  }

  /**
   * #33 Phase 5: build/export on web.
   *
   * - `format:"html"` — render the full standalone `book.html` IN-BROWSER
   *   (the SAME `renderBookHtml` path as the live preview, so the export matches
   *   what the author sees: inlined project CSS + same-origin paged.js) and hand
   *   it back as a `blob:` object URL on `BuildResult.downloadUrl`. The SPA turns
   *   that into a browser download (an `<a download>` click). There is no
   *   filesystem write on web; `outDir`/`htmlPath` are nominal display values
   *   (the contract requires `outDir`), the download URL is the real delivery.
   *
   *   OBJECT-URL LIFECYCLE: unlike the preview URL (which the adapter owns and
   *   revokes in stopPreview / before the next preview), a download URL must
   *   stay alive until the browser has finished fetching it for the <a download>
   *   click — revoking too early aborts the download. So OWNERSHIP TRANSFERS to
   *   the SPA: the caller revokes it after the click (see +page.svelte's HTML
   *   export handler). The adapter intentionally does NOT track or revoke it.
   *
   * - `format:"pdf"|"pdfx"` — reject with an explicit desktop-only message. PDF
   *   uses Chromium's printToPDF (Electron) / puppeteer (CLI), neither of which
   *   exists in the browser. `capabilities().nativeSavePath` is already false and
   *   the SPA hides the PDF control on web (Phase 4), so this is a belt-and-braces
   *   guard with a clear message rather than the generic 0.6.0 stub.
   */
  async build(args: BuildArgs): Promise<BuildResult> {
    if (args.format !== "html") {
      throw new Error(
        "PDF export requires the desktop app. " +
          "On the web you can export HTML; PDF (and PDF/X) are available in the " +
          "print-md desktop app or CLI.",
      );
    }

    const html = await this.renderBookHtml(args.input);

    // Ownership of this object URL transfers to the SPA (see jsdoc): it must
    // outlive this call so the <a download> click can fetch it; the SPA revokes
    // it after triggering the download.
    const blob = new Blob([html], { type: "text/html" });
    const downloadUrl = URL.createObjectURL(blob);

    // A nominal filename/dir for display only — the browser download names the
    // file from the <a download> attribute the SPA sets, not from these.
    const fileName = `${args.input.displayName || "book"}.html`;
    return {
      outDir: args.input.displayName || "",
      htmlPath: fileName,
      downloadUrl,
    };
  }

  doctor(): Promise<unknown> {
    return rejectNotImplemented("doctor");
  }

  onBuildProgress(_cb: (data: ExportProgressEvent) => void): () => void {
    return () => {};
  }

  onUrlPreviewBlocked(_cb: (data: UrlPreviewBlockedEvent) => void): () => void {
    return () => {};
  }

  // ── Unsaved changes / recovery (#44) — desktop-only; reject/no-op on web ───
  writeRecovery(
    _filePath: string,
    _content: string,
    _baseMtimeMs: number,
  ): Promise<{ ok: boolean }> {
    return rejectNotImplemented("writeRecovery");
  }

  clearRecovery(_filePath: string): Promise<{ ok: boolean }> {
    return rejectNotImplemented("clearRecovery");
  }

  listRecovery(_projectDir: string): Promise<RecoveryEntry[]> {
    return Promise.resolve([]);
  }

  setDirtyState(_isDirty: boolean): Promise<void> {
    return rejectNotImplemented("setDirtyState");
  }

  onFlushBeforeClose(_cb: () => void): () => void {
    return () => {};
  }

  onFolderChanged(_cb: (data: FolderChangedEvent) => void): () => void {
    return () => {};
  }
}
