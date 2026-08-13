import { expect, test } from "bun:test";
import {
  EditorPreviewSyncController,
  type EditorPreviewSyncClient,
} from "../../src/lib/routes/editor-preview-sync-controller";

/**
 * The editor↔preview sync timing machine. It used to be an untestable
 * setTimeout polling loop living inline in `+page.svelte`; it was extracted
 * into a controller with an injected clock and scheduler so every timing branch
 * was deterministic.
 *
 * The scheduler is gone with the loop it drove. Once the editor holds the WHOLE
 * BOOK as one document, following the preview across a chapter boundary is not
 * a file open — the line is already in the document — so there is nothing to
 * poll for, nothing to retry, and no nudge sequence to fight a scroll reset.
 * What survives is the echo-suppression window (still clock-injected) and the
 * editor→preview anchor follow, which now carries the chapter the editor
 * resolved from its own segment table.
 */

/** Flush the microtask/macrotask queue so `.then().catch()` chains settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

/** Records (target, opts) for each scrollTo; returns a page when `page` is set. */
class FakeClient implements EditorPreviewSyncClient {
  calls: Array<{ target: unknown; opts: unknown }> = [];
  page: number | null = null;
  reject = false;
  scrollToImpl: (() => Promise<{ page: number; sourceLine: number | null } | null>) | null = null;

  scrollTo(
    target: unknown,
    opts?: unknown,
  ): Promise<{ page: number; sourceLine: number | null } | null> {
    this.calls.push({ target, opts });
    if (this.scrollToImpl) return this.scrollToImpl();
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

interface Harness {
  ctrl: EditorPreviewSyncController;
  client: FakeClient | undefined;
  time: number;
  rendering: boolean;
  syncPageAfterScroll: Spy<[number]>;
}

function make(over: Partial<{ hasClient: boolean }> = {}): Harness {
  const client = over.hasClient === false ? undefined : new FakeClient();
  const syncPageAfterScroll = spy<[number]>();
  const h: Harness = {
    client,
    time: 1000,
    rendering: false,
    syncPageAfterScroll,
    ctrl: undefined as unknown as EditorPreviewSyncController,
  };
  h.ctrl = new EditorPreviewSyncController({
    client: () => h.client,
    rendering: () => h.rendering,
    syncPageAfterScroll: (page) => syncPageAfterScroll(page),
    now: () => h.time,
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
  h.ctrl.onEditorAnchorLine(10, "caret", "ch1.md");
  expect(h.ctrl.suppressPreviewSyncUntil).toBe(2400);
  expect((h.client as FakeClient).calls).toEqual([
    { target: { line: 10, chapter: "ch1.md" }, opts: { block: "center" } },
  ]);
  await flush();
});

test("onEditorAnchorLine anchors a scroll origin to the TOP (start)", async () => {
  const h = make();
  h.ctrl.onEditorAnchorLine(7, "scroll", "ch1.md");
  expect((h.client as FakeClient).calls[0]?.opts).toEqual({ block: "start" });
  await flush();
});

test("a scroll that crossed into another chapter just carries that chapter", async () => {
  const h = make();
  // The editor resolves the chapter from the book document's segment table, so
  // crossing a boundary mid-scroll is not a special case here — it is the same
  // call with a different chapter. This is what the cross-chapter open/poll/
  // retry pump used to exist for.
  h.ctrl.onEditorAnchorLine(3, "scroll", "ch1.md");
  h.ctrl.onEditorAnchorLine(1, "scroll", "ch2.md");
  expect((h.client as FakeClient).calls.map((c) => c.target)).toEqual([
    { line: 3, chapter: "ch1.md" },
    { line: 1, chapter: "ch2.md" },
  ]);
  await flush();
});

test("onEditorAnchorLine passes a null chapter through for a single-file document", async () => {
  const h = make();
  h.ctrl.onEditorAnchorLine(4, "caret", null);
  expect((h.client as FakeClient).calls[0]?.target).toEqual({ line: 4, chapter: null });
  await flush();
});

test("onEditorAnchorLine reflects the scrollTo page into the toolbar", async () => {
  const h = make();
  (h.client as FakeClient).page = 4;
  h.ctrl.onEditorAnchorLine(10, "caret", "ch1.md");
  await flush();
  expect(h.syncPageAfterScroll.calls).toEqual([[4]]);
});

test("a stale scrollTo completion cannot roll the toolbar back from the latest editor anchor", async () => {
  const h = make();
  const pending: Array<(result: { page: number; sourceLine: number | null }) => void> = [];
  (h.client as FakeClient).scrollToImpl = () =>
    new Promise((resolve) => pending.push(resolve));

  h.ctrl.onEditorAnchorLine(10, "scroll", "ch1.md");
  h.ctrl.onEditorAnchorLine(20, "scroll", "ch1.md");
  pending[1]!({ page: 8, sourceLine: 20 });
  await flush();
  pending[0]!({ page: 3, sourceLine: 10 });
  await flush();

  expect(h.syncPageAfterScroll.calls).toEqual([[8]]);
});

test("suppressFor invalidates an editor scroll result still in flight", async () => {
  const h = make();
  let resolve!: (result: { page: number; sourceLine: number | null }) => void;
  (h.client as FakeClient).scrollToImpl = () => new Promise((done) => (resolve = done));
  h.ctrl.onEditorAnchorLine(10, "scroll", "ch1.md");

  h.ctrl.suppressFor(400);
  resolve({ page: 3, sourceLine: 10 });
  await flush();
  expect(h.syncPageAfterScroll.calls).toEqual([]);
});

test("render invalidation survives rendering returning to false before a stale result resolves", async () => {
  const h = make();
  let resolve!: (result: { page: number; sourceLine: number | null }) => void;
  (h.client as FakeClient).scrollToImpl = () => new Promise((done) => (resolve = done));
  h.ctrl.onEditorAnchorLine(10, "scroll", "ch1.md");

  h.rendering = true;
  h.ctrl.invalidatePending();
  h.rendering = false;
  resolve({ page: 3, sourceLine: 10 });
  await flush();
  expect(h.syncPageAfterScroll.calls).toEqual([]);
});

test("onEditorAnchorLine does not sync a page when scrollTo returns none", async () => {
  const h = make();
  (h.client as FakeClient).page = null;
  h.ctrl.onEditorAnchorLine(10, "caret", "ch1.md");
  await flush();
  expect(h.syncPageAfterScroll.calls.length).toBe(0);
});

test("onEditorAnchorLine swallows a rejected scrollTo", async () => {
  const h = make();
  (h.client as FakeClient).reject = true;
  h.ctrl.onEditorAnchorLine(10, "caret", "ch1.md");
  await flush();
  expect(h.syncPageAfterScroll.calls.length).toBe(0);
});

test("onEditorAnchorLine no-ops with no client (window untouched)", () => {
  const h = make({ hasClient: false });
  h.ctrl.onEditorAnchorLine(10, "caret", "ch1.md");
  expect(h.ctrl.suppressPreviewSyncUntil).toBe(0);
});

test("onEditorAnchorLine no-ops while rendering", () => {
  const h = make();
  h.rendering = true;
  h.ctrl.onEditorAnchorLine(10, "caret", "ch1.md");
  expect(h.ctrl.suppressPreviewSyncUntil).toBe(0);
  expect((h.client as FakeClient).calls.length).toBe(0);
});
