/**
 * Reading a color the author typed (`toHex`, `typedColor` in style-tokens.ts).
 *
 * Both lean on the browser's own parser, a canvas's `fillStyle`, which
 * IGNORES a value it cannot parse and keeps its previous color — the cause of
 * a typed `#c0392` reading as black and being saved. Bun has no canvas, so
 * this installs a stand-in with exactly that behaviour: it takes 3- and
 * 6-digit hex (as lowercase `#rrggbb`), 8-digit hex (as `rgba(…)`) and `red`,
 * and keeps its color for anything else.
 */
import { expect, test } from "bun:test";

function fakeCanvasContext() {
  let fill = "#000000";
  return {
    get fillStyle() {
      return fill;
    },
    set fillStyle(value: string) {
      const v = value.trim().toLowerCase();
      if (/^#[0-9a-f]{6}$/.test(v)) fill = v;
      else if (/^#[0-9a-f]{3}$/.test(v)) fill = `#${[...v.slice(1)].map((c) => c + c).join("")}`;
      else if (/^#[0-9a-f]{8}$/.test(v)) fill = `rgba(${v})`;
      else if (v === "red") fill = "#ff0000";
    },
  };
}
(globalThis as unknown as { document: unknown }).document = {
  createElement: () => ({ getContext: () => fakeCanvasContext() }),
};

const { toHex, typedColor } = await import("../../src/lib/style-tokens");

test("toHex normalises a color to #rrggbb", () => {
  expect(toHex("#C0392B")).toBe("#c0392b");
  expect(toHex("#abc")).toBe("#aabbcc");
  expect(toHex("red")).toBe("#ff0000");
  expect(toHex("#000000")).toBe("#000000");
});

test("toHex is null for anything that is not a color — never the canvas's leftover black", () => {
  for (const value of ["", "  ", "#", "#c0", "#c0392", "#00000092b", "c0392b", "not a color"]) {
    expect(toHex(value)).toBeNull();
  }
  // A color with alpha is a color, but has no #rrggbb.
  expect(toHex("#c0392b80")).toBeNull();
});

test("typedColor takes a color with or without its #, saved as #rrggbb", () => {
  expect(typedColor("#c0392b")).toBe("#c0392b");
  expect(typedColor("  c0392b ")).toBe("#c0392b");
  expect(typedColor("ABC")).toBe("#aabbcc");
  expect(typedColor("red")).toBe("#ff0000");
});

test("typedColor keeps a color the swatch can't show as typed", () => {
  expect(typedColor("#c0392b80")).toBe("#c0392b80");
});

test("typedColor is null while the text is not a color yet, or is cleared", () => {
  for (const text of ["", "#", "#c0", "c0392", "#00000092b", "reddish"]) {
    expect(typedColor(text)).toBeNull();
  }
});

// #482: a color field took a variable in 0.11.22 (`var(--color-ink)`); it does
// again, without giving back 7d83af98's fix — nothing but a color or ONE
// reference is ever saved.
const { typedColorValue } = await import("../../src/lib/style-tokens");

test("typedColorValue saves a color as typedColor does", () => {
  expect(typedColorValue("c0392b")).toBe("#c0392b");
  expect(typedColorValue("red", "--color-accent")).toBe("#ff0000");
  expect(typedColorValue("#c0392b80")).toBe("#c0392b80");
});

test("typedColorValue saves a reference to another setting, spaced the plain way", () => {
  expect(typedColorValue("var(--color-ink)", "--color-accent")).toBe("var(--color-ink)");
  expect(typedColorValue("  var( --color-ink )  ", "--color-accent")).toBe("var(--color-ink)");
  expect(typedColorValue("var(--brand_2)")).toBe("var(--brand_2)");
});

test("typedColorValue saves nothing that is neither: a broken or compound reference, a loop, or CSS that would end the declaration", () => {
  for (const text of [
    "var(--color-ink",
    "var(color-ink)",
    "var(--)",
    "var(--color-ink, red)",
    "var(--a) var(--b)",
    "var(--color-ink); } body { display: none",
    "var(--color-ink);",
    "--color-ink",
    "reddish",
    "",
  ]) {
    expect(typedColorValue(text, "--color-accent")).toBeNull();
  }
  // A setting that refers to itself is a loop the browser throws away.
  expect(typedColorValue("var(--color-accent)", "--color-accent")).toBeNull();
});
