/**
 * InlineEditController — the SPA half of in-flow block editing
 * (docs/inline-editing-plan.md §3.3, protocol v8).
 *
 * Replaces `BlockOverlayController` + `BlockEditOverlay.svelte`. The editing
 * surface is now the block's OWN element inside the book iframe, so everything
 * those two existed to do — fragment-rect geometry, the dimming mask and
 * scroll lock, iframe-origin translation, pane clamping, `maxHeight` math, a
 * second CodeMirror view with its own focus trap and IME guard, and
 * re-anchoring on every page/viewport change — is gone. The caret lives in the
 * page; the page owns all of it.
 *
 * What is left is the part that was always SPA-side and must stay there: read
 * the block's source from the AUTHORITATIVE buffer (never from the DOM),
 * capture the commit gate's inputs at open time, and hand the returned text to
 * `commitRangePatch`. The commit engine is untouched (ADR 0009 decision 3).
 *
 * `.svelte.ts` suffix: `open` is `$state` so the chrome can reflect "an edit is
 * in progress" (e.g. suppressing shortcuts that would fight the in-book
 * caret). No component reads geometry from here, because there is none.
 *
 * Host coupling is injected so this stays testable with fakes and PWA-clean
 * (CLAUDE.md §8 / ADR 0004): ZERO direct DOM / `node:*` / lib value imports.
 */
import type { PreviewEvent, SourceRange } from "$lib/preview-client";
import type { CommitEngine } from "$lib/editor/commit-engine";
import { chapterPath } from "$lib/editor/chapter-path";
import { buildLineStarts, charRange } from "$lib/editor/source-range";

/** Minimal preview-client surface the controller drives (protocol v8). */
export interface InlineEditClient {
  on(fn: (e: PreviewEvent) => void): () => void;
  beginBlockEdit(spec: {
    chapter: string;
    range: SourceRange;
    text: string;
    caret?: { x: number; y: number };
  }): Promise<{ ok: boolean; reason?: string }>;
  endBlockEdit(spec: { commit: boolean }): Promise<{ ended: boolean; text: string | null }>;
}

/** The target both entry points hand off: the context menu item and double-click. */
export interface InlineEditTarget {
  chapter: string;
  range: SourceRange;
  /** Where to seat the caret, in iframe viewport coordinates. */
  caret?: { x: number; y: number };
}

export interface InlineEditDeps {
  /** The live preview client, or undefined when no document is loaded. */
  client: () => InlineEditClient | undefined;
  /** The open project directory, or null when none is loaded. */
  currentDir: () => string | null;
  /** The live in-editor content of the one open file, or null. */
  openContent: (path: string) => string | null;
  /**
   * Read a chapter's file DIRECTLY — NOT through `selectEditorFile`, keeping
   * the discipline the overlay had: never disturb which file the editor pane
   * shows just to start an edit in the preview.
   */
  readFile: (path: string) => Promise<string>;
  /** The commit engine — owns the write path AND the edit-generation counter. */
  commitEngine: CommitEngine;
  toastError: (message: string) => void;
  /** "This section changed — reopen to edit". */
  toastInfo: (message: string) => void;
}

/**
 * Split a captured block slice's trailing NEWLINE-ONLY run into `{editable,
 * trailingBlank}`.
 *
 * A run of `k` consecutive trailing newline tokens corresponds to the last
 * content line's own required line terminator (1 token) plus `k - 1` blank
 * lines after it. Only the blank-line tokens are stripped — the block's own
 * last line (its text AND its own terminator, if any) is always left intact
 * in `editable`, so a fence's closing line (non-blank — it's backticks, not
 * whitespace) is never touched, and a block with no trailing newline at all
 * (last block in a file) strips nothing.
 *
 * `trailingBlank` is re-appended VERBATIM on commit — this is what prevents an
 * author from merging two blocks by deleting the terminal newline. Carried over
 * unchanged from the overlay controller; it is a source-boundary rule, not
 * presentation, so it survived the redesign intact.
 */
