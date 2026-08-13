import { test, expect, describe } from "bun:test";
import {
  BlockOverlayController,
  splitTrailingBlankRun,
  type BlockOverlayClient,
  type BlockOverlayDeps,
} from "../../src/lib/routes/block-overlay-controller.svelte";
import type { CommitEngine } from "$lib/editor/commit-engine";
import type { PreviewEvent, RectsForResult, SourceRange } from "$lib/preview-client";

// Bun imports the rune-bearing .svelte.ts module without Svelte's compiler in
// these unit tests (same shim as context-menu-controller.test.ts / zoom-view-
// controller.test / buffer-state.test).
(globalThis as unknown as { $state?: <T>(value: T) => T }).$state ??= (value) => value;

/**
 * block-overlay-controller.svelte.ts (inline-editing plan §5) — open/commit/
 * cancel, the full dismissal matrix (renderingComplete re-anchor, close-with-
 * toast when the block is gone, pageChanged re-anchor), onDestroy
 * (teardown()) always unmasking, the IME composition guard, and the §5.5
 * boundary-rule round-trips.
 *
 * Every identity here is `{chapter, range}` — `data-ref` was dropped from the
 * wire contract (WORK PACKAGE B item 2): a source range is duplicated
 * verbatim onto every split fragment on both engines, so it groups a
 * Paged.js clone-set exactly like `data-ref` did, and it's the ONLY identity
 * the native viewer has (it never mints a ref at all).
 */

class FakeClient implements BlockOverlayClient {
  private listeners: Array<(e: PreviewEvent) => void> = [];
  rectsForCalls: Array<{ chapter: string; range: SourceRange }> = [];
  maskCalls: Array<{ chapter: string; range: SourceRange; masked: boolean }> = [];
  /** Queue of responses returned by successive getRectsFor() calls; the last entry repeats. */
  rectsForResponses: RectsForResult[] = [{ rects: [{ top: 10, left: 20, width: 100, height: 40, page: 1 }] }];
  getRectsForImpl: ((target: { chapter: string; range: SourceRange }) => Promise<RectsForResult>) | null = null;

  on(fn: (e: PreviewEvent) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }
  emit(e: PreviewEvent): void {
    for (const l of this.listeners) l(e);
  }
  async getRectsFor(target: { chapter: string; range: SourceRange }): Promise<RectsForResult> {
    this.rectsForCalls.push(target);
    if (this.getRectsForImpl) return this.getRectsForImpl(target);
    const idx = Math.min(this.rectsForCalls.length - 1, this.rectsForResponses.length - 1);
    return this.rectsForResponses[idx]!;
  }
  async setEditMask(spec: { chapter: string; range: SourceRange; masked: boolean }): Promise<{ count: number }> {
    this.maskCalls.push(spec);
    return { count: 1 };
  }
}

class FakeCommitEngine {
  generation = 0;
  calls: unknown[] = [];
  result: { ok: true; flushed: boolean } | { ok: false; reason: string; message: string; degradeLine: number | null } = {
    ok: true,
    flushed: true,
  };
  noteRenderingComplete(): void {
    this.generation++;
  }
  async commitRangePatch(patch: unknown) {
    this.calls.push(patch);
    return this.result;
  }
}

