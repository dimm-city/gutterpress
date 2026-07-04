/**
 * EditorPreviewSyncController — the editor↔preview scroll/anchor timing machine
 * that used to live inline in `+page.svelte` (the cross-chapter reveal
 * `setTimeout` polling loop, the mutable `crossChapterReveal` retry/nudge
 * bookkeeping, the `Date.now()` echo-suppression window, and the editor→preview
 * anchor-line follow).
 *
 * The timing surface — a clock (`now`) and a scheduler (`schedule`, a
 * `setTimeout` stand-in) — is INJECTED so the whole state machine is
 * deterministic under a fake queue in tests. Host coupling (the preview client,
 * the editor accessors, the file/chapter openers, the page-sync sink) is
 * injected the same way, so this stays PWA-clean (§8 / ADR 0004): ZERO direct
 * DOM / `node:*` / lib value imports.
 *
 * Single-owner discipline mirrors `PreviewEventController`
 * (`routes/preview-event-controller.ts`), whose `sourceLineChanged` branch reads
 * `suppressPreviewSyncUntil` and calls `followChapterInEditor` back through this
 * controller.
 */

/** Minimal preview-client surface the sync machine drives. */
export interface EditorPreviewSyncClient {
  scrollTo(
    target: { line: number; chapter?: string | null },
    opts?: { block?: "start" | "center"; smooth?: boolean },
  ): Promise<{ page: number; sourceLine: number | null } | null>;
}

export interface EditorPreviewSyncDeps {
  /** The live preview client, or undefined when no document is loaded. */
  client: () => EditorPreviewSyncClient | undefined;
  /** True while a render is in flight (anchor follow is suppressed). */
  rendering: () => boolean;
  /** The open project directory, or null when none is loaded. */
  currentDir: () => string | null;
  /** The chapter (source filename) currently open in the editor. */
  editorChapter: () => string | null;
  /** Whether an editor component is mounted (reveal target exists). */
  hasEditorRef: () => boolean;
  /** Open a chapter's file in the editor (async buffer swap). */
  selectEditorFile: (path: string) => void;
  /** Reveal a line in the currently-open chapter (no-op if no editor). */
  revealEditorLine: (line: number) => void;
  /** Reflect a scroll-driven page into the toolbar (pageNav.syncPageState). */
  syncPageAfterScroll: (page: number) => void;
  /** Injected clock (ms). */
  now: () => number;
  /** Injected scheduler (a `setTimeout` stand-in). */
  schedule: (fn: () => void, delayMs: number) => void;
}

/** Per-request cross-chapter reveal bookkeeping (retries + nudges). */
interface CrossChapterReveal {
  chapter: string;
  line: number;
  tries: number;
  nudges: number;
}

export class EditorPreviewSyncController {
  private deps: EditorPreviewSyncDeps;

  // Timestamp guard: while the preview is being driven from the editor side,
  // ignore the sourceLineChanged it emits so the two panes don't feed back.
  private suppressUntil = 0;

  // Cross-chapter follow (preview→editor): open the scrolled chapter's file and
  // reveal the line once the buffer has actually swapped to it. Polls
  // editorChapter (the file load is async) rather than guessing at timing.
  private crossChapterReveal: CrossChapterReveal | null = null;

  constructor(deps: EditorPreviewSyncDeps) {
    this.deps = deps;
  }

  /** Timestamp (ms) before which preview→editor follow is suppressed (echo guard). */
  get suppressPreviewSyncUntil(): number {
    return this.suppressUntil;
  }

  /** Open the echo-suppression window for `ms` from now. */
  suppressFor(ms: number): void {
    this.suppressUntil = this.deps.now() + ms;
  }

  /**
   * Cross-chapter follow (preview→editor): open the scrolled chapter's file and
   * reveal the line once the buffer has actually swapped to it. Caps at ~2s.
   */
  followChapterInEditor(chapter: string, line: number): void {
    const currentDir = this.deps.currentDir();
    if (!currentDir) return;
    const dir = currentDir.replace(/[\\/]+$/, "");
    this.crossChapterReveal = { chapter, line, tries: 0, nudges: 0 };
    // Join with the directory's own separator: on Windows currentDir uses
    // backslashes, and a mixed-separator path still LOADS (Win32 accepts it)
    // but never string-equals the host-native paths from listDir — so the
    // FileTree active highlight silently desyncs after a cross-chapter jump.
    const sep = dir.includes("\\") ? "\\" : "/";
    this.deps.selectEditorFile(`${dir}${sep}${chapter.replaceAll("/", sep)}`);
    this.pumpCrossChapterReveal();
  }

  private pumpCrossChapterReveal = (): void => {
    const r = this.crossChapterReveal;
    if (!r) return;
    if (this.deps.editorChapter() === r.chapter && this.deps.hasEditorRef()) {
      // The file load swaps the editor doc and resets scroll to the TOP, and
      // that reset can land AFTER our first reveal — so re-issue the reveal a
      // few times (~250ms) so the last one wins. Without this the editor sat at
      // the top of the newly-opened chapter instead of the synced line.
      this.suppressUntil = this.deps.now() + 300;
      this.deps.revealEditorLine(r.line);
      if (++r.nudges >= 5) {
        this.crossChapterReveal = null;
        return;
      }
      this.deps.schedule(this.pumpCrossChapterReveal, 50);
      return;
    }
    // Still waiting for the async file load to swap the buffer to this chapter.
    if (r.tries++ > 40) {
      this.crossChapterReveal = null;
      return;
    }
    this.deps.schedule(this.pumpCrossChapterReveal, 50);
  };

  /**
   * Editor→preview: the caret moved or the editor scrolled. Drive the preview to
   * the matching source line WITHIN the open chapter; guard the echo so the
   * preview's resulting sourceLineChanged doesn't bounce back into the editor.
   */
  onEditorAnchorLine(line: number, origin: "scroll" | "caret"): void {
    const client = this.deps.client();
    if (!client || this.deps.rendering()) return;
    this.suppressUntil = this.deps.now() + 400;
    // Scroll-driven anchors are the editor's TOP visible line → anchor the
    // preview block to the TOP so the panes agree. Caret-driven anchors carry
    // no viewport position (the caret sits anywhere), so CENTER the target —
    // top-anchoring it disagreed with the editor by the caret's distance from
    // the editor top (QA finding RC1-5).
    client
      .scrollTo(
        { line, chapter: this.deps.editorChapter() },
        { block: origin === "caret" ? "center" : "start" },
      )
      .then((res) => {
        // scrollTo suppresses the book's scroll-driven pageChanged, so reflect
        // the new page in the toolbar from the command's own return value.
        if (res?.page) this.deps.syncPageAfterScroll(res.page);
      })
      .catch(() => {});
  }
}
