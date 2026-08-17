/**
 * The editor→preview anchor-line guard, shared by both editing surfaces
 * (`MarkdownEditor.svelte` and `rich-editor.ts`).
 *
 * Three guards, in order: no listener, a suppression window, and a same-line
 * dedup. The window is a TIMESTAMP rather than a boolean because programmatic
 * moves (revealLine, a document swap) finish dispatching before their async
 * scroll event fires — a boolean cleared on return would re-open the gate just
 * in time to let the echo through, and the two panes then chase each other.
 */
export interface AnchorEmitter {
  /** Emit if unsuppressed and different from the last emitted line. */
  emit(line: number, origin: "scroll" | "caret"): void;
  /**
   * Swallow emissions for the next 300ms — call before every programmatic
   * scroll/selection move. `seedLine` sets what "the last emitted line"
   * becomes: the target line for a reveal (so landing there never re-emits),
   * `-1` for a document swap (a new document owes a fresh first emission), or
   * omitted to keep the dedup memory across an in-place content update.
   */
  suppress(seedLine?: number): void;
}

export function createAnchorEmitter(
  onAnchorLine?: (line: number, origin: "scroll" | "caret") => void,
): AnchorEmitter {
  let suppressUntil = 0;
  let lastLine = -1;
  return {
    emit(line, origin) {
      if (!onAnchorLine || Date.now() < suppressUntil || line === lastLine) return;
      lastLine = line;
      onAnchorLine(line, origin);
    },
    suppress(seedLine) {
      suppressUntil = Date.now() + 300;
      if (seedLine !== undefined) lastLine = seedLine;
    },
  };
}