export function splitTrailingBlankRun(slice: string): { editable: string; trailingBlank: string } {
  const runMatch = slice.match(/(?:\r\n?|\n)+$/);
  if (!runMatch) return { editable: slice, trailingBlank: "" };
  const run = runMatch[0];
  const runStart = slice.length - run.length;
  const tokens = run.match(/\r\n?|\n/g) ?? [];
  if (tokens.length <= 1) return { editable: slice, trailingBlank: "" };
  const keep = tokens[0]!;
  const trailingBlank = tokens.slice(1).join("");
  return { editable: slice.slice(0, runStart) + keep, trailingBlank };
}

interface Captured {
  chapter: string;
  range: SourceRange;
  /** The FULL slice (including the trailing blank run) captured at open time — `commitRangePatch`'s `expected`. */
  expected: string;
  trailingBlank: string;
  expectedGeneration: number;
}

export class InlineEditController {
  private deps: InlineEditDeps;

  /** True while a block in the preview is being edited in place. */
  open = $state(false);

  private captured: Captured | null = null;
  private requestId = 0;
  /**
   * True from a commit until the preview has re-rendered.
   *
   * This closes a hazard the generation counter alone cannot: while it is set,
   * every `data-source-range` in the book document was computed from
   * PRE-commit content, so a range arriving from a double-click indexes the
   * wrong lines of the post-commit buffer. The slice captured at that range
   * would then be compared against ITSELF at commit time and match trivially —
   * the exact failure mode ADR 0009 §3 describes for a dirty buffer, reached by
   * a different route. The generation check does not catch it, because the
   * capture is taken AFTER the commit that bumped the generation.
   *
   * Chaining edits is reachable in one gesture (double-clicking straight from
   * one block to another commits the first via blur), so this is a live path,
   * not a theoretical one. The window is short — the shell releases its swap
   * hold the moment the edit closes — and self-clearing on the next
   * `renderingComplete`.
   */
  private pendingRender = false;

  constructor(deps: InlineEditDeps) {
    this.deps = deps;
  }

  /**
   * Subscribe to a preview client's event stream. Returns the unsubscribe fn.
   *
   * Handles BOTH iframe-initiated paths, which is the whole reason this is
   * event-driven: the caret is in a cross-origin document, so a keystroke that
   * ends the edit (Escape, Cmd/Ctrl+Enter) or a click that blurs it is
   * invisible to the SPA until the book document reports it.
   */
  subscribe(client: InlineEditClient): () => void {
    return client.on((e) => void this.handleEvent(e));
  }

  private async handleEvent(e: PreviewEvent): Promise<void> {
    switch (e.name) {
      case "blockEditRequested": {
        // Double-click entry point. The book document asks; the SPA decides,
        // because only the SPA can read the authoritative source.
        const chapter = e.detail.chapter;
        const range = e.detail.range;
        if (!chapter || !range) return;
        await this.show({
          chapter,
          range,
          caret:
            typeof e.detail.x === "number" && typeof e.detail.y === "number"
              ? { x: e.detail.x, y: e.detail.y }
              : undefined,
        });
        break;
      }
      case "blockEditFinished": {
        // The author ended it from inside the book. The text arrives with the
        // event, so no round-trip is needed (and none would be safe — the
        // element has already been restored to rendered HTML by now).
        const text = typeof e.detail.text === "string" ? e.detail.text : null;
        if (e.detail.commit && text != null) await this.commit(text);
        else this.discard();
        break;
      }
      case "renderingComplete":
        // Bumping the generation here too (alongside ContextMenuController's
        // own identical call) double-increments `gen` on a single render when
        // both controllers are live — harmless: the commit gate is a NOT-EQUAL
        // check against a captured snapshot, so any nonzero delta invalidates a
        // stale capture identically to a delta of exactly one. Keeping the call
        // here keeps this controller correct standalone, e.g. under test with
        // no ContextMenuController present.
        this.deps.commitEngine.noteRenderingComplete();
        // Fresh DOM: every source range on screen indexes current content
        // again, so new edits are safe to open.
        this.pendingRender = false;
        // A completed render means the frame was replaced, so the element that
        // held the caret is gone with it. preview-shell.js holds hot-reload
        // swaps while an edit is open, so this is the rare path (a render that
        // did not come from a content update) rather than the normal one — but
        // once it happens the in-progress text can no longer be verified
        // against what is on screen, and continuing to edit it is not safe.
        if (this.open) this.closeWithToast();
        break;
    }
  }

