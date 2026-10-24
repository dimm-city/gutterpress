/**
 * The viewer's page layout, derived — pure, so the rule is unit-tested and
 * `+page.svelte` just feeds it. Read shows a spread when the author chose one
 * (Preview toolbar toggle, `preview.readLayout`); Edit is always one page
 * beside the editor, and a narrow window has no room for a second page. The
 * stored `readLayout` is never touched by Edit, so returning to Read restores
 * the author's last choice.
 */
import type { ReadLayout, WorkspaceMode } from "#lib/platform/shared-types.ts";

export type ViewerViewMode = "single" | "two-column";

export function viewModeFor(mode: WorkspaceMode, isNarrow: boolean, readLayout: ReadLayout): ViewerViewMode {
  return mode === "viewer" && !isNarrow && readLayout === "spread" ? "two-column" : "single";
}

/** The layout toggle is a Read-mode control, and only where two pages can fit. */
export function showReadLayoutToggle(mode: WorkspaceMode, isNarrow: boolean): boolean {
  return mode === "viewer" && !isNarrow;
}
