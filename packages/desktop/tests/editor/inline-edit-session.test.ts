import { describe, expect, test } from "bun:test";
import { InlineEditSession } from "../../src/lib/editor/inline-edit-session";
import type { CommitOutcome, CommitPatch } from "../../src/lib/editor/commit-engine";

/** Fakes matching the injected seams (same style as commit-engine.test.ts). */
function makeHarness(outcomes: CommitOutcome[]) {
  const committed: CommitPatch[] = [];
  const acks: unknown[] = [];
  const refusals: unknown[] = [];
  const engine = {
    generation: 7,
    commitRangePatch: async (patch: CommitPatch) => {
      committed.push(patch);
      return outcomes[committed.length - 1] ?? { ok: true as const, flushed: true };
    },
  };
  const listeners: Array<(e: { name: string; detail: unknown }) => void> = [];
  const client = {
    setEditMode: async () => ({ on: true }),
    ackEditPatches: async (spec: unknown) => {
      acks.push(spec);
      return {};
    },
    on: (fn: (e: { name: string; detail: unknown }) => void) => {
      listeners.push(fn);
      return () => {};
    },
  };
  const failures: unknown[] = [];
  const session = new InlineEditSession({
    client: () => client,
    engine: () => engine,
    enabled: () => true,
    onRefusal: (r) => refusals.push(r),
    onCommitFailed: (r) => failures.push(r),
  });
  const emit = (name: string, detail: unknown) => listeners.forEach((fn) => fn({ name, detail }));
  return { session, client, committed, acks, refusals, failures, emit };
}

const patch = (n: number) => ({
  chapter: "ch.md",
  range: [n, n + 1] as [number, number],
  expected: `old ${n}`,
  replacement: `new ${n}`,
});

describe("InlineEditSession", () => {
  test("commits each proposed patch through the engine with inline-edit origin and acks applied", async () => {
    const h = makeHarness([{ ok: true, flushed: true }, { ok: true, flushed: true }]);
    h.session.handleEvent("editPatches", { batchId: 3, patches: [patch(0), patch(4)], refusals: [] });
    await Bun.sleep(0);

    expect(h.committed.length).toBe(2);
    expect(h.committed[0]!.origin).toBe("inline-edit");
    expect(h.committed[0]!.expectedGeneration).toBe(7);
    expect(h.session.applied).toBe(2);
    expect(h.acks).toEqual([
      {
        batchId: 3,
        results: [
          { chapter: "ch.md", range: [0, 1], status: "applied" },
          { chapter: "ch.md", range: [4, 5], status: "applied" },
        ],
      },
    ]);
  });

  test("mismatch degrades to refused + onRefusal; transient gate failures ack as failed", async () => {
    const h = makeHarness([
      { ok: false, reason: "mismatch", message: "slice changed", degradeLine: 1 },
      { ok: false, reason: "not-clean", message: "buffer dirty", degradeLine: 5 },
    ]);
    h.session.handleEvent("editPatches", { batchId: 9, patches: [patch(0), patch(4)], refusals: [] });
    await Bun.sleep(0);

    const ack = h.acks[0] as { results: Array<{ status: string; reason?: string }> };
    expect(ack.results[0]!.status).toBe("refused");
    expect(ack.results[1]!.status).toBe("failed");
    expect(ack.results[1]!.reason).toBe("not-clean");
    expect(h.refusals.length).toBe(1); // only the mismatch opens the overlay path
    // A transient failure must still be VISIBLE — the edit is on screen but
    // never reached disk, so silence here would be invisible data loss.
    expect(h.failures).toEqual([
      { chapter: "ch.md", range: [4, 5], reason: "not-clean", message: "buffer dirty" },
    ]);
  });

  test("frame-side serializer refusals surface through onRefusal without touching the engine", async () => {
    const h = makeHarness([]);
    h.session.handleEvent("editPatches", {
      batchId: 1,
      patches: [],
      refusals: [{ chapter: "ch.md", range: [2, 3], reason: "raw html" }],
    });
    await Bun.sleep(0);
    expect(h.committed.length).toBe(0);
    expect(h.refusals).toEqual([{ chapter: "ch.md", range: [2, 3], reason: "raw html" }]);
  });

  test("editStateChanged drives the dirty flag", () => {
    const h = makeHarness([]);
    h.session.handleEvent("editStateChanged", { dirty: true });
    expect(h.session.dirty).toBe(true);
    h.session.handleEvent("editStateChanged", { dirty: false });
    expect(h.session.dirty).toBe(false);
  });

  test("subscribe owns the event stream: routes patches, re-syncs on render passes", async () => {
    const h = makeHarness([{ ok: true, flushed: true }]);
    const selections: unknown[] = [];
    let renderPasses = 0;
    h.session.subscribe(h.client, {
      onSelection: (d) => selections.push(d),
      onRenderPass: () => renderPasses++,
    });
    h.emit("editPatches", { batchId: 2, patches: [patch(0)], refusals: [] });
    h.emit("editSelection", { collapsed: true });
    h.emit("renderingComplete", {});
    await Bun.sleep(0);
    expect(h.committed.length).toBe(1);
    expect(selections).toEqual([{ collapsed: true }]);
    expect(renderPasses).toBe(1);
  });

  test("viewport changes dismiss the bubble (its coords are window-space)", () => {
    const h = makeHarness([]);
    let dismissals = 0;
    h.session.subscribe(h.client, { onViewportChanged: () => dismissals++ });
    h.emit("viewportChanged", { scrollTop: 120 });
    h.emit("viewportChanged", { scrollTop: 240 });
    expect(dismissals).toBe(2);
  });
});
