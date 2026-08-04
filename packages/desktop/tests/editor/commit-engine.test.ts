import { test, expect, describe } from "bun:test";
import {
  CommitEngine,
  type CommitEngineBuffer,
  type CommitEngineDeps,
  type CommitPatch,
} from "../../src/lib/editor/commit-engine";

/**
 * commit-engine.ts (inline-editing plan §4.7) — every GATE-0 branch, Steps
 * 1-5, and the §4.9 dirty-buffer misalignment repro, driven with injected
 * fakes (the established pattern from editor-preview-sync-controller.test.ts).
 */

class FakeBuffer implements CommitEngineBuffer {
  filePath: string | null = null;
  content = "";
  diskContent = "";
  phase: "clean" | "dirty" | "saving" | "error" = "clean";
  externalChange: unknown | null = null;
  hasPendingSave = false;

  reconcileCalls = 0;
  flushCalls = 0;
  editCalls: string[] = [];
  flushShouldThrow = false;
  /** Optional hook run inside reconcileExternalChange (simulates a race). */
  onReconcile: (() => void) | null = null;

  async reconcileExternalChange(): Promise<void> {
    this.reconcileCalls++;
    this.onReconcile?.();
  }

  async flush(): Promise<void> {
    this.flushCalls++;
    if (this.flushShouldThrow) throw new Error("external change detected");
  }

  edit(text: string): void {
    this.editCalls.push(text);
    this.content = text;
  }
}

/** Loads `text` as a clean buffer at `absPath` (content === diskContent). */
function loadClean(buf: FakeBuffer, absPath: string, text: string): void {
  buf.filePath = absPath;
  buf.content = text;
  buf.diskContent = text;
  buf.phase = "clean";
  buf.externalChange = null;
}

interface Harness {
  engine: CommitEngine;
  buf: FakeBuffer;
  dir: string;
  rendering: boolean;
  selectEditorFileCalls: string[];
  selectEditorFileResult: boolean;
  /** When set, selectEditorFile "switches" the live buffer to this instance. */
  selectEditorFileSwitchTo: FakeBuffer | null;
  getAppliedPathValue: string | null;
  applyRangeEditCalls: Array<{ from: number; to: number; insert: string }>;
}

function make(): Harness {
  const buf = new FakeBuffer();
  let liveBuffer: FakeBuffer = buf;
  const h: Harness = {
    engine: undefined as unknown as CommitEngine,
    buf,
    dir: "/proj",
    rendering: false,
    selectEditorFileCalls: [],
    selectEditorFileResult: true,
    selectEditorFileSwitchTo: null,
    getAppliedPathValue: null,
    applyRangeEditCalls: [],
  };
  const deps: CommitEngineDeps = {
    currentDir: () => h.dir,
    rendering: () => h.rendering,
    buffer: () => liveBuffer,
    selectEditorFile: async (path: string) => {
      h.selectEditorFileCalls.push(path);
      if (h.selectEditorFileSwitchTo) liveBuffer = h.selectEditorFileSwitchTo;
      return h.selectEditorFileResult;
    },
    getAppliedPath: () => h.getAppliedPathValue,
    applyRangeEdit: (from, to, insert) => {
      h.applyRangeEditCalls.push({ from, to, insert });
    },
  };
  h.engine = new CommitEngine(deps);
  return h;
}

function patch(over: Partial<CommitPatch> = {}): CommitPatch {
  return {
    chapter: "ch1.md",
    range: [1, 2],
    expected: "line two\n",
    replacement: "line TWO\n",
    expectedGeneration: 0,
    ...over,
  };
}

// ── generation counter ────────────────────────────────────────────────────────

describe("generation counter", () => {
  test("starts at 0", () => {
    const h = make();
    expect(h.engine.generation).toBe(0);
  });

  test("noteRenderingComplete increments it", () => {
    const h = make();
    h.engine.noteRenderingComplete();
    h.engine.noteRenderingComplete();
    expect(h.engine.generation).toBe(2);
  });
});

// ── GATE 0a: path resolution ────────────────────────────────────────────────

