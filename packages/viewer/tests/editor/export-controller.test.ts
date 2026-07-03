import { expect, test } from "bun:test";
import { ExportController } from "../../src/lib/export/export-controller.svelte";
import type { ExportProgressEvent } from "../../src/lib/export/export-controller.svelte";

// Bun imports the rune-bearing .svelte.ts module without Svelte's compiler in
// these unit tests. The production compiler replaces $state; the class only
// needs plain values for these behavior tests (same shim as buffer-state.test).
(globalThis as unknown as { $state?: <T>(value: T) => T }).$state ??= (value) => value;

/** A controllable fake clock standing in for the 1s ticker's setInterval. */
class FakeInterval {
  private cb: (() => void) | null = null;
  cleared = false;
  handle = { id: 1 };

  seam() {
    return {
      setInterval: (cb: () => void, _ms: number) => {
        this.cb = cb;
        this.cleared = false;
        return this.handle;
      },
      clearInterval: (h: unknown) => {
        if (h === this.handle) {
          this.cleared = true;
          this.cb = null;
        }
      },
    };
  }

  /** Advance the fake clock by `n` one-second ticks. */
  tick(n = 1) {
    for (let i = 0; i < n; i++) this.cb?.();
  }

  get running(): boolean {
    return this.cb !== null && !this.cleared;
  }
}

function makeController(): { ctrl: ExportController; clock: FakeInterval } {
  const clock = new FakeInterval();
  return { ctrl: new ExportController(clock.seam()), clock };
}

const ev = (over: Partial<ExportProgressEvent> = {}): ExportProgressEvent => ({
  exportId: "exp-1",
  state: "rendering",
  ...over,
});

test("start() enters the started state, resets counters, and runs the ticker", () => {
  const { ctrl, clock } = makeController();
  ctrl.start();
  expect(ctrl.exporting).toBe(true);
  expect(ctrl.state).toBe("started");
  expect(ctrl.pages).toBe(0);
  expect(ctrl.elapsedSeconds).toBe(0);
  expect(ctrl.pdfProgress).toBe("Preparing PDF…");
  expect(clock.running).toBe(true);
});

test("elapsed seconds only appear in the label once >= 3s", () => {
  const { ctrl, clock } = makeController();
  ctrl.start();
  clock.tick(2);
  expect(ctrl.elapsedSeconds).toBe(2);
  // Below 3s: no seconds suffix.
  expect(ctrl.pdfProgress).toBe("Preparing PDF…");
  clock.tick(1);
  expect(ctrl.elapsedSeconds).toBe(3);
  expect(ctrl.pdfProgress).toBe("Preparing PDF… 3s");
});

test("syncProgress adopts the first exportId and folds in state + pages", () => {
  const { ctrl } = makeController();
  ctrl.start();
  ctrl.syncProgress(ev({ state: "rendering", pages: 5 }));
  expect(ctrl.activeExportId).toBe("exp-1");
  expect(ctrl.state).toBe("rendering");
  expect(ctrl.pages).toBe(5);
  expect(ctrl.pdfProgress).toBe("Exporting page 5…");

  ctrl.syncProgress(ev({ state: "finalizing", pages: 12 }));
  expect(ctrl.state).toBe("finalizing");
  expect(ctrl.pdfProgress).toBe("Finalizing PDF (12 pages)…");
});

test("syncProgress ignores events from a different export id", () => {
  const { ctrl } = makeController();
  ctrl.start();
  ctrl.syncProgress(ev({ exportId: "exp-1", state: "rendering", pages: 3 }));
  ctrl.syncProgress(ev({ exportId: "OTHER", state: "finalizing", pages: 99 }));
  // Stale event ignored: state/pages unchanged.
  expect(ctrl.state).toBe("rendering");
  expect(ctrl.pages).toBe(3);
});

test("rendering/finalizing labels fall back when no page count is known", () => {
  const { ctrl } = makeController();
  ctrl.start();
  ctrl.syncProgress(ev({ state: "rendering" }));
  expect(ctrl.pdfProgress).toBe("Exporting…");
  ctrl.syncProgress(ev({ state: "finalizing" }));
  expect(ctrl.pdfProgress).toBe("Finalizing PDF…");
});

test("markCanceling shows a fixed label with no elapsed suffix", () => {
  const { ctrl, clock } = makeController();
  ctrl.start();
  clock.tick(5);
  ctrl.markCanceling();
  expect(ctrl.state).toBe("canceling");
  expect(ctrl.pdfProgress).toBe("Canceling export…");
});

test("markSuccess stops the ticker, records the export id, and shows PDF saved", () => {
  const { ctrl, clock } = makeController();
  ctrl.start();
  clock.tick(4);
  ctrl.markSuccess("exp-final");
  expect(ctrl.state).toBe("success");
  expect(ctrl.activeExportId).toBe("exp-final");
  expect(clock.running).toBe(false);
  // Elapsed was 4s at success → suffix retained.
  expect(ctrl.pdfProgress).toBe("PDF saved 4s");
});

test("markSuccess without an id keeps a previously adopted export id", () => {
  const { ctrl } = makeController();
  ctrl.start();
  ctrl.syncProgress(ev({ exportId: "exp-1", state: "rendering" }));
  ctrl.markSuccess();
  expect(ctrl.activeExportId).toBe("exp-1");
  expect(ctrl.state).toBe("success");
});

test("reset returns everything to idle and clears the ticker", () => {
  const { ctrl, clock } = makeController();
  ctrl.start();
  clock.tick(3);
  ctrl.syncProgress(ev({ state: "rendering", pages: 7 }));
  ctrl.reset();
  expect(ctrl.exporting).toBe(false);
  expect(ctrl.activeExportId).toBe(null);
  expect(ctrl.state).toBe("idle");
  expect(ctrl.pages).toBe(0);
  expect(ctrl.elapsedSeconds).toBe(0);
  expect(ctrl.pdfProgress).toBe(null);
  expect(clock.running).toBe(false);
});

test("beginSimpleExport/endSimpleExport toggle only the busy flag (HTML path)", () => {
  const { ctrl, clock } = makeController();
  ctrl.beginSimpleExport();
  expect(ctrl.exporting).toBe(true);
  // No FSM/timer engaged for the simple path.
  expect(ctrl.state).toBe("idle");
  expect(ctrl.pdfProgress).toBe(null);
  expect(clock.running).toBe(false);
  ctrl.endSimpleExport();
  expect(ctrl.exporting).toBe(false);
});
