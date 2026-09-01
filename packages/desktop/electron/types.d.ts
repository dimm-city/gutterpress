// Electron-side ambient types for the desktop host. `gutterpress` now
// ships real declarations; this file only keeps desktop-specific ambient modules
// and the window bridge augmentation.

// ──────────────────────────────────────────────────────────────────────────
// window.electron — bridge types for the renderer / SvelteKit SPA
//
// Shared IPC payload types (AppSettings, SyncOutcome, etc.) are defined once
// in src/lib/platform/shared-types.ts and re-exported here via bridge-types.ts.
// No more "Keep them in sync manually" — add new shared types to shared-types.ts.
//
// SFE-P5c1 correction: an earlier revision of this run deleted this
// `Window.electron` block as a "zero-consumer duplicate" of preload.ts's own
// typing (SFE-P5b's search found zero RUNTIME reads of `window.electron`
// anywhere under electron/). That search was real but incomplete: this
// block is also a TYPE-graph dependency, not just a runtime one.
// `electron/main.ts` value-imports `../src/lib/persistence-failures.ts`,
// which type-imports `src/lib/platform/contract.ts`, which type-imports
// `EditorProjectionArgs`/`EditorProjectionOutcome` from
// `../editor-host/editor-projection-capability.ts` — a module that
// VALUE-imports `../platform/bridge.ts`, whose `window.electron` reference
// needs SOME ambient `Window.electron` typing to satisfy `tsc -p
// electron/tsconfig.json` (which does not include `src/app.d.ts` — the SPA's
// OWN `Window.electron` ambient declaration lives in a tsconfig program this
// one does not share). Deleting this block broke `bun run typecheck` via
// that pre-existing chain — confirmed by actually running it, not by a
// repeated grep for `window.electron` reads. Restored; kept in agreement
// with `bridge-types.ts` + `contract.ts`'s `ElectronBridge` by hand, same as
// before.
//
// This file is a TS module (has `import type`) so all augmentations live
// inside `declare global { ... }`.
// ──────────────────────────────────────────────────────────────────────────

import type {
  UpdaterEventPayload,
  AppSettings,
  DeviceCodeInfo,
  RemoteConnection,
  RemoteRepository,
  RemoteBranch,
  RepoBook,
  CloneProgressEvent,
  ExportProgressEvent,
  MarkdownFileLaunchEvent,
  PreviewStartResult,
  EditorProjectionHostArgs,
  EditorProjectionOutcome,
  DirEntry,
  FileStat,
  FileWriteResult,
  ProjectFileEntry,
  LogFileEntry,
  DesktopPrefs,
  ProjectState,
  DiscoveredProject,
  ProjectClassification,
  AppImageStatus,
  AppImageInstallResult,
  AppImageRemoveResult,
  SnapshotEntry,
  SnapshotPage,
  RestoreVersionResult,
  TemplateInfo,
  SavedTemplateInfo,
  SnippetEntry,
  ProjectConfigFields,
  ProjectPluginEntry,
  PluginValidationResult,
  RecommendedPlugin,
  ThemeInfo,
  ApplyThemeTarget,
  ThemeImportResult,
  ProjectStyle,
  MediaImageEntry,
  MediaImageDetails,
  LastFlushFailure,
  RemoteAccessResult,
  ProjectRemoteDiagnosis,
  ConnectGenericHostArgs,
  HostConnectionInfo,
  PublishProviderCard,
  PublishRunResult,
  PublishProviderStaticInfo,
  PreflightRow,
  CloneRepositoryArgs,
  SyncOutcome,
  RecoveryEntry,
  PrintSafeWarning,
  ProblemEntry,
  DoctorDiagnostics,
} from "./bridge-types";
import type { CreateProjectResult } from "gutterpress";