interface Harness {
  ctrl: BlockOverlayController;
  client: FakeClient;
  commitEngine: FakeCommitEngine;
  currentDir: string | null;
  /** Live in-editor content by path (the book document's open chapters). */
  openContent: Map<string, string>;
  readFileMap: Record<string, string>;
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
    currentDir: "/proj",
    openContent: new Map<string, string>(),
    readFileMap: {},
    toastErrorCalls: [],
    toastInfoCalls: [],
    paneRect: { left: 0, top: 0, width: 800, height: 600 },
    iframeOrigin: { left: 0, top: 0 },
  };
  const deps: BlockOverlayDeps = {
    client: () => client,
    currentDir: () => h.currentDir,
    openContent: (path: string) => h.openContent.get(path) ?? null,
    readFile: async (path: string) => {
      if (path in h.readFileMap) return h.readFileMap[path]!;
      throw new Error(`not found: ${path}`);
    },
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

const flush = () => new Promise((r) => setTimeout(r, 0));

// ── open (show) ──────────────────────────────────────────────────────────────

describe("show", () => {
  test("opens, seeds initialText from the buffer slice, and masks the resolved block", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "before\npara text\nafter\n";
    await h.ctrl.show({ chapter: "ch1.md", range: [1, 2] });
    expect(h.ctrl.open).toBe(true);
    expect(h.ctrl.initialText).toBe("para text\n");
    expect(h.client.rectsForCalls).toEqual([{ chapter: "ch1.md", range: [1, 2] }]);
    expect(h.client.maskCalls).toEqual([{ chapter: "ch1.md", range: [1, 2], masked: true }]);
  });

  test("prefers the live buffer over readFile when it's the same chapter", async () => {
    const h = make();
    h.openContent.set("/proj/ch1.md", "line one\nline two\n");
    h.readFileMap["/proj/ch1.md"] = "STALE\n";
    await h.ctrl.show({ chapter: "ch1.md", range: [1, 2] });
    expect(h.ctrl.initialText).toBe("line two\n");
  });

  test("no project open: does nothing", async () => {
    const h = make();
    h.currentDir = null;
    await h.ctrl.show({ chapter: "ch1.md", range: [0, 1] });
    expect(h.ctrl.open).toBe(false);
  });

  test("unreadable chapter: toasts an error and does not open", async () => {
    const h = make();
    await h.ctrl.show({ chapter: "ch1.md", range: [0, 1] });
    expect(h.ctrl.open).toBe(false);
    expect(h.toastErrorCalls.length).toBe(1);
  });

  test("malformed range: toasts an error and does not open", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "a\nb\n";
    await h.ctrl.show({ chapter: "ch1.md", range: [-1, 1] as unknown as SourceRange });
    expect(h.ctrl.open).toBe(false);
    expect(h.toastErrorCalls.length).toBe(1);
  });

  test("getRectsFor resolves empty (block not on screen): toasts an error and closes", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "a\nb\n";
    h.client.rectsForResponses = [{ rects: [] }];
    await h.ctrl.show({ chapter: "ch1.md", range: [0, 1] });
    expect(h.ctrl.open).toBe(false);
    expect(h.toastErrorCalls.length).toBe(1);
  });

  test("positions absolute overlay in pane-local coordinates and picks the visible fragment", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "text\n";
    h.paneRect = { left: 400, top: 100, width: 800, height: 600 };
    h.iframeOrigin = { left: 420, top: 130 };
    h.client.rectsForResponses = [{ rects: [
      { top: -500, left: 20, width: 300, height: 80, page: 1 },
      { top: 50, left: 30, width: 300, height: 80, page: 2 },
    ] }];

    await h.ctrl.show({ chapter: "ch1.md", range: [0, 1] });

    expect(h.ctrl.x).toBe(50); // iframe 20px into pane + rect.left 30
    expect(h.ctrl.y).toBe(80); // iframe 30px into pane + rect.top 50
    expect(h.ctrl.width).toBe(300);
  });

  test("prefers the simultaneously visible fragment that was clicked", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "text\n";
    h.client.rectsForResponses = [{ rects: [
      { top: 40, left: 20, width: 200, height: 80, page: 1 },
      { top: 40, left: 320, width: 200, height: 80, page: 2 },
    ] }];

    await h.ctrl.show({ chapter: "ch1.md", range: [0, 1], anchor: { x: 350, y: 60 } });

    expect(h.ctrl.x).toBe(320);
    expect(h.ctrl.y).toBe(40);
  });

  test("an older async show cannot overwrite a newer target in the same chapter", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "first\nsecond\n";
    const pending: Array<(result: RectsForResult) => void> = [];
    h.client.getRectsForImpl = () => new Promise((resolve) => pending.push(resolve));

    const first = h.ctrl.show({ chapter: "ch1.md", range: [0, 1] });
    await flush();
    const second = h.ctrl.show({ chapter: "ch1.md", range: [1, 2] });
    await flush();
    pending[1]!({ rects: [{ top: 20, left: 200, width: 100, height: 40, page: 1 }] });
    await second;
    expect(h.ctrl.initialText).toBe("second\n");
    expect(h.ctrl.x).toBe(200);

    pending[0]!({ rects: [{ top: 20, left: 10, width: 100, height: 40, page: 1 }] });
    await first;
    expect(h.ctrl.initialText).toBe("second\n");
    expect(h.ctrl.x).toBe(200);
    expect(h.client.maskCalls.at(-1)).toEqual({ chapter: "ch1.md", range: [1, 2], masked: true });
  });
});

