// ──────────────────────────────────────────────────────────────────────────
// Viewer prefs (viewer-prefs.json) — session/per-project state persisted
// separately from durable user settings (app-settings.json, ./settings-store).
// Holds the last open project, sidebar/panel state, recent/favorite folders,
// and per-project editor/preview state.
//
// #30: the pre-#43 top-level `currentPage`/`viewMode` migration-fallback
// fields (and their `migrateLegacyProjectState` seeding logic) are removed —
// the one release that carried the fallback has shipped, so every active
// user's `projectStates` bucket is already populated from ordinary use.
// `ProjectState.viewMode` (project-state.ts) and `AppSettings.preview.viewMode`
// (settings-store.ts) are the two remaining, INTENTIONALLY distinct homes:
// AppSettings is the durable value the UI reads/writes at all times;
// ProjectState is a per-project snapshot applied only when a project opens,
// to override the durable value with that project's last-used mode. See the
// doc comment on `ProjectState` (shared-types.ts) for the full resolution.
//
// Phase 5b: extracted (behavior-identical) from electron/main.ts. The
// ViewerPrefs shape + the prefsPath/readPrefs/writePrefs/existingDirectory
// read/write path live here behind an injected-fs store factory so they can be
// unit-tested with fakes (tests/platform/prefs-store). main.ts instantiates the
// store with the live Electron userData dir + node:fs/promises. Writes are
// atomic (write `<file>.tmp` then rename) and a parse failure preserves the
// corrupt file as `<file>.corrupt-<ts>` instead of silently discarding
// recents/favorites/per-project state (#34).
// ──────────────────────────────────────────────────────────────────────────

import path from "node:path";
import type { ProjectStateMap } from "./project-state";
import type { RecentFolder, FavoriteFolder } from "./recent-folders";
import type { ProjectSource } from "@dimm-city/print-md";
import type { LastFlushFailure } from "./bridge-types";

export interface ViewerPrefs {
  lastProjectDir?: string;
  /**
   * Show the start screen (welcome landing) at launch. Default true; when
   * false the app opens straight into the last book behind the splash (the
   * pre-landing behavior). Toggled from the start screen's own checkbox.
   */
  showLandingAtStartup?: boolean;
  /** Chapter-list sidebar open/closed, persisted across sessions (#42). */
  sidebarOpen?: boolean;
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
  /** Most recent editor-buffer flush that could not be confirmed on disk. */
  lastFlushFailed?: LastFlushFailure;
}

export interface PrefsStoreDeps {
  getUserDataDir(): string;
  fs: {
    readFile(p: string, enc: BufferEncoding): Promise<string>;
    writeFile(p: string, data: string, enc: BufferEncoding): Promise<void>;
    mkdir(p: string, opts: unknown): Promise<unknown>;
    stat(p: string): Promise<{ isDirectory(): boolean }>;
    /** Used for the atomic `<file>.tmp` → `<file>` write and to preserve a
     * corrupt file as `<file>.corrupt-<ts>` instead of discarding it (#34). */
    rename(oldPath: string, newPath: string): Promise<void>;
  };
}

export function createPrefsStore(deps: PrefsStoreDeps): {
  readPrefs(): Promise<ViewerPrefs>;
  writePrefs(p: ViewerPrefs): Promise<void>;
  updatePrefs(mutate: (prefs: ViewerPrefs) => ViewerPrefs): Promise<ViewerPrefs>;
  prefsPath(): string;
  existingDirectory(dir: string | undefined): Promise<string | null>;
} {
  function prefsPath(): string {
    return path.join(deps.getUserDataDir(), "viewer-prefs.json");
  }

  async function readPrefs(): Promise<ViewerPrefs> {
    let raw: string;
    try {
      raw = await deps.fs.readFile(prefsPath(), "utf8");
    } catch {
      // No readable file yet (first run, or removed) — nothing to preserve.
      return {};
    }
    try {
      return JSON.parse(raw) as ViewerPrefs;
    } catch (err) {
      // The file exists but isn't valid JSON. Preserve it instead of
      // silently resetting to {} — that used to discard recents, favorites,
      // per-project state, and the last-open-project pointer (#34).
      await preserveCorruptFile(prefsPath(), err).catch(() => {});
      return {};
    }
  }

  async function preserveCorruptFile(target: string, err: unknown): Promise<void> {
    const corruptPath = `${target}.corrupt-${Date.now()}`;
    try {
      await deps.fs.rename(target, corruptPath);
      console.warn(
        `[prefs-store] ${target} contained invalid JSON; preserved as ${corruptPath} instead of being discarded.`,
        err,
      );
    } catch (renameErr) {
      console.warn(
        `[prefs-store] ${target} contained invalid JSON but could not be preserved (rename failed):`,
        renameErr,
      );
    }
  }

  async function writeNow(prefs: ViewerPrefs): Promise<void> {
    await deps.fs.mkdir(deps.getUserDataDir(), { recursive: true });
    const target = prefsPath();
    const tmp = `${target}.tmp`;
    // Atomic write (#34): see settings-store.ts's writeSettings for the same
    // pattern and rationale (write-then-rename so a crash mid-write can't
    // truncate the real file).
    await deps.fs.writeFile(tmp, JSON.stringify(prefs, null, 2), "utf8");
    await deps.fs.rename(tmp, target);
  }

  // All mutations are serialized on one chain. Several writers share this
  // file concurrently (the api:preview open flow in main, and the app/*
  // server routes the renderer calls — including the start screen's
  // "show at startup" toggle firing exactly while the startup open runs),
  // and each does a read-modify-write; without serialization the last
  // writer silently reverts the other's change.
  let chain: Promise<unknown> = Promise.resolve();
  function enqueue<T>(op: () => Promise<T>): Promise<T> {
    const run = chain.then(op);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function writePrefs(prefs: ViewerPrefs): Promise<void> {
    return enqueue(() => writeNow(prefs));
  }

  /**
   * Atomic read-modify-write: the read and the write happen inside one queue
   * slot, so concurrent updates compose instead of clobbering each other.
   * Prefer this over readPrefs()+writePrefs() for any patch-style mutation.
   */
  function updatePrefs(
    mutate: (prefs: ViewerPrefs) => ViewerPrefs,
  ): Promise<ViewerPrefs> {
    return enqueue(async () => {
      const next = mutate(await readPrefs());
      await writeNow(next);
      return next;
    });
  }

  async function existingDirectory(
    dir: string | undefined,
  ): Promise<string | null> {
    if (!dir) return null;
    try {
      return (await deps.fs.stat(dir)).isDirectory() ? dir : null;
    } catch {
      return null;
    }
  }

  return { readPrefs, writePrefs, updatePrefs, prefsPath, existingDirectory };
}
