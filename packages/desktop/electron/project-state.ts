// ──────────────────────────────────────────────────────────────────────────
// project-state.ts — pure transforms for PER-PROJECT editor state (#43).
//
// Editor state (current page, view mode, split-pane ratio) is keyed by the
// project folder so opening project B never overwrites project A's state.
// These transforms operate on the `projectStates` map stored in
// gutterpress-prefs.json. They are intentionally side-effect-free (no electron,
// no filesystem) so main.ts reuses its readPrefs()/writePrefs() helpers AND so
// the logic is unit-testable in isolation (mirrors recent-folders.ts).
//
// #30: `lastChapter`/`sidebarOpen`/`cursorLine`/`editorScroll` were removed —
// they were speculative dead schema for an in-app editor (#38) and chapter
// list (#42) that never landed a consumer for them; they round-tripped
// through JSON but nothing ever read them back. Re-add a field here only when
// a real feature is about to read it.
// ──────────────────────────────────────────────────────────────────────────

/**
 * State persisted for a single project, keyed by its folder path.
 *
 * `viewMode` here is a per-project SNAPSHOT, not the live value the UI reads:
 * `AppSettings.preview.viewMode` (settings-store.ts) is the durable default
 * the UI reads/writes at all times; this snapshot is applied ONLY when a
 * project is opened, overriding the durable value with that project's
 * last-used mode (see `ZoomViewController.applyViewMode`'s doc comment in the
 * SPA, and `+page.svelte`'s restore-on-open flow). AppSettings wins
 * everywhere else — this is the full resolution of the old "viewMode exists
 * in three places" fragmentation (#30); the third place (a legacy top-level
 * `viewMode` in DesktopPrefs, prefs-store.ts) has been deleted outright.
 */
export interface ProjectState {
  /** Current preview page (1-based). */
  currentPage?: number;
  /** Per-project preview view mode snapshot — see the interface doc above. */
  viewMode?: "single" | "two-column";
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

// `migrateLegacyProjectState` (the one-time pre-#43 top-level
// currentPage/viewMode → projectStates[dir] seeding) is deleted (#30): the
// release that carried the migration fallback has shipped, and
// `DesktopPrefs` no longer has top-level `currentPage`/`viewMode` fields to
// migrate from (prefs-store.ts).
