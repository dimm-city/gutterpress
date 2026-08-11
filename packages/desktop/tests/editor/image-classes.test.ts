/**
 * image-classes — the shared class table + token-preserving attrs editing.
 *
 * The drift gate at the bottom is the load-bearing test: the desktop's
 * option tables mirror core's PAGED_CSS vocabulary, and this is the check
 * that keeps a class from existing in one place but not the other (the
 * pre-gp-* surface had the list hand-copied in four places).
 */
import { describe, expect, test } from "bun:test";

import {
  IMAGE_POSITION_OPTIONS,
  IMAGE_SHAPE_CLASS,
  IMAGE_SIZE_OPTIONS,
  getPositionClass,
  getSizeClass,
  getWidth,
  hasShapeClass,
  normalizeClassInput,
  serializeImageAttrs,
  setPositionClass,
  setShapeClass,
  setSizeClass,
  setWidth,
  tokenizeImageAttrs,
} from "../../src/lib/editor/image-classes";

describe("tokenizeImageAttrs / serializeImageAttrs", () => {
  test("empty and brace-only input → no tokens → empty suffix", () => {
    expect(tokenizeImageAttrs("")).toEqual([]);
    expect(tokenizeImageAttrs("{}")).toEqual([]);
    expect(serializeImageAttrs([])).toBe("");
  });

  test("splits classes, ids, and key=val, preserving order", () => {
    expect(tokenizeImageAttrs('{.gp-right .gp-small #fig width="300px"}')).toEqual([
      ".gp-right",
      ".gp-small",
      "#fig",
      'width="300px"',
    ]);
  });

  test("a quoted value with spaces stays one token", () => {
    expect(tokenizeImageAttrs('{width="30 px" .center}')).toEqual(['width="30 px"', ".center"]);
  });

  test("round-trips unknown tokens byte-for-byte", () => {
    const raw = '{.gp-right .my-note #fig1 data-x="a b" .gp-small}';
    expect(serializeImageAttrs(tokenizeImageAttrs(raw))).toBe(raw);
  });
});

describe("facet getters", () => {
  test("getWidth reads quoted and bare values, empty when absent", () => {
    expect(getWidth(tokenizeImageAttrs('{width="300px"}'))).toBe("300px");
    expect(getWidth(tokenizeImageAttrs("{width=80%}"))).toBe("80%");
    expect(getWidth(tokenizeImageAttrs("{.gp-left}"))).toBe("");
  });

  test("getPositionClass returns the class AS WRITTEN — canonical or legacy alias", () => {
    expect(getPositionClass(tokenizeImageAttrs("{.gp-right}"))).toBe("gp-right");
    expect(getPositionClass(tokenizeImageAttrs("{.float-right}"))).toBe("float-right");
    expect(getPositionClass(tokenizeImageAttrs("{.gp-small}"))).toBeUndefined();
  });

  test("getSizeClass finds sizes and ignores positions", () => {
    expect(getSizeClass(tokenizeImageAttrs("{.gp-right .gp-small}"))).toBe("gp-small");
    expect(getSizeClass(tokenizeImageAttrs("{.gp-right}"))).toBeUndefined();
  });
});

describe("facet setters preserve everything else", () => {
  const raw = '{width="300px" .gp-right .gp-small .my-note #fig1}';

  test("setWidth replaces in place, keeping token order", () => {
    const tokens = setWidth(tokenizeImageAttrs(raw), "50%");
    expect(serializeImageAttrs(tokens)).toBe('{width="50%" .gp-right .gp-small .my-note #fig1}');
  });

  test("setWidth(null) removes only the width token", () => {
    const tokens = setWidth(tokenizeImageAttrs(raw), null);
    expect(serializeImageAttrs(tokens)).toBe("{.gp-right .gp-small .my-note #fig1}");
  });

  test("setPositionClass rewrites a legacy alias in place when asked", () => {
    const tokens = setPositionClass(tokenizeImageAttrs("{.float-right .gp-small}"), "gp-left");
    expect(serializeImageAttrs(tokens)).toBe("{.gp-left .gp-small}");
  });

  test("setPositionClass appends when the facet is absent", () => {
    const tokens = setPositionClass(tokenizeImageAttrs("{.gp-small}"), "gp-center");
    expect(serializeImageAttrs(tokens)).toBe("{.gp-small .gp-center}");
  });

  test("setSizeClass never touches position, custom classes, or ids", () => {
    const tokens = setSizeClass(tokenizeImageAttrs(raw), "gp-large");
    expect(serializeImageAttrs(tokens)).toBe('{width="300px" .gp-right .gp-large .my-note #fig1}');
  });

  test("clearing the only facet of a single-token suffix yields no suffix", () => {
    expect(serializeImageAttrs(setPositionClass(tokenizeImageAttrs("{.gp-right}"), null))).toBe("");
  });
});

