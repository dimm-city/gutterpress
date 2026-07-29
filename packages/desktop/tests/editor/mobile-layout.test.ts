import { test, expect } from "bun:test";
import {
  NARROW_BREAKPOINT,
  MOBILE_TABS,
  isNarrowWidth,
  paneForTab,
  paneModeForTab,
  tabFromPaneMode,
  adjacentTab,
  keyboardOffset,
} from "../../src/lib/editor/mobile-layout";

// ── isNarrowWidth ─────────────────────────────────────────────────────────────

test("isNarrowWidth mirrors layoutModeFor", () => {
  expect(isNarrowWidth(390)).toBe(true);
  expect(isNarrowWidth(1280)).toBe(false);
  expect(isNarrowWidth(820)).toBe(true);
  expect(NARROW_BREAKPOINT).toBe(820);
});

// ── tab model: exactly two tabs (editor + desktop) ─────────────────────────────
// The defunct "css"/style tab was removed from the small-screen tab bar —
// project styling now lives in the full-screen Project settings view.

test("the mobile tab bar has exactly the markdown and preview tabs", () => {
  expect(MOBILE_TABS).toEqual(["markdown", "preview"]);
  expect(MOBILE_TABS).not.toContain("css");
});

test("paneForTab maps the editor tab to the editor pane, preview to preview", () => {
  expect(paneForTab("markdown")).toBe("editor");
  expect(paneForTab("preview")).toBe("preview");
});

test("paneModeForTab preserves the persisted two-state contract", () => {
  expect(paneModeForTab("markdown")).toBe("edit");
  expect(paneModeForTab("preview")).toBe("view");
});

// ── tabFromPaneMode (restore active tab on reload) ────────────────────────────

test("tabFromPaneMode: view mode restores the Preview tab, edit the Markdown tab", () => {
  expect(tabFromPaneMode("view")).toBe("preview");
  expect(tabFromPaneMode("edit")).toBe("markdown");
});

// ── adjacentTab (arrow-key roving tab navigation) ─────────────────────────────

test("adjacentTab cycles forward with wrap", () => {
  expect(adjacentTab("markdown", 1)).toBe("preview");
  expect(adjacentTab("preview", 1)).toBe("markdown");
});

test("adjacentTab cycles backward with wrap", () => {
  expect(adjacentTab("markdown", -1)).toBe("preview");
  expect(adjacentTab("preview", -1)).toBe("markdown");
});

// ── keyboardOffset (visualViewport keyboard handling) ─────────────────────────

test("keyboardOffset is 0 when no keyboard occludes the viewport", () => {
  expect(keyboardOffset(800, 800)).toBe(0);
  // Tiny difference below threshold (browser chrome jitter) → ignored.
  expect(keyboardOffset(800, 770)).toBe(0);
});

test("keyboardOffset returns the occluded height when the keyboard is open", () => {
  // 800 layout, 480 visible → 320px keyboard.
  expect(keyboardOffset(800, 480)).toBe(320);
});

test("keyboardOffset accounts for visualViewport offsetTop (scrolled under kbd)", () => {
  // layout 800, visible 500, scrolled 40 under → 800-500-40 = 260.
  expect(keyboardOffset(800, 500, 40)).toBe(260);
});

test("keyboardOffset never returns negative and rounds", () => {
  expect(keyboardOffset(800, 900)).toBe(0);
  expect(keyboardOffset(800, 479.4)).toBe(321);
});

test("keyboardOffset tolerates non-finite inputs", () => {
  expect(keyboardOffset(NaN, 480)).toBe(0);
  expect(keyboardOffset(800, NaN)).toBe(0);
  expect(keyboardOffset(800, 480, NaN)).toBe(0);
});

test("keyboardOffset custom threshold", () => {
  // 100px occlusion with a 150px threshold → ignored.
  expect(keyboardOffset(800, 700, 0, 150)).toBe(0);
  expect(keyboardOffset(800, 700, 0, 50)).toBe(100);
});
