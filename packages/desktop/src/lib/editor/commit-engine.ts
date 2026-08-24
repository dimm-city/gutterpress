/**
 * commit-engine.ts — the single write path for context-menu and in-flow
 * block-edit mutations (docs/inline-editing-plan.md §3).
 *
 * `commitRangePatch({chapter, range, expected, replacement, expectedGeneration})`
 * is the ONLY function in the app that turns a menu action into a file
 * mutation. It never writes a file itself — every mutation flows into the
 * EXISTING `EditorBuffer` (buffer.edit / buffer.flush) or, when a CodeMirror
 * view is mounted on the target file, through `applyRangeEdit` so the edit
 * shares that view's undo history (plan §1 principle 2, "one write path").
 *
 * Pure logic + injected seams (buffer accessor, `selectEditorFile`, editor
 * accessors, `currentDir`, `rendering`) — zero DOM / `node:*` / lib value
 * imports (CLAUDE.md §8 / ADR 0004), unit-tested with fakes
 * (`tests/editor/commit-engine.test.ts`).
 *
 * Every step below is numbered to match the plan's §4.7 pseudocode exactly —
 * do not reorder GATE 0 relative to Steps 1-5; the ordering is what makes the
 * gates meaningful (see the clean-buffer-gate comment inline below and ADR
 * 0009).
 */
import { chapterPath, isSafeChapterId } from "./chapter-path";
import { buildLineStarts, charRange } from "./source-range";
import { basenameOf } from "$lib/platform/paths";

/** Minimal EditorBuffer surface the engine drives (see buffer-state.svelte.ts). */
export interface CommitEngineBuffer {
  filePath: string | null;
  content: string;
  diskContent: string;
  phase: "clean" | "dirty" | "saving" | "error";
  externalChange: unknown | null;
  hasPendingSave: boolean;
  reconcileExternalChange(): Promise<void>;
  flush(): Promise<void>;
  edit(text: string): void;
}

export interface CommitEngineDeps {
  /** The open project directory, or null when none is loaded. */
  currentDir: () => string | null;
  /** True while a preview render is in flight (GATE 0b). */
  rendering: () => boolean;
  /** The live editor buffer, or null before it has been constructed. */
  buffer: () => CommitEngineBuffer | null;
  /**
   * The app's EXISTING file-selection machinery (`+page.svelte`'s
   * `selectEditorFile`) — atomically loads, flushes, and activates one file.
   * Resolves false when the handoff cannot safely complete.
   */
  selectEditorFile: (path: string) => Promise<boolean>;
  /**
   * Whether the mounted one-file editor currently displays this file.
   */
  editorHasFile: (path: string) => boolean;
  /**
   * Dispatch a range edit into the live CodeMirror view. `from`/`to` are
   * offsets into that one file's content.
   */
  applyRangeEdit: (path: string, from: number, to: number, insert: string) => void;
}

export interface CommitPatch {
  /** `data-chapter-src` of the enclosing wrapper — canonical, forward-slash, project-relative. */
  chapter: string;
  /** `data-source-range` `[start, end)` of the target block (0-based, half-open line range). */
  range: [number, number];
  /**
   * The exact source slice the menu/overlay captured at OPEN time (from
   * `buffer.content`, with the freshness/clean gates holding then too — see
   * plan §4.7 Step 3's comment). The commit is refused, not guessed, when
   * this no longer matches.
   */
  expected: string;
  /** The full replacement text for the `[from, to)` character range. */
  replacement: string;
  /**
   * {@link CommitEngine.generation} as read by the caller when the menu/
   * overlay opened. Re-checked at apply time (GATE 0b, plan §4.9) — closes
   * the window where an earlier commit's flush completes (buffer clean
   * again) before the chapter splice refreshes the DOM a second action's
   * `range`/`expected` were captured from.
   */
  expectedGeneration: number;
}

export type CommitFailureReason =
  | "no-project"
  | "unsafe-chapter-path"
  | "render-in-flight"
  | "stale-generation"
  | "flush-outgoing-failed"
  | "load-failed"
  | "chapter-changed"
  | "not-clean"
  | "malformed-range"
  | "mismatch";

