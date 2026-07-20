/**
 * close-gate.ts — the window-close flush→snapshot→destroy orchestration,
 * extracted from createWindow's "close" handler as an injectable, unit-testable
 * function (R25). main.ts wires the real deps (requestRendererFlush,
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
 *   always settles (true=replied / false=hung renderer) within it; no second
 *   concurrent timer races it.
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
   * replied (or there was nothing to flush), `false` when its watchdog fired
   * on an unresponsive renderer (requestRendererFlush's contract).
   */
  flush: () => Promise<boolean>;
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
    let pending: Promise<void> | undefined;
    if (replied) {
      try {
        pending = deps.snapshot();
      } catch {
        // A synchronous throw from the scheduler is its own bug to log; the
        // gate treats it like "nothing pending" and proceeds to finish().
      }
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