describe("GATE 0a — path resolution", () => {
  test("refuses when no project is open", async () => {
    const h = make();
    h.dir = "" as unknown as string;
    // simulate "no project" via currentDir() returning null
    const engine = new CommitEngine({
      currentDir: () => null,
      rendering: () => false,
      buffer: () => h.buf,
      selectEditorFile: async () => true,
      getAppliedPath: () => null,
      applyRangeEdit: () => {},
    });
    const outcome = await engine.commitRangePatch(patch());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("no-project");
  });

  test.each([
    ["../escape.md"],
    ["/absolute.md"],
    ["sub/../../escape.md"],
    ["a\\b.md"],
    ["C:\\evil.md"],
    [""],
    ["./ch1.md"],
  ])("refuses an unsafe chapter id: %s", async (chapter) => {
    const h = make();
    const outcome = await h.engine.commitRangePatch(patch({ chapter }));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("unsafe-chapter-path");
    expect(h.selectEditorFileCalls.length).toBe(0);
  });

  test("accepts a nested-but-safe chapter id", async () => {
    const h = make();
    loadClean(h.buf, "/proj/sub/ch1.md", "a\nline two\nc\n");
    const outcome = await h.engine.commitRangePatch(patch({ chapter: "sub/ch1.md" }));
    expect(outcome.ok).toBe(true);
  });
});

// ── GATE 0b: render-in-flight / generation ──────────────────────────────────

describe("GATE 0b — render in flight / generation", () => {
  test("refuses while a render is in flight", async () => {
    const h = make();
    h.rendering = true;
    const outcome = await h.engine.commitRangePatch(patch());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("render-in-flight");
  });

  test("refuses when expectedGeneration is stale", async () => {
    const h = make();
    h.engine.noteRenderingComplete(); // generation -> 1
    const outcome = await h.engine.commitRangePatch(patch({ expectedGeneration: 0 }));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("stale-generation");
  });

  test("accepts a current expectedGeneration", async () => {
    const h = make();
    h.engine.noteRenderingComplete(); // generation -> 1
    loadClean(h.buf, "/proj/ch1.md", "a\nline two\nc\n");
    const outcome = await h.engine.commitRangePatch(patch({ expectedGeneration: 1 }));
    expect(outcome.ok).toBe(true);
  });
});

// ── GATE 0c freshness / clean-buffer gate ───────────────────────────────────

