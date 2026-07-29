import { expect, test } from "bun:test";
import {
  EditorPreviewSyncController,
  type EditorPreviewSyncClient,
} from "../../src/lib/routes/editor-preview-sync-controller";

/**
 * The editor↔preview sync timing machine (cross-chapter reveal pump + the
 * Date.now() echo-suppression window + anchor-line follow) used to be an
 * untestable setTimeout polling loop living inline in `+page.svelte`. Extracted
 * into a controller with an injected clock (`now`) + scheduler (`schedule`) so
 * every timing branch is deterministic under a fake queue.
 */

/** Flush the microtask/macrotask queue so `.then().catch()` chains settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

/** Records (target, opts) for each scrollTo; returns a page when `page` is set. */
class FakeClient implements EditorPreviewSyncClient {
  calls: Array<{ target: unknown; opts: unknown }> = [];
  page: number | null = null;
  reject = false;

  scrollTo(
    target: unknown,
    opts?: unknown,
  ): Promise<{ page: number; sourceLine: number | null } | null> {
    this.calls.push({ target, opts });
    if (this.reject) return Promise.reject(new Error("boom"));
    return Promise.resolve(this.page != null ? { page: this.page, sourceLine: null } : null);
  }
}

type Spy<A extends unknown[] = unknown[]> = ((...a: A) => void) & { calls: A[] };
const spy = <A extends unknown[] = unknown[]>(): Spy<A> => {
  const fn = ((...a: A) => {
    fn.calls.push(a);
  }) as Spy<A>;
  fn.calls = [];
  return fn;
};

/** A deterministic replacement for setTimeout — callbacks queue and drain on demand. */
class FakeScheduler {
  queue: Array<() => void> = [];
  scheduleCount = 0;
  schedule = (fn: () => void, _delay: number): void => {
    this.scheduleCount++;
    this.queue.push(fn);
  };
  /** Run the next queued callback (may enqueue more). */
  step(): void {
    const fn = this.queue.shift();
    fn?.();
  }
  /** Drain the queue until it self-terminates (bounded so a runaway loop fails loud). */
  drain(max = 1000): void {
    let n = 0;
    while (this.queue.length && n++ < max) this.step();
    if (n >= max) throw new Error("scheduler did not terminate");
  }
}

interface Harness {
  ctrl: EditorPreviewSyncController;
  client: FakeClient | undefined;
  scheduler: FakeScheduler;
  time: number;
  rendering: boolean;
  currentDir: string | null;
  editorChapter: string | null;
  hasEditorRef: boolean;
  selectEditorFile: Spy<[string]>;
  revealEditorLine: Spy<[number]>;
  syncPageAfterScroll: Spy<[number]>;
}

function make(over: Partial<{ hasClient: boolean }> = {}): Harness {
  const client = over.hasClient === false ? undefined : new FakeClient();
  const scheduler = new FakeScheduler();
  const selectEditorFile = spy<[string]>();
  const revealEditorLine = spy<[number]>();
  const syncPageAfterScroll = spy<[number]>();
  const h: Harness = {
    client,
    scheduler,
    time: 1000,
    rendering: false,
    currentDir: "/proj",
    editorChapter: "ch1.md",
    hasEditorRef: true,
    selectEditorFile,
    revealEditorLine,
    syncPageAfterScroll,
    ctrl: undefined as unknown as EditorPreviewSyncController,
  };
  h.ctrl = new EditorPreviewSyncController({
    client: () => h.client,
    rendering: () => h.rendering,
    currentDir: () => h.currentDir,
    editorChapter: () => h.editorChapter,
    hasEditorRef: () => h.hasEditorRef,
    selectEditorFile: (p) => selectEditorFile(p),
    revealEditorLine: (line) => revealEditorLine(line),
    syncPageAfterScroll: (page) => syncPageAfterScroll(page),
    now: () => h.time,
    schedule: scheduler.schedule,
  });
  return h;
}

// ── echo-suppression window ───────────────────────────────────────────────────

test("suppressPreviewSyncUntil starts at 0", () => {
  const { ctrl } = make();
  expect(ctrl.suppressPreviewSyncUntil).toBe(0);
});

test("suppressFor sets the window to now + ms using the injected clock", () => {
  const h = make();
  h.time = 5000;
  h.ctrl.suppressFor(400);
  expect(h.ctrl.suppressPreviewSyncUntil).toBe(5400);
  h.time = 9000;
  h.ctrl.suppressFor(300);
  expect(h.ctrl.suppressPreviewSyncUntil).toBe(9300);
});

// ── anchor-line follow ────────────────────────────────────────────────────────

test("onEditorAnchorLine sets a 400ms echo window and CENTERs a caret anchor", async () => {
  const h = make();
  h.time = 2000;
  h.editorChapter = "ch1.md";
  h.ctrl.onEditorAnchorLine(10, "caret");
  expect(h.ctrl.suppressPreviewSyncUntil).toBe(2400);
  expect((h.client as FakeClient).calls).toEqual([
    { target: { line: 10, chapter: "ch1.md" }, opts: { block: "center" } },
  ]);
  await flush();
});

