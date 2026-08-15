import { expect, test } from "bun:test";
import { ZoomViewController } from "../../src/lib/routes/zoom-view-controller.svelte";

// Bun imports the rune-bearing .svelte.ts module without Svelte's compiler in
// these unit tests. The production compiler replaces $state; the class only
// needs plain values for these behavior tests (same shim as
// page-nav-controller.test / export-controller.test / buffer-state.test).
(globalThis as unknown as { $state?: <T>(value: T) => T }).$state ??= (value) => value;

/** Flush the microtask/macrotask queue so `.then().catch()` chains settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

/**
 * Fake host-command client capturing (cmd, args). `getPageDimensions` returns
 * the configured `dims`; every other command resolves undefined. In `reject`
 * mode all calls reject so the fit-width catch path can be exercised.
 */
class FakeClient {
  calls: Array<{ cmd: string; args: unknown[] }> = [];
  dims: { width: number; height: number; viewportWidth?: number } | null = null;
  reject = false;

  call<T>(cmd: string, args: unknown[] = []): Promise<T> {
    this.calls.push({ cmd, args });
    if (this.reject && cmd !== "setZoom") return Promise.reject(new Error("boom")) as Promise<T>;
    if (cmd === "getPageDimensions") return Promise.resolve(this.dims) as Promise<T>;
    return Promise.resolve(undefined) as Promise<T>;
  }

  get last(): { cmd: string; args: unknown[] } | undefined {
    return this.calls[this.calls.length - 1];
  }

  callsFor(cmd: string): Array<{ cmd: string; args: unknown[] }> {
    return this.calls.filter((c) => c.cmd === cmd);
  }
}

type Spy = { calls: unknown[][] };
const spy = (): ((...a: unknown[]) => void) & Spy => {
  const fn = ((...a: unknown[]) => {
    fn.calls.push(a);
  }) as ((...a: unknown[]) => void) & Spy;
  fn.calls = [];
  return fn;
};

interface Harness {
  ctrl: ZoomViewController;
  client: FakeClient | undefined;
  persistZoom: ReturnType<typeof spy>;
  persistViewMode: ReturnType<typeof spy>;
  persistSplitRatio: ReturnType<typeof spy>;
  saveDesktopPrefs: ReturnType<typeof spy>;
  zoom: string;
  viewMode: "single" | "two-column";
  isNarrow: boolean;
  containerWidth: number;
  workspaceRect: { left: number; width: number } | null;
}

function make(over: Partial<{ hasClient: boolean }> = {}): Harness {
  const client = over.hasClient === false ? undefined : new FakeClient();
  const persistZoom = spy();
  const persistViewMode = spy();
  const persistSplitRatio = spy();
  const saveDesktopPrefs = spy();
  const h = {
    client,
    persistZoom,
    persistViewMode,
    persistSplitRatio,
    saveDesktopPrefs,
    zoom: "fit-width",
    viewMode: "single" as "single" | "two-column",
    isNarrow: false,
    containerWidth: 800,
    workspaceRect: { left: 0, width: 1000 } as { left: number; width: number } | null,
  } as Harness;
  h.ctrl = new ZoomViewController({
    client: () => h.client,
    zoom: () => h.zoom,
    viewMode: () => h.viewMode,
    isNarrow: () => h.isNarrow,
    persistZoom: (v) => persistZoom(v),
    persistViewMode: (m) => persistViewMode(m),
    persistSplitRatio: (v) => persistSplitRatio(v),
    saveDesktopPrefs: (patch) => saveDesktopPrefs(patch),
    measureContainerWidth: () => h.containerWidth,
    measureWorkspaceRect: () => h.workspaceRect,
  });
  return h;
}

// ── Initial state ───────────────────────────────────────────────────────────

test("initial public rune state matches the +page.svelte defaults", () => {
  const { ctrl } = make();
  expect(ctrl.splitPaneRatio).toBe(0.42);
  expect(ctrl.draggingSplit).toBe(false);
  expect(ctrl.userSetViewMode).toBe(false);
});

// ── applyZoom ─────────────────────────────────────────────────────────────────

test("applyZoom persists the value and no-ops the host call when no client", () => {
  const h = make({ hasClient: false });
  h.ctrl.applyZoom("1.5");
  expect(h.persistZoom.calls).toEqual([["1.5"]]);
});

