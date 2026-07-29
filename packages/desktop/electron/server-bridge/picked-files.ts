/**
 * One-time "picked path" capability (P1 review on `media:importImage` and
 * `fs:copyFile`; extended for finding #4 of the 2026-07-13 maintainer review
 * to cover `api:build`'s PDF `out` path).
 *
 * `media:importImage` and `fs:copyFile` accept a `src` path that is
 * DELIBERATELY allowed to point anywhere on disk — the whole point is
 * copying a file the author picked from outside the project INTO it. Before
 * this module, the only thing standing behind that was a docstring claiming
 * `src` "came from a native file dialog" — nothing actually enforced it. Any
 * same-origin script (a compromised plugin, a preview XSS) could POST an
 * arbitrary absolute `src` straight to either route, have it copied into the
 * open project, then read it back out through the scoped `fs:readFile`
 * route: an unscoped-source read primitive hiding behind two routes whose
 * docstrings merely asserted honesty.
 *
 * `api:build`'s `out` path has the mirror-image shape: it's a WRITE target
 * that is deliberately allowed to point anywhere on disk (the whole point of
 * "Save PDF as…" is letting the author choose a destination), and the export
 * controller atomically renames the finished PDF onto it — an arbitrary-file
 * overwrite primitive if `out` were trusted from the renderer alone.
 *
 * Both are fixed the same way — the maintainer's "exchange the picker/dialog
 * result for a one-time opaque capability" option — via the two factories
 * below, which share the same bounded one-time-token set implementation
 * (`createCapabilitySet`):
 *
 *   - `dialog:pickImageFile` / `dialog:pickImageFiles` REGISTER every
 *     absolute path the native OPEN dialog itself just returned (see those
 *     routes' `call`); `media:importImage` / `fs:copyFile` must CONSUME
 *     (one-time) a `src` from that set before copying anything from OUTSIDE
 *     the project — a `src` that wasn't registered by a recent pick (or was
 *     already consumed) is rejected with 403.
 *   - `dialog:savePdf` REGISTERS the absolute path the native SAVE dialog
 *     itself just returned; `api:build`'s export controller must CONSUME
 *     that path as `out` before writing/renaming anything onto it — an
 *     `out` the Save dialog never returned (or one already consumed) is
 *     rejected.
 *
 * Either result still round-trips through the renderer (the SPA calls the
 * dialog route, gets a path back, and later passes that same path to the
 * follow-up route) — that's fine, because the HOST is what recorded the path
 * in the first place. A script handing back a path it was never given
 * doesn't authorize anything; only a path this process's own dialog call
 * produced does.
 *
 * Each capability set is bounded on two axes so a script that just spams the
 * dialog route can't grow it without limit: a max entry count (oldest
 * un-consumed entry evicted first) and a TTL (an un-consumed entry expires —
 * the user can simply re-open the dialog).
 */
import path from "node:path";
import { getHostServices } from "./host-services";

export interface PickedFilesHooks {
  /**
   * Record that the native file dialog just returned these absolute paths —
   * each becomes eligible for exactly one later {@link PickedFilesHooks.consume}.
   * Re-registering a path already tracked refreshes it (moves it to the back
   * of the eviction order, resets its TTL) rather than creating a duplicate.
   */
  register(paths: readonly string[]): void;
  /**
   * Authorize AND consume `absPath`. Returns `true` — removing the entry, so
   * a second call with the same path returns `false` — if `absPath` was
   * registered by a recent, not-yet-consumed pick; `false` otherwise (never
   * picked, already consumed, or expired past the TTL).
   */
  consume(absPath: string): boolean;
}

/** The live `PickedFilesHooks` slice of the collapsed host object (ARCH #31), or null before `registerHostServices` runs. */
export function getPickedFilesHooks(): PickedFilesHooks | null {
  return getHostServices()?.pickedFiles ?? null;
}

/**
 * One-time "save path" capability (finding #4, 2026-07-13 maintainer
 * review): the write-side mirror of {@link PickedFilesHooks}, guarding
 * `api:build`'s `out` instead of `media:importImage`/`fs:copyFile`'s `src`.
 * Kept as a distinct interface/instance (not a reuse of `pickedFiles`) so a
 * path a native OPEN dialog returned (source-read intent) can never
 * authorize a WRITE via `api:build`, and vice versa — the two dialogs answer
 * different questions and their capabilities stay in separate pools.
 */
