/**
 * book-document.svelte.ts — the buffer registry behind the CONTINUOUS BOOK
 * DOCUMENT.
 *
 * The editor shows every chapter of the book as ONE CodeMirror document
 * (`book-layout.ts` / `book-field.ts`), but each chapter is still its own file
 * on disk with its own save state. This class is the seam between those two
 * facts: it owns ONE {@link EditorBuffer} per open file — reusing that class's
 * whole edit lifecycle (dirty/save state machine, debounced disk write,
 * crash-recovery snapshots, close-flush, external-edit reconciliation) exactly
 * as it always worked — and presents the aggregate to the page.
 *
 * Two kinds of file live here:
 *
 * - **Sections** — the markdown files the book builds from, in manifest
 *   `source.files` order. These are concatenated into the book document.
 * - **Standalone files** — a stylesheet, or a markdown file that isn't part of
 *   the book. These open as an ordinary single-file document, exactly as every
 *   file did before the book document existed.
 *
 * `activePath` is whichever file the caret is in. The page's `buffer` is this
 * file's buffer, so every existing consumer of "the open file's buffer" (the
 * status bar, the conflict banner, the commit engine, the context menu) keeps
 * working unchanged — it just follows the caret across chapters now instead of
 * following an explicit file-open.
 *
 * Desktop-only, like `EditorBuffer` itself. Zero DOM / `node:*` / lib value
 * imports (CLAUDE.md §8 / ADR 0004).
 */
import { EditorBuffer, type EditorBufferPhase, type ExternalChange } from "./buffer-state.svelte";
import type { BookSection } from "./book-layout";
import type { Platform } from "$lib/platform/contract";

/** One entry of the book's ordered chapter list. */
export interface BookSectionRef {
  /** Absolute, OS-native path. */
  path: string;
  /** Canonical forward-slash, project-relative chapter id. */
  chapter: string;
}

export interface BookDocumentOptions {
  platform: Platform;
  saveDelayMs?: number;
  recoveryEnabled?: boolean;
  /** Save/recovery error for `path`, with a human message. */
  onError?: (message: string) => void;
  /** An external edit was detected for `path` while its buffer was dirty. */
  onExternalConflict?: (path: string) => void;
  /** An external edit was safely auto-reloaded into `path`'s clean buffer. */
  onAutoReloaded?: (path: string) => void;
  /**
   * `path`'s content was replaced with a disk version the author didn't type
   * (auto-reload or the conflict banner's Reload). Push it into the live
   * editor — for a section that means splicing that segment of the book
   * document, for a standalone file replacing the whole document.
   */
  onContentReplaced?: (path: string, content: string) => void;
  /** Fires when the AGGREGATE pending-save state flips (any file dirty ↔ none). */
  onDirty?: (pending: boolean) => void;
  /**
   * Chapters the manifest lists that could not be read. They are dropped from
   * the book document rather than opened as empty buffers — an empty buffer
   * would auto-save an empty file over whatever the author later restores. Told
   * to the author once, never silently swallowed.
   */
  onSectionsUnavailable?: (paths: string[]) => void;
}

/**
 * The book's ordered chapter list, as project-relative ids.
 *
 * Mirrors the render pipeline exactly (`packages/cli/src/lib/markdown/index.ts`
 * and `build-runner.ts`): the manifest's `source.files` when it lists any, else
 * every top-level `.md` file in plain lexicographic order. The editor must
 * agree with the renderer here or the manuscript would read in a different
 * order than it prints.
 */
export function resolveBookChapters(
  markdownFiles: string[],
  manifestFiles: string[] | null | undefined,
): string[] {
  const listed = (manifestFiles ?? [])
    .map((f) => f.trim().replaceAll("\\", "/"))
    .filter((f) => f.length > 0);
  if (listed.length > 0) return listed;
  return [...markdownFiles].sort();
}