declare global {
  // UpdaterStatus is re-used by ElectronUpdater below.
  interface UpdaterStatus {
    currentVersion: string | null;
    stagedVersion: string | null;
    availableVersion: string | null;
    availableAction: "download" | "open-release" | null;
    phase: "idle" | "checking" | "available" | "downloading" | "staged" | "error";
    error: string | null;
  }

  type UpdaterEvent = UpdaterEventPayload;

  // getStatus/check/download joined applyNow/onEvent on typed IPC in
  // SFE-P5c4 (ARCH review #8's HTTP+IPC fan-out is gone).
  interface ElectronUpdater {
    getStatus(): Promise<UpdaterStatus>;
    check(): Promise<UpdaterStatus>;
    download(): Promise<UpdaterStatus>;
    applyNow(): Promise<{ applied: boolean; version?: string; error?: string }>;
    onEvent(cb: (event: UpdaterEvent) => void): () => void;
  }

  interface Window {
    electron?: {
      /** Integer IPC-surface version exposed by the preload bridge. */
      apiVersion: number;
      updater: ElectronUpdater;

      // ── fs / dialog / shell / log / app — typed IPC (SFE-P5c1) ──────────
      fs: {
        readFile(path: string): Promise<string>;
        writeFile(path: string, content: string): Promise<FileWriteResult>;
        statFile(path: string): Promise<FileStat>;
        listDir(path: string): Promise<DirEntry[]>;
        listProjectFiles(projectDir: string): Promise<ProjectFileEntry>;
        createFile(dir: string, name: string, content: string): Promise<{ path: string; mtimeMs: number }>;
        createFolder(dir: string, name: string): Promise<{ path: string }>;
        renamePath(path: string, newName: string): Promise<{ path: string }>;
        deletePath(path: string, projectDir: string): Promise<{ ok: true }>;
      };
      dialog: {
        openDirectory(): Promise<string | null>;
        savePdf(defaultName?: string): Promise<string | null>;
        pickImageFile(): Promise<string | null>;
        pickPdfFile(): Promise<string | null>;
        pickImageFiles(): Promise<string[]>;
      };
      shell: {
        openExternal(url: string): Promise<{ ok: true }>;
        showInFolder(filePath: string): Promise<{ ok: true }>;
      };
      log: {
        read(logPath: string): Promise<string | null>;
        list(): Promise<LogFileEntry[]>;
      };
      app: {
        getDesktopPrefs(): Promise<DesktopPrefs>;
        setDesktopPrefs(prefs: Record<string, unknown>): Promise<{ ok: true }>;
        getDesktopProjectState(projectDir: string): Promise<ProjectState | null>;
        setDesktopProjectState(projectDir: string, state: Record<string, unknown>): Promise<{ ok: true }>;
        getSettings(): Promise<Record<string, unknown>>;
        setSettings(settings: Record<string, unknown>): Promise<{ ok: true }>;
        getNativeTheme(): Promise<{ shouldUseDarkColors: boolean }>;
        getRecentFolders(): Promise<
          Array<{ path: string; title: string; exists: boolean; lastActiveBook?: string }>
        >;
        getFavorites(): Promise<Array<{ path: string; title: string; exists: boolean }>>;
        toggleFavorite(path: string, title: string): Promise<{ favorited: boolean }>;
        removeRecent(path: string): Promise<{ ok: true }>;
        discoverProjects(): Promise<DiscoveredProject[]>;
        classifyProject(projectDir: string): Promise<ProjectClassification>;
        createProject(options: Record<string, unknown>): Promise<CreateProjectResult>;
        adoptFolder(options: Record<string, unknown>): Promise<CreateProjectResult>;
        setDirtyState(dirty: boolean): Promise<{ ok: true }>;
        recordFlushFailure(projectDir: string | null): Promise<LastFlushFailure>;
        acknowledgeFlushFailure(failedAt: string): Promise<{ acknowledged: boolean }>;
        appImageIntegration: {
          getStatus(): Promise<AppImageStatus>;
          install(): Promise<AppImageInstallResult>;
          remove(): Promise<AppImageRemoveResult>;
        };
      };

      // ── project / manifest / tpl / snip / media / plugin / theme / vcs /
      // style — typed IPC (SFE-P5c2) ─────────────────────────────────────
      project: {
        listStyles(projectDir: string, repoRoot?: string | null): Promise<ProjectStyle[]>;
      };
      manifest: {
        read(projectDir: string): Promise<ProjectConfigFields>;
        setFields(projectDir: string, updates: ProjectConfigFields): Promise<ProjectConfigFields>;
      };
      tpl: {
        listBuiltIn(): Promise<TemplateInfo[]>;
        listCustom(): Promise<TemplateInfo[]>;
        saveAsTemplate(opts: {
          projectDir: string;
          name: string;
          sharedRefs?: "vendor" | "exclude";
        }): Promise<SavedTemplateInfo>;
        importFromFolder(): Promise<TemplateInfo | null>;
      };
      snip: {
        list(projectDir: string): Promise<SnippetEntry[]>;
        read(projectDir: string, fileName: string): Promise<string>;
        save(projectDir: string, name: string, body: string): Promise<SnippetEntry>;
        delete(projectDir: string, fileName: string): Promise<{ ok: boolean }>;
      };
      media: {
        listImages(projectDir: string): Promise<MediaImageEntry[]>;
        thumbnail(imagePath: string): Promise<string | null>;
        inspect(imagePath: string): Promise<MediaImageDetails | null>;
        importImage(projectDir: string, src: string): Promise<{ src: string; copied: boolean }>;
      };
      plugin: {
        list(projectDir: string): Promise<ProjectPluginEntry[]>;
        setEnabled(projectDir: string, ref: string, enabled: boolean): Promise<{ ok: boolean }>;
        addNpm(projectDir: string, packageName: string, exportName?: string): Promise<ProjectPluginEntry | null>;
        addLocal(projectDir: string): Promise<ProjectPluginEntry | null>;
        validate(projectDir: string): Promise<PluginValidationResult[]>;
        recommended(): Promise<RecommendedPlugin[]>;
      };
      theme: {
        listBuiltIn(): Promise<ThemeInfo[]>;
        listProject(projectDir: string): Promise<ThemeInfo[]>;
        getActive(projectDir: string): Promise<ThemeInfo | null>;
        apply(projectDir: string, target: ApplyThemeTarget): Promise<ThemeInfo>;
        importFromFolder(projectDir: string): Promise<ThemeInfo | null>;
        importFromFile(projectDir: string): Promise<ThemeImportResult | null>;
        importFromUrl(projectDir: string, url: string): Promise<ThemeInfo>;
        readCss(projectDir: string | null, source: { kind: "builtin" | "project"; id: string }): Promise<string>;
        remove(projectDir: string, id: string): Promise<{ ok: true }>;
        getPrevious(projectDir: string): Promise<ThemeInfo | null>;
        revert(projectDir: string): Promise<ThemeInfo>;
      };
      vcs: {
        enableVersionHistory(projectDir: string): Promise<unknown>;
        listSnapshotsPage(
          projectDir: string,
          options?: { limit?: number; before?: string },
        ): Promise<SnapshotPage>;
        restoreSnapshot(projectDir: string, id: string): Promise<RestoreVersionResult>;
        saveSnapshot(projectDir: string, message?: string): Promise<SnapshotEntry>;
      };
      style: {
        setActive(projectDir: string, paths: string[]): Promise<string[]>;
      };

      // ── recovery / doctor / lint — typed IPC (SFE-P5c4, the LAST route
      // group) ───────────────────────────────────────────────────────────
      recovery: {
        write(filePath: string, content: string, baseMtimeMs: number): Promise<{ ok: boolean }>;
        clear(filePath: string): Promise<{ ok: boolean }>;
        list(projectDir: string): Promise<RecoveryEntry[]>;
      };
      doctor: {
        getDiagnostics(): Promise<DoctorDiagnostics>;
      };
      lint: {
        checkCss(cssPath: string, content: string): Promise<PrintSafeWarning[]>;
        project(projectDir: string): Promise<ProblemEntry[]>;
      };

      // ── remote / sync / publish — typed IPC (SFE-P5c3, the credentials-
      // sensitive group) ────────────────────────────────────────────────
      remote: {
        disconnectGitHub(): Promise<{ ok: boolean }>;
        getConnection(host?: string): Promise<{ connected: boolean; username?: string; label?: string }>;
        listRepositories(): Promise<RemoteRepository[]>;
        listBranches(owner: string, repo: string): Promise<RemoteBranch[]>;
        listRepoBooks(owner: string, repo: string, branch: string): Promise<RepoBook[]>;
        diagnoseProject(projectDir: string): Promise<ProjectRemoteDiagnosis>;
        testRemoteAccess(url: string): Promise<RemoteAccessResult>;
        connectGenericHost(
          args: ConnectGenericHostArgs,
        ): Promise<{ connected: boolean; host: string; username?: string }>;
        disconnectHost(host: string): Promise<{ ok: boolean }>;
        listConnections(): Promise<HostConnectionInfo[]>;
        forgeTokenUrl(host: string): Promise<string | null>;
        sync(projectDir: string, message?: string): Promise<SyncOutcome>;
        cloneRepository(args: CloneRepositoryArgs): Promise<{ projectDir: string }>;
      };
      sync: {
        setAutoSync(enabled: boolean): Promise<{ ok: boolean; autoSync: boolean }>;
        getStatus(projectDir: string): Promise<object | null>;
      };
      publish: {
        listProviders(projectDir: string): Promise<PublishProviderCard[]>;
        providers(): Promise<PublishProviderStaticInfo[]>;
        connect(
          projectDir: string,
          providerId: string,
          token: string,
          account?: string,
        ): Promise<{ connected: boolean; providerId: string }>;
        disconnect(providerId: string, account?: string): Promise<{ ok: boolean }>;
        setConfig(
          projectDir: string,
          providerId: string,
          values: Record<string, string>,
        ): Promise<Record<string, Record<string, unknown>>>;
        preflight(projectDir: string, providerIds: string[]): Promise<PreflightRow[]>;
        run(
          projectDir: string,
          providerId: string,
          options?: { dryRun?: boolean; artifactPath?: string },
        ): Promise<PublishRunResult>;
      };

      // Native (OS) theme surface (#48) — push channel kept as IPC (main→renderer)
      onNativeThemeUpdated(
        cb: (data: { shouldUseDarkColors: boolean }) => void
      ): () => void;
      onOpenMarkdownFile(cb: (data: MarkdownFileLaunchEvent) => void): () => void;
      /**
       * Raw folder-watch IPC (#44). Subscribes to change events for `path`
       * and returns an unsubscribe fn.
       */
      watchFolder(path: string, cb: () => void): () => void;
      // tpl:*, snip:*, plugin:*, theme:*, project:listStyles, and local
      // version history (#13 — enableVersionHistory, listSnapshotsPage,
      // restoreSnapshot, saveSnapshot) round-tripped through SvelteKit
      // server routes for a while (Phase 2D/2E) and are back on this bridge
      // as of SFE-P5c2 — see the `project`/`manifest`/`tpl`/`snip`/`media`/
      // `plugin`/`theme`/`vcs`/`style` members above.
      // Managed GitHub integration (#15)
      connectGitHubStart(): Promise<DeviceCodeInfo>;
      connectGitHubWait(): Promise<RemoteConnection>;
      connectGitHubCancel(): Promise<{ ok: boolean }>;
      // disconnectGitHub, getConnection, listRepositories, listBranches,
      // listRepoBooks, diagnoseProject, testRemoteAccess, connectGenericHost,
      // disconnectHost, listConnections, forgeTokenUrl, sync, cloneRepository
      // — SFE-P5c3: restored to typed IPC on the `remote` member above.
      onCloneProgress(cb: (data: CloneProgressEvent) => void): () => void;
      // Auto-sync orchestrator seam (transparent sync, §4.4 integration plan)
      /** Subscribe to ambient sync-status push events. Returns an unsubscribe fn.
       *  Note: data may carry a `message` field when state is 'error'. */
      onSyncStatus(cb: (data: unknown) => void): () => void;
      // setAutoSync/getStatus — SFE-P5c3: restored to typed IPC on the `sync`
      // member above.
      // resolveSyncConflicts — dead (removed before this run; sync always converges).
      startPreview(args: { input: string }): Promise<PreviewStartResult>;
      stopPreview(): Promise<{ stopped: boolean }>;
      cancelExport(exportId: string): Promise<{ canceled: boolean }>;
      build(args: {
        input: string;
        format: "pdf" | "html" | "pdfx";
        out?: string;
        title?: string;
        pdfxFlavor?: string;
        icc?: string;
        manifest?: string;
        stripAnnotations?: boolean;
        skipLint?: boolean;
        skipPreValidate?: boolean;
        skipPostValidate?: boolean;
      }): Promise<{
        exportId?: string;
        outDir: string;
        htmlPath?: string;
        pdfPath?: string;
        fingerprintPath?: string;
        diagnostics?: Array<{ code: string; severity: "warning" | "info"; message: string }>;
      }>;
      // SFE-P3e: host-built, plugin-aware rich-editor projection. Resolves
      // to a discriminated EditorProjectionOutcome, never a `.code`-tagged
      // rejection (review round 2 — see electron/editor-projection.ts).
      buildEditorProjection(args: EditorProjectionHostArgs): Promise<EditorProjectionOutcome>;
      // Event subscriptions
      // M29: ExportProgressEvent used to be hand-duplicated here — it is now
      // the single shared-types.ts type (re-exported via bridge-types.ts),
      // same as every other payload type in this file.
      onBuildProgress(cb: (data: ExportProgressEvent) => void): () => void;
      onUrlPreviewBlocked(cb: (data: { url: string; reason: string }) => void): () => void;
      // writeRecovery/clearRecovery/listRecovery — the `recovery` member
      // above (SFE-P5c4: typed IPC).
      // app:setDirtyState migrated to typed IPC (SFE-P5c1) — see the `app`
      // member above.
      onFlushBeforeClose(cb: () => boolean | void | Promise<boolean | void>): () => void;
      onFolderChanged(cb: (data: { filename: string }) => void): () => void;
    };
  }
}

// This export makes the file a module (required for `import type` at top-level).
export {};
