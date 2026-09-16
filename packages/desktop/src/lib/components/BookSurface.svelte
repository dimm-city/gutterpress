<script lang="ts">
  /**
   * BookSurface - Read mode's one scroll of the whole book.
   *
   * The preview shows the book as one continuous run of pages; so does this.
   * Every chapter file is mounted, in the book's order, as its own paged
   * editor (`RichEditor`, stacked) inside ONE scroller, so reading runs from
   * the cover to the last page without ever "opening" a file, and the folios
   * continue across chapters: each chapter's decoration is told how many
   * pages come before it.
   *
   * One file per document still holds (D7): each chapter has its own host,
   * its own projection and its own undo. The workspace routes a chapter's
   * edits into that file's buffer (`onSnapshotChange`) and is told which
   * chapter the author is in (`onActivate`), so the file list, the toolbar
   * and "Edit in source" follow the pointer.
   *
   * Mounting is progressive: the chapter the author asked for first, then
   * its neighbours outward, one at a time, each after the previous one has
   * laid out its pages. A chapter not yet mounted holds its place with a
   * placeholder sized from the preview's page count, so the scrollbar is
   * honest from the start. A lock toggle re-runs the same queue instead of
   * rebuilding every editor in one frame.
   *
   * After an edit the chapter's projection is rebuilt once the author pauses
   * and swapped into the live mount (`refreshProjection`), which is what
   * keeps markers and plugin regions rendered through an editing session.
   *
   * No `$effect` (CLAUDE.md section 8): props are read once at mount, and
   * every later change reaches this component through its exports.
   */
  import { onMount, tick, untrack } from "svelte";
  import type { GutterpressProjection } from "gutterpress/render";
  import type { Diagnostic } from "@dimm-city/gutterpress-editor/core";
  import RichEditor from "$lib/components/RichEditor.svelte";
  import { DesktopDocumentHost } from "$lib/editor-host/desktop-document-host";

  export interface ChapterBuild {
    readonly projection: GutterpressProjection;
    readonly editorCss: string | undefined;
  }

  interface Slot {
    readonly path: string;
    readonly name: string;
    readonly host: DesktopDocumentHost | null;
    readonly projection: GutterpressProjection | null;
    readonly editorCss: string | undefined;
    readonly loaded: boolean;
    readonly mounted: boolean;
    /** True once the mounted editor has laid out its pages for the first time. */
    readonly laidOut: boolean;
    /** Bumped to remount the chapter's editor (a lock toggle). */
    readonly epoch: number;
    /** The chapter's last measured height, for its placeholder while unmounted. */
    readonly height: number;
  }

  interface ChapterEditor {
    getSelection(): { readonly from: number; readonly to: number } | undefined;
    setReadonly(next: boolean): void;
    setZoom(next: string): void;
    setPageOffset(offset: number): void;
    refreshProjection(next: GutterpressProjection): void;
    setSelection(from: number, to?: number): void;
  }

  let {
    chapters,
    initialPath = null,
    readonly = false,
    zoom = "fit-width",
    projectDir = null,
    pageEstimates = {},
    readChapter,
    buildProjection,
    onSnapshotChange,
    onActivate,
    onDiagnostic,
  }: {
    /** The book's chapter files, absolute paths, in book order. */
    chapters: readonly string[];
    /** The chapter to show first; the queue mounts outward from it. */
    initialPath?: string | null;
    readonly?: boolean;
    zoom?: string;
    projectDir?: string | null;
    /** Page counts per chapter path from the preview, for placeholder heights and folio offsets before a chapter has laid out. */
    pageEstimates?: Readonly<Record<string, number>>;
    readChapter: (path: string) => Promise<string>;
    buildProjection: (content: string, sourceVersion: number) => Promise<ChapterBuild>;
    /** A chapter's text changed through its editor: route it to that file's buffer. */
    onSnapshotChange: (path: string, text: string) => void;
    /** The author pressed into a chapter: make it the workspace's open file. */
    onActivate?: (path: string) => void;
    onDiagnostic?: (diagnostic: Diagnostic) => void;
  } = $props();

  const baseName = (path: string): string => path.replace(/\\/g, "/").split("/").pop() ?? path;

  // Props are read ONCE, here: the book is built for the chapter list it
  // opened with, and every later change (lock, zoom, a file switch) arrives
  // through the exports below. `untrack` says so to the compiler.
  let slots = $state.raw<Slot[]>(
    untrack(() =>
      chapters.map((path) => ({ path, name: baseName(path), host: null, projection: null, editorCss: undefined, loaded: false, mounted: false, laidOut: false, epoch: 0, height: 0 })),
    ),
  );
  let locked = $state(untrack(() => readonly));
  let zoomState = $state(untrack(() => zoom));
  let scroller = $state<HTMLDivElement | undefined>(undefined);

  /** Which chapter the author is in: the last one pressed into, else the one opened first. */
  let active: string | null = untrack(() => initialPath ?? chapters[0] ?? null);
  const refs: Record<string, ChapterEditor | undefined> = {};
  const els: Record<string, HTMLElement | undefined> = {};
  const unsubscribe = new Map<string, () => void>();
  const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const waiters = new Map<string, Array<() => void>>();
  const pagesByPath = new Map<string, number>();
  let queue: string[] = [];
  let pumping = false;
  let disposed = false;
  /** Restore the view to this chapter and offset once it has laid out again (a remount). */
  let restore: { path: string; delta: number } | null = null;

  const slotOf = (path: string): Slot | undefined => slots.find((s) => s.path === path);
  const patch = (path: string, changes: Partial<Slot>): void => {
    slots = slots.map((s) => (s.path === path ? { ...s, ...changes } : s));
  };
  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  /** Resolves when the chapter next reports a pagination, or after `timeoutMs`. */
  function paginationOf(path: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const list = waiters.get(path) ?? [];
      list.push(resolve);
      waiters.set(path, list);
      setTimeout(resolve, timeoutMs);
    });
  }

  /** Chapters in mounting order: `from` first, then its neighbours outward. */
  function order(from: string | null): string[] {
    const paths = slots.map((s) => s.path);
    const at = Math.max(0, from ? paths.indexOf(from) : 0);
    const out: string[] = [];
    for (let d = 0; d < paths.length; d++) {
      if (at + d < paths.length) out.push(paths[at + d]!);
      if (d > 0 && at - d >= 0) out.push(paths[at - d]!);
    }
    return out;
  }

  async function load(path: string): Promise<void> {
    const slot = slotOf(path);
    if (!slot || slot.loaded) return;
    const text = await readChapter(path);
    if (disposed) return;
    const host = new DesktopDocumentHost(text, { documentId: path });
    unsubscribe.get(path)?.();
    unsubscribe.set(
      path,
      host.subscribe((snapshot) => {
        onSnapshotChange(path, snapshot.text);
        scheduleRefresh(path);
      }),
    );
    const built = await buildProjection(text, host.getSnapshot().version);
    if (disposed) return;
    patch(path, { host, projection: built.projection, editorCss: built.editorCss, loaded: true });
  }

  /** Mount the queued chapters one at a time, each after the previous has laid out. */
  async function pump(): Promise<void> {
    if (pumping) return;
    pumping = true;
    try {
      while (!disposed && queue.length) {
        const path = queue.shift()!;
        if (slotOf(path)?.mounted) continue;
        await load(path);
        if (disposed || !slotOf(path)?.host || slotOf(path)?.mounted) continue;
        const laidOut = paginationOf(path, 2500);
        patch(path, { mounted: true });
        await laidOut;
      }
    } finally {
      pumping = false;
    }
  }

  function requeue(from: string | null): void {
    queue = order(from).filter((path) => !slotOf(path)?.mounted);
    void pump();
  }

  /** Folios continue through the book: each chapter is told how many pages come before it. */
  function applyOffsets(): void {
    let offset = 0;
    for (const slot of slots) {
      if (slot.mounted) refs[slot.path]?.setPageOffset(offset);
      offset += pagesByPath.get(slot.path) ?? pageEstimates[slot.path] ?? 1;
    }
  }

  function paginated(path: string, pages: number): void {
    pagesByPath.set(path, pages);
    const slot = slotOf(path);
    if (slot && !slot.laidOut) patch(path, { laidOut: true });
    applyOffsets();
    const list = waiters.get(path) ?? [];
    waiters.delete(path);
    for (const resolve of list) resolve();
    if (restore && restore.path === path && scroller) {
      const el = els[path];
      if (el) scroller.scrollTop = el.offsetTop + restore.delta;
      restore = null;
    }
  }

  /** A Letter sheet plus its gap at 1:1; only a chapter that has never laid out needs the guess. */
  const PLACEHOLDER_PAGE_PX = 1104;
  const placeholderHeight = (slot: Slot): number => slot.height || (pageEstimates[slot.path] ?? 1) * PLACEHOLDER_PAGE_PX;
  /**
   * A chapter's box holds its known height until its pages exist. The editor
   * renders the document unpaginated first and paginates it in the next
   * frame, and a chapter above the reader swinging between those heights
   * moved the view into the wrong chapter: the browser's scroll anchoring
   * followed the first swing and not the second. A box that never swings has
   * nothing to anchor against.
   */
  const settlingStyle = (slot: Slot): string =>
    slot.mounted && !slot.laidOut ? `height:${placeholderHeight(slot)}px;overflow:hidden` : "";

  /** The chapter whose pages are at the top of the view. */
  function chapterAtTop(): string | null {
    if (!scroller) return active;
    const top = scroller.scrollTop;
    for (const slot of slots) {
      const el = els[slot.path];
      if (el && el.offsetTop + el.offsetHeight > top) return slot.path;
    }
    return active;
  }

  function activate(path: string): void {
    if (active === path) return;
    active = path;
    onActivate?.(path);
  }

  function scheduleRefresh(path: string): void {
    clearTimeout(refreshTimers.get(path));
    refreshTimers.set(
      path,
      setTimeout(() => {
        refreshTimers.delete(path);
        void refreshProjectionOf(path);
      }, 350),
    );
  }

  /** Rebuild the chapter's projection for its current text and swap it into the live mount. */
  async function refreshProjectionOf(path: string): Promise<void> {
    const host = slotOf(path)?.host;
    if (!host) return;
    const snapshot = host.getSnapshot();
    const built = await buildProjection(snapshot.text, snapshot.version);
    if (disposed || slotOf(path)?.host !== host || host.getSnapshot().version !== snapshot.version) return;
    refs[path]?.refreshProjection(built.projection);
  }

  /** The char offset a 1-based line starts at in `text`. */
  function offsetOfLine(text: string, line: number): number {
    let offset = 0;
    for (let i = 1; i < line; i++) {
      const next = text.indexOf("\n", offset);
      if (next < 0) break;
      offset = next + 1;
    }
    return offset;
  }

  /** The block element holding a source line: the nearest stamped block starting at or before it. */
  function blockForLine(path: string, line: number): HTMLElement | null {
    const el = els[path];
    const text = slotOf(path)?.host?.getSnapshot().text;
    if (!el || text === undefined) return null;
    const offset = offsetOfLine(text, line);
    let best: HTMLElement | null = null;
    let bestStart = -1;
    for (const block of el.querySelectorAll<HTMLElement>(".md-block[data-gp-start]")) {
      const start = Number(block.dataset["gpStart"]);
      if (!Number.isFinite(start) || start > offset || start < bestStart) continue;
      best = block;
      bestStart = start;
    }
    return best;
  }

  onMount(() => {
    // The book opens on the chapter the author had open, once it has laid
    // out; the placeholders above it are estimates, and the browser's scroll
    // anchoring keeps the view on it as they become real pages.
    restore = active ? { path: active, delta: 0 } : null;
    requeue(active);
    return () => {
      disposed = true;
      for (const stop of unsubscribe.values()) stop();
      unsubscribe.clear();
      for (const timer of refreshTimers.values()) clearTimeout(timer);
      refreshTimers.clear();
    };
  });

  /** Lock or unlock every chapter. Remounts progressively from the chapter in view, keeping the place. */
  export function setReadonly(next: boolean): void {
    if (next === locked) return;
    locked = next;
    const top = chapterAtTop();
    const topEl = top ? els[top] : undefined;
    restore = top && topEl && scroller ? { path: top, delta: scroller.scrollTop - topEl.offsetTop } : null;
    slots = slots.map((s) => ({ ...s, mounted: false, laidOut: false, epoch: s.epoch + 1, height: els[s.path]?.offsetHeight || s.height }));
    requeue(top);
  }

  /** Zoom every chapter, one per frame, so a long book stays responsive. */
  export function setZoom(next: string): void {
    zoomState = next;
    const paths = slots.filter((s) => s.mounted).map((s) => s.path);
    const step = (): void => {
      const path = paths.shift();
      if (path === undefined || disposed) return;
      refs[path]?.setZoom(next);
      requestAnimationFrame(step);
    };
    step();
  }

  /** Bring a chapter into view, mounting it first if it is still queued; with `line`, the block holding that source line. */
  export async function scrollToChapter(path: string, line?: number): Promise<void> {
    const slot = slotOf(path);
    if (!slot) return;
    active = path;
    if (!slot.mounted) {
      queue = [path, ...queue.filter((p) => p !== path)];
      const laidOut = paginationOf(path, 6000);
      void pump();
      await laidOut;
    }
    await tick();
    const el = els[path];
    if (!el) return;
    const block = line ? blockForLine(path, line) : null;
    (block ?? el).scrollIntoView({ block: block ? "center" : "start" });
  }

  /** Scroll a chapter's source line into view (an outline row, a diagnostic). */
  export function revealLine(path: string, line: number): void {
    void scrollToChapter(path, line);
  }

  export function activePath(): string | null {
    return active;
  }

  export function hostOf(path: string): DesktopDocumentHost | null {
    return slotOf(path)?.host ?? null;
  }

  export function activeHost(): DesktopDocumentHost | null {
    return active ? hostOf(active) : null;
  }

  export function getSelection(): { readonly from: number; readonly to: number } | undefined {
    return active ? refs[active]?.getSelection() : undefined;
  }

  /** Place the caret in a chapter, making it the active one; a chapter still queued is mounted first. */
  export async function setSelection(path: string, from: number, to?: number): Promise<void> {
    activate(path);
    if (!slotOf(path)?.mounted) {
      queue = [path, ...queue.filter((p) => p !== path)];
      const laidOut = paginationOf(path, 6000);
      void pump();
      await laidOut;
      await tick();
    }
    refs[path]?.setSelection(from, to);
  }

  /** A file changed on disk (or in the source editor): give the chapter's host the new text. */
  export function replaceText(path: string, text: string): void {
    const host = hostOf(path);
    if (host && host.getSnapshot().text !== text) host.replaceExternal(text);
  }

  /**
   * Rebuild every chapter that was built WITHOUT the book's CSS - one opened
   * before the project finished opening has no plugins and no page geometry,
   * and nothing else would ask for them again.
   */
  export function rebuildDegraded(): void {
    const degraded = slots.filter((s) => s.loaded && s.editorCss === undefined).map((s) => s.path);
    if (!degraded.length) return;
    for (const path of degraded) {
      unsubscribe.get(path)?.();
      unsubscribe.delete(path);
      patch(path, { host: null, projection: null, loaded: false, mounted: false, laidOut: false, epoch: (slotOf(path)?.epoch ?? 0) + 1 });
    }
    requeue(chapterAtTop());
  }
