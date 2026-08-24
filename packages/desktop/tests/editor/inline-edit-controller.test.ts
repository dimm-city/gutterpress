import { test, expect, describe } from "bun:test";
import {
  InlineEditController,
  splitTrailingBlankRun,
  type InlineEditClient,
  type InlineEditDeps,
} from "../../src/lib/routes/inline-edit-controller.svelte";
import type { CommitEngine } from "$lib/editor/commit-engine";
import type { PreviewEvent, SourceRange } from "$lib/preview-client";

// Bun imports the rune-bearing .svelte.ts module without Svelte's compiler in
// these unit tests (same shim as context-menu-controller.test.ts / zoom-view-
// controller.test / buffer-state.test).
(globalThis as unknown as { $state?: <T>(value: T) => T }).$state ??= (value) => value;

/**
 * inline-edit-controller.svelte.ts (docs/inline-editing-plan.md §3.3) — the
 * SPA half of in-flow block editing: read the source from the AUTHORITATIVE
 * buffer, capture the commit gate's inputs, and hand text to the commit
 * engine.
 *
 * The tests that matter most here are the ones about what is NOT allowed:
 * committing text the author cancelled, and opening an edit against source
 * ranges that a just-landed commit has invalidated (`pendingRender`).
 */

class FakeClient implements InlineEditClient {
  private listeners: Array<(e: PreviewEvent) => void> = [];
  beginCalls: Array<{ chapter: string; range: SourceRange; text: string; caret?: { x: number; y: number } }> = [];
  endCalls: Array<{ commit: boolean }> = [];
  beginResult: { ok: boolean; reason?: string } = { ok: true };
  /** What endBlockEdit() hands back — the text as it stands in the book document. */
  endText: string | null = "text from the book";
  beginThrows = false;

  on(fn: (e: PreviewEvent) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }
  emit(e: PreviewEvent): void {
    for (const l of this.listeners) l(e);
  }
  async beginBlockEdit(spec: {
    chapter: string;
    range: SourceRange;
    text: string;
    caret?: { x: number; y: number };
  }): Promise<{ ok: boolean; reason?: string }> {
    this.beginCalls.push(spec);
    if (this.beginThrows) throw new Error("bridge down");
    return this.beginResult;
  }
  async endBlockEdit(spec: { commit: boolean }): Promise<{ ended: boolean; text: string | null }> {
    this.endCalls.push(spec);
    return { ended: true, text: this.endText };
  }
}

class FakeCommitEngine {
  generation = 0;
  calls: Array<{
    chapter: string;
    range: SourceRange;
    expected: string;
    replacement: string;
    expectedGeneration: number;
  }> = [];
  result: { ok: true; flushed: boolean } | { ok: false; reason: string; message: string } = {
    ok: true,
    flushed: true,
  };
  noteRenderingComplete(): void {
    this.generation++;
  }
  async commitRangePatch(patch: {
    chapter: string;
    range: SourceRange;
    expected: string;
    replacement: string;
    expectedGeneration: number;
  }) {
    this.calls.push(patch);
    this.generation++;
    return this.result;
  }
}

interface Harness {
  ctrl: InlineEditController;
  client: FakeClient;
  commitEngine: FakeCommitEngine;
  currentDir: string | null;
  openContent: Map<string, string>;
  readFileMap: Record<string, string>;
  toastErrorCalls: string[];
  toastInfoCalls: string[];
}

