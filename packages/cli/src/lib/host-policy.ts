/**
 * Host-timer POLICY (pure) extracted from the source-provider abstraction.
 *
 * These helpers are the testable core of the desktop host's automatic-snapshot
 * and automatic-sync timers: they turn a persisted, possibly-partial user
 * settings object into a concrete debounce/cadence delay (ms) — or `null` when
 * the feature is switched off. The timers themselves live in the Electron main
 * process (CLAUDE.md §8); this module owns ONLY the clamping/default policy so
 * both the CLI and the desktop resolve delays identically.
 *
 * Nothing here touches Git, the filesystem, or `isomorphic-git` — it is the
 * host-facing cadence policy, deliberately separate from `source-provider.ts`'s
 * SourceProvider operations.
 */

// ── Automatic snapshots (RC1-3) ───────────────────────────────────────────────

/** User-facing auto-snapshot policy (mirrors the desktop's settings group). */
export interface AutoSnapshotPolicy {
  /** Master switch — automatic snapshots default ON. */
  autoSnapshot: boolean;
  /** Minutes of quiet after the last edit before a snapshot fires. */
  autoSnapshotMinutes: number;
}

/** Cadence bounds: never below 5 minutes (commit-per-keystroke guard), never
 * above a day (a longer value means the user effectively wants it off). */
export const AUTO_SNAPSHOT_MIN_MINUTES = 5;
export const AUTO_SNAPSHOT_MAX_MINUTES = 24 * 60;
export const AUTO_SNAPSHOT_DEFAULT_MINUTES = 10;

// ── Automatic sync (transparent-sync integration plan §4.3) ──────────────────

/** User-facing auto-sync policy (mirrors the desktop's settings group). */
export interface AutoSyncPolicy {
  /** Master switch — automatic sync defaults ON when a remote is configured. */
  autoSync: boolean;
  /** Periodic safety cadence in minutes (clamped, like the snapshot cadence). */
  autoSyncMinutes: number;
}

/**
 * Cadence bounds for the periodic safety sync. The floor (1 min) is lower than
 * the snapshot floor because a network round-trip is cheaper than a full tree
 * walk, and the transparent-sync plan targets ~2 min as the default cadence.
 * The ceiling matches the snapshot ceiling (one day = effectively paused).
 */
export const AUTO_SYNC_MIN_MINUTES = 1;
export const AUTO_SYNC_MAX_MINUTES = 24 * 60;
export const AUTO_SYNC_DEFAULT_MINUTES = 2;

/**
 * Minutes between PUSH-enabled auto-sync passes (owner decision 2026-08-23).
 * Every ~2-minute tick still PULLS — a collaborator's work keeps arriving
 * promptly — but only a tick whose push window has elapsed also pushes, and
 * the desktop pushes once more on project close/app exit. This is what keeps
 * an actively-typing author from minting a snapshot-and-push every 2 minutes
 * (the "commit wall"): between push windows, ticks with an unmoved remote
 * commit nothing at all. Deliberately a constant, NOT a settings knob — the
 * sync cadence is hidden policy, same as the tick interval's default.
 */
export const AUTO_SYNC_PUSH_INTERVAL_MINUTES = 15;

/** Clamping/default bounds for a cadence policy (see {@link clampedDelayMs}). */
interface DelayBounds {
  /** Floor in minutes — a smaller configured value is raised to this. */
  min: number;
  /** Ceiling in minutes — a larger configured value is lowered to this. */
  max: number;
  /** Minutes used when the configured value is missing/non-finite/≤0. */
  default: number;
  /** Whether the feature counts as enabled when the master switch is absent. */
  enabledDefault: boolean;
}

/**
 * Shared clamped-delay policy for the host's cadence timers: resolve the delay
 * (ms) from an optional master switch + optional minutes, or `null` when the
 * feature is disabled. Defensive about persisted settings — a missing switch
 * uses `bounds.enabledDefault`; a non-finite/absurd minutes value falls back to
 * `bounds.default` and is then clamped into `[bounds.min, bounds.max]`.
 */
function clampedDelayMs(
  enabled: boolean | undefined,
  minutes: number | undefined,
  bounds: DelayBounds,
): number | null {
  const isEnabled = enabled ?? bounds.enabledDefault;
  if (!isEnabled) return null;
  const resolved =
    typeof minutes === "number" && Number.isFinite(minutes) && minutes > 0
      ? minutes
      : bounds.default;
  const clamped = Math.min(bounds.max, Math.max(bounds.min, resolved));
  return clamped * 60_000;
}

const AUTO_SNAPSHOT_BOUNDS: DelayBounds = {
  min: AUTO_SNAPSHOT_MIN_MINUTES,
  max: AUTO_SNAPSHOT_MAX_MINUTES,
  default: AUTO_SNAPSHOT_DEFAULT_MINUTES,
  enabledDefault: true,
};

const AUTO_SYNC_BOUNDS: DelayBounds = {
  min: AUTO_SYNC_MIN_MINUTES,
  max: AUTO_SYNC_MAX_MINUTES,
  default: AUTO_SYNC_DEFAULT_MINUTES,
  enabledDefault: true,
};

/**
 * Resolve the debounce delay (ms) for the host's auto-snapshot timer, or
 * `null` when automatic snapshots are disabled. Pure — the testable core of
 * the trigger policy (the timer itself lives in the Electron main process).
 *
 * Defensive about persisted settings: a missing policy means "defaults"
 * (enabled, 10 min); a non-finite/absurd minutes value falls back to the
 * default and is then clamped into [5, 1440].
 */
export function autoSnapshotDelayMs(
  policy: Partial<AutoSnapshotPolicy> | undefined,
): number | null {
  return clampedDelayMs(policy?.autoSnapshot, policy?.autoSnapshotMinutes, AUTO_SNAPSHOT_BOUNDS);
}

/**
 * Resolve the periodic-safety-sync interval (ms) for the host's auto-sync
 * orchestrator, or `null` when auto-sync is disabled. Pure — the testable core
 * of the trigger policy (the timer and the actual `syncProject` call live in
 * the Electron main process, per CLAUDE.md §8).
 *
 * Modelled exactly on `autoSnapshotDelayMs`: a missing or partial policy means
 * "defaults" (enabled, 2 min); a non-finite/absurd minutes value falls back to
 * the default and is then clamped into [AUTO_SYNC_MIN_MINUTES,
 * AUTO_SYNC_MAX_MINUTES].
 *
 * Note: this is the host orchestrator's ONLY sync trigger — the file-change
 * debounce that used to sit beside it was removed (it could never fire before
 * this interval already had).
 */
export function autoSyncDelayMs(
  policy: Partial<AutoSyncPolicy> | undefined,
): number | null {
  return clampedDelayMs(policy?.autoSync, policy?.autoSyncMinutes, AUTO_SYNC_BOUNDS);
}

/**
 * True when a changed path is internal Git state (any `.git` segment). The
 * host's project watcher and auto-snapshot triggers must IGNORE these: the
 * automatic snapshot itself writes under `.git`, and treating that as a
 * content change would re-trigger preview reloads / re-arm the timer forever.
 * Accepts absolute paths, relative paths, or bare basenames.
 */
export function isGitInternalPath(p: string): boolean {
  return p.split(/[\\/]+/).some((segment) => segment === ".git");
}
