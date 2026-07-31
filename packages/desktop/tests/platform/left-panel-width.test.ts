/**
 * Left-panel width bounds ($lib/left-panel-width) — the shared clamp used by
 * BOTH the panel and +page.svelte's persisted-width restore. It lives in one
 * pure module precisely so those two can't clamp against each other (they
 * did: the parent's floor kept overwriting the panel's narrow-window ceiling).
 */
import { describe, test, expect } from "bun:test";
import {
  ABSOLUTE_MIN_W,
  EDGE_RESERVE,
  PANEL_MAX_W,
  PANEL_MIN_W,
  clampPanelWidth,
  panelWidthBounds,
} from "../../src/lib/left-panel-width";

describe("panelWidthBounds", () => {
  test("a roomy window gets the full 300–480 range", () => {
    expect(panelWidthBounds(1280)).toEqual({ lo: PANEL_MIN_W, hi: PANEL_MAX_W });
  });

  test("the readable 300 floor still applies well below the overlay breakpoint", () => {
    expect(panelWidthBounds(700).lo).toBe(300);
    expect(panelWidthBounds(400).lo).toBe(300);
  });

  test("a window that can't spare 300 drops the ceiling, and the floor follows", () => {
    const { lo, hi } = panelWidthBounds(340);
    expect(hi).toBe(340 - EDGE_RESERVE);
    // A floor above the ceiling would push the panel off-screen.
    expect(lo).toBe(hi);
  });

  test("the reserve is always honoured, so a strip of workspace stays visible", () => {
    for (const vw of [1280, 820, 700, 500, 400, 360, 320]) {
      expect(panelWidthBounds(vw).hi).toBeLessThanOrEqual(Math.max(ABSOLUTE_MIN_W, vw - EDGE_RESERVE));
    }
  });

  test("a hostile viewport never produces a sub-200 panel", () => {
    expect(panelWidthBounds(100).hi).toBe(ABSOLUTE_MIN_W);
    expect(panelWidthBounds(0)).toEqual({ lo: PANEL_MIN_W, hi: PANEL_MAX_W });
    expect(panelWidthBounds(Number.NaN)).toEqual({ lo: PANEL_MIN_W, hi: PANEL_MAX_W });
  });
});

describe("clampPanelWidth", () => {
  test("raises a width persisted under the old 200px floor", () => {
    expect(clampPanelWidth(220, 1280)).toBe(300);
    expect(clampPanelWidth(260, 1280)).toBe(300);
  });

  test("keeps a width the author actually chose", () => {
    expect(clampPanelWidth(360, 1280)).toBe(360);
  });

  test("never exceeds the drag maximum", () => {
    expect(clampPanelWidth(900, 1280)).toBe(PANEL_MAX_W);
  });

  test("a narrow window wins over the readable floor", () => {
    // The exact fight this module exists to settle: 300 is the floor, but a
    // 340px window can only give 268.
    expect(clampPanelWidth(300, 340)).toBe(268);
    expect(clampPanelWidth(220, 340)).toBe(268);
  });

  test("a non-finite width falls back to the readable minimum", () => {
    expect(clampPanelWidth(Number.NaN, 1280)).toBe(PANEL_MIN_W);
  });
});