test("applyZoom of a numeric value drives setZoom with the parsed number", () => {
  const h = make();
  h.ctrl.applyZoom("1.5");
  expect(h.persistZoom.calls).toEqual([["1.5"]]);
  expect((h.client as FakeClient).last).toEqual({ cmd: "setZoom", args: [1.5] });
});

test("applyZoom of fit-width computes the scale from measured widths", async () => {
  const h = make();
  h.containerWidth = 800;
  (h.client as FakeClient).dims = { width: 1000, height: 1400 };
  h.ctrl.applyZoom("fit-width");
  expect(h.persistZoom.calls).toEqual([["fit-width"]]);
  await flush();
  // CSS zoom scales the 32px stage padding too, so fit the complete stage:
  // 800 / (1000 + 64). This leaves equal visible gutters on both sides.
  expect((h.client as FakeClient).callsFor("setZoom")[0]?.args[0]).toBeCloseTo(800 / 1064, 6);
});

// ── applyFitWidthZoom ─────────────────────────────────────────────────────────

test("applyFitWidthZoom scales up as well as down to actually fit width", async () => {
  const h = make();
  h.containerWidth = 1200;
  (h.client as FakeClient).dims = { width: 1000, height: 1400 };
  await h.ctrl.applyFitWidthZoom();
  expect((h.client as FakeClient).callsFor("setZoom")[0]?.args[0]).toBeCloseTo(1200 / 1064, 6);
});

test("applyFitWidthZoom recomputes from the latest resized container width", async () => {
  const h = make();
  (h.client as FakeClient).dims = { width: 1000, height: 1400 };
  h.containerWidth = 800;
  await h.ctrl.applyFitWidthZoom();
  h.containerWidth = 600;
  await h.ctrl.applyFitWidthZoom();
  const calls = (h.client as FakeClient).callsFor("setZoom");
  expect(calls[0]?.args[0]).toBeCloseTo(800 / 1064, 6);
  expect(calls[1]?.args[0]).toBeCloseTo(600 / 1064, 6);
});

test("applyFitWidthZoom uses the preview's scrollbar-free layout width", async () => {
  const h = make();
  h.containerWidth = 600;
  (h.client as FakeClient).dims = { width: 1000, height: 1400, viewportWidth: 585 };
  await h.ctrl.applyFitWidthZoom();
  expect((h.client as FakeClient).callsFor("setZoom")[0]?.args[0]).toBeCloseTo(585 / 1064, 6);
});

test("applyFitWidthZoom uses scale 1 when dimensions are missing", async () => {
  const h = make();
  (h.client as FakeClient).dims = null;
  await h.ctrl.applyFitWidthZoom();
  expect((h.client as FakeClient).callsFor("setZoom")).toEqual([{ cmd: "setZoom", args: [1] }]);
});

test("applyFitWidthZoom falls back to setZoom 1 when the dimension query rejects", async () => {
  const h = make();
  (h.client as FakeClient).reject = true;
  await h.ctrl.applyFitWidthZoom();
  // getPageDimensions rejected → catch → setZoom(1).
  expect((h.client as FakeClient).callsFor("setZoom")).toEqual([{ cmd: "setZoom", args: [1] }]);
});

test("applyFitWidthZoom no-ops with no client", async () => {
  const h = make({ hasClient: false });
  await h.ctrl.applyFitWidthZoom();
  // Nothing to assert beyond not throwing; persist is untouched.
  expect(h.persistZoom.calls.length).toBe(0);
});

// ── stepZoom clamping ─────────────────────────────────────────────────────────

test("stepZoom from fit-width treats current as 1 and steps up", () => {
  const h = make();
  h.zoom = "fit-width";
  h.ctrl.stepZoom(0.25);
  expect(h.persistZoom.calls).toEqual([["1.25"]]);
});

test("stepZoom clamps at the 4 ceiling", () => {
  const h = make();
  h.zoom = "3.9";
  h.ctrl.stepZoom(0.25);
  expect(h.persistZoom.calls).toEqual([["4"]]);
});

test("stepZoom clamps at the 0.25 floor", () => {
  const h = make();
  h.zoom = "0.3";
  h.ctrl.stepZoom(-0.25);
  expect(h.persistZoom.calls).toEqual([["0.25"]]);
});

test("stepZoom rounds to two decimal places", () => {
  const h = make();
  h.zoom = "1";
  h.ctrl.stepZoom(0.25);
  expect(h.persistZoom.calls).toEqual([["1.25"]]);
});