test("onEditorAnchorLine anchors a scroll origin to the TOP (start)", async () => {
  const h = make();
  h.ctrl.onEditorAnchorLine(7, "scroll");
  expect((h.client as FakeClient).calls[0]?.opts).toEqual({ block: "start" });
  await flush();
});

test("onEditorAnchorLine reflects the scrollTo page into the toolbar", async () => {
  const h = make();
  (h.client as FakeClient).page = 4;
  h.ctrl.onEditorAnchorLine(10, "caret");
  await flush();
  expect(h.syncPageAfterScroll.calls).toEqual([[4]]);
});

test("onEditorAnchorLine does not sync a page when scrollTo returns none", async () => {
  const h = make();
  (h.client as FakeClient).page = null;
  h.ctrl.onEditorAnchorLine(10, "caret");
  await flush();
  expect(h.syncPageAfterScroll.calls.length).toBe(0);
});

test("onEditorAnchorLine swallows a rejected scrollTo", async () => {
  const h = make();
  (h.client as FakeClient).reject = true;
  h.ctrl.onEditorAnchorLine(10, "caret");
  await flush();
  expect(h.syncPageAfterScroll.calls.length).toBe(0);
});

test("onEditorAnchorLine no-ops with no client (window untouched)", () => {
  const h = make({ hasClient: false });
  h.ctrl.onEditorAnchorLine(10, "caret");
  expect(h.ctrl.suppressPreviewSyncUntil).toBe(0);
});

test("onEditorAnchorLine no-ops while rendering", () => {
  const h = make();
  h.rendering = true;
  h.ctrl.onEditorAnchorLine(10, "caret");
  expect(h.ctrl.suppressPreviewSyncUntil).toBe(0);
  expect((h.client as FakeClient).calls.length).toBe(0);
});

// ── cross-chapter reveal pump ─────────────────────────────────────────────────

test("followChapterInEditor no-ops without a project directory", () => {
  const h = make();
  h.currentDir = null;
  h.ctrl.followChapterInEditor("ch2.md", 42);
  expect(h.selectEditorFile.calls.length).toBe(0);
  expect(h.scheduler.scheduleCount).toBe(0);
});

test("followChapterInEditor opens the chapter file with a posix separator", () => {
  const h = make();
  h.currentDir = "/proj/";
  h.editorChapter = "ch1.md"; // mismatch → pump waits, doesn't reveal yet
  h.ctrl.followChapterInEditor("ch2.md", 42);
  expect(h.selectEditorFile.calls).toEqual([["/proj/ch2.md"]]);
});

test("followChapterInEditor joins with a Windows separator when the dir uses backslashes", () => {
  const h = make();
  h.currentDir = "C:\\proj\\";
  h.editorChapter = "ch1.md";
  h.ctrl.followChapterInEditor("sub/ch2.md", 42);
  expect(h.selectEditorFile.calls).toEqual([["C:\\proj\\sub\\ch2.md"]]);
});

test("pump reveals the line and re-issues the reveal up to 5 nudges once the chapter swaps", () => {
  const h = make();
  h.editorChapter = "ch2.md"; // already the target chapter → reveal immediately
  h.time = 3000;
  h.ctrl.followChapterInEditor("ch2.md", 42);
  // First pump ran synchronously inside followChapterInEditor (nudge 1).
  h.scheduler.drain();
  // Nudges 1..5 each reveal the same line, then the pump stops.
  expect(h.revealEditorLine.calls).toEqual([[42], [42], [42], [42], [42]]);
  // Each matched pump re-arms the echo window at now + 300.
  expect(h.ctrl.suppressPreviewSyncUntil).toBe(3300);
});

test("pump waits (no reveal) while the buffer has not yet swapped to the target chapter", () => {
  const h = make();
  h.editorChapter = "ch1.md"; // never matches ch2.md
  h.ctrl.followChapterInEditor("ch2.md", 42);
  h.scheduler.drain();
  // Chapter never swapped → the line is never revealed, and the pump caps out.
  expect(h.revealEditorLine.calls.length).toBe(0);
});

test("pump does not reveal until an editor ref is present", () => {
  const h = make();
  h.editorChapter = "ch2.md";
  h.hasEditorRef = false; // matched chapter but no editor mounted yet
  h.ctrl.followChapterInEditor("ch2.md", 42);
  h.scheduler.drain();
  expect(h.revealEditorLine.calls.length).toBe(0);
});

test("pump caps its wait retries so it always terminates", () => {
  const h = make();
  h.editorChapter = "ch1.md";
  h.ctrl.followChapterInEditor("ch2.md", 42);
  // drain() throws if the loop never terminates; a clean return proves the cap.
  h.scheduler.drain();
  expect(h.scheduler.queue.length).toBe(0);
});

test("a chapter that swaps mid-wait then reveals and nudges to completion", () => {
  const h = make();
  h.editorChapter = "ch1.md";
  h.ctrl.followChapterInEditor("ch2.md", 42);
  // Simulate the async file load completing after a couple of poll cycles.
  h.scheduler.step();
  h.scheduler.step();
  h.editorChapter = "ch2.md";
  h.scheduler.drain();
  expect(h.revealEditorLine.calls).toEqual([[42], [42], [42], [42], [42]]);
});
