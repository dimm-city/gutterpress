import { expect, test } from "bun:test";
import { ActivityGate } from "../../src/lib/loading/activity-gate.svelte";
import type { ActivityStage } from "../../src/lib/loading/activity-stage";

// Bun imports the rune-bearing .svelte.ts module without Svelte's compiler in
// these unit tests; the production compiler replaces the runes. The class only
// needs plain values here (same shim as project-lifecycle-controller.test).
const g = globalThis as unknown as { $state?: unknown };
g.$state ??= Object.assign(<T>(v: T) => v, { raw: <T>(v: T) => v });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stage = (label: string): ActivityStage => ({ id: "opening", label, detail: null, progress: null });
const none = { open: null, update: null, exporting: null, workspaceOpen: false };

// Tiny timing so the real clock suffices; the rule itself is covered with a
// manual clock in delayed-value.test.ts.
const timing = { delayMs: 20, minVisibleMs: 40 };

test("each stream is gated independently through the use: action", async () => {
  const gate = new GatedHarness();
  gate.feed({ ...none, open: stage("Opening X…"), update: stage("Updating preview…") });
  expect(gate.g.open).toBeNull();
  expect(gate.g.update).toBeNull();
  await sleep(timing.delayMs + 15);
  expect(gate.g.open?.label).toBe("Opening X…");
  expect(gate.g.update?.label).toBe("Updating preview…");
  expect(gate.g.exporting).toBeNull();
  gate.destroy();
});

test("work that finishes inside the delay never reaches the screen", async () => {
  const gate = new GatedHarness();
  gate.feed({ ...none, open: stage("Opening X…") });
  await sleep(5);
  gate.feed(none);
  await sleep(timing.delayMs + timing.minVisibleMs + 15);
  expect(gate.g.open).toBeNull();
  gate.destroy();
});

test("a shown stage is held for its minimum time, then clears", async () => {
  const gate = new GatedHarness();
  gate.feed({ ...none, exporting: stage("Preparing PDF…") });
  await sleep(timing.delayMs + 15);
  gate.feed(none);
  expect(gate.g.exporting?.label).toBe("Preparing PDF…");
  await sleep(timing.minVisibleMs + 15);
  expect(gate.g.exporting).toBeNull();
  gate.destroy();
});

test("destroying the action cancels pending reveals", async () => {
  const gate = new GatedHarness();
  gate.feed({ ...none, open: stage("Opening X…") });
  gate.destroy();
  await sleep(timing.delayMs + 15);
  expect(gate.g.open).toBeNull();
});

test("an open's card stays where it started: no jump when the workspace appears mid-open", () => {
  const gate = new GatedHarness();
  // A first open: no workspace yet → window-centred card…
  gate.feed({ ...none, open: stage("Opening X…") });
  expect(gate.g.openOnApp).toBe(true);
  // …and still window-centred once the workspace exists during layout.
  gate.feed({ ...none, open: stage("Laying out pages…"), workspaceOpen: true });
  expect(gate.g.openOnApp).toBe(true);
  // The next open behind a visible book uses the preview pane.
  gate.feed({ ...none, workspaceOpen: true });
  gate.feed({ ...none, open: stage("Opening Y…"), workspaceOpen: true });
  expect(gate.g.openOnApp).toBe(false);
  gate.destroy();
});

/** Drives `track` the way Svelte does: initial param on mount, `update` on change, `destroy` on unmount. */
class GatedHarness {
  readonly g = new ActivityGate(timing);
  private action: { update: (s: typeof none) => void; destroy: () => void } | null = null;
  feed(stages: typeof none) {
    if (!this.action) this.action = this.g.track({} as Element, stages) as never;
    else this.action.update(stages);
  }
  destroy() {
    this.action?.destroy();
  }
}
