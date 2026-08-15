/**
 * inline-edit-session.ts — the SPA half of HTML-first inline editing
 * (ADR 0010, Phase 3).
 *
 * The frame's edit module proposes `{chapter, range, expected, replacement}`
 * patches (`editPatches` events); this session commits each through the
 * UNCHANGED commit engine — every gate intact — marks the resulting saves
 * `origin: "inline-edit"` so the preview server suppresses its rebuild+swap,
 * and acks outcomes back so the frame can update its source mirror, shift
 * ranges, and schedule drift verification.
 *
 * Injected-deps pattern (no runes needed — consumers read plain fields after
 * events; matches `preview-event-controller.ts`). Zero DOM/node imports —
 * PWA-clean, unit-tested with fakes.
 */
import type { CommitEngine } from "./commit-engine";

/** One patch's commit outcome, acked back to the frame. */
export interface PatchResult {
  chapter: string;
  range: [number, number];
  status: "applied" | "refused" | "failed";
  reason?: string;
}

export interface InlineEditClient {
  setEditMode(spec: { on: boolean }): Promise<{ on: boolean }>;
  ackEditPatches(spec: { batchId: number; results: PatchResult[] }): Promise<unknown>;
  on(fn: (e: { name: string; detail: unknown }) => void): () => void;
}

export interface InlineEditSessionDeps {
  client: () => InlineEditClient | null;
  engine: () => Pick<CommitEngine, "commitRangePatch" | "generation"> | null;
  /** Kill switch (settings `preview.inlineEditing`). */
  enabled: () => boolean;
  /** A block refused serialization or commit — degrade surface (overlay/toast). */
  onRefusal?: (r: { chapter: string; range: [number, number]; reason: string }) => void;
  /** Drift verification could not reconcile (count mismatch) — classic reload advised. */
  onDriftMismatch?: (chapter: string, mismatch: string) => void;
  /**
   * A commit failed for a NON-refusal reason (buffer not clean, load failed,
   * stale generation, …). The author's typing is still on screen but did not
   * reach disk, so this must be visible — silence here is invisible data loss.
   */
  onCommitFailed?: (r: { chapter: string; range: [number, number]; reason: string; message: string }) => void;
}

interface EditPatchesDetail {
  batchId: number;
  patches: Array<{
    chapter: string;
    range: [number, number];
    expected: string;
    replacement: string;
  }>;
  refusals: Array<{ chapter: string; range: [number, number]; reason: string }>;
}

export class InlineEditSession {
  /** Uncommitted edits exist in the frame (test/telemetry hook — no UI
   *  consumer yet; the save indicator wiring is future work). */
  dirty = false;
  /** Monotonic count of applied inline commits (test/telemetry hook). */
  applied = 0;

  constructor(private deps: InlineEditSessionDeps) {}

  /**
   * Own the edit slice of a client's event stream (the sibling-controller
   * pattern — ContextMenuController/BlockOverlayController do the same):
   * routes the v7 edit events and re-syncs edit mode on ready/render passes.
   * `onSelection` is the one event the page keeps a hand in — bubble
   * positioning needs the iframe rect, which only the page can read.
   */
  subscribe(
    client: InlineEditClient,
    hooks?: {
      onSelection?: (detail: unknown) => void;
      onRenderPass?: () => void;
      onViewportChanged?: () => void;
    },
  ): () => void {
    return client.on((e) => {
      this.handleEvent(e.name, e.detail);
      if (e.name === "editSelection") hooks?.onSelection?.(e.detail);
      // A scroll/zoom moves the frame content out from under the bubble,
      // whose coordinates are window-space and computed once per selection.
      if (e.name === "viewportChanged") hooks?.onViewportChanged?.();
      if (e.name === "ready" || e.name === "renderingComplete") {
        hooks?.onRenderPass?.();
        void this.syncEditMode();
      }
    });
  }

  /** Turn the frame's edit surface on/off per the kill switch. Call on
   *  `ready`/`renderingComplete`. */
  async syncEditMode(): Promise<void> {
    const client = this.deps.client();
    if (!client) return;
    try {
      await client.setEditMode({ on: this.deps.enabled() });
    } catch {
      // A pre-v7 frame (stale bundle) has no edit mode — nothing to sync.
    }
  }

  /** Route a preview event (also reachable directly for tests). */
  handleEvent(name: string, detail: unknown): void {
    switch (name) {
      case "editPatches":
        void this.commitBatch(detail as EditPatchesDetail);
        return;
      case "editStateChanged":
        this.dirty = Boolean((detail as { dirty?: boolean } | null)?.dirty);
        return;
      case "editDrift": {
        const d = detail as {
          chapter: string;
          mismatch?: string;
          degraded?: Array<{ chapter: string; range: [number, number] }>;
        };
        if (d?.mismatch) this.deps.onDriftMismatch?.(d.chapter, d.mismatch);
        // Blocks the frame degraded after repeated heals: surface each once
        // through the same refusal path (overlay/toast) as codec refusals.
        for (const g of d?.degraded ?? []) {
          this.deps.onRefusal?.({ ...g, reason: "repeated drift — edit this block in the source view" });
        }
        return;
      }
    }
  }

  private async commitBatch(batch: EditPatchesDetail): Promise<void> {
    if (!batch) return;
    for (const refusal of batch.refusals ?? []) this.deps.onRefusal?.(refusal);

    const engine = this.deps.engine();
    const client = this.deps.client();
    if (!engine || !batch.patches?.length) {
      return;
    }

    // Keyed by the proposed patch so the ACK payload keeps the frame's
    // original proposal order — the bottom-up commit order below is an
    // internal concern and must not leak into the wire shape.
    const resultFor = new Map<(typeof batch.patches)[number], PatchResult>();

    // Sequential on purpose: patches in one batch may target the same
    // chapter, and each commit re-reads the buffer the next one validates
    // against. BOTTOM-UP within a chapter (descending start line): a commit
    // that changes line count moves everything BELOW it, so a top-down order
    // would hand later patches stale ranges — normally caught by the
    // expected-slice gate as a refusal, but with repeated source text it
    // could match and rewrite the wrong occurrence.
    const ordered = [...batch.patches].sort((a, b) =>
      a.chapter === b.chapter ? b.range[0] - a.range[0] : a.chapter < b.chapter ? -1 : 1,
    );
    for (const patch of ordered) {
      const outcome = await engine.commitRangePatch({
        chapter: patch.chapter,
        range: patch.range,
        expected: patch.expected,
        replacement: patch.replacement,
        expectedGeneration: engine.generation,
        origin: "inline-edit",
      });
      if (outcome.ok) {
        this.applied++;
        resultFor.set(patch, { chapter: patch.chapter, range: patch.range, status: "applied" });
      } else {
        const refused = outcome.reason === "mismatch" || outcome.reason === "unsafe-chapter-path";
        resultFor.set(patch, {
          chapter: patch.chapter,
          range: patch.range,
          status: refused ? "refused" : "failed",
          reason: outcome.reason,
        });
        if (refused) {
          this.deps.onRefusal?.({ chapter: patch.chapter, range: patch.range, reason: outcome.message });
        } else {
          this.deps.onCommitFailed?.({
            chapter: patch.chapter,
            range: patch.range,
            reason: outcome.reason,
            message: outcome.message,
          });
        }
      }
    }
    const results = batch.patches
      .map((p) => resultFor.get(p))
      .filter((r): r is PatchResult => r != null);
    try {
      await client?.ackEditPatches({ batchId: batch.batchId, results });
    } catch {
      // Frame gone (swap/navigation) — the next session start re-syncs.
    }
  }
}
