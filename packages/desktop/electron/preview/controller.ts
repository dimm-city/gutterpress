/**
 * preview/controller.ts — the preview-open pipeline behind the `api:preview`
 * IPC channel, as an injectable, unit-testable class.
 *
 * It starts the preview server, detects the manifest title, upserts recents,
 * arms auto-sync, and emits a one-shot "connect"/"local" status for repos
 * that won't sync. Every external touch-point is INJECTED via `deps`, so
 * tests drive the serialization of overlapping `api:preview` invocations
 * (see `open()`), the recents-upsert shape, and the ordering of the
 * fire-and-forget triggers with fakes — mirrors export/controller.ts. The
 * initial sync itself is owned by AutoSyncOrchestrator.scheduleInitialSync
 * (electron/auto-sync/orchestrator.ts); this class only calls it.
 *
 * Node/lib-side ONLY — never imported by the renderer.
 */

import path from "node:path";
import { AUTO_SYNC_OPEN_DELAY_MS, type SyncStatusPayload } from "../auto-sync/orchestrator";
import { operationLogSlug } from "../recovery-paths";
import { unsyncedStateFor } from "../auto-sync/unsynced-status";
import { upsertRecentFolder } from "../recent-folders";
import type { DesktopPrefs } from "../prefs-store";
import type {
  OpenRestoreSummary,
  PreviewStartResult,
  RestoreProgressEvent,
} from "../../src/lib/platform/shared-types";
import type { TokenStore } from "gutterpress";

type LibModule = typeof import("gutterpress");
type ProjectSourceResult = Awaited<ReturnType<LibModule["detectProjectSource"]>>;

/** The handle main.ts's `activePreview` module state holds while a preview is open. */
export interface PreviewHandle {
  url: string;
  port: number;
  inputPath: string;
  stop: () => Promise<void>;
  notifySettledWrite: (filePath: string, writtenContent: string) => void;
}

export interface PreviewOpenArgs {
  input?: string;
}

/** External touch-points injected into the controller (all faked in tests). */
export interface PreviewOpenControllerDeps {
  /** Lazily load gutterpress. Cached by the caller. */
  loadLib: () => Promise<LibModule>;
  /** Drop the prior random-origin preview's HTTP cache before a new open. */
  clearPreviewAssetCache: () => Promise<void>;
  /** main.ts's single module-level `activePreview` slot. */
  getActivePreview: () => PreviewHandle | null;
  setActivePreview: (preview: PreviewHandle | null) => void;
  /** Host-owned filesystem capability, independent of preview-server success. */
  getActiveWorkspaceRoot: () => string | null;
  setActiveWorkspaceRoot: (root: string | null) => void;
  /** Host-detected enclosing repository, when the active book shares repo-level files. */
  setActiveRepositoryRoot: (root: string | null) => void;
  /** Validate that a renderer-selected workspace exists and is a directory. */
  stat: (target: string) => Promise<{ isDirectory(): boolean }>;
  /** Atomic read-modify-write over gutterpress-prefs.json (electron/prefs-store.ts). */
  updatePrefs: (mutate: (prefs: DesktopPrefs) => DesktopPrefs) => Promise<DesktopPrefs>;
  /** Credential store passed to lib.diagnoseProjectRemote. */
  tokenStore: TokenStore;
  /** userData/logs/<repoSlug>.log path builder (electron/recovery-paths.ts). */
  operationLogPath: (repoSlug: string) => string;
  /** Push "sync:status" to the live main window. */
  emitSyncStatus: (payload: SyncStatusPayload) => void;
  /** Push "preview:restoreProgress" to the live main window (the download stage of an open). */
  emitRestoreProgress: (event: RestoreProgressEvent) => void;
  /** The folder watcher's currently-tracked dir (electron/folder-watch/watcher.ts). */
  getWatchedDir: () => string | null;
  /** AutoSyncOrchestrator.armInterval — starts the periodic safety-sync timer. */
  armSyncInterval: (dir: string) => Promise<void>;
  /** AutoSyncOrchestrator.scheduleInitialSync — arms the first sync after open. */
  scheduleInitialSync: (dir: string) => void;
  /** fs.promises.mkdir — ensure the operation-log dir exists. */
  mkdir: (dir: string, options: { recursive: boolean }) => Promise<unknown>;
  /** fs.promises.appendFile — create the operation-log file if absent. */
  appendFile: (filePath: string, data: string) => Promise<void>;
  /** Node's global setTimeout (injected so tests can control the delayed re-emit). */
  setTimeout: (cb: () => void, ms: number) => { unref?: () => void };
}

