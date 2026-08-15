import { expect, test } from "bun:test";
import {
  EditorPreviewSyncController,
  type EditorPreviewSyncClient,
} from "../../src/lib/routes/editor-preview-sync-controller";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

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
    return Promise.resolve(this.page == null ? null : { page: this.page, sourceLine: null });
  }
}

function make(hasClient = true) {
  const client = hasClient ? new FakeClient() : undefined;
  let rendering = false;
  const syncedPages: number[] = [];
  const ctrl = new EditorPreviewSyncController({
    client: () => client,
    rendering: () => rendering,
    syncPageAfterScroll: (page) => syncedPages.push(page),
  });
  return {
    ctrl,
    client,
    syncedPages,
    setRendering: (value: boolean) => (rendering = value),
  };
}

test("caret anchors center the matching preview line", async () => {
  const h = make();
  h.ctrl.onEditorAnchorLine(10, "caret", "ch1.md");
  expect(h.client?.calls).toEqual([
    { target: { line: 10, chapter: "ch1.md" }, opts: { block: "center" } },
  ]);
  await flush();
});

test("scroll anchors align the matching preview line to the top", async () => {
  const h = make();
  h.ctrl.onEditorAnchorLine(7, "scroll", "ch2.md");
  expect(h.client?.calls).toEqual([
    { target: { line: 7, chapter: "ch2.md" }, opts: { block: "start" } },
  ]);
  await flush();
});

test("the newest editor anchor alone may update the toolbar page", async () => {
  const h = make();
  const pending: Array<(value: { page: number; sourceLine: number | null }) => void> = [];
  h.client!.scrollToImpl = () => new Promise((resolve) => pending.push(resolve));

  h.ctrl.onEditorAnchorLine(10, "scroll", "ch1.md");
  h.ctrl.onEditorAnchorLine(20, "scroll", "ch1.md");
  pending[1]!({ page: 8, sourceLine: 20 });
  await flush();
  pending[0]!({ page: 3, sourceLine: 10 });
  await flush();

  expect(h.syncedPages).toEqual([8]);
});

test("render replacement invalidates an older pending anchor", async () => {
  const h = make();
  let resolve!: (value: { page: number; sourceLine: number | null }) => void;
  h.client!.scrollToImpl = () => new Promise((done) => (resolve = done));
  h.ctrl.onEditorAnchorLine(10, "scroll", "ch1.md");

  h.setRendering(true);
  h.ctrl.invalidatePending();
  h.setRendering(false);
  resolve({ page: 3, sourceLine: 10 });
  await flush();

  expect(h.syncedPages).toEqual([]);
});

test("missing client, active rendering, empty results, and failures stay inert", async () => {
  const noClient = make(false);
  noClient.ctrl.onEditorAnchorLine(1, "caret", "ch1.md");

  const rendering = make();
  rendering.setRendering(true);
  rendering.ctrl.onEditorAnchorLine(1, "caret", "ch1.md");
  expect(rendering.client?.calls).toEqual([]);

  const empty = make();
  empty.ctrl.onEditorAnchorLine(1, "caret", null);
  await flush();
  expect(empty.syncedPages).toEqual([]);

  const rejected = make();
  rejected.client!.reject = true;
  rejected.ctrl.onEditorAnchorLine(1, "caret", "ch1.md");
  await flush();
  expect(rejected.syncedPages).toEqual([]);
});
