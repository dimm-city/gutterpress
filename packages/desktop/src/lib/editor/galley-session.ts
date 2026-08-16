/**
 * galley-session.ts — the SPA half of Galley v2 inline editing
 * (protocol v9, docs/tiptap-galley-architecture.md).
 *
 * The frame owns ONE ProseMirror doc per chapter; screen↔file drift is
 * impossible by construction, so there is no patch-ack lifecycle, no drift
 * verification, and no range-shift bookkeeping here. The frame serializes a
 * whole chapter (`galleyContent` events) and this session commits it through
 * the UNCHANGED commit engine as ONE whole-file range patch — every file-level
 * gate intact — marked `origin: "inline-edit"` so the preview server
 * suppresses its rebuild+swap.
 *
 * Injected-deps pattern (no runes needed — consumers read plain fields after
 * events; matches `preview-event-controller.ts` and the retired
 * inline-edit-session). Zero DOM/node imports — PWA-clean, unit-tested with
 * fakes (`tests/editor/galley-session.test.ts`).
 */
import type { CommitEngine } from "./commit-engine";

/** A JSON-cloneable rect in frame-viewport coordinates (never a DOMRect). */
export interface GalleyRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** `galleyContent` event payload: one chapter's fresh serialization. */
export interface GalleyContentDetail {
  chapter: string;
  /** Proposal nonce — echoed in the ack so a retired frame's late ack can
   *  never advance or poison the replacement frame's chain (ADR 0011). */
  seq?: number;
  /** The frame's current whole-chapter serialization — the replacement text. */
  markdown: string;
  /**
   * The frame's PREVIOUS serialization of that chapter (initially the exact
   * source the server sent) — the commit gate's `expected` slice. When this no
   * longer matches the buffer, the file changed underneath the editor and the
   * commit is refused, never guessed.
   */
  expected: string;
}

/** `galleyOpaqueEdit` event payload: the author activated an opaque atom. */
export interface GalleyOpaqueEditDetail {
  chapter: string;
  /** The atom's ProseMirror doc position — `galleySetOpaqueSource`'s key. */
  pos: number;
  /** The atom's verbatim markdown source slice. */
  src: string;
  /** The atom's on-screen rect (frame-viewport coordinates), if resolvable. */
  rect: GalleyRect | null;
}

export interface GalleyClient {
  setEditMode(spec: { on: boolean }): Promise<{ on: boolean }>;
  galleyAckContent(spec: {
    chapter: string;
    ok: boolean;
    seq?: number;
    reason?: string;
  }): Promise<{ ok: boolean }>;
  on(fn: (e: { name: string; detail: unknown }) => void): () => void;
}

export interface GalleySessionDeps {
  client: () => GalleyClient | null;
  engine: () => Pick<CommitEngine, "commitRangePatch" | "generation"> | null;
  /** Kill switch (settings `preview.inlineEditing`). */
  enabled: () => boolean;
}

export interface GalleySessionHooks {
  /** Bubble positioning — needs the iframe rect, which only the page can read. */
  onSelection?: (detail: unknown) => void;
  /** An opaque atom was activated — open the block overlay in galley mode. */
  onOpaqueEdit?: (detail: GalleyOpaqueEditDetail) => void;
  /**
   * A whole-chapter commit was refused or failed (expected-mismatch, buffer
   * not clean, load failed, …). The author's typing is still on screen but did
   * NOT reach disk — the UI must toast advising a preview reload; silence here
   * is invisible data loss. No retry loops: a stale frame stays stale until
   * the author reloads it.
   */
  onStale?: (chapter: string, reason: string, message?: string) => void;
  onRenderPass?: () => void;
  onViewportChanged?: () => void;
}

export class GalleySession {
  /** Uncommitted edits exist in the frame (test/telemetry hook). */
  dirty = false;
  /** Monotonic count of applied whole-chapter commits (test/telemetry hook). */
  applied = 0;

  private hooks: GalleySessionHooks | undefined;
  /**
   * Pending whole-chapter saves, latest-wins per chapter: a chapter queued
   * twice keeps only the newest serialization (each `galleyContent` payload
   * is the COMPLETE file, so the older one is strictly superseded).
   */
  private queue = new Map<string, GalleyContentDetail>();
  /** One commit at a time — each flush re-reads the buffer the next validates against. */
  private draining = false;

  constructor(private deps: GalleySessionDeps) {}

