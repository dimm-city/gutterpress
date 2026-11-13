/**
 * One shared online-copy snapshot per book (UX review §2.3 item 2).
 *
 * Book setup → Online, its Drafts list and the Version history
 * screen all need the same few facts about a book: what its online copy is
 * (`diagnoseProjectRemote`), its drafts (`listRevisions`, which can check the
 * online copy over the network) and the first page of its version history
 * (Online's newest versions and what is waiting, then Version history).
 * Before this, each view asked again on every visit, one of them twice, and
 * the drafts list fetched online again after every local action.
 *
 * What it does:
 *  - `get(dir)` answers at once from the last snapshot. It starts a refresh in
 *    the background only when the last online check is older than 60 s.
 *  - `refresh(dir)` re-reads everything: the local answer first (published at
 *    once, with `checking: true`), then the online check.
 *    `refresh(dir, { network: false })` re-reads this computer only, for local
 *    actions (switching, renaming, making a draft) that never need the network.
 *  - `invalidate(dir)` forgets a book's snapshot: after a backup, a repair or a
 *    sign-in the next `get` starts over.
 *  - `subscribe(dir, fn)` is called with each published snapshot.
 *  - `versionsPage(dir)` is the first Version history page, read once for
 *    everything that asks within a few seconds; `takeVersionsPage(dir)` hands
 *    it to the Version history screen.
 *  - `checkedAt` on the snapshot is when the online copy was last really
 *    checked (the host's `checkedAt` when it sends one). The status bar may
 *    read it with `peek(dir)?.checkedAt`.
 *
 * (`get` also re-reads what the online copy is, which is local and quick, behind
 *  the cached answer, because a sign-in elsewhere can change it.)
 *
 * Plain TypeScript (no runes) so it is unit-tested directly with fake reads.
 */
import { api } from "#lib/api.ts";
import type { ProjectRemoteDiagnosis, RevisionList, VersionEntry } from "#lib/platform/contract.ts";

/** A snapshot older than this is refreshed in the background by `get`. */
export const FRESH_MS = 60_000;

export interface OnlineCopySnapshot {
  /** What the book's online copy is; null when it couldn't be read. */
  diag: ProjectRemoteDiagnosis | null;
  /** The book's drafts (revisions); null for a plain folder or a failed read. */
  revisions: RevisionList | null;
  /** The online copy is being checked right now. */
  checking: boolean;
  /** When the online copy was last checked successfully (ms); null = never since this app opened. */
  checkedAt: number | null;
  /** The last check reached the online copy (false = what this computer last knew). */
  checkedOnline: boolean;
  /** When this snapshot was last fully read (ms). */
  readAt: number;
}

export interface OnlineCopyReads {
  diagnose: (dir: string) => Promise<ProjectRemoteDiagnosis>;
  listRevisions: (dir: string, options?: { refresh?: boolean; maxAgeMs?: number }) => Promise<RevisionList | null>;
  firstVersionsPage: (dir: string) => Promise<{ entries: VersionEntry[]; hasMore: boolean }>;
}

/** The fields WP-C's `list-revisions` adds; absent from older hosts. */
type WithChecked = { checkedAt?: number | string; checkedOnline?: boolean };