export class BookDocument {
  /** The book's ordered chapter list — the concatenation order of the document. */
  sections = $state<BookSectionRef[]>([]);
  /** Files open as ordinary single-file documents (stylesheets, stray markdown). */
  standalonePaths = $state<string[]>([]);
  /** The file the caret is in, or null when nothing is open. */
  activePath = $state<string | null>(null);

  private opts: BookDocumentOptions;
  private buffers = new Map<string, EditorBuffer>();
  private pendingPaths = new Set<string>();
  private lastPending = false;
  /** Guards against a stale `open()` result landing after a newer one. */
  private openGen = 0;
  /** True while `open()` is loading — per-file errors are batched, not toasted. */
  private opening = false;
  /**
   * What the last `open()` was ASKED for, before unreadable chapters were
   * dropped. `matchesSections` compares against this, so a manifest entry with
   * no file behind it doesn't make every folder-change notification look like a
   * change to the book's shape.
   */
  private requestedPaths: string[] = [];

  constructor(opts: BookDocumentOptions) {
    this.opts = opts;
  }

  // ── Active file (the surface the page's `buffer` variable points at) ───────

  get active(): EditorBuffer | null {
    return this.activePath ? (this.buffers.get(this.activePath) ?? null) : null;
  }

  /** Every open file's buffer — sections first, in book order. */
  private get allBuffers(): EditorBuffer[] {
    const paths = [...this.sections.map((s) => s.path), ...this.standalonePaths];
    return paths.map((p) => this.buffers.get(p)).filter((b): b is EditorBuffer => !!b);
  }

  /** True when `path` is one of the book's chapters (vs a standalone file). */
  isSection(path: string): boolean {
    return this.sections.some((s) => s.path === path);
  }

  chapterFor(path: string): string | null {
    return this.sections.find((s) => s.path === path)?.chapter ?? null;
  }

  pathForChapter(chapter: string): string | null {
    return this.sections.find((s) => s.chapter === chapter)?.path ?? null;
  }

  /**
   * The live in-editor content of `path`, or null when that file isn't open
   * here. Callers that need a chapter's CURRENT source (the context menu and
   * block overlay resolving a clicked block) must prefer this over reading the
   * file: with the whole book open, a chapter can carry unsaved edits even
   * though the caret is somewhere else entirely.
   */
  contentFor(path: string): string | null {
    return this.buffers.get(path)?.content ?? null;
  }

  bufferFor(path: string): EditorBuffer | null {
    return this.buffers.get(path) ?? null;
  }

  // ── Aggregate state ───────────────────────────────────────────────────────

  get isDirty(): boolean {
    return this.allBuffers.some((b) => b.isDirty);
  }

  get hasPendingSave(): boolean {
    return this.allBuffers.some((b) => b.hasPendingSave);
  }

  /**
   * One save phase for the whole book: "error" if any file failed, else
   * "saving"/"dirty" if any file is mid-write or unsaved, else "clean". The
   * status bar shows the book's state, not just the chapter under the caret.
   */
  get phase(): EditorBufferPhase {
    const phases = this.allBuffers.map((b) => b.phase);
    if (phases.includes("error")) return "error";
    if (phases.includes("saving")) return "saving";
    if (phases.includes("dirty")) return "dirty";
    return "clean";
  }

  /** The first file awaiting a Reload / Keep-mine decision, if any. */
  get conflict(): { path: string; change: ExternalChange } | null {
    for (const path of [...this.sections.map((s) => s.path), ...this.standalonePaths]) {
      const change = this.buffers.get(path)?.externalChange;
      if (change) return { path, change };
    }
    return null;
  }

  // ── Opening ───────────────────────────────────────────────────────────────