// ── commit / cancel ──────────────────────────────────────────────────────────

describe("commit", () => {
  test("commits replacement = editedText + preserved trailing blank run, unmasks, and closes", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "before\npara text\n\n\nafter\n";
    await h.ctrl.show({ chapter: "ch1.md", range: [1, 4] });
    expect(h.ctrl.initialText).toBe("para text\n"); // trailing "\n\n" blank run stripped
    await h.ctrl.commit("edited text\n");
    expect(h.commitEngine.calls).toEqual([
      {
        chapter: "ch1.md",
        range: [1, 4],
        expected: "para text\n\n\n",
        replacement: "edited text\n\n\n",
        expectedGeneration: 0,
      },
    ]);
    expect(h.ctrl.open).toBe(false);
    expect(h.client.maskCalls.at(-1)).toEqual({ chapter: "ch1.md", range: [1, 4], masked: false });
  });

  test("commit failure surfaces the degrade message via toastError", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "text\n";
    h.commitEngine.result = { ok: false, reason: "mismatch", message: "This block changed — reopen to make this change.", degradeLine: 1 };
    await h.ctrl.show({ chapter: "ch1.md", range: [0, 1] });
    await h.ctrl.commit("edited\n");
    expect(h.toastErrorCalls).toEqual(["This block changed — reopen to make this change."]);
  });

  test("IME guard: a duringComposition commit is a no-op (no commitRangePatch call, stays open)", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "text\n";
    await h.ctrl.show({ chapter: "ch1.md", range: [0, 1] });
    await h.ctrl.commit("mid composition", { duringComposition: true });
    expect(h.commitEngine.calls.length).toBe(0);
    expect(h.ctrl.open).toBe(true);
  });

  test("commit with nothing open is a no-op", async () => {
    const h = make();
    await h.ctrl.commit("x");
    expect(h.commitEngine.calls.length).toBe(0);
  });
});

describe("cancel", () => {
  test("discards the edit, unmasks, and closes without committing", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "text\n";
    await h.ctrl.show({ chapter: "ch1.md", range: [0, 1] });
    h.ctrl.cancel();
    expect(h.ctrl.open).toBe(false);
    expect(h.commitEngine.calls.length).toBe(0);
    expect(h.client.maskCalls.at(-1)).toEqual({ chapter: "ch1.md", range: [0, 1], masked: false });
  });
});

// ── onDestroy defense-in-depth ───────────────────────────────────────────────