export interface SavePathHooks {
  /**
   * Record that the native SAVE dialog just returned this absolute path,
   * making it eligible for exactly one later {@link SavePathHooks.consume}.
   */
  register(absPath: string): void;
  /**
   * Authorize AND consume `absPath`. Returns `true` — removing the entry, so
   * a second call with the same path returns `false` — if `absPath` was
   * registered by a recent, not-yet-consumed Save dialog result; `false`
   * otherwise (never chosen, already consumed, or expired past the TTL).
   */
  consume(absPath: string): boolean;
}

/** The live `SavePathHooks` slice of the collapsed host object (ARCH #31), or null before `registerHostServices` runs. */
export function getSavePathsHooks(): SavePathHooks | null {
  return getHostServices()?.savePaths ?? null;
}

export interface PickedFilesServiceOptions {
  /**
   * Max number of un-consumed picks tracked at once, across separate
   * `register()` calls. Oldest evicted first. Default 64.
   *
   * This is a floor, not a hard ceiling: a single `register()` call is one
   * native-dialog result (`dialog:pickImageFiles` enables `multiSelections`,
   * so one user pick can return far more than 64 paths at once), and a batch
   * must never evict its OWN members — that would 403 files the user just
   * picked before the caller ever gets a chance to consume them. So each
   * `register()` call's effective cap is `Math.max(maxEntries, paths.length)`
   * for that call: older, unrelated entries from earlier picks still get
   * evicted down to make room, but everything in the batch just registered
   * survives.
   */
  maxEntries?: number;
  /** How long an un-consumed pick stays valid, in ms. Default 10 minutes. */
  ttlMs?: number;
  /** Injectable clock, so tests can simulate expiry without a real sleep. Default `Date.now`. */
  now?: () => number;
}

const DEFAULT_MAX_ENTRIES = 64;
const DEFAULT_TTL_MS = 10 * 60 * 1000;

/**
 * Shared bounded one-time-token set behind both {@link createPickedFilesService}
 * and {@link createSavePathsService} — the register/consume/eviction/TTL
 * mechanics are identical for both capability directions (read-source vs.
 * write-destination); only the public method arity differs (`register`
 * takes a batch for multi-select picks, a single path for one Save dialog
 * result), which each factory adapts below. An in-memory allow-set,
 * process-lifetime only — never persisted, which is fine, since an
 * un-consumed entry surviving a restart isn't a real use case (the user just
 * re-picks / re-chooses).
 */
function createCapabilitySet(options: PickedFilesServiceOptions = {}): PickedFilesHooks {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = options.now ?? Date.now;

  // Map preserves insertion order, and every (re-)registration deletes then
  // re-inserts its key — so iteration order always matches registration
  // recency, which is what makes "evict the front" a correct oldest-first
  // eviction with no separate LRU bookkeeping.
  const entries = new Map<string, number>();

  function normalize(p: string): string {
    return path.resolve(p);
  }

  function pruneExpired(): void {
    const cutoff = now() - ttlMs;
    for (const [key, registeredAt] of entries) {
      if (registeredAt < cutoff) entries.delete(key);
    }
  }

  return {
    register(paths) {
      pruneExpired();
      // A single dialog result can legitimately return more paths than
      // maxEntries (multi-select import) — the eviction floor for THIS
      // batch is never below the batch's own length, so the batch can't
      // self-evict. Older, unrelated entries from earlier picks are still
      // evicted down to that floor to keep the set bounded overall.
      const effectiveCap = Math.max(maxEntries, paths.length);
      for (const p of paths) {
        const key = normalize(p);
        entries.delete(key);
        entries.set(key, now());
        while (entries.size > effectiveCap) {
          const oldestKey = entries.keys().next().value;
          if (oldestKey === undefined) break;
          entries.delete(oldestKey);
        }
      }
    },
    consume(absPath) {
      pruneExpired();
      const key = normalize(absPath);
      if (!entries.has(key)) return false;
      entries.delete(key);
      return true;
    },
  };
}

/** Build a real {@link PickedFilesHooks} implementation — see {@link createCapabilitySet}. */
export function createPickedFilesService(options: PickedFilesServiceOptions = {}): PickedFilesHooks {
  return createCapabilitySet(options);
}

/**
 * Build a real {@link SavePathHooks} implementation — see
 * {@link createCapabilitySet}. A separate underlying set from
 * `createPickedFilesService` (a fresh `createCapabilitySet()` call, not a
 * shared instance): the SAVE dialog's results must never authorize an
 * `media:importImage`/`fs:copyFile` `src` read, and vice versa.
 */
export function createSavePathsService(options: PickedFilesServiceOptions = {}): SavePathHooks {
  const inner = createCapabilitySet(options);
  return {
    register(absPath) {
      inner.register([absPath]);
    },
    consume(absPath) {
      return inner.consume(absPath);
    },
  };
}
