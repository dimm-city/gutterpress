/**
 * close-gate.ts — the window-close flush→snapshot→destroy orchestration,
 * extracted from createWindow's "close" handler as an injectable, unit-testable
 * function (R25). main.ts wires the real deps (RendererFlushSession.request,
 * flushAutoSnapshot, win.destroy).
 *
 * SINGLE-OWNER, PER-PHASE WATCHDOGS (R25). The old shape armed an outer 5s
 * destroy timer at the same instant as the flush's own 5s watchdog and never
 * cancelled it when the flush settled — a renderer replying just under the
 * budget (large-doc autosave) let the snapshot's git commit START and then the
 * outer timer destroyed the window mid-object-write, leaving a stale
 * index.lock/partial commit for the next launch to repair. Now each phase owns
 * exactly one budget:
 *
 * - Phase 1 (flush): `flush()`'s OWN internal watchdog is the budget — it
 *   always settles (true=flush confirmed / false=failed or hung renderer)
 *   within it; no second concurrent timer races it.
 * - Phase 2 (snapshot): starts only after the flush settles. Once the commit
 *   has STARTED it is allowed to finish — the gate awaits it, with a backstop
 *   ({@link SNAPSHOT_BACKSTOP_MS}) armed at commit start for a truly hung
 *   commit, so quit is never blocked indefinitely.
 *
 * Node/lib-side ONLY — never imported by the renderer.
 */

/** External touch-points injected into the gate (all faked in tests). */
export interface CloseGateDeps {
  /**
   * Phase 1: ask the renderer to flush unsaved editor state. Owns its own
   * watchdog budget and always settles within it — `true` when the renderer
   * confirms the buffer reached disk (or there was nothing to flush), `false`
   * on an explicit save failure or watchdog timeout.
   */
  flush: () => Promise<boolean>;
  /** Persist the next-launch warning when phase 1 cannot confirm the flush. */
  recordFlushFailure?: () => Promise<void>;
  /** Phase 2: fire the pending auto-snapshot NOW, or `undefined` when nothing pends. */
  snapshot: () => Promise<void> | undefined;
  /** Destroy the window. The gate guarantees exactly one call. */
  finish: () => void;
  /** Injectable timer arm. Real code uses setTimeout; tests fake it. */
  setTimer?: (cb: () => void, ms: number) => unknown;
  /** Injectable timer clear. Real code uses clearTimeout; tests fake it. */
  clearTimer?: (h: unknown) => void;
}

/**
 * Backstop for a truly hung snapshot commit. The snapshot is local git work
 * (no network), so anything past this is a wedged commit, not a slow one —
 * generous on purpose: killing a started commit corrupts the repo, while a
 * slow quit merely annoys.
 */
export const SNAPSHOT_BACKSTOP_MS = 20_000;
/** A warning write must never turn a failed flush into an indefinitely hung quit. */
export const FLUSH_FAILURE_MARKER_BACKSTOP_MS = 1_000;

/** Host touch-points for one BrowserWindow's renderer flush session. */
export interface RendererFlushSessionDeps {
  isAlive: () => boolean;
  sendFlushRequest: () => void;
  setTimer?: (cb: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/**
 * Per-window owner for close/update flush requests. The renderer's dirty-state
 * POST remains a useful hint, but it is deliberately never used to skip a
 * flush: once the page has loaded, an editor may exist even if that POST
 * failed or arrived out of order.
 */
export class RendererFlushSession {
  private editorMayExist = false;
  private reportedDirty = false;
  private pending:
    | {
        promise: Promise<boolean>;
        settle: (flushed: boolean) => void;
      }
    | null = null;

  constructor(private readonly deps: RendererFlushSessionDeps) {}

  get mayHaveEditorSession(): boolean {
    return this.editorMayExist;
  }

  get lastReportedDirtyState(): boolean {
    return this.reportedDirty;
  }

  /** Mark a completed renderer load as capable of holding an editor buffer. */
  markRendererLoaded(): void {
    this.editorMayExist = true;
  }

  /** Keep the best-effort renderer report for diagnostics, never as a safety gate. */
  setReportedDirtyState(dirty: boolean): void {
    this.reportedDirty = dirty;
    this.editorMayExist = true;
  }

  /**
   * Ask this window to flush. Concurrent close/update requests share one
   * request, and the timeout guarantees callers always regain control.
   */
  request(timeoutMs = 5_000): Promise<boolean> {
    if (!this.editorMayExist || !this.deps.isAlive()) return Promise.resolve(true);
    if (this.pending) return this.pending.promise;

    const setTimer = this.deps.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
    const clearTimer = this.deps.clearTimer ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));
    let resolvePromise!: (flushed: boolean) => void;
    let settled = false;
    let timer: unknown;
    const promise = new Promise<boolean>((resolve) => {
      resolvePromise = resolve;
    });
    const settle = (flushed: boolean) => {
      if (settled) return;
      settled = true;
      clearTimer(timer);
      this.pending = null;
      if (flushed) this.reportedDirty = false;
      resolvePromise(flushed);
    };
    this.pending = { promise, settle };
    timer = setTimer(() => settle(false), timeoutMs);
    try {
      this.deps.sendFlushRequest();
    } catch {
      settle(false);
    }
    return promise;
  }