describe("GATE 0c — freshness / clean-buffer gate", () => {
  test("same-chapter fast path calls reconcileExternalChange before composing the patch", async () => {
    const h = make();
    loadClean(h.buf, "/proj/ch1.md", "a\nline two\nc\n");
    await h.engine.commitRangePatch(patch());
    expect(h.buf.reconcileCalls).toBe(1);
  });

  test("refuses a DIRTY same-chapter buffer (content !== diskContent)", async () => {
    const h = make();
    h.buf.filePath = "/proj/ch1.md";
    h.buf.diskContent = "a\nline two\nc\n";
    h.buf.content = "a\nline two EDITED\nc\n"; // dirty
    h.buf.phase = "dirty";
    const outcome = await h.engine.commitRangePatch(patch());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("not-clean");
  });

  test("refuses a buffer in error phase even if content === diskContent", async () => {
    const h = make();
    loadClean(h.buf, "/proj/ch1.md", "a\nline two\nc\n");
    h.buf.phase = "error";
    const outcome = await h.engine.commitRangePatch(patch());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("not-clean");
  });

  test("refuses a buffer with a pending externalChange", async () => {
    const h = make();
    loadClean(h.buf, "/proj/ch1.md", "a\nline two\nc\n");
    h.buf.externalChange = { diskContent: "x", diskMtimeMs: 1 };
    const outcome = await h.engine.commitRangePatch(patch());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("not-clean");
  });

  test("THE DIRTY-BUFFER MISALIGNMENT REPRO (§4.9): the gate refuses BEFORE the slice-equality check even when the slice would trivially match", async () => {
    // Two boilerplate occurrences of the exact same line — a slice comparison
    // alone cannot distinguish "the buffer moved since open" from "nothing
    // changed". Only the clean-buffer gate catches this.
    const h = make();
    const REPEATED = "Disclaimer text.\n";
    h.buf.filePath = "/proj/ch1.md";
    h.buf.diskContent = `${REPEATED}other\n${REPEATED}`;
    h.buf.content = `${REPEATED}EDITED\n${REPEATED}`; // dirty: line 2 changed
    h.buf.phase = "dirty";
    // range [2,3) still slices to REPEATED in the DIRTY content too (both
    // occurrences are identical) — a naive slice check would pass.
    const outcome = await h.engine.commitRangePatch(
      patch({ range: [2, 3], expected: REPEATED, replacement: "CHANGED\n" }),
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("not-clean");
    expect(h.buf.editCalls.length).toBe(0);
  });

  test("chapter-changed: a race during reconcile that swaps the open file aborts safely", async () => {
    const h = make();
    loadClean(h.buf, "/proj/ch1.md", "a\nline two\nc\n");
    h.buf.onReconcile = () => {
      h.buf.filePath = "/proj/ch2.md"; // simulate a concurrent switch
    };
    const outcome = await h.engine.commitRangePatch(patch());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("chapter-changed");
  });
});

// ── Step 1: cross-chapter selection / flush-outgoing ────────────────────────

describe("Step 1 — ensure buffer holds the target chapter", () => {
  test("cross-chapter: calls selectEditorFile with the joined path, never buffer.load() directly", async () => {
    const h = make();
    const target = new FakeBuffer();
    loadClean(target, "/proj/ch2.md", "a\nline two\nc\n");
    h.selectEditorFileSwitchTo = target;
    const outcome = await h.engine.commitRangePatch(patch({ chapter: "ch2.md" }));
    expect(h.selectEditorFileCalls).toEqual(["/proj/ch2.md"]);
    expect(outcome.ok).toBe(true);
  });

  test("flushes a dirty OUTGOING file directly before switching (distinct message on throw)", async () => {
    const h = make();
    h.buf.filePath = "/proj/other.md";
    h.buf.hasPendingSave = true;
    h.buf.flushShouldThrow = true;
    const outcome = await h.engine.commitRangePatch(patch({ chapter: "ch2.md" }));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("flush-outgoing-failed");
      expect(outcome.message).toContain("other.md");
    }
    // Never reached selectEditorFile — the outgoing flush failed first.
    expect(h.selectEditorFileCalls.length).toBe(0);
  });

  test("a clean/non-pending outgoing file does not need a flush before switching", async () => {
    const h = make();
    h.buf.filePath = "/proj/other.md";
    h.buf.hasPendingSave = false;
    const target = new FakeBuffer();
    loadClean(target, "/proj/ch2.md", "a\nline two\nc\n");
    h.selectEditorFileSwitchTo = target;
    const outcome = await h.engine.commitRangePatch(patch({ chapter: "ch2.md" }));
    expect(outcome.ok).toBe(true);
    expect(h.buf.flushCalls).toBe(0);
  });

  test("load-failed: selectEditorFile resolving false aborts", async () => {
    const h = make();
    h.selectEditorFileResult = false;
    const outcome = await h.engine.commitRangePatch(patch({ chapter: "ch2.md" }));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("load-failed");
  });

  test("load-failed: selectEditorFile can resolve true with phase 'error' — re-checked by the clean gate", async () => {
    const h = make();
    const target = new FakeBuffer();
    target.filePath = "/proj/ch2.md";
    target.phase = "error"; // a failed read still records the path (review-verified)
    target.content = "";
    target.diskContent = "";
    h.selectEditorFileSwitchTo = target;
    h.selectEditorFileResult = true;
    const outcome = await h.engine.commitRangePatch(patch({ chapter: "ch2.md" }));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("not-clean");
  });
});

// ── Step 2/3: offset resolution + mismatch ──────────────────────────────────