  /**
   * Load the book's chapters and return them as concatenation-ready sections.
   * Any previously open file that is no longer a chapter is dropped (its buffer
   * is flushed by the caller's project-switch flush, not silently discarded).
   * Returns an empty array when a newer `open()` superseded this one.
   *
   * A chapter that fails to read is left OUT of the document. Opening it as an
   * empty buffer would be worse than not opening it: the empty content becomes
   * the live value, and the next edit anywhere in the book would save it over
   * the file. `onSectionsUnavailable` reports the drop.
   */
  async open(refs: BookSectionRef[]): Promise<BookSection[]> {
    const gen = ++this.openGen;
    const requested = refs.map((r) => r.path);
    const buffers = refs.map((ref) => this.ensureBuffer(ref.path));
    // Per-file load errors are reported together below, not as one toast each.
    this.opening = true;
    try {
      await Promise.all(
        refs.map((ref, i) => {
          // NEVER re-read over unsaved work. A rebuild is triggered by the
          // book's SHAPE changing — a chapter added, deleted, or reordered —
          // which says nothing about the content of a chapter the author is
          // mid-edit in. Reloading it would discard an edit still inside the
          // autosave debounce, and the folder watcher's own reconciliation
          // deliberately skips a file with a save outstanding (any change while
          // one is in flight is definitionally its own echo), so nothing else
          // would catch it either.
          const buffer = buffers[i]!;
          if (buffer.filePath === ref.path && buffer.hasPendingSave) return;
          return buffer.load(ref.path);
        }),
      );
    } finally {
      this.opening = false;
    }
    if (gen !== this.openGen) return [];

    const usable: BookSection[] = [];
    const unavailable: string[] = [];
    refs.forEach((ref, i) => {
      const buffer = buffers[i]!;
      if (buffer.phase === "error") unavailable.push(ref.path);
      else usable.push({ path: ref.path, chapter: ref.chapter, content: buffer.content });
    });

    // A file that is BOTH a section and a standalone (the author added the file
    // they had open to `source.files`) belongs to the book from here on.
    const sectionPaths = new Set(usable.map((s) => s.path));
    const standalone = this.standalonePaths.filter((p) => !sectionPaths.has(p));
    // Standalone buffers survive a rebuild. Dropping them would `reset()` a
    // stylesheet the author is editing, cancelling its pending save — the book
    // changing shape has nothing to do with a file that isn't in the book.
    this.dropBuffersExcept([...sectionPaths, ...standalone]);
    this.requestedPaths = requested;
    this.sections = usable.map((s) => ({ path: s.path, chapter: s.chapter }));
    this.standalonePaths = standalone;
    // Keep the author where they are whenever that file is still open.
    const active = this.activePath;
    this.activePath =
      active && (sectionPaths.has(active) || standalone.includes(active))
        ? active
        : (usable[0]?.path ?? standalone[0] ?? null);
    if (unavailable.length > 0) this.opts.onSectionsUnavailable?.(unavailable);
    return usable;
  }

  /**
   * The chapter list this book would open for `refs`, compared against what is
   * open now. Lets the caller skip a rebuild when a folder-change notification
   * didn't actually change the book's shape (the common case — a save).
   */
  matchesSections(refs: BookSectionRef[]): boolean {
    return (
      refs.length === this.requestedPaths.length &&
      refs.every((ref, i) => this.requestedPaths[i] === ref.path)
    );
  }

  /**
   * Load a file that isn't part of the book (a stylesheet, or markdown outside
   * `source.files`) and make it active. Returns its content, or null when the
   * load was superseded.
   */
  async openStandalone(path: string): Promise<string | null> {
    const gen = this.openGen;
    const buffer = this.ensureBuffer(path);
    await buffer.load(path);
    if (gen !== this.openGen) return null;
    if (!this.isSection(path) && !this.standalonePaths.includes(path)) {
      this.standalonePaths = [...this.standalonePaths, path];
    }
    this.activePath = path;
    return buffer.content;
  }

  /** Point the active file at an already-open path. No disk read, no reload. */
  setActive(path: string): boolean {
    if (!this.buffers.has(path)) return false;
    this.activePath = path;
    return true;
  }

  /**
   * Record an edit to `path` (a section text split back out of the book
   * document, or a standalone document's new content). Routes to that file's
   * OWN buffer — a single keystroke can only touch one chapter, but a paste or
   * a delete across a boundary legitimately changes two, and each must reach
   * its own file's save machinery.
   */
  applyEdit(path: string, text: string): void {
    this.buffers.get(path)?.edit(text);
  }

