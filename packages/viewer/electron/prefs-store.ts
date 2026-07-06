// ──────────────────────────────────────────────────────────────────────────
// Viewer prefs (viewer-prefs.json) — session/per-project state persisted
// separately from durable user settings (app-settings.json, ./settings-store).
// Holds the last open project, sidebar/panel state, recent/favorite folders,
// per-project editor/preview state, and the legacy top-level page/mode fields
// kept ONE version as a migration fallback (#43).
//
// Phase 5b: extracted (behavior-identical) from electron/main.ts. The
// ViewerPrefs shape + the prefsPath/readPrefs/writePrefs/existingDirectory
// read/write path live here behind an injected-fs store factory so they can be
// unit-tested with fakes (tests/platform/prefs-store). main.ts instantiates the
// store with the live Electron userData dir + node:fs/promises and the imported
// migrateLegacyProjectState, and uses the returned closures unchanged.
// ──────────────────────────────────────────────────────────────────────────

import path from "node:path";
import type { ProjectStateMap } from "./project-state";
import type { RecentFolder, FavoriteFolder } from "./recent-folders";
import type { ProjectSource } from "@dimm-city/print-md";

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

export interface PrefsStoreDeps {
  getUserDataDir(): string;
  fs: {
    readFile(p: string, enc: BufferEncoding): Promise<string>;
    writeFile(p: string, data: string, enc: BufferEncoding): Promise<void>;
    mkdir(p: string, opts: unknown): Promise<unknown>;
    stat(p: string): Promise<{ isDirectory(): boolean }>;
  };
  migrateLegacyProjectState: (
    prefs: ViewerPrefs,
  ) => ProjectStateMap | null | undefined;
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
    try {
      const prefs = JSON.parse(
        await deps.fs.readFile(prefsPath(), "utf8"),
      ) as ViewerPrefs;
      // #43 one-time migration: seed projectStates from the legacy top-level
      // currentPage/viewMode so existing users don't lose their saved state.
      const migrated = deps.migrateLegacyProjectState(prefs);
      if (migrated && !prefs.projectStates) {
        prefs.projectStates = migrated;
      }
      return prefs;
    } catch {
      return {};
    }
  }

  async function writeNow(prefs: ViewerPrefs): Promise<void> {
    await deps.fs.mkdir(deps.getUserDataDir(), { recursive: true });
    await deps.fs.writeFile(prefsPath(), JSON.stringify(prefs, null, 2), "utf8");
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
