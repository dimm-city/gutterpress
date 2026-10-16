import { describe, expect, test } from "bun:test";

import { printAreaFromMeta, printAreaMeta } from "./print-area.ts";

/** A one-element stand-in for `document`: the reader only queries the meta. */
function docWith(tag: string) {
  const content = tag.match(/content='([^']*)'/)?.[1]?.replace(/&#39;/g, "'").replace(/&amp;/g, "&") ?? null;
  return {
    querySelector: (selector: string) => {
      expect(selector).toBe('meta[name="gp-print-area"]');
      return content === null ? null : { getAttribute: (name: string) => (name === "content" ? content : null) };
    },
  };
}

describe("the gp-print-area meta", () => {
  test("carries the page block, the preset and its spec; nothing else the config holds", () => {
    const tag = printAreaMeta({ width: 621, height: 810, tolerance: 0.5, bleed: 9, safe: 36, artSafe: 18 } as never);
    expect(tag).toBe(`<meta name="gp-print-area" content='{"width":621,"height":810,"bleed":9,"safe":36,"artSafe":18}'>`);
  });

  test("an unset bleed or text rule is 0, never missing; an unset art rule stays out", () => {
    expect(printAreaMeta({ width: 432, height: 648 })).toContain(
      `content='{"width":432,"height":648,"bleed":0,"safe":0}'`,
    );
  });

  test("what is in the attribute cannot end it", () => {
    const spec = { label: "Bob's <Print> & Co", url: "https://example.test/a?b=1&c=2" };
    expect(printAreaMeta({ width: 300, height: 400, preset: "dtrpg", spec })).toContain(
      `content='{"width":300,"height":400,"bleed":0,"safe":0,"preset":"dtrpg","spec":{"label":"Bob&#39;s <Print> &amp; Co","url":"https://example.test/a?b=1&amp;c=2"}}'`,
    );
  });

  test("reads back what it wrote, an absent art rule as the text rule", () => {
    const spec = { label: "DriveThruRPG", url: "https://example.test/spec" };
    expect(
      printAreaFromMeta(docWith(printAreaMeta({ width: 621, height: 810, bleed: 9, safe: 36, artSafe: 18, preset: "dtrpg", spec }))),
    ).toEqual({ width: 621, height: 810, bleed: 9, safe: 36, artSafe: 18, gutter: 36, preset: "dtrpg", spec });
    expect(printAreaFromMeta(docWith(printAreaMeta({ width: 432, height: 648, safe: 18 })))).toEqual({
      width: 432,
      height: 648,
      bleed: 0,
      safe: 18,
      artSafe: 18,
      gutter: 18,
      preset: undefined,
      spec: undefined,
    });
  });

  test("a gutter travels in the meta and reads back; unset it stays out and reads as the text rule", () => {
    const tag = printAreaMeta({ width: 621, height: 810, bleed: 9, safe: 36, artSafe: 18, gutter: 54 });
    expect(tag).toBe(
      `<meta name="gp-print-area" content='{"width":621,"height":810,"bleed":9,"safe":36,"artSafe":18,"gutter":54}'>`,
    );
    expect(printAreaFromMeta(docWith(tag))).toMatchObject({ safe: 36, artSafe: 18, gutter: 54 });
    // an explicit 0 is a gutter of none, not "unset"; anything that is not a number is
    expect(printAreaFromMeta(docWith(printAreaMeta({ width: 621, height: 810, safe: 36, gutter: 0 })))).toMatchObject({ safe: 36, gutter: 0 });
    expect(printAreaFromMeta(docWith(`<meta content='{"width":621,"height":810,"safe":36,"gutter":"wide"}'>`))).toMatchObject({
      safe: 36,
      gutter: 36,
    });
  });

  test("no meta, or one without a page size, is no print area", () => {
    expect(printAreaFromMeta(docWith(""))).toBeNull();
    expect(printAreaFromMeta(docWith(printAreaMeta({ width: 0, height: 648 })))).toBeNull();
  });
});
