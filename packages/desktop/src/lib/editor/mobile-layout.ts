/**
 * Mobile editor layout logic (#34) — pure, host-agnostic helpers for the
 * responsive single-column editor.
 *
 * This module holds ONLY pure functions + plain types so it is unit-testable in
 * bun without a DOM, a platform adapter, or Svelte runtime. The `+page.svelte`
 * component imports these and wires them to live state (matchMedia → width,
 * visualViewport → keyboard offset, tab buttons → tab state).
 *
 * Layering note (CLAUDE.md §8): no `node:*`, no lib value import, no DOM types
 * beyond the small structural shapes declared locally — keeps the SPA bundle
 * PWA-clean.
 */

/** The responsive breakpoint (px). At/below this width the workspace collapses
 * to a single column with a Markdown/CSS/Preview tab bar; above it the existing
 * side-by-side split is used. Matches the historical NARROW_QUERY (820px). */
export const NARROW_BREAKPOINT = 820;

/** Workspace layout mode derived purely from the viewport width. */
type LayoutMode = "single-column" | "split";

/**
 * Derive the workspace layout mode from the viewport width.
 *
 * At or below `breakpoint` the editor + preview can't sit side by side, so the
 * workspace is a single column (tab-switched). Above it, the side-by-side split
 * is used. Boundary is inclusive of the breakpoint (820px → single-column),
 * matching `(max-width: 820px)` in CSS so JS and CSS never disagree.
 */
function layoutModeFor(
  width: number,
  breakpoint: number = NARROW_BREAKPOINT,
): LayoutMode {
  return width <= breakpoint ? "single-column" : "split";
}

/** Convenience predicate: is the viewport in single-column (narrow) mode? */
export function isNarrowWidth(
  width: number,
  breakpoint: number = NARROW_BREAKPOINT,
): boolean {
  return layoutModeFor(width, breakpoint) === "single-column";
}

/**
 * The two tabs shown in the single-column mobile layout: "markdown" surfaces
 * the editor pane, "preview" the live preview pane. (A third "css"/style tab
 * used to sit between them; it was retired with the toolbar refactor —
 * project styling lives in the full-screen Project settings view now.)
 */
export type MobileTab = "markdown" | "preview";

/** Ordered tab list — also the order arrow-key navigation cycles through. */
export const MOBILE_TABS: readonly MobileTab[] = ["markdown", "preview"] as const;

/** Which physical pane a tab maps to. */
export type WorkspacePane = "editor" | "preview";

/**
 * Map a mobile tab to the physical pane it shows. This is what lets the tab
 * bar reuse the existing two-pane (editor|preview) workspace + the persisted
 * `paneMode` ("edit" | "view").
 */
export function paneForTab(tab: MobileTab): WorkspacePane {
  return tab === "preview" ? "preview" : "editor";
}

/**
 * Map a tab to the persisted two-state `paneMode` so the existing setting keeps
 * working: the editor tab → "edit", the preview tab → "view".
 */
export function paneModeForTab(tab: MobileTab): "edit" | "view" {
  return paneForTab(tab) === "preview" ? "view" : "edit";
}

/**
 * Resolve the active tab from the persisted `paneMode`. On reload there is no
 * stored tab — only `paneMode` ("edit"/"view").
 */
export function tabFromPaneMode(paneMode: "edit" | "view"): MobileTab {
  return paneMode === "view" ? "preview" : "markdown";
}

/**
 * Arrow-key navigation across the tablist (WAI-ARIA tabs pattern). Returns the
 * next tab for a roving-tabindex move; wraps at both ends. `dir` is +1 for
 * ArrowRight/Down, -1 for ArrowLeft/Up.
 */
export function adjacentTab(current: MobileTab, dir: 1 | -1): MobileTab {
  const i = MOBILE_TABS.indexOf(current);
  const n = MOBILE_TABS.length;
  // i is always found (current is a MobileTab); guard defensively anyway.
  const base = i < 0 ? 0 : i;
  const next = (base + dir + n) % n;
  return MOBILE_TABS[next]!;
}

/**
 * Compute the on-screen-keyboard offset (px) the workspace must shift/shrink by
 * so the editor toolbar stays reachable above the virtual keyboard.
 *
 * Pure function of the layout viewport height and the visual viewport metrics
 * (the live versions come from `window.innerHeight` and `window.visualViewport`
 * via an `onMount` resize/scroll listener). The keyboard occludes the bottom of
 * the layout viewport; its height is the layout height minus the visual
 * viewport's height and top offset.
 *
 * Returns 0 when no keyboard is present (or the numbers don't indicate an
 * occlusion), and never a negative value. A small threshold avoids reacting to
 * sub-pixel rounding or browser-chrome jitter.
 *
 * @param layoutHeight   The layout viewport height (window.innerHeight).
 * @param visualHeight   visualViewport.height.
 * @param visualOffsetTop visualViewport.offsetTop (page scrolled under the kbd).
 * @param threshold      Minimum occlusion (px) to treat as a real keyboard.
 */
export function keyboardOffset(
  layoutHeight: number,
  visualHeight: number,
  visualOffsetTop: number = 0,
  threshold: number = 60,
): number {
  if (
    !Number.isFinite(layoutHeight) ||
    !Number.isFinite(visualHeight) ||
    !Number.isFinite(visualOffsetTop)
  ) {
    return 0;
  }
  const occluded = layoutHeight - visualHeight - visualOffsetTop;
  if (occluded < threshold) return 0;
  return Math.max(0, Math.round(occluded));
}
