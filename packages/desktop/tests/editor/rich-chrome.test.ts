import { describe, expect, test } from "bun:test";
import { flipClamp } from "../../src/lib/flip-clamp";
import {
  filterSlashItems,
  isSlashTrigger,
  slashAction,
  SLASH_ITEMS,
} from "../../src/lib/editor/rich-chrome.svelte";

/**
 * The inline chrome's logic, with no DOM at all — the geometry and the
 * trigger rules are the parts that can be quietly wrong.
 */
const WORKSPACE = { left: 100, top: 50, width: 800, height: 600 };

describe("flipClamp", () => {
  test("places a panel at the point when it fits", () => {
    expect(flipClamp({ x: 200, y: 100 }, 100, 50, WORKSPACE)).toEqual({ x: 200, y: 100 });
  });

  test("flips left of the point near the right edge", () => {
    expect(flipClamp({ x: 880, y: 100 }, 100, 50, WORKSPACE).x).toBe(780);
  });

  test("flips above the point near the bottom edge", () => {
    expect(flipClamp({ x: 200, y: 630 }, 100, 50, WORKSPACE).y).toBe(580);
  });

  test("preferAbove puts a bubble over the selection, not under it", () => {
    // The bubble points AT the selection, so it must not cover the text it is
    // about.
    expect(flipClamp({ x: 200, y: 300 }, 100, 40, WORKSPACE, true).y).toBe(260);
  });

  test("preferAbove flips DOWN when there is no room above", () => {
    expect(flipClamp({ x: 200, y: 60 }, 100, 40, WORKSPACE, true).y).toBe(60);
  });

  test("always stays inside the workspace, even when it cannot fit nicely", () => {
    const p = flipClamp({ x: 5000, y: 5000 }, 100, 50, WORKSPACE);
    expect(p.x).toBeGreaterThanOrEqual(WORKSPACE.left);
    expect(p.y).toBeGreaterThanOrEqual(WORKSPACE.top);
    expect(p.x + 100).toBeLessThanOrEqual(WORKSPACE.left + WORKSPACE.width);
    expect(p.y + 50).toBeLessThanOrEqual(WORKSPACE.top + WORKSPACE.height);
  });
});

describe("slash trigger", () => {
  test("opens at the start of a line and after whitespace", () => {
    expect(isSlashTrigger("/")).toBe(true);
    expect(isSlashTrigger("Some text /")).toBe(true);
  });

  test("does NOT open inside a word — that is a literal slash", () => {
    // `and/or`, `http://`, `1/2` are the author typing, not a command.
    expect(isSlashTrigger("and/")).toBe(false);
    expect(isSlashTrigger("http:/")).toBe(false);
    expect(isSlashTrigger("1/")).toBe(false);
  });

  test("does not open without a slash at all", () => {
    expect(isSlashTrigger("plain text")).toBe(false);
  });
});

describe("slash items", () => {
  test("an empty query offers everything", () => {
    expect(filterSlashItems("")).toHaveLength(SLASH_ITEMS.length);
  });

  test("label prefixes rank above keyword matches", () => {
    const results = filterSlashItems("head");
    expect(results[0]!.id).toBe("heading-1");
  });

  test("keywords find items whose label does not contain the word", () => {
    // An author who types "bullet" must find "Bulleted list"; one who types
    // "grid" must find "Table".
    expect(filterSlashItems("grid").map((i) => i.id)).toContain("table");
    expect(filterSlashItems("@section").map((i) => i.id)).toContain("section");
  });

  test("a query matching nothing returns nothing rather than everything", () => {
    expect(filterSlashItems("zzzznope")).toEqual([]);
  });

  test("EVERY item maps to a real toolbar action", () => {
    // The slash menu must not become a second set of commands that can drift
    // from the toolbar's.
    for (const item of SLASH_ITEMS) {
      const mapped = slashAction(item.id);
      expect(mapped).not.toBeNull();
      expect(mapped!.action.length).toBeGreaterThan(0);
    }
  });

  test("an unknown id maps to nothing", () => {
    expect(slashAction("not-a-block")).toBeNull();
  });
});
