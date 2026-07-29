import type { OutlineEntry } from "$lib/preview-client";

// Pure port of +page.svelte's updateActiveOutline loop: find the deepest
// heading whose sourceLine is non-null and <= line, breaking at the first
// sourceLine > line. Entries with a null sourceLine are skipped (they neither
// advance the index nor break). The caller keeps the
// `if (outline.length === 0) return;` guard, so this helper is only ever
// invoked for non-empty outlines.
export function activeOutlineIndexForLine(outline: OutlineEntry[], line: number): number {
  let idx = 0;
  for (let i = 0; i < outline.length; i++) {
    const sl = outline[i].sourceLine;
    if (sl != null && sl <= line) idx = i;
    else if (sl != null && sl > line) break;
  }
  return idx;
}