describe("normalizeClassInput", () => {
  test("accepts short names, canonical classes, and legacy aliases", () => {
    expect(normalizeClassInput(IMAGE_POSITION_OPTIONS, "right")).toBe("gp-right");
    expect(normalizeClassInput(IMAGE_POSITION_OPTIONS, "gp-right")).toBe("gp-right");
    expect(normalizeClassInput(IMAGE_POSITION_OPTIONS, "float-right")).toBe("gp-right");
    expect(normalizeClassInput(IMAGE_POSITION_OPTIONS, ".Center ")).toBe("gp-center");
    expect(normalizeClassInput(IMAGE_SIZE_OPTIONS, "medium")).toBe("gp-medium");
  });

  test("rejects unknown input rather than guessing", () => {
    expect(normalizeClassInput(IMAGE_POSITION_OPTIONS, "sideways")).toBeUndefined();
    expect(normalizeClassInput(IMAGE_POSITION_OPTIONS, "")).toBeUndefined();
    // The old prompt suggested "left" but wrote a nonexistent {.left} — the
    // short name must now resolve to the real class instead.
    expect(normalizeClassInput(IMAGE_POSITION_OPTIONS, "left")).toBe("gp-left");
  });
});

describe("shape facet (boolean)", () => {
  test("toggles .gp-shape on and off without touching anything else", () => {
    const tokens = tokenizeImageAttrs("{.gp-right .my-note}");
    const on = setShapeClass(tokens, true);
    expect(serializeImageAttrs(on)).toBe("{.gp-right .my-note .gp-shape}");
    expect(hasShapeClass(on)).toBe(true);
    const off = setShapeClass(on, false);
    expect(serializeImageAttrs(off)).toBe("{.gp-right .my-note}");
    expect(hasShapeClass(off)).toBe(false);
  });

  test("setting an already-set state is a no-op in content terms", () => {
    const tokens = tokenizeImageAttrs("{.gp-shape}");
    expect(serializeImageAttrs(setShapeClass(tokens, true))).toBe("{.gp-shape}");
  });
});

describe("drift gate against core PAGED_CSS", () => {
  // markdown-it-paged.js is deliberately self-contained ESM (zero imports),
  // so the sibling-package source import works under bun test without
  // building the lib. If this import ever breaks, fall back to reading the
  // file as text and scanning for the selectors.
  test("every canonical class the desktop offers exists as a PAGED_CSS selector", async () => {
    const { PAGED_CSS } = await import("../../../cli/src/lib/markdown/markdown-it-paged.js");
    const canonical = [
      ...IMAGE_POSITION_OPTIONS.map((o) => o.class),
      ...IMAGE_SIZE_OPTIONS.map((o) => o.class),
      IMAGE_SHAPE_CLASS,
    ];
    expect(canonical.length).toBeGreaterThan(0);
    for (const cls of canonical) {
      expect(PAGED_CSS).toContain(`.${cls}`);
    }
  });

  test("no legacy alias exists as a PAGED_CSS selector — removal must stick", async () => {
    // Aliases are a desktop-side READ convenience for migrating old books;
    // if one reappears in core CSS the vocabulary is duplicated again.
    const { PAGED_CSS } = await import("../../../cli/src/lib/markdown/markdown-it-paged.js");
    const aliases = [...IMAGE_POSITION_OPTIONS, ...IMAGE_SIZE_OPTIONS].flatMap(
      (o) => o.aliases ?? [],
    );
    expect(aliases.length).toBeGreaterThan(0);
    for (const alias of aliases) {
      expect(PAGED_CSS).not.toContain(`.${alias} `);
      expect(PAGED_CSS).not.toContain(`.${alias},`);
    }
  });
});
