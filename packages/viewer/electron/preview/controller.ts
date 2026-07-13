/**
 * preview/controller.ts — the preview-open pipeline behind the `api:preview`
 * IPC channel, extracted from electron/main.ts as an injectable,
 * unit-testable class (ARCH review finding #6).
 *
 * WHY THIS EXISTS
 * ---------------
 * `api:preview` used to be a ~300-line god-handler in main.ts (start the
 * preview server, detect the manifest title, upsert recents, arm auto-sync,
 * write the app-open heartbeat, emit a one-shot "local" status for
 * remote-less repos, and kick off preflight recovery) closing over module
 * globals. That made the recents/heartbeat/local-status ordering impossible
 * to unit-test without a full Electron + lib + network stack. This class owns
 * the exact same control flow, but every external touch-point is INJECTED via
 * `deps`, so tests drive it with fakes — mirrors export/controller.ts.
 *
 * The behavior is a faithful move of the original main.ts code: the
 * serialization of overlapping `api:preview` invocations (see `open()`), the
 * recents-upsert shape, the heartbeat/local-status/preflight fire-and-forget
 * triggers, and their relative order are preserved verbatim. Preflight repo
 * recovery itself is NOT reimplemented here — it is owned end-to-end by
 * AutoSyncOrchestrator.runPreflight (electron/auto-sync/orchestrator.ts,
 * finding #7); this class only calls it.
 *
 * Node/lib-side ONLY — never imported by the renderer.
 */

import path from "node:path";
import { AUTO_SYNC_OPEN_DELAY_MS, type SyncStatusPayload } from "../auto-sync/orchestrator";
import { unsyncedStateFor } from "../auto-sync/unsynced-status";
import { upsertRecentFolder } from "../recent-folders";
import type { ViewerPrefs } from "../prefs-store";
import type { TokenStore } from "@dimm-city/print-md";

type LibModule = typeof import("@dimm-city/print-md");
type ProjectSourceResult = Awaited<ReturnType<LibModule["detectProjectSource"]>>;

/** The handle main.ts's `activePreview` module state holds while a preview is open. */
export interface PreviewHandle {
  url: string;
  port: number;
  inputPath: string;
  missingSharedAssets?: string[];
  stop: () => Promise<void>;
}

export interface PreviewOpenArgs {
  input?: string;
}

export interface PreviewOpenResult {
  url: string;
  port: number;
  input: string;
  title: string;
  missingSharedAssets: string[];
}

