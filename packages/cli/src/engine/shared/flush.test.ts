import { describe, expect, test } from "bun:test";

import { flushKey, flushMargins, flushPageName, marginBoxesOnEdges } from "./flush.ts";

describe("flush policy", () => {
  test("edge keys are canonical t/r/b/l regardless of input order", () => {
    expect(flushKey(["bottom"])).toBe("b");
    expect(flushKey(["right", "bottom"])).toBe("rb");
    expect(flushKey(["left", "top", "bottom", "right"])).toBe("trbl");
  });

  test("generated names carry the author context and live in gp--", () => {
    expect(flushPageName(undefined, ["bottom"])).toBe("gp--flush-b");
    expect(flushPageName("citizen-file", ["bottom", "right"])).toBe("gp--flush-citizen-file-rb");
    // a hostile name cannot break out of the ident
    expect(flushPageName('x"y{z', ["top"])).toBe("gp--flush-x_y_z-t");
  });

  test("freed margins zero exactly the flushed edges", () => {
    const m = { top: 10, right: 20, bottom: 30, left: 40 };
    expect(flushMargins(m, ["bottom"])).toEqual({ top: 10, right: 20, bottom: 0, left: 40 });
    expect(flushMargins(m, ["top", "left"])).toEqual({ top: 0, right: 20, bottom: 30, left: 0 });
  });

  test("a corner box belongs to BOTH of its edges", () => {
    // bottom flush must claim the bottom corners even though "left"/"right"
    // appear in their names — a corner dies when either owning margin does.
    expect(marginBoxesOnEdges(["bottom"])).toEqual([
      "bottom-left-corner",
      "bottom-left",
      "bottom-center",
      "bottom-right",
      "bottom-right-corner",
    ]);
    expect(marginBoxesOnEdges(["left"])).toEqual([
      "top-left-corner",
      "bottom-left-corner",
      "left-top",
      "left-middle",
      "left-bottom",
    ]);
  });
});