describe("teardown", () => {
  test("always unmasks the captured block, even called standalone (defense-in-depth onDestroy)", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "text\n";
    await h.ctrl.show({ chapter: "ch1.md", range: [0, 1] });
    h.client.maskCalls = []; // clear the show()-time mask-on call
    h.ctrl.teardown();
    expect(h.client.maskCalls).toEqual([{ chapter: "ch1.md", range: [0, 1], masked: false }]);
  });

  test("teardown with nothing captured does nothing", () => {
    const h = make();
    h.ctrl.teardown();
    expect(h.client.maskCalls.length).toBe(0);
  });

  test("teardown is idempotent (commit already tore down; a later onDestroy call is a harmless no-op)", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "text\n";
    await h.ctrl.show({ chapter: "ch1.md", range: [0, 1] });
    await h.ctrl.commit("edited\n");
    const callsBefore = h.client.maskCalls.length;
    h.ctrl.teardown(); // simulates BlockEditOverlay.svelte's onMount cleanup running after commit() already closed
    expect(h.client.maskCalls.length).toBe(callsBefore); // nothing captured anymore — no new call
  });
});

// ── dismissal matrix ─────────────────────────────────────────────────────────

describe("renderingComplete", () => {
  test("bumps the commit engine's generation", async () => {
    const h = make();
    h.client.emit({ name: "renderingComplete", detail: {} });
    expect(h.commitEngine.generation).toBe(1);
  });

  test("re-anchors via {chapter, range} and re-masks the (possibly new) elements when the overlay is open", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "text\n";
    h.client.rectsForResponses = [
      { rects: [{ top: 10, left: 20, width: 100, height: 40, page: 1 }] }, // show()'s own getRectsFor
      { rects: [{ top: 50, left: 60, width: 100, height: 40, page: 1 }] }, // post-splice re-anchor
    ];
    await h.ctrl.show({ chapter: "ch1.md", range: [0, 1] });
    h.client.emit({ name: "renderingComplete", detail: {} });
    await flush();
    expect(h.ctrl.open).toBe(true);
    expect(h.client.rectsForCalls[1]).toEqual({ chapter: "ch1.md", range: [0, 1] });
    expect(h.client.maskCalls).toContainEqual({ chapter: "ch1.md", range: [0, 1], masked: true });
  });

  test("closes with an informational toast when the block no longer resolves", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "text\n";
    h.client.rectsForResponses = [
      { rects: [{ top: 10, left: 20, width: 100, height: 40, page: 1 }] },
      { rects: [] },
    ];
    await h.ctrl.show({ chapter: "ch1.md", range: [0, 1] });
    h.client.emit({ name: "renderingComplete", detail: {} });
    await flush();
    expect(h.ctrl.open).toBe(false);
    expect(h.toastInfoCalls).toEqual(["This section changed — reopen to edit."]);
    expect(h.commitEngine.calls.length).toBe(0); // discarded, never committed
  });

  test("does nothing when the overlay isn't open", async () => {
    const h = make();
    h.client.emit({ name: "renderingComplete", detail: {} });
    await flush();
    expect(h.ctrl.open).toBe(false);
    expect(h.client.rectsForCalls.length).toBe(0);
  });
});

describe("pageChanged", () => {
  test("re-anchors via {chapter, range} (DOM unchanged, only geometry moved)", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "text\n";
    h.client.rectsForResponses = [
      { rects: [{ top: 10, left: 20, width: 100, height: 40, page: 1 }] },
      { rects: [{ top: 999, left: 20, width: 100, height: 40, page: 2 }] },
    ];
    await h.ctrl.show({ chapter: "ch1.md", range: [0, 1] });
    const yBefore = h.ctrl.y;
    h.client.emit({ name: "pageChanged", detail: {} });
    await flush();
    expect(h.client.rectsForCalls[1]).toEqual({ chapter: "ch1.md", range: [0, 1] });
    expect(h.ctrl.y).not.toBe(yBefore);
    expect(h.ctrl.open).toBe(true); // pageChanged never closes the overlay
  });

  test("does nothing when the overlay isn't open", async () => {
    const h = make();
    h.client.emit({ name: "pageChanged", detail: {} });
    await flush();
    expect(h.client.rectsForCalls.length).toBe(0);
  });

  test("an older re-anchor cannot overwrite newer geometry", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "text\n";
    await h.ctrl.show({ chapter: "ch1.md", range: [0, 1] });
    const pending: Array<(result: RectsForResult) => void> = [];
    h.client.getRectsForImpl = () => new Promise((resolve) => pending.push(resolve));

    h.client.emit({ name: "pageChanged", detail: {} });
    await flush();
    h.client.emit({ name: "pageChanged", detail: {} });
    await flush();
    pending[1]!({ rects: [{ top: 20, left: 200, width: 100, height: 40, page: 1 }] });
    await flush();
    expect(h.ctrl.x).toBe(200);
    pending[0]!({ rects: [{ top: 20, left: 10, width: 100, height: 40, page: 1 }] });
    await flush();
    expect(h.ctrl.x).toBe(200);
  });
});