/** External touch-points injected into the controller (all faked in tests). */
export interface PreviewOpenControllerDeps {
  /** Lazily load @dimm-city/print-md. Cached by the caller. */
  loadLib: () => Promise<LibModule>;
  /** main.ts's single module-level `activePreview` slot. */
  getActivePreview: () => PreviewHandle | null;
  setActivePreview: (preview: PreviewHandle | null) => void;
  /** Atomic read-modify-write over viewer-prefs.json (electron/prefs-store.ts). */
  updatePrefs: (mutate: (prefs: ViewerPrefs) => ViewerPrefs) => Promise<ViewerPrefs>;
  /** Credential store passed to lib.diagnoseProjectRemote. */
  tokenStore: TokenStore;
  /** userData/logs/<repoSlug>.log path builder (electron/recovery-paths.ts). */
  operationLogPath: (repoSlug: string) => string;
  /** Push "sync:status" to the live main window. */
  emitSyncStatus: (payload: SyncStatusPayload) => void;
  /** The folder watcher's currently-tracked dir (electron/folder-watch/watcher.ts). */
  getWatchedDir: () => string | null;
  /** AutoSyncOrchestrator.armInterval — starts the periodic safety-sync timer. */
  armSyncInterval: (dir: string) => Promise<void>;
  /** AutoSyncOrchestrator.runPreflight — owns the whole recovery flow (finding #7). */
  runSyncPreflight: (dir: string, source: ProjectSourceResult) => Promise<void>;
  /** App-open heartbeat refresh (repair-vs-viewer detection, M2). */
  refreshAppHeartbeat: (dir: string) => Promise<void>;
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
  open(args: PreviewOpenArgs): Promise<PreviewOpenResult> {
    const run = this.chain.then(() => this.runOpen(args));
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async runOpen(args: PreviewOpenArgs): Promise<PreviewOpenResult> {
    const input = args?.input;
    if (!input || typeof input !== "string") {
      throw new Error("Missing 'input' (absolute path to a project directory)");
    }

    const lib = await this.deps.loadLib();

    // Replace any existing preview before starting a new one.
    const existing = this.deps.getActivePreview();
    if (existing) {
      await existing.stop().catch(() => {});
      this.deps.setActivePreview(null);
    }

    let activePreview: PreviewHandle;
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
      this.deps.setActivePreview(activePreview);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const stack = e instanceof Error ? e.stack ?? "" : "";
      console.error(`[api:preview] startPreviewServer failed: input=${input}`);
      console.error(`  ${msg}`);
      if (stack) console.error(stack);
      throw new Error(`Preview server failed to start: ${msg}`);
    }

    let title: string = path.basename(input);
    try {
      const { manifest } = await lib.loadManifestWithPath(input);
      if (manifest.title) title = manifest.title;
    } catch {
      /* not a manifest project — keep dir basename */
    }

    // Normalize so the map key and watchedDir comparison use the same canonical form.
    const openedDir = path.resolve(activePreview.inputPath);
    // C2 (book switcher): the viewer always opens an actual book folder (never a
    // bare multi-book repo root — the renderer retargets to a resolved book
    // before calling here), so `openedDir` is the active book. Detected once and
    // reused below (recents + the local-status/preflight blocks) instead of each
    // re-deriving it.
    const source = await lib.detectProjectSource(openedDir);

    await this.deps.updatePrefs((prefs) => ({
      ...prefs,
      lastProjectDir: openedDir,
      // Single source of truth for recents: every successful preview start
      // (modal, toolbar, or auto-reopen) upserts the folder here. Repo-backed
      // projects are "a project is its git repo" (CLAUDE.md) — the entry keys on
      // the repo root, with `lastActiveBook` remembering which book was open so
      // reopening restores it instead of falling back to the alphabetically
      // first book. updatePrefs is an atomic read-modify-write, so this can't
      // clobber a concurrent prefs patch (e.g. the start screen's toggle).
      recentFolders: upsertRecentFolder(prefs.recentFolders, {
        path: source.type === "local-git-folder" ? source.repoRoot : openedDir,
        title,
        openedAt: new Date().toISOString(),
        ...(source.type === "local-git-folder" && source.subPath !== ""
          ? { lastActiveBook: openedDir }
          : {}),
      }),
    }));

    // Trigger auto-sync once after the first auto-snapshot has had time to settle
    // (§4.2 project-open trigger). The snapshot debounce fires after N minutes of
    // quiet, so we wait for the snapshot delay + the extra sync gap before the
    // initial sync. If no edits have happened the project may already be clean, and
    // syncProject will return "up-to-date" quickly — still worth running once on
    // open to pull any teammate changes that arrived since last session.
    // Start the periodic safety-sync interval now (idempotent) so incoming changes
    // pull even in a view-only session with no edits — it must NOT wait for the
    // first file change. Then do a PROMPT initial pull a few seconds after open
    // (not coupled to the 10-min snapshot debounce — that delayed it ~10.5 min and
    // hid teammate changes). syncProject snapshots-first, so a prompt run is safe.
    void this.deps.armSyncInterval(openedDir);

    // App-open heartbeat (repair-vs-viewer detection, M2): write immediately so
    // a `print-md repair` run right after open already sees a fresh marker —
    // don't wait for the first periodic tick (up to autoSyncMinutes later).
    // Reuses the injected refreshAppHeartbeat (not a second inline write) so the
    // TTL stamped here always matches the one the periodic refresh stamps.
    if (source.type === "local-git-folder") {
      void this.deps.refreshAppHeartbeat(openedDir);
    }

    // Local-git projects the auto-sync engine won't sync still need an ambient
    // status (the pill would otherwise stay blank): "connect" when an HTTPS
    // remote merely lacks a print-md credential (the renderer offers a Connect
    // action), or "local" when there is no usable remote (version history
    // only). Isolated from the sync/recovery flow below; canSync projects get
    // their status from runAutoSync and ignore this branch.
    void this.emitLocalStatusIfUnsynced(lib, openedDir, source);

    // Preflight recovery: before the initial sync, inspect the repo for structural
    // conditions (stale lock, interrupted merge, detached head, missing git dir)
    // and route through recover() BEFORE the first auto-sync run if needed, so the
    // author sees a transparent repair on open rather than a sync error. The whole
    // flow (single-flight lock, recovery routing, conflict-latch, and the BUG-3
    // runAgain decision) is owned by the orchestrator — see
    // AutoSyncOrchestrator.runPreflight (electron/auto-sync/orchestrator.ts).
    void this.deps.runSyncPreflight(openedDir, source);

    return {
      url: activePreview.url,
      port: activePreview.port,
      input: activePreview.inputPath,
      title,
      missingSharedAssets: activePreview.missingSharedAssets ?? [],
    };
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
      const logFile = this.deps.operationLogPath(path.basename(openedDir));
      // Ensure the log file exists (empty) so the viewer's log dialog shows the
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
        // "connect" for an HTTPS remote print-md just isn't connected to (one
        // step from syncing — the renderer offers a Connect action); "local"
        // only when there is genuinely no usable remote (none / SSH-only).
        // Collapsing both into "local" made a connectable repo read as "kept
        // on this computer" — reported in the field as a remote-detection bug.
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
