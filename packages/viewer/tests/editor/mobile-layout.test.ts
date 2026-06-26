import { test, expect } from "bun:test";
import {
  NARROW_BREAKPOINT,
  isNarrowWidth,
  editorSurfaceForTab,
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
});

// ── tab → surface / paneMode mapping ─────────────────────────────────────────

test("editorSurfaceForTab returns the file class for editor tabs, null for preview", () => {
  expect(editorSurfaceForTab("markdown")).toBe("markdown");
  expect(editorSurfaceForTab("css")).toBe("css");
  expect(editorSurfaceForTab("preview")).toBeNull();
});

test("paneModeForTab preserves the persisted two-state contract", () => {
  expect(paneModeForTab("markdown")).toBe("edit");
  expect(paneModeForTab("css")).toBe("edit");
  expect(paneModeForTab("preview")).toBe("view");
});

// ── tabFromPaneMode (restore active tab on reload) ────────────────────────────

test("tabFromPaneMode: view mode restores the Preview tab", () => {
  expect(tabFromPaneMode("view", false)).toBe("preview");
  expect(tabFromPaneMode("view", true)).toBe("preview");
});

test("tabFromPaneMode: edit mode picks CSS when a css file is open, else Markdown", () => {
  expect(tabFromPaneMode("edit", true)).toBe("css");
  expect(tabFromPaneMode("edit", false)).toBe("markdown");
});

// ── adjacentTab (arrow-key roving tab navigation) ─────────────────────────────

test("adjacentTab cycles forward with wrap", () => {
  expect(adjacentTab("markdown", 1)).toBe("css");
  expect(adjacentTab("css", 1)).toBe("preview");
  expect(adjacentTab("preview", 1)).toBe("markdown");
});

test("adjacentTab cycles backward with wrap", () => {
  expect(adjacentTab("markdown", -1)).toBe("preview");
  expect(adjacentTab("preview", -1)).toBe("css");
  expect(adjacentTab("css", -1)).toBe("markdown");
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
