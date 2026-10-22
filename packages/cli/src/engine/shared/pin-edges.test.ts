import { describe, expect, test } from "bun:test";

import {
  EDGE_PIN_SELECTOR,
  flushMargins,
  marginBoxesOnEdges,
  paddingOf,
  pinEdgesIn,
  pinInsets,
  pinKey,
  pinPageName,
  pinRootStyle,
} from "./pin-edges.ts";

describe("pin-edge policy", () => {
  test("edge keys are canonical t/r/b/l regardless of input order", () => {
    expect(pinKey(["bottom"])).toBe("b");
    expect(pinKey(["right", "bottom"])).toBe("rb");
    expect(pinKey(["left", "top", "bottom", "right"])).toBe("trbl");
  });

  test("generated names carry the author context and live in gp--", () => {
    expect(pinPageName(undefined, ["bottom"])).toBe("gp--pin-b");
    expect(pinPageName("citizen-file", ["bottom", "right"])).toBe("gp--pin-citizen-file-rb");
    // a hostile name cannot break out of the ident
    expect(pinPageName('x"y{z', ["top"])).toBe("gp--pin-x_y_z-t");
  });

  test("freed margins zero exactly the pinned edges", () => {
    const m = { top: 10, right: 20, bottom: 30, left: 40 };
    expect(flushMargins(m, ["bottom"])).toEqual({ top: 10, right: 20, bottom: 0, left: 40 });
    expect(flushMargins(m, ["top", "left"])).toEqual({ top: 0, right: 20, bottom: 30, left: 0 });
  });

  test("a corner box belongs to BOTH of its edges", () => {
    // a bottom pin must claim the bottom corners even though "left"/"right"
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

describe("the art-safe line", () => {
  // dtrpg: a 9pt bleed inside the sheet, art 18pt in from the trim, 36pt at the binding
  // (a book that sets no gutter gets `safe`, 36, there)
  const dtrpg = { bleed: 9, artSafe: 18, gutter: 36 };

  test("bleed + artSafe on the top, bottom and outside edge; the gutter at the binding", () => {
    const all = ["top", "right", "bottom", "left"] as const;
    // a recto binds on its left
    expect(pinInsets(dtrpg, "recto", all)).toEqual({ top: 27, right: 27, bottom: 27, left: 36 });
    // a verso binds on its right
    expect(pinInsets(dtrpg, "verso", all)).toEqual({ top: 27, right: 36, bottom: 27, left: 27 });
  });

  test("a gutter moves the binding edge's line, the left of a recto and the right of a verso, and no other", () => {
    const wide = { ...dtrpg, gutter: 54 };
    const all = ["top", "right", "bottom", "left"] as const;
    expect(pinInsets(wide, "recto", all)).toEqual({ top: 27, right: 27, bottom: 27, left: 54 });
    expect(pinInsets(wide, "verso", all)).toEqual({ top: 27, right: 54, bottom: 27, left: 27 });
    // no bleed at the binding: the gutter is the whole distance from the paper's edge there
    expect(pinInsets({ ...wide, bleed: 0 }, "recto", ["left"])).toEqual({ top: 0, right: 0, bottom: 0, left: 54 });
  });

  test("an edge the pins do not use stays at 0: the text block's own edge", () => {
    expect(pinInsets(dtrpg, "recto", ["bottom"])).toEqual({ top: 0, right: 0, bottom: 27, left: 0 });
  });

  test("no print area is the paper's edge", () => {
    expect(pinInsets(null, "recto", ["bottom", "right"])).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  test("the root's style: freed margins back as cloned padding, all four insets in px", () => {
    const margin = { top: 54, right: 45, bottom: 54, left: 54 };
    expect(pinRootStyle(margin, dtrpg, "recto", ["bottom", "right"])).toEqual({
      "box-decoration-break": "clone",
      "padding-right": "60px",
      "padding-bottom": "72px",
      "--gp-pin-top": "0px",
      "--gp-pin-right": "36px",
      "--gp-pin-bottom": "36px",
      "--gp-pin-left": "0px",
    });
    // on a verso the right edge is the binding: the gutter, no bleed
    expect(pinRootStyle(margin, dtrpg, "verso", ["right"])["--gp-pin-right"]).toBe("48px");
    // …and a gutter of 54pt is 72px there
    expect(pinRootStyle(margin, { ...dtrpg, gutter: 54 }, "verso", ["right"])["--gp-pin-right"]).toBe("72px");
  });

  test("a root's own padding is kept: the freed margin is added to it, on the freed edges only", () => {
    const margin = { top: 54, right: 45, bottom: 54, left: 54 };
    const own = paddingOf({ paddingTop: "10px", paddingRight: "12px", paddingBottom: "10px", paddingLeft: "12px" });
    expect(own).toEqual({ top: 10, right: 12, bottom: 10, left: 12 });
    const style = pinRootStyle(margin, dtrpg, "recto", ["bottom"], own);
    expect(style["padding-bottom"]).toBe("82px");
    // an edge the pins leave alone keeps the book's own padding untouched
    expect(style["padding-top"]).toBeUndefined();
  });
});

describe("which root a pin belongs to", () => {
  // Plain objects standing in for elements: pinEdgesIn reads only the
  // selector it queries with, each pin's offsetParent and its classes.
  const pin = (parent: unknown, ...classes: string[]) => ({
    offsetParent: parent,
    classList: { contains: (c: string) => classes.includes(c) },
  });
  const rootWith = (make: (root: object) => ReturnType<typeof pin>[]) => {
    const root = {
      querySelectorAll(selector: string) {
        expect(selector).toBe(EDGE_PIN_SELECTOR);
        return make(root);
      },
    };
    return root;
  };

  test("the edges of the pins this root contains, in t/r/b/l order", () => {
    const root = rootWith((r) => [pin(r, "gp-pin", "gp-right", "gp-bottom"), pin(r, "gp-pin", "gp-top")]);
    expect(pinEdgesIn(root)).toEqual(["top", "right", "bottom"]);
  });

  test("a pin whose containing block is another box (a nested page, a positioned card) is not this root's", () => {
    const card = {};
    const root = rootWith(() => [pin(card, "gp-pin", "gp-bottom")]);
    expect(pinEdgesIn(root)).toEqual([]);
  });
});