export function createOnlineCopyCache(reads: OnlineCopyReads, now: () => number = Date.now) {
  const snapshots = new Map<string, OnlineCopySnapshot>();
  const listeners = new Map<string, Set<(s: OnlineCopySnapshot) => void>>();
  const versionPages = new Map<string, { p: Promise<{ entries: VersionEntry[]; hasMore: boolean }>; at: number }>();
  /** A prefetched Version history page older than this may be missing a new version, so it is read again. */
  const PAGE_MAX_AGE_MS = 5_000;
  let lastKey = new Map<string, string>();
  const failures = new Map<string, number>();

  function publish(dir: string, next: OnlineCopySnapshot): OnlineCopySnapshot {
    snapshots.set(dir, next);
    for (const fn of listeners.get(dir) ?? []) fn(next);
    return next;
  }

  const checkedAtOf = (list: RevisionList | null): number | null => {
    const raw = (list as (RevisionList & WithChecked) | null)?.checkedAt;
    if (typeof raw === "number") return raw;
    if (typeof raw === "string") {
      const t = Date.parse(raw);
      if (!Number.isNaN(t)) return t;
    }
    return null;
  };

  const generation = new Map<string, number>();

  async function load(dir: string, network: boolean, diagnoseToo: boolean, forceCheck: boolean): Promise<OnlineCopySnapshot> {
    const gen = (generation.get(dir) ?? 0) + 1;
    generation.set(dir, gen);
    const latest = () => generation.get(dir) === gen;
    /** A read that something newer (an action, `invalidate`) replaced must not publish. */
    const publishNow = (s: OnlineCopySnapshot): OnlineCopySnapshot => (latest() ? publish(dir, s) : s);
    const before = snapshots.get(dir);
    // A routine online check behind a snapshot already showing reads the drafts once, with the check:
    // a local read first would only repeat what is showing. A first read, one after an action, or a
    // book with no online copy to check reads this computer's answer.
    const localFirst = !network || forceCheck || !before?.diag?.remoteUrl;
    const [diag, local] = await Promise.all([
      network || diagnoseToo || !before?.diag ? reads.diagnose(dir).catch(() => null) : Promise.resolve(before.diag),
      localFirst ? reads.listRevisions(dir).catch(() => before?.revisions ?? null) : Promise.resolve(before?.revisions ?? null),
    ]);
    const hasRemote = !!diag?.remoteUrl;
    const keep = { checkedAt: before?.checkedAt ?? null, checkedOnline: before?.checkedOnline ?? false };
    if (!network || !hasRemote) {
      const checking = !network && !!snapshots.get(dir)?.checking;
      return publishNow({ diag, revisions: local, checking, ...keep, readAt: now() });
    }
    // The local answer shows at once; the online check can take a while.
    publishNow({ diag, revisions: local, checking: true, ...keep, readAt: now() });
    let list: RevisionList | null = local;
    let online = false;
    try {
      // The host reuses an online check younger than its own window (20 s); right after an action it must be a real one.
      list = (await reads.listRevisions(dir, forceCheck ? { refresh: true, maxAgeMs: 0 } : { refresh: true })) ?? local;
      online = (list as (RevisionList & WithChecked) | null)?.checkedOnline ?? true;
    } catch {
      // The list stays as it was.
    }
    const at = online ? (checkedAtOf(list) ?? now()) : keep.checkedAt;
    if (!latest()) {
      // A newer read (a local action) replaced this one: keep its drafts, just finish the check.
      const cur = snapshots.get(dir);
      // After `invalidate` there is nothing to finish: this old read is dropped.
      if (!cur) return { diag, revisions: list, checking: false, checkedAt: at, checkedOnline: online, readAt: now() };
      return publish(dir, { ...cur, checking: false, checkedAt: at, checkedOnline: online });
    }
    return publish(dir, { diag, revisions: list, checking: false, checkedAt: at, checkedOnline: online, readAt: now() });
  }

  /** A read is running that checks the online copy. */
  const networkRuns = new Map<string, Promise<OnlineCopySnapshot>>();

  function refresh(dir: string, options: { network?: boolean; diagnose?: boolean; fresh?: boolean } = {}): Promise<OnlineCopySnapshot> {
    const network = options.network ?? true;
    // `fresh`: something was just done (a backup, a repair), so a check already running started too early to know.
    if (network && !options.fresh) {
      const running = networkRuns.get(dir);
      if (running) return running;
    }
    const p = load(dir, network, options.diagnose ?? false, options.fresh ?? false);
    if (network) {
      networkRuns.set(dir, p);
      void p.then(
        () => networkRuns.delete(dir),
        () => networkRuns.delete(dir),
      );
    }
    return p;
  }

  const stale = (s: OnlineCopySnapshot): boolean => now() - (s.checkedAt ?? s.readAt) > FRESH_MS;

  function subscribe(dir: string, fn: (s: OnlineCopySnapshot) => void): () => void {
    let set = listeners.get(dir);
    if (!set) listeners.set(dir, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  return {
    /** The last snapshot without any read, or undefined. */
    peek: (dir: string): OnlineCopySnapshot | undefined => snapshots.get(dir),

    /** The snapshot now: the last one at once (refreshing behind it when old), else the first read. */
    async get(dir: string): Promise<OnlineCopySnapshot> {
      const have = snapshots.get(dir);
      if (!have) {
        // The first answer is this computer's (diagnosis and drafts, no network): it resolves
        // at once, with `checking` set, and the online check lands through `subscribe`.
        const first = new Promise<OnlineCopySnapshot>((resolve) => {
          const stop = subscribe(dir, (snap) => {
            stop();
            resolve(snap);
          });
        });
        return Promise.race([first, refresh(dir)]);
      }
      // What the book's online copy is can change from outside this view (a sign-in in Accounts), and
      // reading it is local, so it is always re-read behind the answer; the online check only when old.
      if (!have.checking) void refresh(dir, { network: stale(have), diagnose: true });
      return have;
    },

    refresh,

    /** Forget a book's snapshot (after a backup, repair, sign-in or turning on versions). */
    invalidate(dir: string): void {
      snapshots.delete(dir);
      networkRuns.delete(dir);
      versionPages.delete(dir);
      generation.set(dir, (generation.get(dir) ?? 0) + 1);
    },

    subscribe,

    /** The Version history's first page: one read shared by everything that asks within a few seconds. */
    versionsPage(dir: string): Promise<{ entries: VersionEntry[]; hasMore: boolean }> {
      const have = versionPages.get(dir);
      if (have && now() - have.at < PAGE_MAX_AGE_MS) return have.p;
      const p = reads.firstVersionsPage(dir);
      p.catch(() => versionPages.delete(dir));
      versionPages.set(dir, { p, at: now() });
      return p;
    },

    /** The prefetched first page, once (a later open reads fresh), or undefined. */
    takeVersionsPage(dir: string): Promise<{ entries: VersionEntry[]; hasMore: boolean }> | undefined {
      const have = versionPages.get(dir);
      versionPages.delete(dir);
      return have && now() - have.at < PAGE_MAX_AGE_MS ? have.p : undefined;
    },

    dropVersionsPage: (dir: string): void => void versionPages.delete(dir),

    /**
     * Note a backup result so Online can open its repair tools after
     * two failures in a row that are not just being offline. Returns the count.
     */
    noteBackupResult(dir: string, state: string | undefined, key?: string): number {
      // The same status seen again (a re-mount, a re-render) is not a second failure.
      const k = key === undefined ? undefined : `${state}|${key}`;
      if (k !== undefined && lastKey.get(dir) === k) return failures.get(dir) ?? 0;
      if (k !== undefined) lastKey.set(dir, k);
      if (state === "error" || state === "auth" || state === "not-found") failures.set(dir, (failures.get(dir) ?? 0) + 1);
      else if (state === "synced" || state === "unsent" || state === "syncing") failures.set(dir, 0);
      return failures.get(dir) ?? 0;
    },
    failureCount: (dir: string): number => failures.get(dir) ?? 0,
  };
}

const shared = createOnlineCopyCache({
  diagnose: (dir) => api.remote.diagnoseProjectRemote(dir),
  listRevisions: (dir, options) => api.vcs.listRevisions(dir, options),
  firstVersionsPage: (dir) => api.vcs.listSnapshotsPage(dir),
});

export const get = shared.get;
export const refresh = shared.refresh;
export const peek = shared.peek;
export const invalidate = shared.invalidate;
export const subscribe = shared.subscribe;
export const versionsPage = shared.versionsPage;
export const takeVersionsPage = shared.takeVersionsPage;
export const dropVersionsPage = shared.dropVersionsPage;
export const noteBackupResult = shared.noteBackupResult;
export const failureCount = shared.failureCount;