  /** Settle the request currently owned by this window. Late replies are ignored. */
  resolve(flushed: boolean): void {
    this.pending?.settle(flushed === true);
  }

  /** Reset on a top-frame reload so a stale listener cannot answer for the new page. */
  reset(): void {
    this.pending?.settle(false);
    this.editorMayExist = false;
    this.reportedDirty = false;
  }
}

async function recordFlushFailureWithinBudget(
  deps: CloseGateDeps,
  setTimer: (cb: () => void, ms: number) => unknown,
  clearTimer: (handle: unknown) => void,
): Promise<void> {
  if (!deps.recordFlushFailure) return;
  await new Promise<void>((resolve) => {
    let settled = false;
    let timer: unknown;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimer(timer);
      resolve();
    };
    timer = setTimer(finish, FLUSH_FAILURE_MARKER_BACKSTOP_MS);
    void Promise.resolve()
      .then(() => deps.recordFlushFailure?.())
      .then(finish, finish);
  });
}

export async function runCloseGate(deps: CloseGateDeps): Promise<void> {
  const setTimer = deps.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as NodeJS.Timeout));
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    deps.finish();
  };
  // The outer try/finally OWNS finish(): whatever the deps do — flush
  // rejection, snapshot() throwing synchronously, snapshot promise rejecting —
  // the gate always destroys the window exactly once (main.ts has already
  // preventDefault()ed the close, so a missed finish() would strand it).
  try {
    let replied: boolean;
    try {
      replied = await deps.flush();
    } catch {
      // A rejected flush (dead IPC channel etc.) gives no buffers-confirmed
      // signal, same as a hung renderer — take the same policy branch below.
      replied = false;
    }
    // DELIBERATE POLICY: on a FAILED flush (watchdog fired on a hung renderer,
    // or the flush itself rejected) skip the snapshot and just close — starting
    // a git commit for a renderer that never confirmed its buffers hit disk
    // would snapshot half-written state; the old behavior of dropping the
    // snapshot cleanly is the safe one. (The pending snapshot may also be
    // silently dropped when the per-repo FIFO lock is held by a sync/restore
    // that outlasts the backstop — never blocking quit wins over guaranteeing
    // the last snapshot; the edits themselves are already on disk, only the
    // history entry is skipped.)
    if (!replied) {
      await recordFlushFailureWithinBudget(deps, setTimer, clearTimer);
      return;
    }

    let pending: Promise<void> | undefined;
    try {
      pending = deps.snapshot();
    } catch {
      // A synchronous throw from the scheduler is its own bug to log; the
      // gate treats it like "nothing pending" and proceeds to finish().
    }
    if (!pending) return;
    // The commit has started: await it. Backstop armed NOW, not at gate start.
    const backstop = setTimer(finish, SNAPSHOT_BACKSTOP_MS);
    try {
      await pending;
    } catch {
      // The snapshot runner logs its own failures; the gate only sequences.
    } finally {
      clearTimer(backstop);
    }
  } finally {
    finish();
  }
}