// ── view-mode transitions ─────────────────────────────────────────────────────

test("applyViewMode(fromUser=true) persists, saves prefs, sets the lock, and drives the host", () => {
  const h = make();
  h.ctrl.applyViewMode("two-column", true);
  expect(h.persistViewMode.calls).toEqual([["two-column"]]);
  expect(h.saveDesktopPrefs.calls).toEqual([[{ viewMode: "two-column" }]]);
  expect(h.ctrl.userSetViewMode).toBe(true);
  expect((h.client as FakeClient).last).toEqual({ cmd: "setViewMode", args: ["two-column"] });
});

test("applyViewMode(fromUser=false) does not set the user lock", () => {
  const h = make();
  h.ctrl.applyViewMode("two-column", false);
  expect(h.ctrl.userSetViewMode).toBe(false);
  expect(h.persistViewMode.calls).toEqual([["two-column"]]);
});

test("changing view mode re-fits after the new layout is applied", async () => {
  const h = make();
  h.zoom = "fit-width";
  (h.client as FakeClient).dims = { width: 1600, height: 1400 };
  h.ctrl.applyViewMode("two-column", true);
  await flush();
  expect((h.client as FakeClient).calls.map((call) => call.cmd)).toEqual([
    "setViewMode",
    "getPageDimensions",
    "setZoom",
  ]);
});

test("applyViewMode with no client still persists and saves prefs", () => {
  const h = make({ hasClient: false });
  h.ctrl.applyViewMode("single", true);
  expect(h.persistViewMode.calls).toEqual([["single"]]);
  expect(h.saveDesktopPrefs.calls).toEqual([[{ viewMode: "single" }]]);
});

test("toggleViewMode flips single→two-column and always locks (fromUser)", () => {
  const h = make();
  h.viewMode = "single";
  h.ctrl.toggleViewMode();
  expect(h.persistViewMode.calls).toEqual([["two-column"]]);
  expect(h.ctrl.userSetViewMode).toBe(true);
});

test("toggleViewMode flips two-column→single", () => {
  const h = make();
  h.viewMode = "two-column";
  h.ctrl.toggleViewMode();
  expect(h.persistViewMode.calls).toEqual([["single"]]);
});

// ── split-drag ratio clamping ─────────────────────────────────────────────────

test("beginSplitDrag returns false and does not start while narrow", () => {
  const h = make();
  h.isNarrow = true;
  expect(h.ctrl.beginSplitDrag(500)).toBe(false);
  expect(h.ctrl.draggingSplit).toBe(false);
});

test("beginSplitDrag returns false when there is no workspace rect", () => {
  const h = make();
  h.workspaceRect = null;
  expect(h.ctrl.beginSplitDrag(500)).toBe(false);
  expect(h.ctrl.draggingSplit).toBe(false);
});

test("beginSplitDrag starts the drag and sets the ratio from the pointer", () => {
  const h = make();
  h.workspaceRect = { left: 0, width: 1000 };
  expect(h.ctrl.beginSplitDrag(500)).toBe(true);
  expect(h.ctrl.draggingSplit).toBe(true);
  // 500 / 1000 = 0.5 (within [0.25, 0.75]).
  expect(h.ctrl.splitPaneRatio).toBe(0.5);
});

test("split ratio clamps to the 0.25 floor for a far-left pointer", () => {
  const h = make();
  h.workspaceRect = { left: 0, width: 1000 };
  h.ctrl.beginSplitDrag(10);
  expect(h.ctrl.splitPaneRatio).toBe(0.25);
});

test("split ratio clamps to the 0.75 ceiling for a far-right pointer", () => {
  const h = make();
  h.workspaceRect = { left: 0, width: 1000 };
  h.ctrl.beginSplitDrag(990);
  expect(h.ctrl.splitPaneRatio).toBe(0.75);
});

test("beginSplitDrag does not persist (persist=false)", () => {
  const h = make();
  h.ctrl.beginSplitDrag(500);
  expect(h.saveDesktopPrefs.calls.length).toBe(0);
});

test("moveSplitDrag no-ops until a drag is active", () => {
  const h = make();
  h.ctrl.moveSplitDrag(600);
  expect(h.ctrl.splitPaneRatio).toBe(0.42);
});