function make(): Harness {
  const client = new FakeClient();
  const commitEngine = new FakeCommitEngine();
  const h: Harness = {
    ctrl: undefined as unknown as InlineEditController,
    client,
    commitEngine,
    currentDir: "/proj",
    openContent: new Map<string, string>(),
    readFileMap: {},
    toastErrorCalls: [],
    toastInfoCalls: [],
  };
  const deps: InlineEditDeps = {
    client: () => client,
    currentDir: () => h.currentDir,
    openContent: (path: string) => h.openContent.get(path) ?? null,
    readFile: async (path: string) => {
      if (path in h.readFileMap) return h.readFileMap[path]!;
      throw new Error(`not found: ${path}`);
    },
    commitEngine: commitEngine as unknown as CommitEngine,
    toastError: (m) => h.toastErrorCalls.push(m),
    toastInfo: (m) => h.toastInfoCalls.push(m),
  };
  h.ctrl = new InlineEditController(deps);
  h.ctrl.subscribe(client);
  return h;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

// ── opening ──────────────────────────────────────────────────────────────────

describe("show", () => {
  test("sends the buffer slice as the editable source and opens", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "before\npara text\nafter\n";
    await h.ctrl.show({ chapter: "ch1.md", range: [1, 2] });
    expect(h.ctrl.open).toBe(true);
    expect(h.client.beginCalls).toEqual([
      { chapter: "ch1.md", range: [1, 2], text: "para text\n", caret: undefined },
    ]);
  });

  test("prefers the live buffer over readFile for the same chapter", async () => {
    const h = make();
    h.openContent.set("/proj/ch1.md", "line one\nline two\n");
    h.readFileMap["/proj/ch1.md"] = "STALE\n";
    await h.ctrl.show({ chapter: "ch1.md", range: [1, 2] });
    expect(h.client.beginCalls[0]!.text).toBe("line two\n");
  });

  test("passes the caret point through so the caret lands where the author aimed", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "para\n";
    await h.ctrl.show({ chapter: "ch1.md", range: [0, 1], caret: { x: 12, y: 34 } });
    expect(h.client.beginCalls[0]!.caret).toEqual({ x: 12, y: 34 });
  });

  test("no project open: does nothing", async () => {
    const h = make();
    h.currentDir = null;
    await h.ctrl.show({ chapter: "ch1.md", range: [0, 1] });
    expect(h.ctrl.open).toBe(false);
    expect(h.client.beginCalls).toEqual([]);
  });

  test("unreadable chapter: toasts and stays closed", async () => {
    const h = make();
    await h.ctrl.show({ chapter: "missing.md", range: [0, 1] });
    expect(h.ctrl.open).toBe(false);
    expect(h.toastErrorCalls).toEqual(["Couldn't read this chapter's source."]);
  });

  test("the block no longer resolves on the page: toasts and stays closed", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "para\n";
    h.client.beginResult = { ok: false, reason: "unresolved" };
    await h.ctrl.show({ chapter: "ch1.md", range: [0, 1] });
    expect(h.ctrl.open).toBe(false);
    expect(h.toastErrorCalls).toEqual(["Couldn't locate this block on the page."]);
  });

  test("a bridge failure is not a crash", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "para\n";
    h.client.beginThrows = true;
    await h.ctrl.show({ chapter: "ch1.md", range: [0, 1] });
    expect(h.ctrl.open).toBe(false);
    expect(h.toastErrorCalls.length).toBe(1);
  });
});

// ── the double-click entry point ─────────────────────────────────────────────

describe("blockEditRequested", () => {
  test("a double-click in the book opens an edit on that block", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "one\ntwo\n";
    h.client.emit({
      name: "blockEditRequested",
      detail: { chapter: "ch1.md", range: [1, 2], x: 7, y: 9, via: "dblclick" },
    });
    await flush();
    expect(h.ctrl.open).toBe(true);
    expect(h.client.beginCalls).toEqual([
      { chapter: "ch1.md", range: [1, 2], text: "two\n", caret: { x: 7, y: 9 } },
    ]);
  });

  test("a request with no range is ignored", async () => {
    const h = make();
    h.client.emit({ name: "blockEditRequested", detail: { chapter: "ch1.md" } });
    await flush();
    expect(h.ctrl.open).toBe(false);
    expect(h.client.beginCalls).toEqual([]);
  });
});

// ── committing ───────────────────────────────────────────────────────────────

