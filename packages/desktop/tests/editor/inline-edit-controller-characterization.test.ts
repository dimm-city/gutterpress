import { test, expect } from "bun:test";
import { InlineEditController, type InlineEditClient, type InlineEditDeps } from "../../src/lib/routes/inline-edit-controller.svelte";
import type { CommitEngine } from "$lib/editor/commit-engine";
import type { PreviewEvent, SourceRange } from "$lib/preview-client";

/**
 * inline-edit-controller-characterization.test.ts (SFE-P0a, Lane B).
 *
 * `inline-edit-controller.test.ts` already pins InlineEditController's opening,
 * committing, cancelling, host-initiated ending, the `pendingRender` guard, and
 * `renderingComplete`-while-open behavior exhaustively (see
 * docs/plans/source-first-editor/mutation-inventory.md for the full coverage
 * map). This file adds ONLY the behavior that file does not already cover: the
 * `requestId` race guards inside `show()` — ALL THREE of its checkpoints
 * (immediately after `await this.endActive(true)`, immediately after
 * `readChapterSource()` resolves, and immediately after
 * `client.beginBlockEdit()` resolves).
 *
 * Repair round 1 correction: this file previously claimed (here and in
 * mutation-inventory.md §4.2 item 1) that the FIRST checkpoint was already
 * pinned by `inline-edit-controller.test.ts`'s "chaining from the menu does
 * not walk past the guard" test. That was false: that test pins the
 * *pendingRender* re-check at the SECOND checkpoint (its final assertion is
 * on `toastInfoCalls`, the pendingRender message), not the `requestId`
 * comparison at the first checkpoint — and because both of its `show()`
 * calls are awaited sequentially, `this.requestId` can never diverge from
 * the local `requestId` there, so the first checkpoint's own condition never
 * even gets exercised false. All three checkpoints below are pinned for the
 * first time in this file.
 *
 * These guards are exactly the kind of "what happens when two asynchronous
 * host round-trips overlap" invariant the P4 deletion run needs pinned before
 * it touches this file: P4a deletes `InlineEditController` outright, and P4b's
 * search-proof checklist depends on today's behavior being captured somewhere
 * first (docs/plans/source-first-editor-enterprise-refactor.md P4b "Required
 * search proofs"). A regression here would silently let a slow double-click
 * followed by a fast one clobber the fast one's edit state.
 *
 * G-12 deliberate-failure proof: each test below was re-run once with its
 * corresponding guard line commented out in `inline-edit-controller.svelte.ts`
 * and confirmed to fail; see mutation-inventory.md §4.2 for the recorded
 * commands and results.
 */

(globalThis as unknown as { $state?: <T>(value: T) => T }).$state ??= (value) => value;

class FakeClient implements InlineEditClient {
  private listeners: Array<(e: PreviewEvent) => void> = [];
  beginCalls: Array<{ chapter: string; range: SourceRange; text: string; caret?: { x: number; y: number } }> = [];
  /** Per-chapter deferred gate: beginBlockEdit for that chapter blocks until released. */
  private gates = new Map<string, () => void>();

