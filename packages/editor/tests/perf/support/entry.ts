import { mountEditor, type EditorMount } from "../../../src/web/mount.ts";
import { MemoryDocumentHost } from "../../../src/core/index.ts";

/**
 * SFE-P3d-sweep Lane B — the browser-side driver for the D13 performance
 * evidence, mounted and driven (via `tests/browser-harness`'s
 * `openHarnessSession`/`waitForHarnessReady`, imported, never edited) the
 * same way `tests/web/mount.btest.ts` drives `tests/web/support/entry.ts`.
 * Mounts the REAL `mountEditor` (`src/web/mount.ts`, "the fork surface")
 * against a real `MemoryDocumentHost` — no Gutterpress projection, no
 * plugin wiring, exactly as this run's DETAILS specify.
 *
 * MEASUREMENT METHOD (documented here because this is where it lives, not
 * only in the audit doc):
 *
 * Mount-to-interactive and edit-to-paint both answer the same underlying
 * question — "when did the browser finish painting the DOM consequence of
 * an action?" — using the SAME two-step primitive: observe the actual DOM
 * mutation the action produced (via `MutationObserver`, restricted to
 * `childList`/`characterData` — no `attributes`, so cursor-blink/selection-
 * highlight class churn can never masquerade as "the edit landed"), then
 * `requestAnimationFrame` once. `requestAnimationFrame`'s callback runs
 * immediately before the browser computes style/layout/paint for the next
 * frame, which is the earliest point a script can honestly say "this
 * frame, containing the mutation just observed, is about to be presented"
 * — the same convention this run's own spec names ("requestAnimationFrame
 * after the mutation is observable").
 *
 * Why NOT `PerformanceObserver` (`type: "event"`, the Event Timing API
 * behind real-world INP measurement): its entries are only reported once a
 * per-event `duration` exceeds a threshold (spec default 104ms; the
 * lowest a caller may request is a small nonzero floor) — exactly the
 * FAST, in-budget keystrokes this run most needs a p50 for would be
 * silently absent from the sample, corrupting the percentile computation
 * rather than merely coarsening it. `PerformanceObserver`'s `"paint"`
 * entries are page-lifecycle events (first paint / first contentful paint)
 * fired once per page load, not once per interaction, so they cannot
 * answer "was frame N painted" at all. The `MutationObserver` + single
 * `requestAnimationFrame` method has no duration floor and observes the
 * exact DOM the edit is expected to change, so it is the honest choice for
 * a distribution that must include its OWN fast, passing common case.
 *
 * `t0` for a keystroke is `KeyboardEvent.timeStamp` (a `DOMHighResTimeStamp`
 * on the same clock as `performance.now()` in Chromium), read from a
 * capture-phase `keydown` listener on the mount container — NOT
 * `performance.now()` read inside the listener body. This matters for the
 * sabotage control (`enableSlowdown`, below): `timeStamp` is stamped by the
 * browser at real dispatch time, before ANY listener (including the
 * test's own busy-wait) runs, so the recorded t0 stays anchored to the
 * true keydown moment regardless of what a same-target listener does
 * afterward or how listener registration happens to be ordered.
 */

export interface PerfHarnessDriver {
  /**
   * Mounts a fresh `mountEditor` instance (disposing any previous one)
   * backed by a fresh `MemoryDocumentHost` seeded with `text` at version 0,
   * and resolves once the initial render has gone quiet — see
   * `waitForQuiescence` below — plus one final `requestAnimationFrame`.
   * Resolves to the elapsed "mount-to-interactive" milliseconds.
   */
  mountAndMeasureInteractive(text: string): Promise<number>;
  dispose(): void;
  readonly containerSelector: string;

  /** Clears the per-keystroke edit-to-paint sample buffer. */
  resetMeasurements(): void;
  measurementCount(): number;
  /** Elapsed edit-to-paint milliseconds, one entry per keystroke, in the
   * order each keystroke's measurement resolved. */
  measurements(): number[];

  /**
   * G-12/AP-20 control support: while a slowdown is enabled, EVERY keydown
   * on the mount container synchronously busy-waits for approximately
   * `ms` before the event is allowed to continue propagating — a
   * deliberate, test-level sabotage of the exact path being measured (see
   * `perf-control.btest.ts`). Never touches production code; this listener
   * lives only in this test-support file.
   */
  enableSlowdown(ms: number): void;
  disableSlowdown(): void;
}

declare global {
  interface Window {
    // A DISTINCT global name from tests/web/support/entry.ts's
    // `window.__gpMount`, tests/vscode-adapter/support/entry.ts's
    // `window.__gp`, and tests/vscode-adapter/input-a11y/support/entry.ts's
    // `window.__gpA11y` — required, not stylistic, because every browser
    // test entry's `declare global` block merges into ONE TypeScript
    // program (see those files' own comments on this).
    __gpPerf: PerfHarnessDriver;
    __gpReady?: boolean;
  }
}

const CONTAINER_ID = "gp-perf-container";
/** Consecutive idle animation frames (no mutation observed) required before
 * the initial mount is considered "settled" — see `waitForQuiescence`.
 * 6 frames (~100ms at 60fps) tolerates a few frames of legitimate
 * progressive rendering on a large document without waiting indefinitely,
 * while being long enough that ordinary frame-to-frame jitter does not
 * false-trigger "done" mid-render. */
const QUIET_FRAMES = 6;

let mountHandle: EditorMount | undefined;
let container: HTMLDivElement | undefined;
let editMutationObserver: MutationObserver | undefined;
let keydownListener: ((event: KeyboardEvent) => void) | undefined;
let pendingEditT0: number | null = null;
let editMeasurements: number[] = [];
let slowdownMs = 0;