describe("blockEditFinished", () => {
  test("commits through the engine with the captured gate inputs", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "before\npara text\nafter\n";
    await h.ctrl.show({ chapter: "ch1.md", range: [1, 2] });
    const generationAtOpen = h.commitEngine.generation;

    h.client.emit({
      name: "blockEditFinished",
      detail: { text: "edited text\n", commit: true, chapter: "ch1.md", range: [1, 2] },
    });
    await flush();

    expect(h.commitEngine.calls).toEqual([
      {
        chapter: "ch1.md",
        range: [1, 2],
        expected: "para text\n",
        replacement: "edited text\n",
        expectedGeneration: generationAtOpen,
      },
    ]);
    expect(h.ctrl.open).toBe(false);
  });

  test("cancelling writes nothing", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "para\n";
    await h.ctrl.show({ chapter: "ch1.md", range: [0, 1] });
    h.client.emit({ name: "blockEditFinished", detail: { text: "typed then abandoned", commit: false } });
    await flush();
    expect(h.commitEngine.calls).toEqual([]);
    expect(h.ctrl.open).toBe(false);
  });

  test("a refused commit surfaces the engine's reason", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "para\n";
    h.commitEngine.result = { ok: false, reason: "dirty-buffer", message: "Save your changes first." };
    await h.ctrl.show({ chapter: "ch1.md", range: [0, 1] });
    h.client.emit({ name: "blockEditFinished", detail: { text: "x\n", commit: true } });
    await flush();
    expect(h.toastErrorCalls).toEqual(["Save your changes first."]);
  });

  test("the trailing blank run is re-appended verbatim, so blocks cannot be merged", async () => {
    const h = make();
    // Two blocks separated by a blank line: the range covers the paragraph AND
    // the blank line after it.
    h.readFileMap["/proj/ch1.md"] = "first para\n\nsecond para\n";
    await h.ctrl.show({ chapter: "ch1.md", range: [0, 2] });
    // The author never sees (and so cannot delete) the separating blank line.
    expect(h.client.beginCalls[0]!.text).toBe("first para\n");
    h.client.emit({ name: "blockEditFinished", detail: { text: "first para EDITED", commit: true } });
    await flush();
    expect(h.commitEngine.calls[0]!.replacement).toBe("first para EDITED\n");
    expect(h.commitEngine.calls[0]!.expected).toBe("first para\n\n");
  });
});

// ── host-initiated end ───────────────────────────────────────────────────────

describe("endActive", () => {
  test("reads the text back over the bridge and commits it", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "para\n";
    await h.ctrl.show({ chapter: "ch1.md", range: [0, 1] });
    h.client.endText = "text as it stood\n";
    await h.ctrl.endActive(true);
    expect(h.client.endCalls).toEqual([{ commit: true }]);
    expect(h.commitEngine.calls[0]!.replacement).toBe("text as it stood\n");
    expect(h.ctrl.open).toBe(false);
  });

  test("with nothing open it is a no-op — no bridge traffic", async () => {
    const h = make();
    await h.ctrl.endActive(true);
    expect(h.client.endCalls).toEqual([]);
    expect(h.commitEngine.calls).toEqual([]);
  });
});

// ── the stale-range guard ────────────────────────────────────────────────────

