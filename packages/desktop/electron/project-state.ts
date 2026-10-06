// ──────────────────────────────────────────────────────────────────────────
// project-state.ts — pure transforms for PER-PROJECT editor state (#43).
//
// Editor state (current page, split-pane ratio) is keyed by the project
// folder so opening project B never overwrites project A's state.
// These transforms operate on the `projectStates` map stored in
// gutterpress-prefs.json. They are intentionally side-effect-free (no electron,
// no filesystem) so main.ts reuses its readPrefs()/writePrefs() helpers AND so
// the logic is unit-testable in isolation (mirrors recent-folders.ts).
//
// Add a field here only when a real feature is about to read it — fields
// nothing reads back just round-trip through JSON as dead schema (#30).
// ──────────────────────────────────────────────────────────────────────────

/**
 * State persisted for a single project, keyed by its folder path.
 *
 * View mode is deliberately not stored anywhere: it is derived from the
 * workspace mode, so nothing has a snapshot to restore.
 */
export interface ProjectState {
  /** Current preview page (1-based). */
  currentPage?: number;
  /** Split-pane size ratio (0..1). */
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