  /** Entry point for both the context menu's "Edit this block" and double-click. */
  async show(target: InlineEditTarget): Promise<void> {
    const client = this.deps.client();
    if (!client) return;
    if (this.pendingRender) {
      // Refusing is the only safe answer here — see `pendingRender`. Told
      // plainly rather than silently dropped, because the author's
      // double-click did nothing visible.
      this.deps.toastInfo("Updating the preview — try that again in a moment.");
      return;
    }
    const requestId = ++this.requestId;

    // Starting a second edit while one is live: end the first through the
    // normal commit path rather than letting the book document drop it. (The
    // iframe would also commit its predecessor, but it has no way to write.)
    if (this.open) await this.endActive(true);
    if (requestId !== this.requestId) return;
    // Re-check: ending that predecessor COMMITTED it, which invalidates every
    // source range currently on screen — including the one this call carries.
    // Checking only at the top of the function would walk straight into the
    // stale-range write `pendingRender` exists to prevent.
    if (this.pendingRender) {
      this.deps.toastInfo("Updating the preview — try that again in a moment.");
      return;
    }

    const source = await this.readChapterSource(target.chapter);
    if (requestId !== this.requestId) return;
    if (source == null) {
      this.deps.toastError("Couldn't read this chapter's source.");
      return;
    }
    let from: number;
    let to: number;
    try {
      const starts = buildLineStarts(source);
      [from, to] = charRange(source, starts, target.range);
    } catch {
      this.deps.toastError("Couldn't locate this block in the source.");
      return;
    }
    const slice = source.slice(from, to);
    const { editable, trailingBlank } = splitTrailingBlankRun(slice);

    let started: { ok: boolean; reason?: string };
    try {
      started = await client.beginBlockEdit({
        chapter: target.chapter,
        range: target.range,
        text: editable,
        caret: target.caret,
      });
    } catch {
      started = { ok: false };
    }
    if (requestId !== this.requestId) return;
    if (!started.ok) {
      this.deps.toastError("Couldn't locate this block on the page.");
      return;
    }

    this.captured = {
      chapter: target.chapter,
      range: target.range,
      expected: slice,
      trailingBlank,
      expectedGeneration: this.deps.commitEngine.generation,
    };
    this.open = true;
  }

  /**
   * End an edit the SPA initiated (a dialog opening over the workspace). The
   * iframe emits no `blockEditFinished` for this path — it hands the text back
   * in the reply instead — so the commit happens here.
   */
  async endActive(commit: boolean): Promise<void> {
    if (!this.open) return;
    const client = this.deps.client();
    if (!client) {
      this.discard();
      return;
    }
    let result: { ended: boolean; text: string | null };
    try {
      result = await client.endBlockEdit({ commit });
    } catch {
      this.discard();
      return;
    }
    if (commit && result.ended && result.text != null) await this.commit(result.text);
    else this.discard();
  }

  /** Commit edited text through the one write path. */
  private async commit(editedText: string): Promise<void> {
    const captured = this.captured;
    if (!captured) return;
    const replacement = editedText + captured.trailingBlank;
    this.reset();
    this.pendingRender = true;
    const outcome = await this.deps.commitEngine.commitRangePatch({
      chapter: captured.chapter,
      range: captured.range,
      expected: captured.expected,
      replacement,
      expectedGeneration: captured.expectedGeneration,
    });
    if (!outcome.ok) {
      // Nothing was written, so no render is coming to clear the guard — and
      // the DOM's ranges still match the unchanged buffer, so they are not
      // stale. A refused commit must not brick the next edit.
      this.pendingRender = false;
      this.deps.toastError(outcome.message);
    }
  }

  /** Drop the capture without writing (cancel, or a failed handoff). */
  private discard(): void {
    this.reset();
  }

  private closeWithToast(): void {
    this.reset();
    this.deps.toastInfo("This section changed — reopen to edit.");
  }

  private reset(): void {
    this.open = false;
    this.captured = null;
  }

  private async readChapterSource(chapter: string): Promise<string | null> {
    const dir = this.deps.currentDir();
    if (!dir) return null;
    const absPath = chapterPath(dir, chapter);
    const open = this.deps.openContent(absPath);
    if (open != null) return open;
    try {
      return await this.deps.readFile(absPath);
    } catch {
      return null;
    }
  }
}