describe("pendingRender", () => {
  test("refuses to open between a commit and the re-render", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "one\ntwo\nthree\n";
    await h.ctrl.show({ chapter: "ch1.md", range: [0, 1] });
    h.client.emit({ name: "blockEditFinished", detail: { text: "ONE EDITED\n", commit: true } });
    await flush();
    expect(h.commitEngine.calls.length).toBe(1);

    // Every data-source-range on screen was computed from PRE-commit content,
    // so a range arriving now indexes the wrong lines. The slice captured at it
    // would match itself at commit time and write to the wrong place — the
    // generation counter cannot catch this, because the capture happens AFTER
    // the commit that bumped it.
    h.client.beginCalls.length = 0;
    await h.ctrl.show({ chapter: "ch1.md", range: [1, 2] });
    expect(h.ctrl.open).toBe(false);
    expect(h.client.beginCalls).toEqual([]);
    expect(h.toastInfoCalls).toEqual(["Updating the preview — try that again in a moment."]);
  });

  test("the next render clears it", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "one\ntwo\n";
    await h.ctrl.show({ chapter: "ch1.md", range: [0, 1] });
    h.client.emit({ name: "blockEditFinished", detail: { text: "x\n", commit: true } });
    await flush();
    h.client.emit({ name: "renderingComplete", detail: {} });
    await flush();
    await h.ctrl.show({ chapter: "ch1.md", range: [1, 2] });
    expect(h.ctrl.open).toBe(true);
  });

  test("a REFUSED commit does not brick the next edit", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "one\ntwo\n";
    h.commitEngine.result = { ok: false, reason: "dirty-buffer", message: "nope" };
    await h.ctrl.show({ chapter: "ch1.md", range: [0, 1] });
    h.client.emit({ name: "blockEditFinished", detail: { text: "x\n", commit: true } });
    await flush();
    // Nothing was written, so the DOM's ranges still match the buffer.
    await h.ctrl.show({ chapter: "ch1.md", range: [1, 2] });
    expect(h.ctrl.open).toBe(true);
  });

  test("chaining from the menu does not walk past the guard", async () => {
    // show() with an edit already open ends it first — which COMMITS it, which
    // invalidates the very range this call is carrying. Checking the guard only
    // on entry would have opened an edit against stale line numbers.
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "one\ntwo\nthree\n";
    await h.ctrl.show({ chapter: "ch1.md", range: [0, 1] });
    expect(h.ctrl.open).toBe(true);
    h.client.endText = "ONE EDITED\n";

    h.client.beginCalls.length = 0;
    await h.ctrl.show({ chapter: "ch1.md", range: [1, 2] });
    expect(h.commitEngine.calls.length).toBe(1);
    expect(h.commitEngine.calls[0]!.range).toEqual([0, 1]);
    expect(h.ctrl.open).toBe(false);
    expect(h.client.beginCalls).toEqual([]);
    expect(h.toastInfoCalls).toEqual(["Updating the preview — try that again in a moment."]);
  });

  test("a cancelled edit never sets the guard", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "one\ntwo\n";
    await h.ctrl.show({ chapter: "ch1.md", range: [0, 1] });
    h.client.emit({ name: "blockEditFinished", detail: { text: "abandoned", commit: false } });
    await flush();
    await h.ctrl.show({ chapter: "ch1.md", range: [1, 2] });
    expect(h.ctrl.open).toBe(true);
  });
});

// ── fail-safe on a render that lands mid-edit ────────────────────────────────

describe("renderingComplete while open", () => {
  test("discards the in-progress edit rather than committing against stale DOM", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "para\n";
    await h.ctrl.show({ chapter: "ch1.md", range: [0, 1] });
    h.client.emit({ name: "renderingComplete", detail: {} });
    await flush();
    expect(h.ctrl.open).toBe(false);
    expect(h.commitEngine.calls).toEqual([]);
    expect(h.toastInfoCalls).toEqual(["This section changed — reopen to edit."]);
  });

  test("bumps the engine's generation so any stale capture is invalidated", async () => {
    const h = make();
    const before = h.commitEngine.generation;
    h.client.emit({ name: "renderingComplete", detail: {} });
    await flush();
    expect(h.commitEngine.generation).toBeGreaterThan(before);
  });
});

// ── the source-boundary rule ─────────────────────────────────────────────────

describe("splitTrailingBlankRun", () => {
  test("keeps the block's own terminator, strips only blank lines", () => {
    expect(splitTrailingBlankRun("para\n")).toEqual({ editable: "para\n", trailingBlank: "" });
    expect(splitTrailingBlankRun("para\n\n")).toEqual({ editable: "para\n", trailingBlank: "\n" });
    expect(splitTrailingBlankRun("para\n\n\n")).toEqual({ editable: "para\n", trailingBlank: "\n\n" });
  });

  test("a block with no trailing newline (last in file) strips nothing", () => {
    expect(splitTrailingBlankRun("para")).toEqual({ editable: "para", trailingBlank: "" });
  });

  test("a fence's closing line is not whitespace, so it is never touched", () => {
    expect(splitTrailingBlankRun("```js\nx\n```\n\n")).toEqual({
      editable: "```js\nx\n```\n",
      trailingBlank: "\n",
    });
  });

  test("CRLF files split on the same token boundaries", () => {
    expect(splitTrailingBlankRun("para\r\n\r\n")).toEqual({ editable: "para\r\n", trailingBlank: "\r\n" });
  });
});