export class PreviewOpenController {
  /** Serializes overlapping api:preview invocations — see open()'s doc comment. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: PreviewOpenControllerDeps) {}

  /**
   * `api:preview` entrypoint. SERIALIZED: ipcMain.handle runs overlapping
   * invocations concurrently at await points, and the start screen keeps the
   * window interactive while an open is in flight, so a second open can
   * arrive mid-flight. Unserialized, two invocations interleave around the
   * activePreview stop/start bookkeeping — orphaning a preview server (leaked
   * port + file watcher) and letting the superseded open stamp
   * lastProjectDir/recents last. Arrival order matches the renderer's
   * open-epoch order, and the renderer's epoch guard discards the superseded
   * call's response.
   */
  open(args: PreviewOpenArgs): Promise<PreviewStartResult> {
    const run = this.chain.then(() => this.runOpen(args));
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** Serialize teardown with open() so cancel cannot leave a late preview alive. */
  stop(): Promise<{ stopped: true }> {
    const run = this.chain.then(() => this.runStop());
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async runStop(): Promise<{ stopped: true }> {
    const active = this.deps.getActivePreview();
    if (active) await active.stop().catch(() => {});
    this.deps.setActivePreview(null);
    this.deps.setActiveRepositoryRoot(null);
    this.deps.setActiveWorkspaceRoot(null);
    return { stopped: true };
  }

  private async runOpen(args: PreviewOpenArgs): Promise<PreviewStartResult> {
    const input = args?.input;
    if (!input || typeof input !== "string") {
      throw new Error("Missing 'input' (absolute path to a book folder)");
    }
    if (!path.isAbsolute(input)) {
      throw new Error(`Preview input must be an absolute book folder path: ${input}`);
    }

    const openedDir = path.resolve(input);
    let info: { isDirectory(): boolean };
    try {
      info = await this.deps.stat(openedDir);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (this.deps.getActiveWorkspaceRoot() !== openedDir) await this.runStop();
      throw new Error(`Folder could not be opened: ${msg}`);
    }
    if (!info.isDirectory()) {
      if (this.deps.getActiveWorkspaceRoot() !== openedDir) await this.runStop();
      throw new Error(`Folder could not be opened: ${openedDir} is not a directory`);
    }

    // Replace the old preview, then grant the new folder capability before
    // rendering. A render failure must not revoke access to the author's files.
    const existing = this.deps.getActivePreview();
    if (existing) {
      await existing.stop().catch(() => {});
    }
    this.deps.setActivePreview(null);
    this.deps.setActiveRepositoryRoot(null);
    // Cache cleanup bounds storage used by the desktop's random preview origins,
    // but it is housekeeping: a cleanup failure must not leave a stopped handle
    // active or prevent the author from opening the next book.
    await this.deps.clearPreviewAssetCache().catch(() => {});
    this.deps.setActiveWorkspaceRoot(openedDir);

    let lib: LibModule | null = null;
    let title = path.basename(openedDir);
    let result: PreviewStartResult;
    let restored: OpenRestoreSummary | undefined;
    try {
      lib = await this.deps.loadLib();
      try {
        const { manifest } = await lib.loadManifestWithPath(openedDir);
        if (manifest.title) title = manifest.title;
      } catch {
        /* malformed/missing manifest is reported by preview generation below */
      }

      // A fresh clone has the manifest's pinned extensions but not their
      // downloaded copies: fetch them BEFORE the preview loads plugins. The
      // exact pinned version only, host-side, no prompt (the author chose it
      // when they pinned it). A failure never blocks the open — the preview
      // degrades, and the Features tab's "Needs install" row stays the way in.
      restored = await this.restoreExtensions(lib, openedDir);

      const activePreview = await lib.startPreviewServer({
        input: openedDir,
        port: 0,
        host: "127.0.0.1",
        noWatch: false,
        openBrowser: false,
        verbose: false,
        debug: false,
        installSignalHandlers: false,
      });
      this.deps.setActivePreview(activePreview);
      result = {
        previewStarted: true,
        url: activePreview.url,
        port: activePreview.port,
        input: openedDir,
        title,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const stack = e instanceof Error ? e.stack ?? "" : "";
      console.error(`[api:preview] startPreviewServer failed: input=${input}`);
      console.error(`  ${msg}`);
      if (stack) console.error(stack);
      result = {
        previewStarted: false,
        input: openedDir,
        title,
        error: msg,
      };
    }

    if (restored) result = { ...result, restoredExtensions: restored };

    // C2 (book switcher): the desktop always opens an actual book folder (never a
    // bare multi-book repo root — the renderer retargets to a resolved book
    // before calling here), so `openedDir` is the active book. Detected once and
    // reused below (recents + the local-status/initial-sync blocks).
    let source: ProjectSourceResult | null = null;
    if (lib) {
      try {
        source = await lib.detectProjectSource(openedDir);
      } catch (e) {
        console.warn("[api:preview] project source detection failed (non-fatal):", e);
      }
    }
    this.deps.setActiveRepositoryRoot(
      source?.type === "local-git-folder" ? path.resolve(source.repoRoot) : null,
    );

    await this.deps
      .updatePrefs((prefs) => ({
        ...prefs,
        lastProjectDir: openedDir,
        // A workspace counts as opened even when its preview needs repair.
        recentFolders: upsertRecentFolder(prefs.recentFolders, {
          path: source?.type === "local-git-folder" ? source.repoRoot : openedDir,
          title,
          openedAt: new Date().toISOString(),
          ...(source?.type === "local-git-folder" && source.subPath !== ""
            ? { lastActiveBook: openedDir }
            : {}),
        }),
      }))
      .catch((e) => console.warn("[api:preview] failed to persist opened workspace:", e));

    // §4.2 project-open trigger. Start the periodic safety-sync interval now
    // (idempotent) so incoming changes pull even in a view-only session with no
    // edits — it must NOT wait for the first file change. Then do a PROMPT
    // initial pull a few seconds after open (not coupled to the 10-min snapshot
    // debounce, which would hide teammate changes for ~10.5 min). syncProject
    // snapshots-first, so a prompt run is safe.
    if (source) void this.deps.armSyncInterval(openedDir);

    // Local-git projects the auto-sync engine won't sync still need an ambient
    // status (the pill would otherwise stay blank): "connect" when an HTTPS
    // remote merely lacks a Gutterpress credential (the renderer offers a Connect
    // action), or "local" when there is no usable remote (version history
    // only). Isolated from the initial-sync flow below; canSync projects get
    // their status from AutoSyncOrchestrator.run and ignore this branch.
    if (lib && source) void this.emitLocalStatusIfUnsynced(lib, openedDir, source);

    // Arm the initial sync for a classified project — see
    // AutoSyncOrchestrator.scheduleInitialSync (electron/auto-sync/orchestrator.ts).
    if (source) this.deps.scheduleInitialSync(openedDir);

    return result;
  }

  /**
   * Download this book's missing pinned extensions (`lib.restorePinnedExtensions`:
   * one run per book at a time, so an open racing a build shares one download;
   * no network when nothing is missing). Returns what it did, or undefined when
   * it did nothing. Never throws.
   */
  private async restoreExtensions(
    lib: LibModule,
    openedDir: string,
  ): Promise<OpenRestoreSummary | undefined> {
    // Forward each step to the window so the open's wait is explained as it
    // happens. A throwing sink must never break the download itself.
    let started = false;
    let ended = false;
    const forward = (event: RestoreProgressEvent) => {
      if (event.type === "start") started = true;
      if (event.type === "end") ended = true;
      try {
        this.deps.emitRestoreProgress(event);
      } catch (e) {
        console.warn("[api:preview] restore progress could not be delivered:", e);
      }
    };
    try {
      const { installed, failed } = await lib.restorePinnedExtensions(openedDir, { onProgress: forward });
      if (installed.length === 0 && failed.length === 0) return undefined;
      for (const use of installed) console.log(`[api:preview] downloaded pinned extension ${use}`);
      for (const f of failed) console.warn(`[api:preview] could not download ${f.use}: ${f.message}`);
      return { installed, failed: failed.map(({ use, message }) => ({ use, message })) };
    } catch (e) {
      console.warn("[api:preview] restoring pinned extensions failed (non-fatal):", e);
      // A started download that died without its `end` would leave the
      // indicator on "Downloading…" for the rest of the open.
      if (started && !ended) forward({ type: "end", installed: [], failed: [] });
      return undefined;
    }
  }

  private async emitLocalStatusIfUnsynced(
    lib: LibModule,
    openedDir: string,
    source: ProjectSourceResult,
  ): Promise<void> {
    try {
      if (source.type !== "local-git-folder") return;
      const diag = await lib.diagnoseProjectRemote(openedDir, {
        tokenStore: this.deps.tokenStore,
      });
      if (diag.canSync) return; // sync flow owns the status for syncable repos
      // Keyed to the REPO (see recovery-paths.ts's operationLogSlug): the log
      // records whole-repository operations, so a monorepo's books share one.
      const logFile = this.deps.operationLogPath(
        operationLogSlug(lib.repoRootForSource(source, openedDir)),
      );
      // Ensure the log file exists (empty) so the desktop's log dialog shows the
      // intended "No log entries recorded." empty state rather than "The log
      // file could not be found." when no snapshot has been taken yet. appendFile
      // with "" creates the file if absent and never truncates an existing one.
      try {
        await this.deps.mkdir(path.dirname(logFile), { recursive: true });
        await this.deps.appendFile(logFile, "");
      } catch {
        // Non-fatal: the dialog falls back to its not-found message.
      }
      const localStatus: SyncStatusPayload = {
        // "connect" for an HTTPS remote Gutterpress just isn't connected to (one
        // step from syncing — the renderer offers a Connect action); "local"
        // only when there is genuinely no usable remote (none / SSH-only).
        state: unsyncedStateFor(diag),
        projectDir: openedDir,
        lastSyncAt: null,
        logFile,
      };
      // "sync:status" is a fire-and-forget event with no replay, so an emit that
      // beats the renderer's pill subscription is lost. Emit now (fast-mounted
      // renderers) AND re-emit after the same open delay the canSync path relies
      // on, by which point the pill has subscribed. Guarded by the watched dir so
      // a project switch before the delay cancels the stale re-emit.
      this.deps.emitSyncStatus(localStatus);
      const t = this.deps.setTimeout(() => {
        if (this.deps.getWatchedDir() === openedDir) this.deps.emitSyncStatus(localStatus);
      }, AUTO_SYNC_OPEN_DELAY_MS);
      t.unref?.();
    } catch {
      // Non-fatal: the pill simply stays hidden if detection/diagnosis fails.
    }
  }
}