  /**
   * Own the edit slice of a client's event stream (the sibling-controller
   * pattern — ContextMenuController/BlockOverlayController do the same):
   * routes the v8 galley events and re-syncs edit mode on ready/render passes.
   */
  subscribe(client: GalleyClient, hooks?: GalleySessionHooks): () => void {
    this.hooks = hooks;
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
      // A pre-v8 frame (stale bundle) has no edit mode — nothing to sync.
    }
  }

  /** Route a preview event (also reachable directly for tests). */
  handleEvent(name: string, detail: unknown): void {
    switch (name) {
      case "galleyContent":
        this.enqueueContent(detail as GalleyContentDetail);
        return;
      case "galleyOpaqueEdit":
        this.hooks?.onOpaqueEdit?.(detail as GalleyOpaqueEditDetail);
        return;
      case "editStateChanged":
        this.dirty = Boolean((detail as { dirty?: boolean } | null)?.dirty);
        return;
    }
  }

  private enqueueContent(detail: GalleyContentDetail | null | undefined): void {
    if (!detail || typeof detail.chapter !== "string") return;
    this.queue.set(detail.chapter, detail);
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.size) {
        const next = this.queue.entries().next().value as [string, GalleyContentDetail];
        this.queue.delete(next[0]);
        await this.commitContent(next[1]);
      }
    } finally {
      this.draining = false;
    }
  }

  /**
   * Commit one chapter's serialization as ONE whole-file range patch.
   *
   * Range mapping is byte-exact against commit-engine.ts's line-splice
   * semantics: the engine resolves `[0, N)` with `buildLineStarts`
   * (`\r\n?|\n`) + `charRange`, which clamps any line index `>= starts.length`
   * to `text.length`. For LF/CRLF content, `expected.split("\n").length`
   * equals the buffer's own line-start count exactly when `expected` matches
   * the buffer, so the char range resolves to `[0, content.length)` — the
   * WHOLE file — and the engine's Step-3 equality check compares `expected`
   * against the entire buffer byte-for-byte. (A lone-CR file undercounts via
   * `split("\n")`; the slice then mismatches and the commit refuses —
   * fail-safe, surfaced through onStale, never a wrong splice.)
   */
  /**
   * Text this session last successfully wrote per chapter. When a forced
   * pre-swap flush emits a proposal whose `expected` predates a commit this
   * session itself applied (both proposals shared the same baseline), the
   * mismatch is against OUR OWN write — retry once against it rather than
   * suspending the chapter (ADR 0011; Opus-verified swap-flush scenario).
   */
  private lastApplied = new Map<string, string>();

  private async commitContent(detail: GalleyContentDetail): Promise<void> {
    const engine = this.deps.engine();
    if (!engine) {
      this.hooks?.onStale?.(detail.chapter, "no-engine");
      void this.ackFrame(detail, false, "no-engine");
      return;
    }
    const attempt = (expected: string) =>
      engine.commitRangePatch({
        chapter: detail.chapter,
        range: [0, expected.split("\n").length],
        expected,
        replacement: detail.markdown,
        origin: "inline-edit",
        expectedGeneration: engine.generation,
        // The server LF-normalizes the source it serves to the frame, so the
        // frame's expected/markdown are LF even for a CRLF file on disk; the
        // engine re-encodes on match (ADR 0011).
        eolTolerant: true,
      });
    let outcome = await attempt(detail.expected);
    const applied = this.lastApplied.get(detail.chapter);
    if (!outcome.ok && outcome.reason === "mismatch" && applied && applied !== detail.expected) {
      outcome = await attempt(applied);
    }
    if (outcome.ok) {
      this.applied++;
      this.lastApplied.set(detail.chapter, detail.markdown);
    } else {
      this.hooks?.onStale?.(
        detail.chapter,
        outcome.reason,
        "message" in outcome ? (outcome as { message?: string }).message : undefined,
      );
    }
    // The frame advances its expected-chain ONLY on this ack — an
    // unacknowledged or refused proposal must not move it, or every later
    // save for the chapter would be refused against a wrong baseline.
    void this.ackFrame(detail, outcome.ok, outcome.ok ? undefined : outcome.reason);
  }

  private async ackFrame(
    detail: GalleyContentDetail,
    ok: boolean,
    reason?: string,
  ): Promise<void> {
    try {
      await this.deps.client()?.galleyAckContent({
        chapter: detail.chapter,
        ok,
        seq: detail.seq,
        reason,
      });
    } catch {
      /* frame gone mid-teardown — nothing to ack */
    }
  }
}