/** Synchronous busy-wait — deliberate, test-only sabotage for the G-12/
 * AP-20 control. Never used outside `enableSlowdown`. */
function busyWaitMs(ms: number): void {
  const deadline = performance.now() + ms;
  while (performance.now() < deadline) {
    // intentional synchronous spin
  }
}

/**
 * Hard upper bound on WALL-CLOCK time waited, independent of `quietFrames`
 * — a fail-loud safety net (AP-20: a measurement that can hang forever
 * instead of reporting is the same as one that silently skips) so a
 * genuine stall surfaces as a clear rejection with real elapsed time,
 * rather than an opaque bun:test per-test timeout with no diagnostic of
 * how long it actually ran.
 *
 * Deliberately WALL-CLOCK, not a frame count: `mountEditor` is documented
 * synchronous, so while its own initial-render call is running, the main
 * thread is fully occupied and no `requestAnimationFrame` callback —
 * including this function's own tick — can run at all (verified live: a
 * 1 MiB mount pegged one Chromium renderer process at 100%+ CPU for
 * several real minutes, all of it before the FIRST tick could fire). A
 * frame-COUNT cap is not a predictable wall-clock bound under exactly the
 * condition it exists to catch — a real time budget is.
 */
const MAX_QUIESCENCE_WAIT_MS = 90_000;

/**
 * Resolves once `target`'s subtree has produced at least one `childList`/
 * `characterData` mutation and then gone quiet for `quietFrames`
 * consecutive animation frames. Used ONLY for the one-shot "has the
 * initial mount finished rendering" measurement — NOT for per-keystroke
 * edit-to-paint, which uses the simpler, non-debounced single-mutation
 * primitive below (debouncing every keystroke would inflate edit-to-paint
 * by `quietFrames` frames for no honest reason, since keystrokes are
 * already serialized one at a time by the caller).
 */
function waitForQuiescence(target: Node, quietFrames: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    let idleFrames = 0;
    let sawMutation = false;
    const observer = new MutationObserver(() => {
      sawMutation = true;
      idleFrames = 0;
    });
    observer.observe(target, { childList: true, subtree: true, characterData: true });
    const tick = (): void => {
      idleFrames++;
      if (sawMutation && idleFrames >= quietFrames) {
        observer.disconnect();
        resolve();
        return;
      }
      const elapsed = performance.now() - startedAt;
      if (elapsed >= MAX_QUIESCENCE_WAIT_MS) {
        observer.disconnect();
        reject(
          new Error(
            `waitForQuiescence: gave up after ${elapsed.toFixed(0)}ms ` +
              `(sawMutation=${sawMutation}) — the mount never produced an ` +
              "observable mutation, or never went quiet.",
          ),
        );
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function teardownMount(): void {
  mountHandle?.dispose();
  mountHandle = undefined;
  if (keydownListener && container) {
    container.removeEventListener("keydown", keydownListener, true);
  }
  keydownListener = undefined;
  editMutationObserver?.disconnect();
  editMutationObserver = undefined;
  document.getElementById(CONTAINER_ID)?.remove();
  container = undefined;
  pendingEditT0 = null;
  slowdownMs = 0;
}

async function mountAndMeasureInteractive(text: string): Promise<number> {
  teardownMount();
  editMeasurements = [];

  container = document.createElement("div");
  container.id = CONTAINER_ID;
  document.body.appendChild(container);

  const host = new MemoryDocumentHost({ text, version: 0 });

  const t0 = performance.now();
  // `waitForQuiescence` must be ARMED (its `MutationObserver.observe` call
  // made) BEFORE `mountEditor` runs, not after: `mountEditor` is documented
  // as synchronous — the initial render's DOM mutations happen INSIDE this
  // call, before it returns. `new Promise((resolve) => {...})`'s executor
  // runs synchronously at construction time, so calling
  // `waitForQuiescence(...)` here (without awaiting yet) already has the
  // observer live by the time `mountEditor` is invoked on the next line.
  // Getting this backwards (observe-after-mount) was this file's own first
  // bug: the observer would never see ANY mutation, so `waitForQuiescence`
  // waited forever (see this run's report for the live repro).
  const quiescence = waitForQuiescence(container, QUIET_FRAMES);
  mountHandle = mountEditor(container, host, {});
  await quiescence;
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const t1 = performance.now();

  // Wired AFTER the initial-render quiescence wait above, so the mount's
  // own initial-render mutations never leak into the edit-to-paint sample
  // buffer (which is reset again by `resetMeasurements` before typing
  // starts, but this ordering keeps `pendingEditT0` correctly `null` from
  // the very first keystroke rather than relying solely on that reset).
  keydownListener = (event: KeyboardEvent): void => {
    pendingEditT0 = event.timeStamp;
    if (slowdownMs > 0) busyWaitMs(slowdownMs);
  };
  container.addEventListener("keydown", keydownListener, true);

  editMutationObserver = new MutationObserver(() => {
    if (pendingEditT0 === null) return;
    const startedAt = pendingEditT0;
    pendingEditT0 = null;
    requestAnimationFrame(() => {
      editMeasurements.push(performance.now() - startedAt);
    });
  });
  editMutationObserver.observe(container, { childList: true, subtree: true, characterData: true });

  return t1 - t0;
}

window.__gpPerf = {
  mountAndMeasureInteractive,
  dispose: teardownMount,
  containerSelector: `#${CONTAINER_ID}`,

  resetMeasurements: (): void => {
    editMeasurements = [];
    pendingEditT0 = null;
  },
  measurementCount: (): number => editMeasurements.length,
  measurements: (): number[] => editMeasurements.slice(),

  enableSlowdown: (ms: number): void => {
    slowdownMs = ms;
  },
  disableSlowdown: (): void => {
    slowdownMs = 0;
  },
};
window.__gpReady = true;