</script>

<div class="book-surface" bind:this={scroller}>
  {#each slots as slot (slot.path)}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="book-chapter" data-chapter-path={slot.path} style={settlingStyle(slot)} bind:this={els[slot.path]} onpointerdowncapture={() => activate(slot.path)}>
      {#if slot.mounted && slot.host}
        {#key slot.epoch}
          <RichEditor
            bind:this={refs[slot.path]}
            host={slot.host}
            projection={slot.projection ?? undefined}
            extraCss={slot.editorCss}
            {onDiagnostic}
            paged={true}
            stacked={true}
            readonly={locked}
            zoom={zoomState}
            {projectDir}
            filePath={slot.path}
            onPaginated={(pages) => paginated(slot.path, pages)}
          />
        {/key}
      {:else}
        <div class="book-chapter__placeholder" style="min-height: {placeholderHeight(slot)}px" aria-hidden="true"></div>
      {/if}
    </div>
  {/each}
</div>

<style>
  /* The book's scroller: the same backdrop the viewer's stage paints, with
     the stage's vertical padding once for the whole book (each chapter's own
     stage keeps only the horizontal padding - see RichEditor's stacked
     rules). */
  .book-surface {
    width: 100%;
    min-width: 0;
    height: 100%;
    min-height: 0;
    overflow: auto;
    background: #4a4a52;
    padding: 32px 0;
    box-sizing: border-box;
  }
  .book-chapter {
    position: relative;
  }
  .book-chapter__placeholder {
    margin: 0 32px;
  }
</style>
