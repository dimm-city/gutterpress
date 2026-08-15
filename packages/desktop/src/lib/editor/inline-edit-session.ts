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
    hooks?: { onSelection?: (detail: unknown) => void; onRenderPass?: () => void },
  ): () => void {
    return client.on((e) => {
      this.handleEvent(e.name, e.detail);
      if (e.name === "editSelection") hooks?.onSelection?.(e.detail);
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

    const results: PatchResult[] = [];

    // Sequential on purpose: patches in one batch may target the same
    // chapter, and each commit re-reads the buffer the next one validates
    // against.
    for (const patch of batch.patches) {
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
        results.push({ chapter: patch.chapter, range: patch.range, status: "applied" });
      } else {
        const refused = outcome.reason === "mismatch" || outcome.reason === "unsafe-chapter-path";
        results.push({
          chapter: patch.chapter,
          range: patch.range,
          status: refused ? "refused" : "failed",
          reason: outcome.reason,
        });
        if (refused) {
          this.deps.onRefusal?.({ chapter: patch.chapter, range: patch.range, reason: outcome.message });
        }
      }
    }
    try {
      await client?.ackEditPatches({ batchId: batch.batchId, results });
    } catch {
      // Frame gone (swap/navigation) — the next session start re-syncs.
    }
  }
}
