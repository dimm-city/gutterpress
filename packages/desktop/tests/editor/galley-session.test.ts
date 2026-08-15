import { describe, expect, test } from "bun:test";
import { GalleySession } from "../../src/lib/editor/galley-session";
import type { CommitOutcome, CommitPatch } from "../../src/lib/editor/commit-engine";

/** Fakes matching the injected seams (same style as commit-engine.test.ts). */
function makeHarness(opts: { outcomes?: Record<string, CommitOutcome>; gate?: Promise<void> } = {}) {
  const committed: CommitPatch[] = [];
  const engine = {
    generation: 7,
    commitRangePatch: async (patch: CommitPatch) => {
      committed.push(patch);
      if (opts.gate) await opts.gate;
      return opts.outcomes?.[patch.chapter] ?? { ok: true as const, flushed: true };
    },
  };
  const editModeCalls: Array<{ on: boolean }> = [];
  const acks: Array<{ chapter: string; ok: boolean }> = [];
  const listeners: Array<(e: { name: string; detail: unknown }) => void> = [];
  const client = {
    setEditMode: async (spec: { on: boolean }) => {
      editModeCalls.push(spec);
      return spec;
    },
    galleyAckContent: async (spec: { chapter: string; ok: boolean }) => {
      acks.push(spec);
      return { ok: true };
    },
    on: (fn: (e: { name: string; detail: unknown }) => void) => {
      listeners.push(fn);
      return () => {};
    },
  };
  let enabled = true;
  const session = new GalleySession({
    client: () => client,
    engine: () => engine,
    enabled: () => enabled,
  });
  const emit = (name: string, detail: unknown) => listeners.forEach((fn) => fn({ name, detail }));
  return { session, client, engine, committed, editModeCalls, acks, emit, setEnabled: (v: boolean) => (enabled = v) };
}

const content = (chapter: string, markdown: string, expected: string) => ({
  chapter,
  markdown,
  expected,
});

describe("GalleySession", () => {
  test("commits a chapter as ONE whole-file range patch with inline-edit origin", async () => {
    const h = makeHarness();
    const stale = "line one\nline two\n";
    h.session.handleEvent("galleyContent", content("ch.md", "edited\n", stale));
    await Bun.sleep(0);

    expect(h.committed.length).toBe(1);
    const patch = h.committed[0]!;
    expect(patch.chapter).toBe("ch.md");
    // [0, expected.split("\n").length) — the engine's charRange clamps the
    // end index to text.length, so this covers the entire file byte-exactly.
    expect(patch.range).toEqual([0, 3]);
    expect(patch.expected).toBe(stale);
    expect(patch.replacement).toBe("edited\n");
    expect(patch.origin).toBe("inline-edit");
    expect(patch.expectedGeneration).toBe(7);
    // Server-normalized LF vs a CRLF file on disk is reconciled engine-side.
    expect(patch.eolTolerant).toBe(true);
    expect(h.session.applied).toBe(1);
    // The frame's expected-chain advances ONLY on this positive ack.
    expect(h.acks).toEqual([{ chapter: "ch.md", ok: true }]);
  });

  test("failure surfaces through onStale (never silent, never retried)", async () => {
    const h = makeHarness({
      outcomes: {
        "ch.md": { ok: false, reason: "mismatch", message: "slice changed", degradeLine: 1 },
      },
    });
    const stale: Array<[string, string]> = [];
    h.session.subscribe(h.client, { onStale: (chapter, reason) => stale.push([chapter, reason]) });
    h.emit("galleyContent", content("ch.md", "edited\n", "old\n"));
    await Bun.sleep(0);

    expect(stale).toEqual([["ch.md", "mismatch"]]);
    expect(h.committed.length).toBe(1); // no retry loop
    expect(h.session.applied).toBe(0);
    // A refused proposal is negatively acked so the frame suspends the
    // chapter instead of stacking refusals on a broken expected-chain.
    expect(h.acks).toEqual([{ chapter: "ch.md", ok: false }]);
  });

  test("commits are serialized and a chapter queued twice keeps only the latest", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const h = makeHarness({ gate });
    // First commit blocks on the gate; two more arrive for the SAME chapter
    // while it is in flight — only the last must commit afterwards.
    h.session.handleEvent("galleyContent", content("a.md", "v1\n", "base\n"));
    h.session.handleEvent("galleyContent", content("a.md", "v2\n", "v1\n"));
    h.session.handleEvent("galleyContent", content("a.md", "v3\n", "v1\n"));
    h.session.handleEvent("galleyContent", content("b.md", "other\n", "b\n"));
    expect(h.committed.length).toBe(1); // in flight; queue holds latest-per-chapter
    release();
    await Bun.sleep(0);

    expect(h.committed.map((p) => [p.chapter, p.replacement])).toEqual([
      ["a.md", "v1\n"],
      ["a.md", "v3\n"],
      ["b.md", "other\n"],
    ]);
  });

  test("editStateChanged drives the dirty flag", () => {
    const h = makeHarness();
    h.session.handleEvent("editStateChanged", { dirty: true });
    expect(h.session.dirty).toBe(true);
    h.session.handleEvent("editStateChanged", { dirty: false });
    expect(h.session.dirty).toBe(false);
  });

  test("subscribe owns the event stream: selection, opaque edits, render passes", async () => {
    const h = makeHarness();
    const selections: unknown[] = [];
    const opaque: unknown[] = [];
    let renderPasses = 0;
    h.session.subscribe(h.client, {
      onSelection: (d) => selections.push(d),
      onOpaqueEdit: (d) => opaque.push(d),
      onRenderPass: () => renderPasses++,
    });
    h.emit("editSelection", { collapsed: true });
    h.emit("galleyOpaqueEdit", { chapter: "ch.md", pos: 42, src: "<div>x</div>", rect: null });
    h.emit("ready", {});
    h.emit("renderingComplete", {});
    await Bun.sleep(0);

    expect(selections).toEqual([{ collapsed: true }]);
    expect(opaque).toEqual([{ chapter: "ch.md", pos: 42, src: "<div>x</div>", rect: null }]);
    expect(renderPasses).toBe(2);
    // ready/renderingComplete each re-sync edit mode per the kill switch.
    expect(h.editModeCalls).toEqual([{ on: true }, { on: true }]);
  });

  test("syncEditMode pushes the kill switch's current value", async () => {
    const h = makeHarness();
    h.setEnabled(false);
    await h.session.syncEditMode();
    expect(h.editModeCalls).toEqual([{ on: false }]);
  });

  test("viewport changes dismiss the bubble (its coords are window-space)", () => {
    const h = makeHarness();
    let dismissals = 0;
    h.session.subscribe(h.client, { onViewportChanged: () => dismissals++ });
    h.emit("viewportChanged", { scrollTop: 120 });
    h.emit("viewportChanged", { scrollTop: 240 });
    expect(dismissals).toBe(2);
  });
});
