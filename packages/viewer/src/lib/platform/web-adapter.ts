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
    return { key, displayName: basenameOf(handle.name) };
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

  getLastProject(): Promise<string | null> {
    return rejectNotImplemented("getLastProject");
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

  getViewerPrefs(): Promise<ViewerPrefs> {
    return rejectNotImplemented("getViewerPrefs");
  }

  setViewerPrefs(_patch: Partial<ViewerPrefs>): Promise<{ ok: boolean }> {
    return rejectNotImplemented("setViewerPrefs");
  }

  getViewerProjectState(_projectDir: string): Promise<ProjectState | null> {
    return rejectNotImplemented("getViewerProjectState");
  }

  setViewerProjectState(
    _projectDir: string,
    _patch: Partial<ProjectState>,
  ): Promise<{ ok: boolean }> {
    return rejectNotImplemented("setViewerProjectState");
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

  getRecentFolders(): Promise<RecentFolderEntry[]> {
    return rejectNotImplemented("getRecentFolders");
  }

  getFavorites(): Promise<FavoriteEntry[]> {
    return rejectNotImplemented("getFavorites");
  }

  toggleFavorite(_folderPath: string, _title: string): Promise<{ favorited: boolean }> {
    return rejectNotImplemented("toggleFavorite");
  }

  removeRecent(_folderPath: string): Promise<{ ok: boolean }> {
    return rejectNotImplemented("removeRecent");
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
   * KNOWN PHASE-2 GAPS (tracked for later phases — intentionally not silent):
   *  - OFFLINE: the assembled HTML loads paged.js from the unpkg CDN (the lib's
   *    default). Phase 4 (service worker + offline) will ship a same-origin
   *    vendored `paged.polyfill.js` and rewrite this URL so preview works
   *    offline; today web preview needs network access.
   *  - MANIFEST: chapters are listed in alphabetical order (listProjectFiles),
   *    matching the CLI's no-manifest fallback. A project `manifest.yaml` with a
   *    custom `source.files` order or `plugins` is NOT yet parsed here, so such
   *    projects can preview in a different order than the CLI build. A later
   *    phase will parse the manifest (the `yaml` dep is browser-safe).
   */
  async startPreview(args: PreviewStartArgs): Promise<PreviewStartResult> {
    const { root } = this.resolveRoot(args.input.key);
    const { md, css } = await listProjectFilesFromRoot(root);

    if (md.length === 0) {
      throw new Error(
        `No markdown files found in "${args.input.displayName}". ` +
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
            // Don't fail the whole preview for one unreadable stylesheet, but
            // don't drop it silently either — surface which file + why.
            console.warn(`[web preview] skipping unreadable CSS "${name}":`, err);
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
      title: args.input.displayName,
    });

    // Inject the inlined project CSS just before </head> (after the assembler's
    // own paged-plugin <style> so project rules win on equal specificity, same
    // cascade order as the linked stylesheet would have had).
    if (projectCss) {
      const styleTag = `  <style data-project-css>\n${projectCss}\n</style>\n`;
      html = html.includes("</head>")
        ? html.replace("</head>", styleTag + "</head>")
        : styleTag + html;
    }

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

  build(_args: BuildArgs): Promise<BuildResult> {
    return rejectNotImplemented("build");
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
