// ──────────────────────────────────────────────────────────────────────────
// project-state.ts — pure transforms for PER-PROJECT editor state (#43).
//
// Editor state (open chapter, current page, view mode, scroll, cursor, etc.)
// must be keyed by the project folder so opening project B never overwrites
// project A's state. These transforms operate on the `projectStates` map stored
// in viewer-prefs.json. They are intentionally side-effect-free (no electron,
// no filesystem) so main.ts reuses its readPrefs()/writePrefs() helpers AND so
// the logic is unit-testable in isolation (mirrors recent-folders.ts).
// ──────────────────────────────────────────────────────────────────────────

/**
 * State persisted for a single project, keyed by its folder path.
 *
 * `currentPage` and `viewMode` are live today. The remaining fields are written
 * by the forthcoming in-app editor (#38) and chapter list (#42) — they are
 * carried through JSON as dead schema now so #38 can call setViewerProjectState
 * with them without further main.ts changes.
 */
export interface ProjectState {
  /** Current preview page (1-based). */
  currentPage?: number;
  /** Per-project preview view mode. */
  viewMode?: "single" | "two-column";
  /** Last-open chapter file path (absolute). Consumer lands with #38. */
  lastChapter?: string;
  /** Sidebar open/collapsed state. Consumer lands with #42. */
  sidebarOpen?: boolean;
  /** Editor cursor line (1-based). Consumer lands with #38. */
  cursorLine?: number;
  /** Editor scroll offset (px). Consumer lands with #38. */
  editorScroll?: number;
  /** Split-pane size ratio (0..1). Consumer lands with #38. */
  splitPaneRatio?: number;
}

/** The per-project state map: `{ [folderPath]: ProjectState }`. */
export type ProjectStateMap = Record<string, ProjectState>;

function setProjectStateField<K extends keyof ProjectState>(
  state: ProjectState,
  key: K,
  value: ProjectState[K],
): void {
  state[key] = value;
}

/**
 * Read a project's state bucket. Returns `null` when absent (so callers fall
 * back to first-page / defaults). Corrupt input is the caller's concern — this
 * is a pure lookup over an already-parsed map.
 */
export function readProjectState(
  states: ProjectStateMap | undefined,
  projectDir: string,
): ProjectState | null {
  if (!states || typeof states !== "object") return null;
  const entry = states[projectDir];
  return entry && typeof entry === "object" ? entry : null;
}

/**
 * Merge-patch a project's state bucket, returning a NEW map (upserting the key).
 * `undefined` patch values are ignored so a partial patch never clears a field.
 */
export function writeProjectState(
  states: ProjectStateMap | undefined,
  projectDir: string,
  patch: Partial<ProjectState>,
): ProjectStateMap {
  const current = readProjectState(states, projectDir) ?? {};
  const merged: ProjectState = { ...current };
  for (const key of Object.keys(patch) as Array<keyof ProjectState>) {
    const value = patch[key];
    if (value !== undefined) {
      setProjectStateField(merged, key, value);
    }
  }
  return { ...(states ?? {}), [projectDir]: merged };
}

/**
 * One-time migration: pre-#43 viewer-prefs.json stored a single global
 * `currentPage` / `viewMode` at the top level (overwritten by whichever project
 * was opened last). When `projectStates` is absent but a `lastProjectDir` and a
 * top-level page/mode exist, seed that project's bucket so existing users don't
 * lose their saved state on first upgrade. Returns the new map (or `undefined`
 * when there is nothing to migrate, leaving prefs untouched).
 */
export function migrateLegacyProjectState(prefs: {
  lastProjectDir?: string | null;
  currentPage?: number;
  viewMode?: "single" | "two-column";
  projectStates?: ProjectStateMap;
}): ProjectStateMap | undefined {
  if (prefs.projectStates) return prefs.projectStates;
  const dir = prefs.lastProjectDir;
  if (!dir) return undefined;
  if (prefs.currentPage === undefined && prefs.viewMode === undefined) {
    return undefined;
  }
  const seeded: ProjectState = {};
  if (prefs.currentPage !== undefined) seeded.currentPage = prefs.currentPage;
  if (prefs.viewMode !== undefined) seeded.viewMode = prefs.viewMode;
  return { [dir]: seeded };
}