export interface CommitFailure {
  ok: false;
  reason: CommitFailureReason;
  /** Human-readable message for a toast / disabled-item tooltip. */
  message: string;
  /**
   * 1-based line to jump to for the pseudocode's degrade destination
   * ("Open in editor at line range[0]+1"). Null only when `range` itself was
   * unusable (non-finite).
   */
  degradeLine: number | null;
}

export interface CommitSuccess {
  ok: true;
  /**
   * False when `buffer.flush()` detected an external change: the edit landed
   * in the buffer as a dirty edit and the buffer's own `onExternalConflict`
   * callback has already surfaced the conflict banner. That is the NORMAL
   * conflict flow (plan §4.7 Step 5), not a commit-engine error — the patch
   * itself was applied successfully.
   */
  flushed: boolean;
}

export type CommitOutcome = CommitSuccess | CommitFailure;

/**
 * `data-chapter-src` crosses the untrusted preview bridge (plan §3.5: the
 * book document runs author content with `allow-scripts`, and everything in
 * `contextMenuRequested`/`getContextTargetAt` payloads is untrusted input).
 * Reject anything that isn't a plain forward-slash-relative id BEFORE joining
 * it onto the project directory in {@link chapterPath} — a `..` segment, a
 * leading `/`, a backslash, or a drive letter must never be allowed to walk
 * `chapterPath`'s result outside the project directory. Fail closed: any
 * segment that doesn't look like an ordinary relative path name rejects the
 * whole chapter id.
 */
/**
 * CLEAN means: the buffer isn't in an error phase, has no pending external
 * change awaiting the conflict banner, and its live content exactly equals
 * the last-known disk content.
 */
function isCleanBuffer(buf: CommitEngineBuffer): boolean {
  return buf.phase !== "error" && buf.externalChange == null && buf.content === buf.diskContent;
}

export class CommitEngine {
  private deps: CommitEngineDeps;
  private gen = 0;

  constructor(deps: CommitEngineDeps) {
    this.deps = deps;
  }

  /**
   * Monotonic edit-generation counter (plan §4.9). Read this when a menu or
   * overlay opens and pass it back as `expectedGeneration`; call
   * {@link noteRenderingComplete} on every `renderingComplete` preview event.
   * The counter also increments on every successful apply from this engine —
   * paralleling `+page.svelte`'s existing `editorFileSelectionEpoch` pattern.
   */
  get generation(): number {
    return this.gen;
  }

  /** Call on every preview `renderingComplete` event (plan §4.9). */
  noteRenderingComplete(): void {
    this.gen++;
  }