test("moveSplitDrag updates the ratio while dragging without persisting", () => {
  const h = make();
  h.ctrl.beginSplitDrag(500);
  h.ctrl.moveSplitDrag(600);
  expect(h.ctrl.splitPaneRatio).toBe(0.6);
  expect(h.saveDesktopPrefs.calls.length).toBe(0);
});

test("endSplitDrag clears the flag, updates, and persists the final ratio", () => {
  const h = make();
  h.ctrl.beginSplitDrag(500);
  expect(h.ctrl.endSplitDrag(700)).toBe(true);
  expect(h.ctrl.draggingSplit).toBe(false);
  expect(h.ctrl.splitPaneRatio).toBe(0.7);
  // Persists to BOTH the durable settings store and the per-project bucket.
  expect(h.saveDesktopPrefs.calls).toEqual([[{ splitPaneRatio: 0.7 }]]);
  expect(h.persistSplitRatio.calls).toEqual([[0.7]]);
});

test("endSplitDrag snaps the released ratio to a nearby snap point (#103)", () => {
  const h = make();
  h.ctrl.beginSplitDrag(500);
  // pointer 610/1000 = 0.61 → within 3% of the 0.6 snap point → snaps to 0.6.
  h.ctrl.endSplitDrag(610);
  expect(h.ctrl.splitPaneRatio).toBe(0.6);
  expect(h.saveDesktopPrefs.calls).toEqual([[{ splitPaneRatio: 0.6 }]]);
  expect(h.persistSplitRatio.calls).toEqual([[0.6]]);
});

test("resetSplitRatio restores the breakpoint default and persists it (#103)", () => {
  const h = make();
  h.ctrl.beginSplitDrag(500);
  h.ctrl.endSplitDrag(700);
  h.ctrl.resetSplitRatio();
  expect(h.ctrl.splitPaneRatio).toBe(0.42);
  expect(h.persistSplitRatio.calls.at(-1)).toEqual([0.42]);
  expect(h.saveDesktopPrefs.calls.at(-1)).toEqual([{ splitPaneRatio: 0.42 }]);
});

test("nudgeSplit steps the ratio by ~2% per direction and persists (#103)", () => {
  const h = make();
  h.ctrl.restoreSplitRatio(0.5);
  h.ctrl.nudgeSplit(1);
  expect(h.ctrl.splitPaneRatio).toBe(0.52);
  h.ctrl.nudgeSplit(-1);
  expect(h.ctrl.splitPaneRatio).toBe(0.5);
  expect(h.persistSplitRatio.calls).toEqual([[0.52], [0.5]]);
  expect(h.saveDesktopPrefs.calls).toEqual([
    [{ splitPaneRatio: 0.52 }],
    [{ splitPaneRatio: 0.5 }],
  ]);
});

test("endSplitDrag returns false when no drag was active", () => {
  const h = make();
  expect(h.ctrl.endSplitDrag(700)).toBe(false);
  expect(h.saveDesktopPrefs.calls.length).toBe(0);
});

test("updating the split while zoom is fit-width triggers a refit", async () => {
  const h = make();
  h.zoom = "fit-width";
  (h.client as FakeClient).dims = { width: 1000, height: 1400 };
  h.ctrl.beginSplitDrag(500);
  await flush();
  // applyFitWidthZoom ran → at least one setZoom call issued.
  expect((h.client as FakeClient).callsFor("setZoom").length).toBeGreaterThan(0);
});

test("updating the split while zoom is numeric does NOT refit", () => {
  const h = make();
  h.zoom = "1.5";
  h.ctrl.beginSplitDrag(500);
  expect((h.client as FakeClient).callsFor("setZoom").length).toBe(0);
});

// ── restoreSplitRatio ─────────────────────────────────────────────────────────

test("restoreSplitRatio clamps an out-of-range saved value", () => {
  const h = make();
  h.ctrl.restoreSplitRatio(0.9);
  expect(h.ctrl.splitPaneRatio).toBe(0.75);
  h.ctrl.restoreSplitRatio(0.1);
  expect(h.ctrl.splitPaneRatio).toBe(0.25);
});

test("restoreSplitRatio does not persist (pure state restore)", () => {
  const h = make();
  h.ctrl.restoreSplitRatio(0.5);
  expect(h.ctrl.splitPaneRatio).toBe(0.5);
  expect(h.saveDesktopPrefs.calls.length).toBe(0);
});