describe("viewportChanged", () => {
  test("re-anchors an open overlay after iframe resize or scroll", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "text\n";
    h.client.rectsForResponses = [
      { rects: [{ top: 10, left: 20, width: 100, height: 40, page: 1 }] },
      { rects: [{ top: 80, left: 220, width: 100, height: 40, page: 1 }] },
    ];
    await h.ctrl.show({ chapter: "ch1.md", range: [0, 1] });

    h.client.emit({ name: "viewportChanged", detail: {} });
    await flush();
    expect(h.client.rectsForCalls[1]).toEqual({ chapter: "ch1.md", range: [0, 1] });
    expect(h.ctrl.x).toBe(220);
    expect(h.ctrl.y).toBe(80);
  });
});

// ── boundary-rule round-trips (plan §5.5) ────────────────────────────────────

describe("splitTrailingBlankRun", () => {
  test("no trailing newline (last block in a file): nothing stripped", () => {
    expect(splitTrailingBlankRun("para text")).toEqual({ editable: "para text", trailingBlank: "" });
  });

  test("single trailing newline, no blank-line gap: nothing stripped", () => {
    expect(splitTrailingBlankRun("para text\n")).toEqual({ editable: "para text\n", trailingBlank: "" });
  });

  test("blank-line gap after the block: stripped, exactly reversible", () => {
    const result = splitTrailingBlankRun("para text\n\n\n");
    expect(result).toEqual({ editable: "para text\n", trailingBlank: "\n\n" });
    expect(result.editable + result.trailingBlank).toBe("para text\n\n\n");
  });

  test("fence closing line retained (non-blank — never stripped)", () => {
    const slice = "```js\nconst x = 1;\n```\n\n";
    const result = splitTrailingBlankRun(slice);
    expect(result.editable).toBe("```js\nconst x = 1;\n```\n");
    expect(result.trailingBlank).toBe("\n");
    expect(result.editable + result.trailingBlank).toBe(slice);
  });

  test("CRLF line endings round-trip identically", () => {
    const slice = "para text\r\n\r\n\r\n";
    const result = splitTrailingBlankRun(slice);
    expect(result.editable).toBe("para text\r\n");
    expect(result.trailingBlank).toBe("\r\n\r\n");
    expect(result.editable + result.trailingBlank).toBe(slice);
  });
});

describe("boundary round-trip via show()/commit() with an UNEDITED body", () => {
  test("re-committing the unedited initialText reproduces the exact original slice", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "before\npara text\n\n\nafter\n";
    await h.ctrl.show({ chapter: "ch1.md", range: [1, 4] });
    await h.ctrl.commit(h.ctrl.initialText);
    const call = h.commitEngine.calls[0] as { expected: string; replacement: string };
    expect(call.replacement).toBe(call.expected); // byte-identical round trip when nothing was edited
  });

  test("last block in the file (no trailing newline) round-trips with no reappended run", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "before\nlast line";
    await h.ctrl.show({ chapter: "ch1.md", range: [1, 2] });
    expect(h.ctrl.initialText).toBe("last line");
    await h.ctrl.commit("last line");
    const call = h.commitEngine.calls[0] as { expected: string; replacement: string };
    expect(call.expected).toBe("last line");
    expect(call.replacement).toBe("last line");
  });
});