  // ── Lifecycle fan-out ─────────────────────────────────────────────────────

  /** Flush every dirty file. Rejects with the first failure, like `flush()`. */
  async flushAll(): Promise<void> {
    let firstError: unknown = null;
    for (const buffer of this.allBuffers) {
      try {
        await buffer.flush();
      } catch (e) {
        firstError ??= e;
      }
    }
    if (firstError) throw firstError;
  }

  /** Re-stat + reconcile every open file against disk (folder-watch / sync). */
  async reconcileAll(): Promise<void> {
    await Promise.all(
      this.allBuffers.map((b) => b.reconcileExternalChange().catch(() => {})),
    );
  }

  /** Drop every buffer (project close/switch). */
  reset(): void {
    this.openGen++;
    for (const buffer of this.buffers.values()) buffer.reset();
    this.buffers.clear();
    this.pendingPaths.clear();
    this.notifyDirty();
    this.requestedPaths = [];
    this.sections = [];
    this.standalonePaths = [];
    this.activePath = null;
  }

  /** Forget one file (it was deleted, or renamed out from under us). */
  forget(path: string): void {
    this.buffers.get(path)?.reset();
    this.buffers.delete(path);
    this.pendingPaths.delete(path);
    this.notifyDirty();
    this.sections = this.sections.filter((s) => s.path !== path);
    this.standalonePaths = this.standalonePaths.filter((p) => p !== path);
    if (this.activePath === path) {
      this.activePath = this.sections[0]?.path ?? this.standalonePaths[0] ?? null;
    }
  }

  setSaveDelayMs(delayMs: number): void {
    this.opts.saveDelayMs = delayMs;
    for (const buffer of this.buffers.values()) buffer.setSaveDelayMs(delayMs);
  }

  setRecoveryEnabled(enabled: boolean): void {
    this.opts.recoveryEnabled = enabled;
    for (const buffer of this.buffers.values()) buffer.setRecoveryEnabled(enabled);
  }

  /** Reload: adopt the conflicted file's disk version. */
  acceptExternal(): void {
    const conflict = this.conflict;
    if (conflict) this.buffers.get(conflict.path)?.acceptExternal();
  }

  /** Keep mine: adopt the disk mtime as a baseline so our save isn't blocked. */
  keepMine(): void {
    const conflict = this.conflict;
    if (conflict) this.buffers.get(conflict.path)?.keepMine();
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private ensureBuffer(path: string): EditorBuffer {
    const existing = this.buffers.get(path);
    if (existing) return existing;
    const buffer = new EditorBuffer({
      platform: this.opts.platform,
      saveDelayMs: this.opts.saveDelayMs,
      recoveryEnabled: this.opts.recoveryEnabled,
      onError: (message) => {
        if (this.opening) return; // batched into onSectionsUnavailable
        this.opts.onError?.(message);
      },
      onExternalConflict: () => this.opts.onExternalConflict?.(path),
      onAutoReloaded: () => this.opts.onAutoReloaded?.(path),
      onContentReplaced: (filePath, content) =>
        this.opts.onContentReplaced?.(filePath, content),
      onDirty: (pending) => {
        if (pending) this.pendingPaths.add(path);
        else this.pendingPaths.delete(path);
        this.notifyDirty();
      },
    });
    this.buffers.set(path, buffer);
    return buffer;
  }

  private dropBuffersExcept(keep: string[]): void {
    const keepSet = new Set(keep);
    for (const [path, buffer] of this.buffers) {
      if (keepSet.has(path)) continue;
      buffer.reset();
      this.buffers.delete(path);
      this.pendingPaths.delete(path);
    }
    this.notifyDirty();
  }

  private notifyDirty(): void {
    const pending = this.pendingPaths.size > 0;
    if (pending === this.lastPending) return;
    this.lastPending = pending;
    this.opts.onDirty?.(pending);
  }
}