describe("Steps 2-3 — offsets + mismatch", () => {
  test("malformed-range: a non-finite/inverted range aborts", async () => {
    const h = make();
    loadClean(h.buf, "/proj/ch1.md", "a\nline two\nc\n");
    const outcome = await h.engine.commitRangePatch(patch({ range: [5, 2] }));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("malformed-range");
  });

  test("mismatch: the captured `expected` no longer matches the live slice", async () => {
    const h = make();
    loadClean(h.buf, "/proj/ch1.md", "a\nDRIFTED\nc\n");
    const outcome = await h.engine.commitRangePatch(patch({ expected: "line two\n" }));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("mismatch");
    expect(h.buf.editCalls.length).toBe(0);
  });

  test("degradeLine is range[0]+1 on any failure", async () => {
    const h = make();
    h.rendering = true;
    const outcome = await h.engine.commitRangePatch(patch({ range: [4, 5] }));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.degradeLine).toBe(5);
  });
});

// ── Step 4: apply path (editor-mounted vs buffer-only) ──────────────────────

describe("Step 4 — apply path", () => {
  test("editor-mounted on the target file: applies via applyRangeEdit, not buffer.edit", async () => {
    const h = make();
    loadClean(h.buf, "/proj/ch1.md", "a\nline two\nc\n");
    h.getAppliedPathValue = "/proj/ch1.md";
    const outcome = await h.engine.commitRangePatch(patch());
    expect(outcome.ok).toBe(true);
    expect(h.applyRangeEditCalls).toEqual([{ from: 2, to: 11, insert: "line TWO\n" }]);
    expect(h.buf.editCalls.length).toBe(0);
  });

  test("editor mounted on a DIFFERENT file: applies via buffer.edit, not applyRangeEdit", async () => {
    const h = make();
    loadClean(h.buf, "/proj/ch1.md", "a\nline two\nc\n");
    h.getAppliedPathValue = "/proj/some-other-file.md";
    const outcome = await h.engine.commitRangePatch(patch());
    expect(outcome.ok).toBe(true);
    expect(h.applyRangeEditCalls.length).toBe(0);
    expect(h.buf.editCalls).toEqual(["a\nline TWO\nc\n"]);
  });

  test("no editor mounted (getAppliedPath null): applies via buffer.edit", async () => {
    const h = make();
    loadClean(h.buf, "/proj/ch1.md", "a\nline two\nc\n");
    h.getAppliedPathValue = null;
    const outcome = await h.engine.commitRangePatch(patch());
    expect(outcome.ok).toBe(true);
    expect(h.buf.editCalls).toEqual(["a\nline TWO\nc\n"]);
  });

  test("a successful apply increments the generation counter", async () => {
    const h = make();
    loadClean(h.buf, "/proj/ch1.md", "a\nline two\nc\n");
    expect(h.engine.generation).toBe(0);
    await h.engine.commitRangePatch(patch());
    expect(h.engine.generation).toBe(1);
  });
});

// ── Step 5: flush ────────────────────────────────────────────────────────────

describe("Step 5 — flush", () => {
  test("flushes immediately after apply (does not sit behind the autosave debounce)", async () => {
    const h = make();
    loadClean(h.buf, "/proj/ch1.md", "a\nline two\nc\n");
    const outcome = await h.engine.commitRangePatch(patch());
    expect(h.buf.flushCalls).toBe(1);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.flushed).toBe(true);
  });

  test("a flush() throw (external conflict) is still an 'ok' outcome with flushed:false — the edit landed, the buffer's own conflict banner is now showing", async () => {
    const h = make();
    loadClean(h.buf, "/proj/ch1.md", "a\nline two\nc\n");
    h.buf.flushShouldThrow = true;
    const outcome = await h.engine.commitRangePatch(patch());
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.flushed).toBe(false);
    // The edit itself was still applied to the buffer.
    expect(h.buf.editCalls).toEqual(["a\nline TWO\nc\n"]);
  });
});

// ── Windows separators ───────────────────────────────────────────────────────

test("joins the chapter id using the project directory's OWN separator (compared with ===, not endsWith)", async () => {
  const h = make();
  h.dir = "C:\\proj";
  const target = new FakeBuffer();
  loadClean(target, "C:\\proj\\sub\\ch2.md", "a\nline two\nc\n");
  h.selectEditorFileSwitchTo = target;
  const outcome = await h.engine.commitRangePatch(patch({ chapter: "sub/ch2.md" }));
  expect(h.selectEditorFileCalls).toEqual(["C:\\proj\\sub\\ch2.md"]);
  expect(outcome.ok).toBe(true);
});