  async commitRangePatch(patch: CommitPatch): Promise<CommitOutcome> {
    const degradeLine = Number.isFinite(patch.range?.[0]) ? patch.range[0] + 1 : null;
    const fail = (reason: CommitFailureReason, message: string): CommitFailure => ({
      ok: false,
      reason,
      message,
      degradeLine,
    });

    // ── GATE 0a — path resolution. Never match by basename; the chapter
    // value is untrusted (see isSafeChapterId's comment), so validate its
    // shape before it is ever joined onto the project directory.
    const dir = this.deps.currentDir();
    if (!dir) return fail("no-project", "No project is open.");
    if (!isSafeChapterId(patch.chapter)) {
      return fail("unsafe-chapter-path", "This block's chapter reference looks invalid.");
    }
    const absPath = chapterPath(dir, patch.chapter);

    // ── GATE 0b — no render in flight, and the menu/overlay's captured
    // generation is still current.
    if (this.deps.rendering()) {
      return fail("render-in-flight", "The preview is still updating — try again in a moment.");
    }
    if (patch.expectedGeneration !== this.gen) {
      return fail(
        "stale-generation",
        "This part of the page changed since the menu opened — reopen it and try again.",
      );
    }

    // ── Step 1 — ensure the buffer + editor state hold `chapter`, via the
    // app's EXISTING file-selection machinery (never buffer.load() directly).
    let buf = this.deps.buffer();
    if (!buf || buf.filePath !== absPath) {
      if (buf?.filePath && buf.hasPendingSave) {
        // Flush the OUTGOING file directly (never +page.svelte's
        // flushEditorBuffer wrapper, which swallows the real error to a
        // boolean) so a failure can name the file that couldn't be saved.
        try {
          await buf.flush();
        } catch {
          const outgoing = basenameOf(buf.filePath);
          return fail(
            "flush-outgoing-failed",
            `Couldn't save pending changes to ${outgoing} — resolve that first.`,
          );
        }
      }
      const ok = await this.deps.selectEditorFile(absPath);
      buf = this.deps.buffer();
      if (!ok || !buf || buf.filePath !== absPath) {
        return fail("load-failed", "Couldn't open that chapter.");
      }
    } else {
      // ── GATE 0c FRESHNESS (same-chapter fast path) — reconcile BEFORE
      // composing the patch, so a just-arrived external edit degrades the
      // action instead of being fought through the conflict banner after a
      // stale-base mutation. `reconcileExternalChange()` operates on
      // whatever `buffer.filePath` currently is; for the cross-chapter
      // branch above, `selectEditorFile`'s own `load()` is itself a live
      // disk read, which already gives that branch a fresh baseline.
      await buf.reconcileExternalChange();
      buf = this.deps.buffer();
      if (!buf || buf.filePath !== absPath) {
        return fail("chapter-changed", "The open chapter changed — try again.");
      }
    }

    // THE CLEAN-BUFFER GATE IS LOAD-BEARING — DO NOT REPLACE IT WITH A SLICE
    // COMPARISON. The preview DOM was rendered from *saved* content; if the
    // buffer is dirty (the author typed in the editor pane), the DOM's line
    // ranges still index the OLD content while the character offsets
    // resolved below are computed against the NEW buffer content. `expected`
    // was captured from that misaligned slice, so the Step 3 equality check
    // below can pass TRIVIALLY on the wrong occurrence of a repeated block
    // (boilerplate captions, disclaimers) — no slice comparison can detect
    // that failure mode, only this gate can. A dirty/error/conflicted
    // chapter must degrade to "open in editor", never guess. See ADR 0009
    // ("commit engine clean-buffer gate") and plan §4.9.
    if (!isCleanBuffer(buf)) {
      return fail(
        "not-clean",
        "This chapter has unsaved changes — open it in the editor to make this change.",
      );
    }

    // ── Step 2 — resolve the line range to character offsets against the
    // buffer content the gates above just proved is clean and fresh.
    let from: number;
    let to: number;
    try {
      const starts = buildLineStarts(buf.content);
      [from, to] = charRange(buf.content, starts, patch.range);
    } catch {
      return fail("malformed-range", "Couldn't locate this block in the source.");
    }

    // ── Step 3 — validate the slice matches what was captured at open time.
    // This is a drift-SINCE-OPEN check only; the clean-buffer gate above is
    // what makes it meaningful (see the comment there).
    if (buf.content.slice(from, to) !== patch.expected) {
      return fail("mismatch", "This block changed — reopen to make this change.");
    }

    // ── Step 4 — apply through whichever path is live. Ask the EDITOR whether
    // its document holds this file (never infer from buffer.filePath alone) so
    // an editor showing something else never receives a transaction meant for
    // the buffer-only path.
    if (this.deps.editorHasFile(absPath)) {
      this.deps.applyRangeEdit(absPath, from, to, patch.replacement);
    } else {
      buf.edit(buf.content.slice(0, from) + patch.replacement + buf.content.slice(to));
    }
    this.gen++;

    // ── Step 5 — flush immediately. A discrete committed action must not sit
    // behind the autosave debounce (settings.editor.autoSaveDelay, default
    // 500ms — EditorBuffer's own `?? 500` class fallback is never reached by
    // the desktop app, which always passes an explicit saveDelayMs).
    try {
      await buf.flush();
      return { ok: true, flushed: true };
    } catch {
      // flush() throws when performSave's live disk compare finds an
      // external change. The buffer's own onExternalConflict callback has
      // already surfaced the conflict banner; the patch stays in the buffer
      // as a dirty edit. That's the normal conflict flow (plan §4.7 Step 5),
      // not a commit-engine failure — the edit itself was applied.
      return { ok: true, flushed: false };
    }
  }
}