  on(fn: (e: PreviewEvent) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  /** Arm a gate: the next beginBlockEdit call for `chapter` blocks until `release(chapter)`. */
  gate(chapter: string): void {
    this.gates.set(chapter, () => {});
  }

  release(chapter: string): void {
    this.gates.get(chapter)?.();
  }

  async beginBlockEdit(spec: {
    chapter: string;
    range: SourceRange;
    text: string;
    caret?: { x: number; y: number };
  }): Promise<{ ok: boolean; reason?: string }> {
    this.beginCalls.push(spec);
    if (this.gates.has(spec.chapter)) {
      await new Promise<void>((resolve) => {
        this.gates.set(spec.chapter, resolve);
      });
    }
    return { ok: true };
  }

  async endBlockEdit(): Promise<{ ended: boolean; text: string | null }> {
    return { ended: true, text: null };
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

const flush = () => new Promise((r) => setTimeout(r, 0));

/**
 * `captured` is intentionally private on InlineEditController (no accessor —
 * it is internal bookkeeping, not part of the public contract). Reading it
 * here is a deliberate whitebox check: the alternative, committing through
 * `blockEditFinished` to observe which chapter reaches `commitRangePatch`,
 * exercises the SAME guard but through more machinery than the assertion
 * needs. Using both styles (see the two tests below) demonstrates the guard
 * holds either way it is observed.
 */
function capturedChapter(ctrl: InlineEditController): string | undefined {
  return (ctrl as unknown as { captured: { chapter: string } | null }).captured?.chapter;
}

test("a show() whose beginBlockEdit resolves AFTER a newer show() already opened does not overwrite the newer edit", async () => {
  // Checkpoint 3 in show(): `if (requestId !== this.requestId) return;`
  // immediately after `await client.beginBlockEdit(...)`. Reachable in
  // practice by a slow bridge round-trip for one double-click followed by a
  // second, faster one on a different block before the first replies.
  const client = new FakeClient();
  const commitEngine = new FakeCommitEngine();
  const readFileMap: Record<string, string> = { "/proj/a.md": "AAA\n", "/proj/b.md": "BBB\n" };
  const deps: InlineEditDeps = {
    client: () => client,
    currentDir: () => "/proj",
    openContent: () => null,
    readFile: async (path) => readFileMap[path]!,
    commitEngine: commitEngine as unknown as CommitEngine,
    focusPreview: () => {},
    toastError: () => {},
    toastInfo: () => {},
  };
  const ctrl = new InlineEditController(deps);

  client.gate("a.md");
  const showA = ctrl.show({ chapter: "a.md", range: [0, 1] });
  await flush();
  await flush();
  expect(client.beginCalls).toEqual([{ chapter: "a.md", range: [0, 1], text: "AAA\n", caret: undefined }]);
  expect(ctrl.open).toBe(false); // still blocked inside beginBlockEdit

  // A's request never set `open`, so this second show() does NOT go through
  // endActive() first — it races A directly.
  await ctrl.show({ chapter: "b.md", range: [0, 1] });
  expect(ctrl.open).toBe(true);
  expect(capturedChapter(ctrl)).toBe("b.md");

  // Release A's stale beginBlockEdit AFTER B has already opened.
  client.release("a.md");
  await showA;

  // A's late resolution must be a no-op: it must not reopen, recapture, or
  // otherwise disturb B's still-active edit.
  expect(ctrl.open).toBe(true);
  expect(capturedChapter(ctrl)).toBe("b.md");
});

test("a show() whose readChapterSource resolves AFTER a newer show() already opened is discarded before it ever calls beginBlockEdit", async () => {
  // Checkpoint 2 in show(): `if (requestId !== this.requestId) return;`
  // immediately after `await this.readChapterSource(...)`, BEFORE
  // `client.beginBlockEdit` is ever called for the stale request. This proves
  // the guard fires early enough that a superseded request never reaches the
  // preview bridge at all.
  let releaseA: (() => void) | null = null;
  const beginCalls: Array<{ chapter: string }> = [];
  const client: InlineEditClient = {
    on: () => () => {},
    beginBlockEdit: async (spec) => {
      beginCalls.push({ chapter: spec.chapter });
      return { ok: true };
    },
    endBlockEdit: async () => ({ ended: true, text: null }),
  };
  const commitEngine = new FakeCommitEngine();
  const ctrl = new InlineEditController({
    client: () => client,
    currentDir: () => "/proj",
    openContent: () => null,
    readFile: async (path) => {
      if (path === "/proj/a.md") {
        // Blocks indefinitely until releaseA() is called below.
        await new Promise<void>((resolve) => {
          releaseA = resolve;
        });
        return "AAA\n";
      }
      return "BBB\n";
    },
    commitEngine: commitEngine as unknown as CommitEngine,
    focusPreview: () => {},
    toastError: () => {},
    toastInfo: () => {},
  });

  const showA = ctrl.show({ chapter: "a.md", range: [0, 1] });
  await flush();
  expect(releaseA).not.toBeNull(); // A is now parked inside readChapterSource

  await ctrl.show({ chapter: "b.md", range: [0, 1] });
  expect(ctrl.open).toBe(true);
  expect(beginCalls).toEqual([{ chapter: "b.md" }]);

  releaseA!();
  await showA;

  // A's stale continuation must never reach beginBlockEdit for "a.md" at all.
  expect(beginCalls).toEqual([{ chapter: "b.md" }]);
  expect(ctrl.open).toBe(true);
  expect(capturedChapter(ctrl)).toBe("b.md");
});

test("a show() whose endActive(true) resolves AFTER a newer request has already superseded it never re-reads or reopens its own edit", async () => {
  // Checkpoint 1 in show(): `if (requestId !== this.requestId) return;`
  // immediately after `await this.endActive(true)` (line 229-230). Reachable
  // when an edit is already open (`this.open === true`, so `show()` awaits
  // `endActive(true)` before doing anything else) and ending that edit takes
  // long enough for a still-newer request to have already superseded this
  // one by the time it resolves.
  //
  // A newer request is simulated by advancing `requestId` directly rather
  // than driving a full third `show()` call through its own read/begin round
  // trip: a real third call would ALSO see `this.open === true` while this
  // one is parked inside `endActive`, and would itself race to end the same
  // edit — a second, independent hazard the two tests above already cover
  // for the later checkpoints. Isolating checkpoint 1 this way keeps this
  // test a characterization of the guard alone, not of that separate race.
  const beginCalls: Array<{ chapter: string }> = [];
  const readCalls: string[] = [];
  let releaseEnd: ((result: { ended: boolean; text: string | null }) => void) | null = null;
  const client: InlineEditClient = {
    on: () => () => {},
    beginBlockEdit: async (spec) => {
      beginCalls.push({ chapter: spec.chapter });
      return { ok: true };
    },
    endBlockEdit: () =>
      new Promise((resolve) => {
        releaseEnd = resolve;
      }),
  };
  const commitEngine = new FakeCommitEngine();
  const ctrl = new InlineEditController({
    client: () => client,
    currentDir: () => "/proj",
    // "a.md" resolves synchronously through the live buffer (no readFile
    // round trip needed to open it); "b.md" would need the async readFile
    // path below, which checkpoint 1 must prevent from ever being reached.
    openContent: (path) => (path === "/proj/a.md" ? "AAA\n" : null),
    readFile: async (path) => {
      readCalls.push(path);
      return "BBB\n";
    },
    commitEngine: commitEngine as unknown as CommitEngine,
    focusPreview: () => {},
    toastError: () => {},
    toastInfo: () => {},
  });

  // A opens normally. `this.open` starts false, so this call never touches
  // `endActive`/`endBlockEdit` at all.
  await ctrl.show({ chapter: "a.md", range: [0, 1] });
  expect(ctrl.open).toBe(true);
  expect(beginCalls).toEqual([{ chapter: "a.md" }]);

  // B starts: `this.open` is true, so `show()` awaits `endActive(true)`,
  // which calls `endBlockEdit` and parks on the promise above.
  const showB = ctrl.show({ chapter: "b.md", range: [0, 1] });
  await flush();
  expect(releaseEnd).not.toBeNull(); // B is now parked inside endActive()

  // A still-newer request completes while B waits.
  (ctrl as unknown as { requestId: number }).requestId = 999;

  // Release B's endActive with a result that WOULD commit if B's show()
  // reached that far.
  releaseEnd!({ ended: true, text: "AAA\n" });
  await showB;

  // Checkpoint 1 must fire before `readChapterSource("b.md")` is ever
  // called — proven by there being no read for it at all, not merely by
  // `beginBlockEdit` never being called for it (the LATER checkpoint, at
  // line 241, would independently catch that regardless of checkpoint 1,
  // since nothing between the two checkpoints changes `this.requestId`
  // again — only an absent read call is specific to checkpoint 1 firing).
  expect(readCalls).toEqual([]);
  expect(beginCalls).toEqual([{ chapter: "a.md" }]);
});
