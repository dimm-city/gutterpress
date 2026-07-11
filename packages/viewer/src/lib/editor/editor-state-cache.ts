/**
 * EditorStateCache (UX review M8) — a small bounded LRU cache mapping a file
 * path to the CodeMirror `EditorState` (doc + selection + undo history) that
 * file's editor view held the last time it was the active document, plus its
 * scroll offset.
 *
 * MarkdownEditor keeps ONE `EditorView` for the component's lifetime; switching
 * files calls `view.setState(...)` instead of destroying/recreating the view —
 * the component's own header comment has long documented this design, but
 * until this change the PARENT actually wrapped the component in
 * `{#key editorFilePath}`, which destroyed and rebuilt the whole view (and
 * every CodeMirror extension in it) on every file switch, discarding undo
 * history, selection, and scroll position. Caching the outgoing file's state
 * here — instead of discarding it — is what lets those survive a round trip
 * back to a recently-open file.
 *
 * Bounded (default 20 entries): the MarkdownEditor component instance is not
 * torn down between projects either (the lazily-loaded module is cached "for
 * the lifetime of the app" per +page.svelte's comment), so an unbounded cache
 * would grow for the whole app session across every file in every project
 * ever opened. LRU eviction keeps memory bounded while keeping the files an
 * author is actually flipping between (a handful of chapters) warm.
 *
 * Pure, host-free, and generic in `V` (CodeMirror-agnostic) so it can be unit
 * tested without constructing a real `EditorState`.
 */
export class EditorStateCache<V> {
  private readonly capacity: number;
  // Map iteration order is insertion order — the first key is always the
  // least-recently-used entry, so eviction just deletes `map.keys().next()`.
  private readonly map = new Map<string, V>();

  constructor(capacity = 20) {
    if (!Number.isFinite(capacity) || capacity < 1) {
      throw new RangeError("EditorStateCache capacity must be a positive number");
    }
    this.capacity = capacity;
  }

  /** Number of entries currently cached. */
  get size(): number {
    return this.map.size;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  /** Read a cached value, marking it most-recently-used. `undefined` on a miss. */
  get(key: string): V | undefined {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key) as V;
    // Re-insert to move it to the end (most-recently-used position).
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  /**
   * Store a value as the most-recently-used entry, evicting the
   * least-recently-used entry(ies) if this pushes the cache over capacity.
   */
  set(key: string, value: V): void {
    this.map.delete(key); // drop any existing entry so the re-set moves it to MRU position
    this.map.set(key, value);
    while (this.map.size > this.capacity) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey === undefined) break;
      this.map.delete(oldestKey);
    }
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }
}
