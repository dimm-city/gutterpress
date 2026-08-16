import { test, expect, describe } from "bun:test";
import {
  BlockOverlayController,
  type BlockOverlayClient,
  type BlockOverlayDeps,
} from "../../src/lib/routes/block-overlay-controller.svelte";
import type { CommitEngine } from "$lib/editor/commit-engine";
import type { PreviewEvent } from "$lib/preview-client";

// Bun imports the rune-bearing .svelte.ts module without Svelte's compiler in
// these unit tests (same shim as context-menu-controller.test.ts / zoom-view-
// controller.test / buffer-state.test).
(globalThis as unknown as { $state?: <T>(value: T) => T }).$state ??= (value) => value;

/**
 * block-overlay-controller.svelte.ts — the source editor for one opaque atom
 * in the galley's document (ADR 0011): open/commit/cancel, the IME
 * composition guard, and dismissal when a render invalidates the captured
 * node position.
 *
 * The overlay opens over a rect the frame supplied and hands edited text back
 * through `onCommitText`; the galley applies it to the document and its own
 * whole-file save writes it out. The pre-galley overlay resolved a block by
 * `data-source-range`, masked its on-page fragments, re-anchored them across
 * renders and zooms, and committed a source splice — all of that went with
 * the editing surface it served, and so did the suite that covered it.
 */

class FakeClient implements BlockOverlayClient {
  private listeners: Array<(e: PreviewEvent) => void> = [];
  on(fn: (e: PreviewEvent) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }
  emit(e: PreviewEvent): void {
    for (const l of this.listeners) l(e);
  }
}

class FakeCommitEngine {
  generation = 0;
  calls: unknown[] = [];
  noteRenderingComplete(): void {
    this.generation++;
  }
  async commitRangePatch(patch: unknown) {
    this.calls.push(patch);
    return { ok: true as const, flushed: true };
  }
}

interface Harness {
  ctrl: BlockOverlayController;
  client: FakeClient;
  commitEngine: FakeCommitEngine;
  toastErrorCalls: string[];
  toastInfoCalls: string[];
  paneRect: { left: number; top: number; width: number; height: number } | null;
  iframeOrigin: { left: number; top: number } | null;
}

function make(): Harness {
  const client = new FakeClient();
  const commitEngine = new FakeCommitEngine();
  const h: Harness = {
    ctrl: undefined as unknown as BlockOverlayController,
    client,
    commitEngine,
    toastErrorCalls: [],
    toastInfoCalls: [],
    paneRect: { left: 0, top: 0, width: 800, height: 600 },
    iframeOrigin: { left: 0, top: 0 },
  };
  const deps: BlockOverlayDeps = {
    client: () => client,
    commitEngine: commitEngine as unknown as CommitEngine,
    getIframeOrigin: () => h.iframeOrigin,
    getPaneRect: () => h.paneRect,
    toastError: (m) => h.toastErrorCalls.push(m),
    toastInfo: (m) => h.toastInfoCalls.push(m),
  };
  h.ctrl = new BlockOverlayController(deps);
  h.ctrl.subscribe(client);
  return h;
}

const rect = { top: 10, left: 20, width: 100, height: 40 };

describe("open and commit", () => {
  test("opens seeded with the atom's source; commit hands the edited text back", async () => {
    const h = make();
    const commits: string[] = [];
    h.ctrl.showGalley({ text: "<div>raw</div>", rect, onCommitText: (t) => commits.push(t) });
    expect(h.ctrl.open).toBe(true);
    expect(h.ctrl.initialText).toBe("<div>raw</div>");
    // Geometry converts the frame-viewport rect into host coordinates.
    expect(h.ctrl.x).toBe(20);
    expect(h.ctrl.y).toBe(10);

    await h.ctrl.commit("<div>edited</div>");
    expect(commits).toEqual(["<div>edited</div>"]);
    expect(h.ctrl.open).toBe(false);
    // The document is the write path — never a range patch from here.
    expect(h.commitEngine.calls.length).toBe(0);
  });

  test("the iframe origin offsets the rect", () => {
    const h = make();
    h.iframeOrigin = { left: 100, top: 50 };
    h.ctrl.showGalley({ text: "x", rect, onCommitText: () => {} });
    expect(h.ctrl.x).toBe(120);
    expect(h.ctrl.y).toBe(60);
  });
});

describe("cancel and the composition guard", () => {
  test("cancel discards; a mid-composition commit is a no-op", async () => {
    const h = make();
    const commits: string[] = [];
    h.ctrl.showGalley({ text: "x", rect, onCommitText: (t) => commits.push(t) });
    await h.ctrl.commit("half-composed", { duringComposition: true });
    expect(commits).toEqual([]);
    expect(h.ctrl.open).toBe(true);
    h.ctrl.cancel();
    expect(commits).toEqual([]);
    expect(h.ctrl.open).toBe(false);
    // A later commit (a blur arriving after close) must not resurrect it.
    await h.ctrl.commit("late");
    expect(commits).toEqual([]);
  });

  test("teardown is safe to call with nothing open", () => {
    const h = make();
    expect(() => h.ctrl.teardown()).not.toThrow();
  });
});

describe("renderingComplete", () => {
  test("closes the overlay — the captured node position is stale — and bumps the generation", async () => {
    const h = make();
    const commits: string[] = [];
    h.ctrl.showGalley({ text: "x", rect, onCommitText: (t) => commits.push(t) });
    h.client.emit({ name: "renderingComplete", detail: {} });
    await Promise.resolve();
    expect(h.ctrl.open).toBe(false);
    expect(commits).toEqual([]);
    expect(h.toastInfoCalls.length).toBe(1);
    // This controller owns the generation bump that closes the stale-commit
    // window for every commit path, including the galley's whole-file saves.
    expect(h.commitEngine.generation).toBe(1);
  });

  test("bumps the generation even with no overlay open", async () => {
    const h = make();
    h.client.emit({ name: "renderingComplete", detail: {} });
    await Promise.resolve();
    expect(h.commitEngine.generation).toBe(1);
    expect(h.toastInfoCalls).toEqual([]);
  });
});

describe("viewport movement", () => {
  test("closeGalleyOnViewportChange closes an open overlay", () => {
    const h = make();
    h.ctrl.showGalley({ text: "x", rect, onCommitText: () => {} });
    h.ctrl.closeGalleyOnViewportChange();
    expect(h.ctrl.open).toBe(false);
  });
});
